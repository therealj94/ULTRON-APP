/**
 * ENTRAR CON GENESIS ID.
 *
 * AU-RA no pide la contraseña de la wallet ni la ve nunca. Le pide a la wallet de la persona un
 * PASE de Genesis ID, y la persona lo autoriza allá:
 *
 *   1. Si el teléfono tiene la app Orden Global: `vetawallet://sso?destino=aura&reto=…&estado=…`.
 *      La app muestra «AU-RA quiere usar tu Genesis ID», la persona toca «Permitir» y vuelve aquí
 *      con `ultronfp://sso?pase=…&estado=…`.
 *   2. Si no la tiene: la web de Veta Wallet (`#sso-aura`) en una pestaña segura del sistema, con el
 *      mismo consentimiento y la misma vuelta.
 *
 * EL RETO (como PKCE): este teléfono inventa un verificador al azar y manda solo su huella SHA-256.
 * El pase lleva esa huella, y para canjearlo hace falta el verificador, que nunca salió de aquí. Si
 * otra app registrara `ultronfp://` y se quedara con el enlace de vuelta, el pase no le serviría.
 * El `estado` descarta vueltas que no pidió este teléfono.
 *
 * El mismo pase abre la sesión de AU-RA (el servidor) y el chat PULSE2CHAT (el relevo): cada uno lo
 * gasta una vez.
 */
import { AppState, Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha2';
import { api } from './api';
import { saveMesaToken } from './storage';
import { aB64 } from '../pulse/candado';
import * as RELEVO from '../pulse/relevo';

const CAJON = 'aura.genesis.pendiente';
const VUELTA = 'ultronfp://sso';
const VIDA_PEDIDO_MS = 10 * 60_000;

type Pendiente = { verificador: string; estado: string; en: number };
export type Miembro = { nombre: string; correo: string; rol: string; gid: string };
export type ResultadoGenesis =
  | { ok: true; miembro: Miembro; chat: boolean }
  | { ok: false; codigo: string; mensaje: string; gid?: string };

const azarB64 = (n: number) => aB64(Crypto.getRandomBytes(n));

/** El verificador (queda aquí) y su huella (viaja). */
export function nuevoReto(): { verificador: string; reto: string } {
  const verificador = azarB64(32);
  // El verificador es base64url (ASCII): sus bytes son sus códigos, sin depender de TextEncoder.
  const reto = aB64(sha256(Uint8Array.from(verificador, (c) => c.charCodeAt(0))));
  return { verificador, reto };
}

/** Lee `pase`, `error` y `estado` de la vuelta (`ultronfp://sso?…`). */
export function leerVuelta(url: string | null | undefined): { pase?: string; error?: string; estado?: string } | null {
  const u = String(url || '');
  if (!u.toLowerCase().startsWith(VUELTA)) return null;
  const q = u.includes('?') ? u.slice(u.indexOf('?') + 1).split('#')[0] : '';
  const r: Record<string, string> = {};
  for (const par of q.split('&')) {
    if (!par) continue;
    const i = par.indexOf('=');
    const k = decodeURIComponent(i < 0 ? par : par.slice(0, i));
    const v = i < 0 ? '' : decodeURIComponent(par.slice(i + 1));
    if (k === 'pase' || k === 'error' || k === 'estado') r[k] = v;
  }
  return r;
}

async function guardarPendiente(p: Pendiente) {
  await SecureStore.setItemAsync(CAJON, JSON.stringify(p)).catch(() => {});
}
async function leerPendiente(): Promise<Pendiente | null> {
  try {
    const p = JSON.parse((await SecureStore.getItemAsync(CAJON)) || 'null') as Pendiente | null;
    if (!p || Date.now() - p.en > VIDA_PEDIDO_MS) return null;
    return p;
  } catch {
    return null;
  }
}
const olvidarPendiente = () => SecureStore.deleteItemAsync(CAJON).catch(() => {});

async function walletWeb(): Promise<string> {
  try {
    const c = await api<{ walletWeb?: string }>('/api/genesis/config', undefined, 8_000);
    if (c?.walletWeb && /^https:\/\//.test(c.walletWeb)) return c.walletWeb;
  } catch {
    /* sin config, la de siempre */
  }
  return 'https://app.vetawallet.com/#sso-aura';
}

/**
 * Espera a que vuelva `ultronfp://sso…` de la app Orden Global.
 *
 * Y si la persona vuelve a AU-RA SIN el enlace —la app Orden Global instalada es de antes de este
 * cambio y no sabe qué es `destino=aura`, o la persona tocó «atrás»— se deja de esperar enseguida
 * (1,5 s de gracia) en vez de dejarla cinco minutos mirando un botón que no responde: `null` y se
 * sigue por la web de la wallet.
 */
function esperarVuelta(ms: number): Promise<string | null> {
  return new Promise((listo) => {
    let hecho = false;
    let seFue = false;
    let gracia: ReturnType<typeof setTimeout> | null = null;
    const terminar = (url: string | null) => {
      if (hecho) return;
      hecho = true;
      sub.remove();
      estado.remove();
      clearTimeout(t);
      if (gracia) clearTimeout(gracia);
      listo(url);
    };
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (leerVuelta(url)) terminar(url);
    });
    const estado = AppState.addEventListener('change', (st) => {
      if (st !== 'active') {
        seFue = true;
        if (gracia) clearTimeout(gracia);
        return;
      }
      if (seFue) gracia = setTimeout(() => terminar(null), 1500);
    });
    const t = setTimeout(() => terminar(null), ms);
  });
}

