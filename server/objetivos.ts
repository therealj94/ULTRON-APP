/**
 * LOS OBJETIVOS CON ESTADO EN EL SERVIDOR (Fase 2; la entidad vive en lib/objetivos.ts).
 *
 *   GET  /api/objetivos                                   → { objetivos: VistaObjetivo[], completo, noLeidos, proyeccion }
 *                                                            (F05: cada uno reconciliado con sus tareas, como el detalle)
 *   GET  /api/objetivos/:id                               → { objetivo }   (reconciliado con sus tareas)
 *   GET  /api/objetivos/:id/cambios?desde=<revision>      → { revision, desde, resync, eventos[], campos{}, objetivo? }
 *   POST /api/objetivos {requestId, titulo, criterioCierre[], meta?, proyecto?, plataforma?, restricciones?, permisos?,
 *                        topeCosto?, siguientePaso?}       → 201 { objetivo, creado: true } | 200 { objetivo, creado: false }
 *   POST /api/objetivos/:id/decisiones {decisionId, opcion, revisionVista, aparato?}
 *                                                          → { objetivo, repetida? } | 409 { codigo, revision, objetivo }
 *   POST /api/objetivos/:id/pausar | /reanudar | /cancelar {revisionVista?}   → { objetivo, sinCambio?, cancelacion? }
 *        cancelar (F01) revoca la autoridad pendiente ANTES de cancelar cada tarea y dice qué quedó: `cancelacion.estado`
 *        pendientes-cancelados | accion-ya-aceptada | resultado-incierto (reintentable: cancelar otra vez es idempotente).
 *        El punto de no retorno es el reclamo del despachador común (lib/puerta-efecto.ts).
 *   POST /api/objetivos/:id/cerrar {revisionVista?, evidencias: [{criterioId, tipo, ref, etiqueta?}]}
 *                                                          → { objetivo } | 409 { codigo: 'sin-evidencia' }
 *   POST /api/objetivos/:id/documentos {archivoId, revisionVista?}            → { objetivo, documento }
 *   POST /api/objetivos/:id/tareas {requestId, titulo, objetivo?}             → { objetivo, tarea }  (una tarea `queued`)
 *   GET  /api/compromisos                                  → { compromisos[] }  (el libro de compromisos, solo registro)
 *
 * La persona sale SIEMPRE de la sesión firmada (deps.sesionDe); un correo en el cuerpo o en la consulta no cambia de
 * quién son. Lo que no es suyo es 404, igual que lo que no existe. Solo AU-RA (server.ts monta las rutas con
 * `exigirPlataforma('ultron')` además de la sesión de siempre). Un conflicto de revisión es 409 con la revisión y el
 * objetivo de ahora: el aparato que llegó tarde se pone al día sin otra lectura.
 */
import type express from 'express';
import { aparatoValido } from '../lib/acciones-app';
import { listarCompromisos, vistaCompromiso } from '../lib/compromisos';
import { almacenDurable, huellaDueno, leerDurable, type AlmacenDurable } from '../lib/durable';
import {
  cambiarObjetivo,
  cambiosDesde,
  crearObjetivo,
  decidirObjetivo,
  ErrorObjetivo,
  esTerminalObjetivo,
  leerObjetivo,
  listarObjetivos,
  pedirDecision,
  reconciliarObjetivo,
  textoObjetivo,
  vistaObjetivo,
  type CambioObjetivo,
  type Objetivo,
  type TareaParaObjetivo,
} from '../lib/objetivos';
import { claveManifiesto, type ManifiestoArchivo } from '../lib/oficina/almacen';
import { bloqueObjetivosTurno, objetivosAlCaso, type ObjetivoParaTurno } from '../lib/objetivos-turno';
import { agendarDetallado, anotarDespertarPendiente, type ResultadoAgendar } from '../lib/agenda';
import { encolarAvisoDecision, entregarAviso, TERMINALES_AVISO, type EstadoAviso, type RefAviso } from '../lib/avisos-decision';
import { datosPushDecision, enviarPush, pedirDecisionPorPush, type PushDecision } from '../lib/push';
import { autorizarEjecucion, cambiarTarea, crearTarea, esTerminal, leerTarea, vistaTarea, type EstadoTarea, type RegistroTarea, type Vinculo } from '../lib/tareas-durables';
import { operacionDeBorrador } from '../lib/envios';
import { PUNTO_SIN_RETORNO, revocarAutoridad } from '../lib/puerta-efecto';
import { descartarBorradorDurable } from './borradores-durables';

export type DepsObjetivos = {
  /** Las puertas de siempre: la sesión de la mesa y `exigirPlataforma('ultron')` (Dr Electrum no entra). */
  exigir: express.RequestHandler[];
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => { correo?: string } | null;
  reloj?: () => number;
  /** Pone al día una tarea con sus fuentes (server/trabajos.ts `revisarTarea`). Sin esto, se usa como está. */
  revisarTarea?: (dueno: string, reg: RegistroTarea) => Promise<RegistroTarea>;
  /** El aviso «necesito tu decisión» (lib/push.ts `pedirDecisionPorPush`, que lo manda una vez por decisión + revisión). */
  avisarDecision?: (correo: string, p: PushDecision) => Promise<unknown>;
  /**
   * Los borradores en la memoria del proceso (server/correo.ts, server/whatsapp.ts; server.ts pasa los de las tareas):
   * cancelar el objetivo descarta los que esperaban el «sí» de sus tareas, para que un «sí» en el chat no los mande.
   */
  borradores?: { descartar(correo: string, canal: 'correo' | 'whatsapp', ambito: string, intento: string): Promise<unknown> };
  almacen?: AlmacenDurable;
};

const conCorreo = (c: string) => {
  const s = String(c || '').trim().toLowerCase();
  return s.includes('@') || /^veta:0x[0-9a-f]{40}$/.test(s) ? s : '';
};

/* ------------------------------------------------------------------ reconciliar y avisar */

/**
 * Lo que quedó de cada aviso (EX-01), por referencia:
 *   · `agendado`: guardado en la bandeja de salida y con su entrada en la agenda (el planificador lo trabaja solo);
 *   · `terminado`: ya no hace falta agenda (entregado, invalidado, diagnosticado, agotado o vencido);
 *   · `sin-registrar`: no se pudo guardar el aviso;
 *   · `sin-agendar`: se guardó pero sin entrada en la agenda (nadie lo trabajaría sin otra reconciliación).
 * `completo`: todos `agendado` o `terminado`. Si no, quien llama deja el objetivo agendado para reintentarlo.
 */
