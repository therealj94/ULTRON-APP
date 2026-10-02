/**
 * LA CARTERA DE VETA WALLET, LO PURO (sin React Native ni red): lo comparten la app (cartera/*.tsx), el
 * servidor (lib/cartera.ts, la herramienta `cartera` de AURA) y las pruebas en node (tests/cartera.test.ts).
 *
 * Es el mismo modelo de AURA para Windows (windows/src/Aura.Windows.Core/Cartera.cs y
 * windows/centro/src/pulse/pagar.ts), y sus reglas no cambian:
 *
 *   · AURA NUNCA MUEVE DINERO ni pide ni guarda contraseñas. Aquí no hay llaves ni firmas: solo se LEE la
 *     cadena de Orden Global (5550) con la dirección PÚBLICA de la persona.
 *   · La dirección del destinatario sale de su ficha en PULSE2CHAT (`/ficha`, campo `addr`), nunca de algo
 *     escrito a mano: ahí es donde la gente se equivoca y pierde el dinero.
 *   · El envío se firma en Veta Wallet (la app o la web) con la contraseña de la persona. AURA solo abre el
 *     envío ya llenado (`enlaceApp` / `enlaceWeb`) y después MIRA la cadena (`buscarEnvio`) hasta verlo;
 *     recién entonces se publica el comprobante en el hilo (el relevo lo vuelve a comprobar).
 *   · Si no se pudo leer, no se contesta: un saldo que no se pudo leer es `null` («no lo pude leer»),
 *     nunca un cero tranquilizador (la misma regla de veta-wallet-backend/lib/saldos.js).
 */

export const RPC = 'https://rpc.ordenglobal-rpc.com/';
export const CADENA_ID = 5550;
/** El explorador de la cadena: un comprobante enlaza aquí (no pide que se confíe en nadie). */
export const EXPLORADOR_TX = 'https://ordenscan.com/tx/';
/** La web de Veta Wallet: acepta `#pagar?a=…&m=…&s=…` (lo usa AURA para Windows). */
export const WALLET_WEB = 'https://app.vetawallet.com/';
/** El esquema de la app de la wallet en el teléfono (ya atiende `vetawallet://sso` y `vetawallet://genesis`). */
export const ESQUEMA_WALLET = 'vetawallet://';
/** A dónde vuelve la wallet después de firmar (la única vuelta que acepta para un pago de AU-RA). */
export const VUELTA_PAGO = 'ultronfp://pago';
const GRAMOS_ONZA = 31.1035;

export type Token = { simbolo: string; contrato: string | null };

/** Los tokens de la red, los mismos de Veta Wallet y de Cartera.cs (18 decimales). ORIGEN es el nativo. */
export const TOKENS: readonly Token[] = [
  { simbolo: 'ORIGEN', contrato: null },
  { simbolo: 'AUKA', contrato: '0x6Facc8Df79cEDc6C5065442ce27e915Aa3a26B9B' },
  { simbolo: 'AGKA', contrato: '0x961f798f998c7Ff44D47d62C7FA1B572eF187a4B' },
  { simbolo: 'ONDK', contrato: '0xfb83eEA4B384a4b18E5A1EBa7a4bb4C0b7CA19c1' },
  { simbolo: 'MNKA', contrato: '0x18b6680CFF71c11067bec312Fc48786bE2e54Ead' },
  { simbolo: 'IBS', contrato: '0x7AF11D3E94A174f6fc290A5B7791A6DEE2718E62' },
  { simbolo: 'HARV', contrato: '0x0fa04D11F28B28cbC9b98dd016F02023AdDb1923' },
  { simbolo: 'AUBEX', contrato: '0xF1498640B27A66C0DC505093D70911C060e04fb0' },
  { simbolo: 'ASL', contrato: '0x69846aC960D45F9946C613DFCe1b761D37Faf098' },
  { simbolo: 'LOVE', contrato: '0x638F2ba0e3E1083D1ba570b449BD266F3860D164' },
  { simbolo: 'REST', contrato: '0x1aC12Ebd7739003059d1E9EA2a4863C92D1505DD' },
  { simbolo: 'SOL', contrato: '0xAAc6aE2E2037fC2e94d0b060792E7eB4E5fBfa66' },
  { simbolo: 'AIT', contrato: '0xAE14Db486872AC07d74Ad69cC09590239b21BA2e' },
  { simbolo: 'AGRO', contrato: '0x2A31ba919A5339fCB0F8aEeFfCE2c807B16007fe' },
  { simbolo: 'POLITICAL', contrato: '0x92496E1848e001428A3495409a9A9f616bB6dD3B' },
];

