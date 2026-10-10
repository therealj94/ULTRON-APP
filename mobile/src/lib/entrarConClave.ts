/**
 * ENTRAR CON LA CUENTA DE VETA WALLET (correo y contraseña), sin tener la app Orden Global.
 *
 * José (5-oct), después de probarlo con otra gente: «el log in con veta wallet no deja a otros usuarios,
 * necesito puedan poner su contraseña y entrar bien como en vetawallet.com». Quien no tenía la app se
 * quedaba atascado entre pestañas. Ahora escribe aquí su correo y su contraseña de Veta Wallet y el
 * TELÉFONO hace lo mismo que la web de la wallet en `#sso-aura` (apps-web/veta-wallet/app.js):
 *
 *   1. inventa el verificador y su huella (`reto`, como PKCE) — el mismo `nuevoReto` de genesis.ts;
 *   2. `POST {WALLET_API}/auth/login {email, password}` → `{token, refreshToken, user}`;
 *   3. `POST {WALLET_API}/genesis/sso/token {aud:['aura','pulse2chat'], reto}` con `Bearer <token>` →
 *      `{token: <pase>}` (o `{codigo, error}`: los CODIGOS_SSO de lib/genesisPuente.js);
 *   4. el pase y el verificador siguen por el MISMO camino que cuando la wallet devuelve el pase
 *      (`canjear`: genesis.ts → POST /api/genesis/entrar, canje del chat, primera vez o mesa).
 *   4b. SIN GENESIS ID (José, 5-oct: «que entren solo con Veta Wallet, sin Genesis ID»): si no hubo pase
 *      porque no tiene Genesis ID, lo tiene en revisión, no confirmó el correo o el pase no está disponible,
 *      `entrarSinGenesis` manda el token de la wallet UNA vez a AU-RA (`POST /api/veta/entrar`), que lo
 *      comprueba con la wallet, lo suelta y abre una sesión de miembro (server/veta-entrar.ts). Una clave
 *      mala nunca llega aquí. Sin chat PULSE2CHAT por este camino (pide un pase de Genesis ID).
 *
 *   4c. EL PASE QUE AU-RA NO ACEPTA (10-oct, «pase no válido» al instante con correo y contraseña de la wallet):
 *      la wallet dio un pase pero AU-RA lo rechazó al canjearlo (`PASE_INVALIDO`: p. ej. el backend de la wallet
 *      no le pasa a Genesis el destino `aura` ni el reto, y el pase sale sin destino; Genesis sin verificar; la
 *      clave de AU-RA mal configurada; Genesis caído). El login de la wallet SÍ salió bien, así que se entra
 *      igual por 4b: el token va UNA vez a `/api/veta/entrar` y el SERVIDOR lo comprueba con la wallet. Nunca se
 *      confía en lo que diga el teléfono, y un pase sin destino `aura` sigue sin dar una identidad de Genesis:
 *      la sesión es de miembro `veta:<dirección>`. Una identidad bloqueada, suspendida o en revisión del
 *      padrón NO pasa por aquí (canjeFallidoSeEntraIgual).
 *
 * LA CONTRASEÑA va de este teléfono al backend de la wallet y a ningún otro lado: nunca al servidor de
 * AU-RA, nunca a un registro, nunca a SecureStore. Este módulo no guarda nada en variables de módulo; la
 * clave vive solo en el argumento de esta llamada, y la pantalla la borra de su estado al terminar.
 *
 * EL TOKEN DE LA WALLET se usa para pedir el pase (y, sin Genesis ID, va una vez a AU-RA) y se suelta (sale
 * del alcance al volver). NO se llama a `/auth/logout`: ese sube la versión de sesión y cerraría TODAS las
 * sesiones de la persona en la wallet (su teléfono, su navegador). El token vence solo a los 40 minutos.
 *
 * Es lógica pura (sin react-native): `fetch`, el reto y el canje llegan de fuera, para probarla en node
 * con un fetch de mentira (src/lib/pruebas/entrarConClave.prueba.mjs).
 *
 * Aquí viven también los códigos de la wallet (`errorDeWallet`, los de `?error=` en la vuelta): los dos
 * caminos —el de la vuelta y el de la clave— dicen lo mismo con las mismas palabras.
 */
