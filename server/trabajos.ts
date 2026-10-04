/**
 * LAS TAREAS DURABLES EN EL SERVIDOR (AUR08): las rutas del panel de tareas y los ganchos con que el chat
 * crea la tarea ANTES de hacer el trabajo durable y la enlaza desde su respuesta.
 *
 *   GET  /api/trabajos                          → { tareas: TaskSnapshot[], resumen: {trabajando, decisiones} }
 *   GET  /api/trabajos/:id                      → { tarea }
 *   GET  /api/trabajos/:id/eventos?desde=N      → { eventos, cursor, resync, tarea }   (polling con cursor)
 *   POST /api/trabajos {requestId, titulo, objetivo?}                  → { tarea } (201 nueva, 200 la misma)
 *   POST /api/trabajos/:id/decisiones {decisionId, expectedVersion, opcion, hasta?} → { tarea, … }
 *   POST /api/trabajos/:id/pausar | /reanudar | /cancelar             → { tarea, ack } (idempotentes)
 *
 * (`/api/tareas` ya es la lista de pendientes de la junta: no se renombra; lo nuevo va en `/api/trabajos`.)
 *
 * La persona sale SIEMPRE de la sesión firmada (deps.sesionDe); un correo en la consulta o en el cuerpo no
 * cambia de quién son las tareas. Lo que no es suyo es 404, igual que lo que no existe.
 *
 * Qué se lista (sin lista paralela, lib/tareas-durables.ts): las durables del dueño (reconciliadas con lo
 * que dicen su computadora y sus borradores), la tarea en curso de cada conversación (lib/tarea-en-curso.ts,
 * con su id) y las misiones de su computadora que no nacieron de una tarea durable (server/computadora.ts,
 * con su id, solo lectura: se abren en la vista de la computadora).
 *
 * Ganchos del chat (server.ts, en los runners del harness):
 *   · `abrirEncargoComputadora` justo antes de `encargarTarea` (persistir antes de actuar) y
 *     `cerrarEncargoComputadora` con el id de la misión: la tarea queda enlazada y se reconcilia con ella.
 *   · `abrirDecisionDeBorrador` cuando correo/WhatsApp/círculo dejan un borrador: una decisión exacta
 *     (destinatario, cuenta, datos, alcance, caducidad y efecto de cada botón) ligada a su id de intento.
 *   · `cerrarDecisionPorChat` cuando el «sí» o el «no» llegan por el chat (sin doble efecto).
 *   · `enTurnoConTrabajos` alrededor del turno: lo que se creó en él vuelve en la respuesta (`tareas`).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import type express from 'express';
import { almacenDurable, ejecutarUnaVez, hashArgumentos, reservarPedido } from '../lib/durable';
import {
  cambiarTarea,
  crearTarea,
  criteriosCumplidos,
  criteriosDeEncargo,
  deComputadora,
  ENTORNO_INVESTIGACION,
  esInvestigacion,
  deTareaEnCurso,
  ESPACIO_PEDIDOS,
  esTerminal,
  eventosDesde,
  leerTarea,
  listarTareas,
  opcionesAprobacion,
  reconciliarConComputadora,
  reconciliarInvestigacion,
  resumenTareas,
  tareaDePedido,
  transicionValida,
  validarDecision,
  vistaTarea,
  type Cambio,
  type Criterio,
  type Decision,
  type Evidencia,
  type MisionComputadoraMin,
  type OpcionId,
  type Progreso,
  type RegistroTarea,
  type TareaEnCursoMin,
  type TaskSnapshot,
} from '../lib/tareas-durables';

/* ------------------------------------------------------------------ tipos */

/** Lo que enlaza la respuesta del chat: una tarjeta compacta (título, estado, última actualización). */
export type RefTarea = { id: string; title: string; state: TaskSnapshot['state']; version: number; updatedAt: string };

/** Cómo terminó un envío aprobado: `stale` = el borrador ya no era ese (no se envió nada). */
export type SalidaEnvio = { estado: 'succeeded' | 'failed' | 'unknown' | 'stale'; resumen: string; referencia?: string };

export type AccionTareaEnCurso = 'pausar' | 'seguir' | 'descartar' | 'retomar';

export type DepsTrabajos = {
  exigirMesa: express.RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => express.RequestHandler;
  sesionDe: (req: express.Request) => { correo?: string } | null;
  reloj?: () => number;
  /** La tarea en curso de cada conversación (lib/tarea-en-curso.ts). */
  tareaEnCurso?: {
    listar(correo: string): TareaEnCursoMin[];
    accion(correo: string, id: string, accion: AccionTareaEnCurso, version?: number): { ok: true; tarea?: TareaEnCursoMin | null } | { ok: false; motivo: 'no-existe' | 'version'; tarea?: TareaEnCursoMin };
  };
  /** Las misiones de su computadora (server/computadora.ts; solo se lee y se pausa/para). */
  computadora?: {
    misiones(correo: string): MisionComputadoraMin[];
    /** Con el dueño: solo se toca una misión que esté en SU historial. */
    pausar?(correo: string, misionId: string): Promise<unknown>;
    reanudar?(correo: string, misionId: string): Promise<unknown>;
    parar?(correo: string, misionId: string): Promise<unknown>;
  };
  /**
   * Los borradores que esperan su «sí» (server/correo.ts, server/whatsapp.ts). `huella`: la de lo que espera
   * (destinatario o chat, cuenta y contenido); `enviar` recibe la que mostró la tarjeta y solo manda si es esa.
   */
  borradores?: {
    vigente(correo: string, canal: 'correo' | 'whatsapp', ambito: string): { intento: string; huella?: string } | null;
    enviar(correo: string, canal: 'correo' | 'whatsapp', ambito: string, intento: string, huella: string): Promise<SalidaEnvio>;
    descartar(correo: string, canal: 'correo' | 'whatsapp', ambito: string, intento: string): Promise<unknown>;
  };
};

const linea = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
const trozo = (v: unknown, max: number) => {
  const s = linea(v, 10_000);
  return s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
};

function refDe(reg: RegistroTarea): RefTarea {
  return { id: reg.id, title: reg.titulo, state: reg.estado, version: reg.version, updatedAt: new Date(reg.actualizada).toISOString() };
}

/** Una tarea terminada hace más que esto ya no sale en «recientes». */
export const RECIENTES_MS = 3 * 86_400_000;
/** Un envío aprobado en el chat que no confirmó nada en este rato pasa a «no he podido confirmar». */
const ENVIO_SIN_NOTICIA_MS = 2 * 60_000;

/* ------------------------------------------------------------------ el contexto del turno */

export type ContextoTrabajos = { idTurno: string | null; refs: RefTarea[] };
const contexto = new AsyncLocalStorage<ContextoTrabajos>();

export function nuevoContextoTrabajos(idTurno?: string | null): ContextoTrabajos {
  return { idTurno: idTurno && /^[A-Za-z0-9_-]{8,64}$/.test(idTurno) ? idTurno : null, refs: [] };
}

