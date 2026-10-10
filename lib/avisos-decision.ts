/**
 * LA BANDEJA DE SALIDA DE LOS AVISOS «NECESITO TU DECISIÓN» (F04 del plan de cierre 5.7).
 *
 * Antes: el aviso salía solo si el objetivo CAMBIABA a `esperando-decision` en esa misma llamada; si el primer envío
 * fallaba, la marca quedaba `fallido` pero nadie volvía a llamar (la ruta salía antes si el objetivo no cambiaba y el
 * planificador no barría decisiones pendientes): la decisión esperaba sin que nadie la viera.
 *
 * Ahora cada aviso es un registro durable (lib/durable.ts) por dueño + decisión + revisión, con una entrada en la agenda
 * del planificador (lib/agenda.ts, tipo `aviso`) para que alguien lo trabaje aunque nadie abra la app:
 *   { objetivoId, tareaId?, decisionId, revision, destino: 'push', estado, etapa, intentos, proximoIntento, vence }
 *
 *  · El hueco entre el cambio y el aviso se REPARA: lo que entra a `esperando-decision` queda agendado
 *    (lib/objetivos.ts `cambiarObjetivo`), y cada reconciliación (leer el objetivo, la lista, el planificador) vuelve a
 *    encolar las decisiones que esperan (`encolarAvisoDecision` es «crear una vez»: repetirlo no duplica).
 *  · Un trabajador lo RECLAMA con compare-and-set (estado `enviando`, un token que solo sube y un reclamo que vence): dos
 *    réplicas a la vez → una sola entrega. Si muere a medias, el reclamo vence y otra lo retoma.
 *  · Antes de cada intento se verifica que la decisión SIGA vigente, sin resolver, en la misma revisión y de la misma
 *    cuenta (`verificarDecision`): si cambió o se resolvió, el aviso se invalida y no sale.
 *  · Fallo pasajero → otro intento con espera exponencial + jitter, hasta MAX_INTENTOS_AVISO (`agotado`). Fallo permanente
 *    (el token del teléfono murió, no hay teléfonos, push sin configurar) → se diagnostica aparte y no se reintenta.
 *  · Al menos una vez: si un trabajador muere entre que FCM aceptó y el cierre, otro puede volver a mandarlo; el teléfono
 *    lo deduplica por el id del aviso (`dec-<decisión>-r<revisión>`, lib/push.ts `datosPushDecision`) y, al abrirlo,
 *    pide el objetivo de ahora (la revisión del aviso no se aplica si ya no es la vigente).
 *  · La `etapa` dice hasta dónde llegó: encolado → reclamado → transporte-aceptado (o invalidado / diagnóstico / agotado /
 *    vencido).
 *
 * Nada del contenido se guarda aquí: la pregunta y las opciones se leen de la decisión al momento de mandar.
 */
import { agendar } from './agenda';
import { almacenDurable, claveDe, crearUnaVez, leerDurable, modificarDurable, PROCESO_DURABLE, type AlmacenDurable } from './durable';
import { esTerminalObjetivo, leerObjetivo } from './objetivos';
import { datosPushDecision, enviarPush, type PushDecision } from './push';
import { esTerminal, leerTarea } from './tareas-durables';

export type EstadoAviso = 'pendiente' | 'enviando' | 'aceptado' | 'invalidado' | 'sin-destino' | 'token-invalido' | 'sin-configurar' | 'agotado' | 'vencido';
export type EtapaAviso = 'encolado' | 'reclamado' | 'transporte-aceptado' | 'invalidado' | 'diagnostico' | 'agotado' | 'vencido';
export type RefAviso = { objetivoId: string; tareaId?: string; decisionId: string; revision: number };

export type AvisoDecision = RefAviso & {
  v: 1;
  id: string;
  destino: 'push';
  estado: EstadoAviso;
  etapa: EtapaAviso;
  intentos: number;
  proximoIntento: number;
  vence: number;
  /** Sube con cada reclamo: el cierre de un trabajador viejo no pisa el de uno nuevo. */
  token: number;
  reclamo?: { titular: string; token: number; hasta: number };
  ultimoError?: string;
  creado: number;
  actualizado: number;
};