/** Las monedas que se pueden mandar (las de la red, en el orden de la wallet). */
export const MONEDAS: readonly string[] = TOKENS.map((t) => t.simbolo);

/** Los precios fijos de referencia que usa la wallet para los tokens del ecosistema (Cartera.cs). */
export const PRECIOS_FIJOS: Readonly<Record<string, number>> = {
  AGRO: 13.13,
  AIT: 5.32,
  SOL: 0.75,
  REST: 8.57,
  LOVE: 0.1,
  POLITICAL: 0.33,
  ASL: 2.328,
  AUBEX: 10,
  HARV: 0.75,
  IBS: 1.2,
};

const DIRECCION = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

export function esDireccion(d: unknown): d is string {
  return typeof d === 'string' && DIRECCION.test(d.trim());
}

export function esHash(h: unknown): h is string {
  return typeof h === 'string' && HASH.test(h.trim());
}

/** La dirección limpia (0x + 40), o null. «No es una dirección» nunca se adivina. */
export function direccionValida(d: unknown): string | null {
  const t = String(d ?? '').trim();
  return DIRECCION.test(t) ? t : null;
}

/** La dirección de Veta Wallet de una ficha de PULSE2CHAT (`addr`, o `direccion` en fichas viejas), o null. */
export function direccionDeFicha(f: unknown): string | null {
  if (!f || typeof f !== 'object') return null;
  const o = f as Record<string, unknown>;
  return direccionValida(o.addr) || direccionValida(o.direccion);
}

/** «0x6Facc8…3a26B9B»: lo bastante para reconocerla, sin llenar la pantalla. */
export function cortar(d: string): string {
  const t = String(d || '').trim();
  return t.length > 16 ? `${t.slice(0, 8)}…${t.slice(-6)}` : t;
}

/** El símbolo tal cual lo usa la red («origen» → «ORIGEN»), o null si no es de la red. */
export function simbolo(s: unknown): string | null {
  const t = String(s ?? '')
    .trim()
    .toUpperCase();
  if (t === 'ORIGENES') return 'ORIGEN';
  return MONEDAS.includes(t) ? t : null;
}

export function tokenDe(sim: string): Token | null {
  return TOKENS.find((t) => t.simbolo === sim) || null;
}

/* ── la cantidad ──────────────────────────────────────────────────────────────────────────── */

/**
 * Una cantidad escrita o dicha («10», «2.5», «2,5», «1,000», «1,000.50») → texto canónico con punto
 * («2.5», «1000», «1000.5»), o null si no es mayor que cero o tiene más de 18 decimales. La misma regla que
 * Cartera.cs `Monto`: una coma seguida de grupos de tres cifras (y sin punto) es de miles; si no, es el
 * decimal. Se trabaja con TEXTO, nunca con flotantes: la cantidad que se firma es exactamente esta.
 */
