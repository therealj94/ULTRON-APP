/**
 * EL OÍDO DE MANOS LIBRES del campo: el mismo motor Turbo de AU-RA (lib/turboMotor.ts) con las puertas de Dr Electrum.
 *
 * El motor hace lo que hace en la mesa de AU-RA: el micrófono crudo (modules/aura-mic) en trozos de 0,1 s, 0,6 s de
 * pre-rollo para no comerse la primera sílaba, el ruido del lugar medido solo (el umbral sube con el viento o el
 * generador), la frase EN VIVO a Scribe v2 Realtime Turbo con el token de un solo uso de `/api/electrum/turbo/permiso`
 * (pistas del oficio, idioma automático), el fin de turno por lo que se dijo (lib/finDeTurno.ts: «¿qué concesiones
 * vencen este año?» se cierra en 0,3 s; «la de Quebrada Seca y…» espera) y, si el en vivo falla tres veces seguidas,
 * cinco minutos solo por WAV a `/api/electrum/oir`. Tres fallos del micrófono y avisa que no abre.
 *
 * Mientras el doctor habla, el micrófono sigue abierto con la fuente de llamada (cancelación de eco del teléfono): lo
 * que se oye no se entrega salvo que la pantalla decida que es la persona cortándolo (manosLibres.ts `decidirEncima`).
 *
 * Una sola instancia y un solo dueño: el dictado de botón (dictado.ts) usa el mismo micrófono, así que la pantalla
 * silencia este oído antes de dictar (manosLibres.ts `duenoMic`).
 */
import { PermissionsAndroid, Platform } from 'react-native';
import { abrirMicCrudo, micCrudoDisponible, micEcoActivo } from '../lib/auraMic';
import { MotorTurbo, type WsTurbo } from '../lib/turboMotor';
import { oirWav, permisoTurbo } from './api';
import { SEGUNDA_ESCUCHA_CAMPO } from './manosLibres';

let motor: MotorTurbo | null = null;

/** El motor del oído de manos libres (se crea la primera vez). */
export function oidoCampo(): MotorTurbo {
  if (!motor) {
    motor = new MotorTurbo({
      abrirMic: abrirMicCrudo,
      ecoActivo: micEcoActivo,
      permiso: () => permisoTurbo(),
      transcribirWav: (wav, confirmar) => oirWav(wav, confirmar),
      crearWs: (url) => new WebSocket(url) as unknown as WsTurbo,
      segundaEscucha: SEGUNDA_ESCUCHA_CAMPO,
    });
    // Siempre con la cancelación de eco: así el doctor puede hablar sin que el oído se oiga a sí mismo, y se le puede
    // hablar encima.
    motor.setOirEncima(true);
  }
  return motor;
}

/** ¿Este teléfono puede oír en manos libres? (Android con la APK que trae el micrófono crudo). */
export function manosLibresPosible(): boolean {
  return Platform.OS === 'android' && micCrudoDisponible();
}

/** El permiso del micrófono (el mismo diálogo del sistema que pide el dictado). */
export async function permisoMicrofono(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    return r === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}