/** Corre el turno con su contexto: las tareas que se creen o cambien dentro quedan en `ctx.refs`. */
export function enTurnoConTrabajos<T>(ctx: ContextoTrabajos, f: () => T): T {
  return contexto.run(ctx, f);
}

function anotar(reg: RegistroTarea | null | undefined) {
  const c = contexto.getStore();
  if (!c || !reg) return;
  const r = refDe(reg);
  const i = c.refs.findIndex((x) => x.id === r.id);
  if (i >= 0) c.refs[i] = r;
  else c.refs.push(r);
}

/**
 * El requestId de lo que el turno crea: por turno (el reintento de la misma frase da la MISMA tarea) y por
 * contenido. Sin id de turno (cliente viejo) no hay reintento que juntar: un id nuevo.
 */
function pedidoDelTurno(tipo: string, clave: string): { requestId: string; turnoId?: string } {
  const c = contexto.getStore();
  if (c?.idTurno) return { requestId: `turno-${c.idTurno}-${tipo}-${hashArgumentos(clave).slice(0, 12)}`, turnoId: c.idTurno };
  return { requestId: `${tipo}-${crypto.randomUUID()}` };
}

const conCorreo = (c: string) => {
  const s = String(c || '').trim().toLowerCase();
  return s.includes('@') ? s : '';
};

/* ------------------------------------------------------------------ ganchos: la computadora */

/**
 * Antes de encargar a su computadora: la tarea durable, ya «running». Si el almacén no contesta se avisa y
 * el encargo sigue como antes (el turno ya dejó registrado su efecto en server/turno-unico.ts).
 */
export async function abrirEncargoComputadora(duenoCorreo: string, ambito: string, instruccion: string, pedidoPersona?: string | null): Promise<RefTarea | null> {
  const dueno = conCorreo(duenoCorreo);
  if (!dueno || !linea(instruccion, 10)) return null;
  const { requestId, turnoId } = pedidoDelTurno('computadora', instruccion);
  try {
    const r = await crearTarea(dueno, {
      requestId,
      titulo: trozo(instruccion, 90),
      objetivo: instruccion,
      estado: 'running',
      entorno: { kind: 'computadora', id: 'pendiente', displayName: 'Tu computadora' },
      pasoActual: 'Se lo encargo a tu computadora',
      // Si pide dejar archivos, un criterio por cosa pedida (cada uno se comprobará con SU archivo); si no, el resultado.
      criterios: criteriosDeEncargo(instruccion, pedidoPersona),
      origen: { kind: 'chat', ...(turnoId ? { turnoId } : {}), conversacion: linea(ambito, 80) },
      condicionParada: 'Termina con resultado, falla, la paras tú, o deja de dar noticias.',
    });
    if (r.ok === false) {
      console.warn('[trabajos] no pude crear la tarea del encargo:', r.detalle.slice(0, 120));
      return null;
    }
    anotar(r.tarea);
    return refDe(r.tarea);
  } catch (e: any) {
    console.warn('[trabajos] no pude crear la tarea del encargo:', String(e?.message || e).slice(0, 120));
    return null;
  }
}

/** Después de encargar: el id de su misión (o el fallo de no haber podido encargarla). */
export async function cerrarEncargoComputadora(duenoCorreo: string, ref: RefTarea | null, r: { misionId: string | null; estado: 'succeeded' | 'failed' | 'unknown'; texto?: string }): Promise<void> {
  const dueno = conCorreo(duenoCorreo);
  if (!dueno || !ref) return;
  const c = await cambiarTarea(dueno, ref.id, (reg): Cambio | null => {
    if (!r.misionId) {
      return {
        estado: 'failed',
        pasoActual: null,
        resultado: { id: `${reg.id}:resultado`, resumen: trozo(r.texto || 'No pude encargárselo a tu computadora.', 300), evidencias: [], parcial: [], pendiente: [], t: Date.now() },
      };
    }
    return {
      enlace: { tipo: 'computadora', id: r.misionId },
      entorno: { ...reg.entorno, id: linea(r.misionId, 80) },
      ...(r.estado === 'succeeded' ? { estado: 'verifying', pasoActual: 'Reviso el resultado de tu computadora' } : { pasoActual: 'Tu computadora sigue trabajando' }),
    };
  }).catch(() => null);
  if (c && c.ok) anotar(c.tarea);
}

/* ------------------------------------------------------------------ ganchos: investigar en segundo plano */

/**
 * Investigar (server/investigar.ts): la tarea durable ANTES de empezar y de contestar, ya «running». El reintento
 * del mismo turno devuelve la MISMA tarea (`nueva: false`): quien llama no arranca otro trabajo. null si el
 * almacén no contesta: entonces NO se empieza (y AURA no dice «empecé»).
 */
export async function abrirInvestigacion(duenoCorreo: string, ambito: string, tema: string, pasos: number, topeMin: number): Promise<{ ref: RefTarea; nueva: boolean } | null> {
  const dueno = conCorreo(duenoCorreo);
  if (!dueno || !linea(tema, 10)) return null;
  const { requestId, turnoId } = pedidoDelTurno('investigar', tema);
  try {
    const r = await crearTarea(dueno, {
      requestId,
      titulo: trozo(`Investigar: ${tema}`, 90),
      objetivo: `Investigar «${trozo(tema, 300)}» en internet y dejarte un resumen con sus fuentes.`,
      estado: 'running',
      entorno: ENTORNO_INVESTIGACION,
      pasoActual: 'Empiezo a buscar',
      progreso: { hechos: 0, total: Math.max(1, pasos), unidad: 'pasos' },
      criterios: [{ id: 'fuentes', texto: 'Un resumen hecho con fuentes que puedes abrir', obligatorio: true }],
      origen: { kind: 'chat', ...(turnoId ? { turnoId } : {}), conversacion: linea(ambito, 80) },
      condicionParada: `Termina con un resumen y sus fuentes, no encuentra nada, la cancelas tú, o se acaba su tiempo (${topeMin} minutos).`,
    });
    if (r.ok === false) {
      console.warn('[trabajos] no pude crear la tarea de la investigación:', r.detalle.slice(0, 120));
      return null;
    }
    anotar(r.tarea);
    return { ref: refDe(r.tarea), nueva: r.creada && !esTerminal(r.tarea.estado) };
  } catch (e: any) {
    console.warn('[trabajos] no pude crear la tarea de la investigación:', String(e?.message || e).slice(0, 120));
    return null;
  }
}

/**
 * Un paso de la investigación (su latido): `sigue`, `cerrada` (ya es terminal: la cancelaste desde el panel) o
 * `error` (el almacén no contestó: se sigue, el cierre lo vuelve a intentar).
 */
