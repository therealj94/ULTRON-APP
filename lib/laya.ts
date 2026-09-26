/**
 * Cliente de Laya, el modelo de decisiones que corre en el nodo T4 (scripts/nodo-t4/laya).
 *
 * Laya no escribe: contesta preguntas cerradas con una probabilidad calibrada, en decenas de
 * milisegundos. Decide qué especialistas convoca Dr Electrum (`/decidir`), qué se hace con cada
 * mensaje de AU-RA (`/v1/mensaje`) y qué es cada documento de un expediente (`/v1/documento`). Si el
 * nodo no está configurado, tarda o falla, esto devuelve null y quien llama sigue con su regla de
 * siempre: Laya nunca es el motivo de que un turno se caiga.
 */
import { Agent as UndiciAgent } from 'undici';

/**
 * Solo https: el texto del usuario y la clave cruzan internet. http se acepta únicamente hacia la
 * propia máquina (pruebas, túnel local); cualquier otra URL http cuenta como «no configurado».
 */
export function urlSegura(cruda: string) {
  const u = cruda.trim().replace(/\/$/, '');
  if (!u) return '';
  try {
    const { protocol, hostname } = new URL(u);
    if (protocol === 'https:') return u;
    if (protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) return u;
  } catch {}
  return '';
}
const url = () => urlSegura(process.env.ULTRON_LAYA_URL || '');
const clave = () => process.env.ULTRON_LAYA_CLAVE || '';
const espera = () => Number(process.env.ULTRON_LAYA_TIMEOUT_MS) || 800;

/**
 * La conexión se reutiliza entre turnos. Sin esto cada turno abría TCP + TLS nuevos hacia el nodo
 * (Caddy no anuncia `Keep-Alive`, así que fetch la soltaba a los 4 s): medido, 195 ms de mediana en
 * frío contra 108 ms reutilizando, y el p95 de 368 a 115 ms. 60 s queda por debajo del tiempo
 * ocioso de Caddy (5 min), así que el nodo no la cierra por su lado mientras la tenemos por buena.
 */
const conexion = new UndiciAgent({ keepAliveTimeout: 60_000, keepAliveMaxTimeout: 60_000, connections: 4 });

/**
 * Lo que se le manda: el principio y el final, sin exceder ~700 caracteres.
 *
 * El modelo se ajustó con consultas de menos de 230 caracteres y su tiempo crece con el largo
 * (67 ms con 20 caracteres, 394 ms con 2000 en la T4). Cortar por la cabeza, como antes, perdía
 * justo la pregunta de un mensaje dictado o pegado, que suele ir al final: sobre la prueba apartada
 * con 2.500 caracteres de contexto delante, cabeza de 2000 acertaba el panel el 12 % de las veces;
 * 200 del principio + 500 del final, el 51 % (y el 55 % con la pregunta al principio).
 * El mismo recorte hace servidor.py, así lo medido es lo que corre.
 */
export const CABEZA = 200;
export const COLA = 500;
/** Un sustituto UTF-16 sin su pareja (String#toWellFormed, que el target ES2022 no trae). */
const SUELTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export function recortarParaLaya(texto: string, cabeza = CABEZA, cola = COLA): string {
  // Por puntos de código, no por unidades UTF-16: partir un emoji por la mitad deja un sustituto
  // suelto que el tokenizador del nodo no acepta (medido: 502 y un turno en pausa).
  const s = [...String(texto || '').replace(SUELTO, '\uFFFD').trim()];
  if (s.length <= cabeza + cola) return s.join('');
  return `${s.slice(0, cabeza).join('').trimEnd()} … ${s.slice(-cola).join('').trimStart()}`;
}

/**
 * Tras un fallo no se vuelve a intentar durante un rato, que crece si sigue fallando: un corte de
 * red aislado cuesta 5 s de Laya, no un minuto; un nodo caído cuesta, como mucho, una espera cada
 * dos minutos.
 */
const PAUSA_MIN_MS = 5_000;
const PAUSA_MAX_MS = 120_000;

