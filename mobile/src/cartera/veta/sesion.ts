/**
 * TU CUENTA DE VETA WALLET DENTRO DE AURA (José, 3-oct: «la tarjeta débito… todo incluido dentro de Veta
 * Wallet, igual como la tenemos nosotros»).
 *
 * La tarjeta Visa es un producto real del backend de Veta Wallet (emitida con CryptoMate): para verla hay que
 * entrar con la cuenta de Veta Wallet, igual que en su app. Este cliente hace lo mismo que
 * veta-wallet-app/src/api.js, sin inventar nada:
 *
 *   · POST /auth/login {email, password} → JWT (vence a los ~40 min) + refreshToken (30 días).
 *   · POST /auth/refresh {refreshToken} → JWT nuevo, sin volver a pedir la contraseña.
 *   · El JWT y el refreshToken viven en el llavero del sistema (expo-secure-store), con llaves PROPIAS de
 *     AURA y de cada dueño en AURA (ver abajo). La contraseña NO se guarda aquí: para no teclearla, se
 *     guarda aparte detrás de la huella o Face ID (veta/desbloqueo.ts), como en Veta Wallet.
 *   · Las operaciones con contraseña (ver número/CVV/PIN, recargar) no se reintentan solas: un 401 ahí es
 *     «contraseña incorrecta», no una sesión vencida (la sesión se renueva ANTES de mandarlas).
 *
 * DE QUIÉN ES LA SESIÓN (auditoría AUR01). En un teléfono compartido la cuenta de AURA cambia con
 * operaciones a medias: un refresh, una recarga o su consulta de A que vuelven cuando ya está B. Antes las
 * llaves eran globales (`aura.veta.token`…: las heredaba quien abriera la pantalla) y un refresh tardío
 * volvía a poner el token de A después de salir. Ahora:
 *   · Las llaves llevan el seudónimo del dueño en AURA (lib/cuenta.ts): `aura.veta.token.u1a2b…`. Las de
 *     antes, sin dueño, no se le asignan a nadie: se borran y se pide entrar otra vez a Veta.
 *   · Cada operación captura su VÍNCULO al empezar —dueño, generación de la cuenta de AURA y cuenta de Veta
 *     (entrar, salir o que el servidor la cierre la cambian)— y lo mira después de cada `await`, antes de
 *     mandar, de guardar y de devolver. Lo de otro vínculo falla con `vencida`: la pantalla no dice nada.
 *   · Salir de AURA (o entrar otra persona) corta en el acto lo que estaba en vuelo y suelta la sesión en
 *     memoria; lo guardado de cada dueño se queda en SU llave para cuando vuelva.
 */
import * as SecureStore from 'expo-secure-store';
import { alCambiarCuenta, generacionCuenta, seudonimoActual, sigueVigente } from '../../lib/cuenta';

export const VETA_API = 'https://vetawallet-1a2e38ac52b1.herokuapp.com';

const LLAVE_TOKEN = 'aura.veta.token';
const LLAVE_REFRESCO = 'aura.veta.refresco';
const LLAVE_CORREO = 'aura.veta.correo';
/** Las de antes del dueño (y la huella de entonces, veta/desbloqueo.ts): no se sabe de quién eran. */
const LLAVES_SIN_DUENO = [LLAVE_TOKEN, LLAVE_REFRESCO, LLAVE_CORREO, 'aura.veta.clave-biometrica', 'aura.veta.clave-biometrica-on'];
/** La llave de un dueño (su seudónimo: el correo no queda en el llavero). */
export const llaveDe = (base: string, dueno: string) => `${base}.${dueno}`;

let token: string | null = null;
let refresco: string | null = null;
let correo: string | null = null;
/** De quién y de qué generación es lo que hay en memoria (null = nada cargado para la de ahora). */
let cargadoPara: { dueno: string; gen: number } | null = null;
/** La cuenta de Veta en memoria: entrar, salir o que el servidor la cierre la cambian. */
let cuentaVeta = 0;
/** Lo que está viajando (para cortarlo al salir) y lo que se cortó a propósito (no es «la red se cayó»). */
const enVuelo = new Set<AbortController>();
const cortadas = new WeakSet<AbortController>();
/** La generación en que ya se descartaron las llaves sin dueño. */
let descartadasEn = -1;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());