export async function avanzarInvestigacion(duenoCorreo: string, id: string, paso: string, progreso: Progreso): Promise<'sigue' | 'cerrada' | 'error'> {
  const dueno = conCorreo(duenoCorreo);
  if (!dueno) return 'error';
  let terminal = false;
  const c = await cambiarTarea(dueno, id, (reg) => {
    // Ya terminal (la cancelaste desde el panel): no se toca, y quien trabaja deja de hacerlo.
    if (esTerminal(reg.estado)) {
      terminal = true;
      return null;
    }
    return esInvestigacion(reg) ? { pasoActual: paso, progreso } : null;
  }).catch(() => null);
  if (terminal || (c && c.ok === false && c.motivo === 'terminal')) return 'cerrada';
  return c && c.ok ? 'sigue' : 'error';
}

export type CierreInvestigacion = {
  estado: 'completed' | 'partial' | 'failed';
  resumen: string;
  fuentes: { titulo: string; url: string }[];
  parcial?: string[];
  pendiente?: string[];
};

/**
 * Cierra la investigación con lo que de verdad quedó: `completed` solo con resumen y al menos una fuente (la
 * evidencia de su criterio); sin fuentes, `partial`. Devuelve la tarea cerrada, o `cerrada` si ya era terminal
 * (la cancelaste: no se le avisa nada), o null si el almacén no contestó.
 */
export async function cerrarInvestigacion(duenoCorreo: string, id: string, r: CierreInvestigacion): Promise<RefTarea | 'cerrada' | null> {
  const dueno = conCorreo(duenoCorreo);
  if (!dueno) return null;
  const ahora = Date.now();
  const evidencias: Evidencia[] = r.fuentes.slice(0, 8).map((f, i) => ({ id: `${id}:fuente:${i}`, tipo: 'enlace', etiqueta: trozo(f.titulo || f.url, 120), ref: String(f.url).slice(0, 500) }));
  const estado = r.estado === 'completed' && !evidencias.length ? 'partial' : r.estado;
  const c = await cambiarTarea(dueno, id, (reg): Cambio | null => {
    if (!esInvestigacion(reg)) return null;
    // Las fuentes prueban SU criterio («fuentes»); otro criterio obligatorio que no prueban no se da por cumplido.
    const criterios =
      estado === 'completed' ? soloSuCriterio(reg.criterios, 'fuentes', evidencias) : reg.criterios.map((x) => (x.obligatorio ? { ...x, estado: 'not_met' as const, evidencias: [] } : x));
    const final = estado === 'completed' && !criteriosCumplidos(criterios, evidencias) ? 'partial' : estado;
    return {
      estado: final,
      pasoActual: null,
      ...(reg.progreso ? { progreso: { ...reg.progreso, hechos: reg.progreso.total } } : {}),
      criterios,
      resultado: {
        id: `${reg.id}:resultado`,
        resumen: trozo(r.resumen, 1800),
        evidencias,
        parcial: (r.parcial || []).map((x) => trozo(x, 200)).slice(0, 4),
        pendiente: (r.pendiente || []).map((x) => trozo(x, 200)).slice(0, 4),
        t: ahora,
      },
      eventos: [{ type: 'operation.receipt', payload: { operationId: reg.id, state: final === 'failed' ? 'failed' : 'succeeded', effect: 'none', fuentes: evidencias.length } }],
    };
  }).catch(() => null);
  if (!c) return null;
  if (c.ok) {
    anotar(c.tarea);
    return refDe(c.tarea);
  }
  return c.motivo === 'terminal' ? 'cerrada' : null;
}

/* ------------------------------------------------------------------ ganchos: los borradores */

/**
 * `huella`: la del borrador (server/correo.ts huellaCorreo, server/whatsapp.ts huellaWhatsapp: destinatario o chat exacto,
 * cuenta y contenido). Es el vínculo de la decisión: «Aprobar» manda solo un borrador con ESA huella (revisión 4-oct).
 */
export type BorradorParaDecidir = { canal: 'correo' | 'whatsapp'; intento: string; para: string[] | string; desde?: string; asunto?: string; texto: string; vence: number; huella?: string };

function decisionDeBorrador(ambito: string, b: BorradorParaDecidir, planVersion: number, ahora: number): Decision {
  const destinatario = trozo(Array.isArray(b.para) ? b.para.join(', ') : b.para, 160) || 'sin destinatario';
  const accion = b.canal === 'correo' ? 'Enviar este correo' : 'Enviar este WhatsApp';
  return {
    id: `dc_${ahora.toString(36)}${crypto.randomBytes(4).toString('hex')}`,
    tipo: 'aprobar-accion',
    pregunta: b.canal === 'correo' ? `¿Envío este correo a ${destinatario}?` : `¿Envío este WhatsApp a ${destinatario}?`,
    porque: 'Sale a otra persona en tu nombre: nunca lo envío sin tu aprobación de esta versión exacta.',
    propuesta: {
      accion,
      cuenta: b.canal === 'correo' ? linea(b.desde, 120) || 'Tu correo' : 'Tu WhatsApp',
      destinatario,
      datos: [b.asunto ? `Asunto: «${trozo(b.asunto, 140)}»` : '', `Texto: «${trozo(b.texto, 400)}»`].filter(Boolean),
      alcance: 'Solo este mensaje, una vez y sin cambios. No autoriza envíos futuros.',
    },
    opciones: opcionesAprobacion(accion, destinatario),
    creada: ahora,
    caduca: b.vence,
    planVersion,
    // Sin la huella del borrador, un hash propio que nunca coincide con uno guardado: «Aprobar» no manda a ciegas.
    vinculo: { tipo: 'borrador', canal: b.canal, ambito: linea(ambito, 80), intento: b.intento, hash: b.huella || `sin-huella:${hashArgumentos({ canal: b.canal, para: b.para, desde: b.desde || '', asunto: b.asunto || '', texto: b.texto })}` },
  };
}

/**
 * Un borrador quedó esperando su «sí»: la tarea con su decisión exacta. Una vez por borrador (su id de
 * intento). Si esa conversación tenía una tarea esperando cambios («Editar»), la nueva propuesta vuelve a
 * ESA tarea con otra versión del plan.
 */