import { tr } from '../i18n';

/** El backend de Veta Wallet en producción (app.config.js `extra.walletApi` lo cambia). */
export const WALLET_API_POR_OMISION = 'https://vetawallet-1a2e38ac52b1.herokuapp.com';
/** La web de Veta Wallet: sin sesión, su puerta es el login (con «¿Olvidaste tu contraseña?» y «Crear»). */
export const WALLET_WEB = 'https://app.vetawallet.com';
/** Lo que se espera cada llamada a la wallet. Heroku dormido tarda en despertar, pero no tanto. */
export const TOPE_WALLET_MS = 15_000;
/** Para quién es el pase: lo mismo que pide la wallet (app y web). */
export const AUD_AURA = ['aura', 'pulse2chat'];

export type FalloClave = { ok: false; codigo: string; mensaje: string };

type Respuesta = { ok: boolean; status: number; json: () => Promise<unknown> };
type Init = { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal };
export type Pedir = (url: string, init: Init) => Promise<Respuesta>;

export type Dependencias<R> = {
  fetch: Pedir;
  /** Base del backend de la wallet (sin barra final; se le quita si la trae). */
  walletApi: string;
  /** El verificador (se queda aquí) y su huella (viaja a la wallet). */
  nuevoReto: () => { verificador: string; reto: string };
  /** El camino de siempre con el pase de la wallet (genesis.ts). No recibe la contraseña ni el token. */
  canjear: (pase: string, verificador: string) => Promise<R>;
  /**
   * SOLO CON VETA WALLET, SIN GENESIS ID (José, 5-oct; docs/ENTRAR-GENESIS.md caso f): si no hubo pase
   * porque la persona no tiene Genesis ID, lo tiene en revisión, no confirmó su correo o el pase no está
   * disponible, el token de acceso de la wallet va UNA vez a AU-RA (`POST /api/veta/entrar`), que lo
   * comprueba con la wallet y lo suelta. Nunca la contraseña. Si AU-RA tiene ese camino cerrado
   * (`VETA_CERRADO`), se dice lo de Genesis, como antes. Sin esta función, como antes.
   */
  entrarSinGenesis?: (tokenWallet: string) => Promise<R>;
  topeMs?: number;
};

/**
 * Por qué no hubo pase, cuando se puede entrar igual sin Genesis ID: no tiene, está en revisión, el correo
 * de la wallet sin confirmar, la cuenta sin atar a su GID, o el pase no está disponible (Genesis o la ruta
 * caídos). NO: clave mala (ni se llega aquí), identidad rechazada o bloqueada (`GID_NO_DISPONIBLE`), otra
 * identidad (`GID_AJENO`, `CUENTA_NO_ATADA`) ni el freno de Genesis (`LIMITE`).
 */
export function sinPaseSeEntraIgual(status: number, codigo: unknown): boolean {
  if (codigo === 'GID_SIN_IDENTIDAD' || codigo === 'GID_PENDIENTE' || codigo === 'CORREO_NO_VERIFICADO' || codigo === 'CUENTA_NO_VINCULADA' || codigo === 'GENESIS_RED') return true;
  if (typeof codigo === 'string' && codigo) return false;
  // Sin código: un backend de la wallet de antes (contesta «Todavía no hay una identidad verificada» con 403 y sin
  // código, o pasa tal cual el 400/403 de Genesis). Es «no hay pase para ti», no «tu identidad está bloqueada»
  // (eso llega con su código, IDENTIDAD_BLOQUEADA / GID_NO_DISPONIBLE): se entra igual. 401 sigue siendo «la
  // wallet no aceptó la sesión».
  return status === 400 || status === 403 || status === 404 || status >= 500;
}

/**
 * La wallet SÍ dio un pase, pero AU-RA no lo pudo canjear: ¿se entra igual con la cuenta de la wallet (4c)?
 * Sí cuando el problema es el pase o Genesis, no la persona: `PASE_INVALIDO` (sin destino `aura`, reto que no
 * casa, ya usado), `GID_PENDIENTE` (Genesis la tiene sin verificar), `MAL_CONFIGURADO` / `SIN_GENESIS` (la
 * clave de AU-RA) y `GENESIS_CAIDO`. NO: `BLOQUEADA`, `SUSPENDIDA`, `PENDIENTE` (el padrón la conoce y la
 * deja fuera), `CUENTA_SIN_COMPROBAR`, `LIMITE`, `SIN_CONEXION` (AU-RA no contestó: la otra puerta es la misma
 * casa) ni `VENCIDO`.
 */