export type EstadoAvisoRef = 'agendado' | 'terminado' | 'sin-registrar' | 'sin-agendar';
export type ResultadoAvisos = { completo: boolean; resultados: { ref: RefAviso; estado: EstadoAvisoRef; detalle?: string }[] };

/** Cuánto espera el planificador para volver a un objetivo cuyos avisos no quedaron guardados (una vuelta, con espera). */
export const REINTENTO_AVISOS_MS = 60_000;

/**
 * «Necesito tu decisión» por cada decisión pendiente del objetivo y por cada tarea suya que espera aprobación (F04): cada
 * una queda en la bandeja de salida durable (lib/avisos-decision.ts, una vez por decisión + revisión) y se intenta
 * entregar ya con `avisar` (el transporte). Si falla, el planificador la reintenta con espera; si la decisión cambia o se
 * resuelve antes, no sale. Sin `avisar` solo se encola (la entrega la hace el planificador). Llamarlo dos veces no avisa
 * dos veces. Devuelve qué quedó guardado de cada una (EX-01: no cuántas había). Nunca lanza.
 */
export async function avisarDecisionesPendientes(
  correo: string,
  obj: Objetivo,
  tareas: (RegistroTarea | null)[],
  avisar?: DepsObjetivos['avisarDecision'],
  o: { almacen?: AlmacenDurable; ahora?: number } = {}
): Promise<ResultadoAvisos> {
  if (obj.estado !== 'esperando-decision' || esTerminalObjetivo(obj.estado)) return { completo: true, resultados: [] };
  const refs: RefAviso[] = [];
  for (const d of obj.decisiones) if (!d.elegida) refs.push({ objetivoId: obj.id, decisionId: d.id, revision: d.version });
  for (const t of tareas) {
    if (!t || esTerminal(t.estado) || t.estado !== 'awaiting_approval' || !t.decision) continue;
    refs.push({ objetivoId: obj.id, tareaId: t.id, decisionId: t.decision.id, revision: t.version });
  }
  const resultados: ResultadoAvisos['resultados'] = [];
  for (const ref of refs) {
    const e = await encolarAvisoDecision(correo, ref, { almacen: o.almacen, ahora: o.ahora }).catch((err) => ({ ok: false as const, detalle: String(err?.message || err), aviso: undefined }));
    const aviso = e.aviso;
    let estado: EstadoAvisoRef = e.ok ? (TERMINALES_AVISO.has(e.aviso.estado) ? 'terminado' : 'agendado') : aviso ? 'sin-agendar' : 'sin-registrar';
    if (avisar && aviso && aviso.estado === 'pendiente') {
      const s = await entregarAviso(correo, aviso.id, { transporte: avisar, almacen: o.almacen, ahora: o.ahora }).catch(() => null);
      // Cerrado en línea (entregado, invalidado, diagnosticado): ya no le hace falta la agenda aunque no la tuviera.
      if (s && TERMINALES_AVISO.has(s.estado as EstadoAviso)) estado = 'terminado';
    }
    resultados.push({ ref, estado, ...(e.ok === false && estado !== 'terminado' ? { detalle: e.detalle } : {}) });
  }
  return { completo: resultados.every((x) => x.estado === 'agendado' || x.estado === 'terminado'), resultados };
}

/**
 * EX-01: el objetivo vuelve a la agenda para que el planificador reintente sus avisos (idempotente; nunca lanza). Si no
 * cabe (agenda llena) o no se pudo escribir, queda en los despertares pendientes (lib/agenda.ts, otra clave) y la vuelta
 * del planificador (`repararDespertares`) lo agenda en cuanto haya sitio: antes, el `false` se ignoraba y el aviso quedaba
 * guardado sin nadie que lo trabajara. true solo si quedó en la agenda.
 */
async function agendarReintentoAvisos(dueno: string, objetivoId: string, a: AlmacenDurable | undefined, ahora?: number): Promise<boolean> {
  const t = ahora ?? Date.now();
  return agendarObjetivo(dueno, objetivoId, t + REINTENTO_AVISOS_MS, a, t);
}

/** El objetivo a la agenda para `cuando`; si no se pudo, a los despertares pendientes (ver arriba). Nunca lanza. */
async function agendarObjetivo(dueno: string, objetivoId: string, cuando: number, a: AlmacenDurable | undefined, ahora: number): Promise<boolean> {
  const r = await agendarDetallado('objetivo', dueno, objetivoId, cuando, { almacen: a, ahora }).catch((): ResultadoAgendar => ({ ok: false, motivo: 'almacen' }));
  if (r.ok === true) return true;
  if (r.motivo !== 'invalida') await anotarDespertarPendiente('objetivo', dueno, objetivoId, r.motivo === 'lleno' ? 'agenda-llena' : 'almacen', { almacen: a, ahora }).catch(() => false);
  return false;
}

/**
 * Pone el objetivo al día con sus tareas (lib/objetivos.ts `reconciliarObjetivo`) y guarda solo si cambió. Si queda en
 * `esperando-decision` (cambie o no en esta llamada: F04), sus avisos van a la bandeja de salida. Un objetivo cancelado
 * con acciones ya aceptadas anota su resultado cuando llega, sin reactivar nada (F05). Nunca lanza: si no se pudo,
 * devuelve el que había.
 */
export async function reconciliarObjetivoConTareas(
  dueno: string,
  obj: Objetivo,
  o: { revisarTarea?: DepsObjetivos['revisarTarea']; avisarDecision?: DepsObjetivos['avisarDecision']; almacen?: AlmacenDurable; ahora?: number } = {}
): Promise<Objetivo> {
  return (await reconciliarYAvisar(dueno, obj, o)).objetivo;
}

/**
 * Lo mismo, diciendo además si cada decisión que espera tiene su aviso guardado y agendado (`avisosCompletos`, EX-01).
 * Si no (el aviso o su agenda no se pudieron escribir, una tarea no se pudo leer, el objetivo no se pudo guardar), el
 * objetivo vuelve a la agenda para que el planificador lo reintente sin que nadie abra la app; el planificador, que ya
 * tiene la entrada en la mano, pasa `agendarSiFalta: false` y decide él cuándo vuelve.
 */
