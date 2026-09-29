/**
 * El cliente del relevo de PULSE2CHAT (infra/mensajes en el repo de Orden Global), para AU-RA.
 *
 * Portado de `orden-global-app/src/og/mensajes.js`, con TRES diferencias que importan:
 *
 *   1. LA ENTRADA ES UN PASE DE GENESIS, no la sesión de la wallet. AU-RA no tiene esa sesión ni
 *      debe tenerla (abre la billetera entera). El relevo canjea el pase con Genesis y devuelve la
 *      llave de la cuenta de ESE correo —el que dice Genesis—. Así AU-RA es un aparato más de la
 *      misma persona: mismos contactos, mismas conversaciones.
 *   2. CADA PETICIÓN DE ESCUCHA DICE QUÉ APARATO ES (`aparato` = id de su llave). Sin eso, AU-RA y
 *      la app Orden Global se robaban el timbre y las respuestas de las llamadas.
 *   3. Sin grupos, pagos ni estados por ahora: conversaciones 1 a 1 cifradas, el círculo, buscar,
 *      fotos cifradas y llamadas. Lo que llega de un grupo se ve en su hilo si ya estaba.
 *
 * La regla del cifrado es la misma de allá: se cierra SIEMPRE; solo «la otra persona no tiene
 * ningún aparato publicado» baja a texto en claro, y ese mensaje queda marcado. Un fallo de red
 * NO baja a claro: se levanta como error de envío.
 */
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import * as CANDADO from './candado';
import type { Aparato, Bulto } from './candado';

const BASE = String((Constants.expoConfig?.extra as any)?.mensajesApi || 'https://cerebro.ordenscan.com/mensajes').replace(/\/+$/, '');
const CAJON_CUENTA = 'aura.p2c.cuenta';

export type Cuenta = { correo: string; llave: string };
let yo: Cuenta | null = null;
let aparato = '';

export type ErrorRelevo = Error & { code?: number; motivo?: string; correoReal?: string };

async function pedir<T = any>(ruta: string, body: unknown, ms = 15_000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(BASE + ruta, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e: ErrorRelevo = new Error(d.error || 'http ' + res.status);
      e.code = res.status;
      if (d.motivo) e.motivo = d.motivo;
      if (d.correoReal) e.correoReal = String(d.correoReal).toLowerCase();
      throw e;
    }
    return d as T;
  } finally {
    clearTimeout(t);
  }
}

const firmado = (b: Record<string, unknown>) => ({ ...b, correo: yo?.correo, llave: yo?.llave });
const conAparato = (b: Record<string, unknown>) => (aparato ? { ...b, aparato } : b);

async function miAparato(): Promise<string> {
  if (aparato) return aparato;
  const m = await CANDADO.miLlave().catch(() => null);
  aparato = m?.id || '';
  return aparato;
}

/* ── la cuenta del chat en este teléfono ──────────────────────────────────────────────────── */

/** Entra al chat con el pase de Genesis que trajo la wallet. Devuelve el correo de la cuenta. */
export async function entrarConPase(pase: string, verificador: string, nombre?: string): Promise<Cuenta> {
  const d = await pedir<{ llave: string; correo: string }>('/alta', { pase, verificador, ...(nombre ? { nombre } : {}) });
  if (!d?.llave || !d?.correo) throw new Error('el relevo no devolvió la llave');
  yo = { correo: String(d.correo).toLowerCase(), llave: d.llave };
  await SecureStore.setItemAsync(CAJON_CUENTA, JSON.stringify(yo)).catch(() => {});
  publicadaPara = null;
  await publicarMiLlave().catch(() => null);
  return yo;
}

/** La cuenta que ya estaba en este teléfono, comprobada contra el relevo. null si no hay o no vale. */
export async function recuperar(): Promise<Cuenta | null> {
  if (yo) return yo;
  const g = await SecureStore.getItemAsync(CAJON_CUENTA).catch(() => null);
  if (!g) return null;
  try {
    const c = JSON.parse(g) as Cuenta;
    if (!c?.correo || !c?.llave) return null;
    yo = c;
    await publicarMiLlave();
    return yo;
  } catch (e: any) {
    // 401: la llave ya no vale (la cuenta se rehízo en otro lado). Se olvida y se pide entrar de nuevo.
    if (e?.code === 401) await salir();
    return e?.code === 401 ? null : yo;
  }
}

