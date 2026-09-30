/**
 * ENTRAR CON GENESIS ID.
 *
 * AU-RA no pide la contraseña de la wallet ni la ve nunca. Le pide a la wallet de la persona un
 * PASE de Genesis ID, y la persona lo autoriza allá:
 *
 *   1. Si el teléfono tiene la app Orden Global: `vetawallet://sso?destino=aura&reto=…&estado=…&vuelta=…`.
 *      La app muestra «AU-RA quiere usar tu Genesis ID», la persona toca «Permitir» y vuelve aquí
 *      con `…/sso?pase=…&estado=…` (o `error=…&estado=…`).
 *   2. Si no la tiene: la web de Veta Wallet (`#sso-aura`) en una pestaña segura del sistema, con el
 *      mismo consentimiento y la misma vuelta.
 *
 * LA VUELTA. En Android se pide `vuelta=https://aura-fp.onrender.com/sso`: un App Link verificado
 * (app.config.js + /.well-known/assetlinks.json del servidor), que Android solo le entrega a ESTA app.
 * `ultronfp://sso` lo puede declarar cualquier app; queda como la vuelta por omisión de la wallet
 * (APKs viejas, que no mandan `vuelta`) y como la que usa la página /sso del servidor cuando el enlace
 * https cae en el navegador (con un intent atado al paquete). Se aceptan las dos, con el mismo `estado`.
 * La wallet solo acepta esas dos vueltas: el parámetro no sirve para mandar el pase a otro sitio.
 *
 * EL RETO (como PKCE): este teléfono inventa un verificador al azar y manda solo su huella SHA-256.
 * El pase lleva esa huella, y para canjearlo hace falta el verificador, que nunca salió de aquí. Si
 * otra app se quedara con el enlace de vuelta, el pase no le serviría.
 * El `estado` descarta vueltas que no pidió este teléfono.
 *
 * El mismo pase abre la sesión de AU-RA (el servidor) y el chat PULSE2CHAT (el relevo): cada uno lo
 * gasta una vez.
 */
