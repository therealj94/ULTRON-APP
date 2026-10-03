/**
 * LA COMPUTADORA DE LOS AGENTES: el cliente del nodo de scripts/nodo-computadora.
 *
 * José (1-oct): «darle computadora a los agentes… como grokbot… ocupo esto funcione». Cada avatar puede
 * encargarle a su propia computadora en la nube (un escritorio Ubuntu con Firefox y LibreOffice) una
 * tarea de pantalla: buscar y comparar en páginas, llenar un formulario, leer algo que solo se ve
 * navegando. La maneja Holo-3.1-9B en la GPU propia (gratis) o Claude (de pago, si hay clave), según
 * Ajustes (`motorComputadora` del perfil).
 *
 * Una tarea tarda de uno a tres minutos (medido: 11 pasos, 80 s). El turno espera lo que puede
 * (`esperaMs`); si no alcanza, la tarea sigue y el resultado queda guardado para esa persona: se lo dice
 * en el turno siguiente (`avisosPendientes`) y la app lo puede mirar (`/api/computadora/...`).
 *
 * José (2-oct): «le pedí que abriera una página, la abrió y se quedó ahí». Desde entonces, en vivo y
 * hasta el final (el canal de acciones del teléfono, `alAvisarApp`):
 *  · al empezar, el teléfono abre solo la vista en vivo (`empieza`) y pone el tecleo bajito;
 *  · mientras trabaja (ya sin el turno esperando) se le cuentan los avances, uno cada 12 s como mucho
 *    (`paso`: «Ya entré a bch.hn.», «Estoy leyendo la página.»);
 *  · si la tarea no alcanzó (se acabaron los pasos o dice que quedó a medias) la MISIÓN sigue sola con
 *    otra tarea desde donde quedó la pantalla, hasta MAX_CONTINUACIONES (`sigue`); nunca si lo que la paró
 *    fue una clave, un pago o un captcha;
 *  · al terminar, el resultado va al teléfono YA (`termina` con el texto) y AURA lo dice sin esperar el
 *    turno siguiente; si no le llegó a ningún teléfono, queda para el turno siguiente como antes.
 *  · «Abre bch.hn» a secas se le pide al nodo como «…y dime qué hay en la página» (`prepararMision`).
 *
 * José (2-oct, tarde): «tiene que funcionar ya todo… copiemos cómo lo hacen Grok, el agente de ChatGPT».
 * Desde entonces cada encargo es una MISIÓN como la de un agente tipo Operator:
 *  · un PLAN corto (3-6 pasos) antes de empezar: lo escribe el cerebro en el pedido («… PLAN: a | b | c»,
 *    `separarPlan`) o, si no, se arma de la instrucción (`planDeMision`); la app lo muestra como lista que se
 *    va marcando (`estadoDelPlan`: hecho, actual, en espera, falló) con la captura en vivo arriba;
 *  · el tiempo transcurrido, Detener, Pausar/Seguir y Tomar el control/Devolver (si el nodo lo sabe:
 *    `capacidades` en /salud; el agente.py de antes no las tiene y la app solo ofrece Detener);
 *  · CONFIRMACIONES: antes de algo sensible (enviar, iniciar sesión, publicar, borrar) el nodo se queda
 *    quieto en `confirmar` con su `pregunta`; se le pregunta en la app (botones) y en voz (`confirmar`), y el
 *    «sí» de la conversación lo resuelve el servidor (`resolverPreguntaComputadora`). Pagar o comprar: nunca
 *    (el nodo no hace ese toque aunque el modelo lo pida);
 *  · el RESULTADO queda en una tarjeta (texto, datos, enlaces y la captura final: `FinalMision`) que se
 *    puede compartir, y el historial de sus misiones recientes (`historialDe`);
 *  · ROBUSTEZ: encargar se reintenta una vez si el nodo no contesta; si deja de contestar a media tarea se le
 *    dice («sigo intentando») y, si no vuelve, se cierra con un final honesto (nunca la vista colgada); si se
 *    pasa del tiempo se ofrece seguir (y el «sí» sigue la misión desde donde quedó).
 */
import { nivelDeCorreo } from './nivel';
import crypto from 'node:crypto';
import { clave } from '../lib/boveda';

export type MotorNodo = 'holo' | 'claude';
export type PasoTarea = { n: number; t: number; accion: string; args?: Record<string, unknown>; ms?: number; miniatura?: string | null };
/**
 * Los estados del nodo. `pausada`, `confirmar` (espera el sí de la persona) y `control` (la persona tiene el
 * escritorio) solo los da el agente.py nuevo: siguen vivos, pero quietos.
 */
export type EstadoTarea = 'en_cola' | 'trabajando' | 'pausada' | 'confirmar' | 'control' | 'hecha' | 'parada' | 'sin_pasos' | 'fallo';
export type Tarea = {
  id: string;
  motor: MotorNodo;
  instruccion: string;
  estado: EstadoTarea;
  pasos: PasoTarea[];
  respuesta: string | null;
  error: string | null;
  segundos: number;
  /** Lo que pregunta antes de algo sensible (solo en `confirmar`). */
  pregunta?: string | null;
};

const TERMINADA = new Set<EstadoTarea>(['hecha', 'parada', 'sin_pasos', 'fallo']);
/** Vivas pero quietas: no avanzan solas, no se narran y no cuentan para el tope de tiempo. */
const QUIETA = new Set<EstadoTarea>(['pausada', 'confirmar', 'control']);
/** Lo que el nodo sabe hacer además de encargar y parar (agente.py nuevo: /salud → capacidades). */
export type CapacidadNodo = 'pausar' | 'confirmar' | 'control';
/** Cada cuánto se pregunta por la tarea mientras se espera. */
const SONDEO_MS = 2000;
/** Tras esto, una tarea que nadie terminó de esperar se deja de seguir. */
const SEGUIR_MAX_MS = 15 * 60_000;

/** Quién es, sin decirle el correo al nodo: le basta para saber si cambió de dueño (y limpiar el escritorio). */
function huellaDe(quien: string): string {
  return crypto.createHash('sha256').update(`computadora|${quien}`).digest('hex').slice(0, 24);
}

function conf() {
  return { url: clave('computadora_url').replace(/\/+$/, ''), clave: clave('computadora_clave') };
}

export function computadoraConfigurada(): boolean {
  const c = conf();
  return !!c.url && !!c.clave;
}

/** Ajustes dice «gratis» o «pago»; el nodo habla de holo o claude. */
export function motorDelPerfil(motor: string | null | undefined, correo?: string): MotorNodo {
  if (motor !== 'pago') return 'holo';
  // El de pago (Claude) cuesta por tarea: es de la junta. A un miembro le corre el gratis aunque lo elija.
  return correo && nivelDeCorreo(correo) === 'miembro' ? 'holo' : 'claude';
}

/** Un error del nodo con su código HTTP (sin código: no contestó, la red o el tiempo). */
export class ErrorNodo extends Error {
  constructor(
    mensaje: string,
    readonly status?: number
  ) {
    super(mensaje);
  }
}

async function pedir(ruta: string, init: RequestInit & { ms?: number } = {}): Promise<any> {
  const c = conf();
  let r: Response;
  try {
    r = await fetch(`${c.url}${ruta}`, {
      ...init,
      headers: { authorization: `Bearer ${c.clave}`, 'content-type': 'application/json', ...(init.headers || {}) },
      signal: init.signal ?? AbortSignal.timeout(init.ms ?? 15_000),
    });
  } catch (e: any) {
    throw new ErrorNodo(String(e?.cause?.code || e?.message || e).slice(0, 200));
  }
  const texto = await r.text();
  let j: any = null;
  try {
    j = texto ? JSON.parse(texto) : null;
  } catch {
    j = null;
  }
  if (!r.ok) throw new ErrorNodo(String(j?.detail || j?.error || texto || `HTTP ${r.status}`).slice(0, 200), r.status);
  return j;
}

/** ¿Vale la pena intentarlo otra vez? Sin código (no contestó) o un 5xx; un 4xx es un no de verdad. */
const reintentable = (e: unknown) => !(e instanceof ErrorNodo) || !e.status || e.status >= 500;

let capsCache: { en: number; caps: CapacidadNodo[] } | null = null;
const CAPS_MS = 60_000;

function capsDe(j: any): CapacidadNodo[] {
  return Array.isArray(j?.capacidades) ? j.capacidades.filter((c: unknown): c is CapacidadNodo => c === 'pausar' || c === 'confirmar' || c === 'control') : [];
}

/** ¿Contesta el nodo? Qué motores ofrece, si está ocupado y qué sabe hacer. Para Ajustes y la salud del sistema. */
export async function estadoComputadora(): Promise<{ configurada: boolean; ok: boolean; motores: MotorNodo[]; ocupada: boolean; capacidades: CapacidadNodo[]; detalle?: string }> {
  if (!computadoraConfigurada()) return { configurada: false, ok: false, motores: [], ocupada: false, capacidades: [], detalle: 'Falta COMPUTADORA_URL o COMPUTADORA_CLAVE.' };
  try {
    const j = await pedir('/salud', { ms: 8000 });
    const capacidades = capsDe(j);
    capsCache = { en: Date.now(), caps: capacidades };
    return { configurada: true, ok: !!j?.ok, motores: Array.isArray(j?.motores) ? j.motores : [], ocupada: !!j?.ocupada, capacidades };
  } catch (e: any) {
    return { configurada: true, ok: false, motores: [], ocupada: false, capacidades: [], detalle: String(e?.message || e).slice(0, 160) };
  }
}

/** Lo que sabe el nodo (pausar, confirmar, control), guardado un minuto. Si no contesta: nada. */
export async function capacidadesNodo(): Promise<CapacidadNodo[]> {
  if (capsCache && Date.now() - capsCache.en < CAPS_MS) return capsCache.caps;
  return (await estadoComputadora()).capacidades;
}

export async function verTarea(id: string, miniaturas = false, ms = 10_000, senal?: AbortSignal): Promise<Tarea> {
  const tope = AbortSignal.timeout(Math.max(1, ms));
  return pedir(`/tareas/${encodeURIComponent(id)}${miniaturas ? '?miniaturas=1' : ''}`, { signal: senal ? AbortSignal.any([senal, tope]) : tope });
}

export async function pararTarea(id: string): Promise<void> {
  await pedir(`/tareas/${encodeURIComponent(id)}/parar`, { method: 'POST', ms: 8000 });
}