export const TERMINALES_AVISO: ReadonlySet<EstadoAviso> = new Set<EstadoAviso>(['aceptado', 'invalidado', 'sin-destino', 'token-invalido', 'sin-configurar', 'agotado', 'vencido']);
export const MAX_INTENTOS_AVISO = 6;
export const ESPERA_BASE_AVISO_MS = 30_000;
export const ESPERA_MAX_AVISO_MS = 3600_000;
export const RECLAMO_AVISO_MS = 2 * 60_000;
export const VIDA_AVISO_MS = 24 * 3600_000;

export const idAviso = (r: Pick<RefAviso, 'decisionId' | 'revision'>) => `${r.decisionId}-r${r.revision}`;
const claveAviso = (correo: string, id: string) => claveDe('avisos/decision', correo, id);

/** Cuánto esperar antes del intento `n` (1, 2, …): exponencial con tope y ±20 % de jitter (`azar` en [0,1)). */
export function esperaAviso(n: number, azar: () => number = Math.random): number {
  const base = Math.min(ESPERA_MAX_AVISO_MS, ESPERA_BASE_AVISO_MS * 2 ** Math.max(0, n - 1));
  return Math.round(base * (0.8 + 0.4 * Math.min(1, Math.max(0, azar()))));
}

/**
 * Deja la intención de avisar (una vez por dueño + decisión + revisión) y su entrada en la agenda. Si ya estaba, devuelve
 * el que había (sin tocarlo). `ok: false` si el almacén no contestó (quien llama lo reintenta: la decisión sigue
 * agendada).
 */
export async function encolarAvisoDecision(correo: string, ref: RefAviso, o: { almacen?: AlmacenDurable; ahora?: number; venceMs?: number } = {}): Promise<{ ok: true; nuevo: boolean; aviso: AvisoDecision } | { ok: false; detalle: string }> {
  const a = o.almacen || almacenDurable();
  const t = o.ahora ?? Date.now();
  const id = idAviso(ref);
  const aviso: AvisoDecision = {
    v: 1,
    id,
    objetivoId: ref.objetivoId,
    ...(ref.tareaId ? { tareaId: ref.tareaId } : {}),
    decisionId: ref.decisionId,
    revision: ref.revision,
    destino: 'push',
    estado: 'pendiente',
    etapa: 'encolado',
    intentos: 0,
    proximoIntento: t,
    vence: t + (o.venceMs ?? VIDA_AVISO_MS),
    token: 0,
    creado: t,
    actualizado: t,
  };
  const r = await crearUnaVez(claveAviso(correo, id), aviso, a).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
  if (r.ok === false) return { ok: false, detalle: r.detalle };
  // La agenda también si ya existía y sigue pendiente (una entrada perdida se repone).
  if (r.creado || !TERMINALES_AVISO.has(r.valor.estado)) await agendar('aviso', correo, id, r.valor.proximoIntento, { almacen: a, ahora: t }).catch(() => false);
  return { ok: true, nuevo: r.creado, aviso: r.valor };
}

export async function leerAvisoDecision(correo: string, id: string, a: AlmacenDurable = almacenDurable()): Promise<AvisoDecision | null | 'incierto'> {
  const l = await leerDurable<AvisoDecision>(claveAviso(correo, id), a).catch(() => null);
  if (!l || l.ok === false) return 'incierto';
  return l.valor;
}

/* ------------------------------------------------------------------ verificar y transportar */

export type Verificacion = { estado: 'vigente'; pedido: PushDecision } | { estado: 'resuelta'; detalle: string } | { estado: 'incierto'; detalle: string };
export type Verificador = (correo: string, ref: RefAviso, a: AlmacenDurable) => Promise<Verificacion>;
/** El transporte: devuelve lo que contestó (ResultadoPush, `{repetido, resultado}` de pedirDecisionPorPush, o nada). */
export type TransporteAviso = (correo: string, p: PushDecision) => Promise<unknown>;

/**
 * ¿La decisión sigue esperando, igual, de esta cuenta? (lo durable, leído ahora). La del objetivo: existe, sin elegir, en
 * la misma revisión, el objetivo no terminó. La de una tarea suya: la tarea es del objetivo, espera aprobación con ESA
 * decisión y en ESA versión. El pedido (pregunta y opciones) sale de ahí, no de lo guardado.
 */
