/**
 * EL OBJETIVO CON ESTADO (Fase 2): lo que la persona quiere lograr —«dejar lista la propuesta para el banco»— como una
 * cosa durable que es DUEÑA de sus tareas, sus documentos y sus decisiones. Sobrevive a cerrar el chat, sigue después de
 * reiniciar el servidor y lo comparten el teléfono, la web y Windows (las tres leen y escriben lo mismo).
 *
 * No es una lista paralela:
 *  · las TAREAS siguen siendo las de lib/tareas-durables.ts: el objetivo guarda sus ids (`tareas`) y cada tarea dice de
 *    qué objetivo es (`objetivoId`). Su estado se reconcilia leyéndolas (`reconciliarObjetivo`), nunca copiándolas;
 *  · los DOCUMENTOS son los de lib/oficina (id, nombre, sha256): el objetivo les da VERSIONES (la nueva enlaza la
 *    anterior por `anteriorId` y solo una es `vigente` por nombre). Los bytes siguen con la retención de la oficina;
 *  · lo durable es lib/durable.ts: `objetivos/<huella del dueño>/<id>` con un índice por dueño y la creación «una vez»
 *    por dueño + requestId.
 *
 * Reglas:
 *  · El dueño sale de la sesión del servidor (aquí siempre es un parámetro, nunca un campo del cuerpo) y se guarda como
 *    huella (`huellaDueno`, nunca el correo).
 *  · Solo AU-RA (`plataforma: 'ultron'`): un objetivo de Dr Electrum no se crea aquí.
 *  · Cada escritura es compare-and-set y sube la `revision` (monotónica) con UN evento corto y humano («Preparé la
 *    versión 2 de «Propuesta»», «Elegiste «Enviar el martes»») en la MISMA escritura: «qué cambió desde que te fuiste»
 *    sale de ahí (`cambiosDesde`). Con `revisionEsperada` (lo que vio la persona), si ya no es esa no se escribe y vuelve
 *    un error tipado (`ErrorObjetivo` con `codigo: 'revision'` y la revisión actual).
 *  · Terminales inmutables: `completado`, `cancelado` y `fallido` no cambian.
 *  · `completado` exige evidencia de CADA criterio de cierre (como `aplicarCambio` de las tareas): un documento vigente
 *    del objetivo, una tarea del objetivo (que quien llama comprobó completada) o un enlace https. Lo que «dice» el
 *    modelo no es evidencia.
 *  · Los PERMISOS son una lista explícita que se fija al crear (por omisión solo `preparar-borradores`) y no hay camino
 *    que la cambie desde un texto: ni el nombre de un documento, ni la meta, ni lo que diga un correo.
 *  · Las decisiones tienen a lo más tres opciones, cada una con su consecuencia dicha, y se ligan a una revisión: una
 *    elección hecha sobre una revisión vieja no se aplica (dos aparatos a la vez: gana uno y el otro ve el estado nuevo).
 */
import crypto from 'node:crypto';
import { agendar } from './agenda';
import { almacenDurable, claveDe, crearUnaVez, huellaDueno, leerDurable, modificarDurable, reservarPedido, type AlmacenDurable } from './durable';
import { esTerminal, type EstadoTarea } from './tareas-durables';

/* ------------------------------------------------------------------ forma */

export const ESTADOS_OBJETIVO = ['abierto', 'esperando-decision', 'en-curso', 'esperando-recurso', 'incierto', 'completado', 'cancelado', 'fallido'] as const;
export type EstadoObjetivo = (typeof ESTADOS_OBJETIVO)[number];
export const TERMINALES_OBJETIVO: ReadonlySet<EstadoObjetivo> = new Set<EstadoObjetivo>(['completado', 'cancelado', 'fallido']);
export const esTerminalObjetivo = (e: EstadoObjetivo) => TERMINALES_OBJETIVO.has(e);

/**
 * Lo que AURA puede hacer por este objetivo sin preguntar otra vez. Lista cerrada: lo demás no existe. `investigar`: el
 * planificador puede arrancar SOLO una investigación (búsquedas + el cerebro, cuesta) para una tarea del objetivo creada
 * con `ejecutar: true`, dentro de su `topeCosto` (server/planificador.ts).
 */
export const PERMISOS_OBJETIVO = ['preparar-borradores', 'enviar-correo', 'enviar-whatsapp', 'agendar', 'usar-computadora', 'gastar', 'investigar'] as const;
export type PermisoObjetivo = (typeof PERMISOS_OBJETIVO)[number];
export const PERMISOS_POR_OMISION: readonly PermisoObjetivo[] = ['preparar-borradores'];

export type EvidenciaObjetivo = { tipo: 'documento' | 'tarea' | 'enlace'; ref: string; etiqueta: string; t: number };
export type CriterioCierre = { id: string; texto: string; evidencias: EvidenciaObjetivo[] };
export type DocumentoObjetivo = { id: string; nombre: string; version: number; anteriorId?: string; vigente: boolean; sha256: string; creado: number };
export type OpcionObjetivo = { id: string; etiqueta: string; consecuencia: string };
export type DecisionObjetivo = {
  id: string;
  pregunta: string;
  opciones: OpcionObjetivo[];
  elegida?: string;
  /** La revisión del objetivo en que se planteó (la que ve quien decide). */
  version: number;
  /** Quién eligió: la persona (por la app) o AURA (con un permiso explícito). */
  por?: 'persona' | 'aura';
  cuando?: number;
  /** Desde qué aparato (el `x-aura-aparato` del teléfono, la web o Windows). */
  aparato?: string;
  creada: number;
};
export type EventoObjetivo = { revision: number; t: number; texto: string; campos: string[] };

