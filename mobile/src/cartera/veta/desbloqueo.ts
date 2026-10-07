/**
 * HUELLA O FACE ID EN VEZ DE TECLEAR LA CONTRASEÑA (José, 3-oct: «para hacer transacción y guardar que sea
 * con huella o Face ID, sea más fácil»). El mismo mecanismo que Veta Wallet (veta-wallet-app/src/unlock.js):
 *
 *   · El backend pide la contraseña de verdad en cada operación sensible (ver número/CVV/PIN, recargar). Eso
 *     no cambia: es la última defensa si alguien agarra el teléfono desbloqueado.
 *   · Lo que cambia es que no hay que TECLEARLA: se guarda una vez en el llavero del sistema con
 *     `requireAuthentication`, y el sistema operativo se niega a devolverla sin una huella o una cara
 *     válidas. AURA no la ve hasta que el dueño la autoriza.
 *   · Se guarda solo DESPUÉS de que el servidor la aceptó (una equivocada dejaría un desbloqueo inútil).
 *   · Si la biometría cambia (otra huella, Face ID reconfigurado), el sistema invalida la llave: la lectura
 *     falla y se vuelve a pedir la contraseña escrita. Es lo correcto: una biometría nueva puede ser de otro.
 *   · Es de su dueño en AURA (auditoría AUR01): la llave lleva su seudónimo, y guardar o sacar la clave
 *     exige el vínculo de la sesión que lo pidió (veta/sesion.ts). Si en medio sale o entra otra persona,
 *     no se guarda ni se entrega. La de antes, sin dueño, se descarta (sesion.ts descartarSinDueno).
 */
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { generacionCuenta, seudonimoActual, sigueVigente } from '../../lib/cuenta';
import { descartarSinDueno, llaveDe, vinculoVigente, type VinculoVeta } from './sesion';

const CLAVE = 'aura.veta.clave-biometrica';
/** Marca sin protección: saber si está activo sin disparar el diálogo del sistema. */
const MARCA = 'aura.veta.clave-biometrica-on';

export type TipoBiometria = 'face' | 'huella' | 'iris';

export async function capacidadBiometrica(): Promise<{ disponible: boolean; tipo: TipoBiometria }> {
  try {
    const [hw, enrolado, tipos] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const T = LocalAuthentication.AuthenticationType;
    const tipo: TipoBiometria = tipos?.includes(T.FACIAL_RECOGNITION) ? 'face' : tipos?.includes(T.IRIS) ? 'iris' : 'huella';
    return { disponible: !!(hw && enrolado), tipo };
  } catch {
    return { disponible: false, tipo: 'huella' };
  }
}

/** ¿Quien está dentro de AURA tiene la huella activa para su Veta? (sin nadie dentro, no) */
export async function desbloqueoActivo(): Promise<boolean> {
  const dueno = seudonimoActual();
  if (!dueno) return false;
  const gen = generacionCuenta();
  await descartarSinDueno();
  try {
    return (await SecureStore.getItemAsync(llaveDe(MARCA, dueno))) === '1' && sigueVigente(gen);
  } catch {
    return false;
  }
}

async function borrarDe(dueno: string) {
  try {
    await SecureStore.deleteItemAsync(llaveDe(CLAVE, dueno));
  } catch {
    /* ya no estaba */
  }
  try {
    await SecureStore.deleteItemAsync(llaveDe(MARCA, dueno));
  } catch {
    /* ya no estaba */
  }
}

/**
 * Guarda la contraseña detrás de la huella, en la llave del dueño de `v` (el vínculo que se capturó al
 * empezar la operación que la validó). Si `v` ya no es el de ahora —o deja de serlo mientras el sistema la
 * guarda— no queda nada: la próxima vez se pide escrita.
 */
export async function activarDesbloqueo(clave: string, v: VinculoVeta): Promise<boolean> {
  if (!clave || !vinculoVigente(v)) return false;
  try {
    await SecureStore.setItemAsync(llaveDe(CLAVE, v.dueno), String(clave), {
      requireAuthentication: true,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      authenticationPrompt: 'Guardar tu contraseña de Veta Wallet',
    });
    await SecureStore.setItemAsync(llaveDe(MARCA, v.dueno), '1');
  } catch {
    // Teléfono sin bloqueo de pantalla seguro, o el sistema rechazó la llave.
    await borrarDe(v.dueno);
    return false;
  }
  if (!vinculoVigente(v)) {
    await borrarDe(v.dueno);
    return false;
  }
  return true;
}

/**
 * La contraseña, tras la huella o la cara, para la sesión `v`. null si se canceló, falló, la llave ya no
 * sirve, o mientras el sistema la liberaba salió o entró otra persona.
 */
export async function desbloquearClave(v: VinculoVeta, motivo = 'Confirma que eres tú'): Promise<string | null> {
  if (!vinculoVigente(v)) return null;
  try {
    const c = await SecureStore.getItemAsync(llaveDe(CLAVE, v.dueno), {
      requireAuthentication: true,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      authenticationPrompt: motivo,
    });
    return c && vinculoVigente(v) ? c : null;
  } catch {
    return null;
  }
}

export type ConfirmacionTelefono = { ok: true } | { ok: false; motivo: 'cancelado' | 'sin-bloqueo' | 'error' };

/**
 * CONFIRMAR CON EL TELÉFONO (huella, cara o el PIN/patrón del bloqueo de pantalla) cada vez que se van a mostrar los
 * datos de la tarjeta (número, CVV, PIN) o a recargarla, además de la contraseña de Veta. Auditoría del 7-oct (C-3):
 * con el teléfono desbloqueado y la contraseña a mano, cualquiera veía la tarjeta. Con la huella guardada
 * (`desbloquearClave`) el sistema ya la pidió para soltar la contraseña: ahí no se pide dos veces.
 * Un teléfono sin ningún bloqueo de pantalla no puede confirmar nada: se dice y no se muestra.
 */
export async function confirmarConTelefono(motivo: string): Promise<ConfirmacionTelefono> {
  try {
    const nivel = await LocalAuthentication.getEnrolledLevelAsync();
    if (nivel === LocalAuthentication.SecurityLevel.NONE) return { ok: false, motivo: 'sin-bloqueo' };
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: motivo, cancelLabel: 'Cancelar', disableDeviceFallback: false });
    return r?.success ? { ok: true } : { ok: false, motivo: 'cancelado' };
  } catch {
    return { ok: false, motivo: 'error' };
  }
}

/** Apaga la huella de quien está dentro de AURA (cerrar sesión de Veta). */
export async function desactivarDesbloqueo(): Promise<void> {
  const dueno = seudonimoActual();
  if (dueno) await borrarDe(dueno);
}

export const nombreBiometria = (t: TipoBiometria, es = true) => (t === 'face' ? 'Face ID' : t === 'iris' ? (es ? 'el iris' : 'iris') : es ? 'la huella' : 'fingerprint');