export async function salir() {
  dejarDeEscuchar();
  yo = null;
  publicadaPara = null;
  llavero.clear();
  await SecureStore.deleteItemAsync(CAJON_CUENTA).catch(() => {});
}

export const quien = () => yo;

/* ── las llaves de los aparatos ───────────────────────────────────────────────────────────── */

let publicadaPara: string | null = null;

/** La pública de este teléfono se publica AL ENTRAR: si no, no podría RECIBIR nada cifrado. */
async function publicarMiLlave() {
  if (!yo || publicadaPara === yo.correo) return;
  const mia = await CANDADO.miLlave();
  if (!mia) return;
  await pedir('/llaves/publicar', firmado({ id: mia.id, pub: mia.pub, fir: mia.fir || '' }));
  aparato = mia.id;
  publicadaPara = yo.correo;
}

const VIDA_LLAVES = 5 * 60 * 1000;
const llavero = new Map<string, { aparatos: Aparato[]; en: number }>();

async function llaveroDe(correos: string[]): Promise<Record<string, Aparato[]>> {
  const ahora = Date.now();
  const faltan = correos.filter((c) => {
    const g = llavero.get(c);
    return !g || ahora - g.en > VIDA_LLAVES;
  });
  if (faltan.length) {
    const r = await pedir<{ llaves?: Record<string, Aparato[]> }>('/llaves/de', firmado({ correos: faltan }));
    for (const c of faltan) {
      const aps = r.llaves?.[c] || [];
      // EL VACÍO NO SE GUARDA: guardarlo haría salir en claro lo primero que se escriba al ser aceptado.
      if (aps.length) llavero.set(c, { aparatos: aps, en: ahora });
      else llavero.delete(c);
    }
  }
  const mapa: Record<string, Aparato[]> = {};
  for (const c of correos) mapa[c] = llavero.get(c)?.aparatos || [];
  return mapa;
}

type Cierre = { cerrado: Bulto } | { motivo: 'sin-llave-propia' | 'sin-red' | 'sin-aparatos' };

async function cerrarPara(para: string, texto: string): Promise<Cierre> {
  try {
    await publicarMiLlave();
  } catch {
    return { motivo: 'sin-llave-propia' };
  }
  let aparatos: Aparato[];
  try {
    aparatos = (await llaveroDe([para]))[para] || [];
  } catch {
    return { motivo: 'sin-red' };
  }
  const mia = await CANDADO.miLlave().catch(() => null);
  const ajenos = aparatos.filter((a) => !mia || a.id !== mia.id);
  if (!ajenos.length) return { motivo: 'sin-aparatos' };
  try {
    return { cerrado: await CANDADO.cerrar(texto, aparatos) };
  } catch {
    return { motivo: 'sin-llave-propia' };
  }
}

/* ── mensajes ─────────────────────────────────────────────────────────────────────────────── */

export type Mensaje = {
  id: string;
  de: string;
  para: string;
  cuando: number;
  texto: string;
  e2e?: boolean;
  cerrado?: boolean;
  verificado?: boolean;
  borrado?: boolean;
  tipo?: string;
  archivo?: string;
  nombre?: string;
  llaveArchivo?: string;
  ivArchivo?: string;
  cita?: string;
};

/** Envía un texto, cerrado siempre que se pueda. `e2e:false` = salió en claro (y se dice). */
export async function enviar(para: string, texto: string): Promise<{ ok: true; e2e: boolean }> {
  const r = await cerrarPara(para, texto);
  if ('cerrado' in r) {
    await pedir('/enviar', firmado({ para, cif: r.cerrado }));
    return { ok: true, e2e: true };
  }
  if (r.motivo !== 'sin-aparatos') {
    const e: ErrorRelevo = new Error('no se pudo cifrar: ' + r.motivo);
    e.motivo = r.motivo;
    throw e;
  }
  await pedir('/enviar', firmado({ para, texto }));
  return { ok: true, e2e: false };
}

