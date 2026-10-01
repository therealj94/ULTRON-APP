/**
 * Acceso al nodo Qwen (cerebro). Único sitio que conoce su URL, su secreto y su TLS autofirmado.
 * Todo lo que hable con el 27B (turno, calentado, salud, centinela) pasa por aquí.
 */
import { createHash } from 'node:crypto';
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

const precalentados = new Map<string, number>();

/**
 * Deja LEÍDO en el nodo el system de un turno (POST /api/precalentar del motor → ollama-proxy-ndjson.py).
 * El llama-server del A10G (Qwen3.8 con draft-mtp) solo reutiliza lo ya leído desde un checkpoint, y el
 * checkpoint queda al final de cada prompt: después de un turno queda tras el mensaje de la persona, y el
 * turno siguiente (que difiere justo ahí) releía las ~6 000 fichas del system: 6,5 s antes de la primera
 * palabra. Con el system solo, el checkpoint queda donde termina y el turno siguiente lee solo lo nuevo
 * (medido el 1-oct: 0,4–0,6 s). Cuesta ~0,2 s si ya estaba leído. Nunca lanza.
 *
 * Se usa al TIMBRAR la llamada (server.ts calentarCerebro), en el espacio de la persona y con su último
 * historial: así el primer turno lee solo lo nuevo. Después de un turno NO: con el espacio fijo de cada
 * persona (lib/espacio-nodo.ts), ese espacio ya guarda todo lo leído, y dejarle solo el system recortaba
 * el historial (el turno siguiente lo releía entero).
 */
export async function precalentarSistema(
  system: string,
  minimoMs = 0,
  /**
   * `espacio`: el de la persona en el nodo (lib/espacio-nodo.ts), para que quede leído donde caerán sus
   * turnos. `mensajes`: el historial que va después del system; si viene, queda leído también, y el turno
   * siguiente solo lee lo nuevo.
   */
  o: { espacio?: number; mensajes?: { role: string; content: string }[] } = {}
): Promise<{ ok: boolean; leidas?: number; reusadas?: number; ms?: number } | null> {
  if (!nodoConfigurado() || !system) return null;
  const huella = createHash('sha1').update(system).update(String(o.espacio ?? '')).update(JSON.stringify(o.mensajes || [])).digest('hex');
  const ahora = Date.now();
  if (minimoMs > 0 && ahora - (precalentados.get(huella) ?? 0) < minimoMs) return null;
  precalentados.set(huella, ahora);
  if (precalentados.size > 200) precalentados.delete(precalentados.keys().next().value as string);
  try {
    const r = await fetchNodo(`${NODO_URL}/api/precalentar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ultron-secreto': NODO_SECRETO },
      body: JSON.stringify({ system, ...(o.mensajes?.length ? { mensajes: o.mensajes } : {}), ...(Number.isInteger(o.espacio) ? { id_slot: o.espacio } : {}) }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) return { ok: false };
    return (await r.json()) as { ok: boolean; leidas?: number; reusadas?: number; ms?: number };
  } catch {
    return null;
  }
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
    necesitaPersona: Array.isArray(v.necesita_persona) && v.necesita_persona.length > 0,
    ultima: ultimo ? { hace_s: Math.max(0, Math.round(ahora / 1000 - ultimo.inicio)), duro_s: Math.round(Number(ultimo.duracion) || 0), sola: ultimo.resuelto === 'solo' } : null,
  };
}