export type DecisionLaya = { panel: string[]; p: Record<string, number>; umbral: number; ms: number };
export type MotivoLaya = 'ok' | 'sin configurar' | 'sin texto' | 'en pausa' | 'tiempo agotado' | 'red' | 'respuesta rara' | `http ${number}`;
export type ConsultaLaya = { decision: DecisionLaya | null; motivo: MotivoLaya; /** Ida y vuelta desde aquí, en ms. */ ms: number };

function nuevoEstado() {
  return {
    fallosSeguidos: 0,
    pausadoHasta: 0,
    ok: 0,
    fallos: 0,
    ultimoOk: 0,
    ultimoFallo: 0,
    ultimoMotivo: null as MotivoLaya | null,
    /** Últimas idas y vueltas correctas, para la mediana que se enseña en salud. */
    tiempos: [] as number[],
  };
}
type Estado = ReturnType<typeof nuevoEstado>;

/**
 * Una pausa por ruta: si el modelo de documentos no cargó en el nodo y contesta 404, eso no puede
 * dejar a Dr Electrum sin su panel (`/decidir`) ni a AU-RA sin su clasificador.
 */
const estado = nuevoEstado();
const estadosModelo = new Map<string, Estado>();
function estadoDe(ruta: string): Estado {
  if (ruta === 'decidir') return estado;
  if (!estadosModelo.has(ruta)) estadosModelo.set(ruta, nuevoEstado());
  return estadosModelo.get(ruta)!;
}

export function layaConfigurado() {
  return !!url();
}

function fallar(motivo: MotivoLaya, e: Estado = estado) {
  e.fallos++;
  e.fallosSeguidos++;
  e.ultimoFallo = Date.now();
  e.ultimoMotivo = motivo;
  e.pausadoHasta = Date.now() + Math.min(PAUSA_MAX_MS, PAUSA_MIN_MS * 2 ** (e.fallosSeguidos - 1));
}

function acertar(ms: number, e: Estado = estado) {
  e.ok++;
  e.fallosSeguidos = 0;
  e.ultimoOk = Date.now();
  e.tiempos = [...e.tiempos.slice(-49), ms];
}