export function montoValido(s: unknown): string | null {
  let t = String(s ?? '')
    .trim()
    .replace(/\s/g, '');
  if (!/^\d{1,15}(?:[.,]\d{1,18})*$/.test(t)) return null;
  if (t.includes(',') && !t.includes('.')) t = /^\d{1,3}(?:,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  else t = t.replace(/,/g, '');
  if ((t.match(/\./g) || []).length > 1 || /,/.test(t)) return null;
  const [entRaw, fracRaw = ''] = t.split('.');
  if (fracRaw.length > 18) return null;
  const ent = entRaw.replace(/^0+(?=\d)/, '');
  const frac = fracRaw.replace(/0+$/, '');
  if (ent.length > 15) return null;
  if (/^0*$/.test(ent) && !frac) return null;
  return frac ? `${ent || '0'}.${frac}` : ent;
}

const DIEZ18 = BigInt('1000000000000000000');

/** La cantidad canónica en la unidad mínima de la cadena (18 decimales), exacta. */
export function aWei(monto: string): bigint {
  const m = montoValido(monto);
  if (!m) throw new Error('cantidad inválida');
  const [ent, frac = ''] = m.split('.');
  return BigInt(ent) * DIEZ18 + BigInt((frac + '000000000000000000').slice(0, 18));
}

function bigDeHex(h: unknown): bigint | null {
  if (typeof h !== 'string') return null;
  const x = h.startsWith('0x') || h.startsWith('0X') ? h.slice(2) : h;
  if (x.length === 0) return BigInt(0);
  if (x.length > 64 || !/^[0-9a-fA-F]+$/.test(x)) return null;
  return BigInt('0x' + x);
}

/** Un número hexadecimal de la cadena («0x1bc16d674ec80000», 18 decimales) → cantidad, o null si no se entiende. */
export function cantidadDeHex(hex: unknown, decimales = 18): number | null {
  const v = bigDeHex(hex);
  if (v == null) return null;
  const div = BigInt(10) ** BigInt(decimales);
  return Number(v / div) + Number(v % div) / Number(div);
}

/** El número de bloque de una respuesta hex («0x4fa4f»), o 0. */
export function bloqueDeHex(hex: unknown): number {
  const v = bigDeHex(hex);
  return v == null ? 0 : Number(v);
}

/* ── los saldos (lectura por RPC) ─────────────────────────────────────────────────────────── */

export type LlamadaRpc = { jsonrpc: '2.0'; id: number; method: string; params: unknown[] };

/** La llamada balanceOf(address): selector 0x70a08231 + la dirección rellenada a 32 bytes. */
export function datosBalanceOf(direccion: string): string {
  return '0x70a08231' + direccion.trim().slice(2).toLowerCase().padStart(64, '0');
}

/** El lote JSON-RPC: el saldo nativo (ORIGEN) y el balanceOf de cada token. El id es el índice del token. */
export function armarLote(direccion: string): LlamadaRpc[] {
  if (!esDireccion(direccion)) throw new Error('dirección inválida');
  const d = direccion.trim();
  return TOKENS.map((t, i) =>
    t.contrato == null
      ? { jsonrpc: '2.0', id: i, method: 'eth_getBalance', params: [d, 'latest'] }
      : { jsonrpc: '2.0', id: i, method: 'eth_call', params: [{ to: t.contrato, data: datosBalanceOf(d) }, 'latest'] },
  );
}

/** La respuesta de un lote JSON-RPC → hex por id. Las que vinieron con error quedan FUERA (no son cero). */
export function leerLote(respuesta: unknown): Map<number, string> {
  const r = new Map<number, string>();
  const items = Array.isArray(respuesta) ? respuesta : [respuesta];
  for (const e of items) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id === 'number' && typeof o.result === 'string' && !o.error) r.set(o.id, o.result);
  }
  return r;
}

/** Precio de un token en USD (Cartera.cs): ORIGEN = oro por gramo ÷ 55; AUKA = onza de oro; AGKA = onza de plata; fijos; si no, null. */
export function precio(sim: string, oroOnza: number | null, plataOnza: number | null): number | null {
  if (sim === 'ORIGEN') return oroOnza && oroOnza > 0 ? oroOnza / GRAMOS_ONZA / 55 : null;
  if (sim === 'AUKA') return oroOnza && oroOnza > 0 ? oroOnza : null;
  if (sim === 'AGKA') return plataOnza && plataOnza > 0 ? plataOnza : null;
  return PRECIOS_FIJOS[sim] ?? null;
}

