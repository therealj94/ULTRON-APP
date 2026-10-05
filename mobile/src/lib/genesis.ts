/**
 * ENTRAR CON GENESIS ID.
 *
 * El servidor de AU-RA no ve nunca la contraseña de la wallet. Lo que canjea es un PASE de Genesis ID
 * que da la wallet de la persona:
 *
 *   1. Si el teléfono tiene la app Orden Global: `vetawallet://sso?destino=aura&reto=…&estado=…&vuelta=…`.
 *      La app muestra «AU-RA quiere usar tu Genesis ID», la persona toca «Permitir» y vuelve aquí
 *      con `…/sso?pase=…&estado=…` (o `error=…&estado=…`).
 *   2. Si no la tiene: NO se salta sola a ningún lado. Vuelve `SIN_WALLET` y la pantalla dice qué
 *      pasa, con «Instalar Orden Global», «Usar Veta Wallet en la web» (`{ web: true }`: la web de la
 *      wallet, `#sso-aura`, en una pestaña segura, con el mismo consentimiento y la misma vuelta) y
 *      «Entrar con mi correo».
 *   3. Con su correo y su contraseña de Veta Wallet, aquí mismo (`entrarConVetaWallet`, para quien no
 *      tiene la app): el TELÉFONO hace login en el backend de la wallet, pide el pase con su reto y sigue
 *      por el mismo canje (`canjearPase`). La contraseña va del teléfono a la wallet y a nadie más: ni al
 *      servidor de AU-RA ni a ningún cajón (lib/entrarConClave.ts). Sin Genesis ID (no tiene, en revisión,
 *      correo sin confirmar), el token de la wallet va UNA vez a `POST /api/veta/entrar` y entra como
 *      miembro, sin chat (`entrarSoloConWallet`, server/veta-entrar.ts).
 *
 * SIN GENESIS ID. La wallet nueva no devuelve a la persona con las manos vacías: le ofrece sacar su
 * Genesis ID ahí mismo y GUARDA EL PEDIDO media hora (su `AURA_VIVE_MS`). Al terminar el trámite
 * sigue al «Permitir» y vuelve aquí con el pase de ESTE pedido (mismo reto, mismo estado). Por eso
 * el pedido de aquí vive lo mismo (VIDA_PEDIDO_MS) y la vuelta se atiende aunque llegue tarde:
 *   · con AU-RA cerrada, `retomarSiVolvio` (arranque en frío);
 *   · con AU-RA abierta y ya sin espera, `escucharVueltaTardia` (lo pone la pantalla de entrar).
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
 *
 * CADA ENTRADA ES UN INTENTO (lib/intentoEntrada.ts, auditoría del 3-oct AUTH03). Su token solo se guarda
 * si sigue siendo el último intento de entrar: una vuelta que llega después de que la persona eligió
 * otra forma (la clave, otra vez Genesis) no pisa a la nueva, ni gasta el pase. La vuelta tardía es del
 * intento que dejó el pedido guardado.
 */