export async function reconciliarYAvisar(
  dueno: string,
  obj: Objetivo,
  o: { revisarTarea?: DepsObjetivos['revisarTarea']; avisarDecision?: DepsObjetivos['avisarDecision']; almacen?: AlmacenDurable; ahora?: number; agendarSiFalta?: boolean } = {}
): Promise<{ objetivo: Objetivo; avisosCompletos: boolean; avisos?: ResultadoAvisos }> {
  if (esTerminalObjetivo(obj.estado)) return { objetivo: obj.estado === 'cancelado' && obj.enVueloAlCancelar?.length ? await anotarTardios(dueno, obj, o) : obj, avisosCompletos: true };
  const a = o.almacen || almacenDurable();
  const incompleto = async (objetivo: Objetivo, avisos?: ResultadoAvisos) => {
    if (o.agendarSiFalta !== false) await agendarReintentoAvisos(dueno, objetivo.id, a, o.ahora);
    return { objetivo, avisosCompletos: false, ...(avisos ? { avisos } : {}) };
  };
  const leidas: (RegistroTarea | null)[] = await Promise.all(
    obj.tareas.map(async (id) => {
      const l = await leerTarea(dueno, id, a).catch(() => ({ ok: false as const }));
      if (l.ok === false) return null;
      if (!l.tarea) return { id, estado: 'cancelled' as EstadoTarea } as RegistroTarea; // ya no existe: no trabaja ni espera
      return !esTerminal(l.tarea.estado) && o.revisarTarea ? await o.revisarTarea(dueno, l.tarea).catch(() => l.tarea!) : l.tarea;
    })
  );
  const min: TareaParaObjetivo[] = leidas.map((t) => (t ? { id: t.id, estado: t.estado, decision: t.decision ? { id: t.decision.id } : null } : null));
  const c = reconciliarObjetivo(obj, min);
  let final = obj;
  if (c) {
    const r = await cambiarObjetivo(dueno, obj.id, (x) => reconciliarObjetivo(x, min), { almacen: a, ahora: o.ahora }).catch(() => null);
    if (!r || r.ok === false) {
      // No se guardó: si había (o iba a haber) una decisión esperando, sus avisos no se intentaron.
      return obj.estado === 'esperando-decision' || c.estado === 'esperando-decision' ? incompleto(obj) : { objetivo: obj, avisosCompletos: true };
    }
    final = r.objetivo;
  }
  if (final.estado !== 'esperando-decision') return { objetivo: final, avisosCompletos: true };
  const avisos = await avisarDecisionesPendientes(dueno, final, leidas, o.avisarDecision, { almacen: a, ahora: o.ahora });
  // Una tarea que no se pudo leer puede estar esperando una aprobación sin aviso: tampoco está completo.
  if (!avisos.completo || leidas.some((t) => t === null)) return incompleto(final, avisos);
  return { objetivo: final, avisosCompletos: true, avisos };
}

/**
 * F05: el objetivo se canceló con acciones ya aceptadas (`enVueloAlCancelar`). Cuando una termina (llegó su recibo de
 * verdad), el hecho queda anotado junto con la cancelación; el objetivo sigue cancelado y nada cancelado se reactiva.
 */
async function anotarTardios(dueno: string, obj: Objetivo, o: { almacen?: AlmacenDurable; ahora?: number }): Promise<Objetivo> {
  const a = o.almacen || almacenDurable();
  let actual = obj;
  for (const id of obj.enVueloAlCancelar || []) {
    const l = await leerTarea(dueno, id, a).catch(() => null);
    if (!l || l.ok === false || !l.tarea || !esTerminal(l.tarea.estado)) continue;
    const t = l.tarea;
    const texto = t.estado === 'completed' ? `Llegó el resultado de «${textoObjetivo(t.titulo, 60)}»: ya estaba aceptado cuando cancelaste` : `«${textoObjetivo(t.titulo, 60)}» terminó (${t.estado}) después de cancelar`;
    const r = await cambiarObjetivo(dueno, obj.id, () => ({ tardio: { tareaId: id, estado: t.estado }, evento: texto }), { almacen: a, ahora: o.ahora }).catch(() => null);
    if (r && r.ok) actual = r.objetivo;
  }
  return actual;
}

/* ------------------------------------------------------------------ cancelar: revocar la autoridad pendiente */

/**
 * Cancelar el objetivo descarta el borrador (correo o WhatsApp) que esperaba el «sí» de una de sus tareas: en lo durable
 * (una marca por intento: ninguna réplica lo rehidrata) y en la memoria del proceso (`borradores.descartar`, que también
 * lo anota como rechazado: un turno de voz descartado no lo repone). true solo si la marca durable quedó. Nunca lanza.
 */
export async function descartarBorradoresDeTarea(
  dueno: string,
  vinc: { canal: 'correo' | 'whatsapp'; ambito: string; intento: string } | null,
  o: { almacen?: AlmacenDurable; borradores?: DepsObjetivos['borradores']; ahora?: number } = {}
): Promise<boolean> {
  if (!vinc?.intento) return false;
  const marcada = await descartarBorradorDurable(vinc.canal, dueno, vinc.intento, o.almacen, o.ahora).catch(() => false);
  if (o.borradores) await Promise.resolve(o.borradores.descartar(dueno, vinc.canal, vinc.ambito, vinc.intento)).catch(() => undefined);
  return marcada;
}

/**
 * Lo que pasó al cancelar (F01). Los cuatro estados que ve la persona (API y apps):
 *   · cancelación solicitada: el objetivo quedó `cancelado` (siempre que la ruta contesta 200);
 *   · `pendientes-cancelados`: lo que no había pasado el punto de no retorno quedó revocado de forma durable;
 *   · `accion-ya-aceptada`: alguna acción ya estaba reclamada para salir: su resultado llega y se conserva;
 *   · `resultado-incierto`: no se pudo dejar la revocación escrita (o leer una tarea): NO se dice «cancelado» de esa
 *     tarea; cancelar otra vez (idempotente) termina lo pendiente.
 * El punto de no retorno: lib/puerta-efecto.ts (el reclamo de la operación en el despachador común).
 */