/** Un saldo: cuánto hay (`null` = no se pudo leer), su precio (`null` = sin precio real) y su valor. */
export type Saldo = { simbolo: string; cantidad: number | null; precio: number | null; usd: number | null };

export function saldosDe(hexes: Map<number, string>, oroOnza: number | null, plataOnza: number | null): Saldo[] {
  return TOKENS.map((t, i) => {
    const cantidad = hexes.has(i) ? cantidadDeHex(hexes.get(i)) : null;
    const p = precio(t.simbolo, oroOnza, plataOnza);
    return { simbolo: t.simbolo, cantidad, precio: p, usd: cantidad != null && p != null ? Math.round(cantidad * p * 100) / 100 : null };
  });
}

/** El valor total aproximado (solo lo que tiene precio y se pudo leer). */
export function totalUsd(saldos: Saldo[]): number {
  return Math.round(saldos.reduce((s, x) => s + (x.usd ?? 0), 0) * 100) / 100;
}

/** El precio de CoinGecko (pax-gold = onza de oro, kinesis-silver = onza de plata), o null por moneda. */
export function preciosDe(j: unknown): { oro: number | null; plata: number | null } {
  const leer = (id: string) => {
    const v = (j as any)?.[id]?.usd;
    return typeof v === 'number' && v > 0 ? v : null;
  };
  return { oro: leer('pax-gold'), plata: leer('kinesis-silver') };
}

export const URL_PRECIOS = 'https://api.coingecko.com/api/v3/simple/price?ids=pax-gold,kinesis-silver&vs_currencies=usd';

/* ── decirlo ──────────────────────────────────────────────────────────────────────────────── */

type Idioma = 'es' | 'en';

/** «1,520.4» / «0.0123»: con miles, y pocos decimales donde no hacen falta. */
export function num(n: number, idioma: Idioma = 'es'): string {
  const max = n >= 1000 ? 0 : n >= 1 ? 2 : 4;
  try {
    return n.toLocaleString(idioma === 'en' ? 'en-US' : 'es-HN', { maximumFractionDigits: max });
  } catch {
    return String(Math.round(n * 10 ** max) / 10 ** max);
  }
}

/**
 * Cómo se dice: «Tienes unos 1,321 dólares: 1,520.4 ORIGEN, 0.12 AUKA.» o, con un token,
 * «Tienes 1,520.4 ORIGEN (unos 3,900 dólares).». Lo que no se pudo leer se dice, no se calla.
 */
export function decirSaldos(saldos: Saldo[], solo: string | null = null, idioma: Idioma = 'es'): string {
  const en = idioma === 'en';
  const sinLeer = saldos.filter((s) => s.cantidad == null).map((s) => s.simbolo);
  if (solo) {
    const sim = simbolo(solo);
    const s = sim ? saldos.find((x) => x.simbolo === sim) : null;
    if (!s) return en ? `I don't know the token ${solo}.` : `No conozco el token ${solo}.`;
    if (s.cantidad == null) return en ? `I couldn't read your ${s.simbolo} balance right now.` : `Ahora mismo no pude leer tu saldo de ${s.simbolo}.`;
    const valor = s.usd && s.usd > 0 ? (en ? ` (about ${num(s.usd, idioma)} dollars)` : ` (unos ${num(s.usd, idioma)} dólares)`) : '';
    return en ? `You have ${num(s.cantidad, idioma)} ${s.simbolo}${valor}.` : `Tienes ${num(s.cantidad, idioma)} ${s.simbolo}${valor}.`;
  }
  if (sinLeer.length === saldos.length) return en ? "I couldn't read your wallet right now." : 'Ahora mismo no pude leer tu cartera.';
  const con = saldos.filter((x) => (x.cantidad ?? 0) > 0).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
  const nota = sinLeer.length ? (en ? ` (I couldn't read ${sinLeer.join(', ')}.)` : ` (No pude leer ${sinLeer.join(', ')}.)`) : '';
  if (!con.length) return (en ? 'Your wallet is at zero.' : 'Tu cartera está en cero.') + nota;
  const total = totalUsd(con);
  const partes = con.slice(0, 4).map((x) => `${num(x.cantidad as number, idioma)} ${x.simbolo}`);
  const mas = con.length > 4 ? (en ? ` and ${con.length - 4} more` : ` y ${con.length - 4} más`) : '';
  const cabeza = total > 0 ? (en ? `You have about ${num(total, idioma)} dollars: ` : `Tienes unos ${num(total, idioma)} dólares: `) : en ? 'You have ' : 'Tienes ';
  return `${cabeza}${partes.join(', ')}${mas}.${nota}`;
}

