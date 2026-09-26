/**
 * Cliente de Laya, el modelo de decisiones que corre en el nodo T4 (scripts/nodo-t4/laya).
 *
 * Laya no escribe: contesta preguntas cerradas con una probabilidad calibrada, en decenas de
 * milisegundos. Hoy decide qué especialistas convoca Dr Electrum. Si el nodo no está configurado,
 * tarda o falla, esto devuelve null y quien llama sigue con su regla de siempre: Laya nunca es el
 * motivo de que un turno se caiga.
 */
const url = () => (process.env.ULTRON_LAYA_URL || '').replace(/\/$/, '');
const clave = () => process.env.ULTRON_LAYA_CLAVE || '';
const espera = () => Number(process.env.ULTRON_LAYA_TIMEOUT_MS) || 800;

/** Tras un fallo no se vuelve a intentar durante este rato: un nodo caído no suma su espera a cada turno. */
const PAUSA_TRAS_FALLO_MS = 60_000;
let pausadoHasta = 0;

export type DecisionLaya = { panel: string[]; p: Record<string, number>; umbral: number; ms: number };

export function layaConfigurado() {
  return !!url();
}

export async function decidirLaya(texto: string, esperaMs = espera()): Promise<DecisionLaya | null> {
  const base = url();
  if (!base || !texto.trim() || Date.now() < pausadoHasta) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), esperaMs);
  try {
    const r = await fetch(`${base}/decidir`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(clave() ? { authorization: `Bearer ${clave()}` } : {}) },
      body: JSON.stringify({ texto: texto.slice(0, 2000) }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`laya ${r.status}`);
    const j = (await r.json()) as DecisionLaya;
    if (!Array.isArray(j?.panel)) throw new Error('laya: respuesta sin panel');
    return j;
  } catch {
    pausadoHasta = Date.now() + PAUSA_TRAS_FALLO_MS;
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Solo para las pruebas. */
export function _reiniciarLaya() {
  pausadoHasta = 0;
}