/** Pide el pase a la wallet (app o web) y devuelve el enlace de vuelta, o null si no volvió. */
async function pedirPase(reto: string, estado: string): Promise<string | null> {
  const q = `reto=${encodeURIComponent(reto)}&estado=${encodeURIComponent(estado)}`;
  // 1. La app Orden Global. Si no está instalada, openURL falla y se sigue con la web.
  const espera = esperarVuelta(5 * 60_000);
  try {
    await Linking.openURL(`vetawallet://sso?destino=aura&${q}`);
    const url = await espera;
    if (url) return url;
    // Volvió sin pase: la app Orden Global no lo dio. Se sigue por la web, con el MISMO reto.
  } catch {
    /* no está la app: la web */
  }
  // 2. La web de la wallet, en una pestaña segura del sistema que vuelve sola a ultronfp://sso.
  const r = await WebBrowser.openAuthSessionAsync(`${await walletWeb()}?${q}`, VUELTA);
  return r.type === 'success' ? r.url : null;
}

/** Canjea la vuelta: sesión de AU-RA y, con el mismo pase, el chat. */
async function completar(url: string, p: Pendiente): Promise<ResultadoGenesis> {
  const v = leerVuelta(url);
  if (!v || v.estado !== p.estado) return { ok: false, codigo: 'ESTADO', mensaje: 'Esa respuesta no es de este inicio de sesión. Probá de nuevo.' };
  await olvidarPendiente();
  if (v.error === 'cancelado') return { ok: false, codigo: 'CANCELADO', mensaje: 'Cancelaste la entrada con Genesis ID.' };
  if (v.error === 'sin-gid') return { ok: false, codigo: 'SIN_GID', mensaje: 'Tu Genesis ID todavía no está verificado. Completá la verificación en tu wallet.' };
  if (v.error || !v.pase) return { ok: false, codigo: 'FALLO', mensaje: 'La wallet no pudo darte el pase. Probá de nuevo.' };
  let data: { token?: string; miembro?: Miembro };
  try {
    data = await api('/api/genesis/entrar', { method: 'POST', body: JSON.stringify({ pase: v.pase, verificador: p.verificador }) }, 20_000, false);
  } catch (e: any) {
    const cuerpo = e?.data || {};
    return { ok: false, codigo: cuerpo.codigo || String(e?.status || 'FALLO'), mensaje: cuerpo.error || e?.message || 'No pude entrar con Genesis ID.', gid: cuerpo.gid };
  }
  if (!data?.token || !data.miembro) return { ok: false, codigo: 'FALLO', mensaje: 'No pude entrar con Genesis ID.' };
  await saveMesaToken(data.token);
  // El chat con el MISMO pase (el relevo lo gasta por su lado). Si falla, AU-RA entra igual y el
  // chat ofrece conectarse después.
  let chat = false;
  try {
    await RELEVO.entrarConPase(v.pase, p.verificador, data.miembro.nombre);
    chat = true;
  } catch {
    chat = false;
  }
  return { ok: true, miembro: data.miembro, chat };
}

/** Todo el viaje: reto, wallet, vuelta y canje. */
export async function entrarConGenesis(): Promise<ResultadoGenesis> {
  const { verificador, reto } = nuevoReto();
  const p: Pendiente = { verificador, estado: azarB64(12), en: Date.now() };
  await guardarPendiente(p);
  const url = await pedirPase(reto, p.estado);
  if (!url) return { ok: false, codigo: 'SIN_VUELTA', mensaje: 'No volvió la respuesta de la wallet.' };
  return completar(url, p);
}

/**
 * Si Android cerró AU-RA mientras la persona estaba en la wallet, la app arranca DE NUEVO con el
 * enlace de vuelta. Esto lo recoge y termina la entrada.
 */
export async function retomarSiVolvio(): Promise<ResultadoGenesis | null> {
  const url = await Linking.getInitialURL().catch(() => null);
  if (!leerVuelta(url)) return null;
  const p = await leerPendiente();
  if (!p) return null;
  return completar(url as string, p);
}

/** Solo el chat: para quien ya está dentro de AU-RA y quiere conectar PULSE2CHAT. */
export async function conectarChat(): Promise<{ ok: boolean; mensaje?: string }> {
  const { verificador, reto } = nuevoReto();
  const p: Pendiente = { verificador, estado: azarB64(12), en: Date.now() };
  await guardarPendiente(p);
  const url = await pedirPase(reto, p.estado);
  const v = leerVuelta(url);
  await olvidarPendiente();
  if (!v || v.estado !== p.estado || !v.pase) return { ok: false, mensaje: v?.error === 'cancelado' ? 'Cancelado.' : 'La wallet no devolvió el pase.' };
  try {
    await RELEVO.entrarConPase(v.pase, verificador);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, mensaje: e?.message || 'El chat no aceptó el pase.' };
  }
}