export type EstadoCancelacionTarea = 'cancelada' | 'ya-aceptada' | 'incierta' | 'sin-pendiente';
export type Cancelacion = {
  estado: 'pendientes-cancelados' | 'accion-ya-aceptada' | 'resultado-incierto';
  tareas: { id: string; estado: EstadoCancelacionTarea; detalle?: string }[];
  reintentable: boolean;
  puntoSinRetorno: string;
};

const QUIETAS: ReadonlySet<EstadoTarea> = new Set<EstadoTarea>(['created', 'planning', 'queued', 'waiting_resource', 'awaiting_approval', 'blocked', 'paused']);

/**
 * Recorre las tareas del objetivo cancelado (idempotente). Por cada una, la autoridad de su efecto pendiente se REVOCA
 * primero (CAS sobre la misma clave que reclama el despachador) y solo después se cancela la tarea:
 *   · revocada → `cancelled` con su recibo «antes de hacer nada con efecto» y el borrador descartado;
 *   · ya reclamada → no se toca: está saliendo (o salió) y su recibo llega; queda en `enVueloAlCancelar`;
 *   · el almacén no contestó → la tarea no recibe un «cancelada» definitivo y se dice incierto.
 * Nunca lanza.
 */
export async function cancelarPendientesDeObjetivo(
  dueno: string,
  obj: Objetivo,
  o: { almacen?: AlmacenDurable; borradores?: DepsObjetivos['borradores']; ahora?: number } = {}
): Promise<Cancelacion> {
  const a = o.almacen || almacenDurable();
  const ahora = o.ahora ?? Date.now();
  const tareas: Cancelacion['tareas'] = [];
  for (const id of obj.tareas) {
    const l = await leerTarea(dueno, id, a).catch(() => ({ ok: false as const, detalle: '' }));
    if (l.ok === false) {
      tareas.push({ id, estado: 'incierta', detalle: 'no pude leer la tarea' });
      continue;
    }
    const t = l.tarea;
    if (!t || esTerminal(t.estado)) {
      tareas.push({ id, estado: 'sin-pendiente' });
      continue;
    }
    const vinc = t.decision?.vinculo?.tipo === 'borrador' ? t.decision.vinculo : null;
    // La operación de efecto pendiente: la del borrador que espera, o la que ya autorizó una aprobación en marcha.
    const efecto = vinc ? operacionDeBorrador(vinc.canal, vinc.intento) : [...(t.resueltas || [])].reverse().find((x) => x.efecto)?.efecto;
    if (!QUIETAS.has(t.estado)) {
      // En marcha: si su efecto todavía no se reclamó, la revocación lo impide (la tarea terminará «no salió»).
      if (!efecto) {
        tareas.push({ id, estado: 'ya-aceptada', detalle: 'ya estaba en marcha' });
        continue;
      }
      const r = await revocarAutoridad(dueno, efecto, { motivo: 'objetivo-cancelado', revision: obj.revision, almacen: a, ahora });
      tareas.push(r.resultado === 'incierto' ? { id, estado: 'incierta', detalle: r.detalle } : r.resultado === 'ya-aceptada' ? { id, estado: 'ya-aceptada' } : { id, estado: 'cancelada', detalle: 'su envío se revocó antes de salir' });
      continue;
    }
    if (efecto) {
      const r = await revocarAutoridad(dueno, efecto, { motivo: 'objetivo-cancelado', revision: obj.revision, almacen: a, ahora });
      if (r.resultado === 'incierto') {
        tareas.push({ id, estado: 'incierta', detalle: `no pude dejar la cancelación registrada: ${r.detalle}` });
        continue;
      }
      if (r.resultado === 'ya-aceptada') {
        tareas.push({ id, estado: 'ya-aceptada' });
        continue;
      }
    }
    let vista: EstadoTarea | null = null;
    const c = await cambiarTarea(
      dueno,
      id,
      (x) => {
        vista = x.estado;
        if (esTerminal(x.estado) || !QUIETAS.has(x.estado)) return null;
        return { estado: 'cancelled', pasoActual: null, decision: null, resultado: { id: `${x.id}:resultado`, resumen: 'Cancelada con su objetivo antes de hacer nada con efecto.', evidencias: [], parcial: [], pendiente: [], t: ahora } };
      },
      { almacen: a, ahora }
    ).catch(() => null);
    if (!c || c.ok === false) {
      tareas.push({ id, estado: 'incierta', detalle: 'no pude cancelar la tarea' });
      continue;
    }
    if (c.tarea.estado !== 'cancelled') {
      tareas.push({ id, estado: vista && esTerminal(vista) ? 'sin-pendiente' : 'ya-aceptada' });
      continue;
    }
    // La lápida (y fuera de la memoria de esta réplica): la autoridad ya está revocada; esto es para que ninguna réplica
    // lo vuelva a poner a esperar.
    if (vinc) await descartarBorradoresDeTarea(dueno, vinc, { almacen: a, borradores: o.borradores, ahora });
    tareas.push({ id, estado: 'cancelada' });
  }
  const incierta = tareas.some((x) => x.estado === 'incierta');
  const aceptada = tareas.some((x) => x.estado === 'ya-aceptada');
  return { estado: incierta ? 'resultado-incierto' : aceptada ? 'accion-ya-aceptada' : 'pendientes-cancelados', tareas, reintentable: incierta, puntoSinRetorno: PUNTO_SIN_RETORNO };
}

/* ------------------------------------------------------------------ el bloque del turno de AU-RA */

/** Cuánto vale lo leído para el turno (los cambios por las rutas lo olvidan antes). */
export const OBJETIVOS_TURNO_VIVE_MS = 60_000;
/** Cuánto espera el turno a leerlos (la voz no puede esperar al almacén): después, lo que había. */
export const OBJETIVOS_TURNO_ESPERA_MS = 250;
/** Lo leído para el turno: el bloque y lo justo de cada objetivo para saber si viene al caso (objetivosAlCaso). */
type DelTurno = { bloque: string; objetivos: ObjetivoParaTurno[] };
const delTurno = new Map<string, DelTurno & { t: number }>();
const leyendoTurno = new Map<string, Promise<DelTurno>>();

/** Algo cambió en los objetivos de esta persona: el próximo turno los vuelve a leer. */
export function olvidarObjetivosDelTurno(dueno: string): void {
  delTurno.delete(conCorreo(dueno));
}

