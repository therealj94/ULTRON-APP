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
 *     AURA. La contraseña NO se guarda aquí: para no teclearla, se guarda aparte detrás de la huella o Face
 *     ID (veta/desbloqueo.ts), como en Veta Wallet.
 *   · Las operaciones con contraseña (ver número/CVV/PIN, recargar) no se reintentan solas: un 401 ahí es
 *     «contraseña incorrecta», no una sesión vencida (la sesión se renueva ANTES de mandarlas).
 */
import * as SecureStore from 'expo-secure-store';

export const VETA_API = 'https://vetawallet-1a2e38ac52b1.herokuapp.com';

const LLAVE_TOKEN = 'aura.veta.token';
const LLAVE_REFRESCO = 'aura.veta.refresco';
const LLAVE_CORREO = 'aura.veta.correo';

let token: string | null = null;
let refresco: string | null = null;
let correo: string | null = null;
let cargado = false;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());

export class ErrorVeta extends Error {
  status: number;
  /** red · tiempo · sesion · clave · rechazado · servidor · http */
  tipo: string;
  motivo?: string;
  constructor(mensaje: string, status: number, tipo: string, motivo?: string) {
    super(mensaje);
    this.status = status;
    this.tipo = tipo;
    this.motivo = motivo;
  }
}

async function leer(k: string) {
  try {
    return await SecureStore.getItemAsync(k);
  } catch {
    return null;
  }
}
async function escribir(k: string, v: string | null) {
  try {
    if (v) await SecureStore.setItemAsync(k, v);
    else await SecureStore.deleteItemAsync(k);
  } catch {
    /* sin llavero: la sesión dura lo que dure la app abierta */
  }
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

export async function cargarSesion(): Promise<void> {
  if (cargado) return;
  [token, refresco, correo] = await Promise.all([leer(LLAVE_TOKEN), leer(LLAVE_REFRESCO), leer(LLAVE_CORREO)]);
  cargado = true;
  avisar();
}

/** ¿Hay cuenta de Veta Wallet conectada en este teléfono? (con refresco: se puede renovar sola) */
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

async function fijar(tk: string | null, rt: string | null | undefined, mail?: string | null) {
  token = tk;
  if (rt !== undefined) refresco = rt;
  if (mail !== undefined) correo = mail;
  await Promise.all([escribir(LLAVE_TOKEN, token), rt !== undefined ? escribir(LLAVE_REFRESCO, refresco) : null, mail !== undefined ? escribir(LLAVE_CORREO, correo) : null]);
  avisar();
}

const elegirToken = (d: any): string | null => d?.token || d?.accessToken || d?.access_token || d?.jwt || d?.data?.token || null;
const elegirRefresco = (d: any): string | null => d?.refreshToken || d?.refresh_token || d?.data?.refreshToken || null;

type Opciones = { method?: string; body?: unknown; ms?: number; conClave?: boolean };

async function crudo(ruta: string, o: Opciones = {}): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), o.ms ?? 20_000);
  try {
    const r = await fetch(`${VETA_API}${ruta}`, {
      method: o.method || 'GET',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
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
    if (e?.name === 'AbortError') throw new ErrorVeta('Veta Wallet no contestó a tiempo.', 0, 'tiempo');
    throw new ErrorVeta('Sin conexión con Veta Wallet.', 0, 'red');
  } finally {
    clearTimeout(t);
  }
}

/** Renueva el JWT con el refreshToken si hace falta. false = hay que volver a entrar. */
export async function asegurarSesion(): Promise<boolean> {
  await cargarSesion();
  if (tokenVivo()) return true;
  if (!refresco) return false;
  try {
    const d = await crudo('/auth/refresh', { method: 'POST', body: { refreshToken: refresco } });
    const tk = elegirToken(d);
    if (!tk) return false;
    await fijar(tk, elegirRefresco(d) || refresco);
    return true;
  } catch (e: any) {
    // El refresco venció o lo revocaron: se cierra la sesión (la red caída no la cierra).
    if (e instanceof ErrorVeta && (e.tipo === 'sesion' || e.status === 400)) await fijar(null, null);
    return false;
  }
}

/** Una petición con sesión: la renueva antes y, si el servidor dice que venció, una vez más. */
export async function pedir(ruta: string, o: Opciones = {}): Promise<any> {
  if (!(await asegurarSesion())) throw new ErrorVeta('Tu sesión de Veta Wallet venció. Vuelve a entrar.', 401, 'sesion');
  try {
    return await crudo(ruta, o);
  } catch (e: any) {
    // Las de contraseña o las que mueven dinero no se repiten solas.
    if (!o.conClave && e instanceof ErrorVeta && e.tipo === 'sesion') {
      token = null;
      if (await asegurarSesion()) return await crudo(ruta, o);
      await fijar(null, null);
    }
    throw e;
  }
}

/** Entrar con el correo y la contraseña de Veta Wallet (igual que su app; reintenta en minúsculas). */
export async function entrar(correoEscrito: string, clave: string): Promise<{ correo: string; direccion: string | null }> {
  const mail = String(correoEscrito || '').trim();
  let d: any;
  try {
    d = await crudo('/auth/login', { method: 'POST', body: { email: mail, password: clave } });
  } catch (e: any) {
    const credenciales = e instanceof ErrorVeta && (e.status === 401 || e.status === 403 || e.status === 400 || e.status === 404);
    if (credenciales && mail !== mail.toLowerCase()) d = await crudo('/auth/login', { method: 'POST', body: { email: mail.toLowerCase(), password: clave } });
    else throw e;
  }
  const tk = elegirToken(d);
  if (!tk) throw new ErrorVeta('Veta Wallet no devolvió una sesión.', 0, 'servidor');
  await fijar(tk, elegirRefresco(d), mail);
  const c = leerJwt(tk) || {};
  return { correo: mail, direccion: c.address || d?.user?.address || null };
}

export async function salir(): Promise<void> {
  await fijar(null, null, null);
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
