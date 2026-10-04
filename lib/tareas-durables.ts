/**
 * LA TAREA DURABLE (AUR08, secciones 6, 8 y 17 del documento maestro): el «resultado acotado» que AURA
 * persigue fuera del turno —su computadora trabajando, un borrador que espera tu decisión— con un
 * snapshot versionado, una máquina de estados con terminales monotónicos, decisiones ligadas a una
 * versión y un cursor de eventos para reconciliar al volver.
 *
 * No es una lista paralela:
 *  · La TAREA EN CURSO de la conversación (lib/tarea-en-curso.ts) y las MISIONES de su computadora
 *    (server/computadora.ts) siguen siendo las suyas: aquí se ADAPTAN a este contrato al leer
 *    (`deTareaEnCurso`, `deComputadora`) conservando sus ids. Una tarea durable que encargó a la
 *    computadora se enlaza con la misión (`enlace`) y se reconcilia con ella (`reconciliarConComputadora`);
 *    esa misión ya no sale aparte.
 *  · Las MISIONES de la persona (lib/misiones.ts) son objetivos de días o semanas (`Goal`): una tarea puede
 *    nombrar el suyo (`objetivoId`), pero no se copian.
 *  · Lo nuevo de verdad (lo que no tenía dónde vivir) es lo durable que nace del chat: el encargo a la
 *    computadora y el borrador que espera tu «sí», con su decisión exacta. Vive en lib/durable.ts (S3 con
 *    escrituras condicionales; sin S3, el disco), bajo `tareas/<huella del dueño>/<id>`, con un índice por
 *    dueño. Crear es «una vez» por dueño + requestId (`reservarPedido` + `crearUnaVez`); cada cambio es
 *    compare-and-set y guarda estado y evento en la MISMA escritura (no hay outbox que se desincronice).
 *
 * Reglas (sección 8):
 *  · El dueño sale de la sesión del servidor; aquí siempre es un parámetro, nunca un campo del cuerpo.
 *  · Terminales monotónicos: `completed`, `partial`, `failed` y `cancelled` no cambian. Un evento viejo o
 *    una captura nueva no resucitan una tarea cerrada.
 *  · `completed` exige que cada criterio obligatorio esté verificado CON evidencia; si falta, es `partial`.
 *  · Cada mutación pedida por la persona trae `expectedVersion`; conflicto devuelve el snapshot actual.
 *  · Progreso solo con denominador real («3 de 5 pasos hechos»); nunca un porcentaje inventado.
 *  · Nada aquí guarda contraseñas ni tokens; del borrador se guarda lo que se le mostró (destinatario,
 *    asunto, un trozo del texto) y su id de intento.
 */
import crypto from 'node:crypto';
import {
  almacenDurable,
  claveDe,
  crearUnaVez,
  leerDurable,
  modificarDurable,
  reservarPedido,
  type AlmacenDurable,
} from './durable';

/* ------------------------------------------------------------------ estados */

/** Los de la sección 17 (TaskState). `reconciling` es el «unknown/reconciling» de la sección 6. */
export const ESTADOS_TAREA = [
  'created',
  'planning',
  'queued',
  'waiting_resource',
  'awaiting_approval',
  'running',
  'pausing',
  'paused',
  'takeover_requested',
  'human_control',
  'reconciling',
  'verifying',
  'completed',
  'partial',
  'failed',
  'blocked',
  'cancelling',
  'cancelled',
] as const;
export type EstadoTarea = (typeof ESTADOS_TAREA)[number];

export const TERMINALES: ReadonlySet<EstadoTarea> = new Set<EstadoTarea>(['completed', 'partial', 'failed', 'cancelled']);
export const esTerminal = (e: EstadoTarea) => TERMINALES.has(e);
/** Los que se pueden pausar (un trabajo vivo, no uno que ya espera a la persona ni uno que se está cerrando). */
const PAUSABLES: ReadonlySet<EstadoTarea> = new Set<EstadoTarea>(['created', 'planning', 'queued', 'waiting_resource', 'running', 'verifying', 'blocked', 'reconciling']);

/**
 * ¿Se puede pasar de `de` a `a`? Desde un terminal, a nada. A `created`, nunca (se nace ahí). A `paused`,
 * solo desde algo vivo o desde `pausing`. Lo demás entre estados activos sí (la sección 8 permite
 * `awaiting_approval`, `reconciling`, `blocked`… desde cualquier activo).
 */
export function transicionValida(de: EstadoTarea, a: EstadoTarea): boolean {
  if (de === a) return true;
  if (esTerminal(de)) return false;
  if (a === 'created') return false;
  if (a === 'paused') return PAUSABLES.has(de) || de === 'pausing' || de === 'awaiting_approval';
  if (a === 'human_control') return de === 'takeover_requested' || de === 'running';
  return true;
}

/* ------------------------------------------------------------------ forma */

export type Criterio = { id: string; texto: string; obligatorio: boolean; estado: 'pending' | 'verified' | 'not_met' | 'unknown'; evidencias: string[] };
export type Evidencia = { id: string; tipo: 'enlace' | 'recibo' | 'dato' | 'archivo' | 'captura'; etiqueta: string; ref?: string };
export type Entorno = { kind: 'chat' | 'computadora' | 'correo' | 'whatsapp' | 'servidor'; id: string; displayName: string };
export type Progreso = { hechos: number; total: number; unidad: string };

/** Las opciones de una decisión (sección 6). `elegir:<x>` es una de varias respuestas concretas. */
export type OpcionId = 'aprobar' | 'editar' | 'rechazar' | 'posponer' | `elegir:${string}`;
export type Opcion = { id: OpcionId; etiqueta: string; efecto: string; riesgo: 'efecto' | 'sin-efecto' };

/** A qué está ligada la aprobación: lo exacto que se ejecuta (y que se vuelve a mirar antes de hacerlo). */
export type Vinculo =
  | { tipo: 'borrador'; canal: 'correo' | 'whatsapp'; ambito: string; intento: string; hash: string }
  | { tipo: 'tarea-en-curso'; ambito: string; tareaId: string };

