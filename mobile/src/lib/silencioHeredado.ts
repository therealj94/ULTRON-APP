/**
 * El paso de la 5.6.0 al silencio con hora (lib/silencioMesa.ts). La 5.6.0 guardaba el silencio con su sesión, sin
 * hora, y justo antes de recargar por una OTA apuntaba aquí `{ sesion, en }`. Si este código llega por esa OTA, el
 * primer arranque lee lo apuntado una vez y lo borra: un silencio de esa sesión cuenta desde la hora de la recarga
 * (y no se abre solo por la actualización). Este código ya no apunta nada: el silencio lleva su hora.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SilencioHeredado } from './silencioMesa';

const CLAVE = 'aura.mic.sesionHeredada';

/** Lo que dejó la 5.6.0 antes de recargar (lo lee y lo borra), o null. */
export async function silencioHeredado(): Promise<SilencioHeredado> {
  try {
    const crudo = await AsyncStorage.getItem(CLAVE);
    if (!crudo) return null;
    await AsyncStorage.removeItem(CLAVE);
    const j = JSON.parse(crudo);
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}