/** Sube una foto cifrada (la llave viaja DENTRO del mensaje cifrado) y la manda. */
export async function enviarFoto(para: string, base64: string, mime = 'image/jpeg', texto = '') {
  const c = CANDADO.cerrarBytes(deB64Simple(base64));
  const sub = await pedir<{ id: string }>('/subir', firmado({ nombre: 'foto.jpg', tipo: 'imagen', mime, datos: aB64Simple(c.bytes) }), 120_000);
  const carga = '{' + JSON.stringify({ t: texto, k: c.llave, iv: c.iv });
  const r = await cerrarPara(para, carga);
  const meta = { para, tipo: 'imagen', archivo: sub.id, nombre: 'foto.jpg' };
  if ('cerrado' in r) {
    await pedir('/enviar', firmado({ ...meta, cif: r.cerrado }));
    return { ok: true, e2e: true };
  }
  if (r.motivo !== 'sin-aparatos') throw Object.assign(new Error('no se pudo cifrar: ' + r.motivo), { motivo: r.motivo });
  // Sin poder cerrar, la llave NO viaja: iría en claro al lado de los bytes cifrados.
  await pedir('/enviar', firmado({ ...meta, texto }));
  return { ok: true, e2e: false };
}

/** La bandeja de un hilo, con los sobres ya abiertos (la pantalla no sabe de criptografía). */
export async function bandeja(desde: string, antes?: number): Promise<{ mensajes: Mensaje[]; hayMas: boolean; leidoHasta: number; enLinea?: boolean }> {
  const d = await pedir<any>('/bandeja', firmado(antes ? { desde, antes } : { desde }));
  const crudos: any[] = d.mensajes || [];
  const deQuienes = [...new Set(crudos.filter((m) => m.cif && m.de).map((m) => m.de))] as string[];
  let llaves: Record<string, Aparato[]> = {};
  if (deQuienes.length) {
    try {
      llaves = await llaveroDe(deQuienes);
    } catch {
      llaves = {};
    }
  }
  const mensajes = await Promise.all(
    crudos.map(async (m): Promise<Mensaje> => {
      if (m.borrado) return { ...m, texto: '' };
      if (!m.cif) return { ...m, e2e: false };
      const r = await CANDADO.abrir(m.cif, llaves[m.de] || []);
      if (r == null) return { ...m, texto: '', cerrado: true, e2e: true };
      let texto = r.texto;
      let extra: Partial<Mensaje> = {};
      if (texto.startsWith('{')) {
        try {
          const j = JSON.parse(texto.slice(1));
          texto = j.t || '';
          extra = { ...(j.k ? { llaveArchivo: j.k, ivArchivo: j.iv } : {}), ...(j.c ? { cita: String(j.c).slice(0, 16) } : {}) };
        } catch {
          /* texto normal que empieza raro */
        }
      }
      return { ...m, cif: undefined, texto, e2e: true, verificado: r.verificado, ...extra };
    })
  );
  return { mensajes, hayMas: d.hayMas === true, leidoHasta: Number(d.leidoHasta) || 0, enLinea: d.enLinea };
}

export const conversaciones = () => pedir<{ conversaciones: any[] }>('/conversaciones', firmado({})).then((d) => d.conversaciones || []);
export const buscar = (q: string) => pedir<{ gente?: any[]; resultados?: any[] }>('/buscar', firmado({ q }));
export const circulo = () => pedir<{ recibidas?: any[]; enviadas?: any[]; amigos?: any[] }>('/amistad/lista', firmado({}));
export const pedirAmistad = (para: string, nota = '') => pedir('/amistad/pedir', firmado({ para, nota }));
export const responderAmistad = async (de: string, aceptar: boolean) => {
  const r = await pedir('/amistad/responder', firmado({ de, aceptar }));
  if (aceptar) llavero.delete(String(de || '').toLowerCase());
  return r;
};
export const leido = (de: string) => pedir('/leido', firmado({ de })).catch(() => null);
export const ficha = (de: string) => pedir<any>('/ficha', firmado({ de }));