export async function abrirDecisionDeBorrador(duenoCorreo: string, ambito: string, b: BorradorParaDecidir): Promise<RefTarea | null> {
  const dueno = conCorreo(duenoCorreo);
  if (!dueno || !b.intento) return null;
  const requestId = `borrador-${b.intento}`;
  const ahora = Date.now();
  try {
    const ya = await tareaDePedido(dueno, requestId);
    if (ya) {
      const l = await leerTarea(dueno, ya);
      if (l.ok && l.tarea) {
        anotar(l.tarea);
        return refDe(l.tarea);
      }
    }
    const amb = linea(ambito, 80);
    const lista = await listarTareas(dueno);
    const editando = lista.ok
      ? lista.tareas.find((t) => t.estado === 'waiting_resource' && t.entorno.kind === b.canal && t.origen.conversacion === amb && t.resueltas.at(-1)?.opcion === 'editar')
      : undefined;
    if (editando) {
      const r = await reservarPedido({ espacio: ESPACIO_PEDIDOS, dueno, requestId, propuesto: editando.id });
      if (r.ok && r.id === editando.id) {
        const c = await cambiarTarea(dueno, editando.id, (reg) => (reg.estado !== 'waiting_resource' ? null : { estado: 'awaiting_approval', pasoActual: 'Esperando tu decisión sobre la nueva propuesta', planVersion: reg.planVersion + 1, decision: decisionDeBorrador(amb, b, reg.planVersion + 1, ahora) }));
        if (c.ok) {
          anotar(c.tarea);
          return refDe(c.tarea);
        }
      }
    }
    const destinatario = trozo(Array.isArray(b.para) ? b.para.join(', ') : b.para, 80);
    const r = await crearTarea(dueno, {
      requestId,
      titulo: b.canal === 'correo' ? `Correo para ${destinatario}${b.asunto ? ` — ${trozo(b.asunto, 50)}` : ''}` : `WhatsApp para ${destinatario}`,
      objetivo: b.canal === 'correo' ? `Enviar el correo «${trozo(b.asunto || 'sin asunto', 80)}» a ${destinatario} si lo apruebas` : `Enviar el mensaje a ${destinatario} si lo apruebas`,
      estado: 'awaiting_approval',
      entorno: { kind: b.canal, id: amb, displayName: b.canal === 'correo' ? linea(b.desde, 80) || 'Tu correo' : 'Tu WhatsApp' },
      pasoActual: 'Esperando tu decisión',
      criterios: [{ id: 'envio', texto: 'El proveedor confirma el envío a ese destinatario', obligatorio: true }],
      decision: decisionDeBorrador(amb, b, 1, ahora),
      origen: { kind: 'chat', ...(contexto.getStore()?.idTurno ? { turnoId: contexto.getStore()!.idTurno! } : {}), conversacion: amb },
      condicionParada: 'Lo apruebas y el proveedor responde, lo rechazas, o la propuesta caduca.',
    });
    if (r.ok === false) {
      console.warn('[trabajos] no pude crear la tarea del borrador:', r.detalle.slice(0, 120));
      return null;
    }
    anotar(r.tarea);
    return refDe(r.tarea);
  } catch (e: any) {
    console.warn('[trabajos] no pude crear la tarea del borrador:', String(e?.message || e).slice(0, 120));
    return null;
  }
}

/**
 * Lo que devolvió el servidor al mandar un borrador (server/correo.ts `decidirBorrador`): solo sus prefijos
 * FIJOS cuentan como éxito o fallo; cualquier otra cosa (el «se manda en cuanto termine» de la voz, un texto
 * nuevo) es incierta y se reconcilia, nunca se da por enviada.
 */
export function clasificarEnvio(hecho: string | null | undefined): 'succeeded' | 'failed' | 'unknown' {
  const t = String(hecho || '').trim();
  if (/^(CORREO|WHATSAPP) ENVIADO\b/.test(t)) return 'succeeded';
  if (/^(CORREO|WHATSAPP): (NO se mandó|NO se pudo mandar|no lo mandé|no se mandó)/i.test(t)) return 'failed';
  return 'unknown';
}

function evidenciaDeEnvio(id: string, resumen: string, referencia?: string): Evidencia[] {
  return [{ id: `${id}:recibo`, tipo: 'recibo', etiqueta: trozo(resumen, 200), ...(referencia ? { ref: trozo(referencia, 200) } : {}) }];
}

/**
 * La evidencia va a SU criterio (`id`): ese queda verificado con ella; cualquier otro obligatorio que esta evidencia no
 * prueba queda «sin comprobar» (nunca se copia la misma lista a todos los criterios). Los opcionales, como estaban.
 */
function soloSuCriterio(criterios: Criterio[], id: string, ev: Evidencia[]): Criterio[] {
  return criterios.map((c) => (c.id === id ? { ...c, estado: ev.length ? 'verified' : 'not_met', evidencias: ev.map((e) => e.id) } : c.obligatorio ? { ...c, estado: c.estado === 'verified' ? 'verified' : 'unknown', evidencias: c.estado === 'verified' ? c.evidencias : [] } : c));
}

/** El cambio que deja un envío terminado (por el panel o por el chat). */
function cambioDeEnvio(reg: RegistroTarea, estado: 'succeeded' | 'failed' | 'unknown' | 'stale', resumen: string, operacion: string, referencia?: string): Cambio {
  const ahora = Date.now();
  if (estado === 'succeeded') {
    const ev = evidenciaDeEnvio(operacion, resumen, referencia);
    // El recibo del proveedor prueba el ENVÍO (su criterio), no cualquier otro criterio que la tarea tuviera.
    const criterios = soloSuCriterio(reg.criterios, 'envio', ev);
    const todo = criteriosCumplidos(criterios, ev);
    return {
      estado: todo ? 'completed' : 'partial',
      pasoActual: null,
      criterios,
      resultado: { id: `${reg.id}:resultado`, resumen: trozo(resumen, 300), evidencias: ev, parcial: todo ? [] : ['El envío se confirmó; lo demás que pedía esta tarea no se pudo comprobar con ese recibo.'], pendiente: [], t: ahora },
      eventos: [{ type: 'operation.receipt', payload: { operationId: operacion, state: 'succeeded', effect: 'confirmed' } }],
    };
  }
  if (estado === 'unknown') {
    return {
      estado: 'reconciling',
      pasoActual: 'No he podido confirmar el envío. Lo reviso antes de intentarlo de nuevo; no lo repito a ciegas.',
      eventos: [{ type: 'operation.receipt', payload: { operationId: operacion, state: 'unknown', effect: 'possible' } }],
    };
  }
  return {
    estado: 'failed',
    pasoActual: null,
    criterios: reg.criterios.map((c) => ({ ...c, estado: 'not_met', evidencias: [] })),
    resultado: { id: `${reg.id}:resultado`, resumen: trozo(estado === 'stale' ? 'No se envió: el borrador ya no era el que aprobaste.' : resumen, 300), evidencias: [], parcial: [], pendiente: [], t: ahora },
    eventos: [{ type: 'operation.receipt', payload: { operationId: operacion, state: 'failed', effect: 'none' } }],
  };
}

/**
 * El «sí» o el «no» al borrador llegó por el chat (server.ts, al empezar el turno): la decisión se cierra
 * con lo que pasó, para que el panel no la ofrezca otra vez. `respuesta` null: siguió con otra cosa; el
 * borrador sigue esperando en el panel hasta que venza (AUR08), así que la decisión queda abierta.
 */
