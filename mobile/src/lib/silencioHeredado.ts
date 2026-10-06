/**
 * La recarga de una OTA no es una sesión nueva para el silencio del micrófono (lib/silencioMesa.ts): justo antes de
 * recargar (lib/barreraOta.ts antesDeRecargar) se apunta la sesión de ahora; el arranque que sigue la lee una vez, la
 * borra y, si llegó a tiempo (HEREDAR_MS), cuenta como la misma. Así un micrófono que la persona cerró no se abre solo
 * por una actualización; cerrar la app y volver a abrirla sí lo abre.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { antesDeRecargar } from './barreraOta';
import { SESION_APP, sesionesDelSilencio } from './silencioMesa';

const CLAVE = 'aura.mic.sesionHeredada';

antesDeRecargar('silencio-del-microfono', () => AsyncStorage.setItem(CLAVE, JSON.stringify({ sesion: SESION_APP, en: Date.now() })));

/** Las sesiones que cuentan como esta al arrancar la mesa (lee y borra lo que dejó una recarga por OTA). */
export async function sesionesDeEsteArranque(): Promise<string[]> {
  try {
    const crudo = await AsyncStorage.getItem(CLAVE);
    if (crudo) await AsyncStorage.removeItem(CLAVE);
    return sesionesDelSilencio(crudo ? JSON.parse(crudo) : null);
  } catch {
    return [SESION_APP];
  }
}
