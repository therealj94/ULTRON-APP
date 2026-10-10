/**
 * LA CUENTA DE AU-RA (correo y contraseña): lo que se comprueba en el teléfono antes de mandar nada y lo que
 * se le dice a la persona cuando el servidor contesta que no (José, 10-oct: «login y registro que simplemente
 * funcionen, sin abrir ninguna otra app»).
 *
 *   · Entrar:       POST /api/ultron/entrar        { correo, clave }            (lib/api.ts loginClave)
 *   · Crear cuenta: POST /api/ultron/cuentas/crear { nombre, correo, clave }    (lib/api.ts crearCuenta)
 *   · Confirmar:    POST /api/ultron/cuentas/confirmar { codigo } / reenviar   (con la sesión recién abierta)
 *
 * Las reglas de la contraseña son las MISMAS que las del servidor (server/cuentas.ts `problemaDeClave`): si el
 * teléfono deja pasar una, el servidor la acepta; si la rechaza, se dice aquí mismo, debajo del campo.
 *
 * Los mensajes separan lo que la persona puede arreglar (contraseña mala, correo mal escrito, código vencido)
 * de lo que no (sin conexión, servidor ocupado): «Correo o contraseña incorrectos» nunca sale por una red caída.
 * Un correo que ya tiene cuenta no se distingue de uno de la junta (el servidor contesta lo mismo).
 *
 * Lógica pura (sin react-native): la prueban en node src/lib/pruebas/cuentaPropia.prueba.mjs.
 */
import { tr } from '../i18n';

export type CampoCuenta = 'nombre' | 'correo' | 'clave' | 'confirmar' | 'codigo';
/** Un error para la pantalla: debajo de un campo (`campo`) o debajo del formulario. */
export type ErrorCuenta = { campo?: CampoCuenta; mensaje: string; codigo?: string };

/** Un correo con forma de correo (lo mismo que lib/correo-ses.ts `correoValido` del servidor). */
export function correoConForma(c: string): boolean {
  const s = String(c || '').trim();
  return s.length <= 254 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i.test(s);
}

/** Lo que se le explica a la persona al elegir su contraseña. */
export const reglasClave = () => tr('Mínimo 10 caracteres. Una frase que recuerdes sirve mejor que una palabra rara.', 'At least 10 characters. A phrase you remember works better than an odd word.');

/** Qué tiene de malo una contraseña nueva, o null (las reglas de server/cuentas.ts `problemaDeClave`). */
export function problemaDeClave(clave: string, correo = ''): string | null {
  const c = String(clave ?? '');
  if (c.length < 10) return tr('La contraseña necesita al menos 10 caracteres.', 'The password needs at least 10 characters.');
  if (c.length > 200) return tr('La contraseña es demasiado larga (máximo 200 caracteres).', 'The password is too long (200 characters max).');
  if (/^(.)\1+$/.test(c)) return tr('La contraseña no puede ser un mismo carácter repetido.', 'The password can’t be one repeated character.');
  if (/^\d+$/.test(c)) return tr('La contraseña no puede ser solo números.', 'The password can’t be only numbers.');
  const local = String(correo).trim().split('@')[0].toLowerCase();
  if (local.length >= 4 && c.toLowerCase().includes(local)) return tr('La contraseña no puede contener tu correo.', 'The password can’t contain your email.');
  return null;
}

/** El formulario de «Crear cuenta», antes de mandarlo. null = se puede mandar. */
export function validarRegistro(d: { nombre: string; correo: string; clave: string; confirmar: string }): ErrorCuenta | null {
  const nombre = String(d.nombre || '').replace(/\s+/g, ' ').trim();
  if (nombre.length < 2 || nombre.length > 80) return { campo: 'nombre', mensaje: tr('Escribe tu nombre.', 'Enter your name.') };
  if (!correoConForma(d.correo)) return { campo: 'correo', mensaje: tr('Escribe un correo válido, como tu@correo.com.', 'Enter a valid email, like you@email.com.') };
  const p = problemaDeClave(d.clave, d.correo);
  if (p) return { campo: 'clave', mensaje: p };
  if (d.clave !== d.confirmar) return { campo: 'confirmar', mensaje: tr('Las dos contraseñas no coinciden.', 'The two passwords don’t match.') };
  return null;
}

/** El formulario de «Entrar», antes de mandarlo. */
export function validarEntrada(d: { correo: string; clave: string }): ErrorCuenta | null {
  if (!correoConForma(d.correo)) return { campo: 'correo', mensaje: tr('Escribe el correo de tu cuenta.', 'Enter your account email.') };
  if (!d.clave) return { campo: 'clave', mensaje: tr('Escribe tu contraseña.', 'Enter your password.') };
  return null;
}

/** Solo las cifras, hasta 6 (el código del correo se puede pegar con espacios o guiones). */
export function normalizarCodigo(t: string): string {
  return String(t || '').replace(/\D/g, '').slice(0, 6);
}

type ErrorApi = { status?: number; data?: { codigo?: string; code?: string; error?: string }; message?: string; name?: string } | null | undefined;