/** Pregunta a Laya y dice por qué no contestó cuando no contesta. Nunca lanza. */
export async function consultarLaya(texto: string, esperaMs = espera()): Promise<ConsultaLaya> {
  const base = url();
  if (!base) return { decision: null, motivo: 'sin configurar', ms: 0 };
  const recortado = recortarParaLaya(texto);
  if (!recortado) return { decision: null, motivo: 'sin texto', ms: 0 };
  if (Date.now() < estado.pausadoHasta) return { decision: null, motivo: 'en pausa', ms: 0 };
  const t0 = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), esperaMs);
  try {
    const r = await fetch(`${base}/decidir`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(clave() ? { authorization: `Bearer ${clave()}` } : {}) },
      body: JSON.stringify({ texto: recortado }),
      signal: ctrl.signal,
      dispatcher: conexion,
    } as RequestInit);
    if (!r.ok) {
      await r.body?.cancel().catch(() => {});
      fallar(`http ${r.status}`);
      return { decision: null, motivo: `http ${r.status}`, ms: Date.now() - t0 };
    }
    const j = (await r.json().catch(() => null)) as DecisionLaya | null;
    if (!Array.isArray(j?.panel) || !j!.panel.every((x) => typeof x === 'string')) {
      fallar('respuesta rara');
      return { decision: null, motivo: 'respuesta rara', ms: Date.now() - t0 };
    }
    const ms = Date.now() - t0;
    acertar(ms);
    return { decision: j!, motivo: 'ok', ms };
  } catch {
    const motivo: MotivoLaya = ctrl.signal.aborted ? 'tiempo agotado' : 'red';
    fallar(motivo);
    return { decision: null, motivo, ms: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}

/** Lo de siempre: la decisión, o null si Laya no está, tarda o falla. */
export async function decidirLaya(texto: string, esperaMs = espera()): Promise<DecisionLaya | null> {
  return (await consultarLaya(texto, esperaMs)).decision;
}

/**
 * Cómo le va a Laya desde este proceso, para salud: sin URL ni clave. `vivo` es «contestó bien la
 * última vez que se le preguntó»; para saberlo ahora mismo, saludLaya().
 */
function resumen(e: Estado) {
  const ts = [...e.tiempos].sort((a, b) => a - b);
  const iso = (n: number) => (n ? new Date(n).toISOString() : null);
  return {
    vivo: e.ultimoOk > e.ultimoFallo,
    decisiones: e.ok,
    fallos: e.fallos,
    fallosSeguidos: e.fallosSeguidos,
    ultimoOk: iso(e.ultimoOk),
    ultimoFallo: iso(e.ultimoFallo),
    ultimoMotivo: e.ultimoMotivo,
    enPausaHasta: e.pausadoHasta > Date.now() ? iso(e.pausadoHasta) : null,
    msMediana: ts.length ? ts[Math.floor(ts.length / 2)] : null,
    msMax: ts.length ? ts[ts.length - 1] : null,
  };
}

export function estadoLaya() {
  return {
    configurado: layaConfigurado(),
    esperaMs: espera(),
    ...resumen(estado),
    /** Los modelos de /v1 (mensaje, documento) que este proceso ya consultó. */
    modelos: Object.fromEntries([...estadosModelo].map(([k, e]) => [k, resumen(e)])),
  };
}

/**
 * Sonda de /salud (pública en el nodo; no lleva la clave). Sirve a /api/electrum/salud y, de paso,
 * deja la conexión abierta para el próximo turno. No toca la pausa: una sonda no es un turno.
 */
export async function saludLaya(esperaMs = 2000): Promise<{ ok: boolean; status: number; ms: number; umbral?: number; entrenado?: string }> {
  const base = url();
  if (!base) return { ok: false, status: 0, ms: 0 };
  const t0 = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), esperaMs);
  try {
    const r = await fetch(`${base}/salud`, { signal: ctrl.signal, dispatcher: conexion } as RequestInit);
    const j: any = await r.json().catch(() => null);
    return { ok: r.ok && j?.ok === true, status: r.status, ms: Date.now() - t0, umbral: j?.umbral, entrenado: j?.entrenado };
  } catch {
    return { ok: false, status: 0, ms: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}

/* ------------------------------------------------------------ modelos /v1 */

/**
 * Los otros modelos del mismo servicio (scripts/nodo-t4/laya/modelos): `mensaje` decide sobre cada
 * mensaje que llega a AU-RA o a PULSE2CHAT (¿hace falta el modelo grande?, riesgo, ataque, urgencia,
 * moderación, ánimo, tipo de tarea); `documento` dice qué es un expediente y qué trae.
 *
 * El recorte es el mismo que aplica el nodo a cada modelo: así lo que viaja cabe en el cuerpo (16 KB
 * uno, 64 KB un lote) y lo medido allá es lo que se manda desde aquí.
 */
export type ModeloLaya = 'mensaje' | 'documento';
export const RECORTE_MODELO: Record<ModeloLaya, [number, number]> = { mensaje: [CABEZA, COLA], documento: [CABEZA, COLA] };
/** Lo que devuelve el nodo por cada texto. */
export type RespuestaModelo = {
  /** P(sí) calibrada de cada pregunta. */
  p: Record<string, number>;
  /** Las que pasan su propio umbral, fuera de los grupos exclusivos. */
  etiquetas: string[];
  /** El ganador de cada grupo exclusivo (`tarea` en mensaje, `tipo` en documento). */
  grupos: Record<string, string>;
  umbrales?: Record<string, number>;
  ms: number;
};
export type ConsultaModelo = { resultado: RespuestaModelo | null; motivo: MotivoLaya; ms: number };
export type ConsultaLote = { resultados: RespuestaModelo[] | null; motivo: MotivoLaya; ms: number };

function esRespuestaModelo(x: any): x is RespuestaModelo {
  return (
    !!x &&
    typeof x.p === 'object' &&
    x.p !== null &&
    Object.values(x.p).every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    Array.isArray(x.etiquetas) &&
    x.etiquetas.every((e: unknown) => typeof e === 'string') &&
    typeof x.grupos === 'object' &&
    x.grupos !== null
  );
}

/** Lo común a una consulta y a un lote: pausa por ruta, tope de tiempo, conexión reutilizada. */
async function postModelo(modelo: ModeloLaya, cuerpo: Record<string, unknown>, esperaMs: number, validar: (j: any) => boolean) {
  const base = url();
  const e = estadoDe(modelo);
  if (!base) return { j: null, motivo: 'sin configurar' as MotivoLaya, ms: 0 };
  if (Date.now() < e.pausadoHasta) return { j: null, motivo: 'en pausa' as MotivoLaya, ms: 0 };
  const t0 = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), esperaMs);
  try {
    const r = await fetch(`${base}/v1/${modelo}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(clave() ? { authorization: `Bearer ${clave()}` } : {}) },
      body: JSON.stringify(cuerpo),
      signal: ctrl.signal,
      dispatcher: conexion,
    } as RequestInit);
    if (!r.ok) {
      await r.body?.cancel().catch(() => {});
      const motivo: MotivoLaya = `http ${r.status}`;
      fallar(motivo, e);
      return { j: null, motivo, ms: Date.now() - t0 };
    }
    const j = await r.json().catch(() => null);
    if (!validar(j)) {
      fallar('respuesta rara', e);
      return { j: null, motivo: 'respuesta rara' as MotivoLaya, ms: Date.now() - t0 };
    }
    const ms = Date.now() - t0;
    acertar(ms, e);
    return { j, motivo: 'ok' as MotivoLaya, ms };
  } catch {
    const motivo: MotivoLaya = ctrl.signal.aborted ? 'tiempo agotado' : 'red';
    fallar(motivo, e);
    return { j: null, motivo, ms: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Una decisión sobre un texto. `preguntas` pide solo algunas (menos cómputo en el nodo). Nunca
 * lanza: sin Laya, lenta o rota, `resultado` es null y quien llama sigue con sus reglas.
 */
export async function consultarModelo(
  modelo: ModeloLaya,
  texto: string,
  opts: { esperaMs?: number; preguntas?: string[] } = {},
): Promise<ConsultaModelo> {
  const recortado = recortarParaLaya(texto, ...RECORTE_MODELO[modelo]);
  if (!recortado) return { resultado: null, motivo: 'sin texto', ms: 0 };
  const { j, motivo, ms } = await postModelo(
    modelo,
    { texto: recortado, ...(opts.preguntas?.length ? { preguntas: opts.preguntas } : {}) },
    opts.esperaMs ?? espera(),
    esRespuestaModelo,
  );
  return { resultado: j, motivo, ms };
}

/** Hasta 32 textos en una sola ida y vuelta (los fragmentos de un expediente, por ejemplo). */
export async function consultarModeloLote(
  modelo: ModeloLaya,
  textos: string[],
  opts: { esperaMs?: number; preguntas?: string[] } = {},
): Promise<ConsultaLote> {
  const recortados = textos.slice(0, 32).map((t) => recortarParaLaya(t, ...RECORTE_MODELO[modelo])).filter(Boolean);
  if (!recortados.length) return { resultados: null, motivo: 'sin texto', ms: 0 };
  const { j, motivo, ms } = await postModelo(
    modelo,
    { textos: recortados, ...(opts.preguntas?.length ? { preguntas: opts.preguntas } : {}) },
    opts.esperaMs ?? espera(),
    (x) => Array.isArray(x?.resultados) && x.resultados.length === recortados.length && x.resultados.every(esRespuestaModelo),
  );
  return { resultados: j ? j.resultados : null, motivo, ms };
}

/** Solo para las pruebas. */
export function _reiniciarLaya() {
  Object.assign(estado, nuevoEstado());
  estadosModelo.clear();
}