/**
 * El bloque de sus objetivos abiertos para el turno (lib/objetivos-turno.ts, ≤400 caracteres), solo AU-RA. Lee del
 * almacén a lo más OBJETIVOS_TURNO_ESPERA_MS; si tarda, va lo último que se supo (o nada) y la lectura sigue para el
 * turno siguiente. Nunca lanza. Con `mensaje` (José, 10-oct: «que no se mix con otras cosas»), solo si el mensaje es del
 * trabajo, de seguir, de sus objetivos o pregunta qué le toca decidir (objetivosAlCaso); si no, ''.
 */
export async function bloqueObjetivosDelTurno(correo: string, o: { plataforma: string; almacen?: AlmacenDurable; esperaMs?: number; ahora?: number; mensaje?: string }): Promise<string> {
  const dueno = conCorreo(correo);
  if (!dueno || o.plataforma !== 'ultron') return '';
  const ahora = o.ahora ?? Date.now();
  const alCaso = (d: DelTurno | undefined) => (!d ? '' : o.mensaje === undefined || objetivosAlCaso(o.mensaje, d.objetivos) ? d.bloque : '');
  const previo = delTurno.get(dueno);
  if (previo && ahora - previo.t < OBJETIVOS_TURNO_VIVE_MS) return alCaso(previo);
  let p = leyendoTurno.get(dueno);
  if (!p) {
    const vacio: DelTurno = { bloque: '', objetivos: [] };
    p = listarObjetivos(dueno, o.almacen || almacenDurable())
      .then((l) => {
        if (l.ok === false) return previo ?? vacio;
        const bloque = bloqueObjetivosTurno(l.objetivos, { plataforma: 'ultron' });
        const objetivos = l.objetivos.map((x) => ({ titulo: x.titulo, estado: x.estado, actualizado: x.actualizado, decisiones: x.decisiones }));
        delTurno.set(dueno, { t: Date.now(), bloque, objetivos });
        while (delTurno.size > 500) delTurno.delete(delTurno.keys().next().value as string);
        return { bloque, objetivos };
      })
      .catch(() => previo ?? vacio)
      .finally(() => leyendoTurno.delete(dueno));
    leyendoTurno.set(dueno, p);
  }
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tarde = new Promise<DelTurno | undefined>((r) => (reloj = setTimeout(() => r(previo), o.esperaMs ?? OBJETIVOS_TURNO_ESPERA_MS)));
  try {
    return alCaso(await Promise.race([p, tarde]));
  } finally {
    clearTimeout(reloj);
  }
}

/** Solo pruebas. */
export function _olvidarObjetivosDelTurno(): void {
  delTurno.clear();
  leyendoTurno.clear();
}

/* ------------------------------------------------------------------ rutas */

const sinSesion = (res: express.Response) => res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });
const noEsta = (res: express.Response) => res.status(404).json({ error: 'No encuentro ese objetivo.', honesto: true });
const almacenCaido = (res: express.Response) => res.status(503).json({ error: 'No pude leer tus objetivos en este momento. Prueba otra vez en un rato.', code: 'almacen_no_disponible', honesto: true });

/** El código HTTP de cada error tipado. */
function estadoHttp(e: ErrorObjetivo): number {
  if (e.codigo === 'no-existe') return 404;
  if (e.codigo === 'almacen') return 503;
  if (e.codigo === 'invalido' || e.codigo === 'opcion' || e.codigo === 'plataforma' || e.codigo === 'permiso') return 400;
  return 409;
}

function responderError(res: express.Response, e: ErrorObjetivo) {
  if (e.codigo === 'no-existe') return noEsta(res);
  if (e.codigo === 'almacen') return almacenCaido(res);
  return res.status(estadoHttp(e)).json({
    error: e.message,
    codigo: e.codigo,
    ...(e.objetivo ? { revision: e.objetivo.revision, objetivo: vistaObjetivo(e.objetivo) } : {}),
    honesto: true,
  });
}