export async function cerrarDecisionPorChat(duenoCorreo: string, intento: string, respuesta: 'si' | 'no' | null, hecho: string | null): Promise<void> {
  const dueno = conCorreo(duenoCorreo);
  if (!dueno || !intento || respuesta === null) return;
  const id = await tareaDePedido(dueno, `borrador-${intento}`).catch(() => null);
  if (!id) return;
  const ahora = Date.now();
  const c = await cambiarTarea(dueno, id, (reg): Cambio | null => {
    const d = reg.decision;
    if (esTerminal(reg.estado) || !d || d.vinculo?.tipo !== 'borrador' || d.vinculo.intento !== intento) return null;
    const operacion = `chat:${d.id}`;
    if (respuesta === 'si') {
      const estado = clasificarEnvio(hecho);
      const base = cambioDeEnvio(reg, estado, String(hecho || ''), operacion);
      // En la voz el envío sale al confirmarse el turno: queda «running» hasta saberlo (o se reconcilia).
      const enCamino: Cambio = { estado: 'running', pasoActual: 'Lo aprobaste en el chat; lo estoy enviando.' };
      return { ...(estado === 'unknown' ? enCamino : base), decision: null, resolver: { id: d.id, opcion: 'aprobar', t: ahora, operacion } };
    }
    return {
      estado: 'cancelled',
      pasoActual: null,
      decision: null,
      ...(respuesta === 'no' ? { resolver: { id: d.id, opcion: 'rechazar' as OpcionId, t: ahora } } : {}),
      resultado: { id: `${reg.id}:resultado`, resumen: 'No se envió: lo rechazaste en el chat.', evidencias: [], parcial: [], pendiente: [], t: ahora },
    };
  }).catch(() => null);
  if (c && c.ok) anotar(c.tarea);
}

/* ------------------------------------------------------------------ reconciliar al leer */

/**
 * Lleva una tarea durable a lo que dicen sus fuentes (su computadora, el borrador) y guarda solo si cambió.
 * Nunca lanza: si no se pudo, devuelve la que había.
 */
async function reconciliar(dueno: string, reg: RegistroTarea, d: DepsTrabajos, ahora: number): Promise<RegistroTarea> {
  if (esTerminal(reg.estado)) return reg;
  const misiones = reg.enlace?.tipo === 'computadora' && d.computadora ? d.computadora.misiones(dueno) : null;
  const vigente = (canal: 'correo' | 'whatsapp', ambito: string) => (d.borradores ? d.borradores.vigente(dueno, canal, ambito) : undefined);
  const r = await cambiarTarea(
    dueno,
    reg.id,
    (x): Cambio | null => {
      // Una investigación que nadie trabaja ya (el proceso se reinició): se cierra con la verdad.
      if (esInvestigacion(x)) return reconciliarInvestigacion(x, ahora);
      if (x.enlace?.tipo === 'computadora' && misiones) {
        const id = x.enlace.id;
        return reconciliarConComputadora(x, misiones.find((m) => m.id === id || m.tareaId === id) ?? null, ahora);
      }
      const dec = x.decision;
      if (x.estado === 'awaiting_approval' && dec?.vinculo?.tipo === 'borrador') {
        if (dec.caduca && ahora > dec.caduca) return { estado: 'blocked', pasoActual: 'La propuesta caducó sin enviarse. Si aún lo quieres, pide un borrador nuevo.' };
        const v = vigente(dec.vinculo.canal, dec.vinculo.ambito);
        if (v !== undefined && (v?.intento !== dec.vinculo.intento || !v.huella || v.huella !== dec.vinculo.hash)) {
          return {
            estado: 'blocked',
            pasoActual: 'El borrador ya no está esperando (se resolvió en otro lado o el servidor se reinició). No se envió nada desde aquí.',
            decision: { ...dec, caduca: Math.min(dec.caduca ?? ahora, ahora - 1) },
          };
        }
      }
      if (x.estado === 'running' && x.resueltas.at(-1)?.operacion?.startsWith('chat:') && ahora - x.actualizada > ENVIO_SIN_NOTICIA_MS) {
        return { estado: 'reconciling', pasoActual: 'No he podido confirmar el envío. Mira tus enviados antes de repetirlo; no lo reenvío a ciegas.' };
      }
      return null;
    },
    { ahora }
  ).catch(() => null);
  return r && r.ok ? r.tarea : reg;
}

/* ------------------------------------------------------------------ rutas */

type Encontrada = { tipo: 'durable'; reg: RegistroTarea } | { tipo: 'tc'; t: TareaEnCursoMin } | { tipo: 'pc'; m: MisionComputadoraMin } | { tipo: 'no' } | { tipo: 'almacen' };

function sinSesion(res: express.Response) {
  return res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });
}
const noEsta = (res: express.Response) => res.status(404).json({ error: 'No encuentro esa tarea.', honesto: true });
const almacenCaido = (res: express.Response) => res.status(503).json({ error: 'No pude leer tus tareas en este momento. Prueba otra vez en un rato.', code: 'almacen_no_disponible', honesto: true });

const ID_VALIDO = /^[A-Za-z0-9_:.-]{3,96}$/;