export type Objetivo = {
  v: 1;
  id: string;
  /** Huella del dueño (nunca el correo). No sale al cliente. */
  dueno: string;
  requestId: string;
  plataforma: 'ultron';
  proyecto: string;
  titulo: string;
  meta: string;
  criterioCierre: CriterioCierre[];
  documentos: DocumentoObjetivo[];
  decisiones: DecisionObjetivo[];
  restricciones: string[];
  permisos: PermisoObjetivo[];
  topeCosto: number | null;
  siguientePaso: string;
  estado: EstadoObjetivo;
  /** En pausa: el planificador no arranca sus tareas. No es un estado (se vuelve al que tenía). */
  pausado: boolean;
  revision: number;
  eventos: EventoObjetivo[];
  tareas: string[];
  creado: number;
  actualizado: number;
  /**
   * F01/F05: las tareas que ya habían pasado el punto de no retorno cuando se canceló (su efecto fue aceptado). Su recibo
   * llega después y se anota en `hechosTardios` sin reactivar nada (el objetivo sigue cancelado). Opcional: los de antes no
   * lo tienen.
   */
  enVueloAlCancelar?: string[];
  /** Lo que terminó después de cancelar (el recibo real de una acción ya aceptada): visible junto con la cancelación. */
  hechosTardios?: { tareaId: string; estado: string; t: number }[];
};

export const MAX_EVENTOS_OBJETIVO = 100;
export const MAX_DOCUMENTOS = 60;
export const MAX_TAREAS_OBJETIVO = 100;
export const MAX_OPCIONES = 3;
export const ESPACIO_OBJETIVOS = 'objetivos';
const ESPACIO_PEDIDOS_OBJ = 'objetivos/pedidos';
const ESPACIO_INDICE_OBJ = 'objetivos/indice';
const MAX_INDICE = 300;

/** Texto de una línea, sin controles ni lo que el harness lee como orden (un título no le habla al modelo). */
export const textoObjetivo = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/PEDIR_HERRAMIENTA/gi, 'PEDIR-HERRAMIENTA')
    .replace(/ACCION_APP/gi, 'ACCION-APP')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
const idLimpio = (v: unknown, max = 40) =>
  String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