/** `revisionVista` opcional: un número entero ≥ 1, o nada. NaN → inválida. */
function revisionDe(v: unknown): number | undefined | null {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export function montarRutasObjetivos(app: express.Express, d: DepsObjetivos) {
  const ahora = () => (d.reloj ? d.reloj() : Date.now());
  const alm = () => d.almacen || almacenDurable();
  const correoDe = (req: express.Request) => conCorreo(String(d.sesionDe(req)?.correo || ''));
  const sinDueno = (req: express.Request, res: express.Response) =>
    d.sesionDe(req) ? res.status(403).json({ error: 'Tus objetivos van con tu cuenta.', code: 'sin_correo', honesto: true }) : sinSesion(res);
  const reconciliado = (dueno: string, obj: Objetivo) => reconciliarObjetivoConTareas(dueno, obj, { revisarTarea: d.revisarTarea, avisarDecision: d.avisarDecision, almacen: alm(), ahora: ahora() });

  async function buscar(dueno: string, id: string): Promise<{ tipo: 'ok'; obj: Objetivo } | { tipo: 'no' } | { tipo: 'almacen' }> {
    const l = await leerObjetivo(dueno, id, alm()).catch(() => ({ ok: false as const, detalle: '' }));
    if (l.ok === false) return { tipo: 'almacen' };
    return l.objetivo ? { tipo: 'ok', obj: l.objetivo } : { tipo: 'no' };
  }

  app.get('/api/objetivos', ...d.exigir, d.limitar(90), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    res.setHeader('Cache-Control', 'no-store');
    const l = await listarObjetivos(dueno, alm()).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
    if (l.ok === false) return almacenCaido(res);
    if (!l.objetivos.length && l.noLeidos.length) return almacenCaido(res);
    // F05: la lista es la MISMA proyección que el detalle (reconciliada con sus tareas, que son la fuente de verdad), no el
    // agregado guardado tal cual: un evento perdido (una tarea que terminó en otro aparato) no deja la lista atrás. De a 5.
    const t0 = ahora();
    const vivos = l.objetivos;
    const proyectados: Objetivo[] = new Array(vivos.length);
    for (let i = 0; i < vivos.length; i += 5) {
      const tanda = vivos.slice(i, i + 5);
      const hechos = await Promise.all(tanda.map((x) => (!esTerminalObjetivo(x.estado) || x.enVueloAlCancelar?.length ? reconciliado(dueno, x) : Promise.resolve(x))));
      hechos.forEach((x, j) => (proyectados[i + j] = x));
    }
    return res.json({
      objetivos: proyectados.sort((x, y) => y.actualizado - x.actualizado).map(vistaObjetivo),
      completo: l.noLeidos.length === 0,
      noLeidos: l.noLeidos.length,
      // Cuándo se proyectó (el cliente compara revisiones por objetivo; esto dice qué tan fresca es la lista entera).
      proyeccion: { reconciliada: true, leidoEn: t0 },
      honesto: true,
    });
  });

  app.get('/api/objetivos/:id', ...d.exigir, d.limitar(120), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    res.setHeader('Cache-Control', 'no-store');
    const e = await buscar(dueno, String(req.params.id || ''));
    if (e.tipo === 'almacen') return almacenCaido(res);
    if (e.tipo === 'no') return noEsta(res);
    return res.json({ objetivo: vistaObjetivo(await reconciliado(dueno, e.obj)), honesto: true });
  });

  /** «Qué cambió desde que te fuiste»: solo lo nuevo después de `desde` (la revisión que el aparato vio por última vez). */
  app.get('/api/objetivos/:id/cambios', ...d.exigir, d.limitar(120), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    res.setHeader('Cache-Control', 'no-store');
    const e = await buscar(dueno, String(req.params.id || ''));
    if (e.tipo === 'almacen') return almacenCaido(res);
    if (e.tipo === 'no') return noEsta(res);
    const obj = await reconciliado(dueno, e.obj);
    return res.json({ ...cambiosDesde(obj, Number(req.query.desde) || 0), honesto: true });
  });

  app.post('/api/objetivos', ...d.exigir, d.limitar(30), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    const b = (req.body || {}) as Record<string, unknown>;
    const r = await crearObjetivo(
      dueno,
      {
        requestId: String(b.requestId || ''),
        titulo: String(b.titulo ?? ''),
        meta: b.meta === undefined ? undefined : String(b.meta),
        proyecto: b.proyecto === undefined ? undefined : String(b.proyecto),
        plataforma: b.plataforma === undefined ? undefined : String(b.plataforma),
        criterioCierre: Array.isArray(b.criterioCierre) ? (b.criterioCierre as never[]) : [],
        restricciones: Array.isArray(b.restricciones) ? (b.restricciones as unknown[]).map(String) : undefined,
        permisos: b.permisos === undefined ? undefined : Array.isArray(b.permisos) ? (b.permisos as unknown[]).map(String) : (b.permisos as never),
        topeCosto: b.topeCosto === undefined ? undefined : (b.topeCosto as number | null),
        siguientePaso: b.siguientePaso === undefined ? undefined : String(b.siguientePaso),
      },
      { almacen: alm(), ahora: ahora() }
    ).catch((e) => ({ ok: false as const, error: new ErrorObjetivo('almacen', String(e?.message || e)) }));
    if (r.ok === false) return responderError(res, r.error);
    olvidarObjetivosDelTurno(dueno);
    return res.status(r.creado ? 201 : 200).json({ objetivo: vistaObjetivo(r.objetivo), creado: r.creado, honesto: true });
  });

  /* ---------------------------------------------------------------- decidir */

  app.post('/api/objetivos/:id/decisiones', ...d.exigir, d.limitar(30), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    const b = (req.body || {}) as Record<string, unknown>;
    const revisionVista = revisionDe(b.revisionVista);
    const decisionId = String(b.decisionId || '');
    const opcion = String(b.opcion || '');
    if (!decisionId || !opcion || !revisionVista) return res.status(400).json({ error: 'Faltan decisionId, opcion o revisionVista.', honesto: true });
    const aparato = aparatoValido(b.aparato) || aparatoValido(req.headers['x-aura-aparato']) || undefined;
    const r = await decidirObjetivo(dueno, String(req.params.id || ''), { decisionId, opcion, revisionVista, aparato, por: 'persona' }, { almacen: alm(), ahora: ahora() });
    if (r.ok === false) return responderError(res, r.error);
    olvidarObjetivosDelTurno(dueno);
    return res.json({ objetivo: vistaObjetivo(r.objetivo), ...(r.repetida ? { repetida: true } : {}), honesto: true });
  });

  /* ---------------------------------------------------------------- pausar, reanudar, cancelar */

  for (const control of ['pausar', 'reanudar', 'cancelar'] as const) {
    app.post(`/api/objetivos/:id/${control}`, ...d.exigir, d.limitar(30), async (req, res) => {
      const dueno = correoDe(req);
      if (!dueno) return sinDueno(req, res);
      const revisionEsperada = revisionDe((req.body || {}).revisionVista);
      if (revisionEsperada === null) return res.status(400).json({ error: 'revisionVista no vale.', honesto: true });
      const e = await buscar(dueno, String(req.params.id || ''));
      if (e.tipo === 'almacen') return almacenCaido(res);
      if (e.tipo === 'no') return noEsta(res);
      const obj = e.obj;
      // Cancelar otra vez repite el recorrido (idempotente): un reintento del transporte, o el que sigue a un «incierto»,
      // termina lo que quedó pendiente.
      if (control === 'cancelar' && obj.estado === 'cancelado') {
        const cancelacion = await cancelarPendientesDeObjetivo(dueno, obj, { almacen: alm(), borradores: d.borradores, ahora: ahora() });
        const final = await anotarEnVuelo(dueno, obj, cancelacion);
        return res.json({ objetivo: vistaObjetivo(final), sinCambio: true, cancelacion, honesto: true });
      }
      // Idempotente: lo que ya está así (o ya terminó) vuelve tal cual.
      const ya = (control === 'pausar' && obj.pausado) || (control === 'reanudar' && !obj.pausado) || esTerminalObjetivo(obj.estado);
      if (ya) return res.json({ objetivo: vistaObjetivo(obj), sinCambio: true, honesto: true });
      const cambio: CambioObjetivo =
        control === 'pausar'
          ? { pausado: true, evento: 'Pausaste el objetivo: no arranco nada nuevo hasta que lo reanudes' }
          : control === 'reanudar'
            ? { pausado: false, evento: 'Lo reanudaste' }
            : { estado: 'cancelado', evento: 'Cancelaste el objetivo: no hago nada más; lo que ya se hizo queda anotado' };
      const r = await cambiarObjetivo(dueno, obj.id, () => cambio, { almacen: alm(), ahora: ahora(), revisionEsperada });
      if (r.ok === false) return responderError(res, r.error);
      olvidarObjetivosDelTurno(dueno);
      // Cancelar: el objetivo ya dice «cancelado» (la cancelación quedó solicitada, durable). Ahora se revoca lo que no
      // pasó el punto de no retorno; lo que ya pasó se dice «ya aceptada» y su recibo se conserva (lib/puerta-efecto.ts).
      if (control === 'cancelar') {
        const cancelacion = await cancelarPendientesDeObjetivo(dueno, r.objetivo, { almacen: alm(), borradores: d.borradores, ahora: ahora() });
        const final = await anotarEnVuelo(dueno, r.objetivo, cancelacion);
        return res.json({ objetivo: vistaObjetivo(final), ...(r.cambiado ? {} : { sinCambio: true }), cancelacion, honesto: true });
      }
      return res.json({ objetivo: vistaObjetivo(r.objetivo), ...(r.cambiado ? {} : { sinCambio: true }), honesto: true });
    });
  }

  /** Las tareas cuya acción ya estaba aceptada quedan anotadas en el objetivo: su recibo llega después (F05). */
  async function anotarEnVuelo(dueno: string, obj: Objetivo, c: Cancelacion): Promise<Objetivo> {
    const ids = c.tareas.filter((x) => x.estado === 'ya-aceptada').map((x) => x.id);
    if (!ids.length) return obj;
    const r = await cambiarObjetivo(dueno, obj.id, () => ({ enVueloAlCancelar: ids, evento: 'Ya estaba en camino cuando cancelaste: anoto su resultado cuando llegue' }), { almacen: alm(), ahora: ahora() }).catch(() => null);
    return r && r.ok ? r.objetivo : obj;
  }

  /* ---------------------------------------------------------------- cerrar (con evidencia) */

  app.post('/api/objetivos/:id/cerrar', ...d.exigir, d.limitar(30), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    const b = (req.body || {}) as Record<string, unknown>;
    const revisionEsperada = revisionDe(b.revisionVista);
    if (revisionEsperada === null) return res.status(400).json({ error: 'revisionVista no vale.', honesto: true });
    const lista = Array.isArray(b.evidencias) ? (b.evidencias as Record<string, unknown>[]).slice(0, 24) : [];
    const evidencias = lista
      .filter((x) => x && typeof x === 'object')
      .map((x) => ({ criterioId: String(x.criterioId || ''), tipo: String(x.tipo || '') as 'documento' | 'tarea' | 'enlace', ref: String(x.ref || '').slice(0, 500), etiqueta: x.etiqueta === undefined ? undefined : String(x.etiqueta) }))
      .filter((x) => x.tipo === 'documento' || x.tipo === 'tarea' || x.tipo === 'enlace');
    const e = await buscar(dueno, String(req.params.id || ''));
    if (e.tipo === 'almacen') return almacenCaido(res);
    if (e.tipo === 'no') return noEsta(res);
    // Una tarea es evidencia solo si es de este objetivo y TERMINÓ comprobada (`completed`): «respondida» o «partial» no.
    for (const ev of evidencias.filter((x) => x.tipo === 'tarea')) {
      const t = e.obj.tareas.includes(ev.ref) ? await leerTarea(dueno, ev.ref, alm()).catch(() => null) : null;
      if (!t || t.ok === false || !t.tarea || t.tarea.estado !== 'completed') {
        return res.status(409).json({ error: `La tarea que das como evidencia no terminó comprobada: no puedo cerrar «${textoObjetivo(e.obj.titulo, 80)}» con ella.`, codigo: 'sin-evidencia', revision: e.obj.revision, objetivo: vistaObjetivo(e.obj), honesto: true });
      }
    }
    const r = await cambiarObjetivo(dueno, e.obj.id, () => ({ evidencias, estado: 'completado', evento: 'Lo cerraste: cada criterio tiene su evidencia' }), { almacen: alm(), ahora: ahora(), revisionEsperada });
    if (r.ok === false) return responderError(res, r.error);
    olvidarObjetivosDelTurno(dueno);
    return res.json({ objetivo: vistaObjetivo(r.objetivo), honesto: true });
  });

  /* ---------------------------------------------------------------- documentos (versiones) */

  app.post('/api/objetivos/:id/documentos', ...d.exigir, d.limitar(30), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    const b = (req.body || {}) as Record<string, unknown>;
    const revisionEsperada = revisionDe(b.revisionVista);
    if (revisionEsperada === null) return res.status(400).json({ error: 'revisionVista no vale.', honesto: true });
    const archivoId = String(b.archivoId || '');
    if (!/^d_[0-9a-f]{24}$/.test(archivoId)) return res.status(400).json({ error: 'Falta el archivoId del documento (el de la oficina).', honesto: true });
    // La ficha del documento, del DUEÑO de la sesión (lib/oficina/almacen.ts): el nombre y la huella salen de ahí, nunca del
    // cuerpo. Un documento de otra cuenta, para esta, no existe.
    const l = await leerDurable<ManifiestoArchivo>(claveManifiesto(dueno, archivoId), alm()).catch(() => ({ ok: false as const, detalle: '' }));
    if (l.ok === false) return almacenCaido(res);
    const m = l.valor;
    if (!m || m.dueno !== huellaDueno(dueno) || m.id !== archivoId) return res.status(404).json({ error: 'No encuentro ese documento entre los tuyos.', honesto: true });
    if (ahora() > m.vence) return res.status(410).json({ error: 'Ese documento ya venció (la oficina guarda los archivos unos días). Pídeme una versión nueva.', codigo: 'vencido', honesto: true });
    let version = 1;
    const r = await cambiarObjetivo(
      dueno,
      String(req.params.id || ''),
      (obj) => {
        const previo = obj.documentos.find((x) => x.vigente && x.nombre.toLowerCase() === textoObjetivo(m.nombre, 160).toLowerCase());
        version = obj.documentos.find((x) => x.id === archivoId)?.version ?? (previo ? (previo.sha256 === m.sha256 ? previo.version : previo.version + 1) : 1);
        return { documento: { id: m.id, nombre: m.nombre, sha256: m.sha256, creado: m.creado }, evento: version > 1 ? `Preparé la versión ${version} de «${textoObjetivo(m.nombre, 80)}»` : `Agregué «${textoObjetivo(m.nombre, 80)}»` };
      },
      { almacen: alm(), ahora: ahora(), revisionEsperada }
    );
    if (r.ok === false) return responderError(res, r.error);
    const documento = r.objetivo.documentos.find((x) => x.id === archivoId) || r.objetivo.documentos.find((x) => x.vigente && x.sha256 === m.sha256) || null;
    olvidarObjetivosDelTurno(dueno);
    return res.json({ objetivo: vistaObjetivo(r.objetivo), documento, ...(r.cambiado ? {} : { sinCambio: true }), honesto: true });
  });

  /* ---------------------------------------------------------------- tareas del objetivo */

  /** Una tarea nueva que es DE este objetivo (queda `queued`: el planificador la arranca). Una vez por requestId. */
  app.post('/api/objetivos/:id/tareas', ...d.exigir, d.limitar(30), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    const b = (req.body || {}) as Record<string, unknown>;
    const requestId = String(b.requestId || '');
    const titulo = textoObjetivo(b.titulo, 100);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) return res.status(400).json({ error: 'Falta el requestId (8 a 64 letras, números, - o _).', honesto: true });
    if (titulo.length < 3) return res.status(400).json({ error: 'La tarea necesita un título.', honesto: true });
    const e = await buscar(dueno, String(req.params.id || ''));
    if (e.tipo === 'almacen') return almacenCaido(res);
    if (e.tipo === 'no') return noEsta(res);
    if (esTerminalObjetivo(e.obj.estado)) return responderError(res, new ErrorObjetivo('terminal', 'El objetivo ya terminó: no le agrego tareas.', e.obj));
    const t = await crearTarea(
      dueno,
      // Solo con `ejecutar: true` (y el permiso `investigar` del objetivo) el planificador la empieza sola.
      { requestId: `obj-${e.obj.id}-${requestId}`, titulo, objetivo: textoObjetivo(b.objetivo, 400) || titulo, estado: 'queued', entorno: { kind: 'chat', id: 'api', displayName: 'AURA' }, origen: { kind: 'api' }, objetivoId: e.obj.id, ejecutar: b.ejecutar === true },
      { almacen: alm(), ahora: ahora() }
    ).catch(() => null);
    if (!t || t.ok === false) return almacenCaido(res);
    if (!t.creada && b.ejecutar === true && t.tarea.estado === 'queued' && !t.tarea.ejecutar) {
      const au = await autorizarEjecucion(dueno, t.tarea.id, { almacen: alm(), ahora: ahora() }).catch(() => null);
      if (au && au.ok) t.tarea = au.tarea;
    }
    const r = await cambiarObjetivo(dueno, e.obj.id, (obj) => (obj.tareas.includes(t.tarea.id) ? null : { tarea: t.tarea.id, estado: obj.estado === 'abierto' ? 'en-curso' : undefined, evento: `Sumé la tarea «${textoObjetivo(t.tarea.titulo, 80)}»` }), { almacen: alm(), ahora: ahora() });
    if (r.ok === false) return responderError(res, r.error);
    return res.status(t.creada ? 201 : 200).json({ objetivo: vistaObjetivo(r.objetivo), tarea: vistaTarea(t.tarea, ahora()), honesto: true });
  });

  /* ---------------------------------------------------------------- el libro de compromisos */

  app.get('/api/compromisos', ...d.exigir, d.limitar(60), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    res.setHeader('Cache-Control', 'no-store');
    const l = await listarCompromisos(dueno, alm()).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
    if (l.ok === false) return almacenCaido(res);
    return res.json({ compromisos: l.compromisos.map(vistaCompromiso), completo: l.noLeidos === 0, honesto: true });
  });
}