/* Lo del agente.py nuevo (capacidades): pausar, seguir, el sí, el control de la persona y la pantalla de ahora. */
export async function pausarTarea(id: string): Promise<void> {
  await pedir(`/tareas/${encodeURIComponent(id)}/pausar`, { method: 'POST', ms: 8000 });
}
export async function reanudarTarea(id: string): Promise<void> {
  await pedir(`/tareas/${encodeURIComponent(id)}/reanudar`, { method: 'POST', ms: 8000 });
}
export async function confirmarTarea(id: string, si: boolean): Promise<void> {
  await pedir(`/tareas/${encodeURIComponent(id)}/confirmar`, { method: 'POST', body: JSON.stringify({ si }), ms: 8000 });
}
export async function controlTarea(id: string, tomar: boolean): Promise<void> {
  await pedir(`/tareas/${encodeURIComponent(id)}/control`, { method: 'POST', body: JSON.stringify({ tomar }), ms: 8000 });
}
export type AccionPersona = { tipo: 'click'; x: number; y: number } | { tipo: 'escribir'; texto: string; enter?: boolean } | { tipo: 'tecla'; teclas: string } | { tipo: 'scroll'; direccion: 'up' | 'down' };
export async function accionPersona(id: string, a: AccionPersona): Promise<void> {
  await pedir(`/tareas/${encodeURIComponent(id)}/accion`, { method: 'POST', body: JSON.stringify(a), ms: 20_000 });
}
/** Lo que se ve ahora (JPEG), solo mientras esa tarea tiene el escritorio. */
export async function pantallaDeTarea(id: string): Promise<Buffer> {
  const c = conf();
  const r = await fetch(`${c.url}/tareas/${encodeURIComponent(id)}/pantalla`, { headers: { authorization: `Bearer ${c.clave}` }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new ErrorNodo(`HTTP ${r.status}`, r.status);
  return Buffer.from(await r.arrayBuffer());
}

/** Lo que la persona puede hacer con el control: validado antes de mandarlo al nodo. */
export function validarAccionPersona(b: any): AccionPersona | null {
  if (!b || typeof b !== 'object') return null;
  const en = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000;
  if (b.tipo === 'click' && en(b.x) && en(b.y)) return { tipo: 'click', x: Math.round(b.x), y: Math.round(b.y) };
  if (b.tipo === 'escribir' && typeof b.texto === 'string' && b.texto.length >= 1 && b.texto.length <= 500) return { tipo: 'escribir', texto: b.texto, enter: !!b.enter };
  if (b.tipo === 'tecla' && typeof b.teclas === 'string' && /^[a-z0-9+]{1,20}$/i.test(b.teclas)) return { tipo: 'tecla', teclas: b.teclas.toLowerCase() };
  if (b.tipo === 'scroll' && (b.direccion === 'up' || b.direccion === 'down')) return { tipo: 'scroll', direccion: b.direccion };
  return null;
}

export async function pantallaComputadora(): Promise<Buffer> {
  const c = conf();
  const r = await fetch(`${c.url}/pantalla`, { headers: { authorization: `Bearer ${c.clave}` }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/* ------------------------------------------------------------------ de quién es cada tarea */

/**
 * Un encargo: una tarea del nodo y de quién es. Una MISIÓN puede ser varias tareas seguidas (`vuelta`
 * 0, 1, 2…): si una no alcanzó, la siguiente sigue desde donde quedó la pantalla. `instruccion` es
 * siempre la misión tal como se pidió (lo que se le cuenta a la persona); al nodo le va `paraNodo`.
 */
type Encargo = {
  id: string;
  quien: string;
  instruccion: string;
  creada: number;
  terminada?: Tarea;
  avisada?: boolean;
  /** El teléfono del turno (x-aura-aparato): ahí se abre la vista en vivo. null: todos los de la cuenta. */
  aparato: string | null;
  idioma: 'es' | 'en';
  motor: MotorNodo;
  maxPasos: number;
  /** Cuántas tareas van en esta misión antes de esta (0: la primera). */
  vuelta: number;
  /** Cuándo el turno dejó de esperarla (desde ahí se narra y se avisa al terminar). */
  soltada?: number;
  /** Alguien ya decidió qué hacer con su final (el turno o el seguimiento): no se hace dos veces. */
  cerrada?: boolean;
  /** El último paso que se contó en voz, cuándo y cuántas frases van. */
  narrado: number;
  ultimaVoz: number;
  dichas: number;
  ultimaFrase?: string;
  /** Cuántas veces se contó cada acción (para variar la frase: «Estoy leyendo», «Sigo leyendo»…). */
  porAccion: Record<string, number>;
  /** La misión de la que es parte (su plan, su tiempo, su final). */
  mision: Mision;
  /** En qué paso del plan iba la misión cuando empezó esta tarea (el avance se cuenta desde ahí). */
  indiceAlEmpezar: number;
  /** Lo último que se vio de la tarea (para un final honesto si el nodo deja de contestar). */
  ultimaVista?: Tarea;
  /** El último estado visto: para avisar al teléfono cuando se pausa, espera un sí o sigue. */
  ultimoEstado?: EstadoTarea;
  /** Consultas seguidas sin respuesta del nodo, desde cuándo, y si ya se le dijo a la persona. */
  fallos: number;
  primerFallo: number;
  avisadoSinRespuesta?: boolean;
  /** La última pregunta que ya contestó (y cuándo): una consulta atrasada no la vuelve a preguntar. */
  contestada?: { texto: string; en: number };
  /** Hasta cuándo se la sigue (se alarga mientras está quieta: pausa, control o esperando su sí). */
  limite: number;
};

/** Cómo va cada paso del plan en la app. */
export type EstadoPlan = 'hecho' | 'actual' | 'espera' | 'pendiente' | 'fallo';
export type PasoPlan = { texto: string; estado: EstadoPlan };
/** La tarjeta del final: lo que se dice, lo que encontró, datos y enlaces sueltos, y la captura final. */
export type FinalMision = {
  estado: EstadoTarea;
  ok: boolean;
  texto: string;
  respuesta: string | null;
  error: string | null;
  enlaces: string[];
  datos: { clave: string; valor: string }[];
  captura: string | null;
  segundos: number;
  pasos: number;
};
/**
 * Una MISIÓN: lo que se pidió, su plan y su final, aunque la hagan varias tareas del nodo. Su id es el de su
 * primera tarea. Vive en memoria (el historial se pierde si el servidor se reinicia; el nodo olvida las
 * tareas tras una hora, la tarjeta del final no).
 */
type Mision = {
  id: string;
  quien: string;
  instruccion: string;
  plan: string[];
  /** El plan lo escribió el cerebro (si no, se armó de la instrucción). */
  planDelCerebro: boolean;
  inicio: number;
  tareas: string[];
  /** El paso del plan en que va (nunca retrocede). */
  indice: number;
  fin?: number;
  final?: FinalMision;
  /** Lo que su computadora le preguntó y todavía no contesta. */
  pregunta?: { tareaId: string; texto: string; desde: number } | null;
  /** Se quedó a medias y se le ofreció seguir: su «sí» la sigue (hasta aquí vale). */
  ofreceSeguir?: number;
  /** Cuántas veces la persona dijo «sigue» después de un final a medias. */
  rondas: number;
  /** Pasos útiles de las tareas anteriores de la misión. */
  pasosPrevios: number;
  idioma: 'es' | 'en';
  motor: MotorNodo;
  aparato: string | null;
  maxPasos: number;
};
const ENCARGOS = new Map<string, Encargo>();
const MISIONES = new Map<string, Mision>();
/** Las misiones de cada persona, la más nueva al final (HISTORIAL_MAX como mucho). */
const HISTORIAL = new Map<string, string[]>();
export const HISTORIAL_MAX = 10;
/** Cuánto vale una pregunta sin contestar, y la oferta de seguir, para el «sí» de la conversación. */
const PREGUNTA_VALE_MS = 15 * 60_000;
const SEGUIR_VALE_MS = 10 * 60_000;
/** Veces que la persona puede decir «sigue» a una misión que quedó a medias. */
export const MAX_RONDAS = 2;
/** La última tarea de cada persona (para la app). */
const ULTIMA = new Map<string, string>();
/**
 * Las tareas de cada persona que siguieron después de que su turno dejó de esperar y que todavía no se
 * le contaron. Todas: una segunda tarea no tapa a la primera.
 */
const PENDIENTES = new Map<string, Set<string>>();

/* ------------------------------------------------------------------ la app en vivo */

/**
 * Lo que su computadora le cuenta al teléfono (lib/acciones-app.ts, AccionComputadora): `empieza` abre
 * la vista en vivo, `paso` es una frase corta de avance, `sigue` otra tarea de la misma misión y
 * `termina` el final (con `texto`, el resultado para decirlo; sin él, ya lo dijo el turno).
 */
export type FaseAviso = 'empieza' | 'paso' | 'sigue' | 'confirmar' | 'pausa' | 'reanuda' | 'termina';
/**
 * `plan` va en `empieza` (la lista que la app marca); `pregunta` en `confirmar` (los botones Sí / No, aunque
 * la diga el turno); `estado` en `pausa` (pausada o control).
 */
export type AvisoApp = { tipo: 'computadora'; fase: FaseAviso; id: string; texto?: string; ok?: boolean; plan?: string[]; pregunta?: string; estado?: 'pausada' | 'control' };
/** Empuja el aviso al canal de acciones (server.ts: empujarAccion) y dice a cuántos teléfonos llegó. */
export type AvisadorApp = (quien: string, aviso: AvisoApp, aparato: string | null) => number;
let avisador: AvisadorApp | null = null;

/** server.ts conecta el canal de acciones del teléfono (las pruebas, un espía). null lo desconecta. */
export function alAvisarApp(f: AvisadorApp | null) {
  avisador = f;
}

/** Al aparato del turno; con `todos`, si ese no está escuchando, a cualquier teléfono de la cuenta. */
function avisarApp(e: Encargo, aviso: AvisoApp, todos = false): number {
  if (!avisador) return 0;
  try {
    let n = avisador(e.quien, aviso, e.aparato);
    if (!n && todos && e.aparato) n = avisador(e.quien, aviso, null);
    return n;
  } catch {
    return 0;
  }
}

/**
 * Los tiempos del seguimiento (las pruebas los acortan):
 *  · sondeoMs: cada cuánto se mira la tarea después de que el turno la soltó;
 *  · silencioTrasTurnoMs: tras soltarla, este rato callado (que se oiga lo que el turno contestó);
 *  · narrarCadaMs: entre una frase de avance y la siguiente, como mínimo (sin llenar la conversación);
 *  · trabajandoCadaMs: sin pasos nuevos en este rato, «sigo trabajando»;
 *  · fallosAntesDeAvisar: consultas seguidas sin respuesta del nodo antes de decir «no me contesta, sigo intentando»;
 *  · sinRespuestaMs: sin respuesta en este rato, se cierra con un final honesto (nunca la vista colgada);
 *  · reintentoMs: la espera antes del segundo intento de encargar.
 */
export const TIEMPOS_SEGUIR = { sondeoMs: 3000, silencioTrasTurnoMs: 8000, narrarCadaMs: 12_000, trabajandoCadaMs: 35_000, fallosAntesDeAvisar: 5, sinRespuestaMs: 120_000, reintentoMs: 1500 };
/** Frases de avance por tarea, como mucho. */
export const MAX_FRASES = 8;
/** Tareas de más que una misión puede encadenar cuando una no alcanzó. */
export const MAX_CONTINUACIONES = 3;

export function duenoDe(id: string): string | null {
  return ENCARGOS.get(id)?.quien ?? null;
}

/** La misión tal como se pidió (sin lo que se le agregó para el nodo). */
export function misionDe(id: string): string | null {
  return ENCARGOS.get(id)?.instruccion ?? null;
}

export function ultimaTareaDe(quien: string): string | null {
  return ULTIMA.get(quien) ?? null;
}

export function pendientesDe(quien: string): string[] {
  return [...(PENDIENTES.get(quien) ?? [])];
}

/**
 * Lo que terminó después de que el turno dejó de esperar y todavía no se le dijo: va como HECHO en el
 * turno siguiente de esa persona. Solo se mira: se da por dicho con `confirmarAvisos` cuando el modelo
 * de verdad contestó con esos hechos (un «hola» que contesta el banco o el modelo chico no los lleva).
 * Si el teléfono lo recibió al terminar (y AURA lo dijo), ya no está aquí.
 */
export function avisosPendientes(quien: string): { ids: string[]; hecho: string } | null {
  const listas = pendientesDe(quien)
    .map((id) => ENCARGOS.get(id))
    .filter((e): e is Encargo => !!e?.terminada && !e.avisada);
  if (!listas.length) return null;
  const partes = listas.map((e) => `«${e.instruccion.slice(0, 160)}»: ${resumenTarea(e.terminada!)}`);
  return {
    ids: listas.map((e) => e.id),
    hecho: `COMPUTADORA (terminó lo que te encargaron antes) ${partes.join(' · ')} Díselo al empezar, en una o dos frases.`,
  };
}

/** Ya se le dijo: no se vuelve a contar. */
export function confirmarAvisos(quien: string, ids: readonly string[]) {
  const set = PENDIENTES.get(quien);
  for (const id of ids) {
    const e = ENCARGOS.get(id);
    if (e) e.avisada = true;
    set?.delete(id);
  }
  if (set && !set.size) PENDIENTES.delete(quien);
}

function anotarPendiente(e: Encargo) {
  if (!PENDIENTES.has(e.quien)) PENDIENTES.set(e.quien, new Set());
  PENDIENTES.get(e.quien)!.add(e.id);
}

/* ------------------------------------------------------------------ el plan (como Operator: la lista que se va marcando) */

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const limpiarPaso = (s: string) =>
  s
    .replace(/^\s*(?:\d+\s*[.)-]|[-*•·])\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/, '')
    .trim()
    .slice(0, 80);

/**
 * El cerebro escribe el plan al final del pedido: «Entra a bch.hn y dime el dólar PLAN: Entrar a bch.hn |
 * Buscar el tipo de cambio | Darte compra y venta». Devuelve la misión sin el plan, y el plan (2 a 6 pasos) o null.
 */
export function separarPlan(texto: string): { mision: string; plan: string[] | null } {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  const m = /^(.*?)[\s.·,;-]*\bPLAN\s*:\s*(.+)$/.exec(t);
  if (!m || m[1].trim().length < 4) return { mision: t, plan: null };
  let partes = m[2].split('|');
  if (partes.length < 2) partes = m[2].split(';');
  if (partes.length < 2) partes = m[2].split(/\s(?=\d+[.)]\s)/);
  const plan = partes.map(limpiarPaso).filter((p) => p.length >= 3).slice(0, 6);
  return { mision: m[1].trim(), plan: plan.length >= 2 ? plan : null };
}

/** Sin plan del cerebro (o encargada desde la app): uno corto armado de la instrucción, de 3 a 6 pasos. */
export function planDeMision(instruccion: string, idioma: 'es' | 'en' = 'es'): string[] {
  const t = String(instruccion || '').replace(/\s+/g, ' ').trim();
  const b = sinAcentos(t);
  const en = idioma === 'en';
  const plan: string[] = [];
  const sitio = /\b((?:[a-z0-9-]+\.)+(?:com|org|net|hn|gob|edu|io|gov|info|es|mx|co|us|uk|app|dev)(?:\.[a-z]{2})?)\b/i.exec(t)?.[1];
  if (sitio) plan.push(en ? `Open ${sitio}` : `Entrar a ${sitio}`);
  else if (/google/.test(b)) plan.push(en ? 'Open Google' : 'Abrir Google');
  else plan.push(en ? 'Open the browser' : 'Abrir el navegador');
  if (/\b(busca|buscar|buscame|encuentra|search|find|look up)\b/.test(b)) plan.push(en ? 'Search for what you asked' : 'Buscar lo que pediste');
  if (/\b(compara|comparar|compare)\b/.test(b)) plan.push(en ? 'Compare the options' : 'Comparar las opciones');
  if (/\b(llena|llenar|completa|completar|formulario|fill|form)\b/.test(b)) plan.push(en ? 'Fill in the form' : 'Llenar el formulario');
  if (/\b(envia|enviar|envialo|manda|mandar|mandalo|publica|publicar|publicalo|borra|borrar|borralo|elimina|eliminar|inicia sesion|iniciar sesion|submit|send|post|delete|log ?in|sign ?in)\b/.test(b))
    plan.push(en ? 'Ask for your OK before anything sensitive' : 'Pedirte el sí antes de lo delicado');
  if (plan.length < 3 || /\b(lee|leer|revisa|dime|cuenta|saca|extrae|que hay|read|check|tell|what)\b/.test(b)) plan.push(en ? 'Read what the page shows' : 'Leer lo que muestra la página');
  plan.push(en ? 'Give you the result' : 'Darte el resultado');
  return [...new Set(plan)].slice(0, 6);
}

type TipoPlan = 'abrir' | 'buscar' | 'leer' | 'llenar' | 'confirmar' | 'resultado' | 'otro';
type TipoPaso = 'abrir' | 'escribir' | 'navegar' | 'leer' | 'confirmar' | 'resultado';

export function tipoDePlan(texto: string): TipoPlan {
  const t = sinAcentos(String(texto || ''));
  if (/\b(resultado|result|darte|decirte|contarte|dime|tell|report|resum|respuesta|answer)/.test(t)) return 'resultado';
  if (/\b(el si|tu si|permiso|confirm|aprob|your ok|ok before)/.test(t)) return 'confirmar';
  if (/\b(abr|entr|ir a|ve a|visit|open|go to|naveg)/.test(t)) return 'abrir';
  if (/\b(busc|escrib|search|type|find|look)/.test(t)) return 'buscar';
  if (/\b(llen|complet|formul|fill|form|envi|submit|publi|post|mand)/.test(t)) return 'llenar';
  if (/\b(le[eo]|revis|mir|compar|sac|extra|anot|read|check|review|analiz|copi)/.test(t)) return 'leer';
  return 'otro';
}

function tipoDePaso(accion: string): TipoPaso | null {
  switch (accion) {
    case 'open_url':
      return 'abrir';
    case 'type':
      return 'escribir';
    case 'click':
    case 'left_click':
    case 'double_click':
    case 'triple_click':
    case 'right_click':
    case 'key':
    case 'drag':
    case 'left_click_drag':
      return 'navegar';
    case 'scroll':
    case 'wait':
    case 'nada':
    case 'zoom':
    case 'screenshot':
    case 'mouse_move':
      return 'leer';
    case 'pedir_confirmacion':
    case 'confirmacion':
      return 'confirmar';
    case 'answer':
      return 'resultado';
    default:
      return null; // escritorio_limpio, lo que hizo la persona: no mueven el plan
  }
}

const COMPATIBLE: Record<TipoPaso, TipoPlan[]> = {
  abrir: ['abrir'],
  escribir: ['buscar', 'llenar'],
  navegar: ['buscar', 'llenar', 'leer', 'otro'],
  leer: ['leer', 'otro'],
  confirmar: ['confirmar', 'llenar'],
  resultado: ['resultado'],
};

/**
 * En qué paso del plan va, desde `desde`, según lo que hizo el nodo: cada acción mueve el plan al paso
 * más cercano que le corresponde (mirando hasta dos adelante); el último («darte el resultado») solo con
 * la respuesta. Nunca retrocede.
 */
export function avanzarPlan(plan: readonly string[], pasos: readonly Pick<PasoTarea, 'accion'>[], desde = 0): number {
  const ultimo = plan.length - 1;
  if (ultimo < 0) return 0;
  const tipos = plan.map(tipoDePlan);
  const tope = tipos[ultimo] === 'resultado' ? ultimo - 1 : ultimo;
  let i = Math.max(0, Math.min(desde, ultimo));
  for (const p of pasos) {
    const tp = tipoDePaso(p.accion);
    if (!tp) continue;
    if (tp === 'resultado') {
      i = ultimo;
      continue;
    }
    for (let j = i; j <= Math.min(i + 2, tope); j++) {
      if (COMPATIBLE[tp].includes(tipos[j])) {
        i = j;
        break;
      }
    }
  }
  return i;
}

/** El plan para la app: cada paso hecho, el actual (o en espera si está quieta), pendiente o el que falló. */
export function estadoDelPlan(m: Pick<Mision, 'plan' | 'indice' | 'final'>, estado?: EstadoTarea | null): PasoPlan[] {
  return m.plan.map((texto, j) => {
    let e: EstadoPlan;
    if (m.final) e = m.final.ok ? 'hecho' : j < m.indice ? 'hecho' : j === m.indice ? 'fallo' : 'pendiente';
    else e = j < m.indice ? 'hecho' : j === m.indice ? (estado && QUIETA.has(estado) ? 'espera' : 'actual') : 'pendiente';
    return { texto, estado: e };
  });
}

function moverPlan(e: Encargo, t: Pick<Tarea, 'pasos'>) {
  e.mision.indice = Math.max(e.mision.indice, avanzarPlan(e.mision.plan, t.pasos, e.indiceAlEmpezar));
}

/* ------------------------------------------------------------------ el final: la tarjeta que se comparte */

const pasosUtiles = (t: Pick<Tarea, 'pasos'>) => t.pasos.filter((p) => !['answer', 'escritorio_limpio', 'pedir_confirmacion', 'confirmacion', 'persona'].includes(p.accion)).length;

/** Las direcciones del resultado y las páginas que abrió (sin repetir, hasta 5). */
export function enlacesDe(t: Pick<Tarea, 'respuesta' | 'pasos'>): string[] {
  const urls: string[] = [];
  for (const m of String(t.respuesta || '').matchAll(/https?:\/\/[^\s)»"'<>\]]+/g)) urls.push(m[0].replace(/[.,;:!?]+$/, ''));
  for (const p of t.pasos) {
    const u = p.accion === 'open_url' ? String((p.args as any)?.url || '').trim() : '';
    if (u) urls.push(/^https?:\/\//i.test(u) ? u : `https://${u}`);
  }
  const vistos = new Set<string>();
  return urls.filter((u) => u.length <= 300 && !vistos.has(u.replace(/\/+$/, '')) && vistos.add(u.replace(/\/+$/, ''))).slice(0, 5);
}

/** «Compra: 24.70», «Venta: 24.95»: los datos sueltos de la respuesta, para la tabla de la tarjeta. */
export function datosDe(respuesta: string | null | undefined): { clave: string; valor: string }[] {
  const out: { clave: string; valor: string }[] = [];
  for (const linea of String(respuesta || '').split(/\n|;|•|\s·\s|(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/)) {
    const m = /^\s*(?:[-*]|\d+[.)])?\s*([^:]{2,40}?)\s*:\s*(.{1,140}?)[.\s]*$/.exec(linea);
    // Una dirección sola no es un dato: va en los enlaces.
    if (!m || /https?$/i.test(m[1]) || /^\/\//.test(m[2]) || /^https?:\/\/\S+$/.test(m[2])) continue;
    out.push({ clave: m[1].trim(), valor: m[2].trim() });
  }
  return out.slice(0, 8);
}

function ultimaMiniatura(t: Pick<Tarea, 'pasos'>): string | null {
  return [...t.pasos].reverse().find((p) => p.miniatura)?.miniatura || null;
}

/** La misión terminó: se guarda su tarjeta (y, sin esperar, la captura final del nodo). */
function cerrarMision(e: Encargo, t: Tarea) {
  const m = e.mision;
  m.fin = Date.now();
  m.pregunta = null;
  moverPlan(e, t);
  const ok = t.estado === 'hecha' && !misionIncompleta(t);
  m.final = {
    estado: t.estado,
    ok,
    texto: fraseDeFinal(m.instruccion, t, m.idioma),
    respuesta: t.respuesta ?? null,
    error: t.error ?? null,
    enlaces: enlacesDe(t),
    datos: datosDe(t.respuesta),
    captura: ultimaMiniatura(t),
    segundos: Math.round((m.fin - m.inicio) / 1000),
    pasos: m.pasosPrevios + pasosUtiles(t),
  };
  // A medias (sin pasos o perdió el contacto) y no la paró la persona: su «sí» la sigue.
  m.ofreceSeguir = !ok && (t.estado === 'sin_pasos' || t.estado === 'fallo') && m.rondas < MAX_RONDAS ? Date.now() : undefined;
  const final = m.final;
  if (!final.captura && ENCARGOS.has(t.id) && t.pasos.length)
    void verTarea(t.id, true, 10_000)
      .then((x) => {
        final.captura = ultimaMiniatura(x);
      })
      .catch(() => undefined);
}

/** Lo que la app muestra de una misión: el plan marcado, el tiempo, la pregunta pendiente y el final. */
export function vistaMision(m: Mision, estado?: EstadoTarea | null, pregunta?: string | null) {
  return {
    id: m.id,
    instruccion: m.instruccion,
    plan: estadoDelPlan(m, estado),
    planDelCerebro: m.planDelCerebro,
    inicio: m.inicio,
    transcurrido: Math.round(((m.fin ?? Date.now()) - m.inicio) / 1000),
    vuelta: Math.max(0, m.tareas.length - 1),
    tareaId: m.tareas[m.tareas.length - 1] ?? m.id,
    pregunta: m.pregunta?.texto ?? (estado === 'confirmar' ? pregunta || null : null),
    final: m.final ?? null,
    // El botón «Seguir»: quedó a medias (no la paró la persona) y quedan rondas.
    puedeSeguir: !!m.final && !m.final.ok && m.final.estado !== 'parada' && m.rondas < MAX_RONDAS,
  };
}
export type VistaMision = ReturnType<typeof vistaMision>;

/** Sus misiones recientes, la más nueva primero: para el historial de la pantalla de su computadora. */
export function historialDe(quien: string) {
  return [...(HISTORIAL.get(quien) ?? [])]
    .reverse()
    .map((id) => MISIONES.get(id))
    .filter((m): m is Mision => !!m)
    .map((m) => ({
      id: m.id,
      tareaId: m.tareas[m.tareas.length - 1] ?? m.id,
      instruccion: m.instruccion.slice(0, 200),
      estado: m.final?.estado ?? ('trabajando' as EstadoTarea),
      ok: m.final?.ok ?? null,
      inicio: m.inicio,
      segundos: Math.round(((m.fin ?? Date.now()) - m.inicio) / 1000),
      resultado: (m.final?.respuesta || m.final?.error || '').slice(0, 160) || null,
    }));
}

export function misionDeTarea(id: string): Mision | null {
  return ENCARGOS.get(id)?.mision ?? null;
}

function anotarMision(m: Mision) {
  MISIONES.set(m.id, m);
  const lista = [...(HISTORIAL.get(m.quien) ?? []).filter((x) => x !== m.id), m.id];
  while (lista.length > HISTORIAL_MAX) MISIONES.delete(lista.shift()!);
  HISTORIAL.set(m.quien, lista);
}

/* ------------------------------------------------------------------ la misión: completa y hasta el final */

const RE_SOLO_ABRIR = /^(?:abre|abrir|abreme|ábreme|entrar? (?:a|en)|ve a|ir a|visita|open|go to|visit)\s+(.+)$/i;
/** Lo que dice que hay algo más que hacer después de abrir: entonces la misión ya está completa. */
const RE_HAY_MAS = /\b(y|e|and|para|dime|busca|buscar|compara|saca|llena|lee|revisa|cuenta|tell|find|search|compare|read|check|luego|despu[eé]s|then)\b|[,;:]/i;

/**
 * Lo que va al nodo. «Abre bch.hn» y nada más dejaba la página abierta y la tarea «hecha» en dos pasos
 * (José, 2-oct: «abrió la página y se quedó ahí»): se le pide además contar qué hay en ella.
 */
export function prepararMision(instruccion: string, idioma: 'es' | 'en' = 'es'): string {
  const t = String(instruccion || '').replace(/\s+/g, ' ').trim();
  const m = RE_SOLO_ABRIR.exec(t);
  // Solo «abre <sitio>» (unas pocas palabras, sin «y dime…»): lo demás ya dice qué traer.
  if (!m || RE_HAY_MAS.test(m[1]) || m[1].split(' ').length > 6) return t;
  const sin = t.replace(/[.\s]+$/, '');
  return idioma === 'en'
    ? `${sin}, and once it loads, tell me in two or three sentences what the page shows (the main things on it).`
    : `${sin}, y cuando cargue dime en dos o tres frases qué hay en la página (lo principal que se ve).`;
}

/** «No terminé», «me faltó», «couldn't finish»: la respuesta dice que quedó a medias. */
const RE_INCOMPLETA =
  /\b(no (pude|logr[eé]|alcanc[eé]) (a )?(terminar|completar|acabar)|no (termin[eé]|complet[eé]|acab[eé])|qued[oó] (a medias|incomplet[ao])|incomplet[ao]|me falt[oó]|faltan? (pasos|por hacer)|todav[ií]a no (termin|acab)|ran out of steps|(could ?not|couldn'?t|was(n'?t| not) able to) (finish|complete)|did(n'?t| not) (finish|complete)|not (yet )?(finished|completed?)|incomplete|only partially)\b/i;
/** Lo que la detuvo a propósito (una clave, un pago, un captcha): eso no se insiste, se le dice. */
const RE_BLOQUEO =
  /contrase|password|clave de acceso|iniciar? sesi|inicio de sesi|log ?in\b|sign ?in|captcha|no soy un robot|robot|pag(o|ar)\b|tarjeta|comprar?\b|compra\b|payment|\bpay\b|credit card|checkout|verificaci[oó]n en dos|two.factor|2fa|permiso|permission/i;

/**
 * ¿La misión tiene que seguir con otra tarea? Solo si se acabaron los pasos o la respuesta dice que
 * quedó a medias, y nunca si lo que la paró fue una clave, un pago o un captcha (eso no lo hace).
 * Parada (la persona la paró) o falla del nodo: no se insiste.
 */
export function misionIncompleta(t: Pick<Tarea, 'estado' | 'respuesta' | 'error'>): boolean {
  const texto = `${t.respuesta || ''} ${t.error || ''}`;
  if (RE_BLOQUEO.test(texto)) return false;
  if (t.estado === 'sin_pasos') return true;
  if (t.estado !== 'hecha') return false;
  return !String(t.respuesta || '').trim() || RE_INCOMPLETA.test(String(t.respuesta || ''));
}

/** La tarea que sigue la misión: desde donde quedó la pantalla (el escritorio es el mismo), sin empezar de cero. */
export function instruccionContinuar(mision: string, t: Pick<Tarea, 'pasos'>, idioma: 'es' | 'en' = 'es'): string {
  const hechos = t.pasos
    .filter((p) => p.accion !== 'escritorio_limpio' && p.accion !== 'answer')
    .slice(-4)
    .map((p) => pasoEnPalabras(p, idioma));
  const m = mision.slice(0, 900);
  if (idioma === 'en') {
    return `Continue this mission from where the screen is now, without starting over: «${m}».${hechos.length ? ` The last things you did: ${hechos.join('; ')}.` : ''} Finish the whole mission and answer with the concrete result that was asked for.`;
  }
  return `Sigue con esta misión desde donde está la pantalla ahora, sin empezar de cero: «${m}».${hechos.length ? ` Lo último que hiciste: ${hechos.join('; ')}.` : ''} Termina la misión completa y responde con el resultado concreto que se pidió.`;
}

/* ------------------------------------------------------------------ lo que se dice mientras trabaja */

function dominio(url: unknown): string {
  const t = String(url ?? '').trim().replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '');
  return t.split(/[/?#]/)[0].slice(0, 40) || t.slice(0, 40);
}

/**
 * La frase corta de un avance, para decirla en voz («Ya entré a bch.hn.», «Estoy leyendo la página.»).
 * `i` cambia la frase entre las que dicen lo mismo (no repetir «sigo leyendo» tres veces).
 */
export function fraseDePaso(p: Pick<PasoTarea, 'accion' | 'args'>, idioma: 'es' | 'en' = 'es', i = 0): string {
  const a = (p.args || {}) as Record<string, any>;
  const en = idioma === 'en';
  const una = (xs: string[]) => xs[Math.abs(i) % xs.length];
  const corto = (x: unknown, n = 40) => {
    const t = String(x ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  switch (p.accion) {
    case 'open_url':
      return en ? `I'm on ${dominio(a.url)} now.` : `Ya entré a ${dominio(a.url)}.`;
    case 'type':
      return a.text ? (en ? `I'm typing «${corto(a.text)}».` : `Estoy escribiendo «${corto(a.text)}».`) : en ? "I'm typing." : 'Estoy escribiendo.';
    case 'click':
    case 'left_click':
    case 'double_click':
      return a.element
        ? en ? `I clicked «${corto(a.element, 30)}».` : `Toqué «${corto(a.element, 30)}».`
        : una(en ? ["I'm opening what I found.", "I'm moving through the page."] : ['Estoy abriendo lo que encontré.', 'Sigo navegando en la página.']);
    case 'scroll':
      return una(en ? ["I'm reading the page.", "I'm still reading…", "I'm going through the results…"] : ['Estoy leyendo la página.', 'Sigo leyendo…', 'Analizando los resultados…']);
    case 'wait':
      return en ? 'Waiting for the page to load.' : 'Esperando a que cargue la página.';
    case 'nada':
    case 'screenshot':
    case 'zoom':
      return en ? "I'm looking at what's on the screen." : 'Estoy analizando lo que veo.';
    case 'key':
      return una(en ? ["I'm moving through the page.", 'Still working on it.'] : ['Sigo navegando.', 'Sigo en eso.']);
    default:
      return en ? "I'm still working on it." : 'Sigo trabajando en eso.';
  }
}

/** El final, para decirlo en voz sin pasar por el cerebro (el teléfono lo dice tal cual). */
export function fraseDeFinal(mision: string, t: Tarea, idioma: 'es' | 'en' = 'es'): string {
  const en = idioma === 'en';
  const corto = (x: unknown, n: number) => {
    const s = String(x ?? '').replace(/\s+/g, ' ').trim();
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
  };
  if (t.estado === 'hecha') {
    const r = corto(t.respuesta, 650);
    return r ? (en ? `Done, I finished on my computer. ${r}` : `Listo, ya terminé en mi computadora. ${r}`) : en ? 'Done, I finished on my computer.' : 'Listo, ya terminé en mi computadora.';
  }
  if (t.estado === 'sin_pasos') {
    const u = [...t.pasos].reverse().find((p) => p.accion !== 'answer' && p.accion !== 'escritorio_limpio');
    const donde = u ? ` ${en ? 'I stopped at' : 'Me quedé en'}: ${pasoEnPalabras(u, idioma).toLowerCase()}.` : '';
    return en ? `I couldn't finish «${corto(mision, 80)}» on my computer.${donde} Want me to keep going?` : `No alcancé a terminar «${corto(mision, 80)}» en mi computadora.${donde} ¿Sigo?`;
  }
  if (t.estado === 'fallo') return en ? `My computer failed: ${corto(t.error || 'no details', 120)}.` : `Mi computadora falló: ${corto(t.error || 'sin detalle', 120)}.`;
  if (t.error) return en ? `I stopped the computer task: ${corto(t.error, 120)}.` : `Paré lo de mi computadora: ${corto(t.error, 120)}.`;
  return en ? 'I stopped the computer task.' : 'Paré lo de mi computadora.';
}

/** La pregunta antes de algo sensible, para decirla en voz. */
export function fraseDePregunta(pregunta: string, idioma: 'es' | 'en' = 'es'): string {
  const p = String(pregunta || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return idioma === 'en' ? `Before I go on I need your OK. ${p} Say yes or no.` : `Antes de seguir necesito tu sí. ${p} Dime sí o no.`;
}

/** «sí» / «no» a lo que su computadora preguntó (o a «¿sigo?»). Corto y sin «pero…»; si no, null. */
export function respuestaSiNo(mensaje: string): 'si' | 'no' | null {
  const t = sinAcentos(String(mensaje || ''))
    .replace(/[¡!¿?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.split(' ').length > 6) return null;
  if (/(^|\s)(pero|cambia|cambiale|corrige|en vez|instead|but)(\s|$)/.test(t)) return null;
  const resto = t.replace(/^\S+\s?/, '');
  if (/^(no|nop|nel|nunca|mejor no|negativo|cancela|cancelalo|detente|para|paralo|no lo hagas|nope|dont|don t|stop|cancel)(\s|$)/.test(t)) {
    // «no, sí mándalo»: se contradice; se vuelve a preguntar en lugar de adivinar.
    return AFIRMA.test(resto) ? null : 'no';
  }
  if (/^(si|sip|claro|dale|va pues|ok|okay|okey|hazlo|adelante|de acuerdo|esta bien|correcto|confirmo|sigue|siguele|continua|yes|yeah|yep|sure|go ahead|do it|continue|keep going)(\s|$)/.test(t) || t === 'va') {
    // «claro que no», «sí, no lo hagas»: una negación en cualquier parte NO es un sí (auditoría, 3-oct:
    // solo se miraba la primera palabra). Ante la duda, se pregunta otra vez.
    return NEGACION.test(t) ? null : 'si';
  }
  return null;
}
const NEGACION = /(^|\s)(no|nunca|jamas|tampoco|ni|nada|dont|don t|not|never)(\s|$)/;
const AFIRMA = /(^|\s)(si|sip|claro|dale|ok|okay|okey|hazlo|adelante|confirmo|mandalo|envialo|sigue|yes|sure)(\s|$)/;

/* ------------------------------------------------------------------ seguir la tarea hasta el final */

/**
 * El seguimiento de cada tarea, desde que se encarga: mientras el turno la espera no hace nada (el turno
 * ya la mira); en cuanto la suelta, la mira cada TIEMPOS_SEGUIR.sondeoMs, le cuenta los avances al teléfono y, al
 * terminar, decide: seguir la misión con otra tarea o avisar el final YA (no en el turno siguiente).
 */
function seguir(e: Encargo) {
  const vuelta = async () => {
    // Terminó o se olvidó (las pruebas): ya no se sigue.
    if (e.cerrada || ENCARGOS.get(e.id) !== e) return;
    // Se pasó del tope trabajando (lo quieto no cuenta): se para y se le dice dónde quedó, con «¿sigo?».
    if (Date.now() > e.limite) {
      void pararTarea(e.id).catch(() => undefined);
      const u = e.ultimaVista;
      await alTerminar(e, { id: e.id, motor: e.motor, instruccion: e.instruccion, pasos: u?.pasos ?? [], respuesta: null, segundos: u?.segundos ?? 0, estado: 'sin_pasos', error: 'Llevaba demasiado tiempo.' }, false, true);
      return;
    }
    if (e.soltada) {
      try {
        const t = await verTarea(e.id);
        alContestar(e);
        e.ultimaVista = t;
        if (TERMINADA.has(t.estado)) {
          if (!e.cerrada) await alTerminar(e, t, false);
          return;
        }
        moverPlan(e, t);
        alCambiarEstado(e, t, false);
        if (QUIETA.has(t.estado)) e.limite = Math.max(e.limite, Date.now() + SEGUIR_MAX_MS);
        else narrar(e, t);
      } catch (err) {
        if (await sinRespuesta(e, err)) return;
      }
    }
    setTimeout(vuelta, TIEMPOS_SEGUIR.sondeoMs).unref?.();
  };
  setTimeout(vuelta, TIEMPOS_SEGUIR.sondeoMs).unref?.();
}

/** El nodo volvió a contestar: si se le había dicho que no contestaba, que sepa que sigue. */
function alContestar(e: Encargo) {
  if (e.avisadoSinRespuesta) avisarApp(e, { tipo: 'computadora', fase: 'paso', id: e.id, texto: e.idioma === 'en' ? 'My computer is answering again; I keep going.' : 'Mi computadora ya me contesta; sigo.' });
  e.fallos = 0;
  e.primerFallo = 0;
  e.avisadoSinRespuesta = false;
}

/**
 * El nodo no contestó. Unas cuantas veces seguidas: se le dice («sigo intentando»). Si no vuelve en
 * TIEMPOS_SEGUIR.sinRespuestaMs, o dice que esa tarea ya no existe (se reinició), se cierra con un final
 * honesto: la vista nunca se queda colgada. true: ya se cerró.
 */
async function sinRespuesta(e: Encargo, err: unknown): Promise<boolean> {
  const ahora = Date.now();
  e.fallos++;
  if (!e.primerFallo) e.primerFallo = ahora;
  const perdida = err instanceof ErrorNodo && err.status === 404;
  if (perdida || ahora - e.primerFallo >= TIEMPOS_SEGUIR.sinRespuestaMs) {
    const u = e.ultimaVista;
    const error = perdida
      ? e.idioma === 'en'
        ? 'it restarted and lost the task; I don’t know if it finished'
        : 'se reinició y perdió la tarea; no sé si alcanzó a terminar'
      : e.idioma === 'en'
        ? 'it stopped answering halfway; I don’t know if it finished'
        : 'dejó de contestarme a mitad de la tarea; no sé si alcanzó a terminar';
    await alTerminar(e, { id: e.id, motor: e.motor, instruccion: e.instruccion, pasos: u?.pasos ?? [], respuesta: null, segundos: u?.segundos ?? 0, estado: 'fallo', error }, false, true);
    return true;
  }
  if (e.fallos >= TIEMPOS_SEGUIR.fallosAntesDeAvisar && !e.avisadoSinRespuesta && e.soltada) {
    e.avisadoSinRespuesta = true;
    avisarApp(e, { tipo: 'computadora', fase: 'paso', id: e.id, texto: e.idioma === 'en' ? "My computer isn't answering; I keep trying." : 'Mi computadora no me contesta; sigo intentando.' }, true);
  }
  return false;
}

/**
 * Se pausó, espera su sí, la tomó la persona o siguió: se le avisa al teléfono una vez por cambio. En el
 * turno (`enTurno`) la pregunta la dice el cerebro: el teléfono solo recibe los botones.
 */
function alCambiarEstado(e: Encargo, t: Tarea, enTurno: boolean) {
  const antes = e.ultimoEstado;
  e.ultimoEstado = t.estado;
  const m = e.mision;
  const en = e.idioma === 'en';
  if (t.estado === 'confirmar' && t.pregunta) {
    if (m.pregunta?.tareaId === e.id && m.pregunta.texto === t.pregunta) return;
    // Una consulta que salió antes de que llegara su respuesta: esa pregunta ya está contestada.
    if (e.contestada?.texto === t.pregunta && Date.now() - e.contestada.en < 10_000) return;
    m.pregunta = { tareaId: e.id, texto: t.pregunta, desde: Date.now() };
    avisarApp(e, { tipo: 'computadora', fase: 'confirmar', id: e.id, pregunta: t.pregunta, ...(enTurno ? {} : { texto: fraseDePregunta(t.pregunta, e.idioma) }) }, true);
    return;
  }
  if (antes === t.estado) return;
  if (antes === 'confirmar') m.pregunta = null;
  if (t.estado === 'pausada' || t.estado === 'control') {
    const texto =
      t.estado === 'pausada'
        ? en
          ? 'Okay, I paused my computer. Tell me when to go on.'
          : 'Listo, pausé mi computadora. Me dices cuándo sigo.'
        : en
          ? 'Okay, the computer is yours. When you are done, tap «Give back» and I go on from there.'
          : 'Listo, la computadora es tuya. Cuando termines, toca «Devolver» y sigo desde ahí.';
    avisarApp(e, { tipo: 'computadora', fase: 'pausa', id: e.id, estado: t.estado, texto });
    return;
  }
  if (t.estado === 'trabajando' && antes && QUIETA.has(antes)) {
    const texto = antes === 'control' ? (en ? 'Thanks, I go on from where you left it.' : 'Gracias, sigo desde donde la dejaste.') : antes === 'pausada' ? (en ? 'Going on.' : 'Sigo.') : undefined;
    avisarApp(e, { tipo: 'computadora', fase: 'reanuda', id: e.id, ...(texto ? { texto } : {}) });
  }
}

/** Un avance nuevo (o «sigo trabajando» si tarda), como mucho cada TIEMPOS_SEGUIR.narrarCadaMs y sin repetir. */
function narrar(e: Encargo, t: Tarea, ahora = Date.now()) {
  if (!e.soltada || ahora - e.soltada < TIEMPOS_SEGUIR.silencioTrasTurnoMs) return;
  if (ahora - e.ultimaVoz < TIEMPOS_SEGUIR.narrarCadaMs || e.dichas >= MAX_FRASES) return;
  const utiles = t.pasos.filter((p) => !['escritorio_limpio', 'answer', 'pedir_confirmacion', 'confirmacion', 'persona'].includes(p.accion));
  const nuevo = utiles.length ? utiles[utiles.length - 1] : null;
  let texto = '';
  if (nuevo && nuevo.n > e.narrado) {
    e.narrado = nuevo.n;
    const vez = e.porAccion[nuevo.accion] ?? 0;
    e.porAccion[nuevo.accion] = vez + 1;
    texto = fraseDePaso(nuevo, e.idioma, vez);
  } else if (ahora - Math.max(e.ultimaVoz, e.soltada) >= TIEMPOS_SEGUIR.trabajandoCadaMs) {
    texto = e.idioma === 'en' ? "I'm still working on my computer." : 'Sigo trabajando en mi computadora.';
  }
  if (!texto || texto === e.ultimaFrase) return;
  e.ultimaFrase = texto;
  e.ultimaVoz = ahora;
  e.dichas++;
  avisarApp(e, { tipo: 'computadora', fase: 'paso', id: e.id, texto });
}

/**
 * La tarea terminó. Si la misión quedó a medias (y no fue por una clave, un pago o un captcha), sigue con
 * otra tarea desde donde quedó, hasta MAX_CONTINUACIONES. Si no, el final: con `enTurno` lo dice el turno
 * (el teléfono solo se entera); si no, se le empuja al teléfono para que AURA lo diga ya, y si le llegó,
 * ya no queda para el turno siguiente.
 */
async function alTerminar(e: Encargo, t: Tarea, enTurno: boolean, sinSeguir = false): Promise<{ sigue: Encargo | null }> {
  e.cerrada = true;
  e.terminada = t;
  if (!sinSeguir && misionIncompleta(t) && e.vuelta < MAX_CONTINUACIONES) {
    const e2 = await crearEncargo({
      instruccion: e.instruccion,
      paraNodo: instruccionContinuar(e.instruccion, t, e.idioma),
      quien: e.quien,
      motor: e.motor,
      aparato: e.aparato,
      idioma: e.idioma,
      maxPasos: e.maxPasos,
      vuelta: e.vuelta + 1,
      mision: e.mision,
    }).catch(() => null);
    if (e2) {
      e.mision.pasosPrevios += pasosUtiles(t);
      moverPlan(e, t);
      e2.indiceAlEmpezar = e.mision.indice;
      // Esta ya no se cuenta sola: el final de la misión es el de la que sigue.
      e.avisada = true;
      confirmarAvisos(e.quien, [e.id]);
      e2.soltada = Date.now();
      e2.ultimaVoz = e2.soltada; // el «sigo con la misión» ya se dijo
      anotarPendiente(e2);
      // En el turno lo dice el cerebro (el HECHO lo cuenta); después, el teléfono.
      const dicho = e.idioma === 'en' ? 'I need a bit more; I keep going.' : 'Me falta un poco; sigo con la misión.';
      avisarApp(e2, { tipo: 'computadora', fase: 'sigue', id: e2.id, ...(enTurno ? {} : { texto: dicho }) });
      return { sigue: e2 };
    }
  }
  cerrarMision(e, t);
  if (enTurno || (t.estado === 'parada' && !t.error)) {
    e.avisada = true;
    confirmarAvisos(e.quien, [e.id]);
    avisarApp(e, { tipo: 'computadora', fase: 'termina', id: e.id, ok: t.estado === 'hecha' });
    return { sigue: null };
  }
  const llego = avisarApp(e, { tipo: 'computadora', fase: 'termina', id: e.id, ok: t.estado === 'hecha' && !misionIncompleta(t), texto: fraseDeFinal(e.instruccion, t, e.idioma) }, true);
  if (llego) confirmarAvisos(e.quien, [e.id]);
  return { sigue: null };
}

/** Pide la tarea al nodo y la anota (de quién, su última, su misión, su seguimiento). */
async function crearEncargo(o: {
  instruccion: string;
  paraNodo: string;
  quien: string;
  motor: MotorNodo;
  aparato: string | null;
  idioma: 'es' | 'en';
  maxPasos: number;
  vuelta: number;
  /** La misión de la que es parte; sin ella, esta tarea empieza una (con este plan). */
  mision?: Mision;
  plan?: { pasos: string[]; delCerebro: boolean };
}): Promise<Encargo> {
  const creada: { id: string } = await pedir('/tareas', { method: 'POST', body: JSON.stringify({ instruccion: o.paraNodo, motor: o.motor, max_pasos: o.maxPasos, dueno: huellaDe(o.quien) }) });
  const ahora = Date.now();
  const m: Mision = o.mision ?? {
    id: creada.id,
    quien: o.quien,
    instruccion: o.instruccion,
    plan: o.plan?.pasos ?? planDeMision(o.instruccion, o.idioma),
    planDelCerebro: !!o.plan?.delCerebro,
    inicio: ahora,
    tareas: [],
    indice: 0,
    rondas: 0,
    pasosPrevios: 0,
    idioma: o.idioma,
    motor: o.motor,
    aparato: o.aparato,
    maxPasos: o.maxPasos,
  };
  m.tareas.push(creada.id);
  m.motor = o.motor;
  if (!o.mision) anotarMision(m);
  const e: Encargo = {
    id: creada.id,
    quien: o.quien,
    instruccion: o.instruccion,
    creada: ahora,
    aparato: o.aparato,
    idioma: o.idioma,
    motor: o.motor,
    maxPasos: o.maxPasos,
    vuelta: o.vuelta,
    narrado: 0,
    ultimaVoz: 0,
    dichas: 0,
    porAccion: {},
    mision: m,
    indiceAlEmpezar: m.indice,
    fallos: 0,
    primerFallo: 0,
    limite: ahora + SEGUIR_MAX_MS,
  };
  ENCARGOS.set(e.id, e);
  ULTIMA.set(o.quien, e.id);
  seguir(e);
  return e;
}

/** Encargar, con un segundo intento si el nodo no contestó (un 4xx es un no de verdad: no se insiste). */
async function crearConReintento(o: Parameters<typeof crearEncargo>[0]): Promise<Encargo> {
  try {
    return await crearEncargo(o);
  } catch (err) {
    if (!reintentable(err)) throw err;
    await esperar(TIEMPOS_SEGUIR.reintentoMs);
    try {
      return await crearEncargo(o);
    } catch (err2: any) {
      throw new ErrorNodo(`no contestó tras dos intentos: ${String(err2?.message || err2).slice(0, 100)}`, err2?.status);
    }
  }
}

/** El resultado contado para el modelo: qué pasó, en cuántos pasos, y la respuesta tal cual. */
export function resumenTarea(t: Tarea): string {
  const pasos = pasosUtiles(t);
  if (t.estado === 'hecha') return `Hecha en ${pasos} pasos (${Math.round(t.segundos)} s). Lo que encontró o hizo: ${String(t.respuesta || '').slice(0, 1500)}`;
  if (t.estado === 'parada') return t.error ? `Se detuvo antes de terminar: ${t.error}.` : 'La pararon antes de terminar.';
  if (t.estado === 'sin_pasos') return `No la terminó en ${pasos} pasos. ${t.error || ''}`.trim();
  return `Falló: ${t.error || 'sin detalle'}.`;
}

/**
 * Encarga una tarea y espera hasta `esperaMs`. Si termina, el HECHO lleva el resultado; si no, dice que
 * sigue (y en qué paso va) y la tarea se sigue mirando: se narra en el teléfono y su final se le dice
 * en cuanto llegue. Al empezar, el teléfono abre la vista en vivo (`empieza`).
 */
export async function encargarTarea(o: {
  instruccion: string;
  quien: string;
  motor: MotorNodo;
  esperaMs: number;
  senal?: AbortSignal;
  maxPasos?: number;
  /** El teléfono del turno (x-aura-aparato). */
  aparato?: string | null;
  idioma?: 'es' | 'en';
  /** Encargada desde la app (sin turno): el teléfono dice el plan en voz al empezar. */
  decirPlan?: boolean;
}): Promise<{ hecho: string; id: string | null; tarea: Tarea | null }> {
  if (!computadoraConfigurada()) {
    return { hecho: 'HARNESS computadora: no está configurada en este servidor. No la usé; dilo con naturalidad.', id: null, tarea: null };
  }
  const idioma: 'es' | 'en' = o.idioma === 'en' ? 'en' : 'es';
  // «… PLAN: a | b | c»: el plan que escribió el cerebro (si no, uno armado de la instrucción).
  const separado = separarPlan(o.instruccion);
  const instruccion = separado.mision;
  const plan = { pasos: separado.plan ?? planDeMision(instruccion, idioma), delCerebro: !!separado.plan };
  let e: Encargo;
  let nota = '';
  const base = { instruccion, paraNodo: prepararMision(instruccion, idioma), quien: o.quien, aparato: o.aparato ?? null, idioma, maxPasos: o.maxPasos ?? 25, vuelta: 0, plan };
  try {
    try {
      e = await crearConReintento({ ...base, motor: o.motor });
    } catch (err: any) {
      // Eligió Claude en Ajustes pero el nodo no tiene su clave: la hace la gratis, y se dice.
      if (o.motor !== 'claude' || !/claude/i.test(String(err?.message || ''))) throw err;
      e = await crearConReintento({ ...base, motor: 'holo' });
      nota = ' (La hizo el modelo gratis: Claude no está configurado en la computadora.)';
    }
  } catch (err: any) {
    return { hecho: `HARNESS computadora: no pude encargarla (${String(err?.message || err).slice(0, 120)}). Dilo con honestidad y ofrece intentarlo en un momento. No inventes el resultado.`, id: null, tarea: null };
  }
  // El teléfono abre la vista en vivo: la captura, el plan, los pasos en palabras y el tecleo bajito.
  const dichoPlan = o.decirPlan ? fraseDePlan(plan.pasos, idioma) : '';
  const enVivo = avisarApp(e, { tipo: 'computadora', fase: 'empieza', id: e.id, plan: plan.pasos, ...(dichoPlan ? { texto: dichoPlan } : {}) }) > 0;
  const mira = enVivo
    ? 'En su teléfono ya se abrió sola la vista en vivo de tu computadora: dile que mire la pantalla, que le vas contando y que le dices el resultado en cuanto termine.'
    : 'Puede mirarla en vivo en la app, en «Más → Su computadora»; le dices el resultado en cuanto termine.';
  // Si el plan no lo escribió el cerebro, que lo diga en una frase (como un agente: primero el plan).
  const conPlan = plan.delCerebro ? '' : ` Tu plan: ${plan.pasos.join(' → ')}; díselo en una frase corta.`;
  const hasta = Date.now() + Math.max(0, o.esperaMs);
  let t: Tarea | null = null;
  // El plazo es de verdad: ni la pausa ni la consulta se pasan de lo que queda (ni de la interrupción).
  while (Date.now() < hasta && !o.senal?.aborted) {
    await esperar(Math.min(SONDEO_MS, hasta - Date.now()), o.senal);
    const queda = hasta - Date.now();
    if (queda <= 0 || o.senal?.aborted) break;
    try {
      t = await verTarea(e.id, false, Math.min(10_000, queda), o.senal);
    } catch {
      continue;
    }
    e.ultimaVista = t;
    moverPlan(e, t);
    // Se detuvo a pedir permiso antes de algo sensible: lo pregunta el turno (el teléfono pone los botones).
    if (t.estado === 'confirmar' && t.pregunta && !e.cerrada) {
      alCambiarEstado(e, t, true);
      e.soltada = Date.now();
      anotarPendiente(e);
      return {
        hecho:
          `HARNESS computadora «${instruccion.slice(0, 160)}»: tu computadora se detuvo a pedir permiso antes de algo sensible: «${t.pregunta}». ` +
          `Pregúntale con esas palabras si lo haces (sí o no) y espera su respuesta; no digas que ya lo hiciste.${conPlan} ${mira}`,
        id: e.id,
        tarea: t,
      };
    }
    if (TERMINADA.has(t.estado) && !e.cerrada) {
      const { sigue } = await alTerminar(e, t, true);
      if (sigue) {
        return {
          hecho:
            `HARNESS computadora «${instruccion.slice(0, 160)}»: la primera parte no alcanzó (${resumenTarea(t).slice(0, 200)}) y ya sigue sola en tu computadora con lo que falta.${nota} ` +
            `Di que sigues trabajando en eso. ${mira} No inventes el resultado.`,
          id: sigue.id,
          tarea: t,
        };
      }
      return { hecho: `HARNESS computadora «${instruccion.slice(0, 160)}»: ${resumenTarea(t)}${nota}`, id: e.id, tarea: t };
    }
  }
  if (!e.cerrada) {
    e.soltada = Date.now();
    anotarPendiente(e);
  }
  const ultimo = t?.pasos?.[t.pasos.length - 1];
  const vaEn = ultimo ? ` Va en el paso ${ultimo.n} (${pasoEnPalabras(ultimo)}).` : '';
  return {
    hecho:
      `HARNESS computadora «${instruccion.slice(0, 160)}»: la tarea sigue en tu computadora.${vaEn}${nota} ` +
      `Di que ya la estás haciendo («ya la estoy usando, mira la pantalla»).${conPlan} ${mira} No inventes el resultado.`,
    id: e.id,
    tarea: t,
  };
}

/** El plan dicho en voz, en una frase: «Va. Mi plan: entrar a bch.hn, leer… y darte el resultado.» */
export function fraseDePlan(plan: readonly string[], idioma: 'es' | 'en' = 'es'): string {
  const ps = plan.map((p) => p.charAt(0).toLowerCase() + p.slice(1));
  const lista = ps.length > 1 ? `${ps.slice(0, -1).join(', ')} ${idioma === 'en' ? 'and' : 'y'} ${ps[ps.length - 1]}` : ps[0] || '';
  return idioma === 'en' ? `On it. My plan: ${lista}.` : `Va. Mi plan: ${lista}.`;
}

/** La misión de alguien que espera su sí (la más nueva), si la pregunta sigue valiendo. */
function misionConPregunta(quien: string): Mision | null {
  for (const id of [...(HISTORIAL.get(quien) ?? [])].reverse()) {
    const m = MISIONES.get(id);
    if (m?.pregunta && !m.final && Date.now() - m.pregunta.desde < PREGUNTA_VALE_MS) return m;
  }
  return null;
}

function misionQueOfreceSeguir(quien: string): Mision | null {
  const id = (HISTORIAL.get(quien) ?? []).at(-1);
  const m = id ? MISIONES.get(id) : null;
  return m?.ofreceSeguir && Date.now() - m.ofreceSeguir < SEGUIR_VALE_MS ? m : null;
}

/** Ya contestó su sí o su no: el teléfono quita los botones y vuelve el tecleo enseguida (sin esperar al sondeo). */
function alResponder(tareaId: string) {
  const e = ENCARGOS.get(tareaId);
  if (!e || e.cerrada) return;
  e.contestada = { texto: e.mision.pregunta?.texto ?? '', en: Date.now() };
  e.mision.pregunta = null;
  e.ultimoEstado = 'trabajando';
  avisarApp(e, { tipo: 'computadora', fase: 'reanuda', id: e.id });
}

/** Lo que el turno de voz le da al servidor para soltar las acciones cuando se confirma (server/voz-agente.ts). */
type Retener = { hacer: (f: () => void) => void; alDescartar: (f: () => void) => void };

/**
 * Al empezar el turno: si su computadora espera su sí (o le ofreció seguir) y dijo «sí» o «no», se resuelve
 * AQUÍ (lo hace el servidor, no el modelo) y vuelve el HECHO para que AURA lo diga. Otra cosa: null (la
 * pregunta sigue esperando, y la app tiene los botones). En la voz, espera a que el turno se confirme.
 */
export async function resolverPreguntaComputadora(quien: string, mensaje: string, retener?: Retener): Promise<string | null> {
  if (!quien) return null;
  const m = misionConPregunta(quien);
  const ofrece = m ? null : misionQueOfreceSeguir(quien);
  if (!m && !ofrece) return null;
  // Las marcas del propio teléfono («[[lectura:…]]», «[[sigues]]») no son la persona.
  if (/^\s*\[\[/.test(String(mensaje || ''))) return null;
  const r = respuestaSiNo(mensaje);
  if (!r) {
    // Habló de otra cosa: el «¿sigo?» ya no vale para un «sí» suelto de después (el botón Seguir sí).
    // La pregunta antes de algo sensible sigue esperando: los botones están en la app.
    if (ofrece) ofrece.ofreceSeguir = undefined;
    return null;
  }
  if (m) {
    const p = m.pregunta!;
    m.pregunta = null;
    const hacer = () => confirmarTarea(p.tareaId, r === 'si').then(() => alResponder(p.tareaId));
    if (retener) {
      retener.alDescartar(() => {
        m.pregunta = p;
      });
      retener.hacer(() => void hacer().catch(() => undefined));
    } else {
      try {
        await hacer();
      } catch (err: any) {
        m.pregunta = p;
        return `COMPUTADORA: quiso contestar «${r === 'si' ? 'sí' : 'no'}» a «${p.texto}», pero tu computadora no recibió la respuesta (${String(err?.message || err).slice(0, 80)}). Díselo y que lo toque en la app.`;
      }
    }
    return r === 'si'
      ? `COMPUTADORA: dijo que sí a «${p.texto}»; tu computadora sigue con eso. Díselo en una frase («va, sigo»).`
      : `COMPUTADORA: dijo que no a «${p.texto}»; tu computadora no lo hace y sigue sin eso. Díselo en una frase.`;
  }
  const o = ofrece!;
  o.ofreceSeguir = undefined;
  if (r === 'no') return `COMPUTADORA: no quiere que sigas con «${o.instruccion.slice(0, 120)}». Dile que está bien, que ahí queda.`;
  if (retener) {
    retener.alDescartar(() => {
      o.ofreceSeguir = Date.now();
    });
    retener.hacer(() => void seguirMision(o).catch(() => undefined));
  } else if (!(await seguirMision(o).catch(() => null))) {
    return `COMPUTADORA: quiso que siguieras con «${o.instruccion.slice(0, 120)}», pero tu computadora no contestó. Díselo con honestidad.`;
  }
  return `COMPUTADORA: dijo que sí; tu computadora sigue con «${o.instruccion.slice(0, 120)}» desde donde quedó. Dile que ya sigues y que mire la pantalla.`;
}

/** Sigue una misión que quedó a medias, desde donde quedó la pantalla (el «sí» a «¿sigo?» o el botón «Seguir»). */
export async function seguirMision(m: Mision, conTexto = false): Promise<Encargo | null> {
  if (m.rondas >= MAX_RONDAS) return null;
  const anterior = ENCARGOS.get(m.tareas[m.tareas.length - 1] ?? '');
  m.rondas++;
  m.ofreceSeguir = undefined;
  m.pasosPrevios += anterior?.terminada ? pasosUtiles(anterior.terminada) : 0;
  const finAntes = { final: m.final, fin: m.fin };
  m.final = undefined;
  m.fin = undefined;
  let e: Encargo;
  try {
    e = await crearConReintento({
      instruccion: m.instruccion,
      paraNodo: instruccionContinuar(m.instruccion, anterior?.terminada ?? { pasos: [] }, m.idioma),
      quien: m.quien,
      motor: m.motor,
      aparato: m.aparato,
      idioma: m.idioma,
      maxPasos: m.maxPasos,
      vuelta: 0,
      mision: m,
    });
  } catch {
    Object.assign(m, finAntes);
    m.rondas--;
    m.ofreceSeguir = Date.now();
    return null;
  }
  e.soltada = Date.now();
  e.ultimaVoz = e.soltada;
  anotarPendiente(e);
  avisarApp(e, { tipo: 'computadora', fase: 'sigue', id: e.id, ...(conTexto ? { texto: m.idioma === 'en' ? 'On it, I keep going from where I was.' : 'Va, sigo desde donde me quedé.' } : {}) }, true);
  return e;
}

/**
 * Lo que dice el cerebro con «PEDIR_HERRAMIENTA: computadora parar | pausar | seguir» (la persona lo dijo en
 * voz: «para tu computadora», «pausa», «sigue»). Lo demás es una misión nueva (encargarTarea).
 */
export async function comandoComputadora(quien: string, arg: string): Promise<string | null> {
  const c = sinAcentos(String(arg || '')).replace(/[.!¡¿?]+/g, '').trim();
  const verbo = /^(parar|para|detener|detente|deten|cancelar|cancela|stop)$/.test(c)
    ? 'parar'
    : /^(pausar|pausa|pause)$/.test(c)
      ? 'pausar'
      : /^(seguir|sigue|reanudar|reanuda|continuar|continua|resume|continue)$/.test(c)
        ? 'seguir'
        : null;
  if (!verbo) return null;
  const id = ultimaTareaDe(quien);
  const e = id ? ENCARGOS.get(id) : null;
  if (!e) return 'HARNESS computadora: no hay ninguna tarea suya en tu computadora ahora. Díselo.';
  const m = e.mision;
  try {
    if (verbo === 'parar') {
      if (e.cerrada) return 'HARNESS computadora: tu computadora ya había terminado; no había nada que parar. Díselo.';
      await pararTarea(e.id);
      return `HARNESS computadora: paré «${m.instruccion.slice(0, 120)}». Díselo en una frase.`;
    }
    const caps = await capacidadesNodo();
    if (verbo === 'pausar') {
      if (!caps.includes('pausar')) return 'HARNESS computadora: tu computadora todavía no sabe pausar (falta actualizar su servicio); solo puedo pararla del todo. Explícaselo y pregúntale si la paras.';
      await pausarTarea(e.id);
      return 'HARNESS computadora: la pausé; sigue cuando diga «sigue». Díselo en una frase.';
    }
    if (e.cerrada) {
      if (m.ofreceSeguir || m.final?.ok === false) {
        const e2 = await seguirMision(m);
        if (e2) return `HARNESS computadora: sigo con «${m.instruccion.slice(0, 120)}» desde donde quedó. Dile que mire la pantalla.`;
      }
      return 'HARNESS computadora: no hay nada a medias que seguir. Díselo.';
    }
    if (!caps.includes('pausar')) return 'HARNESS computadora: tu computadora sigue trabajando (no estaba en pausa). Díselo.';
    await reanudarTarea(e.id);
    return 'HARNESS computadora: siguió donde estaba. Díselo en una frase.';
  } catch (err: any) {
    return `HARNESS computadora: no pude (${String(err?.message || err).slice(0, 100)}). Díselo con honestidad.`;
  }
}

function esperar(ms: number, senal?: AbortSignal): Promise<void> {
  return new Promise((r) => {
    if (ms <= 0 || senal?.aborted) return r();
    const t = setTimeout(r, ms);
    senal?.addEventListener('abort', () => (clearTimeout(t), r()), { once: true });
  });
}

/** Su última tarea, en corto (sin capturas): para el aviso de la mesa «tu computadora está trabajando». */
export async function resumenUltima(quien: string): Promise<{ id: string; estado: EstadoTarea; pasos: number; instruccion: string; ultimo: string | null } | null> {
  const id = ultimaTareaDe(quien);
  if (!id) return null;
  try {
    const t = await verTarea(id, false, 5000);
    const u = t.pasos[t.pasos.length - 1];
    return { id, estado: t.estado, pasos: t.pasos.length, instruccion: (misionDe(id) || t.instruccion).slice(0, 200), ultimo: u ? pasoEnPalabras(u) : null };
  } catch {
    return null;
  }
}

/** Pruebas: olvidar los encargos. */
export function _olvidarEncargos() {
  ENCARGOS.clear();
  MISIONES.clear();
  HISTORIAL.clear();
  capsCache = null;
  ULTIMA.clear();
  PENDIENTES.clear();
}

/* ------------------------------------------------------------------ rutas para la app y la web */

type DepsRutas = {
  exigirMesa: import('express').RequestHandler;
  limitar: (max: number, ventanaMs?: number, grupo?: string) => import('express').RequestHandler;
  sesionDe: (req: import('express').Request) => { correo: string } | null;
  /** Qué motor eligió en Ajustes («gratis» o «pago»); sin perfil, gratis. */
  motorDe?: (correo: string) => Promise<string | null | undefined>;
};

/**
 * La tarea para la app: con la captura SOLO del último paso (lo que la computadora está viendo ahora),
 * o la del paso que se pidió (`paso`). Todas juntas pesaban casi 1 MB en cada consulta.
 */
export function tareaParaApp(t: Tarea, paso?: number): Tarea {
  // Sin `paso`: el último paso con captura («escritorio_limpio» no trae): lo más reciente que vio.
  const mostrar = Number.isFinite(paso) ? Number(paso) : ([...t.pasos].reverse().find((p) => p.miniatura)?.n ?? -1);
  return { ...t, pasos: t.pasos.map((p) => (p.n === mostrar ? p : { ...p, miniatura: undefined })) };
}

/** Lo que dice cada paso, en palabras de persona (la app lo muestra en la lista de pasos). */
export function pasoEnPalabras(p: Pick<PasoTarea, 'accion' | 'args'>, idioma: 'es' | 'en' = 'es'): string {
  const a = (p.args || {}) as Record<string, any>;
  const en = idioma === 'en';
  const corto = (x: unknown, n = 60) => {
    const t = String(x ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  switch (p.accion) {
    case 'escritorio_limpio':
      return en ? 'Started a clean desktop' : 'Abrió un escritorio limpio';
    case 'open_url':
      return en ? `Opened ${corto(a.url)}` : `Abrió ${corto(a.url)}`;
    case 'click':
    case 'left_click':
      return a.element ? (en ? `Clicked «${corto(a.element, 40)}»` : `Tocó «${corto(a.element, 40)}»`) : en ? 'Clicked' : 'Hizo clic';
    case 'pedir_confirmacion':
      return en ? `Asked for your OK: «${corto(a.pregunta, 80)}»` : `Te pidió permiso: «${corto(a.pregunta, 80)}»`;
    case 'confirmacion':
      return a.si ? (en ? 'You said yes' : 'Dijiste que sí') : en ? 'You said no' : 'Dijiste que no';
    case 'persona':
      if (a.tipo === 'click') return en ? 'You tapped the screen' : 'Tú tocaste la pantalla';
      if (a.tipo === 'escribir') return en ? `You typed (${Number(a.letras) || 0} characters)` : `Tú escribiste (${Number(a.letras) || 0} letras)`;
      if (a.tipo === 'tecla') return en ? `You pressed ${corto(a.teclas, 20)}` : `Tú presionaste ${corto(a.teclas, 20)}`;
      return en ? 'You scrolled' : 'Tú moviste la página';
    case 'screenshot':
      return en ? 'Looked at the screen' : 'Miró la pantalla';
    case 'zoom':
      return en ? 'Zoomed in to read' : 'Acercó para leer';
    case 'mouse_move':
      return en ? 'Moved the mouse' : 'Movió el ratón';
    case 'double_click':
      return en ? 'Double-clicked' : 'Hizo doble clic';
    case 'right_click':
      return en ? 'Right-clicked' : 'Hizo clic derecho';
    case 'type':
      return en ? `Typed «${corto(a.text, 50)}»${a.press_enter ? ' and pressed Enter' : ''}` : `Escribió «${corto(a.text, 50)}»${a.press_enter ? ' y dio Enter' : ''}`;
    case 'key':
      return en ? `Pressed ${corto(a.keys, 30)}` : `Presionó ${corto(a.keys, 30)}`;
    case 'scroll':
      return a.direction === 'up' ? (en ? 'Scrolled up' : 'Subió en la página') : en ? 'Scrolled down' : 'Bajó en la página';
    case 'drag':
      return en ? 'Dragged' : 'Arrastró';
    case 'wait':
      return en ? 'Waited for the page' : 'Esperó a que cargara';
    case 'answer':
      return en ? 'Finished and reported' : 'Terminó y dio el resultado';
    case 'nada':
      return en ? 'Looked at the screen' : 'Miró la pantalla';
    default:
      return corto(p.accion, 40);
  }
}

/**
 * Lo que la app muestra de su computadora: si está, qué motores ofrece, su última tarea con las
 * capturas de cada paso, y el botón de pararla. Cada quien ve solo sus tareas.
 *   GET  /api/computadora            → { configurada, ok, motores, ocupada, capacidades, ultima, actual, historial }
 *   GET  /api/computadora/tareas/:id → la tarea con miniaturas (si es suya) y su `mision` (plan marcado, tiempo, pregunta, final)
 *   POST /api/computadora/tareas/:id/parar
 *   POST /api/computadora/tareas/:id/pausar | /reanudar            (si el nodo sabe: capacidades)
 *   POST /api/computadora/tareas/:id/confirmar {si}                 el sí o el no a lo que preguntó
 *   POST /api/computadora/tareas/:id/control {tomar}                tomar el control / devolverlo
 *   POST /api/computadora/tareas/:id/accion {tipo, …}               lo que hace la persona con el control
 *   GET  /api/computadora/tareas/:id/pantalla                       { imagen } lo que se ve ahora (JPEG en base64)
 *   GET  /api/computadora/misiones/:id                              una misión del historial (con su tarjeta final)
 *   POST /api/computadora/misiones/:id/seguir                       sigue una misión que quedó a medias
 */
export function montarRutasComputadora(app: import('express').Express, d: DepsRutas) {
  type Req = import('express').Request;
  type Res = import('express').Response;
  const correoDe = (req: Req) => String(d.sesionDe(req)?.correo || '').toLowerCase();
  const sinSesion = (res: Res) => res.status(401).json({ error: 'Entra con tu sesión.', code: 'sesion_requerida', honesto: true });
  const noEsSuya = (res: Res) => res.status(404).json({ error: 'No encuentro esa tarea.', honesto: true });
  const noContesto = (res: Res, que: string, e: any) => {
    const st = e instanceof ErrorNodo ? e.status : undefined;
    // 409: la tarea ya no está en ese estado (terminó, ya contestó, todavía no empieza): el nodo dice por qué.
    if (st === 409 || st === 400) return res.status(409).json({ error: `${que}: ${String(e?.message || '').slice(0, 120)}.`, honesto: true });
    return res.status(502).json({ error: `${que}: la computadora no contestó (${String(e?.message || e).slice(0, 80)}).`, honesto: true });
  };
  /** Lo del agente.py nuevo: si el nodo no lo sabe, se dice claro (501) y la app ofrece solo Detener. */
  const exigirCapacidad = async (res: Res, c: CapacidadNodo): Promise<boolean> => {
    if ((await capacidadesNodo()).includes(c)) return true;
    const que = c === 'pausar' ? 'pausar' : c === 'control' ? 'dejarte tomar el control' : 'pedirte permiso';
    res.status(501).json({ error: `Tu computadora todavía no sabe ${que}: falta actualizar su servicio (docs/COMPUTADORA.md). Puedo detenerla.`, code: 'no_soportado', honesto: true });
    return false;
  };
  /** Una acción sobre una tarea suya: dueño, capacidad (si hace falta) y la llamada al nodo. */
  const sobreTarea = (que: string, cap: CapacidadNodo | null, hacer: (id: string, req: Req) => Promise<unknown>) => async (req: Req, res: Res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    if (duenoDe(req.params.id) !== correo) return noEsSuya(res);
    if (cap && !(await exigirCapacidad(res, cap))) return;
    try {
      const r = await hacer(req.params.id, req);
      return res.json({ ok: true, ...(r && typeof r === 'object' ? r : {}), honesto: true });
    } catch (e: any) {
      if (e?.codigo === 400) return res.status(400).json({ error: e.message, honesto: true });
      return noContesto(res, que, e);
    }
  };

  app.get('/api/computadora', d.exigirMesa, d.limitar(40), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    const [estado, actual] = await Promise.all([estadoComputadora(), resumenUltima(correo)]);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ...estado, ultima: ultimaTareaDe(correo), actual, pendientes: pendientesDe(correo), historial: historialDe(correo), honesto: true });
  });

  /**
   * La persona le encarga algo a su computadora desde la app (sin pasar por la conversación). No espera:
   * la app mira los pasos en vivo, y si termina sin que la mire, el avatar se lo cuenta en el turno siguiente.
   */
  app.post('/api/computadora/tareas', d.exigirMesa, d.limitar(8), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    const instruccion = String(req.body?.instruccion || '').replace(/\s+/g, ' ').trim();
    if (instruccion.length < 4) return res.status(400).json({ error: 'Dile qué hacer (una frase con lo que quieres).', honesto: true });
    if (instruccion.length > 600) return res.status(400).json({ error: 'Muy largo: dilo en menos de 600 letras.', honesto: true });
    const motor = motorDelPerfil(await d.motorDe?.(correo).catch(() => null), correo);
    // El teléfono que la pidió (el mismo id de aparato que usa el canal de acciones): ahí se narra y se avisa.
    const aparato = String(req.headers['x-aura-aparato'] || '').trim();
    const idioma = req.body?.idioma === 'en' ? 'en' : 'es';
    const r = await encargarTarea({ instruccion, quien: correo, motor, esperaMs: 0, aparato: /^[A-Za-z0-9._:-]{1,128}$/.test(aparato) ? aparato : null, idioma, decirPlan: true });
    if (!r.id) return res.status(503).json({ error: r.hecho.replace(/^HARNESS computadora:\s*/, '').replace(/\s*(Dilo con honestidad.*|No inventes.*|No la usé.*|dilo con naturalidad\.?)$/i, ''), honesto: true });
    return res.json({ id: r.id, mision: misionDeTarea(r.id) ? vistaMision(misionDeTarea(r.id)!) : null, honesto: true });
  });

  app.get('/api/computadora/tareas/:id', d.exigirMesa, d.limitar(90), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    if (duenoDe(req.params.id) !== correo) return noEsSuya(res);
    res.setHeader('Cache-Control', 'no-store');
    const m = misionDeTarea(req.params.id);
    const idioma = req.query.idioma === 'en' ? 'en' : 'es';
    try {
      const paso = req.query.paso != null ? Number(req.query.paso) : undefined;
      const crudo = await verTarea(req.params.id, true);
      // La misión como se pidió (al nodo le pudo ir con «sigue desde donde quedó…» o con «dime qué hay»).
      const t = tareaParaApp({ ...crudo, instruccion: misionDe(req.params.id) || crudo.instruccion }, paso);
      const e = ENCARGOS.get(req.params.id);
      if (e && !TERMINADA.has(crudo.estado)) moverPlan(e, crudo);
      return res.json({
        tarea: { ...t, pasos: t.pasos.map((p) => ({ ...p, texto: pasoEnPalabras(p, idioma) })) },
        mision: m ? vistaMision(m, crudo.estado, crudo.pregunta) : null,
        honesto: true,
      });
    } catch (e: any) {
      // El nodo ya la olvidó (pasó una hora) o no contesta: si la misión terminó, su tarjeta sigue aquí.
      if (m?.final)
        return res.json({
          tarea: { id: req.params.id, motor: m.motor, instruccion: m.instruccion, estado: m.final.estado, pasos: [], respuesta: m.final.respuesta, error: m.final.error, segundos: m.final.segundos },
          mision: vistaMision(m),
          honesto: true,
        });
      return res.status(502).json({ error: `La computadora no contestó (${String(e?.message || e).slice(0, 80)}).`, mision: m ? vistaMision(m) : null, honesto: true });
    }
  });

  app.post('/api/computadora/tareas/:id/parar', d.exigirMesa, d.limitar(20), sobreTarea('No pude pararla', null, (id) => pararTarea(id)));
  app.post('/api/computadora/tareas/:id/pausar', d.exigirMesa, d.limitar(20), sobreTarea('No pude pausarla', 'pausar', (id) => pausarTarea(id)));
  app.post('/api/computadora/tareas/:id/reanudar', d.exigirMesa, d.limitar(20), sobreTarea('No pude seguir', 'pausar', (id) => reanudarTarea(id)));
  app.post(
    '/api/computadora/tareas/:id/confirmar',
    d.exigirMesa,
    d.limitar(20),
    sobreTarea('No le llegó tu respuesta', 'confirmar', async (id, req) => {
      if (typeof req.body?.si !== 'boolean') throw Object.assign(new Error('Di sí o no.'), { codigo: 400 });
      await confirmarTarea(id, req.body.si);
      alResponder(id);
      return { si: req.body.si };
    })
  );
  app.post(
    '/api/computadora/tareas/:id/control',
    d.exigirMesa,
    d.limitar(20),
    sobreTarea('No pude cambiar el control', 'control', (id, req) => controlTarea(id, !!req.body?.tomar))
  );
  app.post(
    '/api/computadora/tareas/:id/accion',
    d.exigirMesa,
    d.limitar(120),
    sobreTarea('No se hizo', 'control', async (id, req) => {
      const a = validarAccionPersona(req.body);
      if (!a) throw Object.assign(new Error('Esa acción no la entiendo.'), { codigo: 400 });
      await accionPersona(id, a);
    })
  );
  app.get(
    '/api/computadora/tareas/:id/pantalla',
    d.exigirMesa,
    d.limitar(120),
    sobreTarea('No pude ver la pantalla', 'control', async (id) => ({ imagen: (await pantallaDeTarea(id)).toString('base64') }))
  );

  app.get('/api/computadora/misiones/:id', d.exigirMesa, d.limitar(60), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    const m = MISIONES.get(req.params.id);
    if (!m || m.quien !== correo) return noEsSuya(res);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ mision: vistaMision(m), honesto: true });
  });

  app.post('/api/computadora/misiones/:id/seguir', d.exigirMesa, d.limitar(8), async (req, res) => {
    const correo = correoDe(req);
    if (!correo) return sinSesion(res);
    const m = MISIONES.get(req.params.id);
    if (!m || m.quien !== correo) return noEsSuya(res);
    if (!m.final || m.final.ok) return res.status(409).json({ error: 'Esa misión no quedó a medias.', honesto: true });
    if (m.rondas >= MAX_RONDAS) return res.status(409).json({ error: 'Ya la seguí varias veces; mejor pídemela de nuevo con más detalle.', honesto: true });
    const e = await seguirMision(m, true);
    if (!e) return res.status(502).json({ error: 'La computadora no contestó; prueba en un momento.', honesto: true });
    return res.json({ id: e.id, honesto: true });
  });
}
