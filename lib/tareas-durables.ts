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
 *  · El índice de un dueño solo se da por COMPLETO cuando su inventario se reconcilió (A7, auditoría del 5-oct): un
 *    índice de antes (v1, o uno que se perdió y se rehízo) puede no tener todas sus tareas aunque cada id que trae se
 *    lea bien. El inventario enumera los objetos `tareas/<huella>/…` de ESE dueño, comprueba que cada uno es suyo y
 *    anota (solo agrega, con CAS) los que faltaban. Ver «inventario» más abajo. Operación puede revertirlo por dueño
 *    (`revertirReconciliacionTareas`: precisa, deja la marca `revertido` y no se rehace sola hasta que se reactive).
 *
 * Reglas (sección 8):
 *  · El dueño sale de la sesión del servidor; aquí siempre es un parámetro, nunca un campo del cuerpo.
 *  · Terminales monotónicos: `completed`, `partial`, `failed` y `cancelled` no cambian. Un evento viejo o
 *    una captura nueva no resucitan una tarea cerrada.
 *  · `completed` exige que cada criterio obligatorio esté verificado CON evidencia; si falta, es `partial`.
 *    Evidencia es lo que se comprobó, no lo que el modelo dice: «listo», «hecho» o «guardé el archivo» no cuentan
 *    (`evaluarEntrega`: el archivo lo comprueba el nodo; la página, un paso hecho; el dato pedido, la respuesta que lo trae).
 *  · Cada cosa pedida es SU criterio con SU evidencia (lib/entregables.ts): tres documentos son tres criterios, un archivo
 *    cumple a lo más uno, y una evidencia que no está en el resultado (o una de archivo copiada a varios) no cuenta.
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
  huellaDueno,
  leerDurable,
  modificarDurable,
  reservarPedido,
  type AlmacenDurable,
} from './durable';
import { agendar } from './agenda';
import { compararEntrega, comprobarCopia, esConsulta, esOperacionDeArchivos, esTextoEnChat, faltaEnPalabras, nombresEn, remiteAOtroLugar, respuestaConTexto, textoSinAcuses, requisitosCombinados, requisitosDeEntrega, type ArchivoNodo, type ItemEntrega, type PedidoEntrega } from './entregables';

export { esConsulta, esOperacionDeArchivos, nombresEn, requisitosCombinados, requisitosDeEntrega, VALIDADOR_MIN, type ArchivoNodo, type ItemEntrega, type PedidoEntrega } from './entregables';

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
  // Ronda 7: terminó RESPONDIENDO (una consulta o un texto en el chat). Terminal, pero NUNCA comprobada ni completada:
  // «te respondí con lo que encontré; si además pediste algo, eso NO está comprobado» (ronda 8: nunca «no hice nada»).
  'respondida',
  'partial',
  'failed',
  'blocked',
  'cancelling',
  'cancelled',
] as const;
export type EstadoTarea = (typeof ESTADOS_TAREA)[number];

export const TERMINALES: ReadonlySet<EstadoTarea> = new Set<EstadoTarea>(['completed', 'respondida', 'partial', 'failed', 'cancelled']);
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
  | { tipo: 'tarea-en-curso'; ambito: string; tareaId: string }
  | VinculoTaller;

/**
 * Lo que el taller de la junta propone y solo hace con su aprobación (revisión 10, MEDIO-C; lib/taller.ts): la acción,
 * sus argumentos CONGELADOS (lo que se ejecuta es esto, no lo que se vuelva a entender del chat), la cuenta que la pidió,
 * quién era en el padrón y la `huella` (cuenta + acción + destino configurado + contenido + versión). Si al aprobar la
 * huella recalculada no es la misma (otro contenido, otro destino, otra cuenta), no se ejecuta.
 */
export type VinculoTaller = { tipo: 'taller'; accion: string; args: Record<string, unknown>; cuenta: string; quien: string | null; huella: string; version: number };