/* ------------------------------------------------------------------ ganchos para AURA */

/**
 * AURA necesita una decisión de la persona sobre un objetivo (≤3 opciones, cada una con su consecuencia): queda en el
 * objetivo (`esperando-decision`) y sale el aviso «necesito tu decisión» con un botón por opción (una vez por decisión +
 * revisión).
 */
export async function pedirDecisionObjetivo(
  correo: string,
  objetivoId: string,
  d: { pregunta: string; opciones: { id?: string; etiqueta: string; consecuencia: string }[] },
  o: { avisarDecision?: DepsObjetivos['avisarDecision']; almacen?: AlmacenDurable; ahora?: number; revisionEsperada?: number } = {}
): Promise<{ ok: true; objetivo: Objetivo; decisionId: string } | { ok: false; error: ErrorObjetivo }> {
  const dueno = conCorreo(correo);
  if (!dueno) return { ok: false, error: new ErrorObjetivo('invalido', 'Sin cuenta no hay objetivos.') };
  // F04: la intención de avisar va ANTES del cambio (la agenda del planificador): si el proceso muere entre la decisión
  // y su aviso, la próxima vuelta encola el aviso; si el cambio no llegó a escribirse, no hay nada que avisar. Si la
  // agenda está llena (o no se pudo escribir), la intención queda en los despertares pendientes (EX-01).
  await agendarObjetivo(dueno, objetivoId, o.ahora ?? Date.now(), o.almacen, o.ahora ?? Date.now());
  const r = await pedirDecision(dueno, objetivoId, d, { almacen: o.almacen, ahora: o.ahora, revisionEsperada: o.revisionEsperada });
  if (r.ok === false) return r;
  olvidarObjetivosDelTurno(dueno);
  const nueva = [...r.objetivo.decisiones].reverse().find((x) => !x.elegida)!;
  const avisos = await avisarDecisionesPendientes(dueno, r.objetivo, [], o.avisarDecision ?? ((c, p) => enviarPush(c, datosPushDecision(p))), { almacen: o.almacen, ahora: o.ahora });
  // EX-01: si el aviso (o su agenda) no quedó escrito, el objetivo sigue en la agenda para que el planificador lo reintente.
  if (!avisos.completo) await agendarReintentoAvisos(dueno, objetivoId, o.almacen, o.ahora);
  return { ok: true, objetivo: r.objetivo, decisionId: nueva.id };
}