import { AppState, Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha2';
import { api } from './api';
import { tr } from '../i18n';
import { saveMesaToken } from './storage';
import { aB64 } from '../pulse/candado';
import * as RELEVO from '../pulse/relevo';

const CAJON = 'aura.genesis.pendiente';
/** La vuelta de siempre (esquema propio): la que usa la wallet si no se le pide otra. */
export const VUELTA_ESQUEMA = 'ultronfp://sso';
/** La vuelta por https (App Link verificado). El mismo valor exacto que acepta la wallet. */
export const VUELTA_WEB = 'https://aura-fp.onrender.com/sso';
const VUELTAS = [VUELTA_WEB, VUELTA_ESQUEMA];
/*
 * La que se le pide a la wallet. Solo en Android: el App Link es de Android, y en iOS la pestaña
 * segura (ASWebAuthenticationSession) solo vuelve sola a un esquema propio.
 */
const vueltaPedida = () => (Platform.OS === 'android' ? VUELTA_WEB : VUELTA_ESQUEMA);
/** Lo que se espera un enlace de vuelta después de que la persona regresa a AU-RA sin él. */
const GRACIA_MS = 1500;
const VIDA_PEDIDO_MS = 10 * 60_000;
/** Lo que la entrada espera al relevo del chat después de que AU-RA ya aceptó (ver completar). */
const TOPE_CHAT_MS = 12_000;

type Pendiente = { verificador: string; estado: string; en: number };
export type Miembro = { nombre: string; correo: string; rol: string; gid: string };
/** Lo que Genesis ID compartió con permiso de la persona (la primera vez lo muestra con ✔). */
export type DatosGenesis = { nombre?: string | null; cumple?: string | null };
export type ResultadoGenesis =
  | { ok: true; miembro: Miembro; chat: boolean; genesis?: DatosGenesis }
  | { ok: false; codigo: string; mensaje: string; gid?: string };

const azarB64 = (n: number) => aB64(Crypto.getRandomBytes(n));

/** El verificador (queda aquí) y su huella (viaja). */
export function nuevoReto(): { verificador: string; reto: string } {
  const verificador = azarB64(32);
  // El verificador es base64url (ASCII): sus bytes son sus códigos, sin depender de TextEncoder.
  const reto = aB64(sha256(Uint8Array.from(verificador, (c) => c.charCodeAt(0))));
  return { verificador, reto };
}

/** `decodeURIComponent` que no lanza: un `%` roto en el enlace es un valor que no vino. */
function descifrarParte(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/**
 * Lee `pase`, `error` y `estado` de la vuelta (`https://aura-fp.onrender.com/sso?…` o
 * `ultronfp://sso?…`). El prefijo es EXACTO —después de `sso` solo `?`, `/`, `#` o el fin—:
 * `ultronfp://ssoXYZ` o `https://aura-fp.onrender.com.otro.sitio/sso` no son una vuelta. Y nunca lanza:
 * esto corre dentro del oyente de Linking, y un enlace con un `%` roto tumbaba ese oyente y la espera
 * quedaba sorda hasta el plazo de cinco minutos.
 */
export function leerVuelta(url: string | null | undefined): { pase?: string; error?: string; estado?: string } | null {
  const u = String(url || '');
  const prefijo = VUELTAS.find((p) => u.toLowerCase().startsWith(p));
  if (!prefijo) return null;
  const siguiente = u.charAt(prefijo.length);
  if (siguiente && siguiente !== '?' && siguiente !== '/' && siguiente !== '#') return null;
  const q = u.includes('?') ? u.slice(u.indexOf('?') + 1).split('#')[0] : '';
  const r: Record<string, string> = {};
  for (const par of q.split('&')) {
    if (!par) continue;
    const i = par.indexOf('=');
    const k = descifrarParte(i < 0 ? par : par.slice(0, i));
    const v = i < 0 ? '' : descifrarParte(par.slice(i + 1));
    if (k == null || v == null) continue;
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

/**
 * El enlace con el que arrancó la app se usa UNA vez. Sin esta marca, al salir de la cuenta y volver a
 * la pantalla de entrada, `retomarSiVolvio` leía otra vez el mismo `getInitialURL()` —Android lo
 * guarda mientras viva el proceso— y lo intentaba canjear de nuevo.
 */
let inicialConsumido = false;

/** Al salir: se olvida el pedido a medias y el enlace inicial queda gastado. */
export function olvidarEntrada() {
  inicialConsumido = true;
  void olvidarPendiente();
}
// El relevo avisa al salir de la cuenta (App.tsx llama a `salir` del relevo al cerrar sesión).
RELEVO.alSalir(olvidarEntrada);

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
 * Espera a que vuelva el enlace de vuelta (https o `ultronfp://`) con el `estado` de este pedido.
 *
 * Y si la persona vuelve a AU-RA SIN el enlace —la app Orden Global instalada es de antes de este
 * cambio y no sabe qué es `destino=aura`, o la persona tocó «atrás»— se deja de esperar enseguida
 * (1,5 s de gracia) en vez de dejarla cinco minutos mirando un botón que no responde: `null` y se
 * sigue por la web de la wallet.
 */
function esperarVuelta(ms: number, estadoPedido: string): { promesa: Promise<string | null>; cancelar: () => void } {
  let cancelar = () => {};
  const promesa = new Promise<string | null>((listo) => {
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
    // Solo la vuelta de ESTE pedido (su `estado`) termina la espera: un enlace roto o viejo que llegue
    // antes no se la lleva —antes la cerraba, y la vuelta buena de después ya no tenía quién la oyera—.
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (leerVuelta(url)?.estado === estadoPedido) terminar(url);
    });
    const estado = AppState.addEventListener('change', (st) => {
      if (st !== 'active') {
        seFue = true;
        if (gracia) clearTimeout(gracia);
        return;
      }
      if (seFue) gracia = setTimeout(() => terminar(null), GRACIA_MS);
    });
    const t = setTimeout(() => terminar(null), ms);
    cancelar = () => terminar(null);
  });
  return { promesa, cancelar };
}

const dormir = (ms: number) => new Promise<null>((r) => setTimeout(() => r(null), ms));

/** Pide el pase a la wallet (app o web) y devuelve el enlace de vuelta, o null si no volvió. */
async function pedirPase(reto: string, estado: string): Promise<string | null> {
  const vuelta = vueltaPedida();
  const q =
    `reto=${encodeURIComponent(reto)}&estado=${encodeURIComponent(estado)}` +
    // La wallet vuelve a `ultronfp://sso` si no se le dice nada: solo se manda cuando es la https.
    (vuelta === VUELTA_ESQUEMA ? '' : `&vuelta=${encodeURIComponent(vuelta)}`);
  // 1. La app Orden Global. Si no está instalada, openURL falla y se sigue con la web.
  const espera = esperarVuelta(5 * 60_000, estado);
  try {
    await Linking.openURL(`vetawallet://sso?destino=aura&${q}`);
    const url = await espera.promesa;
    if (url) return url;
    // Volvió sin pase: la app Orden Global no lo dio. Se sigue por la web, con el MISMO reto.
  } catch {
    // No está la app: la web. La espera se suelta YA —antes quedaban sus oyentes de Linking y de
    // AppState vivos cinco minutos, y el de AppState podía «terminar» la de la web al volver—.
    espera.cancelar();
  }
  /*
   * 2. La web de la wallet, en una pestaña segura del sistema, con la vuelta https como redirect.
   *
   * En Android, expo-web-browser no tiene sesión de autenticación nativa: abre una Custom Tab y
   * espera en Linking un enlace que EMPIECE por el redirect. Con el App Link verificado, la vuelta
   * https llega así, igual que llegaba `ultronfp://`. Pero si el dominio no está verificado (o
   * Chrome no suelta la navegación), la vuelta se abre DENTRO de la pestaña: ahí la página /sso del
   * servidor ofrece volver con `intent://…;scheme=ultronfp;package=…`, y ese enlace no empieza por
   * el redirect https. Por eso se espera también por nuestra cuenta (las dos formas, con el `estado`
   * de este pedido) y gana la que llegue primero.
   *
   * Si la pestaña se cierra sin vuelta, se esperan todavía GRACIA_MS por si el enlace llega detrás
   * del cierre; el oyente propio se suelta siempre al terminar.
   */
  const web = `${await walletWeb()}?${q}`;
  const propia = esperarVuelta(5 * 60_000, estado);
  const sesion = WebBrowser.openAuthSessionAsync(web, vuelta).then(
    (r) => (r.type === 'success' ? r.url : null),
    () => null
  );
  try {
    return await Promise.race([
      propia.promesa.then((u) => u ?? sesion),
      sesion.then((u) => u ?? Promise.race([propia.promesa, dormir(GRACIA_MS)])),
    ]);
  } finally {
    propia.cancelar();
  }
}

/**
 * Lo que la wallet manda en `error=` (el contrato con la wallet) → el código y el mensaje de la app.
 * Las pantallas deciden qué hacer con cada código (Entrar.tsx); el mensaje es para quien no tiene
 * un trato propio (el chat, el arranque en frío).
 */
export function errorDeWallet(error: string): { codigo: string; mensaje: string } {
  switch (error) {
    case 'cancelado':
      return { codigo: 'CANCELADO', mensaje: tr('Cancelaste la entrada con Genesis ID.', 'You cancelled signing in with Genesis ID.') };
    case 'sin-gid':
      return {
        codigo: 'SIN_GID',
        mensaje: tr('Tu wallet todavía no tiene un Genesis ID. Crealo y volvé a entrar.', 'Your wallet doesn’t have a Genesis ID yet. Create one and sign in again.'),
      };
    case 'gid-pendiente':
      return {
        codigo: 'GID_PENDIENTE',
        mensaje: tr(
          'Tu Genesis ID está en verificación; cuando lo aprueben, entrás con este mismo botón.',
          'Your Genesis ID is being verified; once it’s approved, sign in with this same button.'
        ),
      };
    case 'no-vinculada':
      return {
        codigo: 'NO_VINCULADA',
        mensaje: tr(
          'Tu cuenta de la wallet no está vinculada a un Genesis ID. Abrí la app Orden Global, vinculá tu Genesis ID a esta cuenta y volvé a tocar «Entrar con Genesis ID».',
          'Your wallet account isn’t linked to a Genesis ID. Open the Orden Global app, link your Genesis ID to this account and tap “Sign in with Genesis ID” again.'
        ),
      };
    case 'correo-sin-confirmar':
      return {
        codigo: 'CORREO_SIN_CONFIRMAR',
        mensaje: tr(
          'Tu correo todavía no está confirmado en la wallet. Abrí el enlace que te mandó Orden Global y volvé a intentar.',
          'Your email isn’t confirmed in the wallet yet. Open the link Orden Global sent you and try again.'
        ),
      };
    case 'limite':
      return {
        codigo: 'LIMITE',
        mensaje: tr('Hubo demasiados intentos seguidos. Esperá unos minutos y volvé a intentar.', 'Too many attempts in a row. Wait a few minutes and try again.'),
      };
    case 'red':
      return {
        codigo: 'RED',
        mensaje: tr(
          'Tu wallet no pudo comunicarse con Genesis ID. Revisá tu conexión y volvé a intentar.',
          'Your wallet couldn’t reach Genesis ID. Check your connection and try again.'
        ),
      };
    default:
      return { codigo: 'FALLO', mensaje: tr('La wallet no pudo darte el pase. Probá de nuevo.', 'The wallet couldn’t give you the pass. Try again.') };
  }
}

/** Lo que contestó el servidor de AU-RA al canjear el pase → código y mensaje de la app. */
function errorDelServidor(e: any): { ok: false; codigo: string; mensaje: string; gid?: string } {
  const cuerpo = e?.data || {};
  const status = Number(e?.status || 0);
  // Sin respuesta (sin internet, o el servidor no contestó a tiempo): se puede reintentar. No es `RED`
  // (la wallet sin Genesis): aquí el que no respondió fue el servidor de AU-RA.
  if (!status) {
    return { ok: false, codigo: 'SIN_CONEXION', mensaje: tr('No pude hablar con AU-RA. Revisá tu conexión y volvé a intentar.', 'I couldn’t reach AU-RA. Check your connection and try again.') };
  }
  if (status === 429) return { ok: false, ...errorDeWallet('limite') };
  // La identidad existe pero Genesis todavía no la dio por verificada: es el mismo caso que `gid-pendiente`.
  if (cuerpo.codigo === 'SIN_VERIFICAR') return { ok: false, ...errorDeWallet('gid-pendiente') };
  return { ok: false, codigo: cuerpo.codigo || String(status), mensaje: cuerpo.error || e?.message || tr('No pude entrar con Genesis ID.', 'I couldn’t sign in with Genesis ID.'), gid: cuerpo.gid };
}

/** Canjea la vuelta: sesión de AU-RA y, con el mismo pase, el chat (sin tocar el nombre del chat). */
async function completar(url: string, p: Pendiente): Promise<ResultadoGenesis> {
  const v = leerVuelta(url);
  if (!v || v.estado !== p.estado) {
    return { ok: false, codigo: 'ESTADO', mensaje: tr('Esa respuesta no es de este inicio de sesión. Probá de nuevo.', 'That response isn’t from this sign-in. Try again.') };
  }
  await olvidarPendiente();
  if (v.error || !v.pase) return { ok: false, ...errorDeWallet(v.error || '') };
  let data: { token?: string; miembro?: Miembro; genesis?: DatosGenesis };
  try {
    data = await api('/api/genesis/entrar', { method: 'POST', body: JSON.stringify({ pase: v.pase, verificador: p.verificador }) }, 20_000, false);
  } catch (e: any) {
    return errorDelServidor(e);
  }
  if (!data?.token || !data.miembro) return { ok: false, codigo: 'FALLO', mensaje: tr('No pude entrar con Genesis ID.', 'I couldn’t sign in with Genesis ID.') };
  await saveMesaToken(data.token);
  // El chat con el MISMO pase (el relevo lo gasta por su lado). Si falla, AU-RA entra igual y el
  // chat ofrece conectarse después. Con tope: AU-RA ya aceptó, y un relevo lento dejaba el botón
  // girando hasta un minuto. Si contesta después del tope, la cuenta del chat queda guardada igual
  // (entrarConPase la guarda al terminar) y la pantalla de chats la encuentra.
  const alta = RELEVO.entrarConPase(v.pase, p.verificador, data.miembro.nombre).then(
    () => true,
    () => false
  );
  const chat = await Promise.race([alta, new Promise<boolean>((r) => setTimeout(() => r(false), TOPE_CHAT_MS))]);
  return { ok: true, miembro: data.miembro, chat, ...(data.genesis ? { genesis: data.genesis } : {}) };
}

/** Todo el viaje: reto, wallet, vuelta y canje. */
export async function entrarConGenesis(): Promise<ResultadoGenesis> {
  const { verificador, reto } = nuevoReto();
  const p: Pendiente = { verificador, estado: azarB64(12), en: Date.now() };
  await guardarPendiente(p);
  const url = await pedirPase(reto, p.estado);
  if (!url) {
    // Sin vuelta no queda nada que retomar: el pedido pendiente se borra (si no, un arranque en frío
    // posterior lo encontraba y esperaba una respuesta que ya no iba a llegar).
    await olvidarPendiente();
    return { ok: false, codigo: 'SIN_VUELTA', mensaje: tr('No volvió la respuesta de la wallet.', 'The wallet’s response didn’t come back.') };
  }
  return completar(url, p);
}

/**
 * Si Android cerró AU-RA mientras la persona estaba en la wallet, la app arranca DE NUEVO con el
 * enlace de vuelta. Esto lo recoge y termina la entrada.
 */
export async function retomarSiVolvio(): Promise<ResultadoGenesis | null> {
  if (inicialConsumido) return null;
  const url = await Linking.getInitialURL().catch(() => null);
  if (!leerVuelta(url)) return null;
  inicialConsumido = true;
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
  if (!v || v.estado !== p.estado) return { ok: false, mensaje: tr('La wallet no devolvió el pase.', 'The wallet didn’t return the pass.') };
  if (v.error || !v.pase) return { ok: false, mensaje: v.error === 'cancelado' ? tr('Cancelado.', 'Cancelled.') : errorDeWallet(v.error || '').mensaje };
  try {
    await RELEVO.entrarConPase(v.pase, verificador);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, mensaje: e?.message || 'El chat no aceptó el pase.' };
  }
}