/* ── enviar: AURA prepara, Veta Wallet firma ──────────────────────────────────────────────── */

export type Envio = { direccion: string; monto: string; simbolo: string };

function partesEnvio(e: Envio): { a: string; m: string; s: string } {
  const a = direccionValida(e.direccion);
  if (!a) throw new Error('Esa persona no tiene una dirección de Veta Wallet válida.');
  const m = montoValido(e.monto);
  if (!m) throw new Error('La cantidad no es válida.');
  const s = simbolo(e.simbolo);
  if (!s) throw new Error(`No conozco la moneda ${e.simbolo}.`);
  return { a, m, s };
}

/**
 * El envío ya llenado en la app Veta Wallet del teléfono: `vetawallet://pagar?a=…&m=…&s=…&vuelta=ultronfp://pago`.
 * Allá se revisa y se firma con la contraseña; si no se confirma, no pasa nada.
 */
export function enlaceApp(e: Envio, vuelta: string | null = VUELTA_PAGO): string {
  const { a, m, s } = partesEnvio(e);
  return `${ESQUEMA_WALLET}pagar?a=${a}&m=${encodeURIComponent(m)}&s=${encodeURIComponent(s)}${vuelta ? `&vuelta=${encodeURIComponent(vuelta)}` : ''}`;
}

/** El mismo envío en la web de Veta Wallet (el enlace de Cartera.cs `EnlacePagar`, idéntico). */
export function enlaceWeb(e: Envio): string {
  const { a, m, s } = partesEnvio(e);
  return `${WALLET_WEB}#pagar?a=${a}&m=${encodeURIComponent(m)}&s=${encodeURIComponent(s)}`;
}

/**
 * Lee un enlace de pago (el de la app o el de la web) → el envío, o null si algo no cuadra. Lo usa la wallet
 * para llenar su pantalla de Enviar (apps/veta-wallet-mobile/src/enlacePagar.js lleva la misma regla) y las
 * pruebas para comprobar que lo que se arma se lee igual.
 */
export function leerEnlacePagar(url: unknown): (Envio & { vuelta: string | null }) | null {
  const u = String(url ?? '').trim();
  let q = '';
  if (u.toLowerCase().startsWith(ESQUEMA_WALLET + 'pagar')) {
    const resto = u.slice((ESQUEMA_WALLET + 'pagar').length);
    if (resto && resto[0] !== '?' && resto[0] !== '/') return null;
    q = resto.includes('?') ? resto.slice(resto.indexOf('?') + 1) : '';
  } else if (u.startsWith(WALLET_WEB + '#pagar')) {
    const resto = u.slice((WALLET_WEB + '#pagar').length);
    if (resto && resto[0] !== '?') return null;
    q = resto.slice(1);
  } else return null;
  const p: Record<string, string> = {};
  for (const par of q.split('#')[0].split('&')) {
    if (!par) continue;
    const i = par.indexOf('=');
    try {
      p[decodeURIComponent(i < 0 ? par : par.slice(0, i))] = i < 0 ? '' : decodeURIComponent(par.slice(i + 1));
    } catch {
      return null;
    }
  }
  const direccion = direccionValida(p.a);
  const monto = montoValido(p.m);
  const sim = simbolo(p.s);
  if (!direccion || !monto || !sim) return null;
  // La vuelta solo puede ser la de AU-RA: el parámetro no sirve para mandar a la persona a otro sitio.
  const vuelta = p.vuelta === VUELTA_PAGO ? VUELTA_PAGO : null;
  return { direccion, monto, simbolo: sim, vuelta };
}