export function montarRutasTrabajos(app: express.Express, d: DepsTrabajos) {
  const ahora = () => (d.reloj ? d.reloj() : Date.now());
  const correoDe = (req: express.Request) => conCorreo(String(d.sesionDe(req)?.correo || ''));
  /**
   * Sin sesión, 401 (la app renueva o pide entrar). Con sesión pero sin correo (no hay de quién serían las
   * tareas), 403: un 401 ahí haría que la app intentara renovar la sesión en cada sondeo.
   */
  const sinDueno = (req: express.Request, res: express.Response) =>
    d.sesionDe(req) ? res.status(403).json({ error: 'Tus tareas van con tu cuenta de correo.', code: 'sin_correo', honesto: true }) : sinSesion(res);

  /** `conReconciliar: false` para decidir: se valida contra lo que vio la persona, no contra un cambio de ahora. */
  async function buscar(dueno: string, id: string, conReconciliar = true): Promise<Encontrada> {
    if (!ID_VALIDO.test(id)) return { tipo: 'no' };
    const l = await leerTarea(dueno, id).catch(() => ({ ok: false as const, detalle: '' }));
    if (l.ok === false) return { tipo: 'almacen' };
    if (l.tarea) return { tipo: 'durable', reg: conReconciliar ? await reconciliar(dueno, l.tarea, d, ahora()) : l.tarea };
    const t = d.tareaEnCurso?.listar(dueno).find((x) => x.id === id);
    if (t) return { tipo: 'tc', t };
    const m = d.computadora?.misiones(dueno).find((x) => x.id === id);
    if (m) return { tipo: 'pc', m };
    return { tipo: 'no' };
  }

  const vista = (e: Encontrada): TaskSnapshot | null => (e.tipo === 'durable' ? vistaTarea(e.reg, ahora()) : e.tipo === 'tc' ? deTareaEnCurso(e.t) : e.tipo === 'pc' ? deComputadora(e.m, ahora()) : null);

  app.get('/api/trabajos', d.exigirMesa, d.limitar(90), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    res.setHeader('Cache-Control', 'no-store');
    const t = ahora();
    const l = await listarTareas(dueno).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
    if (l.ok === false) return almacenCaido(res);
    const durables = await Promise.all(l.tareas.filter((x) => !esTerminal(x.estado) || t - x.actualizada < RECIENTES_MS).map((x) => reconciliar(dueno, x, d, t)));
    const enlazadas = new Set(durables.flatMap((x) => (x.enlace?.tipo === 'computadora' ? [x.enlace.id] : [])));
    const tareas: TaskSnapshot[] = [
      ...durables.map((x) => vistaTarea(x, t)),
      ...(d.tareaEnCurso?.listar(dueno) || []).map(deTareaEnCurso),
      ...(d.computadora?.misiones(dueno) || []).filter((m) => !enlazadas.has(m.id) && !enlazadas.has(m.tareaId)).map((m) => deComputadora(m, t)),
    ].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return res.json({ tareas, resumen: resumenTareas(tareas, t), generado: new Date(t).toISOString(), honesto: true });
  });

  app.get('/api/trabajos/:id', d.exigirMesa, d.limitar(120), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    res.setHeader('Cache-Control', 'no-store');
    const e = await buscar(dueno, String(req.params.id || ''));
    if (e.tipo === 'almacen') return almacenCaido(res);
    const v = vista(e);
    return v ? res.json({ tarea: v, honesto: true }) : noEsta(res);
  });

  app.get('/api/trabajos/:id/eventos', d.exigirMesa, d.limitar(120), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    res.setHeader('Cache-Control', 'no-store');
    const e = await buscar(dueno, String(req.params.id || ''));
    if (e.tipo === 'almacen') return almacenCaido(res);
    const v = vista(e);
    if (!v) return noEsta(res);
    if (e.tipo !== 'durable') return res.json({ eventos: [], cursor: 0, resync: true, tarea: v, honesto: true });
    const desde = Math.max(0, Math.floor(Number(req.query.desde) || 0));
    const ev = eventosDesde(e.reg, desde);
    return res.json({ ...ev, tarea: v, honesto: true });
  });

  /** POST /tasks de la sección 17: crear una vez por requestId de la sesión. */
  app.post('/api/trabajos', d.exigirMesa, d.limitar(30), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    const b = (req.body || {}) as Record<string, unknown>;
    const requestId = String(b.requestId || '');
    const titulo = linea(b.titulo, 100);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) return res.status(400).json({ error: 'Falta el requestId (8 a 64 letras, números, - o _).', honesto: true });
    if (titulo.length < 3) return res.status(400).json({ error: 'La tarea necesita un título.', honesto: true });
    const r = await crearTarea(dueno, {
      requestId: `api-${requestId}`,
      titulo,
      objetivo: linea(b.objetivo, 400) || titulo,
      estado: 'queued',
      entorno: { kind: 'chat', id: 'api', displayName: 'AURA' },
      origen: { kind: 'api' },
    }).catch((e) => ({ ok: false as const, motivo: 'almacen' as const, detalle: String(e?.message || e) }));
    if (r.ok === false) return r.motivo === 'almacen' ? almacenCaido(res) : res.status(400).json({ error: r.detalle, honesto: true });
    return res.status(r.creada ? 201 : 200).json({ tarea: vistaTarea(r.tarea, ahora()), creada: r.creada, honesto: true });
  });

  /* ---------------------------------------------------------------- decidir */

  app.post('/api/trabajos/:id/decisiones', d.exigirMesa, d.limitar(30), async (req, res) => {
    const dueno = correoDe(req);
    if (!dueno) return sinDueno(req, res);
    const b = (req.body || {}) as Record<string, unknown>;
    const pedido = { decisionId: String(b.decisionId || ''), expectedVersion: Number(b.expectedVersion), opcion: String(b.opcion || '') };
    if (!pedido.decisionId || !Number.isFinite(pedido.expectedVersion) || !pedido.opcion) return res.status(400).json({ error: 'Faltan decisionId, expectedVersion u opcion.', honesto: true });
    let hasta: number | null = null;
    if (b.hasta !== undefined && b.hasta !== null && b.hasta !== '') {
      const h = typeof b.hasta === 'number' ? b.hasta : Date.parse(String(b.hasta));
      if (!Number.isFinite(h) || h <= ahora()) return res.status(400).json({ error: 'La fecha para posponer tiene que ser futura.', honesto: true });
      hasta = h;
    }
    const e = await buscar(dueno, String(req.params.id || ''), false);
    if (e.tipo === 'almacen') return almacenCaido(res);
    if (e.tipo === 'no') return noEsta(res);
    if (e.tipo === 'pc') return res.status(409).json({ error: 'Esa decisión se toma en la vista de tu computadora.', codigo: 'abrir-computadora', tarea: vista(e), honesto: true });
    if (e.tipo === 'tc') return decidirTareaEnCurso(res, dueno, e.t, pedido);

    const t0 = ahora();
    const v = validarDecision(e.reg, pedido, t0);
    if (v.ok === false) return res.status(v.codigo === 'opcion' ? 400 : 409).json({ error: v.mensaje, codigo: v.codigo, tarea: vistaTarea(e.reg, t0), honesto: true });
    if ('repetida' in v) return res.json({ tarea: vistaTarea(e.reg, t0), repetida: true, honesto: true });
    const { opcion, decision } = v;
    const resolver = { id: decision.id, opcion: opcion.id, t: t0 };
    const vinc = decision.vinculo?.tipo === 'borrador' ? decision.vinculo : null;

    /** CAS con la versión que vio la persona. Si otro ganó con la misma decisión: repetida (sin efecto nuevo). */
    const aplicar = async (c: Cambio) => {
      const r = await cambiarTarea(dueno, e.reg.id, () => c, { expectedVersion: pedido.expectedVersion, ahora: t0 });
      if (r.ok === true) return { ok: true as const, reg: r.tarea };
      if (r.motivo === 'almacen') return { ok: false as const, resp: () => almacenCaido(res) };
      const actual = r.tarea;
      const rep = actual?.resueltas.find((x) => x.id === decision.id && x.opcion === opcion.id);
      if (actual && rep) return { ok: false as const, resp: () => res.json({ tarea: vistaTarea(actual, ahora()), repetida: true, honesto: true }) };
      return { ok: false as const, resp: () => res.status(409).json({ error: 'La tarea cambió mientras decidías. Mira cómo quedó.', codigo: r.motivo, tarea: actual ? vistaTarea(actual, ahora()) : null, honesto: true }) };
    };

    if (opcion.id === 'posponer') {
      const r = await aplicar({ decision: { ...decision, pospuesta: hasta === null, pospuestaHasta: hasta } });
      if (!r.ok) return r.resp();
      return res.json({ tarea: vistaTarea(r.reg, ahora()), honesto: true });
    }

    if (opcion.id === 'rechazar') {
      const r = await aplicar({
        resolver,
        decision: null,
        estado: 'cancelled',
        pasoActual: null,
        resultado: { id: `${e.reg.id}:resultado`, resumen: vinc ? 'No se envió: lo rechazaste. Queda constancia.' : 'Rechazada: no se hizo. Queda constancia.', evidencias: [], parcial: [], pendiente: [], t: t0 },
      });
      if (!r.ok) return r.resp();
      if (vinc && d.borradores?.vigente(dueno, vinc.canal, vinc.ambito)?.intento === vinc.intento) await d.borradores.descartar(dueno, vinc.canal, vinc.ambito, vinc.intento).catch(() => undefined);
      anotar(r.reg);
      return res.json({ tarea: vistaTarea(r.reg, ahora()), honesto: true });
    }

    if (opcion.id === 'editar') {
      const r = await aplicar({ resolver, decision: null, estado: 'waiting_resource', pasoActual: 'Dime en el chat qué cambio; preparo una propuesta nueva. Esta ya no vale.' });
      if (!r.ok) return r.resp();
      // Editar invalida el vínculo anterior: el borrador viejo se descarta (un «sí» en el chat ya no lo manda).
      if (vinc && d.borradores?.vigente(dueno, vinc.canal, vinc.ambito)?.intento === vinc.intento) await d.borradores.descartar(dueno, vinc.canal, vinc.ambito, vinc.intento).catch(() => undefined);
      const para = decision.propuesta.destinatario || '';
      const sugerencia = vinc ? (vinc.canal === 'correo' ? `Cambia el correo para ${para}: ` : `Cambia el WhatsApp para ${para}: `) : 'Cambia la propuesta: ';
      return res.json({ tarea: vistaTarea(r.reg, ahora()), sugerencia, honesto: true });
    }

    // aprobar (o elegir): con vínculo de borrador, se ejecuta exactamente lo aprobado, una vez.
    if (!vinc) {
      const r = await aplicar({ resolver, decision: null, estado: 'running', pasoActual: `Elegiste: ${opcion.etiqueta}` });
      if (!r.ok) return r.resp();
      return res.json({ tarea: vistaTarea(r.reg, ahora()), honesto: true });
    }
    if (!d.borradores) return res.status(503).json({ error: 'Ahora no puedo enviar desde aquí.', honesto: true });
    // Justo antes del efecto: ¿el borrador que espera es EXACTAMENTE el aprobado? (invariante 4) El mismo intento y la
    // misma huella (destinatario, cuenta y contenido): una aprobación para Ana no manda a Bruno. Sin huella del que
    // espera no hay con qué compararlo: se bloquea (permisos exactos, 4-oct; antes, sin huella, pasaba).
    const espera = d.borradores.vigente(dueno, vinc.canal, vinc.ambito);
    if (espera?.intento !== vinc.intento || !espera.huella || espera.huella !== vinc.hash) {
      const fresca = await reconciliar(dueno, e.reg, d, ahora());
      return res.status(409).json({ error: 'Esa propuesta ya no es la que espera: no envié nada. Mira la actual o pide una nueva.', codigo: 'propuesta-cambiada', tarea: vistaTarea(fresca, ahora()), honesto: true });
    }
    const operacion = `tarea-${e.reg.id}-${decision.id}`;
    const r = await aplicar({ resolver: { ...resolver, operacion }, decision: null, estado: 'running', pasoActual: 'Enviando lo que aprobaste…' });
    if (!r.ok) return r.resp();
    const salida = await ejecutarUnaVez<SalidaEnvio>({ dueno, requestId: operacion, tipo: `${vinc.canal}.enviar`, argsHash: vinc.hash }, async () => {
      const s = await d.borradores!.enviar(dueno, vinc.canal, vinc.ambito, vinc.intento, vinc.hash);
      const estado = s.estado === 'stale' ? 'failed' : s.estado;
      return { estado, resultado: s, recibo: { efecto: estado === 'succeeded' ? 'confirmed' : estado === 'unknown' ? 'possible' : 'none', proveedor: vinc.canal, ...(s.referencia ? { referencia: s.referencia } : {}), detalle: trozo(s.resumen, 160) } };
    });
    const s: SalidaEnvio = salida.corrio && salida.resultado ? salida.resultado : { estado: 'unknown', resumen: 'No supe cómo terminó el envío.' };
    const fin = await cambiarTarea(dueno, e.reg.id, (reg) => cambioDeEnvio(reg, s.estado, s.resumen, operacion, s.referencia)).catch(() => null);
    const reg = fin && fin.ok ? fin.tarea : r.reg;
    anotar(reg);
    return res.json({ tarea: vistaTarea(reg, ahora()), operacion, honesto: true });
  });

  function decidirTareaEnCurso(res: express.Response, dueno: string, t: TareaEnCursoMin, p: { decisionId: string; expectedVersion: number; opcion: string }) {
    const s = deTareaEnCurso(t);
    if (!s.decision) return res.status(409).json({ error: 'Esta tarea no espera ninguna decisión ahora.', codigo: 'sin-decision', tarea: s, honesto: true });
    if (s.decision.id !== p.decisionId) return res.status(409).json({ error: 'Esa pregunta ya cambió.', codigo: 'decision-vieja', tarea: s, honesto: true });
    if (s.version !== p.expectedVersion) return res.status(409).json({ error: 'La tarea cambió mientras decidías.', codigo: 'version', tarea: s, honesto: true });
    const mapa: Record<string, AccionTareaEnCurso> = { posponer: 'pausar', 'elegir:seguir': 'seguir', rechazar: 'descartar' };
    const accion = s.decision.options.some((o) => o.id === p.opcion) ? mapa[p.opcion] : undefined;
    if (!accion) return res.status(400).json({ error: 'Esa opción no se ofreció en esta decisión.', codigo: 'opcion', tarea: s, honesto: true });
    const r = d.tareaEnCurso!.accion(dueno, t.id, accion, p.expectedVersion);
    if (r.ok === false) return r.motivo === 'version' ? res.status(409).json({ error: 'La tarea cambió mientras decidías.', codigo: 'version', tarea: r.tarea ? deTareaEnCurso(r.tarea) : null, honesto: true }) : noEsta(res);
    return res.json({ tarea: r.tarea ? deTareaEnCurso(r.tarea) : null, cerrada: !r.tarea, honesto: true });
  }

  /* ---------------------------------------------------------------- pausar, reanudar, cancelar */

  type Control = 'pausar' | 'reanudar' | 'cancelar';
  const controlTc: Record<Control, AccionTareaEnCurso> = { pausar: 'pausar', reanudar: 'retomar', cancelar: 'descartar' };

  for (const control of ['pausar', 'reanudar', 'cancelar'] as Control[]) {
    app.post(`/api/trabajos/:id/${control}`, d.exigirMesa, d.limitar(30), async (req, res) => {
      const dueno = correoDe(req);
      if (!dueno) return sinDueno(req, res);
      const e = await buscar(dueno, String(req.params.id || ''));
      if (e.tipo === 'almacen') return almacenCaido(res);
      if (e.tipo === 'no') return noEsta(res);
      if (e.tipo === 'pc') return res.status(409).json({ error: 'Esa se controla en la vista de tu computadora.', codigo: 'abrir-computadora', tarea: vista(e), honesto: true });
      if (e.tipo === 'tc') {
        const s = deTareaEnCurso(e.t);
        if ((control === 'pausar' && s.state === 'paused') || (control === 'reanudar' && s.state !== 'paused')) return res.json({ tarea: s, ack: 'aplicado', sinCambio: true, honesto: true });
        const r = d.tareaEnCurso!.accion(dueno, e.t.id, controlTc[control]);
        if (r.ok === false) return noEsta(res);
        return res.json({ tarea: r.tarea ? deTareaEnCurso(r.tarea) : null, cerrada: !r.tarea, ack: 'aplicado', honesto: true });
      }
      const reg = e.reg;
      const t0 = ahora();
      // Idempotente: lo que ya está así (o ya terminó) se devuelve tal cual.
      if (esTerminal(reg.estado) || (control === 'pausar' && (reg.estado === 'paused' || reg.estado === 'pausing')) || (control === 'reanudar' && reg.estado !== 'paused') || (control === 'cancelar' && reg.estado === 'cancelling')) {
        return res.json({ tarea: vistaTarea(reg, t0), ack: 'aplicado', sinCambio: true, honesto: true });
      }
      const pcId = reg.enlace?.tipo === 'computadora' ? reg.enlace.id : null;
      let cambio: Cambio;
      let ack: 'aplicado' | 'recibido' = 'aplicado';
      if (control === 'pausar') {
        // Una investigación corre de un tirón con su tope: no se finge una pausa (se puede cancelar).
        if (esInvestigacion(reg)) return res.status(409).json({ error: 'Una investigación no se pausa: termina sola en unos minutos. Si ya no la quieres, cancélala.', codigo: 'no-pausable', tarea: vistaTarea(reg, t0), honesto: true });
        if (!transicionValida(reg.estado, 'paused') || reg.estado === 'awaiting_approval') return res.status(409).json({ error: 'Esta tarea ahora espera tu decisión; no hay trabajo que pausar.', codigo: 'no-pausable', tarea: vistaTarea(reg, t0), honesto: true });
        // Con su computadora: la pausa la confirma el nodo. Si no puede (sin esa capacidad, caída), no se
        // finge: la tarea sigue como estaba. Si la barrera tarda (`draining`), queda `pausing` (recibido).
        let fase: string | null = null;
        if (pcId && d.computadora?.pausar) {
          try {
            const r = (await d.computadora.pausar(dueno, pcId)) as { fase?: string | null } | undefined;
            fase = r?.fase ?? null;
          } catch {
            return res.status(409).json({ error: 'Tu computadora no pudo pausarla ahora; sigue trabajando.', codigo: 'no-pausable', tarea: vistaTarea(reg, t0), honesto: true });
          }
        }
        const aplicado = !fase || fase === 'quiescent';
        ack = aplicado ? 'aplicado' : 'recibido';
        cambio = aplicado ? { estado: 'paused', pasoActual: 'En pausa: no hago nada hasta que la reanudes.' } : { estado: 'pausing', pasoActual: 'Pidiendo la pausa a tu computadora…' };
      } else if (control === 'reanudar') {
        // Si su computadora no la reanuda (caída, sin esa capacidad), no se finge: sigue en pausa.
        if (pcId && d.computadora?.reanudar) {
          try {
            await d.computadora.reanudar(dueno, pcId);
          } catch {
            return res.status(409).json({ error: 'Tu computadora no pudo reanudarla ahora; sigue en pausa.', codigo: 'no-reanudable', tarea: vistaTarea(reg, t0), honesto: true });
          }
        }
        cambio = { estado: reg.antesDePausa && !esTerminal(reg.antesDePausa) && reg.antesDePausa !== 'pausing' ? reg.antesDePausa : 'running', pasoActual: 'Reanudada' };
      } else {
        // Cancelar impide efectos futuros; lo que ya pasó queda en el resultado (invariante 8). Con su
        // computadora, la parada la confirma el nodo: si no pudo, no se finge; si una acción ya despachada
        // sigue corriendo (`draining`/`fenced`), queda `cancelling` y la reconciliación la cierra con lo que pase.
        let faseParada: string | null = null;
        if (pcId && d.computadora?.parar) {
          try {
            const r = (await d.computadora.parar(dueno, pcId)) as { fase?: string | null } | undefined;
            faseParada = r?.fase ?? null;
          } catch {
            return res.status(409).json({ error: 'Tu computadora no pudo pararla ahora; sigue trabajando.', codigo: 'no-cancelable', tarea: vistaTarea(reg, t0), honesto: true });
          }
        }
        const vinc = reg.decision?.vinculo?.tipo === 'borrador' ? reg.decision.vinculo : null;
        if (vinc && d.borradores?.vigente(dueno, vinc.canal, vinc.ambito)?.intento === vinc.intento) await d.borradores.descartar(dueno, vinc.canal, vinc.ambito, vinc.intento).catch(() => undefined);
        const hechas = reg.resueltas.filter((x) => x.operacion);
        if (faseParada && faseParada !== 'quiescent') {
          ack = 'recibido';
          cambio = { estado: 'cancelling', pasoActual: 'Parando en tu computadora: espero a que termine lo que ya estaba haciendo.' };
        } else cambio = {
          estado: 'cancelled',
          pasoActual: null,
          resultado: {
            id: `${reg.id}:resultado`,
            resumen: hechas.length ? 'Cancelada. No hago nada más; lo que ya se había hecho queda anotado.' : 'Cancelada antes de hacer nada con efecto.',
            evidencias: hechas.map((x) => ({ id: `${x.operacion}:previa`, tipo: 'recibo' as const, etiqueta: `Ya ejecutado antes de cancelar (${x.opcion})`, ref: x.operacion })),
            parcial: reg.resultado?.parcial || [],
            pendiente: [],
            t: t0,
          },
        };
      }
      const r = await cambiarTarea(dueno, reg.id, (x) => (esTerminal(x.estado) ? null : cambio), { ahora: t0 });
      if (r.ok === false) {
        if (r.motivo === 'almacen') return almacenCaido(res);
        return res.status(409).json({ error: 'La tarea cambió; mira cómo quedó.', codigo: r.motivo, tarea: r.tarea ? vistaTarea(r.tarea, ahora()) : null, honesto: true });
      }
      return res.json({ tarea: vistaTarea(r.tarea, ahora()), ack, honesto: true });
    });
  }
}