export const verificarDecision: Verificador = async (correo, ref, a) => {
  const o = await leerObjetivo(correo, ref.objetivoId, a).catch(() => ({ ok: false as const, detalle: 'error' }));
  if (o.ok === false) return { estado: 'incierto', detalle: 'no pude leer el objetivo' };
  const obj = o.objetivo;
  if (!obj) return { estado: 'resuelta', detalle: 'el objetivo ya no está (o es de otra cuenta)' };
  if (esTerminalObjetivo(obj.estado)) return { estado: 'resuelta', detalle: 'el objetivo terminó' };
  if (ref.tareaId) {
    if (!obj.tareas.includes(ref.tareaId)) return { estado: 'resuelta', detalle: 'la tarea ya no es de este objetivo' };
    const l = await leerTarea(correo, ref.tareaId, a).catch(() => ({ ok: false as const, detalle: 'error' }));
    if (l.ok === false) return { estado: 'incierto', detalle: 'no pude leer la tarea' };
    const t = l.tarea;
    if (!t || esTerminal(t.estado) || t.estado !== 'awaiting_approval' || !t.decision || t.decision.id !== ref.decisionId || t.version !== ref.revision) return { estado: 'resuelta', detalle: 'la aprobación ya se resolvió o cambió' };
    // Los botones: sin «Editar» (pide texto), lo de riesgo primero, a lo más tres.
    const orden = (id: string) => (id === 'aprobar' || id.startsWith('elegir:') ? 0 : id === 'rechazar' ? 1 : 2);
    const ops = (t.decision.opciones || [])
      .filter((x) => x.id !== 'editar')
      .sort((x, y) => orden(x.id) - orden(y.id))
      .slice(0, 3)
      .map((x) => ({ id: x.id, etiqueta: x.etiqueta }));
    return { estado: 'vigente', pedido: { objetivoId: obj.id, tareaId: t.id, decisionId: t.decision.id, revision: t.version, pregunta: t.decision.pregunta, opciones: ops } };
  }
  const d = obj.decisiones.find((x) => x.id === ref.decisionId);
  if (!d || d.elegida || d.version !== ref.revision) return { estado: 'resuelta', detalle: 'la decisión ya se tomó o cambió' };
  return { estado: 'vigente', pedido: { objetivoId: obj.id, decisionId: d.id, revision: d.version, pregunta: d.pregunta, opciones: d.opciones.map((x) => ({ id: x.id, etiqueta: x.etiqueta })) } };
};

const transportePorOmision: TransporteAviso = (correo, p) => enviarPush(correo, datosPushDecision(p));

type Clase = 'aceptado' | 'token-invalido' | 'sin-destino' | 'sin-configurar' | 'transitorio';

/** Qué fue lo que contestó el transporte. Lo que no dice nada (un doble de pruebas) cuenta como aceptado. */
export function clasificarEntrega(x: unknown): { clase: Clase; detalle?: string } {
  if (x === undefined || x === null) return { clase: 'aceptado' };
  const o = x as Record<string, any>;
  if (o.repetido === true) return { clase: 'aceptado', detalle: 'ya se había aceptado' };
  const r = (o.resultado && typeof o.resultado === 'object' ? o.resultado : o) as Record<string, any>;
  if (typeof r.enviados !== 'number') return { clase: 'aceptado' };
  const detalle = r.detalle ? String(r.detalle).slice(0, 120) : undefined;
  if (r.enviados > 0) return { clase: 'aceptado', detalle };
  if (r.configurado === false || r.entrega === 'sin-configurar') return { clase: 'sin-configurar', detalle };
  const fallidos = Number(r.fallidos) || 0;
  const quitados = Number(r.quitados) || 0;
  // FCM dio por muertos los tokens (se quitaron) y no quedó nada vivo: permanente para este aviso.
  if (fallidos > 0 && quitados >= fallidos) return { clase: 'token-invalido', detalle };
  if (fallidos === 0) return { clase: 'sin-destino', detalle };
  return { clase: 'transitorio', detalle };
}

/* ------------------------------------------------------------------ entregar (el trabajador) */

export type SalidaEntrega = { estado: EstadoAviso | 'ocupado' | 'esperando' | 'no-existe' | 'almacen'; etapa?: EtapaAviso; proximoIntento?: number; detalle?: string };

/**
 * Un intento de entrega de UN aviso (lo usa la reconciliación en línea y el planificador). Reclama, verifica, manda y
 * cierra; nunca lanza. `ocupado`: otro trabajador lo tiene reclamado; `esperando`: todavía no toca.
 */
