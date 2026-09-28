/**
 * Acceso al nodo Qwen (cerebro). Único sitio que conoce su URL, su secreto y su TLS autofirmado.
 * Todo lo que hable con el 27B (turno, calentado, salud, centinela) pasa por aquí.
 */
import { Agent as UndiciAgent } from 'undici';

export const NODO_URL = (process.env.ULTRON_NODO_URL || process.env.QWEN_ENDPOINT_URL || '').replace(/\/$/, '');
export const NODO_SECRETO = process.env.ULTRON_NODO_SECRETO || '';
export const NODO_MODELO = process.env.ULTRON_NODO_MODELO || 'orcarouter/Qwen3.8-27B-Uncensored';

/** Certificado autofirmado del nodo: se acepta SOLO para ese host, nunca en global. */
const dispatcher =
  process.env.ULTRON_NODO_INSECURE_TLS === '1' && /^https:/i.test(NODO_URL)
    ? new UndiciAgent({ connect: { rejectUnauthorized: false } })
    : undefined;

export function fetchNodo(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...(init as any), dispatcher } as RequestInit);
}

export function nodoConfigurado() {
  return !!(NODO_URL && NODO_SECRETO);
}

/** Sonda de salud del nodo. */
export async function saludNodo(timeoutMs = 4000): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  if (!NODO_URL) return { ok: false, status: 0, json: null, text: 'ULTRON_NODO_URL vacío' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchNodo(`${NODO_URL}/salud`, { headers: { 'x-ultron-secreto': NODO_SECRETO }, signal: ctrl.signal });
    const text = await r.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* raw */
    }
    return { ok: r.ok || r.status === 401, status: r.status, json, text: text.slice(0, 160) };
  } catch (e: any) {
    return { ok: false, status: 0, json: null, text: String(e?.message || e).slice(0, 160) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * El vigía del nodo (scripts/nodo-a10g/vigia) levanta solo lo que se cae y aprende qué lo cura. A la
 * pantalla le llega en cifras: sin nombres de servicios ni puertos, que son del nodo.
 */
export function autocuraDe(v: any, ahora = Date.now()) {
  if (!v || typeof v !== 'object' || !Number.isFinite(v.actualizado)) return null;
  const ultimo = v.ultimo && Number.isFinite(v.ultimo.inicio) ? v.ultimo : null;
  return {
    activa: ahora / 1000 - v.actualizado < 300,
    sano: v.sano === true,
    resueltas24h: Number(v.incidentes_24h) || 0,
    prevenidas24h: Number(v.prevenidos_24h) || 0,
    aprendidas: v.aprendido && typeof v.aprendido === 'object' ? Object.keys(v.aprendido).length : 0,
    ultima: ultimo ? { hace_s: Math.max(0, Math.round(ahora / 1000 - ultimo.inicio)), duro_s: Math.round(Number(ultimo.duracion) || 0), sola: ultimo.resuelto === 'solo' } : null,
  };
}