export function canjeFallidoSeEntraIgual(codigo: unknown): boolean {
  return codigo === 'PASE_INVALIDO' || codigo === 'GID_PENDIENTE' || codigo === 'SIN_VERIFICAR' || codigo === 'MAL_CONFIGURADO' || codigo === 'SIN_GENESIS' || codigo === 'GENESIS_CAIDO';
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
          'Tu Genesis ID está en verificación; cuando lo aprueben, entras con este mismo botón.',
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

/**
 * El código del puente de la wallet (CODIGOS_SSO / CODIGOS_CORREO de lib/genesisPuente.js) → el de
 * `error=` de la vuelta. Es la misma tabla que usa la web de la wallet (`codigoAura`) para devolverle a
 * AU-RA el código: así este camino cae en los mismos tratos de Entrar.tsx que el de la vuelta.
 */
export function errorDelPuente(codigo: unknown, estado: number): string {
  const porCodigo: Record<string, string> = {
    CORREO_NO_VERIFICADO: 'correo-sin-confirmar',
    GID_SIN_IDENTIDAD: 'sin-gid',
    GID_PENDIENTE: 'gid-pendiente',
    CUENTA_NO_VINCULADA: 'no-vinculada',
    LIMITE: 'limite',
    GENESIS_RED: 'red',
  };
  const c = typeof codigo === 'string' ? porCodigo[codigo] : undefined;
  if (c) return c;
  if (estado === 429) return 'limite';
  if (estado >= 500) return 'red';
  return 'fallo';
}

const fallo = (codigo: string, mensaje: string): FalloClave => ({ ok: false, codigo, mensaje });

/** Un correo con forma de correo (lo mismo que exige el `Joi.string().email()` del login, a grandes rasgos). */
export function correoValido(correo: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(correo || '').trim());
}

type Llamada = { tipo: 'respuesta'; status: number; ok: boolean; cuerpo: any } | { tipo: 'red'; tope: boolean };

/**
 * Un POST a la wallet con tope. El tope corta de dos formas: aborta el pedido (AbortController) y, por si
 * el fetch no sabe de señales, deja de esperarlo. Nunca lanza: devuelve la respuesta o `red`.
 */
async function llamar(d: Dependencias<unknown>, url: string, cuerpo: object, token?: string): Promise<Llamada> {
  const tope = d.topeMs ?? TOPE_WALLET_MS;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  let reloj: ReturnType<typeof setTimeout> | null = null;
  const vencio = new Promise<'tope'>((r) => {
    reloj = setTimeout(() => {
      ctl?.abort();
      r('tope');
    }, tope);
  });
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const pedido = d.fetch(url, { method: 'POST', headers, body: JSON.stringify(cuerpo), ...(ctl ? { signal: ctl.signal } : {}) });
    // Si el tope gana, el pedido sigue rechazando por su lado (abortado): que no quede sin atender.
    pedido.catch(() => {});
    const r = await Promise.race([pedido, vencio]);
    if (r === 'tope') return { tipo: 'red', tope: true };
    const datos = await r.json().catch(() => ({}));
    return { tipo: 'respuesta', status: r.status, ok: r.ok, cuerpo: datos || {} };
  } catch (e: any) {
    return { tipo: 'red', tope: e?.name === 'AbortError' };
  } finally {
    if (reloj) clearTimeout(reloj);
  }
}

function falloRed(tope: boolean): FalloClave {
  return tope
    ? fallo('RED_WALLET', tr('Veta Wallet tardó demasiado en responder. Revisa tu conexión y vuelve a intentar.', 'Veta Wallet took too long to answer. Check your connection and try again.'))
    : fallo('RED_WALLET', tr('No pude comunicarme con Veta Wallet. Revisa tu conexión y vuelve a intentar.', 'I couldn’t reach Veta Wallet. Check your connection and try again.'));
}

