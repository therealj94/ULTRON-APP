/**
 * Oído de AU-RA: fachada sobre dos motores, elegible en Ajustes.
 *  - 'native' (default): reconocimiento del sistema (Google) en el teléfono. Parciales en vivo,
 *    final ~0.3 s tras callar, sin subir audio. Cae solo a la nube si el servicio no existe.
 *  - 'cloud': grabación con VAD por energía + ElevenLabs Scribe en el servidor (más lento, ~1.5 s,
 *    pero funciona en teléfonos sin servicios de Google).
 */
import * as cloud from './speechCloud';
import * as native from './speechNative';

export type SttEngine = 'native' | 'cloud';

export type SpeechCallbacks = {
  onSpeechStart?: () => void;
  onPartial?: (text: string) => void;
  onLevel?: (level01: number) => void;
  onFinal?: (text: string) => void;
  onListeningChange?: (on: boolean) => void;
  onError?: (msg: string) => void;
  onEngineChange?: (engine: SttEngine, reason: string) => void;
};

let engine: SttEngine = 'native';
let callbacks: SpeechCallbacks = {};
let enabled = false;

function wire() {
  const common = {
    onSpeechStart: () => callbacks.onSpeechStart?.(),
    onLevel: (v: number) => callbacks.onLevel?.(v),
    onFinal: (t: string) => callbacks.onFinal?.(t),
    onListeningChange: (on: boolean) => callbacks.onListeningChange?.(on),
    onError: (m: string) => callbacks.onError?.(m),
  };
  native.setNativeCallbacks({
    ...common,
    onPartial: (t) => callbacks.onPartial?.(t),
    onUnavailable: (reason) => {
      if (engine !== 'native') return;
      void switchEngine('cloud', `nativo no disponible (${reason})`);
    },
  });
  cloud.setSpeechCallbacks(common);
}

export function setSpeechCallbacks(cb: SpeechCallbacks) {
  callbacks = cb;
  wire();
}

export function currentSttEngine(): SttEngine {
  return engine;
}

async function switchEngine(next: SttEngine, reason: string) {
  if (next === engine) return;
  const wasWanted = isMicWanted();
  const wasPaused = isMicPaused();
  if (engine === 'native') await native.nativeDestroy();
  else await cloud.destroySpeech();
  engine = next;
  wire();
  callbacks.onEngineChange?.(next, reason);
  if (enabled && wasWanted) {
    if (next === 'native') {
      await native.nativeEnable();
      native.nativePause(wasPaused);
    } else {
      cloud.pauseMicForTts(wasPaused);
      await cloud.enableAlwaysOnMic();
    }
  }
}

/** Cambia el motor desde Ajustes. */
export async function setSttEngine(next: SttEngine) {
  if (next === 'native' && !native.nativeAvailable()) {
    callbacks.onEngineChange?.('cloud', 'este teléfono no tiene reconocimiento del sistema');
    return switchEngine('cloud', 'sin servicio nativo');
  }
  return switchEngine(next, 'ajustes');
}

export async function ensureSpeechPermissions(): Promise<boolean> {
  // El permiso de micrófono es el mismo; el nativo además pide reconocimiento en iOS.
  const okCloud = await cloud.ensureSpeechPermissions();
  if (engine === 'native') {
    const okNative = await native.ensureNativePermissions();
    return okCloud || okNative;
  }
  return okCloud;
}

export async function enableAlwaysOnMic() {
  enabled = true;
  if (engine === 'native') {
    if (!native.nativeAvailable()) {
      engine = 'cloud';
      wire();
      callbacks.onEngineChange?.('cloud', 'este teléfono no tiene reconocimiento del sistema');
      return cloud.enableAlwaysOnMic();
    }
    return native.nativeEnable();
  }
  return cloud.enableAlwaysOnMic();
}

export async function muteMic() {
  return engine === 'native' ? native.nativeMute() : cloud.muteMic();
}

export async function unmuteMic() {
  return engine === 'native' ? native.nativeUnmute() : cloud.unmuteMic();
}

/** Pausa la captura mientras AU-RA habla. */
export function pauseMicForTts(pause: boolean) {
  if (engine === 'native') native.nativePause(pause);
  else cloud.pauseMicForTts(pause);
}

export function isMicWanted() {
  return engine === 'native' ? native.nativeIsWanted() : cloud.isMicWanted();
}

export function isMicPaused() {
  return engine === 'native' ? native.nativeIsPaused() : cloud.isMicPaused();
}

export function micWatchdogOk() {
  return engine === 'native' ? native.nativeWatchdogOk() : cloud.micWatchdogOk();
}

export async function restartMic() {
  return engine === 'native' ? native.nativeRestart() : cloud.restartMic();
}

export async function destroySpeech() {
  enabled = false;
  await native.nativeDestroy();
  await cloud.destroySpeech();
  callbacks = {};
}