export type Decision = {
  id: string;
  /** Qué clase de decisión: aprobar una acción con efecto, elegir entre respuestas, seguir o no una tarea. */
  tipo: 'aprobar-accion' | 'elegir' | 'continuar-tarea';
  pregunta: string;
  porque: string;
  propuesta: { accion: string; cuenta?: string; destinatario?: string; datos: string[]; importe?: string; recurrencia?: string; alcance: string };
  opciones: Opcion[];
  creada: number;
  caduca?: number;
  pospuestaHasta?: number | null;
  /** Se pospuso sin fecha. */
  pospuesta?: boolean;
  /** La versión del plan cuando se propuso: editar crea otra. */
  planVersion: number;
  /** Ligado a la operación exacta. No sale al cliente. */
  vinculo?: Vinculo;
};

export type DecisionResuelta = { id: string; opcion: OpcionId; t: number; operacion?: string };
export type Resultado = { id: string; resumen: string; evidencias: Evidencia[]; parcial: string[]; pendiente: string[]; t: number };

export type Origen = { kind: 'chat' | 'api' | 'tarea-en-curso' | 'computadora'; turnoId?: string; conversacion?: string };
export type EnlaceTarea = { tipo: 'computadora'; id: string } | null;

export type EventoTarea = {
  eventId: string;
  aggregateId: string;
  sequence: number;
  version: number;
  type: 'task.created' | 'task.state_changed' | 'task.progressed' | 'decision.required' | 'decision.resolved' | 'operation.receipt' | 'task.finished';
  occurredAt: string;
  schemaVersion: 1;
  payload: Record<string, unknown>;
};

export type RegistroTarea = {
  v: 1;
  id: string;
  requestId: string;
  version: number;
  estado: EstadoTarea;
  /** El estado al que vuelve al reanudar. */
  antesDePausa?: EstadoTarea;
  titulo: string;
  objetivo: string;
  criterios: Criterio[];
  entorno: Entorno;
  pasoActual?: string;
  progreso?: Progreso | null;
  planVersion: number;
  decision?: Decision | null;
  resueltas: DecisionResuelta[];
  resultado?: Resultado | null;
  origen: Origen;
  objetivoId?: string;
  enlace?: EnlaceTarea;
  proximaRevision?: number;
  condicionParada: string;
  creada: number;
  actualizada: number;
  latido?: number;
  secuencia: number;
  eventos: EventoTarea[];
};

/** Cuántos eventos se guardan con la tarea (el resto se reconstruye con el snapshot). */
export const MAX_EVENTOS = 60;
/** Cuántas tareas durables recuerda el índice de cada dueño. */
export const MAX_INDICE = 40;
export const ESPACIO_TAREAS = 'tareas';
export const ESPACIO_PEDIDOS = 'tareas/pedidos';
export const ESPACIO_INDICE = 'tareas/indice';