/** Lo que contestó `/auth/login` cuando no fue un 200. */
function falloLogin(status: number): FalloClave {
  // 401: correo o contraseña malos (la wallet no dice cuál, a propósito). 400: el formulario no pasó su
  // validación (p. ej. una contraseña de menos de 8): tampoco es la contraseña de nadie.
  if (status === 401 || status === 400) return fallo('CLAVE_MALA', tr('Correo o contraseña incorrectos.', 'Wrong email or password.'));
  // El freno de la wallet: 20 intentos cada 15 minutos por conexión.
  if (status === 429) return fallo('LIMITE', tr('Demasiados intentos; espera 15 minutos y vuelve a intentar.', 'Too many attempts; wait 15 minutes and try again.'));
  return fallo('WALLET_CAIDA', tr('Veta Wallet no respondió bien. Vuelve a intentar en un momento.', 'Veta Wallet didn’t respond properly. Try again in a moment.'));
}

/** Lo que contestó `/genesis/sso/token` cuando no hubo pase. */
function falloPase(status: number, cuerpo: any): FalloClave {
  const codigo = cuerpo?.codigo;
  const delServidor = typeof cuerpo?.error === 'string' && cuerpo.error ? cuerpo.error : '';
  if (codigo === 'CORREO_NO_VERIFICADO') {
    return fallo(
      'CORREO_SIN_CONFIRMAR',
      tr(
        'Confirma tu correo en Veta Wallet: abre el enlace que te mandamos al crear tu cuenta y vuelve a intentar.',
        'Confirm your email in Veta Wallet: open the link we sent you when you created your account and try again.'
      )
    );
  }
  // Rechazada, suspendida o bloqueada: la wallet no dice cuál (se lo dice su tarjeta en la wallet).
  if (codigo === 'GID_NO_DISPONIBLE') {
    return fallo('GID_NO_DISPONIBLE', delServidor || tr('Tu Genesis ID no puede usarse para entrar en otras aplicaciones.', 'Your Genesis ID can’t be used to sign in to other apps.'));
  }
  // La sesión recién abierta no valió (no debería pasar): se dice tal cual, sin culpar a la persona.
  if (status === 401) return fallo('FALLO', tr('Veta Wallet no aceptó la sesión. Vuelve a intentar.', 'Veta Wallet didn’t accept the session. Try again.'));
  const error = errorDelPuente(codigo, status);
  if (error === 'fallo') {
    // Un código que la app no conoce (CUENTA_NO_ATADA, GID_AJENO…): el texto de la wallet dice qué pasa.
    return fallo(typeof codigo === 'string' && codigo ? codigo : 'FALLO', delServidor || errorDeWallet('fallo').mensaje);
  }
  if (error === 'limite') {
    return fallo('LIMITE', tr('Demasiados intentos; espera unos minutos y vuelve a intentar.', 'Too many attempts; wait a few minutes and try again.'));
  }
  return { ok: false, ...errorDeWallet(error) };
}

/** El pase de `/genesis/sso/token`. */
function pedirPase(d: Dependencias<unknown>, base: string, token: string, reto: string) {
  return llamar(d, `${base}/genesis/sso/token`, { aud: AUD_AURA, reto }, token);
}

/** La base sin barra final (y la de siempre si viene vacía o sin https). */
export function baseWallet(walletApi: string | null | undefined): string {
  const b = String(walletApi || '').trim().replace(/\/+$/, '');
  // Solo https (revisión de seguridad del 5-oct): por http la contraseña viajaría en claro.
  return /^https:\/\//.test(b) ? b : WALLET_API_POR_OMISION;
}

/**
 * Todo el camino con la clave: login en la wallet, pase de Genesis ID y canje por el camino de siempre.
 * Devuelve lo que devuelva `canjear`, o un fallo con su código y su mensaje. Nunca lanza por la red.
 */
