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
 */
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

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

export async function desbloqueoActivo(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(MARCA)) === '1';
  } catch {
    return false;
  }
}

export async function activarDesbloqueo(clave: string): Promise<boolean> {
  if (!clave) return false;
  try {
    await SecureStore.setItemAsync(CLAVE, String(clave), {
      requireAuthentication: true,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      authenticationPrompt: 'Guardar tu contraseña de Veta Wallet',
    });
    await SecureStore.setItemAsync(MARCA, '1');
    return true;
  } catch {
    // Teléfono sin bloqueo de pantalla seguro, o el sistema rechazó la llave.
    await desactivarDesbloqueo();
    return false;
  }
}

/** La contraseña, tras la huella o la cara. null si se canceló, falló o la llave ya no sirve. */
export async function desbloquearClave(motivo = 'Confirma que eres tú'): Promise<string | null> {
  try {
    const v = await SecureStore.getItemAsync(CLAVE, {
      requireAuthentication: true,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      authenticationPrompt: motivo,
    });
    return v || null;
  } catch {
    return null;
  }
}

export async function desactivarDesbloqueo(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(CLAVE);
  } catch {
    /* ya no estaba */
  }
  try {
    await SecureStore.deleteItemAsync(MARCA);
  } catch {
    /* ya no estaba */
  }
}

export const nombreBiometria = (t: TipoBiometria, es = true) => (t === 'face' ? 'Face ID' : t === 'iris' ? (es ? 'el iris' : 'iris') : es ? 'la huella' : 'fingerprint');