export async function entregarAviso(
  correo: string,
  id: string,
  o: { transporte?: TransporteAviso; verificar?: Verificador; almacen?: AlmacenDurable; ahora?: number; azar?: () => number; titular?: string } = {}
): Promise<SalidaEntrega> {
  const a = o.almacen || almacenDurable();
  const t = o.ahora ?? Date.now();
  const titular = o.titular || PROCESO_DURABLE;
  const k = claveAviso(correo, id);
  // 1) Reclamar (o cerrar por vencido).
  let salida: SalidaEntrega | null = null;
  let mio = 0;
  let visto: AvisoDecision | null = null;
  const rec = await modificarDurable<AvisoDecision>(
    k,
    (x) => {
      salida = null;
      visto = x;
      if (!x) return void (salida = { estado: 'no-existe' });
      if (TERMINALES_AVISO.has(x.estado)) return void (salida = { estado: x.estado, etapa: x.etapa });
      if (t > x.vence) {
        salida = { estado: 'vencido', etapa: 'vencido' };
        return { ...x, estado: 'vencido', etapa: 'vencido', reclamo: undefined, actualizado: t };
      }
      if (x.estado === 'enviando' && x.reclamo && x.reclamo.hasta > t) return void (salida = { estado: 'ocupado', etapa: x.etapa });
      if (x.estado === 'pendiente' && x.proximoIntento > t) return void (salida = { estado: 'esperando', proximoIntento: x.proximoIntento, etapa: x.etapa });
      mio = x.token + 1;
      return { ...x, estado: 'enviando', etapa: 'reclamado', token: mio, reclamo: { titular, token: mio, hasta: t + RECLAMO_AVISO_MS }, actualizado: t };
    },
    a
  ).catch((e) => ({ ok: false as const, conflicto: false, detalle: String(e?.message || e) }));
  if (rec.ok === false) return { estado: 'almacen', detalle: rec.detalle };
  if (salida) return salida;
  const aviso = visto as unknown as AvisoDecision;

  /** Cierra SOLO si el reclamo sigue siendo el mío (un trabajador viejo no pisa el cierre de otro). */
  const cerrar = async (cambio: Partial<AvisoDecision>): Promise<SalidaEntrega> => {
    let fin: AvisoDecision | null = null;
    const w = await modificarDurable<AvisoDecision>(
      k,
      (x) => {
        fin = x;
        if (!x || x.token !== mio || x.estado !== 'enviando') return undefined;
        fin = { ...x, ...cambio, reclamo: undefined, actualizado: t };
        return fin;
      },
      a
    ).catch(() => null);
    const f = fin as AvisoDecision | null;
    if (!w || w.ok === false || !f) return { estado: 'almacen', detalle: 'no pude cerrar el aviso (lo retoma otro cuando venza el reclamo)' };
    return { estado: f.estado, etapa: f.etapa, ...(f.estado === 'pendiente' ? { proximoIntento: f.proximoIntento } : {}), ...(f.ultimoError ? { detalle: f.ultimoError } : {}) };
  };
  const reintento = (detalle: string, contar: boolean) => {
    const intentos = aviso.intentos + (contar ? 1 : 0);
    if (intentos >= MAX_INTENTOS_AVISO) return cerrar({ estado: 'agotado', etapa: 'agotado', intentos, ultimoError: detalle.slice(0, 160) });
    return cerrar({ estado: 'pendiente', etapa: 'encolado', intentos, proximoIntento: t + esperaAviso(Math.max(1, intentos), o.azar), ultimoError: detalle.slice(0, 160) });
  };

  // 2) ¿Sigue vigente? (misma cuenta: la clave y las lecturas van con su dueño)
  const v = await (o.verificar || verificarDecision)(correo, aviso, a).catch((e) => ({ estado: 'incierto' as const, detalle: String(e?.message || e) }));
  if (v.estado === 'resuelta') return cerrar({ estado: 'invalidado', etapa: 'invalidado', ultimoError: v.detalle });
  if (v.estado === 'incierto') return reintento(v.detalle, true);

  // 3) Mandar y clasificar.
  let respuesta: unknown;
  try {
    respuesta = await (o.transporte || transportePorOmision)(correo, v.pedido);
  } catch (e: any) {
    return reintento(String(e?.message || e), true);
  }
  const c = clasificarEntrega(respuesta);
  const intentos = aviso.intentos + 1;
  if (c.clase === 'aceptado') return cerrar({ estado: 'aceptado', etapa: 'transporte-aceptado', intentos });
  if (c.clase === 'transitorio') return reintento(c.detalle || 'fallo pasajero', true);
  return cerrar({ estado: c.clase, etapa: 'diagnostico', intentos, ultimoError: c.detalle || c.clase });
}
