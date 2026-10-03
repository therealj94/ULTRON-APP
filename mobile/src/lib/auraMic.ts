/**
 * El micrófono crudo (modules/aura-mic, Android): trozos PCM de 16 kHz mono 16 bits en base64 con su
 * volumen en dBFS. `null` si este binario no lo trae (una APK anterior que recibió este JS por OTA, o
 * iOS): entonces el oído se queda con el reconocedor del teléfono.
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type TrozoMic = { audio: string; db: number };

type ModuloMic = {
  disponible(): boolean;
  empezar(frecuencia: number, trozoMs: number, fuente: 'reconocimiento' | 'llamada'): Promise<boolean>;
  parar(): void;
  addListener(evento: 'onTrozo', cb: (t: TrozoMic) => void): { remove(): void };
  addListener(evento: 'onFallo', cb: (f: { motivo: string }) => void): { remove(): void };
};

let modulo: ModuloMic | null | undefined;

function mic(): ModuloMic | null {
  if (modulo !== undefined) return modulo;
  try {
    modulo = Platform.OS === 'android' ? requireOptionalNativeModule<ModuloMic>('AuraMic') : null;
  } catch {
    modulo = null;
  }
  return modulo;
}

export function micCrudoDisponible(): boolean {
  try {
    return !!mic()?.disponible();
  } catch {
    return false;
  }
}

export const FRECUENCIA_MIC = 16000;
export const TROZO_MS = 100;

/**
 * Abre el micrófono; devuelve cómo cerrarlo, o null si no se pudo. `conEco`: con la fuente de llamada
 * (VOICE_COMMUNICATION + cancelación de eco del teléfono), para seguir oyendo mientras suena la voz de
 * AU-RA y que se le pueda hablar encima; sin él, la de dictado (VOICE_RECOGNITION).
 */
export async function abrirMicCrudo(alTrozo: (t: TrozoMic) => void, alFallo: (motivo: string) => void, conEco = false): Promise<(() => void) | null> {
  const m = mic();
  if (!m) return null;
  const subs = [m.addListener('onTrozo', alTrozo), m.addListener('onFallo', (f) => alFallo(String(f?.motivo || 'falló el micrófono')))];
  const soltar = () => subs.forEach((s) => s.remove());
  try {
    if (await m.empezar(FRECUENCIA_MIC, TROZO_MS, conEco ? 'llamada' : 'reconocimiento')) {
      return () => {
        soltar();
        try {
          m.parar();
        } catch {
          /* */
        }
      };
    }
  } catch (e: any) {
    alFallo(String(e?.message || e));
  }
  soltar();
  return null;
}