/** El código de seguridad con alguien: si coincide en los dos teléfonos, no hay nadie en medio. */
export async function codigoCon(correo: string): Promise<string | null> {
  if (!yo) return null;
  const r = await pedir<{ llaves?: Record<string, Aparato[]> }>('/llaves/de', firmado({ correos: [yo.correo, correo] }));
  const mias = (r.llaves?.[yo.correo] || []).map((a) => a.pub);
  const suyas = (r.llaves?.[correo] || []).map((a) => a.pub);
  if (!mias.length || !suyas.length) return null;
  return CANDADO.codigoDeSeguridad(mias, suyas);
}

/* ── fotos ────────────────────────────────────────────────────────────────────────────────── */

export const urlArchivo = (id: string) => BASE + '/archivo/' + id;
const abiertos = new Map<string, string>();
/** La foto ABIERTA como `data:`; la URL tal cual si vino en claro; null si no se pudo abrir. */
export async function archivoAbierto(id: string, llave?: string, iv?: string, mime = 'image/jpeg'): Promise<string | null> {
  if (!llave || !iv) return urlArchivo(id);
  const ya = abiertos.get(id);
  if (ya) return ya;
  try {
    const r = await fetch(urlArchivo(id));
    if (!r.ok) throw new Error('no está');
    const claros = CANDADO.abrirBytes(new Uint8Array(await r.arrayBuffer()), llave, iv);
    const uri = `data:${mime};base64,${aB64Simple(claros)}`;
    abiertos.set(id, uri);
    return uri;
  } catch {
    return null;
  }
}

/* ── el buzón de señales (escribiendo, llamadas) ─────────────────────────────────────────── */

let escuchando = false;
let cortar: ReturnType<typeof setTimeout> | null = null;
let generacion = 0;

export type Senal = { de: string; tipo: string; datos: any; desde?: string };

/** Escucha el buzón de ESTE aparato: cada señal llega una vez aquí, sin robársela a la app Orden Global. */
export async function escuchar(alLlegar: (s: Senal) => void) {
  if (escuchando || !yo) return;
  escuchando = true;
  const mia = ++generacion;
  await miAparato();
  while (escuchando && mia === generacion) {
    try {
      const d = await pedir<{ senales?: Senal[] }>('/senales', conAparato(firmado({})), 40_000);
      if (mia !== generacion) break;
      for (const s of d.senales || []) {
        try {
          alLlegar(s);
        } catch {
          /* una señal mal formada no tumba el bucle */
        }
      }
    } catch {
      if (!escuchando || mia !== generacion) break;
      await new Promise((r) => {
        cortar = setTimeout(r, 2000);
      });
    }
  }
}

export function dejarDeEscuchar() {
  escuchando = false;
  generacion++;
  if (cortar) {
    clearTimeout(cortar);
    cortar = null;
  }
}

export const miId = () => aparato;

let ultimoAviso = 0;
export function escribiendo(para: string) {
  const ahora = Date.now();
  if (ahora - ultimoAviso < 2000) return;
  ultimoAviso = ahora;
  pedir('/escribiendo', firmado({ para })).catch(() => null);
}

/** Deja una señal (llamadas). Nunca lanza. */
export const senalar = (para: string, tipo: string, datos?: unknown) =>
  pedir('/senal', conAparato(firmado({ para, tipo, datos: datos || {} }))).catch(() => null);

/** Credenciales cortas del TURN de Cloudflare (las pide el relevo; el token grande no baja nunca). */
export const turno = () =>
  pedir<{ iceServers?: any[] }>('/turno', firmado({}))
    .then((d) => d.iceServers || [])
    .catch(() => []);

/* ── base64 clásico (el del relevo para /subir, distinto del base64url del candado) ─────────── */
const ALF64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function aB64Simple(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    s += ALF64[(n >> 18) & 63] + ALF64[(n >> 12) & 63];
    s += i + 1 < bytes.length ? ALF64[(n >> 6) & 63] : '=';
    s += i + 2 < bytes.length ? ALF64[n & 63] : '=';
  }
  return s;
}
function deB64Simple(txt: string): Uint8Array {
  const s = String(txt || '').replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let n = 0;
  let bits = 0;
  let j = 0;
  for (let i = 0; i < s.length; i++) {
    n = (n << 6) | ALF64.indexOf(s[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (n >> bits) & 255;
    }
  }
  return out.subarray(0, j);
}
