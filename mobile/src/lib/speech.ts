/**
 * Micrófono siempre escuchando (ASR nativo Android).
 * El botón Mic solo MUTEA / DESMUTEA — no “enciende” el sistema.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import Voice, {
  type SpeechErrorEvent,
  type SpeechResultsEvent,
} from '@react-native-voice/voice';

export type SpeechCallbacks = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onListeningChange?: (on: boolean) => void;
  onError?: (msg: string) => void;
};

let callbacks: SpeechCallbacks = {};
let wanted = true; // usuario quiere mic activo (no mute)
let starting = false;
let bound = false;

function bindOnce() {
  if (bound) return;
  bound = true;
  Voice.onSpeechStart = () => callbacks.onListeningChange?.(true);
  Voice.onSpeechEnd = () => {
    callbacks.onListeningChange?.(false);
    // Reinicio continuo si sigue sin mute
    if (wanted) setTimeout(() => void resumeListening(), 280);
  };
  Voice.onSpeechPartialResults = (e: SpeechResultsEvent) => {
    const t = e.value?.[0];
    if (t) callbacks.onPartial?.(t);
  };
  Voice.onSpeechResults = (e: SpeechResultsEvent) => {
    const t = e.value?.[0];
    if (t) callbacks.onFinal?.(t);
  };
  Voice.onSpeechError = (e: SpeechErrorEvent) => {
    callbacks.onListeningChange?.(false);
    const msg = String(e.error?.message || e.error?.code || 'speech_error');
    // "No match" / cancel son normales en continuous — reiniciar
    if (/7|6|5|no.?match|client|cancel/i.test(msg) && wanted) {
      setTimeout(() => void resumeListening(), 400);
      return;
    }
    callbacks.onError?.(msg);
    if (wanted) setTimeout(() => void resumeListening(), 900);
  };
}

export function setSpeechCallbacks(cb: SpeechCallbacks) {
  callbacks = cb;
  bindOnce();
}

export async function ensureSpeechPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Micrófono ULTRON FP',
        message:
          'Necesito el micrófono siempre activo para oír «hey ULTRON» y tus comandos. Puedes silenciarlo con el botón Mic.',
        buttonPositive: 'Permitir',
        buttonNegative: 'Denegar',
        buttonNeutral: 'Ahora no',
      }
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

async function resumeListening() {
  if (!wanted || starting) return;
  starting = true;
  try {
    const avail = await Voice.isAvailable();
    if (!avail) {
      callbacks.onError?.('Reconocimiento de voz no disponible en este dispositivo');
      return;
    }
    await Voice.start('es-ES');
  } catch (e: any) {
    callbacks.onError?.(String(e?.message || e));
    if (wanted) setTimeout(() => void resumeListening(), 1200);
  } finally {
    starting = false;
  }
}

/** Arranca el mic siempre-on (si no está muteado). */
export async function enableAlwaysOnMic() {
  wanted = true;
  bindOnce();
  await resumeListening();
}

/** Mute: deja de escuchar. */
export async function muteMic() {
  wanted = false;
  try {
    await Voice.stop();
    await Voice.cancel();
  } catch {
    /* */
  }
  callbacks.onListeningChange?.(false);
}

/** Unmute: vuelve a escuchar siempre. */
export async function unmuteMic() {
  wanted = true;
  await resumeListening();
}

export function isMicWanted() {
  return wanted;
}

export async function destroySpeech() {
  wanted = false;
  try {
    await Voice.destroy();
    Voice.removeAllListeners();
  } catch {
    /* */
  }
  bound = false;
}