export class ErrorVeta extends Error {
  status: number;
  /** red · tiempo · sesion · clave · rechazado · servidor · http · vencida (era de otra sesión: no se dice nada) */
  tipo: string;
  motivo?: string;
  constructor(mensaje: string, status: number, tipo: string, motivo?: string) {
    super(mensaje);
    this.status = status;
    this.tipo = tipo;
    this.motivo = motivo;
  }
}

/** Lo que devuelve quien llegó tarde: su sesión (de AURA o de Veta) ya no es la de ahora. */
const vencidaVeta = () => new ErrorVeta('Esta operación era de otra sesión.', 0, 'vencida');
export const esVencidaVeta = (e: unknown) => e instanceof ErrorVeta && e.tipo === 'vencida';

/** De quién es una operación: dueño en AURA, generación de esa sesión y cuenta de Veta. */
export type VinculoVeta = { readonly dueno: string; readonly gen: number; readonly cuenta: number };

/** El vínculo de ahora: se captura al EMPEZAR cada operación. */
export function vinculoVeta(): VinculoVeta {
  return { dueno: seudonimoActual(), gen: generacionCuenta(), cuenta: cuentaVeta };
}

/** ¿Sigue siendo la sesión que empezó la operación? (alguien dentro de AURA, la misma generación y la misma cuenta de Veta) */
export function vinculoVigente(v: VinculoVeta | null | undefined): boolean {
  return !!v && !!v.dueno && sigueVigente(v.gen) && v.cuenta === cuentaVeta;
}

/** viva: hay JWT que sirve · sin: hay que volver a entrar · vencida: la operación era de otra sesión. */
type Estado = 'viva' | 'sin' | 'vencida';
/** Una renovación en vuelo por cuenta: dos con el mismo refreshToken se pisarían (el servidor lo rota). */
let refrescando: { gen: number; cuenta: number; p: Promise<Estado> } | null = null;

function cortarEnVuelo() {
  for (const c of enVuelo) {
    cortadas.add(c);
    c.abort();
  }
  enVuelo.clear();
  refrescando = null;
}

// Salir de AURA o entrar otra persona: lo de la sesión anterior se corta y se suelta en el acto.
alCambiarCuenta(() => {
  cuentaVeta++;
  cortarEnVuelo();
  token = refresco = correo = null;
  cargadoPara = null;
  avisar();
});

async function leer(k: string) {
  try {
    return await SecureStore.getItemAsync(k);
  } catch {
    return null;
  }
}

/** Las escrituras del llavero, de a una: guardar y borrar no se cruzan. */
let colaLlavero: Promise<void> = Promise.resolve();
function escribir(k: string, v: string | null): Promise<void> {
  const f = async () => {
    try {
      if (v) await SecureStore.setItemAsync(k, v);
      else await SecureStore.deleteItemAsync(k);
    } catch {
      /* sin llavero: la sesión dura lo que dure la app abierta */
    }
  };
  const p = colaLlavero.then(f, f);
  colaLlavero = p;
  return p;
}

/**
 * Las credenciales de antes no tenían dueño: no se le asignan a quien abra la pantalla. Se borran (una vez
 * por sesión de AURA) y se pide entrar otra vez a Veta. Lo llama también la huella (veta/desbloqueo.ts).
 */
export async function descartarSinDueno(): Promise<void> {
  const gen = generacionCuenta();
  if (descartadasEn === gen) return;
  descartadasEn = gen;
  await Promise.all(LLAVES_SIN_DUENO.map((k) => escribir(k, null)));
}

