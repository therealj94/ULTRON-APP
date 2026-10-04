/**
 * LA SESIÓN DE LA MESA EN ESTE NAVEGADOR: el token firmado que va en `x-ultron-sesion`.
 *
 * Vive en localStorage (o sessionStorage en modo privado). En Safari de iPhone/iPad, además, en una cookie
 * espejo (auditoría del 3-oct, IOS01): iOS copia las cookies a la web instalada en Inicio (desde 17.2)
 * pero NO localStorage, así que quien entraba en Safari y después instalaba el icono abría AURA sin
 * sesión. El icono la recoge de la cookie la primera vez y la vuelve a poner en su localStorage.
 *
 * La cookie es solo un almacén del navegador: el servidor no autentica con ella (sigue leyendo la
 * cabecera), así que no abre la puerta a peticiones de otros sitios (CSRF). Secure + SameSite=Strict +
 * Path=/ y la vida de la sesión (catorce días). Fuera de iOS no se escribe: Android, escritorio y Windows
 * siguen exactamente como antes.
 *
 * Salir (token vacío) purga además lo de la cuenta en este navegador (10-infra/purgaPwa.ts; AUR14): cachés
 * del service worker que pudieran ser suyas, la memoria local por cuenta, la conversación de la pestaña.
 */
import { purgarCuentaPwa } from './purgaPwa';
const KEY = 'ultron_sesion_token';
/** La cookie espejo de iOS. */
export const COOKIE_ESPEJO = 'aura_sesion_ios';
/** Lo que dura la sesión firmada (server/seguridad.ts): catorce días. */
const VIDA_ESPEJO_S = 14 * 86_400;
/** La forma de un token de sesión: lo que no la tenga no se toma por sesión. */
const FORMA_TOKEN = /^[A-Za-z0-9._~+/=-]{16,4096}$/;

function store() {
  try {
    return window.localStorage;
  } catch {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }
}

/** Safari de iPhone/iPad (y el icono instalado): el único que tiene `navigator.standalone`. */
export function esIosWebKit(): boolean {
  try {
    return typeof navigator !== 'undefined' && 'standalone' in navigator;
  } catch {
    return false;
  }
}

/** ¿Corre como icono instalado (iOS «Abrir como app web» o una PWA en modo standalone)? */
export function enIconoInstalado(): boolean {
  try {
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
    return !!window.matchMedia?.('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

/** El valor de una cookie en `document.cookie`, o ''. */
export function leerCookie(cadena: string, nombre: string): string {
  for (const par of String(cadena || '').split(';')) {
    const i = par.indexOf('=');
    if (i < 0 || par.slice(0, i).trim() !== nombre) continue;
    try {
      return decodeURIComponent(par.slice(i + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

/** Solo en iOS y con https (Secure no se puede sin él). */
function espejoPosible(): boolean {
  try {
    return esIosWebKit() && window.location?.protocol === 'https:' && typeof document !== 'undefined';
  } catch {
    return false;
  }
}

function escribirEspejo(token: string) {
  if (!espejoPosible()) return;
  try {
    document.cookie = token
      ? `${COOKIE_ESPEJO}=${encodeURIComponent(token)}; Path=/; Max-Age=${VIDA_ESPEJO_S}; Secure; SameSite=Strict`
      : `${COOKIE_ESPEJO}=; Path=/; Max-Age=0; Secure; SameSite=Strict`;
  } catch {
    /* cookies bloqueadas: queda localStorage */
  }
}

function leerEspejo(): string {
  if (!espejoPosible()) return '';
  try {
    const t = leerCookie(document.cookie, COOKIE_ESPEJO);
    return FORMA_TOKEN.test(t) ? t : '';
  } catch {
    return '';
  }
}

export function guardarTokenMesa(token: string) {
  escribirEspejo(token);
  if (!token) void purgarCuentaPwa().catch(() => undefined);
  const s = store();
  if (!s) return;
  try {
    if (token) s.setItem(KEY, token);
    else s.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

export function tokenMesa(): string {
  let t = '';
  try {
    t = localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || '';
  } catch {
    t = '';
  }
  if (t) return t;
  // El icono recién instalado en iPhone: la sesión llegó en la cookie copiada de Safari.
  const espejo = leerEspejo();
  if (espejo) {
    try {
      store()?.setItem(KEY, espejo);
    } catch {
      /* sin almacenamiento: se sigue leyendo de la cookie */
    }
  }
  return espejo;
}

export function headersMesa(): Record<string, string> {
  const t = tokenMesa();
  return t ? { 'x-ultron-sesion': t } : {};
}