export async function entrarConClave<R>(datos: { correo: string; clave: string }, d: Dependencias<R>): Promise<R | FalloClave> {
  const correo = String(datos.correo || '').trim();
  if (!correoValido(correo)) return fallo('CORREO_INVALIDO', tr('Escribe el correo de tu cuenta de Veta Wallet.', 'Enter the email of your Veta Wallet account.'));
  if (!datos.clave) return fallo('SIN_CLAVE', tr('Escribe tu contraseña de Veta Wallet.', 'Enter your Veta Wallet password.'));
  const base = baseWallet(d.walletApi);
  const { verificador, reto } = d.nuevoReto();

  // 1. La sesión de la wallet. El correo va como lo escribió la persona (sin espacios), igual que la web.
  const login = await llamar(d, `${base}/auth/login`, { email: correo, password: datos.clave });
  // Desde aquí la contraseña ya no se usa ni se pasa a nadie.
  if (login.tipo === 'red') return falloRed(login.tope);
  if (!login.ok) return falloLogin(login.status);
  const c = login.cuerpo || {};
  const token: string = c.token || c.accessToken || c.access_token || c.data?.token || '';
  if (!token) return fallo('FALLO', tr('Veta Wallet no abrió la sesión. Vuelve a intentar.', 'Veta Wallet didn’t open the session. Try again.'));

  // 2. El pase. Si la cuenta verificada todavía no estaba atada a su GID, se ata y se pide UNA vez más:
  //    es lo que hace la wallet sola en cada carga, y lo que hace su web antes de devolver a AU-RA.
  let pase = await pedirPase(d, base, token, reto);
  if (pase.tipo === 'respuesta' && !pase.ok && pase.cuerpo?.codigo === 'CUENTA_NO_VINCULADA') {
    const ata = await llamar(d, `${base}/genesis/vincular`, {}, token);
    if (ata.tipo === 'respuesta' && ata.ok) pase = await pedirPase(d, base, token, reto);
  }
  if (pase.tipo === 'red' || !pase.ok) {
    const porGenesis = pase.tipo === 'red' ? falloRed(pase.tope) : falloPase(pase.status, pase.cuerpo);
    // 2b. Sin pase pero con la cuenta de la wallet: se entra igual, como miembro, sin Genesis ID.
    const seEntraIgual = pase.tipo === 'red' ? true : sinPaseSeEntraIgual(pase.status, pase.cuerpo?.codigo);
    if (!d.entrarSinGenesis || !seEntraIgual) return porGenesis;
    const r: any = await d.entrarSinGenesis(token);
    // AU-RA cerró este camino (AURA_VETA_ABIERTO=0): lo de Genesis, como antes (p. ej. «Crea tu Genesis ID»).
    if (r && r.ok === false && r.codigo === 'VETA_CERRADO') return porGenesis;
    return r as R;
  }
  const elPase: string = pase.cuerpo?.token || '';
  if (!elPase) return { ok: false, ...errorDeWallet('fallo') };

  // 3. El camino de siempre. El token de la wallet se queda aquí y se suelta al volver (sin /auth/logout).
  const canje: any = await d.canjear(elPase, verificador);
  // 3b. AU-RA no aceptó el pase, pero la cuenta de la wallet es buena: se entra igual como miembro (4c). El
  //     servidor vuelve a comprobar el token con la wallet; aquí no se decide nada por la persona.
  if (canje && canje.ok === false && d.entrarSinGenesis && canjeFallidoSeEntraIgual(canje.codigo)) {
    const r: any = await d.entrarSinGenesis(token);
    // Camino cerrado en AU-RA (AURA_VETA_ABIERTO=0): lo que dijo el canje, como antes.
    if (r && r.ok === false && r.codigo === 'VETA_CERRADO') return canje as R;
    return r as R;
  }
  return canje as R;
}

/**
 * «¿Olvidaste tu contraseña?»: el mismo pedido que hace la web de la wallet
 * (`POST /auth/recuperarPassword {email}`). La wallet contesta lo mismo exista o no la cuenta (para que
 * nadie averigüe quién está registrado) y manda el enlace a `app.vetawallet.com/?token=…`.
 * `true` si la wallet recibió el pedido; `false` si no se pudo hablar con ella (la pantalla ofrece la web).
 */
export async function pedirRecuperacion(correo: string, d: Pick<Dependencias<unknown>, 'fetch' | 'walletApi' | 'topeMs'>): Promise<boolean> {
  const c = String(correo || '').trim();
  if (!correoValido(c)) return false;
  const r = await llamar({ ...d, nuevoReto: () => ({ verificador: '', reto: '' }), canjear: async () => null }, `${baseWallet(d.walletApi)}/auth/recuperarPassword`, { email: c });
  return r.tipo === 'respuesta' && r.ok;
}