import { AppState, Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha2';
import { api } from './api';
import { tr } from '../i18n';
import { empezarIntento, esVencida, guardarTokenDeEntrada, intentoVigente, type Intento } from './intentoEntrada';
import Constants from 'expo-constants';
import { aB64 } from '../pulse/candado';
import * as RELEVO from '../pulse/relevo';
import { baseWallet, entrarConClave, errorDeWallet, pedirRecuperacion, type Pedir } from './entrarConClave';

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
/**
 * Lo que vive un pedido a la wallet: lo mismo que lo guarda la wallet (AURA_VIVE_MS de la app Orden
 * Global), porque sacar el Genesis ID —documento, selfie— cabe en media hora y no en diez minutos.
 * Es solo cuánto se acepta una vuelta con este `estado`; el pase sigue siendo de un uso, con destino
 * y con reto, y vence en Genesis a su hora.
 */
export const VIDA_PEDIDO_MS = 30 * 60_000;
/** Lo que la entrada espera al relevo del chat después de que AU-RA ya aceptó (ver completar). */
const TOPE_CHAT_MS = 12_000;

type Pendiente = { verificador: string; estado: string; en: number };
export type Miembro = { nombre: string; correo: string; rol: string; gid: string };
/** Lo que Genesis ID compartió con permiso de la persona (la primera vez lo muestra con ✔). */
export type DatosGenesis = { nombre?: string | null; cumple?: string | null };
/**
 * `intento`: el de esta entrada; quien la termina (app/sesion.ts entrarCon) lo pasa para que una entrada
 * que ya no es la última no fije a nadie. `VENCIDO`: otra entrada empezó (o «atrás») antes de que esta
 * guardara: la pantalla no dice nada.
 */
export type ResultadoGenesis =
  | { ok: true; miembro: Miembro; chat: boolean; genesis?: DatosGenesis; intento: Intento }
  | { ok: false; codigo: string; mensaje: string; gid?: string };
/** `web`: ir directo a la web de Veta Wallet (quien no tiene la app y eligió la web). */
export type OpcionesEntrada = { web?: boolean };

/**
 * Cuántas entradas hay en curso (de pedir el pase a terminar de canjearlo). Con alguna, la vuelta que
 * llegue es suya y no de la tardía: así un mismo pase nunca se canjea dos veces desde aquí.
 */
let enCurso = 0;
/** Una vuelta tardía a la vez (la https y la `ultronfp://` pueden llegar las dos). */
let canjeandoTardia = false;
/** Corre `f` contando como entrada en curso. */
async function enCursoMientras<T>(f: () => Promise<T>): Promise<T> {
  enCurso++;
  try {
    return await f();
  } finally {
    enCurso = Math.max(0, enCurso - 1);
  }
}

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

/**
 * El intento que dejó guardado el pedido de ahora (en este arranque). Su vuelta tardía solo entra si ese
 * intento sigue siendo el último: si después la persona entró por otro lado (o lo intentó), no la pisa.
 * null: el pedido es de un arranque anterior (o no hay): su vuelta abre un intento propio, como antes.
 */
let intentoDelPedido: Intento | null = null;

/** Al salir: se olvida el pedido a medias y el enlace inicial queda gastado. */
export function olvidarEntrada() {
  inicialConsumido = true;
  intentoDelPedido = null;
  void olvidarPendiente();
}

const vencido = (): { ok: false; codigo: string; mensaje: string } => ({
  ok: false,
  codigo: 'VENCIDO',
  mensaje: tr('Esa entrada ya no es la de ahora.', 'That sign-in is no longer the current one.'),
});
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

/**
 * Lo que pasó al pedir el pase: el enlace de vuelta (o null), si la app Orden Global llegó a abrirse
 * (entonces puede seguir guardando el pedido: la vuelta puede llegar tarde) y si no está instalada.
 */
type Pedido = { url: string | null; appAbierta: boolean; sinApp: boolean };

/** Pide el pase a la wallet (app o, si se pide, web) y devuelve el enlace de vuelta, o null si no volvió. */
async function pedirPase(reto: string, estado: string, o: { web?: boolean } = {}): Promise<Pedido> {
  const vuelta = vueltaPedida();
  const q =
    `reto=${encodeURIComponent(reto)}&estado=${encodeURIComponent(estado)}` +
    // La wallet vuelve a `ultronfp://sso` si no se le dice nada: solo se manda cuando es la https.
    (vuelta === VUELTA_ESQUEMA ? '' : `&vuelta=${encodeURIComponent(vuelta)}`);
  let appAbierta = false;
  if (!o.web) {
    /*
     * 1. La app Orden Global. Si no está instalada, openURL falla. La espera dura lo que vive el
     *    pedido: mientras la persona saca su Genesis ID en la wallet, AU-RA espera en segundo plano
     *    (antes eran cinco minutos y, vencidos, se abría la web por detrás de la wallet).
     */
    const espera = esperarVuelta(VIDA_PEDIDO_MS, estado);
    try {
      await Linking.openURL(`vetawallet://sso?destino=aura&${q}`);
      appAbierta = true;
    } catch {
      // No está la app. La espera se suelta YA —antes quedaban sus oyentes de Linking y de AppState
      // vivos, y el de AppState podía «terminar» la de la web al volver—.
      espera.cancelar();
      return { url: null, appAbierta: false, sinApp: true };
    }
    const url = await espera.promesa;
    if (url) return { url, appAbierta, sinApp: false };
    // Volvió sin pase: una app Orden Global de antes, que no sabe de `destino=aura`, o la persona
    // volvió a mano. Se sigue por la web, con el MISMO reto y el mismo estado.
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
    const url = await Promise.race([
      propia.promesa.then((u) => u ?? sesion),
      sesion.then((u) => u ?? Promise.race([propia.promesa, dormir(GRACIA_MS)])),
    ]);
    return { url, appAbierta, sinApp: false };
  } finally {
    propia.cancelar();
  }
}

/** Los códigos de `error=` de la wallet viven con la entrada con clave (los dos caminos dicen lo mismo). */
export { errorDeWallet };

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

/**
 * Canjea la vuelta: sesión de AU-RA y, con el mismo pase, el chat (sin tocar el nombre del chat). Si el
 * intento ya no es el último, ni se canjea el pase ni se guarda el token (`VENCIDO`).
 */
async function completar(url: string, p: Pendiente, intento: Intento): Promise<ResultadoGenesis> {
  const v = leerVuelta(url);
  if (!v || v.estado !== p.estado) {
    return { ok: false, codigo: 'ESTADO', mensaje: tr('Esa respuesta no es de este inicio de sesión. Probá de nuevo.', 'That response isn’t from this sign-in. Try again.') };
  }
  if (!intentoVigente(intento)) return vencido();
  await olvidarPendiente();
  if (v.error || !v.pase) return { ok: false, ...errorDeWallet(v.error || '') };
  return canjearPase(v.pase, p.verificador, intento);
}

/**
 * Con el pase en la mano (venga de la vuelta de la wallet o de la entrada con clave): la sesión de AU-RA
 * y, con el mismo pase, el chat. Al servidor de AU-RA solo viajan el pase y el verificador.
 */
function canjearPase(pase: string, verificador: string, intento: Intento): Promise<ResultadoGenesis> {
  return abrirSesion('/api/genesis/entrar', { pase, verificador }, intento, { pase, verificador });
}

/**
 * SIN GENESIS ID (docs/ENTRAR-GENESIS.md caso f): el token de acceso de la wallet va UNA vez a AU-RA, que lo
 * comprueba con la wallet y lo suelta (server/veta-entrar.ts). Sesión de miembro; sin chat (su alta pide un
 * pase de Genesis ID: la pantalla de chats ofrece conectarlo después).
 */
function entrarSoloConWallet(tokenWallet: string, intento: Intento): Promise<ResultadoGenesis> {
  return abrirSesion('/api/veta/entrar', { token: tokenWallet }, intento);
}

/**
 * Pide la sesión a AU-RA (`ruta` con `cuerpo`) y la guarda si sigue siendo el último intento; con `chat`
 * (el pase y su verificador), conecta además el chat con el mismo pase.
 */
async function abrirSesion(ruta: string, cuerpo: object, intento: Intento, chatCon?: { pase: string; verificador: string }): Promise<ResultadoGenesis> {
  if (!intentoVigente(intento)) return vencido();
  let data: { token?: string; miembro?: Miembro; genesis?: DatosGenesis };
  try {
    data = await api(ruta, { method: 'POST', body: JSON.stringify(cuerpo) }, 20_000, false);
  } catch (e: any) {
    if (esVencida(e) || !intentoVigente(intento)) return vencido();
    return errorDelServidor(e);
  }
  if (!data?.token || !data.miembro) return { ok: false, codigo: 'FALLO', mensaje: tr('No pude entrar a AU-RA.', 'I couldn’t sign in to AU-RA.') };
  // Solo si sigue siendo el último intento de entrar (otro empezó mientras se canjeaba: no lo pisa).
  if (!(await guardarTokenDeEntrada(data.token, intento))) return vencido();
  if (!chatCon) return { ok: true, miembro: data.miembro, chat: false, intento };
  const { pase, verificador } = chatCon;
  // El chat con el MISMO pase (el relevo lo gasta por su lado). Si falla, AU-RA entra igual y el
  // chat ofrece conectarse después. Con tope: AU-RA ya aceptó, y un relevo lento dejaba el botón
  // girando hasta un minuto. Si contesta después del tope, la cuenta del chat queda guardada igual
  // (entrarConPase la guarda al terminar) y la pantalla de chats la encuentra.
  // El chat queda ligado a esta persona de AU-RA (la sesión todavía no se fijó: se dice quién es).
  const alta = RELEVO.entrarConPase(pase, verificador, data.miembro.nombre, data.miembro.correo).then(
    () => true,
    () => false
  );
  const chat = await Promise.race([alta, new Promise<boolean>((r) => setTimeout(() => r(false), TOPE_CHAT_MS))]);
  return { ok: true, miembro: data.miembro, chat, ...(data.genesis ? { genesis: data.genesis } : {}), intento };
}

/** Todo el viaje: reto, wallet, vuelta y canje. Es un intento de entrar nuevo: vence a los anteriores. */
export function entrarConGenesis(o: OpcionesEntrada = {}): Promise<ResultadoGenesis> {
  return enCursoMientras(() => entrar(o));
}

async function entrar(o: OpcionesEntrada): Promise<ResultadoGenesis> {
  const intento = empezarIntento();
  intentoDelPedido = intento;
  const { verificador, reto } = nuevoReto();
  const p: Pendiente = { verificador, estado: azarB64(12), en: Date.now() };
  await guardarPendiente(p);
  const { url, appAbierta, sinApp } = await pedirPase(reto, p.estado, { web: o.web });
  if (sinApp) {
    // Sin la app no hay quién guarde el pedido: se borra, y la pantalla ofrece instalarla, la web o el correo.
    await olvidarPendiente();
    return {
      ok: false,
      codigo: 'SIN_WALLET',
      mensaje: tr(
        'No encontramos la app Orden Global (tu Veta Wallet) en este teléfono.',
        'We couldn’t find the Orden Global app (your Veta Wallet) on this phone.'
      ),
    };
  }
  if (!url) {
    /*
     * Sin vuelta. Si la app Orden Global llegó a abrirse, el pedido se QUEDA: la wallet puede tenerlo
     * guardado mientras la persona saca su Genesis ID y devolverlo después (escucharVueltaTardia, o
     * retomarSiVolvio si AU-RA ya no está abierta). Vence solo (VIDA_PEDIDO_MS) y el próximo intento lo
     * reemplaza. Si solo hubo web, no lo guarda nadie: se borra.
     */
    if (!appAbierta) await olvidarPendiente();
    return { ok: false, codigo: 'SIN_VUELTA', mensaje: tr('No volvió la respuesta de la wallet.', 'The wallet’s response didn’t come back.') };
  }
  return completar(url, p, intento);
}

/**
 * El backend de Veta Wallet (`extra.walletApi` de la configuración si lo hay; por omisión el de producción,
 * WALLET_API_POR_OMISION). La entrada con clave le habla directo desde el teléfono: la contraseña no pasa por
 * el servidor de AU-RA. OJO: no se pone en app.config.js sin necesidad: `extra` entra en la huella
 * (runtimeVersion: fingerprint), y cambiarlo deja a las APK instaladas sin esta OTA.
 */
export const WALLET_API = baseWallet((Constants.expoConfig?.extra as { walletApi?: string } | undefined)?.walletApi);

/** El fetch del teléfono, con la forma que pide lib/entrarConClave.ts. */
const fetchWallet: Pedir = (url, init) => fetch(url, init);

/**
 * ENTRAR CON LA CUENTA DE VETA WALLET (correo y contraseña), para quien no tiene la app Orden Global
 * (lib/entrarConClave.ts, docs/ENTRAR-GENESIS.md caso e). El teléfono hace login en la wallet, pide el pase
 * con su propio reto y sigue por `canjearPase`, el mismo camino que la vuelta de la wallet. Es un intento
 * de entrar nuevo: vence a los anteriores (una vuelta tardía de la wallet ya no lo pisa).
 * La clave no se guarda en ningún lado; quien llama la borra de su estado al terminar.
 */
export function entrarConVetaWallet(correo: string, clave: string): Promise<ResultadoGenesis> {
  return enCursoMientras(async () => {
    const intento = empezarIntento();
    const r = await entrarConClave<ResultadoGenesis>(
      { correo, clave },
      {
        fetch: fetchWallet,
        walletApi: WALLET_API,
        nuevoReto,
        canjear: (pase, verificador) => canjearPase(pase, verificador, intento),
        // Sin Genesis ID: el token de la wallet, una vez, a AU-RA. Nunca la contraseña.
        entrarSinGenesis: (tokenWallet) => entrarSoloConWallet(tokenWallet, intento),
      }
    );
    // Si mientras tanto empezó otra entrada, esta no tiene nada que decir.
    if (!r.ok && r.codigo !== 'VENCIDO' && !intentoVigente(intento)) return vencido();
    return r;
  });
}

/** «¿Olvidaste tu contraseña?»: el enlace de la wallet a ese correo (lib/entrarConClave.ts). */
export function recuperarClaveWallet(correo: string): Promise<boolean> {
  return pedirRecuperacion(correo, { fetch: fetchWallet, walletApi: WALLET_API });
}

/**
 * La vuelta que llega TARDE, con AU-RA abierta y sin nadie esperando: la wallet guardó el pedido
 * mientras la persona sacaba su Genesis ID y ahora vuelve con el pase (o con `error=`). Si el enlace es
 * una vuelta y su `estado` es el del pedido guardado (vivo), se canjea igual que a tiempo; si no, nada.
 * Devuelve cómo dejar de escuchar. Lo pone la pantalla de entrar mientras está montada.
 */
export function escucharVueltaTardia(alVolver: (r: ResultadoGenesis) => void): () => void {
  const sub = Linking.addEventListener('url', ({ url }) => {
    void (async () => {
      const v = leerVuelta(url);
      if (!v || !v.estado || enCurso > 0 || canjeandoTardia) return;
      canjeandoTardia = true;
      try {
        const p = await leerPendiente();
        if (!p || p.estado !== v.estado || enCurso > 0) return;
        // Es del intento que dejó el pedido: si la persona ya entró (o lo intentó) por otro lado, esta
        // vuelta no la pisa ni gasta el pase. Un pedido de un arranque anterior abre su propio intento.
        const intento = intentoDelPedido ?? empezarIntento();
        if (!intentoVigente(intento)) return;
        alVolver(await enCursoMientras(() => completar(url, p, intento)));
      } catch {
        /* una vuelta rota no tumba al oyente */
      } finally {
        canjeandoTardia = false;
      }
    })();
  });
  return () => sub.remove();
}

/**
 * Si Android cerró AU-RA mientras la persona estaba en la wallet, la app arranca DE NUEVO con el
 * enlace de vuelta. Esto lo recoge y termina la entrada.
 */
export function retomarSiVolvio(): Promise<ResultadoGenesis | null> {
  return enCursoMientras(retomar);
}

async function retomar(): Promise<ResultadoGenesis | null> {
  if (inicialConsumido) return null;
  const url = await Linking.getInitialURL().catch(() => null);
  if (!leerVuelta(url)) return null;
  inicialConsumido = true;
  const p = await leerPendiente();
  if (!p) return null;
  // Arranque en frío: nadie más está entrando; es un intento nuevo.
  return completar(url as string, p, empezarIntento());
}

/** Solo el chat: para quien ya está dentro de AU-RA y quiere conectar PULSE2CHAT. */
export function conectarChat(): Promise<{ ok: boolean; mensaje?: string }> {
  return enCursoMientras(conectar);
}

async function conectar(): Promise<{ ok: boolean; mensaje?: string }> {
  const { verificador, reto } = nuevoReto();
  const p: Pendiente = { verificador, estado: azarB64(12), en: Date.now() };
  // Este pedido es del chat, no de una entrada: su vuelta no es la tardía de nadie.
  intentoDelPedido = null;
  await guardarPendiente(p);
  // Quien ya está dentro de AU-RA: si no hay app, la web (como siempre para el chat).
  let { url, sinApp } = await pedirPase(reto, p.estado);
  if (sinApp) url = (await pedirPase(reto, p.estado, { web: true })).url;
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
