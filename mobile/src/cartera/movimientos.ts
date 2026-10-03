/**
 * TUS MOVIMIENTOS: lo que entró y salió de tu dirección, leído del explorador de Orden Global (OrdenScan).
 * El RPC de la cadena no sirve para esto (no deja buscar más de 1 000 bloques de una vez); el servidor de
 * OrdenScan ya tiene la lista por dirección: de quién, a quién, cuánto, qué moneda, cuándo y el hash.
 *
 * Solo lectura y pública (cualquiera la ve en ordenscan.com/address/<dirección>). Sin React Native: lo usan
 * la pestaña Veta Wallet y las pruebas (tests/cartera.test.ts) con un `fetch` falso.
 */
import { esDireccion, esHash } from './logica';
import type { Pedidor } from './red';

/** El servidor del explorador (el mismo que usa ordenscan.com). */
export const EXPLORADOR_API = 'https://orden-global-scan-c4abe71e8024.herokuapp.com';
/** La página de una dirección en OrdenScan. */
export const EXPLORADOR_DIRECCION = 'https://ordenscan.com/address/';

export type Movimiento = {
  hash: string;
  /** entrada = te enviaron; salida = enviaste; propio = de ti a ti. */
  tipo: 'entrada' | 'salida' | 'propio';
  /** La otra dirección (la tuya si es propio). */
  otra: string;
  monto: number;
  simbolo: string;
  /** Milisegundos (0 si el explorador no la dio). */
  fecha: number;
  bloque: number;
};

export type Historial = {
  movimientos: Movimiento[];
  /** Nombre de cada moneda según el explorador («AUKA» → «Gold Kapital»). */
  nombres: Record<string, string>;
  /** ¿Hay una identidad de Genesis ID verificada detrás de esta dirección? */
  verificada: boolean;
  leido: number;
};

const minus = (s: unknown) => String(s || '').trim().toLowerCase();

/** La respuesta del explorador → tus movimientos, del más nuevo al más viejo (sin repetidos). */
export function historialDe(j: unknown, mia: string, ahora = Date.now()): Historial {
  const yo = minus(mia);
  const d = (j && typeof j === 'object' ? j : {}) as Record<string, any>;
  const lista: unknown[] = Array.isArray(d.transactions) ? d.transactions : [];
  const vistos = new Set<string>();
  const movimientos: Movimiento[] = [];
  for (const t of lista as Record<string, unknown>[]) {
    if (!t || typeof t !== 'object') continue;
    const hash = minus(t.hash);
    const de = minus(t.from);
    const para = minus(t.to);
    const simbolo = String(t.symbol || '').trim().toUpperCase();
    const monto = Number(t.value);
    if (!esHash(hash) || !esDireccion(de) || !esDireccion(para) || !simbolo || simbolo === 'CONTRACT' || !Number.isFinite(monto) || monto <= 0) continue;
    if (de !== yo && para !== yo) continue;
    const clave = `${hash}:${simbolo}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const tipo = de === yo && para === yo ? 'propio' : de === yo ? 'salida' : 'entrada';
    const seg = Number(t.timestamp);
    movimientos.push({
      hash,
      tipo,
      otra: tipo === 'entrada' ? de : para,
      monto,
      simbolo,
      fecha: Number.isFinite(seg) && seg > 0 ? seg * 1000 : 0,
      bloque: Number(t.blockNumber) || 0,
    });
  }
  movimientos.sort((a, b) => b.bloque - a.bloque || b.fecha - a.fecha);
  const nombres: Record<string, string> = {};
  const tb = d.tokensBalance && typeof d.tokensBalance === 'object' ? (d.tokensBalance as Record<string, any>) : {};
  for (const [sim, v] of Object.entries(tb)) {
    const n = String(v?.name || '').trim();
    if (n && n.toUpperCase() !== sim.toUpperCase()) nombres[sim.toUpperCase()] = n.slice(0, 40);
  }
  return { movimientos, nombres, verificada: !!d.identidad?.verificada, leido: ahora };
}

let cache: { dir: string; en: number; h: Historial } | null = null;
const CACHE_MS = 60_000;

/** Tus movimientos (un minuto en memoria; `forzar` lo vuelve a pedir). */
export async function leerHistorial(direccion: string, o: { forzar?: boolean; pedir?: Pedidor; ahora?: number } = {}): Promise<Historial> {
  const dir = minus(direccion);
  if (!esDireccion(dir)) throw new Error('Esa no es una dirección.');
  const ahora = o.ahora ?? Date.now();
  if (!o.forzar && cache && cache.dir === dir && ahora - cache.en < CACHE_MS) return cache.h;
  const pedir = o.pedir || ((url, init) => (globalThis as any).fetch(url, init));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await pedir(`${EXPLORADOR_API}/address/${encodeURIComponent(dir)}`, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`OrdenScan no contestó (${r.status}).`);
    const h = historialDe(await r.json(), dir, ahora);
    cache = { dir, en: ahora, h };
    return h;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('OrdenScan no contestó a tiempo.');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export function _olvidarHistorial() {
  cache = null;
}

/** Cuánto vale cada moneda en el total (para la barra de distribución): las 4 mayores y «otras». */
export function distribucion(saldos: readonly { simbolo: string; usd: number | null }[], maximo = 4): { simbolo: string; parte: number }[] {
  const con = saldos.filter((s) => (s.usd ?? 0) > 0).sort((a, b) => (b.usd as number) - (a.usd as number));
  const total = con.reduce((a, s) => a + (s.usd as number), 0);
  if (!total) return [];
  const top = con.slice(0, maximo).map((s) => ({ simbolo: s.simbolo, parte: (s.usd as number) / total }));
  const resto = con.slice(maximo).reduce((a, s) => a + (s.usd as number), 0);
  if (resto > 0) top.push({ simbolo: 'OTRAS', parte: resto / total });
  return top;
}