/** El contenido del JWT (sin verificar: solo para saber cuándo vence y de quién es). */
export function leerJwt(tk: string | null): Record<string, any> | null {
  try {
    const parte = String(tk || '').split('.')[1];
    if (!parte) return null;
    let b64 = parte.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = globalThis.atob ? globalThis.atob(b64) : '';
    const json = decodeURIComponent(
      bin
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** ¿El JWT sirve todavía (con 30 s de margen)? */
export function tokenVivo(tk: string | null = token, ahora = Date.now()): boolean {
  const c = leerJwt(tk);
  return !!(c && c.exp && c.exp * 1000 > ahora + 30_000);
}

/** La sesión de Veta de quien está dentro de AURA (solo la suya; sin nadie dentro, ninguna). */
export async function cargarSesion(): Promise<void> {
  const dueno = seudonimoActual();
  const gen = generacionCuenta();
  if (cargadoPara && cargadoPara.gen === gen) return;
  if (!dueno) {
    token = refresco = correo = null;
    cargadoPara = { dueno: '', gen };
    avisar();
    return;
  }
  await descartarSinDueno();
  const [tk, rt, mail] = await Promise.all([leer(llaveDe(LLAVE_TOKEN, dueno)), leer(llaveDe(LLAVE_REFRESCO, dueno)), leer(llaveDe(LLAVE_CORREO, dueno))]);
  // Mientras se leía salió o entró otra persona, o ya se puso otra cosa (entró o salió de Veta): lo leído no va.
  if (!sigueVigente(gen) || (cargadoPara && cargadoPara.gen === gen)) return;
  token = tk;
  refresco = rt;
  correo = mail;
  cargadoPara = { dueno, gen };
  avisar();
}

/** ¿Hay cuenta de Veta Wallet conectada para quien está dentro? (con refresco: se puede renovar sola) */
export function conectada(): boolean {
  return !!(refresco || tokenVivo());
}
export function correoConectado(): string | null {
  return correo;
}
export function escucharSesion(f: () => void): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}

/**
 * Pone la sesión de Veta de `v` (en memoria y en SU llave), solo si `v` sigue siendo el vínculo de ahora.
 * `nueva`: es otra cuenta de Veta (entrar, salir, la cerró el servidor): lo que estaba en vuelo con la
 * anterior se corta y ya no aplica. Devuelve el vínculo con que queda, o null si no se puso (era de otra sesión).
 */
async function fijar(v: VinculoVeta, tk: string | null, rt: string | null | undefined, mail?: string | null, o: { nueva?: boolean } = {}): Promise<VinculoVeta | null> {
  if (!vinculoVigente(v)) return null;
  if (o.nueva) {
    cuentaVeta++;
    cortarEnVuelo();
  }
  token = tk;
  if (rt !== undefined) refresco = rt;
  if (mail !== undefined) correo = mail;
  cargadoPara = { dueno: v.dueno, gen: v.gen };
  const queda: VinculoVeta = { ...v, cuenta: cuentaVeta };
  await Promise.all([
    escribir(llaveDe(LLAVE_TOKEN, v.dueno), tk),
    rt !== undefined ? escribir(llaveDe(LLAVE_REFRESCO, v.dueno), rt) : null,
    mail !== undefined ? escribir(llaveDe(LLAVE_CORREO, v.dueno), mail) : null,
  ]);
  avisar();
  return queda;
}

const elegirToken = (d: any): string | null => d?.token || d?.accessToken || d?.access_token || d?.jwt || d?.data?.token || null;
const elegirRefresco = (d: any): string | null => d?.refreshToken || d?.refresh_token || d?.data?.refreshToken || null;

type Opciones = { method?: string; body?: unknown; ms?: number; conClave?: boolean };

/** Una petición de la sesión `v`: no sale si ya no es la de ahora, y su respuesta tampoco vuelve si dejó de serlo. */
async function crudo(ruta: string, o: Opciones, v: VinculoVeta): Promise<any> {
  if (!vinculoVigente(v)) throw vencidaVeta();
  const ctrl = new AbortController();
  enVuelo.add(ctrl);
  const t = setTimeout(() => ctrl.abort(), o.ms ?? 20_000);
  try {
    const r = await fetch(`${VETA_API}${ruta}`, {
      method: o.method || 'GET',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    // Llegó cuando ya era de otra sesión (salió de AURA o de Veta): ni el dato ni el error son de nadie aquí.
    if (cortadas.has(ctrl) || !vinculoVigente(v)) throw vencidaVeta();
    if (!r.ok) {
      const msg = String(d?.message || d?.error || `Error ${r.status}`);
      const deSesion = /token|jwt|expired|unauthori[sz]ed|sesi[oó]n/i.test(msg);
      const tipo =
        r.status === 401 || r.status === 403 ? (o.conClave && !deSesion ? 'clave' : 'sesion') : r.status === 400 || r.status === 422 ? 'rechazado' : r.status >= 500 ? 'servidor' : 'http';
      throw new ErrorVeta(msg, r.status, tipo, d?.code ? String(d.code) : undefined);
    }
    return d;
  } catch (e: any) {
    if (e instanceof ErrorVeta) throw e;
    if (cortadas.has(ctrl) || !vinculoVigente(v)) throw vencidaVeta();
    if (e?.name === 'AbortError') throw new ErrorVeta('Veta Wallet no contestó a tiempo.', 0, 'tiempo');
    throw new ErrorVeta('Sin conexión con Veta Wallet.', 0, 'red');
  } finally {
    clearTimeout(t);
    enVuelo.delete(ctrl);
  }
}

/** Renueva el JWT de la sesión `v` con su refreshToken si hace falta. */
async function renovar(v: VinculoVeta): Promise<Estado> {
  await cargarSesion();
  if (!vinculoVigente(v)) return 'vencida';
  if (tokenVivo()) return 'viva';
  if (!refresco) return 'sin';
  if (refrescando && refrescando.gen === v.gen && refrescando.cuenta === v.cuenta) return refrescando.p;
  const rt = refresco;
  const p: Promise<Estado> = (async (): Promise<Estado> => {
    try {
      const d = await crudo('/auth/refresh', { method: 'POST', body: { refreshToken: rt } }, v);
      const tk = elegirToken(d);
      if (!tk) return 'sin';
      // fijar vuelve a mirar el vínculo: si salió (de AURA o de Veta) mientras volvía, no restaura nada.
      return (await fijar(v, tk, elegirRefresco(d) || rt)) ? 'viva' : 'vencida';
    } catch (e: any) {
      if (esVencidaVeta(e)) return 'vencida';
      // El refresco venció o lo revocaron: se cierra la sesión (la red caída no la cierra).
      if (e instanceof ErrorVeta && (e.tipo === 'sesion' || e.status === 400)) await fijar(v, null, null, undefined, { nueva: true });
      return 'sin';
    }
  })().finally(() => {
    if (refrescando?.p === p) refrescando = null;
  });
  refrescando = { gen: v.gen, cuenta: v.cuenta, p };
  return p;
}

/** Renueva el JWT con el refreshToken si hace falta. false = hay que volver a entrar (o ya no es la sesión de ahora). */
export async function asegurarSesion(v: VinculoVeta = vinculoVeta()): Promise<boolean> {
  return (await renovar(v)) === 'viva';
}

/** Una petición con sesión: la renueva antes y, si el servidor dice que venció, una vez más. Todo de la sesión que la empezó. */
export async function pedir(ruta: string, o: Opciones = {}): Promise<any> {
  const v = vinculoVeta();
  const antes = await renovar(v);
  if (antes === 'vencida') throw vencidaVeta();
  if (antes === 'sin') throw new ErrorVeta('Tu sesión de Veta Wallet venció. Vuelve a entrar.', 401, 'sesion');
  try {
    return await crudo(ruta, o, v);
  } catch (e: any) {
    // Las de contraseña o las que mueven dinero no se repiten solas.
    if (!o.conClave && e instanceof ErrorVeta && e.tipo === 'sesion') {
      if (vinculoVigente(v)) token = null;
      const otra = await renovar(v);
      if (otra === 'viva') return await crudo(ruta, o, v);
      if (otra === 'vencida') throw vencidaVeta();
      await fijar(v, null, null, undefined, { nueva: true });
    }
    throw e;
  }
}

/**
 * Entrar con el correo y la contraseña de Veta Wallet (igual que su app; reintenta en minúsculas). La sesión
 * queda de quien está dentro de AURA AL EMPEZAR: si sale o entra otra persona mientras viaja, no se guarda
 * (`vencida`). Devuelve el vínculo de la sesión nueva (con él se guarda la huella).
 */
export async function entrar(correoEscrito: string, clave: string): Promise<{ correo: string; direccion: string | null; vinculo: VinculoVeta }> {
  const mail = String(correoEscrito || '').trim();
  const v = vinculoVeta();
  if (!v.dueno) throw vencidaVeta();
  let d: any;
  try {
    d = await crudo('/auth/login', { method: 'POST', body: { email: mail, password: clave } }, v);
  } catch (e: any) {
    const credenciales = e instanceof ErrorVeta && (e.status === 401 || e.status === 403 || e.status === 400 || e.status === 404);
    if (credenciales && mail !== mail.toLowerCase()) d = await crudo('/auth/login', { method: 'POST', body: { email: mail.toLowerCase(), password: clave } }, v);
    else throw e;
  }
  const tk = elegirToken(d);
  if (!tk) throw new ErrorVeta('Veta Wallet no devolvió una sesión.', 0, 'servidor');
  const vinculo = await fijar(v, tk, elegirRefresco(d), mail, { nueva: true });
  if (!vinculo) throw vencidaVeta();
  const c = leerJwt(tk) || {};
  return { correo: mail, direccion: c.address || d?.user?.address || null, vinculo };
}

/** Cerrar la sesión de Veta de quien está dentro: lo que estaba en vuelo se corta y su llave se borra. */
export async function salir(): Promise<void> {
  const dueno = seudonimoActual();
  cuentaVeta++;
  cortarEnVuelo();
  token = refresco = correo = null;
  cargadoPara = { dueno, gen: generacionCuenta() };
  avisar();
  if (dueno) await Promise.all([LLAVE_TOKEN, LLAVE_REFRESCO, LLAVE_CORREO].map((k) => escribir(llaveDe(k, dueno), null)));
}

/* ── la tarjeta (las mismas rutas que la app de Veta Wallet) ─────────────────────────────── */

export type Tarjeta = {
  last4?: string;
  status?: string;
  cardHolderName?: string;
  availableOrigen?: number | null;
  dailyLimit?: number | null;
  weeklyLimit?: number | null;
  monthlyLimit?: number | null;
};
export type DatosTarjeta = { pan?: string; cvv?: string; expiry?: string; panUrl?: string };
export type MovTarjeta = { id?: string; merchant?: string; date?: string; status?: string; origenAmount?: number | null; amount?: number | null };
export type Recarga = { status?: 'pending' | 'debited' | 'funded' | 'failed' | string; error?: string };

export const tarjeta = {
  mia: (): Promise<Tarjeta> => pedir('/cards/my-card', { ms: 30_000 }),
  congelar: (congelada: boolean): Promise<{ status?: string }> => pedir('/cards/freeze', { method: 'POST', body: { frozen: !!congelada } }),
  datos: (clave: string): Promise<DatosTarjeta> => pedir('/cards/pan', { method: 'POST', body: { password: clave }, ms: 30_000, conClave: true }),
  pin: (clave: string): Promise<{ pin?: string; pinUrl?: string }> => pedir('/cards/pin', { method: 'POST', body: { password: clave }, ms: 30_000, conClave: true }),
  crearPin: (pin: string, clave: string) => pedir('/cards/pin', { method: 'PUT', body: { pin: String(pin), password: clave }, ms: 30_000, conClave: true }),
  movimientos: async (): Promise<MovTarjeta[]> => {
    const d = await pedir('/cards/transactions?page=1', { ms: 30_000 });
    return Array.isArray(d?.transactions) ? d.transactions : [];
  },
  recargar: (origen: string, clave: string): Promise<Recarga> => pedir('/cards/fund', { method: 'POST', body: { amount: String(origen), password: clave }, ms: 60_000, conClave: true }),
  estadoRecarga: (): Promise<Recarga> => pedir('/cards/fund/status', { ms: 45_000 }),
};

/** La tarjeta todavía no existe para esta cuenta (404 es un estado normal: «pídela»). */
export const sinTarjeta = (e: unknown) => e instanceof ErrorVeta && e.status === 404;

/** «4111111111111111» → «4111  1111  1111  1111». */
export function formatearPan(pan: string): string {
  return String(pan || '')
    .replace(/\D/g, '')
    .replace(/(.{4})/g, '$1  ')
    .trim();
}

export const estaCongelada = (s?: string) => String(s || '').toUpperCase() === 'FROZEN';
