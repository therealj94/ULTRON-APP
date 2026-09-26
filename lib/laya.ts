/**
 * Cliente de Laya, el modelo de decisiones que corre en el nodo T4 (scripts/nodo-t4/laya).
 *
 * Laya no escribe: contesta preguntas cerradas con una probabilidad calibrada, en decenas de
 * milisegundos. Hoy decide qué especialistas convoca Dr Electrum. Si el nodo no está configurado,
 * tarda o falla, esto devuelve null y quien llama sigue con su regla de siempre: Laya nunca es el
 * motivo de que un turno se caiga.
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
export function recortarParaLaya(texto: string): string {
  // Por puntos de código, no por unidades UTF-16: partir un emoji por la mitad deja un sustituto
  // suelto que el tokenizador del nodo no acepta (medido: 502 y un turno en pausa).
  const s = [...String(texto || '').replace(SUELTO, '\uFFFD').trim()];
  if (s.length <= CABEZA + COLA) return s.join('');
  return `${s.slice(0, CABEZA).join('').trimEnd()} … ${s.slice(-COLA).join('').trimStart()}`;
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

const estado = {
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

export function layaConfigurado() {
  return !!url();
}

function fallar(motivo: MotivoLaya) {
  estado.fallos++;
  estado.fallosSeguidos++;
  estado.ultimoFallo = Date.now();
  estado.ultimoMotivo = motivo;
  estado.pausadoHasta = Date.now() + Math.min(PAUSA_MAX_MS, PAUSA_MIN_MS * 2 ** (estado.fallosSeguidos - 1));
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
    estado.ok++;
    estado.fallosSeguidos = 0;
    estado.ultimoOk = Date.now();
    estado.tiempos = [...estado.tiempos.slice(-49), ms];
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
export function estadoLaya() {
  const ts = [...estado.tiempos].sort((a, b) => a - b);
  const iso = (n: number) => (n ? new Date(n).toISOString() : null);
  return {
    configurado: layaConfigurado(),
    vivo: estado.ultimoOk > estado.ultimoFallo,
    esperaMs: espera(),
    decisiones: estado.ok,
    fallos: estado.fallos,
    fallosSeguidos: estado.fallosSeguidos,
    ultimoOk: iso(estado.ultimoOk),
    ultimoFallo: iso(estado.ultimoFallo),
    ultimoMotivo: estado.ultimoMotivo,
    enPausaHasta: estado.pausadoHasta > Date.now() ? iso(estado.pausadoHasta) : null,
    msMediana: ts.length ? ts[Math.floor(ts.length / 2)] : null,
    msMax: ts.length ? ts[ts.length - 1] : null,
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

/** Solo para las pruebas. */
export function _reiniciarLaya() {
  Object.assign(estado, { fallosSeguidos: 0, pausadoHasta: 0, ok: 0, fallos: 0, ultimoOk: 0, ultimoFallo: 0, ultimoMotivo: null, tiempos: [] });
}