const sinConexion = (): ErrorCuenta => ({
  codigo: 'SIN_CONEXION',
  mensaje: tr('No pude hablar con AU-RA. Revisa tu conexión a internet y vuelve a intentar.', 'I couldn’t reach AU-RA. Check your internet connection and try again.'),
});
const demasiados = (): ErrorCuenta => ({ codigo: 'LIMITE', mensaje: tr('Demasiados intentos seguidos. Espera unos minutos y vuelve a intentar.', 'Too many attempts in a row. Wait a few minutes and try again.') });
const ocupado = (): ErrorCuenta => ({ codigo: 'SERVIDOR', mensaje: tr('AU-RA no pudo responder ahora. Vuelve a intentar en un momento.', 'AU-RA couldn’t answer right now. Try again in a moment.') });

function codigoDe(e: ErrorApi): string {
  return String(e?.data?.codigo || e?.data?.code || '');
}

/** Lo que contestó `/api/ultron/entrar` al fallar → el mensaje para debajo del formulario. */
export function errorDeEntrada(e: ErrorApi): ErrorCuenta {
  const status = Number(e?.status || 0);
  if (!status) return sinConexion();
  if (status === 429) return demasiados();
  // 404: el cerebro remoto no conoce el correo (tampoco es una red caída).
  if (status === 401 || status === 400 || status === 404) {
    return {
      codigo: 'CLAVE_MALA',
      campo: 'clave',
      mensaje: tr(
        'Correo o contraseña incorrectos. Si tu cuenta es de Veta Wallet, usa «Entrar con Veta Wallet».',
        'Wrong email or password. If your account is a Veta Wallet one, use “Sign in with Veta Wallet”.'
      ),
    };
  }
  if (status === 403) {
    const c = codigoDe(e);
    if (c === 'SUSPENDIDA') return { codigo: c, mensaje: tr('Esta cuenta está suspendida.', 'This account is suspended.') };
    return { codigo: c || 'SIN_ACCESO', mensaje: e?.data?.error || tr('Tu cuenta no tiene acceso a AU-RA.', 'Your account doesn’t have access to AU-RA.') };
  }
  return ocupado();
}

/** Lo que contestó `/api/ultron/cuentas/crear` al fallar. */
export function errorDeRegistro(e: ErrorApi): ErrorCuenta {
  const status = Number(e?.status || 0);
  if (!status) return sinConexion();
  if (status === 429) return { codigo: 'LIMITE', mensaje: tr('Se crearon demasiadas cuentas desde esta conexión. Intenta más tarde.', 'Too many accounts were created from this connection. Try again later.') };
  const c = codigoDe(e);
  const delServidor = e?.data?.error || '';
  if (c === 'CORREO_NO_DISPONIBLE') {
    return {
      codigo: c,
      campo: 'correo',
      mensaje: delServidor || tr('No se puede crear una cuenta nueva con ese correo. Si ya tienes cuenta, entra o usa «¿Olvidaste tu contraseña?».', 'A new account can’t be created with that email. If you already have one, sign in or use “Forgot your password?”.'),
    };
  }
  if (c === 'NOMBRE') return { codigo: c, campo: 'nombre', mensaje: delServidor || tr('Escribe tu nombre.', 'Enter your name.') };
  if (c === 'CORREO') return { codigo: c, campo: 'correo', mensaje: delServidor || tr('Escribe un correo válido.', 'Enter a valid email.') };
  if (c === 'CLAVE_DEBIL') return { codigo: c, campo: 'clave', mensaje: delServidor || reglasClave() };
  if (status >= 500) return { codigo: c || 'SERVIDOR', mensaje: delServidor || ocupado().mensaje };
  return { codigo: c || String(status), mensaje: delServidor || tr('No pude crear tu cuenta. Vuelve a intentar.', 'I couldn’t create your account. Try again.') };
}

/** Lo que contestaron `/api/ultron/cuentas/confirmar` o `/reenviar` al fallar. */
export function errorDeCodigo(e: ErrorApi): ErrorCuenta {
  const status = Number(e?.status || 0);
  if (!status) return sinConexion();
  const c = codigoDe(e);
  if (c === 'CODIGO_INVALIDO' || c === 'CODIGO_FORMATO') {
    return { codigo: c, campo: 'codigo', mensaje: tr('Ese código no es válido o ya venció. Revisa el último correo o pide otro.', 'That code isn’t valid or has expired. Check the latest email or ask for another.') };
  }
  if (c === 'ESPERA') return { codigo: c, mensaje: tr('Ya te mandamos un código hace un momento. Espera un minuto antes de pedir otro.', 'We just sent you a code. Wait a minute before asking for another.') };
  if (status === 429) return demasiados();
  if (status === 401) return { codigo: 'SESION', mensaje: tr('Tu sesión se cerró. Entra otra vez para confirmar tu correo.', 'Your session ended. Sign in again to confirm your email.') };
  return { codigo: c || 'SERVIDOR', mensaje: e?.data?.error || ocupado().mensaje };
}
