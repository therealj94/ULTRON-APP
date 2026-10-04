/**
 * LA CARTERA EN LA RED, SOLO LECTURA: saldos por el RPC de la cadena de Orden Global, precios del oro y la
 * plata (CoinGecko, la misma fuente de la wallet), el último bloque, la búsqueda de un envío y la
 * comprobación de un comprobante. Sin contraseña, sin sesión de la wallet, sin firmar nada.
 *
 * Sin React Native: usa el `fetch` global (el del teléfono o el de Node) o el que se le pase. Lo usan la app
 * (cartera/*.tsx) y el servidor (lib/cartera.ts), y las pruebas con un RPC falso (tests/cartera.test.ts).
 */
import {
  armarLote,
  bloqueDeHex,
  buscarEnvio,
  comprobarTx,
  esDireccion,
  esHash,
  leerLote,
  loteBloques,
  preciosDe,
  RPC,
  saldosDe,
  totalUsd,
  URL_PRECIOS,
  type Busqueda,
  type Saldo,
  type Veredicto,
} from './logica';

export type Pedidor = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const pedidorGlobal: Pedidor = (url, init) => (globalThis as any).fetch(url, init);

/** Una petición con tope de tiempo (un nodo lento no deja la pantalla girando). */
async function conTope(pedir: Pedidor, url: string, init: Parameters<Pedidor>[1], ms: number): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await pedir(url, { ...init, signal: ctrl.signal });
    if (!r.ok) throw new Error(`La red de Orden Global no contestó (${r.status}). Intenta en un momento.`);
    return await r.json();
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('La red de Orden Global no contestó a tiempo. Intenta en un momento.');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export function rpc(cuerpo: unknown, o: { pedir?: Pedidor; ms?: number } = {}): Promise<unknown> {
  return conTope(o.pedir || pedidorGlobal, RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }, o.ms ?? 15_000);
}

/* ── precios (5 min) y saldos (30 s) ──────────────────────────────────────────────────────── */

let precios: { en: number; oro: number | null; plata: number | null } = { en: 0, oro: null, plata: null };

async function leerPrecios(pedir: Pedidor, ahora: number): Promise<{ oro: number | null; plata: number | null }> {
  if (ahora - precios.en < 5 * 60_000) return precios;
  try {
    const p = preciosDe(await conTope(pedir, URL_PRECIOS, { method: 'GET' }, 8_000));
    // Sin precio no se inventa uno: se muestra «sin precio». Pero un precio bueno de antes no se tira.
    precios = { en: ahora, oro: p.oro ?? precios.oro, plata: p.plata ?? precios.plata };
  } catch {
    /* sin precio: «—» */
  }
  return precios;
}

export type Cartera = { direccion: string; saldos: Saldo[]; total: number; leido: number; conPrecio: boolean };

const ultimo = new Map<string, Cartera>();

/** Los saldos de una dirección (con 30 s de caché, salvo `forzar`). Lanza si la red no contestó. */
export async function leerSaldos(direccion: string, o: { forzar?: boolean; pedir?: Pedidor; ahora?: number } = {}): Promise<Cartera> {
  if (!esDireccion(direccion)) throw new Error('Esa no es una dirección de Veta Wallet (0x seguida de 40 letras y números).');
  const d = direccion.trim();
  const ahora = o.ahora ?? Date.now();
  const previo = ultimo.get(d.toLowerCase());
  if (!o.forzar && previo && ahora - previo.leido < 30_000) return previo;
  const pedir = o.pedir || pedidorGlobal;
  const [respuesta, p] = await Promise.all([rpc(armarLote(d), { pedir }), leerPrecios(pedir, ahora)]);
  const hexes = leerLote(respuesta);
  if (!hexes.size) throw new Error('La red de Orden Global no devolvió tus saldos. Intenta en un momento.');
  const saldos = saldosDe(hexes, p.oro, p.plata);
  const c: Cartera = { direccion: d, saldos, total: totalUsd(saldos), leido: ahora, conPrecio: p.oro != null };
  ultimo.set(d.toLowerCase(), c);
  return c;
}

/** Solo pruebas: olvida la caché de saldos y precios. */
export function _olvidarCacheCartera() {
  ultimo.clear();
  precios = { en: 0, oro: null, plata: null };
}

/* ── el envío en la cadena ────────────────────────────────────────────────────────────────── */

/** El último bloque de la cadena (desde dónde empezar a buscar un envío). */
export async function bloqueActual(o: { pedir?: Pedidor } = {}): Promise<number> {
  const r: any = await rpc({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }, o);
  const n = bloqueDeHex(r?.result);
  if (!n) throw new Error('La red de Orden Global no dijo en qué bloque va.');
  return n;
}

/** Bloques que se leen por vuelta. La cadena hace un bloque cada ~10 s: 60 son diez minutos. */
export const BLOQUES_POR_VUELTA = 60;

/**
 * Busca el envío en los bloques desde `inicio` (hasta BLOQUES_POR_VUELTA por vez). Devuelve el hash si ya
 * pasó y el siguiente bloque por mirar. Sin base conocida (`inicio` ≤ 0) se empieza en el último: mirar
 * hacia atrás podría tomar por este un envío viejo igual.
 */
export async function buscarEnvioEnRed(b: Busqueda, inicio: number, o: { pedir?: Pedidor } = {}): Promise<{ hash: string | null; siguiente: number }> {
  const ultimoBloque = await bloqueActual(o);
  let desde = inicio;
  if (desde <= 0 || desde > ultimoBloque + 1) desde = ultimoBloque;
  const fin = Math.min(ultimoBloque, desde + BLOQUES_POR_VUELTA - 1);
  if (fin < desde) return { hash: null, siguiente: desde };
  const r = await rpc(loteBloques(desde, fin), { ...o, ms: 30_000 });
  return { hash: buscarEnvio(r, b), siguiente: fin + 1 };
}

/** Comprueba un comprobante contra la cadena (para la tarjeta del hilo). Lanza si la red no contestó. */
export async function verificarComprobante(hash: string, b: { para: string; monto: string; simbolo: string; desde?: string | null }, o: { pedir?: Pedidor } = {}): Promise<Veredicto> {
  if (!esHash(hash)) return 'no-coincide';
  const r = await rpc(
    [
      { jsonrpc: '2.0', id: 1, method: 'eth_getTransactionByHash', params: [hash] },
      { jsonrpc: '2.0', id: 2, method: 'eth_getTransactionReceipt', params: [hash] },
    ],
    o,
  );
  const lista = Array.isArray(r) ? r : [];
  const de = (id: number) => (lista.find((x: any) => x?.id === id) as any)?.result ?? null;
  return comprobarTx(de(1), de(2), b);
}