export type Decision = {
  id: string;
  /** Qué clase de decisión: aprobar una acción con efecto, elegir entre respuestas, seguir o no una tarea. */
  tipo: 'aprobar-accion' | 'elegir' | 'continuar-tarea';
  pregunta: string;
  porque: string;
  /**
   * `texto` y `asunto` (José, 5-oct): el texto ENTERO del borrador y su asunto, para que la ventana de decisión lo
   * muestre tal cual y se pueda editar (en `datos` va recortado). Solo informativos: lo que se aprueba es la huella.
   */
  propuesta: { accion: string; cuenta?: string; destinatario?: string; datos: string[]; importe?: string; recurrencia?: string; alcance: string; texto?: string; asunto?: string };
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
  /**
   * A7: la huella del dueño (`huellaDueno`, nunca el correo). La traen las tareas creadas desde esta versión; el
   * inventario la exige igual a la de quien pregunta. Las de antes no la tienen (ver `pertenencia`). No sale al cliente.
   */
  dueno?: string;
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
/**
 * Cuántas tareas TERMINADAS recuerda el índice de cada dueño (P5/A7). Las que no se sabe que terminaron no se recortan
 * nunca: antes el índice guardaba las 40 más nuevas y la 41.ª tarea activa sacaba a la primera, que seguía en cola.
 */
export const MAX_HISTORIAL_INDICE = 200;
/** Versión del esquema de la tarea durable y de su índice (va en el manifiesto de entrega). */
export const ESQUEMA_TAREAS = 1;
export const ESQUEMA_INDICE = 2;
export const ESPACIO_TAREAS = 'tareas';
export const ESPACIO_PEDIDOS = 'tareas/pedidos';
export const ESPACIO_INDICE = 'tareas/indice';
/** A7: versión del inventario que marca un índice como reconciliado (subirla obliga a reconciliar otra vez). */
export const ESQUEMA_INVENTARIO = 1;
/** A7: la copia del índice tal como estaba ANTES de la primera reconciliación que le agregó algo (para revertir). */
export const ESPACIO_RESPALDO_INDICE = 'tareas/indice-respaldo';

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

/**
 * ¿Cada criterio obligatorio quedó verificado con SU evidencia? (invariante 5). Con las evidencias del resultado
 * (`evidencias`), además: cada id que cita un criterio existe en el resultado, y una evidencia de ARCHIVO respalda a lo
 * más un criterio obligatorio (un archivo no cumple dos cosas pedidas; una lista compartida copiada a todos no vale).
 */
export function criteriosCumplidos(criterios: Criterio[], evidencias?: Evidencia[] | null): boolean {
  const obligatorios = criterios.filter((c) => c.obligatorio);
  if (!obligatorios.every((c) => c.estado === 'verified' && c.evidencias.length > 0)) return false;
  if (!evidencias) return true;
  const porId = new Map(evidencias.map((e) => [e.id, e]));
  const archivos = new Set<string>();
  for (const c of obligatorios) {
    for (const id of c.evidencias) {
      const e = porId.get(id);
      if (!e) return false;
      if (e.tipo === 'archivo') {
        const clave = e.ref || e.id;
        if (archivos.has(clave)) return false;
        archivos.add(clave);
      }
    }
  }
  return true;
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
  /** Fase 2: el objetivo con estado al que pertenece (lib/objetivos.ts). null lo desliga. */
  objetivoId?: string | null;
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
  const resultado = c.resultado !== undefined ? c.resultado : reg.resultado;
  if (a === 'completed' && !criteriosCumplidos(criterios, resultado ? resultado.evidencias : null)) return { ok: false, motivo: 'sin-evidencia' };
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
  if (c.objetivoId !== undefined) {
    if (c.objetivoId === null) delete n.objetivoId;
    else n.objetivoId = texto(c.objetivoId, 40);
  }
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
  // P5/A7: el índice ANTES que el objeto. Una tarea que existe siempre está en su índice (antes se escribía la tarea, el
  // índice fallaba con un aviso en el log y la tarea «creada» no salía nunca en la lista). Si el índice no se puede
  // escribir, no se crea la tarea: el reintento del mismo pedido reserva el MISMO id y la deja anotada y creada. Una
  // entrada sin objeto (se cayó entre las dos escrituras) no es una tarea: la lista la salta y la poda con el tiempo.
  const ix = await indexar(dueno, r.id, ahora, a);
  if (ix.ok === false) return { ok: false, motivo: 'almacen', detalle: `no pude anotar la tarea en tu índice; no la creé (${ix.detalle.slice(0, 100)})` };
  // Si quien reservó murió antes de escribir la tarea, el siguiente la escribe con el MISMO id. Con la huella de su dueño
  // dentro (A7): el inventario no se fía solo de la carpeta en que está el objeto.
  const c = await crearUnaVez(claveTarea(dueno, r.id), { ...registroNuevo(r.id, d, ahora), dueno: huellaDueno(dueno) }, a);
  if (c.ok === false) return { ok: false, motivo: 'almacen', detalle: c.detalle };
  // Fase 2: lo que espera a que alguien lo corra (`queued`) o tiene una revisión programada entra en la agenda del
  // planificador (server/planificador.ts): sin esto, nadie lo miraba hasta que la persona abría la lista.
  if (c.creado) await agendarSiToca(dueno, null, c.valor, a);
  return { ok: true, creada: c.creado, tarea: c.valor };
}

/**
 * El índice de un dueño. `fin`: cuándo se supo que terminó (solo esas se recortan, las más viejas primero). Una entrada
 * sin `fin` es «puede seguir activa» (las del índice v1 no lo traen): la lista la lee y, si ya terminó, la repara.
 */
type EntradaIndice = {
  id: string;
  t: number;
  fin?: number;
  /** A7: la ronda de inventario que la recuperó (para revertir). */
  rec?: string;
  /** Cuándo la recuperó (para revertir: si el objeto cambió después, ya es historial propio). Las de a46b496 no lo traen. */
  rt?: number;
};
/**
 * A7: constancia de que el inventario de este dueño se recorrió ENTERO y lo que faltaba quedó anotado. `dr`: cuánto subió
 * `recortadas` al marcarlo (lo que contó el inventario; informativo: la reversión descuenta lo que de verdad vuelve). Las
 * marcas de a46b496 no lo traen.
 */
type MarcaInventario = {
  v: number;
  t: number;
  fuente: AlmacenDurable['tipo'];
  ronda: string;
  revisadas: number;
  agregadas: number;
  dr?: number;
  /** Revisión sobre 8b9e9ca: el respaldo de SU ciclo (sufijo de `claveRespaldo`); la reversión usa este, no lo recalcula. */
  respaldo?: string;
};
/**
 * Revisión externa sobre a46b496: constancia de que operación REVIRTIÓ la reconciliación de este dueño. Vive en el índice
 * (no en la memoria de una réplica): mientras esté y su `gen` llegue a la generación vigente
 * (`AURA_RECONCILIAR_TAREAS_GENERACION`), ninguna réplica vuelve a reconciliar a este dueño ni a agregarle nada. Se quita
 * con `reactivarReconciliacionTareas` (un dueño) o subiendo la generación (todos). `restaurado`: ya se devolvió lo que el
 * recorte del inventario sacó del índice de antes (no se repite). `respaldo`: de qué respaldo salió eso.
 */
type MarcaReversion = {
  v: 1;
  t: number;
  gen: number;
  ronda: string | null;
  respaldo: string;
  restaurado: boolean;
  quitadas: number;
  conservadas: number;
  restauradas: number;
  pendientes: number;
  /** Revisión sobre 8b9e9ca: lo que falta devolver del índice de antes (no se pudo leer); 0 con `restaurado`. */
  porRestaurar?: number;
};
/**
 * A7: un recorrido del inventario a medias (reanudable): hasta qué clave se revisó sin dudas y lo que se lleva. Vive EN el
 * índice, en la misma escritura CAS que lo que agrega: si el índice se pierde o lo rehace otro, el avance se va con él
 * y el recorrido empieza de nuevo (nunca se marca reconciliado con la mitad de un recorrido sobre otro índice).
 */
type PaseInventario = {
  ronda: string;
  desde: string | null;
  revisadas: number;
  agregadas: number;
  sinVerificar: number;
  inicio: number;
  actualizado: number;
  fin?: number;
  /** Las suyas vistas en el recorrido (en el índice o recuperadas): para contar las recortadas al terminar. */
  propias?: number;
  /** El respaldo del ciclo de este recorrido (ver `MarcaInventario.respaldo`). */
  respaldo?: string;
};
/**
 * `inventario`/`pase`: A7. Un servidor de antes los ignora (y al reescribir el índice los pierde: vuelve a «sin reconciliar»).
 * `recortadas` (revisión 13): cuántas tareas TERMINADAS de este dueño existen todavía pero el tope del historial
 * (MAX_HISTORIAL_INDICE) ya no lista. Sube con cada recorte; el inventario, al terminar un recorrido entero, la deja en lo
 * que contó (lo que encontró menos lo que el índice guarda). Una terminada que vuelve al índice (se leyó por su id) la
 * descuenta. Es una cuenta, no una lista de ids (esas ya no están en el índice).
 * `revertido`/`reversiones` (revisión externa sobre a46b496): la reconciliación de este dueño se revirtió (y cuántas veces,
 * para que cada generación de inventario guarde su propio respaldo). Un servidor de antes los conserva al escribir (copia
 * el resto del índice) pero no los respeta: ver docs/entregas/ROLLBACK-COORDINADO.md §7.
 */
type Indice = { v: 1 | 2; ids: EntradaIndice[]; inventario?: MarcaInventario; pase?: PaseInventario; recortadas?: number; revertido?: MarcaReversion; reversiones?: number };

/** Recorta el índice: todas las que pueden seguir activas y las MAX_HISTORIAL_INDICE terminadas más recientes. */
function recortarIndice(ids: EntradaIndice[]): EntradaIndice[] {
  const terminadas = ids.filter((x) => x.fin).sort((x, y) => y.fin! - x.fin!);
  const fuera = new Set(terminadas.slice(MAX_HISTORIAL_INDICE).map((x) => x.id));
  return fuera.size ? ids.filter((x) => !fuera.has(x.id)) : ids;
}

/** El índice con `ids` recortados, y la cuenta de las que el recorte dejó fuera sumada a `recortadas`. */
function conRecorte(ix: Indice | null, ids: EntradaIndice[]): Indice {
  const quedan = recortarIndice(ids);
  const fuera = ids.length - quedan.length;
  const recortadas = (Number(ix?.recortadas) || 0) + fuera;
  const { recortadas: _r, ...resto } = ix || ({} as Partial<Indice>);
  return { ...resto, v: 2, ids: quedan, ...(recortadas > 0 ? { recortadas } : {}) };
}

async function indexar(dueno: string, id: string, ahora: number, a: AlmacenDurable): Promise<{ ok: true } | { ok: false; detalle: string }> {
  let ultimo = '';
  // Un fallo pasajero del almacén se reintenta una vez (los conflictos ya los reintenta modificarDurable).
  for (let i = 0; i < 2; i++) {
    const r = await modificarDurable<Indice>(
      claveIndice(dueno),
      (ix) => {
        const ids = ix?.ids || [];
        if (ids.some((x) => x.id === id)) return undefined;
        // Lo demás del índice (la marca y el avance del inventario) se conserva: anotar una tarea nueva no lo invalida.
        return conRecorte(ix, [{ id, t: ahora }, ...ids]);
      },
      a
    );
    if (r.ok === true) return { ok: true };
    ultimo = r.detalle;
  }
  console.warn('[tareas] no pude anotar la tarea en el índice (no se crea):', ultimo.slice(0, 120));
  return { ok: false, detalle: ultimo };
}

/**
 * Repara el índice con lo que se aprendió al leer: `fin` para las que ya terminaron, fuera las entradas sin objeto que
 * llevan más de un día (una creación que se cayó a medias) y dentro una tarea que existe y no estaba (`agregar`).
 * Lo mejor posible: si falla, el índice queda como estaba (nunca se pierde una activa por esto).
 */
async function repararIndice(dueno: string, r: { fines?: Map<string, number>; podar?: Set<string>; agregar?: EntradaIndice }, a: AlmacenDurable): Promise<Indice | null> {
  if (!r.fines?.size && !r.podar?.size && !r.agregar) return null;
  // Devuelve el índice que quedó escrito (null si no cambió o falló): la lista cuenta con él lo que el recorte dejó fuera.
  const w = await modificarDurable<Indice>(
    claveIndice(dueno),
    (ix) => {
      let ids = ix?.ids || [];
      let cambio = false;
      let base = ix;
      if (r.agregar && !ids.some((x) => x.id === r.agregar!.id)) {
        ids = [r.agregar, ...ids];
        cambio = true;
        // Una terminada que no estaba es (casi siempre) una que el tope recortó: vuelve, y deja de contarse como recortada.
        if (r.agregar.fin && Number(ix?.recortadas) > 0) base = { ...ix!, recortadas: Number(ix!.recortadas) - 1 };
      }
      ids = ids.flatMap((x) => {
        if (r.podar?.has(x.id)) {
          cambio = true;
          return [];
        }
        const fin = r.fines?.get(x.id);
        if (fin && !x.fin) {
          cambio = true;
          return [{ ...x, fin }];
        }
        return [x];
      });
      return cambio ? conRecorte(base, ids) : undefined;
    },
    a
  ).catch(() => null);
  return w && w.ok === true && w.cambiado ? w.valor : null;
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
  // A7: si el objeto dice de quién es y no es de quien pregunta, para él no existe (404), esté en la carpeta que esté.
  return { ok: true, tarea: l.valor && !esDeOtro(l.valor, dueno) ? l.valor : null };
}

/** ¿El registro trae la huella de OTRO dueño? (Las tareas de antes no la traen: para ellas no se puede decir.) */
const esDeOtro = (reg: Pick<RegistroTarea, 'dueno'>, dueno: string) => reg.dueno !== undefined && reg.dueno !== huellaDueno(dueno);

/**
 * Una tarea que se leyó directamente por su id (la app la tenía de una respuesta del chat): si existe y no estaba en el
 * índice (una tarea de antes de P5 que el tope de 40 sacó), se vuelve a anotar. Así el índice es REPARABLE.
 */
export async function asegurarEnIndice(dueno: string, reg: Pick<RegistroTarea, 'id' | 'creada' | 'estado' | 'actualizada'>, a: AlmacenDurable = almacenDurable()): Promise<void> {
  const ix = await leerDurable<Indice>(claveIndice(dueno), a).catch(() => null);
  if (!ix || ix.ok === false || ix.valor?.ids.some((x) => x.id === reg.id)) return;
  await repararIndice(dueno, { agregar: { id: reg.id, t: reg.creada, ...(esTerminal(reg.estado) ? { fin: reg.actualizada } : {}) } }, a);
}

/* ------------------------------------------------------------------ inventario (A7) */

/*
 * A7 (auditoría del 5-oct): con un índice v1 al que le faltaba la entrada de UNA tarea (el objeto intacto), la lista
 * devolvía 40 de 41 con `completo: true`: «completo» solo decía que los ids del índice se leyeron, no que el índice
 * tuviera todas las tareas. Aquí se separan las dos verdades:
 *   · «leí bien esta página» (`paginaLeida`: ningún id del índice falló al leerse);
 *   · «el inventario de este dueño está reconciliado» (`reconciliado`: el índice trae la marca `inventario`, que solo se
 *     pone después de recorrer ENTERA la fuente de inventario).
 * `completo` = las dos. Sin la marca, la lista dice `reconciliado: false` y no promete nada, aunque cada id se lea bien.
 *
 * La fuente de inventario es la enumeración del almacén (`AlmacenDurable.listar`: ListObjectsV2 en S3, readdir en el
 * disco) sobre `tareas/<huella del dueño>/`: un prefijo POR DUEÑO (`claveDe`), así que nunca se listan objetos de otro.
 * Aun así, la carpeta no basta: cada objeto que no está en el índice se lee y se comprueba que es de este dueño
 * (`pertenencia`). Las fases van separadas: inventario y comparación (`diagnosticarTramo`, solo lee) → propuesta (las
 * entradas que faltan) → aplicar (`reconciliarInventarioTareas`: respaldo del índice, y luego una fusión CAS que solo
 * AGREGA; nunca reemplaza el índice con una foto vieja ni borra objetos).
 *
 * Interruptor: `AURA_RECONCILIAR_TAREAS` = `agregar` (por omisión: agrega lo que falta) · `diagnostico` (inventaría y
 * compara, no escribe nada) · `off` (ni lista). Con `diagnostico` u `off` el índice nunca se marca reconciliado: la lista
 * sigue diciendo `completo: false` (no se fabrica la garantía apagando el interruptor).
 *
 * Reversión por dueño (`revertirReconciliacionTareas`, más abajo): quita lo agregado que no tuvo actividad, devuelve lo
 * que el recorte sacó y deja `revertido` en el índice; con esa marca (y `gen` ≥ `AURA_RECONCILIAR_TAREAS_GENERACION`) el
 * dueño queda `inventario: 'revertido'` y nadie lo vuelve a reconciliar hasta `reactivarReconciliacionTareas` o una
 * generación nueva.
 */

export type ModoReconciliacion = 'agregar' | 'diagnostico' | 'apagado';
export function modoReconciliacion(env: NodeJS.ProcessEnv = process.env): ModoReconciliacion {
  const v = String(env.AURA_RECONCILIAR_TAREAS ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (['0', 'off', 'no', 'false', 'apagado'].includes(v)) return 'apagado';
  if (v === 'diagnostico' || v === 'solo-diagnostico') return 'diagnostico';
  return 'agregar';
}

/**
 * La generación de inventario vigente (`AURA_RECONCILIAR_TAREAS_GENERACION`, entero ≥ 1; 1 por omisión). Un dueño revertido
 * en la generación N no se vuelve a reconciliar mientras la vigente sea ≤ N; subirla reactiva a todos los revertidos de
 * una vez (cada uno se reconcilia en su siguiente lectura). Para uno solo: `reactivarReconciliacionTareas`.
 */
export function generacionReconciliacion(env: NodeJS.ProcessEnv = process.env): number {
  const n = Math.floor(Number(String(env.AURA_RECONCILIAR_TAREAS_GENERACION ?? '').trim()));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * Cómo está el inventario de un dueño. Solo `reconciliado` permite `completo: true`; los demás son honestos sobre por qué
 * no: `en-curso` (recorrido a medias, se sigue en la próxima lectura) · `sin-verificar` (hay objetos en su carpeta cuya
 * pertenencia no se pudo demostrar: no se adoptan ni se cuentan) · `sin-fuente` (el almacén no enumera) · `apagado` /
 * `diagnostico` (el interruptor) · `error` (el almacén no contestó: la incertidumbre se conserva) · `revertido`
 * (operación revirtió la reconciliación de este dueño: no se reconcilia hasta que la reactive).
 */
export type EstadoInventario = 'reconciliado' | 'en-curso' | 'sin-verificar' | 'sin-fuente' | 'apagado' | 'diagnostico' | 'error' | 'revertido';
export type ResultadoInventario = { estado: EstadoInventario; escribio: boolean; agregadas: number; recuperables?: number };
/** Cuánto trabajo hace UNA lectura de la lista mientras el inventario no está reconciliado (el resto, en la siguiente). */
export type PresupuestoInventario = { porListado: number; listados: number; lecturas: number };
const PRESUPUESTO_INVENTARIO: PresupuestoInventario = { porListado: 1000, listados: 3, lecturas: 40 };
/** Un recorrido que terminó con objetos sin verificar no se repite en cada lectura: espera esto. */
const REINTENTO_SIN_VERIFICAR_MS = 15 * 60_000;

/**
 * Revisión 13 (A7): un listado que falla (p. ej. S3 sin `s3:ListBucket`: un 403 que no se arregla solo) no se repite en
 * cada lectura de la lista. Antes cada GET /api/trabajos, cada página y la ruta del borrador del chat volvían a pedir el
 * LIST (21 lecturas → 21 LIST; el teléfono consulta cada 3 s). Ahora el fallo se recuerda POR DUEÑO entre 5 y 15 min (al
 * azar, para que las réplicas y los dueños no reintenten todos a la vez) y, mientras tanto, la lista contesta sin listar y
 * honesta: `inventario: 'error'`, `reconciliado: false`, `completo: false`.
 *
 * Vive en la memoria de este proceso (cada réplica lo recuerda por su cuenta: a lo más un LIST por dueño, réplica y
 * ventana) y por almacén (las pruebas usan varios). Un dueño ya reconciliado no lista nunca: la marca `inventario` del
 * índice lo dice antes de llegar aquí, y solo se vuelve a recorrer si el índice la pierde (lo reescribió un servidor de
 * antes, o se rehízo).
 */
const ESPERA_LISTADO_MIN_MS = 5 * 60_000;
const ESPERA_LISTADO_MAX_MS = 15 * 60_000;
const MAX_ESPERAS_LISTADO = 5_000;
let esperasListado = new WeakMap<AlmacenDurable, Map<string, number>>();

/** Hasta cuándo no se vuelve a listar a este dueño (0 si se puede ya). */
function esperaListado(dueno: string, a: AlmacenDurable, ahora: number): number {
  const hasta = esperasListado.get(a)?.get(huellaDueno(dueno)) ?? 0;
  return hasta > ahora ? hasta : 0;
}

function recordarFalloListado(dueno: string, a: AlmacenDurable, ahora: number) {
  let m = esperasListado.get(a);
  if (!m) esperasListado.set(a, (m = new Map()));
  // Acotado: primero se van las vencidas; si aun así no cabe, la más vieja (un Map recorre en orden de inserción).
  if (m.size >= MAX_ESPERAS_LISTADO) {
    for (const [k, v] of m) if (v <= ahora) m.delete(k);
    if (m.size >= MAX_ESPERAS_LISTADO) m.delete(m.keys().next().value!);
  }
  const h = huellaDueno(dueno);
  m.delete(h);
  m.set(h, ahora + ESPERA_LISTADO_MIN_MS + Math.floor(Math.random() * (ESPERA_LISTADO_MAX_MS - ESPERA_LISTADO_MIN_MS)));
}

const olvidarFalloListado = (dueno: string, a: AlmacenDurable) => esperasListado.get(a)?.delete(huellaDueno(dueno));

/** Solo pruebas: olvida las esperas por listados fallidos (como si hubieran pasado los minutos). */
export function _olvidarEsperasListado() {
  esperasListado = new WeakMap();
}

const indiceReconciliado = (ix: Indice | null | undefined) => !!ix?.inventario && Number(ix.inventario.v) >= ESQUEMA_INVENTARIO;
/** ¿Operación revirtió a este dueño y la reversión sigue en pie para la generación `gen`? */
const indiceRevertido = (ix: Indice | null | undefined, gen: number) => !!ix?.revertido && Number(ix.revertido.gen) >= gen;
/**
 * El respaldo del índice de antes de cada generación de inventario de un dueño: la primera (nunca revertida) usa la clave de
 * siempre (`antes-de-inventario-v1`); tras la reversión número n, la siguiente reconciliación guarda el suyo en `…-r<n>`.
 */
const sufijoRespaldo = (reversiones: unknown) => (Number(reversiones) > 0 ? `-r${Math.floor(Number(reversiones))}` : '');
/**
 * Revisión externa sobre 8b9e9ca: el respaldo del ciclo que hay que revertir. El que anotó la reconciliación (o la reversión
 * ya empezada) manda; solo un índice de antes de esta revisión (sin anotarlo) lo deduce del número de reversiones.
 */
const respaldoDe = (ix: Indice | null | undefined): string => ix?.revertido?.respaldo ?? ix?.inventario?.respaldo ?? ix?.pase?.respaldo ?? sufijoRespaldo(ix?.reversiones);
const claveRespaldo = (dueno: string, sufijo = '') => claveDe(ESPACIO_RESPALDO_INDICE, dueno, `antes-de-inventario-v${ESQUEMA_INVENTARIO}${sufijo}`);
const prefijoTareas = (dueno: string) => `${ESPACIO_TAREAS}/${huellaDueno(dueno)}`;
/** Un id de tarea tal como lo escribe `crearTarea` (lo que no lo es no es una tarea: no entra al inventario). */
const ES_ID_TAREA = /^(?!h_)[A-Za-z0-9-][A-Za-z0-9_-]{3,63}$/;

let avisadoInventario = 0;
/** Un aviso en el log a lo más cada 10 min, sin correo, huella, ids ni títulos (solo qué falló). */
function avisarInventario(que: string, detalle: string) {
  const t = Date.now();
  if (t - avisadoInventario < 600_000) return;
  avisadoInventario = t;
  console.warn(`[tareas] inventario sin reconciliar (${que}):`, String(detalle || '').replace(/[0-9a-f]{16,}/gi, '…').replace(/tk_[a-z0-9]+/gi, 'tk_…').slice(0, 120));
}

type Pertenencia = { tipo: 'propia'; reg: RegistroTarea } | { tipo: 'ajena' } | { tipo: 'sin-prueba' } | { tipo: 'nada' } | { tipo: 'error'; detalle: string };

/**
 * ¿El objeto `id` de la carpeta de este dueño es de verdad suyo? Se lee por su clave canónica (`claveTarea(dueno, id)`)
 * y se exige que diga ser la tarea `id`. Después:
 *   · si trae `dueno` (las creadas desde A7): tiene que ser exactamente la huella de quien pregunta; otra → `ajena`;
 *   · si no lo trae (las de antes, que nunca lo guardaron): la reserva de su pedido (`tareas/pedidos/<huella>/<requestId>`,
 *     escrita en la misma creación autenticada) tiene que apuntar a ESTE id. Sin esa segunda constancia → `sin-prueba`
 *     (no se adopta y el inventario queda sin reconciliar).
 * Un fallo al leer es `error` (no es «no es suya» ni «no existe»).
 */
async function pertenencia(dueno: string, id: string, a: AlmacenDurable): Promise<Pertenencia> {
  // Crudo (no `leerTarea`, que ya esconde las de otro): aquí hay que distinguir «de otro» de «no existe».
  const l = await leerDurable<RegistroTarea>(claveTarea(dueno, id), a).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
  if (l.ok === false) return { tipo: 'error', detalle: l.detalle };
  const reg = l.valor;
  if (!reg) return { tipo: 'nada' };
  if (typeof reg !== 'object' || reg.v !== 1 || reg.id !== id || typeof reg.requestId !== 'string' || !reg.requestId) return { tipo: 'sin-prueba' };
  if (reg.dueno !== undefined) return reg.dueno === huellaDueno(dueno) ? { tipo: 'propia', reg } : { tipo: 'ajena' };
  const p = await leerDurable<{ id?: unknown }>(claveDe(ESPACIO_PEDIDOS, dueno, reg.requestId), a).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
  if (p.ok === false) return { tipo: 'error', detalle: p.detalle };
  return p.valor && String(p.valor.id) === id ? { tipo: 'propia', reg } : { tipo: 'sin-prueba' };
}

/**
 * Inventario + comparación de un TRAMO (solo lee; no escribe nada). Desde la clave que sigue a `desde`, enumera la carpeta
 * del dueño; lo que ya está en el índice no se lee; lo que falta se lee y se comprueba (`pertenencia`). `propuesta`: las
 * entradas que habría que agregar (solo de las suyas). `hasta`: la última clave revisada SIN dudas (de ahí se reanuda):
 * un fallo de lectura para el tramo justo antes de esa clave. `agotado`: se llegó al final de la fuente sin fallos.
 */
type Tramo =
  | { ok: true; revisadas: number; enIndice: number; propuesta: EntradaIndice[]; ajenas: number; sinVerificar: number; hasta: string | null; agotado: boolean; fallo?: string }
  | { ok: false; sinFuente: boolean; detalle: string };

async function diagnosticarTramo(dueno: string, enIndice: Set<string>, desde: string | null, p: PresupuestoInventario, a: AlmacenDurable): Promise<Tramo> {
  if (!a.listar) return { ok: false, sinFuente: true, detalle: `el almacén ${a.tipo} no enumera` };
  const prefijo = prefijoTareas(dueno);
  const r = { revisadas: 0, enIndice: 0, propuesta: [] as EntradaIndice[], ajenas: 0, sinVerificar: 0 };
  let hasta = desde;
  let lecturas = 0;
  for (let n = 0; n < Math.max(1, p.listados); n++) {
    const l = await a.listar(prefijo, { desde: hasta, max: p.porListado }).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
    if (l.ok === false) return hasta === desde ? { ok: false, sinFuente: false, detalle: l.detalle } : { ok: true, ...r, hasta, agotado: false, fallo: l.detalle };
    for (let i = 0; i < l.claves.length; i += 10) {
      const tanda = l.claves.slice(i, i + 10).map((clave) => {
        const id = clave.slice(prefijo.length + 1);
        return { clave, id, leer: ES_ID_TAREA.test(id) && !enIndice.has(id) };
      });
      const porLeer = tanda.filter((x) => x.leer).length;
      if (porLeer && lecturas > 0 && lecturas + porLeer > p.lecturas) return { ok: true, ...r, hasta, agotado: false };
      lecturas += porLeer;
      const vistas = await Promise.all(tanda.map((x) => (x.leer ? pertenencia(dueno, x.id, a) : null)));
      for (let j = 0; j < tanda.length; j++) {
        const x = tanda[j];
        const v = vistas[j];
        if (v?.tipo === 'error') return { ok: true, ...r, hasta, agotado: false, fallo: v.detalle };
        hasta = x.clave;
        if (!ES_ID_TAREA.test(x.id)) continue;
        r.revisadas++;
        if (!v) r.enIndice++;
        else if (v.tipo === 'propia') r.propuesta.push({ id: x.id, t: v.reg.creada, ...(esTerminal(v.reg.estado) ? { fin: v.reg.actualizada } : {}) });
        else if (v.tipo === 'ajena') r.ajenas++;
        else if (v.tipo === 'sin-prueba') r.sinVerificar++;
      }
    }
    if (!l.truncado) return { ok: true, ...r, hasta, agotado: true };
  }
  return { ok: true, ...r, hasta, agotado: false };
}

/**
 * Diagnóstico completo, SOLO LECTURA (para revisar antes de aplicar o con `AURA_RECONCILIAR_TAREAS=diagnostico`): recorre
 * toda la carpeta del dueño y devuelve qué se agregaría. No escribe nada. Es del servidor (operación), no de una ruta.
 */
export async function diagnosticarInventarioTareas(
  dueno: string,
  a: AlmacenDurable = almacenDurable()
): Promise<{ ok: true; reconciliado: boolean; revisadas: number; enIndice: number; propuesta: EntradaIndice[]; ajenas: number; sinVerificar: number; agotado: boolean; fallo?: string } | { ok: false; sinFuente: boolean; detalle: string }> {
  const ix = await leerDurable<Indice>(claveIndice(dueno), a);
  if (ix.ok === false) return { ok: false, sinFuente: false, detalle: ix.detalle };
  const d = await diagnosticarTramo(dueno, new Set((ix.valor?.ids || []).map((x) => x.id)), null, { porListado: 1000, listados: 100_000, lecturas: Infinity }, a);
  if (d.ok === false) return d;
  const { hasta: _h, ...resto } = d;
  return { ...resto, reconciliado: indiceReconciliado(ix.valor) };
}

/**
 * Un paso de la reconciliación del inventario de un dueño (idempotente y reanudable). Lo llama la lista mientras el índice
 * no está reconciliado; también se puede llamar aparte. Cada paso:
 *   1. lee el índice; si ya está reconciliado, nada;
 *   2. inventaría y compara un tramo desde donde quedó el recorrido (`pase.desde`), sin escribir;
 *   3. si hay algo que agregar, guarda UNA vez el índice tal como estaba antes (respaldo para revertir);
 *   4. fusiona con CAS: agrega solo lo que falta (lo que otro anotó entretanto se queda), avanza el recorrido y, si se
 *      llegó al final sin dudas, pone la marca `inventario`. Si el índice ya no es el del recorrido (se perdió, otro avanzó),
 *      no escribe: la próxima lectura sigue o empieza otra vez.
 * Un fallo en cualquier punto deja el índice como estaba (o con el avance hasta lo último revisado sin dudas): nunca se
 * marca reconciliado sin haber recorrido toda la fuente.
 */
export async function reconciliarInventarioTareas(
  dueno: string,
  o: { ahora?: number; modo?: ModoReconciliacion; presupuesto?: Partial<PresupuestoInventario>; /** Operación: no espera tras un listado fallido. */ forzar?: boolean } = {},
  a: AlmacenDurable = almacenDurable()
): Promise<ResultadoInventario> {
  const modo = o.modo ?? modoReconciliacion();
  const ahora = o.ahora ?? Date.now();
  const nada = (estado: EstadoInventario, extra: Partial<ResultadoInventario> = {}): ResultadoInventario => ({ estado, escribio: false, agregadas: 0, ...extra });
  if (modo === 'apagado') return nada('apagado');
  if (!a.listar) return nada('sin-fuente');
  const gen = generacionReconciliacion();
  const ix = await leerDurable<Indice>(claveIndice(dueno), a).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
  if (ix.ok === false) return nada('error');
  const indice = ix.valor;
  if (indiceReconciliado(indice)) return nada('reconciliado');
  // Revertido por operación (la marca está en el índice: la ven todas las réplicas): ni se lista ni se agrega nada.
  if (indiceRevertido(indice, gen)) return nada('revertido');
  // Revisión 13: el último listado de este dueño falló hace poco: no se vuelve a pedir todavía (la incertidumbre se conserva).
  if (!o.forzar && esperaListado(dueno, a, ahora)) return nada('error');
  const presupuesto = { ...PRESUPUESTO_INVENTARIO, ...(o.presupuesto || {}) };
  const enIndice = new Set((indice?.ids || []).map((x) => x.id));
  if (modo === 'diagnostico') {
    const d = await diagnosticarTramo(dueno, enIndice, null, presupuesto, a);
    if (d.ok === false) {
      avisarInventario('diagnóstico', d.detalle);
      if (!d.sinFuente) recordarFalloListado(dueno, a, ahora);
    } else olvidarFalloListado(dueno, a);
    return nada('diagnostico', d.ok ? { recuperables: d.propuesta.length } : {});
  }
  let pase = indice?.pase;
  if (pase?.fin) {
    // Terminó con objetos sin verificar: no se repite en cada lectura.
    if (ahora - pase.fin < REINTENTO_SIN_VERIFICAR_MS) return nada('sin-verificar');
    pase = undefined;
  }
  const ronda = pase?.ronda ?? `inv_${ahora.toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const desde = pase?.desde ?? null;
  // Revisión externa sobre 8b9e9ca: el CICLO (cuántas reversiones lleva el índice) de la foto con la que trabaja este paso.
  // Una réplica que se quedó colgada en el LIST mientras otra reconciliaba, operación revertía y reactivaba, trae una foto
  // de un ciclo anterior: su respaldo es el de ese ciclo y lo que agregue no lo podría revertir el ciclo vigente (dejaba
  // 199 de 200). Esa réplica no escribe el índice (lo cerca el CAS) ni el respaldo (se mira el ciclo justo antes).
  const ciclo = Number(indice?.reversiones) || 0;
  const respaldo = sufijoRespaldo(ciclo);
  const d = await diagnosticarTramo(dueno, enIndice, desde, presupuesto, a);
  if (d.ok === false) {
    avisarInventario(d.sinFuente ? 'sin fuente' : 'listado', d.detalle);
    if (!d.sinFuente) recordarFalloListado(dueno, a, ahora);
    return nada(d.sinFuente ? 'sin-fuente' : 'error');
  }
  olvidarFalloListado(dueno, a);
  if (d.fallo) avisarInventario('lectura', d.fallo);
  if (d.hasta === desde && !d.agotado) return nada(d.fallo ? 'error' : 'en-curso');
  if (d.propuesta.length) {
    // Antes de guardar el respaldo, el índice tiene que seguir en el ciclo de la foto: si no, ni el respaldo se escribe.
    const ahoraIx = await leerDurable<Indice>(claveIndice(dueno), a).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
    if (ahoraIx.ok === false) return nada('error');
    if (indiceRevertido(ahoraIx.valor, gen)) return nada('revertido');
    if ((Number(ahoraIx.valor?.reversiones) || 0) !== ciclo) return nada('en-curso');
    // El índice como estaba ANTES de que el inventario le agregara nada (una sola vez por dueño, esquema y generación).
    const resp = await crearUnaVez(claveRespaldo(dueno, respaldo), { v: 1, t: ahora, ronda, indice: indice ?? null }, a);
    if (resp.ok === false) {
      avisarInventario('respaldo', resp.detalle);
      return nada('error');
    }
  }
  let agregadas = 0;
  let aborto: 'ya' | 'otro' | 'revertido' | 'ciclo' | null = null;
  let marcado = false;
  const w = await modificarDurable<Indice>(
    claveIndice(dueno),
    (actual) => {
      agregadas = 0;
      aborto = null;
      marcado = false;
      if (indiceReconciliado(actual)) return void (aborto = 'ya');
      // Operación revirtió mientras esta réplica listaba: lo que encontró no se escribe (ni aunque fuera su primer tramo).
      if (indiceRevertido(actual, gen)) return void (aborto = 'revertido');
      // Otro ciclo (operación revirtió, y quizá reactivó, desde la foto de este paso): nada de lo suyo vale ya.
      if ((Number(actual?.reversiones) || 0) !== ciclo) return void (aborto = 'ciclo');
      const p0 = actual?.pase;
      // El recorrido tiene que seguir siendo este y estar donde se dejó; si no, no se escribe nada.
      if (pase ? !p0 || p0.fin || p0.ronda !== ronda || (p0.desde ?? null) !== desde : p0 && !p0.fin) return void (aborto = 'otro');
      const previo = pase && p0 ? p0 : null;
      const ids = actual?.ids || [];
      const ya = new Set(ids.map((x) => x.id));
      const nuevas = d.propuesta.filter((x) => !ya.has(x.id)).map((x) => ({ ...x, rec: ronda, rt: ahora }));
      const fusion = nuevas.length ? recortarIndice([...ids, ...nuevas]) : ids;
      agregadas = fusion.filter((x) => !ya.has(x.id)).length;
      const revisadas = (previo?.revisadas ?? 0) + d.revisadas;
      const sinVerificar = (previo?.sinVerificar ?? 0) + d.sinVerificar;
      const total = (previo?.agregadas ?? 0) + agregadas;
      const propias = (previo?.propias ?? 0) + d.enIndice + d.propuesta.length;
      // Una reversión de una generación anterior (la vigente es mayor) deja de valer en cuanto esta generación escribe.
      const { pase: _p, inventario: _i, revertido: _r, ...resto } = actual || ({ v: 2, ids: [] } as Indice);
      const base: Indice = { ...resto, v: 2, ids: fusion };
      if (d.agotado && sinVerificar === 0) {
        marcado = true;
        // Revisión 13: las suyas que el recorrido vio y el tope dejó fuera. Las que ya contaba el índice (recortadas antes)
        // las vuelve a ver el recorrido: se toma la mayor de las dos cuentas, nunca la suma (no se cuenta dos veces).
        const antes = Number(resto.recortadas) || 0;
        const recortadas = Math.max(antes, propias - fusion.length);
        return { ...base, ...(recortadas > 0 ? { recortadas } : {}), inventario: { v: ESQUEMA_INVENTARIO, t: ahora, fuente: a.tipo, ronda, revisadas, agregadas: total, dr: recortadas - antes, respaldo } };
      }
      return { ...base, pase: { ronda, desde: d.hasta, revisadas, agregadas: total, sinVerificar, inicio: previo?.inicio ?? ahora, actualizado: ahora, propias, respaldo, ...(d.agotado ? { fin: ahora } : {}) } };
    },
    a
  );
  if (w.ok === false) {
    avisarInventario('índice', w.detalle);
    return nada('error');
  }
  if (aborto === 'ya') return nada('reconciliado');
  if (aborto === 'revertido') return nada('revertido');
  if (aborto === 'otro' || aborto === 'ciclo') return nada('en-curso');
  const estado: EstadoInventario = marcado ? 'reconciliado' : d.agotado ? 'sin-verificar' : d.fallo ? 'error' : 'en-curso';
  return { estado, escribio: w.cambiado, agregadas };
}

/**
 * Desde cuándo una entrada recuperada cuenta «sin actividad»: su `rt`; en las de a46b496 (sin `rt`), el inicio de su ronda
 * (`inv_<ms en base 36><6 hex>`), que es anterior a la recuperación (así se conserva de más, nunca de menos). Sin
 * ninguno de los dos, 0: cualquier objeto cuenta como «con actividad» y la entrada se queda.
 */
function recuperadaEn(x: EntradaIndice): number {
  if (Number.isFinite(x.rt)) return Number(x.rt);
  const m = /^inv_([0-9a-z]+)[0-9a-f]{6}$/.exec(String(x.rec || ''));
  const t = m ? parseInt(m[1], 36) : NaN;
  return Number.isFinite(t) ? t : 0;
}

type Lectura = { ok: true; tarea: RegistroTarea | null } | { ok: false };
/** Lee varias tareas del dueño (de a 10; comprobando el dueño como `leerTarea`). Un fallo es `ok: false`, nunca «no existe». */
async function leerTareas(dueno: string, ids: string[], a: AlmacenDurable): Promise<Map<string, Lectura>> {
  const m = new Map<string, Lectura>();
  for (let i = 0; i < ids.length; i += 10) {
    const tanda = ids.slice(i, i + 10);
    const leidas = await Promise.all(tanda.map((id) => leerTarea(dueno, id, a).catch(() => ({ ok: false as const, detalle: '' }))));
    tanda.forEach((id, j) => {
      const l = leidas[j];
      m.set(id, l.ok ? { ok: true, tarea: l.tarea } : { ok: false });
    });
  }
  return m;
}

/** JSON con las claves ordenadas (para saber si una escritura cambiaría algo sin depender del orden de las claves). */
const canonico = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : 1))) : x));

export type ResultadoReversion =
  | {
      ok: true;
      /** Entradas del inventario sin actividad desde que se recuperaron: salen del índice (el objeto se queda). */
      quitadas: number;
      /** Entradas del inventario cuyo objeto cambió después: se quedan como historial propio (sin la marca `rec`). */
      conservadas: number;
      /** Entradas del índice de antes que el recorte del inventario había sacado y vuelven. */
      restauradas: number;
      /**
       * Lo que no se pudo leer (se queda tal cual, con su marca) MÁS lo que falta devolver del índice de antes (revisión
       * sobre 8b9e9ca: nunca 0 mientras `restaurado` sea false): repetir la reversión lo termina.
       */
      pendientes: number;
      /** Lo del índice de antes que el recorte sacó ya volvió (o no había nada que devolver). false: repetir la reversión. */
      restaurado: boolean;
      /** Ya estaba revertido y no había nada más que hacer (no se escribió nada y no queda nada pendiente). */
      ya: boolean;
      /**
       * Ese dueño no tiene índice ni respaldo de inventario (¿el correo está bien escrito?): no había nada que revertir y
       * no se escribió nada, ni la marca `revertido` (que lo dejaría bloqueado).
       */
      sinIndice?: true;
      /**
       * R16-2: ese dueño está reconciliado, pero el inventario no le agregó nada (sin entradas `rec`, `agregadas: 0` en la
       * marca, sin respaldo): no había nada que revertir y no se escribió nada, ni la marca `revertido`.
       */
      nadaQueRevertir?: true;
      /** No está el respaldo del índice de antes: lo que el recorte del inventario sacó no puede volver y sigue en `recortadas`. */
      sinRespaldo?: true;
      /** Con `aceptarIlegibles`: cuántas del índice de antes no se pudieron leer y quedan contadas en `recortadas`. */
      ilegibles?: number;
    }
  | { ok: false; detalle: string };

/**
 * REVERSIÓN de la reconciliación del inventario de un dueño (A7; revisión externa sobre a46b496: «el historial puede quedar
 * incompleto o reaparecer una tarea recuperada»). Operación, no una ruta. Regla:
 *   · sale del índice SOLO lo que agregó el inventario (`rec`), ya TERMINÓ y no tuvo actividad desde que se recuperó: su
 *     objeto no cambió (`actualizada`) después de `rt`. Una recuperada que después avanzó, terminó o se canceló ya es
 *     historial propio: se queda (sin `rec`). Una recuperada que sigue ACTIVA (no terminó) es trabajo vivo: se queda
 *     también, aunque nadie la tocara (revisión externa H4: esconderla otra vez es justo lo que A7 arregló). Lo que no se
 *     pudo leer se queda con su marca (`pendientes`) y no se quita a ciegas. Una sin objeto sale;
 *   · vuelve lo que el recorte del historial sacó del índice de antes al agregar lo recuperado (del respaldo de esa
 *     generación, solo si el objeto existe y es de este dueño), y se recorta otra vez con el tope;
 *   · `recortadas` deja de contar las terminadas que vuelven y suma lo que el recorte saque ahora. Lo que contó el
 *     inventario (`dr`) es lo que su recorte sacó del índice de antes: lo que de eso vuelve se descuenta UNA vez (H3:
 *     antes se restaban `dr` y lo que vuelve, dos veces lo mismo); lo que no puede volver (sin respaldo, `sinRespaldo`)
 *     se sigue contando (H4: nunca se pierde historial sin que la cuenta lo diga);
 *   · un dueño sin índice ni respaldo (un correo mal escrito) no tiene nada que revertir: no se escribe nada (`sinIndice`);
 *     tampoco uno RECONCILIADO al que el inventario no agregó nada (sin `rec`, `agregadas: 0` en la marca y sin respaldo):
 *     sigue reconciliado (`nadaQueRevertir`, R16-2). Sin la marca `inventario` sí se escribe `revertido` (bloqueo previo);
 *   · todo en UNA fusión CAS sobre el índice ACTUAL (nunca una foto vieja): lo creado, cambiado o anotado después de la
 *     reconciliación —o durante esta reversión— se queda; el orden y los cursores salen de las entradas, que no cambian;
 *   · deja la marca `revertido` en el índice (la ven todas las réplicas): la lista dice `inventario: 'revertido'`,
 *     `reconciliado: false`, `completo: false`, y ninguna réplica vuelve a reconciliar ni a agregar nada a este dueño
 *     hasta que operación lo reactive (`reactivarReconciliacionTareas`, o una generación nueva:
 *     `AURA_RECONCILIAR_TAREAS_GENERACION`). Ya no hace falta apagar `AURA_RECONCILIAR_TAREAS` antes;
 *   · idempotente y reanudable: repetirla termina lo pendiente; si no queda nada, no escribe (`ya: true`).
 * Nunca borra objetos ni el respaldo. Una tarea quitada que alguien lee por su id (`GET /api/trabajos/:id`) vuelve a
 * anotarse como siempre (`asegurarEnIndice`: es uso, no inventario).
 */
export async function revertirReconciliacionTareas(
  dueno: string,
  a: AlmacenDurable = almacenDurable(),
  o: {
    ahora?: number;
    /**
     * Operación, a propósito: lo del índice de antes que sigue sin poder leerse tras varios intentos (un objeto dañado)
     * se da por no recuperable: queda contado en `recortadas` (nunca se pierde en silencio), la restauración se cierra y
     * el resultado lo dice (`ilegibles`). Sin esto, la reversión sigue pendiente mientras haya algo sin leer.
     */
    aceptarIlegibles?: boolean;
  } = {}
): Promise<ResultadoReversion> {
  const ahora = o.ahora ?? Date.now();
  const gen = generacionReconciliacion();
  const total = { quitadas: 0, conservadas: 0, restauradas: 0 };
  let pendientes = 0;
  let escribio = false;
  let sinRespaldo = false;
  let restaurado = true;
  let ilegibles = 0;
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const l = await leerDurable<Indice>(claveIndice(dueno), a).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
    if (l.ok === false) return { ok: false, detalle: l.detalle };
    const ix = l.valor;
    if (!ix) {
      // Sin índice: solo hay algo que revertir si queda el respaldo de una reconciliación (lo que se devuelve). Si tampoco,
      // no se escribe nada: la marca `revertido` sobre un índice vacío bloquearía a ese dueño (H4).
      const r = await leerDurable<{ indice: Indice | null }>(claveRespaldo(dueno, sufijoRespaldo(undefined)), a).catch((e) => ({ ok: false as const, detalle: String(e?.message || e) }));
      if (r.ok === false) return { ok: false, detalle: r.detalle };
      if (!r.valor) return { ok: true, quitadas: 0, conservadas: 0, restauradas: 0, pendientes: 0, restaurado: true, ya: true, sinIndice: true };
    }
    const previa = ix?.revertido;
    // 1. Lo que agregó el inventario: ¿tuvo actividad desde que se recuperó? ¿Terminó?
    const recs = (ix?.ids || []).filter((x) => x.rec);
    if (indiceReconciliado(ix) && !previa && !escribio && !recs.length && !(Number(ix!.inventario!.agregadas) > 0)) {
      // R16-2: reconciliado, pero el inventario no le agregó nada (ni entradas `rec`, ni cuenta en la marca, ni respaldo:
      // solo se guarda al agregar). No hay nada que revertir ni que bloquear (un reconciliado no se vuelve a recorrer): no
      // se escribe nada, tampoco la marca `revertido` (convertiría un «reconciliado» honesto en «revertido» sin motivo).
      // Sin la marca `inventario` sí se escribe: es el bloqueo PREVIO (una réplica a mitad de recorrido no agrega nada).
      const r = await leerDurable<{ indice: Indice | null }>(claveRespaldo(dueno, respaldoDe(ix)), a).catch(() => ({ ok: false as const }));
      if (r.ok && !r.valor) return { ok: true, quitadas: 0, conservadas: 0, restauradas: 0, pendientes: 0, restaurado: true, ya: true, nadaQueRevertir: true };
    }
    const lecturas = await leerTareas(dueno, recs.map((x) => x.id), a);
    const decision = new Map<string, { rec: string; quitar: boolean; desde: number }>();
    const sinLeer = new Set<string>();
    for (const x of recs) {
      const v = lecturas.get(x.id);
      if (!v || v.ok === false) {
        sinLeer.add(x.id);
        continue;
      }
      const desde = recuperadaEn(x);
      // Una activa (no terminó) es trabajo vivo: no sale aunque no tuviera actividad (H4).
      decision.set(x.id, { rec: String(x.rec), quitar: !v.tarea || (esTerminal(v.tarea.estado) && v.tarea.actualizada <= desde), desde });
    }
    // 2. Lo que el recorte del inventario sacó del índice de antes (una vez por reversión; se reintenta si algo no se leyó).
    const devolver: EntradaIndice[] = [];
    let restauroCompleto = true;
    // Cuántas del índice de antes faltan por devolver porque no se pudieron leer (un respaldo ilegible cuenta 1: no se
    // sabe cuántas trae, pero no son 0).
    let porRestaurar = 0;
    let vueltaIlegibles = 0;
    const respLeido = respaldoDe(ix);
    if (!previa?.restaurado) {
      const r = await leerDurable<{ indice: Indice | null }>(claveRespaldo(dueno, respLeido), a).catch(() => ({ ok: false as const }));
      if (r.ok === false) {
        if (o.aceptarIlegibles) ilegibles = Math.max(ilegibles, 1);
        else {
          restauroCompleto = false;
          porRestaurar = 1;
        }
      }
      else if (!r.valor) {
        // Sin respaldo no vuelve nada: lo que el recorte sacó sigue contado en `recortadas` (no se calla). Se dice, si el
        // inventario agregó algo (solo entonces escribe el respaldo: sin agregar, no hay nada que devolver).
        const agrego = recs.length > 0 || Number(ix?.inventario?.agregadas) > 0 || Number(ix?.inventario?.dr) > 0;
        if (agrego && !sinRespaldo) console.warn('[tareas] revertir: no está el respaldo del índice de antes; lo que el recorte sacó no vuelve y sigue contado en «recortadas»');
        sinRespaldo ||= agrego;
      } else {
        const ya = new Set((ix?.ids || []).map((x) => x.id));
        const faltan = (r.valor.indice?.ids || []).filter((x) => x && typeof x.id === 'string' && !x.rec && !ya.has(x.id)).map((x) => x.id);
        const vistas = await leerTareas(dueno, faltan, a);
        for (const id of faltan) {
          const v = vistas.get(id)!;
          if (v.ok === false) {
            if (o.aceptarIlegibles) vueltaIlegibles++;
            else {
              restauroCompleto = false;
              porRestaurar++;
            }
          }
          // Solo vuelve lo que existe y es de este dueño (una entrada sin objeto se podó a propósito).
          else if (v.tarea) devolver.push({ id, t: v.tarea.creada, ...(esTerminal(v.tarea.estado) ? { fin: v.tarea.actualizada } : {}) });
        }
      }
    }
    // 3. La fusión CAS sobre el índice actual.
    let c = { quitadas: 0, conservadas: 0, restauradas: 0, pendientes: 0, sinDecidir: 0 };
    let marcaFinal: MarcaReversion | null = null;
    const quitadas: string[] = [];
    const w = await modificarDurable<Indice>(
      claveIndice(dueno),
      (actual) => {
        c = { quitadas: 0, conservadas: 0, restauradas: 0, pendientes: 0, sinDecidir: 0 };
        quitadas.length = 0;
        // El respaldo que se leyó tiene que ser el del índice que se escribe; si otro ciclo se coló, se vuelve a mirar.
        const coincide = respaldoDe(actual) === respLeido;
        if (!actual?.revertido?.restaurado && !coincide) c.sinDecidir++;
        const ids: EntradaIndice[] = [];
        for (const x of actual?.ids || []) {
          if (!x.rec) {
            ids.push(x);
            continue;
          }
          const d = decision.get(x.id);
          if (!d || d.rec !== x.rec) {
            // Sin leer, o una entrada que no estaba en la lectura (la agregó otro entretanto): se queda, y se vuelve a mirar.
            ids.push(x);
            if (!d && sinLeer.has(x.id)) c.pendientes++;
            else c.sinDecidir++;
            continue;
          }
          if (d.quitar) {
            c.quitadas++;
            quitadas.push(x.id);
            continue;
          }
          c.conservadas++;
          const { rec: _rec, rt: _rt, ...propia } = x;
          ids.push(propia);
        }
        const presentes = new Set(ids.map((x) => x.id));
        // Lo del respaldo leído solo vale para el ciclo de ese respaldo (si otro se coló, la próxima vuelta lo rehace).
        const nuevas = coincide ? devolver.filter((x) => !presentes.has(x.id)) : [];
        const quedan = recortarIndice([...ids, ...nuevas]);
        const siguen = new Set(quedan.map((x) => x.id));
        const vuelven = nuevas.filter((x) => siguen.has(x.id));
        c.restauradas = vuelven.length;
        const cur = Number(actual?.recortadas) || 0;
        // Lo que había contado el inventario al marcar (`dr`) son las que su recorte sacó del índice de antes: las que
        // vuelven dejan de contarse (una vez: cur − dr + (dr − las que vuelven)), las que no pueden volver (sin respaldo,
        // sin poder leerlas) se siguen contando (H3/H4). Solo las terminadas se recortan (y se cuentan). Más lo que el
        // recorte saque ahora de lo que ya estaba.
        const recortadas = Math.max(0, cur - vuelven.filter((x) => x.fin).length) + ids.filter((x) => !siguen.has(x.id)).length;
        const { inventario: _i, pase: _p, revertido: prev, recortadas: _rc, ...resto } = actual || ({ v: 2, ids: [] } as Indice);
        const marca: MarcaReversion = {
          v: 1,
          t: prev?.t ?? ahora,
          gen: Math.max(gen, Number(prev?.gen) || 0),
          ronda: actual?.inventario?.ronda ?? actual?.pase?.ronda ?? prev?.ronda ?? null,
          respaldo: respaldoDe(actual),
          restaurado: !!prev?.restaurado || (restauroCompleto && coincide),
          quitadas: (prev?.quitadas || 0) + c.quitadas,
          conservadas: (prev?.conservadas || 0) + c.conservadas,
          restauradas: (prev?.restauradas || 0) + c.restauradas,
          pendientes: c.pendientes + c.sinDecidir,
        };
        if (!marca.restaurado) marca.porRestaurar = Math.max(1, porRestaurar);
        marcaFinal = marca;
        const reversiones = (Number(actual?.reversiones) || 0) + (prev ? 0 : 1);
        const nuevo: Indice = { ...resto, v: 2, ids: quedan, ...(recortadas > 0 ? { recortadas } : {}), revertido: marca, reversiones };
        return canonico(nuevo) === canonico(actual) ? undefined : nuevo;
      },
      a
    );
    if (w.ok === false) return { ok: false, detalle: w.detalle };
    ilegibles = Math.max(ilegibles, vueltaIlegibles);
    restaurado = !!marcaFinal?.restaurado;
    pendientes = c.pendientes + c.sinDecidir + (restaurado || c.sinDecidir ? 0 : marcaFinal?.porRestaurar || 1);
    if (w.cambiado) {
      escribio = true;
      total.quitadas += c.quitadas;
      total.conservadas += c.conservadas;
      total.restauradas += c.restauradas;
      // 4. Una quitada que cambió entre su lectura y la escritura vuelve (sin marca: ya es propia). Lo mejor posible.
      const otra = await leerTareas(dueno, quitadas, a);
      for (const id of quitadas) {
        const v = otra.get(id);
        if (!v || v.ok === false || !v.tarea || (esTerminal(v.tarea.estado) && v.tarea.actualizada <= decision.get(id)!.desde)) continue;
        const reg = v.tarea;
        const e: EntradaIndice = { id, t: reg.creada, ...(esTerminal(reg.estado) ? { fin: reg.actualizada } : {}) };
        const re = await modificarDurable<Indice>(claveIndice(dueno), (ix2) => (ix2?.ids.some((x) => x.id === id) ? undefined : conRecorte(ix2, [e, ...(ix2?.ids || [])])), a).catch(() => null);
        if (re && re.ok) {
          total.quitadas--;
          total.conservadas++;
        }
      }
    }
    if (!c.sinDecidir) break;
  }
  // Revisión externa sobre 8b9e9ca: «ya» solo si no se escribió nada Y no queda nada pendiente (restauración incluida).
  return { ok: true, ...total, pendientes, restaurado, ya: !escribio && pendientes === 0, ...(sinRespaldo ? { sinRespaldo: true as const } : {}), ...(ilegibles ? { ilegibles } : {}) };
}

/**
 * Reactiva la reconciliación de UN dueño revertido: quita la marca `revertido` del índice (CAS) y su siguiente lectura de
 * la lista vuelve a inventariar (y agrega, con su propio respaldo, lo que falte). Para todos los revertidos de una vez:
 * subir `AURA_RECONCILIAR_TAREAS_GENERACION`. `reactivado: false` si no estaba revertido.
 */
export async function reactivarReconciliacionTareas(dueno: string, a: AlmacenDurable = almacenDurable()): Promise<{ ok: true; reactivado: boolean } | { ok: false; detalle: string }> {
  let reactivado = false;
  const r = await modificarDurable<Indice>(
    claveIndice(dueno),
    (ix) => {
      reactivado = false;
      if (!ix?.revertido) return undefined;
      reactivado = true;
      const { revertido: _r, ...resto } = ix;
      return resto;
    },
    a
  );
  return r.ok === false ? { ok: false, detalle: r.detalle } : { ok: true, reactivado };
}

/**
 * El respaldo del índice de antes del inventario (`valor: null` si el inventario nunca le agregó nada). `reversion`: el de
 * la generación que siguió a esa reversión (0, por omisión, es el de la primera: `antes-de-inventario-v1`).
 */
export async function leerRespaldoIndiceTareas(dueno: string, a: AlmacenDurable = almacenDurable(), reversion = 0) {
  return leerDurable<{ v: 1; t: number; ronda: string; indice: Indice | null }>(claveRespaldo(dueno, sufijoRespaldo(reversion)), a);
}

/**
 * Una página de la lista (P5/A7). Dos verdades separadas (A7, auditoría del 5-oct):
 *   · `paginaLeida`: false si alguna tarea del índice no se pudo leer (`noLeidas`): un fallo del almacén NUNCA es «no hay
 *     tareas»;
 *   · `reconciliado`: el inventario de este dueño se recorrió entero y el índice tiene todo lo que encontró (`inventario`
 *     dice cómo está si no). Un índice de antes no es completo solo porque sus ids se lean bien.
 * `completo` = las dos. `siguiente`: el cursor de la página que sigue (null si no hay más). Orden estable:
 * primero las que pueden seguir activas (la más nueva primero) y después las terminadas (la que terminó más tarde
 * primero). Con `recientesMs`, las terminadas hace más que eso no se devuelven (siguen en el índice, son historial).
 */
export type PaginaTareas = {
  ok: true;
  tareas: RegistroTarea[];
  noLeidas: string[];
  completo: boolean;
  paginaLeida: boolean;
  reconciliado: boolean;
  inventario: EstadoInventario;
  siguiente: string | null;
  /**
   * `recortadas` (revisión 13): tareas TERMINADAS de este dueño que siguen existiendo (su objeto no se borra) pero que el
   * tope del historial (MAX_HISTORIAL_INDICE terminadas más recientes) ya no lista. No son un fallo ni hacen la lista
   * incompleta: `completo: true` dice que se leyó todo lo que la lista guarda; `recortadas` dice cuántas terminadas,
   * más viejas, quedaron fuera a propósito. Es una cota baja (no hay ids: esas ya no están en el índice). 0 si ninguna.
   */
  conteo: { activas: number; terminadas: number; indice: number; noLeidas: number; recortadas: number };
};
/** `reconciliar: false`: no da el paso de inventario (solo lee). `presupuesto`: cuánto trabaja ese paso. */
export type OpcionesLista = { limite?: number; cursor?: string | null; recientesMs?: number; ahora?: number; reconciliar?: boolean; presupuesto?: Partial<PresupuestoInventario> };

type Cursor = { s: 'a' | 'h'; k: number; id: string };
const leerCursor = (c: string | null | undefined): Cursor | null => {
  if (!c) return null;
  try {
    const x = JSON.parse(Buffer.from(String(c), 'base64url').toString('utf8'));
    return (x?.s === 'a' || x?.s === 'h') && Number.isFinite(x.k) && typeof x.id === 'string' ? { s: x.s, k: x.k, id: x.id } : null;
  } catch {
    return null;
  }
};
const escribirCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
/** Dónde va cada entrada en el orden de la lista. */
const posicion = (x: EntradaIndice): Cursor => (x.fin ? { s: 'h', k: x.fin, id: x.id } : { s: 'a', k: x.t, id: x.id });
/** ¿`p` va antes que `q`? Activas antes que historial; dentro, la clave mayor primero; empate, por id. */
const antes = (p: Cursor, q: Cursor) => (p.s !== q.s ? p.s === 'a' : p.k !== q.k ? p.k > q.k : p.id < q.id);

export async function listarTareasPagina(dueno: string, o: OpcionesLista = {}, a: AlmacenDurable = almacenDurable()): Promise<PaginaTareas | { ok: false; detalle: string }> {
  const leido = await leerDurable<Indice>(claveIndice(dueno), a);
  if (leido.ok === false) return { ok: false, detalle: leido.detalle };
  let indice = leido.valor;
  const ahora = o.ahora ?? Date.now();
  // A7: mientras el inventario no esté reconciliado, cada lectura da un paso (acotado). Lo que encuentre entra al índice
  // ANTES de leer la página; si el paso falla, la página se lee igual y dice `reconciliado: false`.
  // Revertido por operación: ni se intenta (la lista lo dice; no se reconcilia hasta que se reactive).
  let inventario: EstadoInventario = indiceReconciliado(indice) ? 'reconciliado' : indiceRevertido(indice, generacionReconciliacion()) ? 'revertido' : 'en-curso';
  if (inventario === 'en-curso' && o.reconciliar !== false) {
    const r = await reconciliarInventarioTareas(dueno, { ahora, presupuesto: o.presupuesto }, a).catch((): ResultadoInventario => ({ estado: 'error', escribio: false, agregadas: 0 }));
    inventario = r.estado;
    if (r.escribio || r.estado === 'reconciliado') {
      const otra = await leerDurable<Indice>(claveIndice(dueno), a).catch(() => null);
      if (otra && otra.ok) indice = otra.valor;
      // La marca se cree solo si está en el índice que se va a leer (otro pudo reescribirlo entretanto).
      if (r.estado === 'reconciliado' && !indiceReconciliado(indice)) inventario = 'en-curso';
    }
  }
  const limite = o.limite && o.limite > 0 ? Math.floor(o.limite) : Infinity;
  const desde = leerCursor(o.cursor);
  const corte = o.recientesMs !== undefined ? ahora - o.recientesMs : -Infinity;
  const entradas = (indice?.ids || []).map((x) => ({ x, p: posicion(x) })).sort((u, v) => (antes(u.p, v.p) ? -1 : 1));
  // Las terminadas fuera de `recientesMs` no se leen: ya se sabe que no van.
  const candidatas = entradas.filter((e) => !(e.x.fin && e.x.fin < corte) && (!desde || antes(desde, e.p)));
  const tareas: RegistroTarea[] = [];
  const noLeidas: string[] = [];
  const fines = new Map<string, number>();
  const podar = new Set<string>();
  const sinObjeto = new Set<string>();
  let ultima: Cursor | null = null;
  let i = 0;
  // De a 10 en paralelo, hasta llenar la página.
  while (i < candidatas.length && tareas.length < limite) {
    const tanda = candidatas.slice(i, i + Math.min(10, Math.max(1, limite === Infinity ? 10 : limite - tareas.length)));
    i += tanda.length;
    const leidas = await Promise.all(tanda.map((e) => leerTarea(dueno, e.x.id, a).catch((err) => ({ ok: false as const, detalle: String(err?.message || err) }))));
    tanda.forEach((e, j) => {
      const l = leidas[j];
      ultima = e.p;
      if (l.ok === false) {
        noLeidas.push(e.x.id);
        return;
      }
      if (!l.tarea) {
        sinObjeto.add(e.x.id);
        if (ahora - e.x.t > 86_400_000) podar.add(e.x.id);
        return;
      }
      if (esTerminal(l.tarea.estado) && !e.x.fin) fines.set(e.x.id, l.tarea.actualizada);
      if (esTerminal(l.tarea.estado) && l.tarea.actualizada < corte) return;
      tareas.push(l.tarea);
    });
  }
  const reparado = await repararIndice(dueno, { fines, podar }, a);
  const quedan = i < candidatas.length;
  const total = indice?.ids.length ?? 0;
  const terminadas = (indice?.ids || []).filter((x) => x.fin || fines.has(x.id)).length;
  const reconciliado = inventario === 'reconciliado';
  return {
    ok: true,
    tareas,
    noLeidas,
    completo: noLeidas.length === 0 && reconciliado,
    paginaLeida: noLeidas.length === 0,
    reconciliado,
    inventario,
    siguiente: quedan && ultima ? escribirCursor(ultima) : null,
    conteo: { activas: total - terminadas - sinObjeto.size, terminadas, indice: total, noLeidas: noLeidas.length, recortadas: Math.max(0, Math.floor(Number((reparado ?? indice)?.recortadas) || 0)) },
  };
}

/** Las durables del dueño (todas las del índice), la más nueva primero. `ok: false` si el índice no se pudo leer. */
export async function listarTareas(dueno: string, a: AlmacenDurable = almacenDurable()): Promise<{ ok: true; tareas: RegistroTarea[]; noLeidas: string[]; completo: boolean; reconciliado: boolean } | { ok: false; detalle: string }> {
  const p = await listarTareasPagina(dueno, {}, a);
  if (p.ok === false) return p;
  return { ok: true, tareas: p.tareas.sort((x, y) => y.actualizada - x.actualizada), noLeidas: p.noLeidas, completo: p.completo, reconciliado: p.reconciliado };
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
      visto = reg && !esDeOtro(reg, dueno) ? reg : undefined;
      if (!reg || !visto) return void (motivo = 'no-existe');
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
  const final = (r.valor as RegistroTarea | null) || visto!;
  // Terminó: su entrada del índice pasa a historial (solo esas se recortan). Si no se puede anotar, queda como «puede
  // seguir activa» (la lista la lee y lo repara): nunca al revés.
  if (cambiado && visto && !esTerminal(visto.estado) && esTerminal(final.estado)) await repararIndice(dueno, { fines: new Map([[id, final.actualizada]]) }, a);
  if (cambiado && visto) await agendarSiToca(dueno, visto, final, a);
  return { ok: true, tarea: final, cambiado };
}

/**
 * Fase 2: a la agenda del planificador si la tarea acaba de quedar `queued` o le pusieron (o adelantaron) una
 * `proximaRevision`. Lo mejor posible: si la agenda no se pudo escribir, la tarea sigue como está (la lista la ve igual).
 */
async function agendarSiToca(dueno: string, antes: RegistroTarea | null, ahora: RegistroTarea, a: AlmacenDurable): Promise<void> {
  if (esTerminal(ahora.estado)) return;
  const encolada = ahora.estado === 'queued' && antes?.estado !== 'queued';
  const revision = !!ahora.proximaRevision && ahora.proximaRevision !== antes?.proximaRevision;
  if (!encolada && !revision) return;
  const cuando = encolada ? ahora.actualizada : Math.max(ahora.actualizada, ahora.proximaRevision!);
  await agendar('tarea', dueno, ahora.id, cuando, { almacen: a }).catch(() => false);
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
  /**
   * La tarea en curso de una conversación que espera que la persona siga (José, 5-oct): va en `awaiting_approval` SIN
   * decisión (no trabaja por detrás ni pide aprobar nada) y con esta marca, para que el panel diga «Espera que sigas»
   * en vez de «Trabajando» con spinner. Una app de antes la ve como una espera (sin spinner ni «Trabajando · 1»).
   */
  awaitingInput?: true;
  decisionId?: string;
  decision?: {
    id: string;
    kind: Decision['tipo'];
    question: string;
    why: string;
    proposal: { action: string; account?: string; recipient?: string; data: string[]; amount?: string; recurrence?: string; scope: string; text?: string; subject?: string };
    options: { id: string; label: string; effect: string; risk: Opcion['riesgo'] }[];
    createdAt: string;
    expiresAt?: string;
    expired: boolean;
    postponed: boolean;
    postponedUntil?: string;
    /**
     * Revisión del 6-oct (bloqueante 1): la huella del borrador que muestra esta decisión (destinatario, cuenta y
     * contenido). El teléfono la manda con un «sí» HABLADO mientras la ventana la muestra (`decisionVista`): el servidor
     * solo manda si el borrador que espera tiene exactamente esa huella. No es secreta (resume lo que ya se ve).
     */
    fingerprint?: string;
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
    proposal: {
      action: d.propuesta.accion,
      ...(d.propuesta.cuenta ? { account: d.propuesta.cuenta } : {}),
      ...(d.propuesta.destinatario ? { recipient: d.propuesta.destinatario } : {}),
      data: d.propuesta.datos,
      ...(d.propuesta.importe ? { amount: d.propuesta.importe } : {}),
      ...(d.propuesta.recurrencia ? { recurrence: d.propuesta.recurrencia } : {}),
      scope: d.propuesta.alcance,
      ...(typeof d.propuesta.texto === 'string' ? { text: d.propuesta.texto } : {}),
      ...(typeof d.propuesta.asunto === 'string' ? { subject: d.propuesta.asunto } : {}),
    },
    options: opciones.map((o) => ({ id: o.id, label: o.etiqueta, effect: o.efecto, risk: o.riesgo })),
    createdAt: iso(d.creada)!,
    ...(d.caduca ? { expiresAt: iso(d.caduca) } : {}),
    expired,
    postponed: !!(d.pospuesta || (d.pospuestaHasta && d.pospuestaHasta > ahora)),
    ...(d.pospuestaHasta ? { postponedUntil: iso(d.pospuestaHasta) } : {}),
    ...(d.vinculo?.tipo === 'borrador' && d.vinculo.hash ? { fingerprint: d.vinculo.hash } : {}),
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
 *
 * Activa NO es `running` (José, 5-oct: «EN MARCHA · Trabajando · última señal hace 2 min» y no pasaba nada): la tarea
 * en curso es de la conversación y avanza solo cuando la persona habla («sigue», «el siguiente»). Va en
 * `awaiting_approval` sin decisión, con `awaitingInput` y el paso dicho como lo que espera; sin `lastHeartbeatAt`,
 * porque no hay nada trabajando por detrás que dé señales. Pausar y Cancelar siguen igual.
 */
export function deTareaEnCurso(t: TareaEnCursoMin): TaskSnapshot {
  const hechos = t.pasos.filter((p) => p.estado !== 'pendiente').length;
  const sig = t.pasos.findIndex((p, i) => p.estado === 'pendiente' && i > t.actual);
  const siguiente = sig >= 0 ? sig : t.pasos.findIndex((p) => p.estado === 'pendiente');
  const espera = t.estado === 'activa';
  const estado: EstadoTarea = t.estado === 'pausada' ? 'paused' : 'awaiting_approval';
  const paso = siguiente >= 0 ? t.pasos[siguiente].etiqueta : '';
  const pasoActual = espera ? `Espera que sigas: dime «sigue» o «el siguiente»${paso ? `. Lo que sigue: ${paso}` : ''}` : paso ? `Sigue: ${paso}` : '';
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
    acceptance: [{ id: 'pasos', text: `Ver los ${t.pasos.length} pasos`, required: true, status: hechos === t.pasos.length ? 'unknown' : 'pending', evidenceIds: [] }], // sin evidencia nunca es «verified»
    environment: { kind: t.tipo === 'correo' ? 'correo' : t.tipo === 'whatsapp' ? 'whatsapp' : 'chat', id: t.ambito, displayName: t.tipo === 'correo' ? 'Tu correo' : t.tipo === 'whatsapp' ? 'Tu WhatsApp' : 'Esta conversación' },
    ...(pasoActual ? { currentStep: pasoActual } : {}),
    progress: { done: hechos, total: t.pasos.length, unit: 'pasos' },
    planVersion: 1,
    lastEventSequence: 0,
    ...(espera ? { awaitingInput: true as const } : {}),
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
  /** Las páginas que su computadora ABRIÓ de verdad (pasos hechos). Una dirección que solo está en el texto no va aquí. */
  enlaces?: string[];
  datos?: { clave: string; valor: string }[];
  /** Lo que el nodo comprobó en su espacio de trabajo al terminar. undefined/null: no se comprobó (un nodo de antes). */
  archivos?: ArchivoNodo[] | null;
  /** Lo que se pidió, calculado UNA vez al crear la misión con lo que pidió la persona (R5). Sin él, de la instrucción. */
  requisitos?: PedidoEntrega | null;
  /** Lo que pidió la PERSONA en su turno (G2-C): la acción, el archivo o el producto cuentan si aparecen en cualquiera de las dos. */
  pedidoPersona?: string | null;
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

/* ---------------- lo que se comprobó de verdad (revisión externa, 4-oct: «"Listo" puede marcar entregables como
 * comprobados aunque los archivos no existan»). «Listo», «hecho», «guardé el archivo» o «ya está» son lo que DICE el
 * modelo, no evidencia. Cuenta: el archivo que el NODO encontró al terminar (dentro del espacio de la misión, con bytes
 * y sha256, de esta misión), la página que su computadora abrió (un paso hecho) y, si lo que se pidió es un dato, la
 * respuesta que lo trae (es lo pedido, no una afirmación de que se hizo). Una acción con efecto afuera (enviar,
 * publicar, llenar un formulario) no se puede comprobar desde aquí: queda «sin comprobar», nunca verificada. */

const plegar = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const sinUrls = (s: string) => s.replace(/\b(?:https?|ftp):\/\/\S+|\bwww\.\S+/gi, ' ');
const EXT_ARCHIVO = 'odt|ods|odp|odg|docx?|xlsx?|pptx?|pdf|txt|csv|tsv|md|rtf|html?|json|xml|png|jpe?g|gif|svg|webp|zip';
/** Pide dejar un archivo: guardar, descargar, exportar… */
const RE_PIDE_GUARDAR = /\b(guarda(lo|la|los|las|me|melo|mela)?|guardar(lo|la|los|las)?|guardes|descarga(lo|la|los|las|me)?|descargar(lo|la|los|las)?|bajate|exporta(lo|la|los)?|exportar(lo|la)?|save|download|export)\b/;
/** …o crear un documento, una hoja, un PDF (con nombre de archivo o sin él). */
const RE_PIDE_CREAR = new RegExp(
  `\\b(crea|crear|creame|haz|hazme|escribe|escribir|escribeme|genera|generar|arma|armame|prepara|preparame|redacta|toma|tomame|saca|sacame|make|create|write|generate|draft|take)\\b[^.;\\n]{0,60}?(\\b(documentos?|archivos?|hojas?( de calculo)?|planillas?|presentacion(es)?|pdfs?|carpetas?|words?|excel(es|s)?|capturas?|imagen(es)?|fotos?|screenshots?|images?|documents?|files?|spreadsheets?|presentations?|folders?)\\b|[\\w-][\\w.-]*\\.(${EXT_ARCHIVO})(?![\\w-]))`
);
/** La respuesta dice que dejó un archivo. */
const RE_DICE_ARCHIVO =
  /\b(guarde|guardado|guardada|guardados|guardadas|descargue|descargado|descargada|exporte|exportado|exportada|cree (el|un|la|una) (archivo|documento|hoja|pdf|presentacion|carpeta)|saved|downloaded|exported|created (the|a|an) (file|document|spreadsheet|pdf|folder))\b/;
/** Una acción con efecto afuera, al empezar una frase o después de «y», «luego»… («revisa si el banco publica» no). */
const RE_PIDE_ACCION =
  /(?:^|[,;:.]\s*|\b(?:y|e|luego|despues|tambien|and|then)\s+)(envia(lo|la|los|las|le|les|selo|sela)?|enviale|enviame(lo|la)?|manda(lo|la|los|las|le|les|selo)?|mandale|mandame(lo|la)?|publica(lo|la)?|postea(lo|la)?|comenta(lo)?|responde(le|les)?|contesta(le|les)?|llena(lo|la)?|rellena(lo|la)?|completa (el|la|los|las) (formulario|registro|solicitud|encuesta)|registra(me|te|lo)?|registrate|inscribe(me|te)?|inscribete|suscribe(me|te)?|suscribete|reserva(me|lo|la)?|agenda(me|lo|la)?|borra(lo|la|los)?|elimina(lo|la|los)?|sube(lo|la)?|compra(lo|la|me)?|paga(lo|la)?|cancela(lo|la)?|inicia sesion|send|post|publish|reply|fill (in|out)|submit|register|sign (up|in)|subscribe|book|delete|remove|upload|buy|pay|cancel)\b/;
/** Lo que solo afirma que terminó (o qué se hizo), sin dato: no cuenta para saber si la respuesta trae algo. */
const RELLENO = new Set(
  (
    'listo lista listos hecho hecha hechos ya esta estan quedo quedaron queda todo toda bien vale perfecto excelente claro ' +
    'terminado terminada termine terminamos completado completada complete completamos finalizado finalizada finalice ' +
    'realizado realizada realice hice hizo los las del con sin sus tus mis que como nos pediste pidio pedido solicitado ' +
    'indicado tarea mision encargo trabajo has hemos fue sido estuvo exito exitosamente correctamente problema problemas ' +
    'done finished completed complete all set task was has have been you asked the and successfully now already yes ' +
    'okay abri abierto abierta entre pagina sitio computadora envie enviado enviada mande mandado publique publicado ' +
    'llene llenado rellenado registre registrado guarde guardado guardada descargue descargado archivo documento carpeta ' +
    'respuesta'
  ).split(' ')
);

/**
 * ¿Pide (o dice que dejó) un archivo? También si de la instrucción salen entregables concretos (nombres que se entregan,
 * «tres PDFs», «una captura», «las facturas de enero, febrero y marzo»): una misión de archivos NUNCA se comprueba con
 * el texto de la respuesta (revisión independiente).
 */
export function pideArchivo(instruccion: string, respuesta?: string | null, pedido?: PedidoEntrega | null): boolean {
  if (pedido && pedido.explicitos > 0) return true;
  // Una extensión conocida obliga a entrega: nunca es un dato (ronda 5).
  if (nombresEn(sinUrls(String(instruccion || ''))).length) return true;
  const p = plegar(sinUrls(String(instruccion || '')));
  if (RE_PIDE_GUARDAR.test(p) || RE_PIDE_CREAR.test(p) || RE_DICE_ARCHIVO.test(plegar(sinUrls(String(respuesta || ''))))) return true;
  return requisitosDeEntrega(instruccion).explicitos > 0;
}

/** ¿Pide una acción con efecto afuera (enviar, publicar, llenar un formulario…)? Eso no se comprueba desde aquí. */
export function pideAccion(instruccion: string): boolean {
  return RE_PIDE_ACCION.test(plegar(sinUrls(String(instruccion || ''))).trim());
}

/** ¿La respuesta trae algo (un número, o al menos tres palabras que no son «listo, ya lo hice»)? Sin URLs: eso no es un dato. */
export function respuestaInformativa(respuesta: string | null | undefined): boolean {
  const palabras = plegar(sinUrls(String(respuesta || ''))).match(/[a-z0-9ñ]+/g) || [];
  if (palabras.some((w) => /\d/.test(w))) return true;
  return palabras.filter((w) => w.length >= 3 && !RELLENO.has(w)).length >= 3;
}

/**
 * ¿El archivo está íntegro? Existe, más de 0 bytes, sha256 de verdad, de ESTA misión y dentro de su espacio. Es solo la
 * integridad: que sea lo pedido (nombre, tipo por dentro, cuántos) lo decide `evaluarEntrega` requisito por requisito.
 */
export function archivoComprobado(a: unknown): boolean {
  const x = a as ArchivoNodo | null;
  if (!x || typeof x !== 'object' || x.existe !== true || x.fuera === true || x.reciente !== true) return false;
  const ruta = typeof x.ruta === 'string' ? x.ruta : '';
  if (!ruta || ruta.length > 400 || /[\u0000-\u001f]/.test(ruta) || /(^|\/)\.\.(\/|$)/.test(ruta)) return false;
  return Number.isFinite(x.bytes) && x.bytes > 0 && typeof x.sha256 === 'string' && /^[0-9a-f]{64}$/.test(x.sha256);
}

/**
 * Lo que se sabe de lo entregado: si se comprobó, qué lo comprueba y, si no, qué falta (dicho con honestidad).
 * `items`: cada cosa pedida con su estado y su archivo (solo para archivos); `hechos` de `total` pedidos. `revisado`:
 * el nodo revisó sus archivos al terminar (false: un nodo de antes o no pudo mirar; nada de archivos se comprobó).
 */
export type Entrega = {
  comprobada: boolean;
  tipo: 'archivo' | 'accion' | 'dato';
  evidencias: Evidencia[];
  falta: string | null;
  items: ItemEntrega[];
  hechos: number;
  total: number;
  revisado: boolean;
  /**
   * Ronda 7: terminó RESPONDIENDO (una consulta pura o un texto en el chat que vino en la respuesta). Nunca es
   * `comprobada`: se cierra `respondida`, no `completed`.
   */
  respondida?: boolean;
};

/**
 * Lo que se le dice a la persona cuando se respondió (ronda 8, G-B): NUNCA afirma que no hubo efecto. La misión corrió
 * en la computadora, que pudo tocar cosas; si además se pidió una acción, no está comprobada.
 */
export const SOLO_RESPONDI = 'Te respondí con lo que encontré. Si además pediste que hiciera algo, eso NO está comprobado: revisa antes de darlo por hecho.';
export const SOLO_RESPONDI_EN = 'I answered with what I found. If you also asked me to do something, that is NOT verified: check before taking it as done.';

/** El id de la evidencia de un requisito verificado: uno por requisito, nunca compartido. */
const idEvidenciaItem = (misionId: string, itemId: string) => `${misionId}:archivo:${itemId}`;

export function evaluarEntrega(m: Pick<MisionComputadoraMin, 'id' | 'instruccion' | 'resultado' | 'enlaces' | 'datos' | 'archivos' | 'requisitos'> & { pedidoPersona?: string | null }): Entrega {
  const abiertas: Evidencia[] = (m.enlaces || []).slice(0, 6).map((u, i) => ({ id: `${m.id}:enlace:${i}`, tipo: 'enlace', etiqueta: texto(u, 120), ref: u }));
  const lista = Array.isArray(m.archivos) ? m.archivos : null;
  // R1: un archivo que se nombró (el modelo dijo «guardé X», o la instrucción lo usa) y no existe no deja completar por
  // ningún camino; la misión se evalúa como de archivos y ese archivo es un criterio no cumplido.
  // G2-C: lo que pidió la persona y lo que encargó el modelo; la acción, el archivo o el producto cuentan si aparecen en
  // cualquiera de las dos, la consulta solo si lo es en ambas.
  const pedidoPersona = m.pedidoPersona ?? m.requisitos?.pedidoPersona ?? null;
  const textos = [m.instruccion, pedidoPersona].filter((x): x is string => !!x && !!String(x).trim());
  const req = m.requisitos || (pedidoPersona ? requisitosCombinados(m.instruccion, pedidoPersona) : null);
  // «el informe final.pdf»: si existe «informe final.pdf», que «final.pdf» no esté no es un nombrado que falte.
  const alternativas = (req || requisitosDeEntrega(m.instruccion)).items.filter((r) => r.alternativa);
  const resuelto = (a: ArchivoNodo) => alternativas.some((r) => r.nombre!.toLowerCase() === String(a.ruta).split('/').pop()!.toLowerCase() && (lista || []).some((b) => b.existe === true && String(b.ruta).split('/').pop()!.toLowerCase() === r.alternativa!.toLowerCase()));
  const nombradoQueFalta = (lista || []).some((a) => a && a.mencionado === true && a.existe !== true && !resuelto(a));
  // Copiar, mover, renombrar, borrar o descomprimir: ACCIONES sobre archivos que ya existen. El texto no las comprueba;
  // solo una copia que el nodo muestre en la carpeta pedida con la MISMA huella que el original (comprobarCopia).
  // Si lo que pidió la persona (R5) trae entregables concretos, se comprueban esos (camino de archivos).
  if (textos.some((t) => esOperacionDeArchivos(t)) && !(req && req.explicitos > 0)) {
    const copia = !nombradoQueFalta && lista ? comprobarCopia(m.instruccion, lista) : null;
    if (copia) {
      const ev: Evidencia = { id: `${m.id}:copia`, tipo: 'archivo', etiqueta: texto(`${copia.detalle} (lo comprobó tu computadora)`, 200), ref: texto(copia.destino.ruta, 300) };
      return { comprobada: true, tipo: 'accion', evidencias: [ev, ...abiertas], falta: null, items: [], hechos: 1, total: 1, revisado: true };
    }
    return {
      comprobada: false,
      tipo: 'accion',
      evidencias: abiertas,
      falta: 'Tu computadora dice que lo hizo (copiar, mover, renombrar, borrar o descomprimir), pero no pude comprobarlo: revísalo antes de darlo por hecho.',
      items: [],
      hechos: 0,
      total: 1,
      revisado: !!lista,
    };
  }
  if (nombradoQueFalta || textos.some((t) => pideArchivo(t, m.resultado, req))) {
    // Cada cosa pedida, por separado: su archivo (a lo más uno), su tipo por dentro, de esta misión, en su carpeta.
    const { items, seguro, sobran } = compararEntrega(m.instruccion, lista, req);
    const pedidos = items.filter((i) => i.origen === 'pedido');
    const hechos = pedidos.filter((i) => i.estado === 'verified').length;
    const comprobada = seguro && items.length > 0 && items.every((i) => i.estado === 'verified');
    const archivos: Evidencia[] = items
      .filter((i) => i.estado === 'verified' && i.archivo)
      .map((i) => ({
        id: idEvidenciaItem(m.id, i.id),
        tipo: 'archivo',
        etiqueta: texto(`${i.detalle.startsWith(`${i.etiqueta} `) ? '' : `${i.etiqueta}: `}${i.detalle} (lo comprobó tu computadora)`, 200),
        ref: texto(i.archivo!.ruta, 300),
      }));
    return { comprobada, tipo: 'archivo', evidencias: [...archivos, ...abiertas], falta: comprobada ? null : faltaEnPalabras(items, sobran, !lista), items, hechos, total: pedidos.length, revisado: !!lista };
  }
  if (textos.some((t) => pideAccion(t))) {
    return { comprobada: false, tipo: 'accion', evidencias: abiertas, falta: 'Tu computadora dice que lo hizo, pero no pude comprobarlo desde aquí: revísalo antes de darlo por hecho.', items: [], hechos: 0, total: 1, revisado: true };
  }
  // Cerrado por defecto (ronda 5): solo una CONSULTA pura se completa con el texto. Lo que no se puede decidir no es dato.
  // Texto que va en la respuesta misma («hazme un resumen de la noticia», «tradúceme esto»): la respuesta ES la entrega,
  // si trae el texto (no un acuse: «Listo, ya está» no es un resumen).
  // El texto en el chat solo vale si ninguna de las dos pide otra cosa (cada una es texto en el chat o una consulta).
  const textoEnChat = textos.some((t) => esTextoEnChat(t, req)) && textos.every((t) => esTextoEnChat(t, req) || esConsulta(t));
  // Ronda 7: si la respuesta remite a otro lugar («lo dejé abierto en el navegador», «está en la pantalla»), el texto no
  // vino en la respuesta: no es la entrega (partial), ni siquiera «respondida».
  if ((textoEnChat || textos.every((t) => esConsulta(t))) && remiteAOtroLugar(m.resultado)) {
    return { comprobada: false, tipo: 'dato', evidencias: abiertas, falta: 'El texto no vino en la respuesta: tu computadora dice que lo dejó en otro lugar (la pantalla, una ventana, el navegador), y eso no lo puedo comprobar.', items: [], hechos: 0, total: 1, revisado: true };
  }
  if (textoEnChat && !(respuestaInformativa(textoSinAcuses(String(m.resultado || ''))) && respuestaConTexto(m.resultado, m.datos))) {
    return { comprobada: false, tipo: 'dato', evidencias: abiertas, falta: m.resultado ? 'Tu computadora dice que terminó, pero su respuesta no trae el texto que pediste: no pude comprobarlo.' : 'Terminó sin el texto que pediste.', items: [], hechos: 0, total: 1, revisado: true };
  }
  if (!textoEnChat && !textos.every((t) => esConsulta(t))) {
    return { comprobada: false, tipo: 'accion', evidencias: abiertas, falta: 'No sé comprobar desde aquí lo que pediste: no es una consulta que se responda con un dato, ni dejó algo que tu computadora pueda revisar.', items: [], hechos: 0, total: 1, revisado: true };
  }
  if (!respuestaInformativa(m.resultado)) {
    return { comprobada: false, tipo: 'dato', evidencias: abiertas, falta: m.resultado ? 'Tu computadora dice que terminó, pero no trajo lo que pediste: no pude comprobarlo.' : 'Terminó sin un resultado que lo compruebe.', items: [], hechos: 0, total: 1, revisado: true };
  }
  // Ronda 7: lo que se responde con el texto NO es una entrega verificada. Queda `respondida` (terminal, nunca
  // comprobada): SOLO_RESPONDI. Nunca afirma que no hubo efecto (ronda 8).
  const ev: Evidencia[] = [{ id: `${m.id}:respuesta`, tipo: 'dato', etiqueta: `Lo que respondió (sin comprobar): ${texto(m.resultado, 170)}` }];
  (m.datos || []).slice(0, 6).forEach((d, i) => ev.push({ id: `${m.id}:dato:${i}`, tipo: 'dato', etiqueta: `${texto(d.clave, 40)}: ${texto(d.valor, 120)}` }));
  return { comprobada: false, respondida: true, tipo: 'dato', evidencias: [...ev, ...abiertas], falta: SOLO_RESPONDI, items: [], hechos: 0, total: 1, revisado: true };
}

/** La evidencia de una misión terminada: solo lo que se comprobó (evaluarEntrega). */
export function evidenciaDeComputadora(m: MisionComputadoraMin): Evidencia[] {
  return evaluarEntrega(m).evidencias;
}

const TEXTO_RESULTADO = 'Tu computadora termina y lo entregado se comprueba (el dato que pediste, la página que abrió o el archivo que ella misma encontró); «listo» no basta';

/** El criterio de una cosa pedida: qué tiene que cumplir para contar. */
function textoCriterio(r: { etiqueta: string; origen: 'pedido' | 'respuesta' }): string {
  return r.origen === 'respuesta'
    ? texto(`${r.etiqueta}: que exista en su carpeta de trabajo`, 200)
    : texto(`${r.etiqueta}: existe en su carpeta de trabajo, no está vacío, es del tipo pedido por dentro y lo hizo esta misión`, 200);
}

/**
 * Los criterios de aceptación de un encargo a la computadora ANTES de empezar: si pide dejar archivos, uno por cosa
 * pedida (lib/entregables.ts `requisitosDeEntrega`); si no, el resultado comprobado.
 */
export function criteriosDeEncargo(instruccion: string, pedidoPersona?: string | null): { id: string; texto: string; obligatorio: boolean }[] {
  const req = requisitosCombinados(instruccion, pedidoPersona);
  if (esOperacionDeArchivos(instruccion) || !pideArchivo(instruccion, null, req)) return [{ id: 'resultado', texto: TEXTO_RESULTADO, obligatorio: true }];
  return req.items.map((r) => ({ id: r.id, texto: textoCriterio(r), obligatorio: true }));
}

/**
 * Los criterios de una misión terminada, CADA UNO con su estado y su evidencia: un archivo pedido es verificado solo
 * con SU archivo comprobado; lo que no se pudo comprobar queda `unknown`, lo que falta o no es lo pedido, `not_met`.
 * Sin archivos de por medio, un solo criterio: el dato comprobado (verified), la acción con efecto afuera (unknown) o nada (not_met).
 */
function criteriosDeMision(m: Pick<MisionComputadoraMin, 'id'>, entrega: Entrega, evidencias: Evidencia[], termino: boolean): Criterio[] {
  if (entrega.tipo === 'archivo') {
    return entrega.items.map((i) => {
      const id = idEvidenciaItem(m.id, i.id);
      const ok = termino && i.estado === 'verified' && evidencias.some((e) => e.id === id);
      const estado: Criterio['estado'] = ok ? 'verified' : !termino ? 'not_met' : i.estado === 'verified' ? 'unknown' : i.estado;
      return { id: i.id, texto: textoCriterio(i), obligatorio: true, estado, evidencias: ok ? [id] : [] };
    });
  }
  const ok = termino && entrega.comprobada;
  const estado: Criterio['estado'] = ok ? 'verified' : termino && (entrega.tipo === 'accion' || entrega.respondida) ? 'unknown' : 'not_met';
  return [{ id: 'resultado', texto: TEXTO_RESULTADO, obligatorio: true, estado, evidencias: ok ? evidencias.map((e) => e.id) : [] }];
}

/**
 * Cómo cierra una misión terminada: `completed` solo si el nodo terminó, no dijo que quedó a medias y CADA cosa pedida
 * se comprobó; si no, `partial` con el porqué de cada una (nunca el «Listo» del modelo como resumen).
 */
function cierreDeComputadora(m: MisionComputadoraMin): { estado: EstadoTarea; ok: boolean; entrega: Entrega; evidencias: Evidencia[]; criterios: Criterio[]; resumen: string; parcial: string[] } {
  const base = estadoDeComputadora(m);
  const entrega = evaluarEntrega(m);
  const termino = m.estado === 'hecha';
  // Sin terminar (parada, falló), su texto es el error: solo cuentan las páginas que abrió.
  const evidencias = termino ? entrega.evidencias : entrega.evidencias.filter((e) => e.tipo === 'enlace');
  const criterios = criteriosDeMision(m, entrega, evidencias, termino);
  const ok = termino && m.ok !== false && entrega.comprobada && criteriosCumplidos(criterios, evidencias);
  // Respondida: terminó, no dijo que quedó a medias, y lo que se pidió se respondió. NO dice que no hubo efecto (ronda 8):
  // la computadora corrió y pudo tocar cosas; su recibo es «possible», como cualquier misión sin comprobar.
  const respondida = !ok && termino && m.ok !== false && !!entrega.respondida;
  const estado: EstadoTarea = ok ? 'completed' : respondida ? 'respondida' : base === 'verifying' || base === 'partial' ? 'partial' : base;
  const sinComprobar = estado === 'partial' && termino && !entrega.comprobada;
  const dijo = (n: number) => (m.resultado ? ` («${texto(m.resultado, n)}»)` : '');
  const resumen = respondida
    ? `${SOLO_RESPONDI} Lo que respondió: ${texto(m.resultado, 220)}`
    : sinComprobar
    ? entrega.tipo === 'archivo' && entrega.total > 0
      ? `Tu computadora dice que terminó${dijo(120)}, pero no pude comprobarlo todo: ${entrega.hechos} de ${entrega.total} de lo que pediste.`
      : `Tu computadora dice que terminó${dijo(160)}, pero no pude comprobarlo.`
    : texto(m.resultado || (estado === 'cancelled' ? 'La paraste antes de terminar.' : estado === 'failed' ? 'Tu computadora no pudo hacerlo.' : 'Terminó, pero sin un resultado que lo acredite.'), 300);
  const parcial = estado === 'partial' ? [sinComprobar && entrega.falta ? texto(entrega.falta, 600) : 'No completó todo lo pedido.'] : [];
  return { estado, ok, entrega, evidencias, criterios, resumen: texto(resumen, 300), parcial };
}

function progresoDePlan(plan?: { estado: string }[]): Progreso | null {
  if (!plan?.length) return null;
  return { hechos: plan.filter((p) => p.estado === 'hecho').length, total: plan.length, unidad: 'pasos del plan' };
}

/** Una misión de su computadora que no nació de una tarea durable, como TaskSnapshot (mismo id, solo lectura). */
export function deComputadora(m: MisionComputadoraMin, ahora = Date.now()): TaskSnapshot {
  const vivo = estadoDeComputadora(m);
  const cierre = vivo === 'verifying' || esTerminal(vivo) ? cierreDeComputadora(m) : null;
  const estado = cierre ? cierre.estado : vivo;
  const ev = cierre ? cierre.evidencias : [];
  const terminal = esTerminal(estado);
  const actual = m.plan?.find((p) => p.estado === 'actual' || p.estado === 'espera');
  const prog = progresoDePlan(m.plan);
  // Cada cosa pedida es su propio criterio, con su estado y SU evidencia (nunca una lista copiada a todos).
  const pendientes = m.requisitos && pideArchivo(m.instruccion, null, m.requisitos) ? m.requisitos.items.map((r) => ({ id: r.id, texto: textoCriterio(r), obligatorio: true })) : criteriosDeEncargo(m.instruccion);
  const criterios: Criterio[] = cierre && terminal ? cierre.criterios : pendientes.map((c) => ({ ...c, estado: 'pending' as const, evidencias: [] }));
  return {
    id: m.id,
    version: m.inicio + m.segundos,
    state: estado,
    terminal,
    source: 'computadora',
    title: texto(m.instruccion, 100) || 'Tu computadora',
    objective: texto(m.instruccion, 400),
    acceptance: criterios.map((c) => ({ id: c.id, text: c.texto, required: c.obligatorio, status: c.estado, evidenceIds: c.evidencias })),
    environment: { kind: 'computadora', id: m.tareaId, displayName: 'Tu computadora' },
    ...(m.pregunta ? { currentStep: `Espera tu sí: ${texto(m.pregunta, 160)}` } : actual ? { currentStep: texto(actual.texto, 160) } : {}),
    progress: prog ? { done: prog.hechos, total: prog.total, unit: prog.unidad } : null,
    planVersion: 1,
    lastEventSequence: 0,
    decision: null,
    result: cierre && terminal ? { id: `${m.id}:final`, summary: cierre.resumen, evidence: ev, partial: cierre.parcial, pending: [], at: new Date(m.inicio + m.segundos * 1000).toISOString() } : null,
    stopCondition: 'Termina, falla o la paras tú.',
    createdAt: new Date(m.inicio).toISOString(),
    updatedAt: new Date(Math.min(ahora, m.inicio + m.segundos * 1000)).toISOString(),
    origin: { kind: 'computadora' },
    controls: { pause: false, resume: false, cancel: false, open: 'computadora' },
  };
}

/**
 * El cambio que lleva una tarea durable enlazada a su misión de la computadora hasta lo que la misión dice.
 * null si no hay nada que cambiar. Completa la tarea solo si CADA cosa pedida quedó comprobada con SU evidencia
 * (evaluarEntrega: «Listo» no es evidencia, y un archivo cumple a lo más una cosa); si no, `partial` con el estado de
 * cada una; parada, `cancelled`. Los criterios obligatorios pasan a ser los de la misión (uno por cosa pedida); los
 * opcionales se conservan.
 */
/** Cuánto puede quedarse una tarea enlazada «reconciling» sin que su misión aparezca antes de cerrarse como incierta. */
export const RECONCILIAR_MAX_MS = 30 * 60_000;

export function reconciliarConComputadora(reg: RegistroTarea, m: MisionComputadoraMin | null, ahora: number): Cambio | null {
  if (esTerminal(reg.estado)) return null;
  if (!m) {
    // La misión no está en ningún lado (P5: las misiones son durables, así que esto es una tarea de antes de P5 o una
    // misión que el almacén perdió): no se sabe cómo terminó. Primero se reconcilia; si pasado RECONCILIAR_MAX_MS sigue sin
    // aparecer, se cierra con la verdad —no se sabe si hubo efecto— en lugar de quedarse «reconciling» para siempre.
    // Nunca «completed»: no hay evidencia.
    if (reg.estado === 'reconciling') {
      if (ahora - reg.actualizada < RECONCILIAR_MAX_MS) return null;
      return {
        estado: 'failed',
        pasoActual: null,
        criterios: reg.criterios.map((c) => (c.obligatorio ? { ...c, estado: 'unknown' as const, evidencias: [] } : c)),
        resultado: {
          id: `${reg.id}:resultado`,
          resumen: 'No pude confirmar cómo terminó en tu computadora: pudo haber hecho cambios. Revísala antes de pedírmelo otra vez; no lo repito a ciegas.',
          evidencias: [],
          parcial: [],
          pendiente: ['Revisar en tu computadora qué quedó hecho'],
          t: ahora,
        },
        eventos: [{ type: 'operation.receipt', payload: { operationId: reg.enlace?.id ?? reg.id, state: 'unknown', effect: 'possible', motivo: 'sin-mision' } }],
      };
    }
    if (ahora - reg.actualizada < 90_000) return null;
    return { estado: 'reconciling', pasoActual: 'No puedo confirmar cómo terminó en tu computadora; reviso antes de repetir nada.' };
  }
  const estado = estadoDeComputadora(m);
  const prog = progresoDePlan(m.plan);
  const actual = m.plan?.find((p) => p.estado === 'actual' || p.estado === 'espera');
  if (estado === 'verifying' || estado === 'partial' || estado === 'cancelled' || estado === 'failed') {
    const { estado: final, ok, evidencias: ev, criterios: deMision, resumen, parcial } = cierreDeComputadora(m);
    const criterios = [...deMision, ...reg.criterios.filter((c) => !c.obligatorio && !deMision.some((d) => d.id === c.id))];
    return {
      estado: final,
      criterios,
      progreso: prog,
      pasoActual: null,
      resultado: { id: `${reg.id}:resultado`, resumen, evidencias: ev, parcial, pendiente: [], t: ahora },
      eventos: [{ type: 'operation.receipt', payload: { operationId: m.tareaId, state: final === 'completed' ? 'succeeded' : final === 'respondida' ? 'answered' : final === 'cancelled' ? 'cancelled' : 'failed', effect: ok ? 'confirmed' : 'possible' } }],
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
 * (no «trabaja»); una pospuesta o en pausa no cuenta: no está trabajando ni te está esperando. La tarea en curso que
 * espera que sigas (`awaiting_approval` sin decisión, `awaitingInput`) tampoco: no trabaja por detrás ni pide decidir.
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