const texto = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/PEDIR_HERRAMIENTA/gi, 'PEDIR-HERRAMIENTA')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
const idNuevo = (p: string) => `${p}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
const iso = (t?: number | null) => (t ? new Date(t).toISOString() : undefined);

export const claveTarea = (dueno: string, id: string) => claveDe(ESPACIO_TAREAS, dueno, id);
const claveIndice = (dueno: string) => claveDe(ESPACIO_INDICE, dueno, 'lista');

/* ------------------------------------------------------------------ reglas puras */

/** ¿Cada criterio obligatorio quedó verificado con al menos una evidencia? (invariante 5). */
export function criteriosCumplidos(criterios: Criterio[]): boolean {
  return criterios.filter((c) => c.obligatorio).every((c) => c.estado === 'verified' && c.evidencias.length > 0);
}

export type Cambio = {
  estado?: EstadoTarea;
  pasoActual?: string | null;
  progreso?: Progreso | null;
  decision?: Decision | null;
  resolver?: DecisionResuelta;
  resultado?: Resultado | null;
  criterios?: Criterio[];
  entorno?: Entorno;
  enlace?: EnlaceTarea;
  proximaRevision?: number | null;
  planVersion?: number;
  /** Eventos extra (un recibo de operación). */
  eventos?: { type: EventoTarea['type']; payload: Record<string, unknown> }[];
  /** Solo el latido: no sube la versión (una decisión vista hace un segundo sigue valiendo). */
  soloLatido?: boolean;
};

export type MotivoRechazo = 'terminal' | 'transicion' | 'version' | 'no-existe' | 'almacen' | 'sin-evidencia';

/**
 * Aplica un cambio a una copia del registro. Devuelve el registro nuevo (versión + 1, eventos en la misma
 * escritura) o por qué no. Un `completed` sin evidencia de cada criterio obligatorio se rechaza
 * (`sin-evidencia`): quien llama decide si es `partial`.
 */
export function aplicarCambio(reg: RegistroTarea, c: Cambio, ahora: number): { ok: true; reg: RegistroTarea; cambiado: boolean } | { ok: false; motivo: MotivoRechazo } {
  if (c.soloLatido) return { ok: true, reg: { ...reg, latido: ahora }, cambiado: false };
  const a = c.estado ?? reg.estado;
  if (esTerminal(reg.estado)) {
    // Repetir el mismo terminal es idempotente; cualquier otra cosa sobre un terminal, no.
    return a === reg.estado && c.decision === undefined && !c.resolver && c.resultado === undefined ? { ok: true, reg, cambiado: false } : { ok: false, motivo: 'terminal' };
  }
  if (!transicionValida(reg.estado, a)) return { ok: false, motivo: 'transicion' };
  const criterios = c.criterios ?? reg.criterios;
  if (a === 'completed' && !criteriosCumplidos(criterios)) return { ok: false, motivo: 'sin-evidencia' };
  const n: RegistroTarea = JSON.parse(JSON.stringify(reg));
  const eventos: { type: EventoTarea['type']; payload: Record<string, unknown> }[] = [];
  if (a !== reg.estado) {
    if (a === 'paused' || a === 'pausing') n.antesDePausa = reg.estado === 'pausing' ? reg.antesDePausa : reg.estado;
    n.estado = a;
    eventos.push({ type: esTerminal(a) ? 'task.finished' : 'task.state_changed', payload: { from: reg.estado, to: a } });
  }
  if (c.pasoActual !== undefined) {
    if (c.pasoActual === null) delete n.pasoActual;
    else n.pasoActual = texto(c.pasoActual, 200);
  }
  if (c.progreso !== undefined) n.progreso = c.progreso;
  if ((c.pasoActual !== undefined && c.pasoActual !== reg.pasoActual) || (c.progreso !== undefined && JSON.stringify(c.progreso) !== JSON.stringify(reg.progreso ?? null))) {
    eventos.push({ type: 'task.progressed', payload: { currentStep: n.pasoActual ?? null, progress: n.progreso ?? null } });
  }
  if (c.resolver) {
    n.resueltas = [...(n.resueltas || []), c.resolver].slice(-20);
    eventos.push({ type: 'decision.resolved', payload: { decisionId: c.resolver.id, option: c.resolver.opcion } });
  }
  if (c.decision !== undefined) {
    n.decision = c.decision;
    if (c.decision && c.decision.id !== reg.decision?.id) eventos.push({ type: 'decision.required', payload: { decisionId: c.decision.id } });
  }
  if (c.resultado !== undefined) n.resultado = c.resultado;
  if (c.criterios) n.criterios = c.criterios;
  if (c.entorno) n.entorno = c.entorno;
  if (c.enlace !== undefined) n.enlace = c.enlace;
  if (c.proximaRevision !== undefined) {
    if (c.proximaRevision === null) delete n.proximaRevision;
    else n.proximaRevision = c.proximaRevision;
  }
  if (c.planVersion !== undefined) n.planVersion = c.planVersion;
  if (esTerminal(a)) {
    // Un terminal no espera nada más: ni decisión ni próxima revisión.
    n.decision = null;
    delete n.proximaRevision;
  }
  eventos.push(...(c.eventos || []));
  const cambiado = JSON.stringify({ ...n, latido: 0 }) !== JSON.stringify({ ...reg, latido: 0 });
  if (!cambiado) return { ok: true, reg, cambiado: false };
  n.version = reg.version + 1;
  n.actualizada = ahora;
  n.latido = ahora;
  for (const e of eventos) {
    n.secuencia += 1;
    n.eventos.push({ eventId: `${n.id}:${n.secuencia}`, aggregateId: n.id, sequence: n.secuencia, version: n.version, type: e.type, occurredAt: new Date(ahora).toISOString(), schemaVersion: 1, payload: e.payload });
  }
  n.eventos = n.eventos.slice(-MAX_EVENTOS);
  return { ok: true, reg: n, cambiado: true };
}

/* ------------------------------------------------------------------ crear */

export type NuevaTarea = {
  requestId: string;
  titulo: string;
  objetivo?: string;
  estado?: EstadoTarea;
  criterios?: { id: string; texto: string; obligatorio?: boolean }[];
  entorno: Entorno;
  pasoActual?: string;
  progreso?: Progreso | null;
  decision?: Decision | null;
  origen: Origen;
  objetivoId?: string;
  enlace?: EnlaceTarea;
  condicionParada?: string;
  proximaRevision?: number;
};

export function registroNuevo(id: string, d: NuevaTarea, ahora: number): RegistroTarea {
  const estado = d.estado && !esTerminal(d.estado) ? d.estado : 'created';
  const reg: RegistroTarea = {
    v: 1,
    id,
    requestId: String(d.requestId).slice(0, 120),
    version: 1,
    estado,
    titulo: texto(d.titulo, 100) || 'Tarea',
    objetivo: texto(d.objetivo || d.titulo, 400),
    criterios: (d.criterios || []).slice(0, 8).map((c) => ({ id: texto(c.id, 40) || 'c', texto: texto(c.texto, 200), obligatorio: c.obligatorio !== false, estado: 'pending', evidencias: [] })),
    entorno: { kind: d.entorno.kind, id: texto(d.entorno.id, 80), displayName: texto(d.entorno.displayName, 80) },
    ...(d.pasoActual ? { pasoActual: texto(d.pasoActual, 200) } : {}),
    progreso: d.progreso ?? null,
    planVersion: 1,
    decision: d.decision ?? null,
    resueltas: [],
    resultado: null,
    origen: d.origen,
    ...(d.objetivoId ? { objetivoId: texto(d.objetivoId, 40) } : {}),
    enlace: d.enlace ?? null,
    ...(d.proximaRevision ? { proximaRevision: d.proximaRevision } : {}),
    condicionParada: texto(d.condicionParada || 'Termina con evidencia, falla, o la cancelas tú.', 200),
    creada: ahora,
    actualizada: ahora,
    latido: ahora,
    secuencia: 1,
    eventos: [{ eventId: `${id}:1`, aggregateId: id, sequence: 1, version: 1, type: 'task.created', occurredAt: new Date(ahora).toISOString(), schemaVersion: 1, payload: { state: estado } }],
  };
  if (reg.decision) {
    reg.secuencia = 2;
    reg.eventos.push({ eventId: `${id}:2`, aggregateId: id, sequence: 2, version: 1, type: 'decision.required', occurredAt: new Date(ahora).toISOString(), schemaVersion: 1, payload: { decisionId: reg.decision.id } });
  }
  return reg;
}

export type ResultadoCrearTarea = { ok: true; creada: boolean; tarea: RegistroTarea } | { ok: false; motivo: 'almacen' | 'invalida'; detalle: string };

type Opciones = { almacen?: AlmacenDurable; ahora?: number };

/**
 * Crea la tarea UNA vez por dueño + requestId: perder la respuesta, reintentar u otra réplica devuelven la
 * MISMA tarea (`creada: false`). Si el almacén no contesta, `ok: false` (no se inventa una tarea local).
 */
export async function crearTarea(dueno: string, d: NuevaTarea, o: Opciones = {}): Promise<ResultadoCrearTarea> {
  const a = o.almacen || almacenDurable();
  const ahora = o.ahora ?? Date.now();
  if (!d.requestId || !d.titulo) return { ok: false, motivo: 'invalida', detalle: 'falta requestId o título' };
  const r = await reservarPedido({ espacio: ESPACIO_PEDIDOS, dueno, requestId: d.requestId, propuesto: idNuevo('tk'), almacen: a });
  if (r.ok === false) return { ok: false, motivo: 'almacen', detalle: r.detalle };
  // Si quien reservó murió antes de escribir la tarea, el siguiente la escribe con el MISMO id.
  const c = await crearUnaVez(claveTarea(dueno, r.id), registroNuevo(r.id, d, ahora), a);
  if (c.ok === false) return { ok: false, motivo: 'almacen', detalle: c.detalle };
  await indexar(dueno, r.id, ahora, a);
  return { ok: true, creada: c.creado, tarea: c.valor };
}

type Indice = { v: 1; ids: { id: string; t: number }[] };

async function indexar(dueno: string, id: string, ahora: number, a: AlmacenDurable) {
  const r = await modificarDurable<Indice>(
    claveIndice(dueno),
    (ix) => {
      const ids = ix?.ids || [];
      if (ids.some((x) => x.id === id)) return undefined;
      return { v: 1, ids: [{ id, t: ahora }, ...ids].slice(0, MAX_INDICE) };
    },
    a
  );
  if (r.ok === false) console.warn('[tareas] no pude anotar la tarea en el índice:', r.detalle.slice(0, 120));
}

/** La tarea id de una petición ya reservada (sin crear nada). null si no hay. */
export async function tareaDePedido(dueno: string, requestId: string, a: AlmacenDurable = almacenDurable()): Promise<string | null> {
  const l = await leerDurable<{ id: string }>(claveDe(ESPACIO_PEDIDOS, dueno, requestId), a);
  return l.ok && l.valor ? String(l.valor.id) : null;
}

/* ------------------------------------------------------------------ leer */

export async function leerTarea(dueno: string, id: string, a: AlmacenDurable = almacenDurable()): Promise<{ ok: true; tarea: RegistroTarea | null } | { ok: false; detalle: string }> {
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(String(id || ''))) return { ok: true, tarea: null };
  const l = await leerDurable<RegistroTarea>(claveTarea(dueno, id), a);
  if (l.ok === false) return { ok: false, detalle: l.detalle };
  return { ok: true, tarea: l.valor };
}

/** Las durables del dueño, la más nueva primero. `ok: false` si el índice no se pudo leer. */
export async function listarTareas(dueno: string, a: AlmacenDurable = almacenDurable()): Promise<{ ok: true; tareas: RegistroTarea[] } | { ok: false; detalle: string }> {
  const ix = await leerDurable<Indice>(claveIndice(dueno), a);
  if (ix.ok === false) return { ok: false, detalle: ix.detalle };
  const ids = ix.valor?.ids || [];
  const leidas = await Promise.all(ids.map((x) => leerTarea(dueno, x.id, a)));
  const tareas = leidas.flatMap((l) => (l.ok && l.tarea ? [l.tarea] : []));
  return { ok: true, tareas: tareas.sort((x, y) => y.actualizada - x.actualizada) };
}

/* ------------------------------------------------------------------ cambiar */

export type ResultadoCambio = { ok: true; tarea: RegistroTarea; cambiado: boolean } | { ok: false; motivo: MotivoRechazo; tarea?: RegistroTarea; detalle?: string };

/**
 * Cambia la tarea con CAS. `cambio` recibe el registro actual (una copia) y devuelve el cambio, o null para
 * no tocar nada. Con `expectedVersion`, si la versión no coincide no se escribe y vuelve el snapshot actual.
 */
export async function cambiarTarea(
  dueno: string,
  id: string,
  cambio: (reg: RegistroTarea) => Cambio | null,
  o: Opciones & { expectedVersion?: number } = {}
): Promise<ResultadoCambio> {
  const a = o.almacen || almacenDurable();
  let motivo: MotivoRechazo | null = null;
  let visto: RegistroTarea | undefined;
  let cambiado = false;
  const r = await modificarDurable<RegistroTarea>(
    claveTarea(dueno, id),
    (reg) => {
      motivo = null;
      cambiado = false;
      visto = reg || undefined;
      if (!reg) return void (motivo = 'no-existe');
      if (o.expectedVersion !== undefined && reg.version !== o.expectedVersion) return void (motivo = 'version');
      const c = cambio(reg);
      if (!c) return undefined;
      const ap = aplicarCambio(reg, c, o.ahora ?? Date.now());
      if (ap.ok === false) return void (motivo = ap.motivo);
      cambiado = ap.cambiado;
      return ap.cambiado || c.soloLatido ? ap.reg : undefined;
    },
    a
  );
  if (r.ok === false) return { ok: false, motivo: 'almacen', detalle: r.detalle, tarea: visto };
  if (motivo) return { ok: false, motivo, tarea: visto };
  return { ok: true, tarea: (r.valor as RegistroTarea | null) || visto!, cambiado };
}

/* ------------------------------------------------------------------ decisiones */

export type PedidoDecision = { decisionId: string; expectedVersion: number; opcion: string; texto?: string; hasta?: number | null };

export type Validacion =
  | { ok: true; opcion: Opcion; decision: Decision }
  | { ok: true; repetida: true; resuelta: DecisionResuelta }
  | { ok: false; codigo: 'terminal' | 'sin-decision' | 'decision-vieja' | 'version' | 'caducada' | 'opcion' | 'ya-decidida'; mensaje: string };

/**
 * ¿Esta decisión se puede aplicar AHORA? Pura. La misma decisión con la misma opción, ya aplicada, es
 * `repetida` (se perdió la respuesta: no se ejecuta otra vez). Una decisión vieja, de otra versión,
 * caducada o con una opción que no se ofreció NO se aplica.
 */
export function validarDecision(reg: RegistroTarea, p: PedidoDecision, ahora: number): Validacion {
  const ya = (reg.resueltas || []).find((x) => x.id === p.decisionId);
  if (ya) return ya.opcion === p.opcion ? { ok: true, repetida: true, resuelta: ya } : { ok: false, codigo: 'ya-decidida', mensaje: 'Esa decisión ya se tomó con otra opción.' };
  if (esTerminal(reg.estado)) return { ok: false, codigo: 'terminal', mensaje: 'La tarea ya terminó; no hay nada que decidir.' };
  const d = reg.decision;
  if (!d) return { ok: false, codigo: 'sin-decision', mensaje: 'Esta tarea no espera ninguna decisión ahora.' };
  if (d.id !== p.decisionId) return { ok: false, codigo: 'decision-vieja', mensaje: 'Esa propuesta ya cambió. Mira la nueva antes de decidir.' };
  if (reg.version !== p.expectedVersion) return { ok: false, codigo: 'version', mensaje: 'La tarea cambió mientras decidías. Mira cómo quedó.' };
  const opcion = d.opciones.find((x) => x.id === p.opcion);
  if (!opcion) return { ok: false, codigo: 'opcion', mensaje: 'Esa opción no se ofreció en esta decisión.' };
  // Caducada: solo aprobar (o elegir) queda fuera; rechazar, editar o posponer no ejecutan nada.
  if (d.caduca && ahora > d.caduca && opcion.riesgo === 'efecto') return { ok: false, codigo: 'caducada', mensaje: 'La propuesta caducó: no la ejecuto. Pide una nueva.' };
  return { ok: true, opcion, decision: d };
}

/** Las opciones de una aprobación con efecto (correo o WhatsApp). «Aprobar» nunca es la primera ni la preseleccionada. */
export function opcionesAprobacion(accion: string, destinatario: string): Opcion[] {
  return [
    { id: 'posponer', etiqueta: 'Posponer', efecto: 'No envía nada. La propuesta sigue esperando hasta que decidas.', riesgo: 'sin-efecto' },
    { id: 'editar', etiqueta: 'Editar', efecto: 'No envía nada. Descarta este borrador y me dices en el chat qué cambio.', riesgo: 'sin-efecto' },
    { id: 'rechazar', etiqueta: 'Rechazar', efecto: 'Descarta este borrador. No se envía y queda constancia.', riesgo: 'sin-efecto' },
    { id: 'aprobar', etiqueta: `Aprobar: ${accion}`, efecto: `${accion} a ${destinatario}, una sola vez, tal como se muestra.`, riesgo: 'efecto' },
  ];
}

/* ------------------------------------------------------------------ el snapshot del cliente */

/** Lo que ve el cliente (TaskSnapshot de la sección 17, con los nombres de allí). Sin vínculos internos. */
export type TaskSnapshot = {
  id: string;
  version: number;
  state: EstadoTarea;
  terminal: boolean;
  source: 'durable' | 'tarea-en-curso' | 'computadora';
  title: string;
  objective: string;
  acceptance: { id: string; text: string; required: boolean; status: Criterio['estado']; evidenceIds: string[] }[];
  environment: Entorno;
  currentStep?: string;
  progress?: { done: number; total: number; unit: string } | null;
  planVersion: number;
  lastEventSequence: number;
  lastHeartbeatAt?: string;
  decisionId?: string;
  decision?: {
    id: string;
    kind: Decision['tipo'];
    question: string;
    why: string;
    proposal: { action: string; account?: string; recipient?: string; data: string[]; amount?: string; recurrence?: string; scope: string };
    options: { id: string; label: string; effect: string; risk: Opcion['riesgo'] }[];
    createdAt: string;
    expiresAt?: string;
    expired: boolean;
    postponed: boolean;
    postponedUntil?: string;
  } | null;
  resultId?: string;
  result?: { id: string; summary: string; evidence: Evidencia[]; partial: string[]; pending: string[]; at: string } | null;
  nextCheckAt?: string;
  stopCondition: string;
  createdAt: string;
  updatedAt: string;
  origin: Origen;
  goalId?: string;
  controls: { pause: boolean; resume: boolean; cancel: boolean; open?: 'computadora' };
};

export function vistaDecision(d: Decision | null | undefined, ahora: number): TaskSnapshot['decision'] {
  if (!d) return null;
  const expired = !!(d.caduca && ahora > d.caduca);
  // Caducada: solo quedan las opciones sin efecto (se ve por qué, y se puede pedir otra).
  const opciones = expired ? d.opciones.filter((o) => o.riesgo === 'sin-efecto' && o.id !== 'posponer') : d.opciones;
  return {
    id: d.id,
    kind: d.tipo,
    question: d.pregunta,
    why: d.porque,
    proposal: { action: d.propuesta.accion, ...(d.propuesta.cuenta ? { account: d.propuesta.cuenta } : {}), ...(d.propuesta.destinatario ? { recipient: d.propuesta.destinatario } : {}), data: d.propuesta.datos, ...(d.propuesta.importe ? { amount: d.propuesta.importe } : {}), ...(d.propuesta.recurrencia ? { recurrence: d.propuesta.recurrencia } : {}), scope: d.propuesta.alcance },
    options: opciones.map((o) => ({ id: o.id, label: o.etiqueta, effect: o.efecto, risk: o.riesgo })),
    createdAt: iso(d.creada)!,
    ...(d.caduca ? { expiresAt: iso(d.caduca) } : {}),
    expired,
    postponed: !!(d.pospuesta || (d.pospuestaHasta && d.pospuestaHasta > ahora)),
    ...(d.pospuestaHasta ? { postponedUntil: iso(d.pospuestaHasta) } : {}),
  };
}

export function vistaTarea(reg: RegistroTarea, ahora = Date.now()): TaskSnapshot {
  const terminal = esTerminal(reg.estado);
  const decision = vistaDecision(reg.decision, ahora);
  return {
    id: reg.id,
    version: reg.version,
    state: reg.estado,
    terminal,
    source: 'durable',
    title: reg.titulo,
    objective: reg.objetivo,
    acceptance: reg.criterios.map((c) => ({ id: c.id, text: c.texto, required: c.obligatorio, status: c.estado, evidenceIds: c.evidencias })),
    environment: reg.entorno,
    ...(reg.pasoActual ? { currentStep: reg.pasoActual } : {}),
    progress: reg.progreso && reg.progreso.total > 0 ? { done: Math.min(reg.progreso.hechos, reg.progreso.total), total: reg.progreso.total, unit: reg.progreso.unidad } : null,
    planVersion: reg.planVersion,
    lastEventSequence: reg.secuencia,
    ...(reg.latido ? { lastHeartbeatAt: iso(reg.latido) } : {}),
    ...(decision ? { decisionId: decision.id } : {}),
    decision,
    ...(reg.resultado ? { resultId: reg.resultado.id } : {}),
    result: reg.resultado ? { id: reg.resultado.id, summary: reg.resultado.resumen, evidence: reg.resultado.evidencias, partial: reg.resultado.parcial, pending: reg.resultado.pendiente, at: iso(reg.resultado.t)! } : null,
    ...(reg.proximaRevision ? { nextCheckAt: iso(reg.proximaRevision) } : {}),
    stopCondition: reg.condicionParada,
    createdAt: iso(reg.creada)!,
    updatedAt: iso(reg.actualizada)!,
    origin: reg.origen,
    ...(reg.objetivoId ? { goalId: reg.objetivoId } : {}),
    controls: {
      // Una investigación en segundo plano no se pausa (corre de un tirón con su tope); se puede cancelar.
      pause: !terminal && PAUSABLES.has(reg.estado) && !esInvestigacion(reg),
      resume: reg.estado === 'paused',
      cancel: !terminal && reg.estado !== 'cancelling',
      ...(reg.enlace?.tipo === 'computadora' ? { open: 'computadora' as const } : {}),
    },
  };
}

/** Los eventos después del cursor. Si el cursor ya no está (se recortaron), `resync`: el cliente toma el snapshot. */
export function eventosDesde(reg: RegistroTarea, desde: number): { eventos: EventoTarea[]; cursor: number; resync: boolean } {
  const primero = reg.eventos[0]?.sequence ?? reg.secuencia + 1;
  const resync = desde > 0 && desde < primero - 1;
  // Un cursor del futuro (otra tarea, otra réplica que se adelantó): también se resincroniza.
  if (desde > reg.secuencia) return { eventos: [], cursor: reg.secuencia, resync: true };
  return { eventos: resync ? [] : reg.eventos.filter((e) => e.sequence > desde), cursor: reg.secuencia, resync };
}

/* ------------------------------------------------------------------ adaptadores */

/** Lo mínimo de una tarea en curso (lib/tarea-en-curso.ts) para adaptarla. */
export type TareaEnCursoMin = {
  id: string;
  ambito: string;
  tipo: string;
  titulo: string;
  pasos: { etiqueta: string; estado: 'pendiente' | 'hecho' | 'saltado' }[];
  actual: number;
  estado: 'activa' | 'preguntando' | 'pausada';
  creado: number;
  actualizado: number;
  pedidoNuevo?: string;
};

/**
 * La tarea en curso de una conversación como TaskSnapshot (mismo id). Su versión es su `actualizado`
 * (cambia en cada cambio). «preguntando» es una decisión con tres respuestas concretas.
 */
export function deTareaEnCurso(t: TareaEnCursoMin): TaskSnapshot {
  const hechos = t.pasos.filter((p) => p.estado !== 'pendiente').length;
  const sig = t.pasos.findIndex((p, i) => p.estado === 'pendiente' && i > t.actual);
  const siguiente = sig >= 0 ? sig : t.pasos.findIndex((p) => p.estado === 'pendiente');
  const estado: EstadoTarea = t.estado === 'pausada' ? 'paused' : t.estado === 'preguntando' ? 'awaiting_approval' : 'running';
  const cosa = t.tipo === 'correo' ? 'los correos' : t.tipo === 'whatsapp' ? 'los mensajes' : 'esta tarea';
  const decision: TaskSnapshot['decision'] =
    t.estado === 'preguntando'
      ? {
          id: `${t.id}:${t.actualizado}`,
          kind: 'continuar-tarea',
          question: `Pediste otra cosa a mitad de «${t.titulo}». ¿Qué hago con ${cosa}?`,
          why: 'No empiezo otra cosa sin que decidas qué pasa con la que está a medias.',
          proposal: { action: 'Decidir qué pasa con la tarea a medias', data: t.pedidoNuevo ? [`Lo que pediste: «${t.pedidoNuevo}»`] : [], scope: 'Solo esta tarea de esta conversación' },
          options: [
            { id: 'posponer', label: 'Dejarla para después', effect: 'Queda en pausa en «lo que quedó a medias»; atiendo lo nuevo.', risk: 'sin-efecto' },
            { id: 'elegir:seguir', label: 'Terminarla primero', effect: 'Sigo con ella; lo nuevo queda para cuando termine.', risk: 'sin-efecto' },
            { id: 'rechazar', label: 'Descartarla', effect: 'La cierro sin terminar; no la retomo.', risk: 'sin-efecto' },
          ],
          createdAt: new Date(t.actualizado).toISOString(),
          expired: false,
          postponed: false,
        }
      : null;
  return {
    id: t.id,
    version: t.actualizado,
    state: estado,
    terminal: false,
    source: 'tarea-en-curso',
    title: t.titulo,
    objective: t.titulo,
    acceptance: [{ id: 'pasos', text: `Ver los ${t.pasos.length} pasos`, required: true, status: hechos === t.pasos.length ? 'verified' : 'pending', evidenceIds: [] }],
    environment: { kind: t.tipo === 'correo' ? 'correo' : t.tipo === 'whatsapp' ? 'whatsapp' : 'chat', id: t.ambito, displayName: t.tipo === 'correo' ? 'Tu correo' : t.tipo === 'whatsapp' ? 'Tu WhatsApp' : 'Esta conversación' },
    ...(siguiente >= 0 ? { currentStep: `Sigue: ${t.pasos[siguiente].etiqueta}` } : {}),
    progress: { done: hechos, total: t.pasos.length, unit: 'pasos' },
    planVersion: 1,
    lastEventSequence: 0,
    lastHeartbeatAt: new Date(t.actualizado).toISOString(),
    ...(decision ? { decisionId: decision.id } : {}),
    decision,
    result: null,
    stopCondition: 'Se terminan los pasos, la das por terminada o la descartas.',
    createdAt: new Date(t.creado).toISOString(),
    updatedAt: new Date(t.actualizado).toISOString(),
    origin: { kind: 'tarea-en-curso', conversacion: t.ambito },
    controls: { pause: t.estado !== 'pausada', resume: t.estado === 'pausada', cancel: true },
  };
}

/** Lo mínimo de una misión de su computadora (server/computadora.ts: historialDe + vistaMision). */
export type MisionComputadoraMin = {
  id: string;
  tareaId: string;
  instruccion: string;
  /** El estado del nodo: en_cola, trabajando, pausada, confirmar, control, hecha, parada, sin_pasos, fallo. */
  estado: string;
  ok: boolean | null;
  inicio: number;
  segundos: number;
  resultado: string | null;
  pregunta?: string | null;
  plan?: { texto: string; estado: string }[];
  enlaces?: string[];
  datos?: { clave: string; valor: string }[];
};

/** El estado del nodo en el vocabulario de la sección 6. */
export function estadoDeComputadora(m: Pick<MisionComputadoraMin, 'estado' | 'ok'>): EstadoTarea {
  switch (m.estado) {
    case 'en_cola':
      return 'queued';
    case 'trabajando':
      return 'running';
    case 'pausada':
      return 'paused';
    case 'confirmar':
      return 'awaiting_approval';
    case 'control':
      return 'human_control';
    case 'hecha':
      return m.ok === false ? 'partial' : 'verifying';
    case 'parada':
      return 'cancelled';
    case 'sin_pasos':
    case 'fallo':
      return 'failed';
    default:
      return 'reconciling';
  }
}

/** La evidencia de una misión terminada: sus enlaces, sus datos y su respuesta (lo que el nodo devolvió). */
export function evidenciaDeComputadora(m: MisionComputadoraMin): Evidencia[] {
  const ev: Evidencia[] = [];
  (m.enlaces || []).slice(0, 6).forEach((u, i) => ev.push({ id: `${m.id}:enlace:${i}`, tipo: 'enlace', etiqueta: texto(u, 120), ref: u }));
  (m.datos || []).slice(0, 6).forEach((d, i) => ev.push({ id: `${m.id}:dato:${i}`, tipo: 'dato', etiqueta: `${texto(d.clave, 40)}: ${texto(d.valor, 120)}` }));
  if (m.resultado) ev.push({ id: `${m.id}:respuesta`, tipo: 'recibo', etiqueta: texto(m.resultado, 200) });
  return ev;
}

function progresoDePlan(plan?: { estado: string }[]): Progreso | null {
  if (!plan?.length) return null;
  return { hechos: plan.filter((p) => p.estado === 'hecho').length, total: plan.length, unidad: 'pasos del plan' };
}

/** Una misión de su computadora que no nació de una tarea durable, como TaskSnapshot (mismo id, solo lectura). */
export function deComputadora(m: MisionComputadoraMin, ahora = Date.now()): TaskSnapshot {
  let estado = estadoDeComputadora(m);
  const ev = evidenciaDeComputadora(m);
  if (estado === 'verifying') estado = ev.length ? 'completed' : 'partial';
  const terminal = esTerminal(estado);
  const actual = m.plan?.find((p) => p.estado === 'actual' || p.estado === 'espera');
  const prog = progresoDePlan(m.plan);
  return {
    id: m.id,
    version: m.inicio + m.segundos,
    state: estado,
    terminal,
    source: 'computadora',
    title: texto(m.instruccion, 100) || 'Tu computadora',
    objective: texto(m.instruccion, 400),
    acceptance: [{ id: 'resultado', text: 'La computadora termina y deja un resultado verificable', required: true, status: estado === 'completed' ? 'verified' : terminal ? 'not_met' : 'pending', evidenceIds: estado === 'completed' ? ev.map((e) => e.id) : [] }],
    environment: { kind: 'computadora', id: m.tareaId, displayName: 'Tu computadora' },
    ...(m.pregunta ? { currentStep: `Espera tu sí: ${texto(m.pregunta, 160)}` } : actual ? { currentStep: texto(actual.texto, 160) } : {}),
    progress: prog ? { done: prog.hechos, total: prog.total, unit: prog.unidad } : null,
    planVersion: 1,
    lastEventSequence: 0,
    decision: null,
    result: terminal ? { id: `${m.id}:final`, summary: texto(m.resultado || (estado === 'cancelled' ? 'La paraste.' : 'Terminó sin resultado.'), 300), evidence: ev, partial: estado === 'partial' ? ['No completó todo lo pedido.'] : [], pending: [], at: new Date(m.inicio + m.segundos * 1000).toISOString() } : null,
    stopCondition: 'Termina, falla o la paras tú.',
    createdAt: new Date(m.inicio).toISOString(),
    updatedAt: new Date(Math.min(ahora, m.inicio + m.segundos * 1000)).toISOString(),
    origin: { kind: 'computadora' },
    controls: { pause: false, resume: false, cancel: false, open: 'computadora' },
  };
}

/**
 * El cambio que lleva una tarea durable enlazada a su misión de la computadora hasta lo que la misión dice.
 * null si no hay nada que cambiar. Una misión que terminó bien con evidencia completa la tarea; sin
 * evidencia, `partial`; parada, `cancelled`.
 */
export function reconciliarConComputadora(reg: RegistroTarea, m: MisionComputadoraMin | null, ahora: number): Cambio | null {
  if (esTerminal(reg.estado)) return null;
  if (!m) {
    // La misión ya no está (el servidor se reinició y su memoria se fue): no se sabe cómo terminó.
    if (reg.estado === 'reconciling') return null;
    if (ahora - reg.actualizada < 90_000) return null;
    return { estado: 'reconciling', pasoActual: 'No puedo confirmar cómo terminó en tu computadora; reviso antes de repetir nada.' };
  }
  const estado = estadoDeComputadora(m);
  const prog = progresoDePlan(m.plan);
  const actual = m.plan?.find((p) => p.estado === 'actual' || p.estado === 'espera');
  if (estado === 'verifying' || estado === 'partial' || estado === 'cancelled' || estado === 'failed') {
    const ev = evidenciaDeComputadora(m);
    const ok = estado === 'verifying' && ev.length > 0;
    const criterios = reg.criterios.map((c) => (c.obligatorio ? { ...c, estado: ok ? ('verified' as const) : ('not_met' as const), evidencias: ok ? ev.map((e) => e.id) : [] } : c));
    const final: EstadoTarea = ok ? 'completed' : estado === 'verifying' ? 'partial' : estado;
    return {
      estado: final,
      criterios,
      progreso: prog,
      pasoActual: null,
      resultado: {
        id: `${reg.id}:resultado`,
        resumen: texto(m.resultado || (final === 'cancelled' ? 'La paraste antes de terminar.' : final === 'failed' ? 'Tu computadora no pudo hacerlo.' : 'Terminó, pero sin un resultado que lo acredite.'), 300),
        evidencias: ev,
        parcial: final === 'partial' ? ['No quedó evidencia de todo lo pedido.'] : [],
        pendiente: [],
        t: ahora,
      },
      eventos: [{ type: 'operation.receipt', payload: { operationId: m.tareaId, state: final === 'completed' ? 'succeeded' : final === 'cancelled' ? 'cancelled' : 'failed', effect: ok ? 'confirmed' : 'possible' } }],
    };
  }
  // Pidió la pausa y el nodo todavía está vaciando la barrera: sigue «pausing» hasta que el nodo diga «pausada».
  if (reg.estado === 'pausing' && (estado === 'running' || estado === 'queued')) return null;
  // Pidió cancelar y lo ya despachado sigue corriendo: queda «cancelling» hasta que la misión termine (arriba).
  if (reg.estado === 'cancelling') return null;
  const paso = m.pregunta ? `Espera tu sí en la computadora: ${texto(m.pregunta, 140)}` : actual ? texto(actual.texto, 160) : reg.pasoActual ?? null;
  if (estado === reg.estado && paso === (reg.pasoActual ?? null) && JSON.stringify(prog) === JSON.stringify(reg.progreso ?? null)) return null;
  if (!transicionValida(reg.estado, estado)) return null;
  return { estado, pasoActual: paso, progreso: prog };
}

/* ------------------------------------------------------------------ la investigación en segundo plano */

/**
 * Investigar en segundo plano (server/investigar.ts): una tarea durable con `entorno` servidor/investigacion que
 * trabaja el mismo proceso que la creó, con un tope de tiempo duro. Cada paso deja su latido (pasoActual y
 * progreso cambian). Si el proceso se reinicia a mitad, nadie la cierra: pasado el tope y un margen sin latido,
 * se cierra `failed` con la verdad (solo leía la web: no hay efecto que reconciliar ni nada que repetir a ciegas).
 */
export const TOPE_INVESTIGACION_MS = 3 * 60_000;
export const MARGEN_INVESTIGACION_MS = 60_000;
export const ENTORNO_INVESTIGACION: Entorno = { kind: 'servidor', id: 'investigacion', displayName: 'AURA investigando' };

export const esInvestigacion = (reg: Pick<RegistroTarea, 'entorno'>) => reg.entorno?.kind === 'servidor' && reg.entorno?.id === ENTORNO_INVESTIGACION.id;

/** El cambio que cierra una investigación que nadie está trabajando (el proceso se reinició). null si sigue viva. */
export function reconciliarInvestigacion(reg: RegistroTarea, ahora: number, topeMs = TOPE_INVESTIGACION_MS): Cambio | null {
  if (!esInvestigacion(reg) || esTerminal(reg.estado)) return null;
  const ultimo = Math.max(reg.latido ?? 0, reg.actualizada);
  if (ahora - ultimo <= topeMs + MARGEN_INVESTIGACION_MS) return null;
  return {
    estado: 'failed',
    pasoActual: null,
    criterios: reg.criterios.map((c) => ({ ...c, estado: 'not_met' as const, evidencias: [] })),
    resultado: {
      id: `${reg.id}:resultado`,
      resumen: 'Se interrumpió: el servidor se reinició mientras investigaba y no terminó. No quedó resultado; pídemela otra vez si la quieres.',
      evidencias: [],
      parcial: [],
      pendiente: ['Volver a pedir la investigación'],
      t: ahora,
    },
    eventos: [{ type: 'operation.receipt', payload: { operationId: reg.id, state: 'failed', effect: 'none', motivo: 'sin-latido' } }],
  };
}

/* ------------------------------------------------------------------ resumen para el indicador */

/**
 * «Trabajando · 2», «Necesito una decisión · 1»: lo cuenta el servidor igual que el cliente
 * (mobile/src/lib/trabajos.ts `resumen`). Una tarea bloqueada o con la propuesta caducada pide decisión
 * (no «trabaja»); una pospuesta o en pausa no cuenta: no está trabajando ni te está esperando.
 */
export function resumenTareas(xs: Pick<TaskSnapshot, 'state' | 'terminal' | 'decision'>[], ahora = Date.now()): { trabajando: number; decisiones: number } {
  let trabajando = 0;
  let decisiones = 0;
  for (const t of xs) {
    if (t.terminal || t.state === 'paused') continue;
    if (t.state === 'blocked') {
      decisiones++;
      continue;
    }
    if (t.state === 'awaiting_approval') {
      const pospuesta = !!t.decision?.postponed && (!t.decision.postponedUntil || Date.parse(t.decision.postponedUntil) > ahora);
      if (t.decision && !pospuesta) decisiones++;
      continue;
    }
    trabajando++;
  }
  return { trabajando, decisiones };
}
