/**
 * El micrófono crudo (modules/aura-mic, Android): trozos PCM de 16 kHz mono 16 bits en base64 con su
 * volumen en dBFS. `null` si este binario no lo trae (una APK anterior que recibió este JS por OTA, o
 * iOS): entonces el oído se queda con el reconocedor del teléfono.
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type TrozoMic = { audio: string; db: number };

/**
 * «reconocimiento»: VOICE_RECOGNITION (dictado). «reconocimiento_eco»: la misma con el AcousticEchoCanceler del
 * teléfono pegado (las muletillas, lib/asentir.ts). «llamada»: VOICE_COMMUNICATION con cancelación de eco y supresor
 * de ruido (Interrumpir hablando). Una APK anterior no conoce «reconocimiento_eco» y abre la de dictado sin cancelador
 * (y sin `ecoActivo`, así que las muletillas no suenan).
 */
export type FuenteMic = 'reconocimiento' | 'reconocimiento_eco' | 'llamada';

type ModuloMic = {
  disponible(): boolean;
  empezar(frecuencia: number, trozoMs: number, fuente: FuenteMic): Promise<boolean>;
  parar(): void;
  /** Desde la APK de las muletillas: ¿el teléfono tiene cancelador de eco? ¿quedó activo en la grabación de ahora? */
  ecoDisponible?: () => boolean;
  ecoActivo?: () => boolean;
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

/** ¿El teléfono tiene cancelador de eco (AcousticEchoCanceler.isAvailable)? false en una APK sin la función. */
export function micEcoDisponible(): boolean {
  try {
    const m = mic();
    return typeof m?.ecoDisponible === 'function' && m.ecoDisponible() === true;
  } catch {
    return false;
  }
}

/** ¿El micrófono abierto ahora graba con el cancelador de eco activo? false sin grabación o si la APK no lo dice. */
export function micEcoActivo(): boolean {
  try {
    const m = mic();
    return typeof m?.ecoActivo === 'function' && m.ecoActivo() === true;
  } catch {
    return false;
  }
}

export const FRECUENCIA_MIC = 16000;
export const TROZO_MS = 100;

/** La fuente con la que se abre: `conEco` gana (la de llamada); si no, la de dictado con o sin el cancelador. */
export function fuenteMic(conEco = false, ecoAlEscuchar = false): FuenteMic {
  return conEco ? 'llamada' : ecoAlEscuchar ? 'reconocimiento_eco' : 'reconocimiento';
}

/**
 * Abre el micrófono; devuelve cómo cerrarlo, o null si no se pudo. `conEco`: con la fuente de llamada
 * (VOICE_COMMUNICATION + cancelación de eco del teléfono), para seguir oyendo mientras suena la voz de
 * AU-RA y que se le pueda hablar encima; sin él, la de dictado (VOICE_RECOGNITION), con el cancelador de
 * eco pegado si `ecoAlEscuchar` (las muletillas).
 */
export async function abrirMicCrudo(alTrozo: (t: TrozoMic) => void, alFallo: (motivo: string) => void, conEco = false, ecoAlEscuchar = false): Promise<(() => void) | null> {
  const m = mic();
  if (!m) return null;
  const subs = [m.addListener('onTrozo', alTrozo), m.addListener('onFallo', (f) => alFallo(String(f?.motivo || 'falló el micrófono')))];
  const soltar = () => subs.forEach((s) => s.remove());
  try {
    if (await m.empezar(FRECUENCIA_MIC, TROZO_MS, fuenteMic(conEco, ecoAlEscuchar))) {
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