/** La llamada transfer(para, cantidad) de un token, como viaja en el `input` de la transacción. */
export function datosTransfer(para: string, wei: bigint): string {
  return '0xa9059cbb' + para.trim().slice(2).toLowerCase().padStart(64, '0') + wei.toString(16).padStart(64, '0');
}

export type Busqueda = { desde: string; para: string; simbolo: string; monto: string };

/** ¿Esta transacción es exactamente el envío buscado? (ORIGEN: nativo con `value`; token: transfer al contrato). */
export function esElEnvio(tx: unknown, b: Busqueda): boolean {
  if (!tx || typeof tx !== 'object') return false;
  const sim = simbolo(b.simbolo);
  const de = direccionValida(b.desde);
  const para = direccionValida(b.para);
  const m = montoValido(b.monto);
  if (!sim || !de || !para || !m) return false;
  const t = tx as Record<string, unknown>;
  const campo = (k: string) => (typeof t[k] === 'string' ? (t[k] as string).toLowerCase() : '');
  if (campo('from') !== de.toLowerCase()) return false;
  const wei = aWei(m);
  const contrato = tokenDe(sim)?.contrato;
  if (contrato == null) return campo('to') === para.toLowerCase() && bigDeHex(campo('value')) === wei;
  return campo('to') === contrato.toLowerCase() && campo('input') === datosTransfer(para, wei);
}

/**
 * Entre los bloques (respuestas de eth_getBlockByNumber con las transacciones completas), el hash del envío
 * de `desde` a `para` por esa cantidad exacta, o null. Para publicar el comprobante DESPUÉS de que pasó.
 */
export function buscarEnvio(bloques: unknown, b: Busqueda): string | null {
  const lista = Array.isArray(bloques) ? bloques : [bloques];
  for (const r of lista) {
    const txs = (r as any)?.result?.transactions;
    if (!Array.isArray(txs)) continue;
    for (const tx of txs) {
      const h = typeof (tx as any)?.hash === 'string' ? (tx as any).hash.toLowerCase() : '';
      if (esHash(h) && esElEnvio(tx, b)) return h;
    }
  }
  return null;
}

/** Las llamadas para leer los bloques [inicio, fin] con sus transacciones. */
export function loteBloques(inicio: number, fin: number): LlamadaRpc[] {
  const l: LlamadaRpc[] = [];
  for (let n = inicio; n <= fin; n++) l.push({ jsonrpc: '2.0', id: n, method: 'eth_getBlockByNumber', params: ['0x' + n.toString(16), true] });
  return l;
}

/**
 * ¿El comprobante dice la verdad? Con la transacción y su recibo (eth_getTransactionByHash /
 * eth_getTransactionReceipt): `ok` si pasó y es ese envío (a esa dirección, esa cantidad, esa moneda),
 * `pendiente` si todavía no está en un bloque, `fallo` si la cadena la rechazó, `no-coincide` si es otra cosa.
 * `desde` es opcional: la tarjeta de quien RECIBE no siempre sabe la dirección de quien manda.
 */
export type Veredicto = 'ok' | 'pendiente' | 'fallo' | 'no-coincide';

export function comprobarTx(tx: unknown, recibo: unknown, b: { para: string; monto: string; simbolo: string; desde?: string | null }): Veredicto {
  if (!tx || typeof tx !== 'object') return 'pendiente';
  const desde = b.desde || (typeof (tx as any).from === 'string' ? (tx as any).from : '');
  if (!esElEnvio(tx, { desde, para: b.para, simbolo: b.simbolo, monto: b.monto })) return 'no-coincide';
  if (!recibo || typeof recibo !== 'object' || !(recibo as any).blockNumber) return 'pendiente';
  const st = (recibo as any).status;
  return st === '0x1' || st === 1 ? 'ok' : st === '0x0' || st === 0 ? 'fallo' : 'pendiente';
}