const idNuevo = (p: string) => `${p}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
const nombreCanon = (s: string) => textoObjetivo(s, 200).toLowerCase();

export const claveObjetivo = (dueno: string, id: string) => claveDe(ESPACIO_OBJETIVOS, dueno, id);
const claveIndiceObj = (dueno: string) => claveDe(ESPACIO_INDICE_OBJ, dueno, 'lista');
export const RE_ID_OBJETIVO = /^ob_[a-z0-9]{8,40}$/;

/* ------------------------------------------------------------------ errores tipados */

export type CodigoErrorObjetivo = 'revision' | 'terminal' | 'sin-evidencia' | 'no-existe' | 'almacen' | 'decision-vieja' | 'ya-decidida' | 'opcion' | 'invalido' | 'plataforma' | 'permiso';

/** Por qué no se escribió. `objetivo`: como está ahora (para que el cliente se ponga al día sin otra lectura). */
export class ErrorObjetivo extends Error {
  readonly codigo: CodigoErrorObjetivo;
  readonly objetivo?: Objetivo;
  constructor(codigo: CodigoErrorObjetivo, mensaje: string, objetivo?: Objetivo) {
    super(mensaje);
    this.name = 'ErrorObjetivo';
    this.codigo = codigo;
    this.objetivo = objetivo;
  }
  get revisionActual(): number | undefined {
    return this.objetivo?.revision;
  }
}

/* ------------------------------------------------------------------ crear */

export type NuevoObjetivo = {
  requestId: string;
  titulo: string;
  meta?: string;
  proyecto?: string;
  plataforma?: string;
  criterioCierre: (string | { id?: string; texto: string })[];
  restricciones?: string[];
  permisos?: string[];
  topeCosto?: number | null;
  siguientePaso?: string;
};

/** Valida y arma el registro nuevo (puro). Error tipado si algo no vale. */
export function objetivoNuevo(id: string, dueno: string, d: NuevoObjetivo, ahora: number): { ok: true; objetivo: Objetivo } | { ok: false; error: ErrorObjetivo } {
  const plataforma = d.plataforma === undefined || d.plataforma === null || d.plataforma === '' ? 'ultron' : String(d.plataforma).trim().toLowerCase();
  if (plataforma !== 'ultron') return { ok: false, error: new ErrorObjetivo('plataforma', 'Los objetivos con estado son de AU-RA; Dr Electrum no los usa.') };
  const titulo = textoObjetivo(d.titulo, 120);
  if (titulo.length < 3) return { ok: false, error: new ErrorObjetivo('invalido', 'El objetivo necesita un título.') };
  const lista = Array.isArray(d.criterioCierre) ? d.criterioCierre : [];
  const criterios: CriterioCierre[] = [];
  for (const c of lista.slice(0, 8)) {
    const textoC = textoObjetivo(typeof c === 'string' ? c : c?.texto, 200);
    if (!textoC) continue;
    let cid = idLimpio(typeof c === 'string' ? '' : c?.id) || `c${criterios.length + 1}`;
    while (criterios.some((x) => x.id === cid)) cid = `${cid}-${criterios.length + 1}`;
    criterios.push({ id: cid, texto: textoC, evidencias: [] });
  }
  if (!criterios.length) return { ok: false, error: new ErrorObjetivo('invalido', 'Dime cómo sabremos que está terminado (al menos un criterio de cierre).') };
  let permisos: PermisoObjetivo[] = [...PERMISOS_POR_OMISION];
  if (d.permisos !== undefined) {
    if (!Array.isArray(d.permisos)) return { ok: false, error: new ErrorObjetivo('permiso', 'Los permisos van como una lista.') };
    const pedidos = d.permisos.map((p) => String(p || '').trim().toLowerCase());
    const desconocido = pedidos.find((p) => !(PERMISOS_OBJETIVO as readonly string[]).includes(p));
    if (desconocido !== undefined) return { ok: false, error: new ErrorObjetivo('permiso', `Ese permiso no existe: «${textoObjetivo(desconocido, 40)}».`) };
    permisos = [...new Set(pedidos)] as PermisoObjetivo[];
  }
  let topeCosto: number | null = null;
  if (d.topeCosto !== undefined && d.topeCosto !== null) {
    const n = Number(d.topeCosto);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: new ErrorObjetivo('invalido', 'El tope de costo es un número (0 o más) o nada.') };
    topeCosto = Math.round(n * 100) / 100;
  }
  const objetivo: Objetivo = {
    v: 1,
    id,
    dueno: huellaDueno(dueno),
    requestId: String(d.requestId).slice(0, 120),
    plataforma: 'ultron',
    proyecto: textoObjetivo(d.proyecto, 80),
    titulo,
    meta: textoObjetivo(d.meta || titulo, 600),
    criterioCierre: criterios,
    documentos: [],
    decisiones: [],
    restricciones: (Array.isArray(d.restricciones) ? d.restricciones : []).map((r) => textoObjetivo(r, 200)).filter(Boolean).slice(0, 12),
    permisos,
    topeCosto,
    siguientePaso: textoObjetivo(d.siguientePaso, 200),
    estado: 'abierto',
    pausado: false,
    revision: 1,
    eventos: [{ revision: 1, t: ahora, texto: `Abrimos el objetivo «${titulo}»`, campos: ['estado'] }],
    tareas: [],
    creado: ahora,
    actualizado: ahora,
  };
  return { ok: true, objetivo };
}

type Opciones = { almacen?: AlmacenDurable; ahora?: number };
type IndiceObjetivos = { v: 1; ids: { id: string; t: number }[] };

/**
 * Crea el objetivo UNA vez por dueño + requestId: reintentar, perder la respuesta o pedirlo desde otro aparato con el
 * mismo requestId devuelve el MISMO (`creado: false`). El índice va ANTES que el objeto (como las tareas): un objetivo que
 * existe siempre está en su lista.
 */
export async function crearObjetivo(dueno: string, d: NuevoObjetivo, o: Opciones = {}): Promise<{ ok: true; creado: boolean; objetivo: Objetivo } | { ok: false; error: ErrorObjetivo }> {
  const a = o.almacen || almacenDurable();
  const ahora = o.ahora ?? Date.now();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(d.requestId || ''))) return { ok: false, error: new ErrorObjetivo('invalido', 'Falta el requestId (8 a 64 letras, números, - o _).') };
  // Se valida antes de reservar: un pedido inválido no se queda con el requestId.
  const prueba = objetivoNuevo('ob_validar00', dueno, d, ahora);
  if (prueba.ok === false) return prueba;
  const r = await reservarPedido({ espacio: ESPACIO_PEDIDOS_OBJ, dueno, requestId: d.requestId, propuesto: idNuevo('ob'), almacen: a });
  if (r.ok === false) return { ok: false, error: new ErrorObjetivo('almacen', r.detalle) };
  const ix = await modificarDurable<IndiceObjetivos>(
    claveIndiceObj(dueno),
    (x) => (x?.ids.some((e) => e.id === r.id) ? undefined : { v: 1, ids: [{ id: r.id, t: ahora }, ...(x?.ids || [])].slice(0, MAX_INDICE) }),
    a
  );
  if (ix.ok === false) return { ok: false, error: new ErrorObjetivo('almacen', `no pude anotarlo en tu lista; no lo creé (${ix.detalle.slice(0, 80)})`) };
  const nuevo = objetivoNuevo(r.id, dueno, d, ahora);
  if (nuevo.ok === false) return nuevo;
  const c = await crearUnaVez(claveObjetivo(dueno, r.id), nuevo.objetivo, a);
  if (c.ok === false) return { ok: false, error: new ErrorObjetivo('almacen', c.detalle) };
  return { ok: true, creado: c.creado, objetivo: c.valor };
}

/* ------------------------------------------------------------------ leer */

export async function leerObjetivo(dueno: string, id: string, a: AlmacenDurable = almacenDurable()): Promise<{ ok: true; objetivo: Objetivo | null } | { ok: false; detalle: string }> {
  if (!RE_ID_OBJETIVO.test(String(id || ''))) return { ok: true, objetivo: null };
  const l = await leerDurable<Objetivo>(claveObjetivo(dueno, id), a);
  if (l.ok === false) return { ok: false, detalle: l.detalle };
  // Lo de otro dueño, para quien pregunta, no existe.
  return { ok: true, objetivo: l.valor && l.valor.dueno === huellaDueno(dueno) && l.valor.id === id ? l.valor : null };
}

/** Los objetivos del dueño, el más reciente primero. `noLeidos`: los que no se pudieron leer (no es «no existen»). */
export async function listarObjetivos(dueno: string, a: AlmacenDurable = almacenDurable()): Promise<{ ok: true; objetivos: Objetivo[]; noLeidos: string[] } | { ok: false; detalle: string }> {
  const ix = await leerDurable<IndiceObjetivos>(claveIndiceObj(dueno), a);
  if (ix.ok === false) return { ok: false, detalle: ix.detalle };
  const ids = (ix.valor?.ids || []).map((e) => e.id);
  const objetivos: Objetivo[] = [];
  const noLeidos: string[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    const tanda = ids.slice(i, i + 10);
    const leidos = await Promise.all(tanda.map((id) => leerObjetivo(dueno, id, a).catch(() => ({ ok: false as const, detalle: '' }))));
    tanda.forEach((id, j) => {
      const l = leidos[j];
      if (l.ok === false) noLeidos.push(id);
      else if (l.objetivo) objetivos.push(l.objetivo);
    });
  }
  return { ok: true, objetivos: objetivos.sort((x, y) => y.actualizado - x.actualizado), noLeidos };
}

/* ------------------------------------------------------------------ cambiar (puro) */

export type CambioObjetivo = {
  /** El hecho, corto y humano, que deja esta escritura en `eventos`. */
  evento: string;
  estado?: EstadoObjetivo;
  pausado?: boolean;
  siguientePaso?: string;
  /** Una versión de un documento de la oficina (id, nombre y sha256 de su ficha). */
  documento?: { id: string; nombre: string; sha256: string; creado: number };
  /** Una decisión nueva que AURA necesita de la persona. */
  decisionNueva?: { id?: string; pregunta: string; opciones: { id?: string; etiqueta: string; consecuencia: string }[] };
  /** La persona (o AURA con permiso) elige. Se valida con `validarDecisionObjetivo`. */
  decidir?: { decisionId: string; opcion: string; por: 'persona' | 'aura'; aparato?: string };
  /** Una tarea durable que pasa a ser de este objetivo. */
  tarea?: string;
  /** Al cerrar: la evidencia de cada criterio (por su id). */
  evidencias?: { criterioId: string; tipo: EvidenciaObjetivo['tipo']; ref: string; etiqueta?: string }[];
  /** F01: las tareas cuya acción ya estaba aceptada al cancelar (se permite sobre un objetivo ya cancelado). */
  enVueloAlCancelar?: string[];
  /** F05: llegó el resultado de una de esas tareas (se permite sobre un terminal: solo anota el hecho, no reactiva). */
  tardio?: { tareaId: string; estado: string };
};

/** Los campos que se comparan para decir «qué cambió» (todo menos lo que cambia en cada escritura). */
const CAMPOS_VISIBLES = ['proyecto', 'titulo', 'meta', 'criterioCierre', 'documentos', 'decisiones', 'restricciones', 'permisos', 'topeCosto', 'siguientePaso', 'estado', 'pausado', 'tareas', 'enVueloAlCancelar', 'hechosTardios'] as const;
type CampoVisible = (typeof CAMPOS_VISIBLES)[number];

/** ¿Esta evidencia vale para este objetivo? Un documento vigente suyo, una tarea suya o un enlace https. */
export function evidenciaValida(obj: Pick<Objetivo, 'documentos' | 'tareas'>, e: Pick<EvidenciaObjetivo, 'tipo' | 'ref'>): boolean {
  const ref = String(e.ref || '');
  if (e.tipo === 'documento') return obj.documentos.some((d) => d.id === ref && d.vigente);
  if (e.tipo === 'tarea') return obj.tareas.includes(ref);
  if (e.tipo === 'enlace') return /^https:\/\/[^\s/]+\.[^\s]{2,}/i.test(ref) && ref.length <= 500;
  return false;
}

/** ¿Cada criterio de cierre tiene al menos una evidencia que vale? (como `criteriosCumplidos` de las tareas). */
export function criteriosCerrados(obj: Pick<Objetivo, 'criterioCierre' | 'documentos' | 'tareas'>): boolean {
  return obj.criterioCierre.length > 0 && obj.criterioCierre.every((c) => c.evidencias.length > 0 && c.evidencias.every((e) => evidenciaValida(obj, e)));
}

export type PedidoDecisionObjetivo = { decisionId: string; opcion: string; revisionVista: number };
export type ValidacionObjetivo = { ok: true; decision: DecisionObjetivo; opcion: OpcionObjetivo } | { ok: true; repetida: true; decision: DecisionObjetivo } | { ok: false; codigo: 'terminal' | 'decision-vieja' | 'revision' | 'opcion' | 'ya-decidida'; mensaje: string };

/**
 * ¿Esta elección se puede aplicar AHORA? Pura, como `validarDecision` de las tareas. La misma elección ya aplicada es
 * `repetida` (se perdió la respuesta: no se repite nada); una decisión que ya no existe, sobre otra revisión, o con una
 * opción que no se ofreció, no se aplica.
 */
export function validarDecisionObjetivo(obj: Objetivo, p: PedidoDecisionObjetivo): ValidacionObjetivo {
  const d = obj.decisiones.find((x) => x.id === p.decisionId);
  if (d?.elegida) return d.elegida === p.opcion ? { ok: true, repetida: true, decision: d } : { ok: false, codigo: 'ya-decidida', mensaje: 'Esa decisión ya se tomó con otra opción (quizá desde otro aparato).' };
  if (esTerminalObjetivo(obj.estado)) return { ok: false, codigo: 'terminal', mensaje: 'El objetivo ya terminó; no hay nada que decidir.' };
  if (!d) return { ok: false, codigo: 'decision-vieja', mensaje: 'Esa pregunta ya no está. Mira cómo quedó antes de decidir.' };
  if (obj.revision !== p.revisionVista) return { ok: false, codigo: 'revision', mensaje: 'El objetivo cambió mientras decidías. Mira cómo quedó.' };
  const opcion = d.opciones.find((x) => x.id === p.opcion);
  if (!opcion) return { ok: false, codigo: 'opcion', mensaje: 'Esa opción no se ofreció en esta decisión.' };
  return { ok: true, decision: d, opcion };
}

/**
 * Aplica un cambio a una copia (puro). Devuelve el objetivo nuevo (revisión + 1 y su evento en la misma escritura) o el
 * error tipado. Lo que no cambia nada (repetir lo mismo) devuelve `cambiado: false` sin subir la revisión.
 */
export function aplicarCambioObjetivo(obj: Objetivo, c: CambioObjetivo, ahora: number): { ok: true; objetivo: Objetivo; cambiado: boolean } | { ok: false; error: ErrorObjetivo } {
  if (esTerminalObjetivo(obj.estado) && (c.enVueloAlCancelar || c.tardio)) return anotarSobreTerminal(obj, c, ahora);
  if (esTerminalObjetivo(obj.estado)) {
    const mismo = (c.estado === undefined || c.estado === obj.estado) && c.pausado === undefined && c.siguientePaso === undefined && !c.documento && !c.decisionNueva && !c.decidir && !c.tarea && !c.evidencias;
    return mismo ? { ok: true, objetivo: obj, cambiado: false } : { ok: false, error: new ErrorObjetivo('terminal', 'El objetivo ya terminó: no cambia.', obj) };
  }
  const n: Objetivo = JSON.parse(JSON.stringify(obj));
  if (c.siguientePaso !== undefined) n.siguientePaso = textoObjetivo(c.siguientePaso, 200);
  if (c.pausado !== undefined) n.pausado = !!c.pausado;
  if (c.tarea) {
    const id = String(c.tarea);
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) return { ok: false, error: new ErrorObjetivo('invalido', 'Ese id de tarea no vale.', obj) };
    if (!n.tareas.includes(id)) {
      if (n.tareas.length >= MAX_TAREAS_OBJETIVO) return { ok: false, error: new ErrorObjetivo('invalido', 'Este objetivo ya tiene demasiadas tareas.', obj) };
      n.tareas.push(id);
    }
  }
  if (c.documento) {
    const doc = c.documento;
    const nombre = textoObjetivo(doc.nombre, 160);
    if (!/^d_[0-9a-f]{24}$/.test(String(doc.id)) || !/^[0-9a-f]{64}$/.test(String(doc.sha256)) || !nombre) return { ok: false, error: new ErrorObjetivo('invalido', 'Ese documento no tiene una ficha válida.', obj) };
    if (!n.documentos.some((x) => x.id === doc.id)) {
      const previo = n.documentos.find((x) => x.vigente && nombreCanon(x.nombre) === nombreCanon(nombre));
      if (!previo || previo.sha256 !== doc.sha256) {
        if (n.documentos.length >= MAX_DOCUMENTOS) return { ok: false, error: new ErrorObjetivo('invalido', 'Este objetivo ya tiene demasiados documentos.', obj) };
        if (previo) previo.vigente = false;
        n.documentos.push({ id: doc.id, nombre, version: previo ? previo.version + 1 : 1, ...(previo ? { anteriorId: previo.id } : {}), vigente: true, sha256: doc.sha256, creado: doc.creado || ahora });
      }
    }
  }
  if (c.decisionNueva) {
    const dn = c.decisionNueva;
    const pregunta = textoObjetivo(dn.pregunta, 240);
    const ops = Array.isArray(dn.opciones) ? dn.opciones : [];
    if (!pregunta || ops.length < 1 || ops.length > MAX_OPCIONES) return { ok: false, error: new ErrorObjetivo('invalido', `Una decisión lleva su pregunta y de 1 a ${MAX_OPCIONES} opciones.`, obj) };
    const opciones: OpcionObjetivo[] = [];
    for (const op of ops) {
      const etiqueta = textoObjetivo(op?.etiqueta, 40);
      const consecuencia = textoObjetivo(op?.consecuencia, 200);
      if (!etiqueta || !consecuencia) return { ok: false, error: new ErrorObjetivo('invalido', 'Cada opción dice qué es y qué pasa si la eliges.', obj) };
      let oid = idLimpio(op?.id || etiqueta, 30) || `o${opciones.length + 1}`;
      while (opciones.some((x) => x.id === oid)) oid = `${oid}-${opciones.length + 1}`;
      opciones.push({ id: oid, etiqueta, consecuencia });
    }
    const id = /^dob_[a-z0-9]{6,40}$/.test(String(dn.id || '')) ? String(dn.id) : idNuevo('dob');
    if (!n.decisiones.some((x) => x.id === id)) n.decisiones = [...n.decisiones, { id, pregunta, opciones, version: obj.revision + 1, creada: ahora }].slice(-30);
    n.estado = 'esperando-decision';
  }
  if (c.decidir) {
    const d = n.decisiones.find((x) => x.id === c.decidir!.decisionId);
    if (!d) return { ok: false, error: new ErrorObjetivo('decision-vieja', 'Esa pregunta ya no está.', obj) };
    if (d.elegida) {
      if (d.elegida !== c.decidir.opcion) return { ok: false, error: new ErrorObjetivo('ya-decidida', 'Esa decisión ya se tomó con otra opción.', obj) };
    } else {
      if (!d.opciones.some((x) => x.id === c.decidir!.opcion)) return { ok: false, error: new ErrorObjetivo('opcion', 'Esa opción no se ofreció.', obj) };
      d.elegida = c.decidir.opcion;
      d.por = c.decidir.por;
      d.cuando = ahora;
      if (c.decidir.aparato) d.aparato = textoObjetivo(c.decidir.aparato, 128);
      // Ya no queda nada que decidir: AURA sigue.
      if (n.estado === 'esperando-decision' && !n.decisiones.some((x) => !x.elegida)) n.estado = 'en-curso';
    }
  }
  if (c.evidencias) {
    for (const e of c.evidencias) {
      const cr = n.criterioCierre.find((x) => x.id === e.criterioId);
      if (!cr) return { ok: false, error: new ErrorObjetivo('sin-evidencia', `No hay un criterio «${textoObjetivo(e.criterioId, 40)}».`, obj) };
      const ev: EvidenciaObjetivo = { tipo: e.tipo, ref: String(e.ref || '').slice(0, 500), etiqueta: textoObjetivo(e.etiqueta || e.ref, 160), t: ahora };
      if (!evidenciaValida(n, ev)) return { ok: false, error: new ErrorObjetivo('sin-evidencia', `La evidencia de «${cr.texto}» no se pudo comprobar (un documento vigente o una tarea de este objetivo, o un enlace https).`, obj) };
      if (!cr.evidencias.some((x) => x.tipo === ev.tipo && x.ref === ev.ref)) cr.evidencias.push(ev);
    }
  }
  if (c.estado !== undefined) {
    if (!(ESTADOS_OBJETIVO as readonly string[]).includes(c.estado)) return { ok: false, error: new ErrorObjetivo('invalido', 'Ese estado no existe.', obj) };
    n.estado = c.estado;
  }
  // Invariante: completado solo con evidencia de cada criterio.
  if (n.estado === 'completado' && !criteriosCerrados(n)) return { ok: false, error: new ErrorObjetivo('sin-evidencia', 'Para cerrarlo, cada criterio de cierre necesita su evidencia comprobable.', obj) };
  if (esTerminalObjetivo(n.estado)) n.pausado = false;
  const campos = CAMPOS_VISIBLES.filter((k) => JSON.stringify(n[k]) !== JSON.stringify(obj[k]));
  if (!campos.length) return { ok: true, objetivo: obj, cambiado: false };
  n.revision = obj.revision + 1;
  n.actualizado = ahora;
  n.eventos = [...n.eventos, { revision: n.revision, t: ahora, texto: textoObjetivo(c.evento, 200) || 'Actualicé el objetivo', campos: [...campos] }].slice(-MAX_EVENTOS_OBJETIVO);
  return { ok: true, objetivo: n, cambiado: true };
}

/**
 * Lo único que se escribe sobre un objetivo terminal (puro): qué tareas seguían con su efecto aceptado al cancelar y,
 * cuando su resultado llega, el hecho (sin cambiar el estado ni reactivar pasos cancelados). Repetirlo no escribe nada.
 */
function anotarSobreTerminal(obj: Objetivo, c: CambioObjetivo, ahora: number): { ok: true; objetivo: Objetivo; cambiado: boolean } {
  const n: Objetivo = JSON.parse(JSON.stringify(obj));
  if (c.enVueloAlCancelar) {
    const ya = new Set((n.hechosTardios || []).map((h) => h.tareaId));
    n.enVueloAlCancelar = [...new Set([...(n.enVueloAlCancelar || []), ...c.enVueloAlCancelar.map(String)])].filter((id) => /^[A-Za-z0-9_-]{4,64}$/.test(id) && !ya.has(id) && n.tareas.includes(id)).slice(0, MAX_TAREAS_OBJETIVO);
  }
  if (c.tardio && (n.enVueloAlCancelar || []).includes(c.tardio.tareaId)) {
    n.enVueloAlCancelar = (n.enVueloAlCancelar || []).filter((id) => id !== c.tardio!.tareaId);
    n.hechosTardios = [...(n.hechosTardios || []), { tareaId: c.tardio.tareaId, estado: textoObjetivo(c.tardio.estado, 30), t: ahora }].slice(-MAX_TAREAS_OBJETIVO);
  }
  const campos = CAMPOS_VISIBLES.filter((k) => JSON.stringify(n[k] ?? null) !== JSON.stringify(obj[k] ?? null));
  if (!campos.length) return { ok: true, objetivo: obj, cambiado: false };
  n.revision = obj.revision + 1;
  n.actualizado = ahora;
  n.eventos = [...n.eventos, { revision: n.revision, t: ahora, texto: textoObjetivo(c.evento, 200) || 'Anoté lo que llegó después de cancelar', campos: [...campos] }].slice(-MAX_EVENTOS_OBJETIVO);
  return { ok: true, objetivo: n, cambiado: true };
}

/* ------------------------------------------------------------------ cambiar (durable) */

export type ResultadoCambioObjetivo = { ok: true; objetivo: Objetivo; cambiado: boolean } | { ok: false; error: ErrorObjetivo };

/**
 * Cambia el objetivo con compare-and-set. `cambio` recibe el registro actual (una copia) y devuelve el cambio o null
 * (nada que hacer). Con `revisionEsperada`, si la revisión ya no es esa no se escribe: `ErrorObjetivo('revision')` con el
 * objetivo de ahora. Si `cambio` lanza un `ErrorObjetivo`, vuelve como resultado (no se escribe nada).
 */
export async function cambiarObjetivo(dueno: string, id: string, cambio: (obj: Objetivo) => CambioObjetivo | null, o: Opciones & { revisionEsperada?: number } = {}): Promise<ResultadoCambioObjetivo> {
  const a = o.almacen || almacenDurable();
  if (!RE_ID_OBJETIVO.test(String(id || ''))) return { ok: false, error: new ErrorObjetivo('no-existe', 'No encuentro ese objetivo.') };
  let error: ErrorObjetivo | null = null;
  let visto: Objetivo | undefined;
  let cambiado = false;
  const r = await modificarDurable<Objetivo>(
    claveObjetivo(dueno, id),
    (obj) => {
      error = null;
      cambiado = false;
      visto = obj && obj.dueno === huellaDueno(dueno) && obj.id === id ? obj : undefined;
      if (!visto) return void (error = new ErrorObjetivo('no-existe', 'No encuentro ese objetivo.'));
      if (o.revisionEsperada !== undefined && visto.revision !== o.revisionEsperada) return void (error = new ErrorObjetivo('revision', 'El objetivo cambió mientras lo mirabas. Mira cómo quedó.', visto));
      let c: CambioObjetivo | null;
      try {
        c = cambio(visto);
      } catch (e) {
        if (e instanceof ErrorObjetivo) return void (error = e);
        throw e;
      }
      if (!c) return undefined;
      const ap = aplicarCambioObjetivo(visto, c, o.ahora ?? Date.now());
      if (ap.ok === false) return void (error = ap.error);
      cambiado = ap.cambiado;
      return ap.cambiado ? ap.objetivo : undefined;
    },
    a
  ).catch((e) => ({ ok: false as const, conflicto: false, detalle: String(e?.message || e) }));
  if (r.ok === false) return { ok: false, error: new ErrorObjetivo('almacen', r.detalle, visto) };
  if (error) return { ok: false, error };
  const final = (cambiado ? (r.valor as Objetivo) : visto)!;
  // Lo incierto se vuelve a mirar sin esperar a que alguien abra la app (server/planificador.ts).
  if (cambiado && final.estado === 'incierto' && visto?.estado !== 'incierto') await agendar('objetivo', dueno, id, final.actualizado, { almacen: a }).catch(() => false);
  // F04: lo que entra a «espera tu decisión» queda en la agenda: el planificador se asegura de que su aviso esté en la
  // bandeja de salida aunque este proceso muera justo después de escribir (el hueco entre el cambio y el aviso se repara).
  if (cambiado && final.estado === 'esperando-decision' && visto?.estado !== 'esperando-decision') await agendar('objetivo', dueno, id, final.actualizado, { almacen: a }).catch(() => false);
  return { ok: true, objetivo: final, cambiado };
}

/** Plantear una decisión (AURA la necesita): el objetivo pasa a `esperando-decision`. */
export async function pedirDecision(dueno: string, id: string, d: CambioObjetivo['decisionNueva'] & {}, o: Opciones & { revisionEsperada?: number } = {}): Promise<ResultadoCambioObjetivo> {
  return cambiarObjetivo(dueno, id, () => ({ decisionNueva: d, evento: `Necesito tu decisión: ${textoObjetivo(d.pregunta, 150)}` }), o);
}

/**
 * Elegir una opción, validado como `validarDecision` de las tareas DENTRO del compare-and-set: si dos aparatos eligen a la
 * vez sobre la misma revisión, el primero escribe y el segundo encuentra otra revisión (`revision`) o la decisión ya
 * tomada (`ya-decidida`). La misma elección repetida no escribe nada (`repetida`).
 */
export async function decidirObjetivo(
  dueno: string,
  id: string,
  p: PedidoDecisionObjetivo & { aparato?: string; por?: 'persona' | 'aura' },
  o: Opciones = {}
): Promise<ResultadoCambioObjetivo & { repetida?: boolean }> {
  let repetida = false;
  const r = await cambiarObjetivo(
    dueno,
    id,
    (obj) => {
      repetida = false;
      const v = validarDecisionObjetivo(obj, p);
      if (v.ok === false) throw new ErrorObjetivo(v.codigo, v.mensaje, obj);
      if ('repetida' in v) {
        repetida = true;
        return null;
      }
      const donde = p.aparato ? ` desde ${textoObjetivo(p.aparato, 60)}` : '';
      return { decidir: { decisionId: v.decision.id, opcion: v.opcion.id, por: p.por || 'persona', aparato: p.aparato }, evento: `${p.por === 'aura' ? 'AURA eligió' : 'Elegiste'} «${v.opcion.etiqueta}»${donde}` };
    },
    o
  );
  return r.ok ? { ...r, repetida } : r;
}

/* ------------------------------------------------------------------ reconciliar con sus tareas */

/** Lo mínimo de una tarea para reconciliar el objetivo (null: no se pudo leer). */
export type TareaParaObjetivo = { id: string; estado: EstadoTarea; decision?: { id: string } | null } | null;

const EN_CURSO: ReadonlySet<EstadoTarea> = new Set<EstadoTarea>(['created', 'planning', 'queued', 'running', 'verifying', 'pausing', 'cancelling', 'takeover_requested', 'human_control']);

/**
 * El estado que dicen sus tareas (puro). null si no hay nada que cambiar. Una tarea que no se pudo leer deja todo como
 * está (no saber no es «terminó»). Una decisión del objetivo sin elegir manda sobre todo; después, lo incierto (una tarea
 * que reconcilia un efecto que pudo pasar), lo que espera a la persona, lo que trabaja y lo que espera un recurso.
 */
export function reconciliarObjetivo(obj: Objetivo, tareas: TareaParaObjetivo[]): CambioObjetivo | null {
  if (esTerminalObjetivo(obj.estado)) return null;
  if (tareas.some((t) => t === null)) return null;
  const vivas = (tareas as Exclude<TareaParaObjetivo, null>[]).filter((t) => !esTerminal(t.estado));
  let estado: EstadoObjetivo | null = null;
  if (obj.decisiones.some((d) => !d.elegida)) estado = 'esperando-decision';
  else if (vivas.some((t) => t.estado === 'reconciling')) estado = 'incierto';
  else if (vivas.some((t) => t.estado === 'awaiting_approval' && t.decision)) estado = 'esperando-decision';
  else if (vivas.some((t) => EN_CURSO.has(t.estado))) estado = 'en-curso';
  else if (vivas.some((t) => t.estado === 'waiting_resource' || t.estado === 'blocked')) estado = 'esperando-recurso';
  else if (obj.estado === 'incierto' || obj.estado === 'en-curso' || obj.estado === 'esperando-recurso' || obj.estado === 'esperando-decision') estado = 'abierto';
  if (!estado || estado === obj.estado) return null;
  const evento: Record<EstadoObjetivo, string> = {
    'esperando-decision': 'Necesito tu decisión para seguir',
    incierto: 'No pude confirmar cómo terminó un paso; lo reviso antes de repetir nada',
    'en-curso': 'Sigo trabajando en esto',
    'esperando-recurso': 'Espero algo para poder seguir',
    abierto: obj.estado === 'incierto' ? 'Ya revisé lo que estaba incierto; queda listo para el siguiente paso' : 'Terminó lo que estaba en marcha; queda listo para el siguiente paso',
    completado: '',
    cancelado: '',
    fallido: '',
  };
  return { estado, evento: evento[estado] };
}

/* ------------------------------------------------------------------ lo que ve el cliente */

export type VistaObjetivo = Omit<Objetivo, 'dueno' | 'requestId' | 'v' | 'eventos'> & {
  terminal: boolean;
  eventos: EventoObjetivo[];
  decisionesPendientes: number;
};

/** Sin la huella del dueño ni el requestId. Los últimos 30 eventos (los demás, por `cambiosDesde`). */
export function vistaObjetivo(obj: Objetivo): VistaObjetivo {
  const { dueno: _d, requestId: _r, v: _v, eventos, ...resto } = obj;
  return { ...resto, terminal: esTerminalObjetivo(obj.estado), eventos: eventos.slice(-30), decisionesPendientes: obj.decisiones.filter((d) => !d.elegida).length };
}

export type CambiosObjetivo = {
  revision: number;
  desde: number;
  /** El cursor ya no alcanza (eventos recortados, o una revisión del futuro): toma `objetivo` entero. */
  resync: boolean;
  eventos: { revision: number; t: number; texto: string }[];
  /** Solo los campos que cambiaron después de `desde`, con su valor de ahora. */
  campos: Partial<Record<CampoVisible, unknown>>;
  objetivo?: VistaObjetivo;
};

/** «Qué cambió desde que te fuiste»: los hechos y los campos que cambiaron después de la revisión `desde`. */
export function cambiosDesde(obj: Objetivo, desde: number): CambiosObjetivo {
  const d = Math.max(0, Math.floor(Number(desde) || 0));
  if (d > obj.revision) return { revision: obj.revision, desde: d, resync: true, eventos: [], campos: {}, objetivo: vistaObjetivo(obj) };
  const primero = obj.eventos[0]?.revision ?? obj.revision + 1;
  if (d > 0 && d < primero - 1) return { revision: obj.revision, desde: d, resync: true, eventos: [], campos: {}, objetivo: vistaObjetivo(obj) };
  const nuevos = obj.eventos.filter((e) => e.revision > d);
  const vista = vistaObjetivo(obj) as unknown as Record<string, unknown>;
  const campos: Partial<Record<CampoVisible, unknown>> = {};
  for (const e of nuevos) for (const k of e.campos) if ((CAMPOS_VISIBLES as readonly string[]).includes(k)) campos[k as CampoVisible] = vista[k];
  return { revision: obj.revision, desde: d, resync: false, eventos: nuevos.map((e) => ({ revision: e.revision, t: e.t, texto: e.texto })), campos };
}
