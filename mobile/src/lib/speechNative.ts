/**
 * Oído nativo: Android SpeechRecognizer / iOS SFSpeechRecognizer vía expo-speech-recognition.
 * - Continuo, sin beep (continuous:true usa fuente de audio propia), resultados parciales
 *   para que la cara reaccione mientras hablas y finales en ~300 ms tras callar.
 * - No sube audio a ningún servidor: el reconocimiento lo hace el sistema (Google) en el teléfono.
 * - Se reinicia solo ante `end`, `no-speech`, `network`, etc. Si el servicio no existe
 *   (`service-not-allowed` / `language-not-supported`) avisa con onUnavailable para caer a la nube.
 * - Se pausa mientras ULTRON habla (evita que se escuche a sí mismo).
 */
import { Platform } from 'react-native';
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorCode,
} from 'expo-speech-recognition';

export type NativeCallbacks = {
  onSpeechStart?: () => void;
  onPartial?: (text: string) => void;
  onLevel?: (level01: number) => void;
  onFinal?: (text: string) => void;
  onListeningChange?: (on: boolean) => void;
  onError?: (msg: string) => void;
  onUnavailable?: (reason: string) => void;
};

let cb: NativeCallbacks = {};
let wanted = false;
let paused = false;
let running = false;
let starting = false;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let subs: Array<{ remove: () => void }> = [];
let lastEventAt = Date.now();
let lastPartial = '';
let lastFinalAt = 0;
let lastFinalText = '';
let consecutiveFails = 0;
let unavailable = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function setNativeCallbacks(next: NativeCallbacks) {
  cb = next;
}

export function nativeAvailable(): boolean {
  try {
    return !unavailable && ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

export async function ensureNativePermissions(): Promise<boolean> {
  try {
    const r = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return !!r.granted;
  } catch {
    return false;
  }
}

function emitListening(on: boolean) {
  if (running === on) return;
  running = on;
  cb.onListeningChange?.(on);
}

function scheduleRestart(delay: number) {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (wanted && !paused) void start();
  }, delay);
}

function attach() {
  if (subs.length) return;
  const M = ExpoSpeechRecognitionModule;
  subs.push(
    M.addListener('start', () => {
      lastEventAt = Date.now();
      starting = false;
      consecutiveFails = 0;
      emitListening(true);
    })
  );
  subs.push(
    M.addListener('speechstart', () => {
      lastEventAt = Date.now();
      if (!paused) cb.onSpeechStart?.();
    })
  );
  subs.push(
    M.addListener('volumechange', (e: any) => {
      lastEventAt = Date.now();
      // rango -2..10 → 0..1
      const v = typeof e?.value === 'number' ? Math.max(0, Math.min(1, (e.value + 1) / 9)) : 0;
      if (!paused) cb.onLevel?.(v);
    })
  );
  subs.push(
    M.addListener('result', (e: any) => {
      lastEventAt = Date.now();
      if (paused) return;
      const text = String(e?.results?.[0]?.transcript || '').trim();
      if (!text) return;
      if (e?.isFinal) {
        lastPartial = '';
        // Android segmentado a veces repite el mismo final dos veces seguidas
        if (text === lastFinalText && Date.now() - lastFinalAt < 1500) return;
        lastFinalText = text;
        lastFinalAt = Date.now();
        cb.onLevel?.(0);
        cb.onFinal?.(text);
      } else if (text !== lastPartial) {
        lastPartial = text;
        cb.onPartial?.(text);
      }
    })
  );
  subs.push(
    M.addListener('error', (e: any) => {
      lastEventAt = Date.now();
      starting = false;
      const code = String(e?.error || 'unknown') as ExpoSpeechRecognitionErrorCode | string;
      if (code === 'aborted') return;
      if (code === 'service-not-allowed' || code === 'language-not-supported' || code === 'not-allowed') {
        unavailable = code !== 'not-allowed';
        emitListening(false);
        cb.onUnavailable?.(`${code}: ${String(e?.message || '')}`);
        return;
      }
      // no-speech / speech-timeout / client / network / busy: reintento suave
      consecutiveFails += 1;
      if (code === 'network' || code === 'audio-capture' || code === 'client') {
        cb.onError?.(`${code}${e?.message ? ': ' + e.message : ''}`);
      }
    })
  );
  subs.push(
    M.addListener('end', () => {
      lastEventAt = Date.now();
      starting = false;
      emitListening(false);
      if (wanted && !paused) scheduleRestart(consecutiveFails > 3 ? 900 : 120);
    })
  );
}

function detach() {
  subs.forEach((s) => {
    try {
      s.remove();
    } catch {
      /* */
    }
  });
  subs = [];
}

async function start() {
  if (!wanted || paused || starting || running || unavailable) return;
  starting = true;
  attach();
  try {
    ExpoSpeechRecognitionModule.start({
      lang: 'es-HN',
      interimResults: true,
      maxAlternatives: 1,
      continuous: true,
      requiresOnDeviceRecognition: false,
      addsPunctuation: false,
      contextualStrings: ['Aura', 'AU-RA', 'Ultron', 'Orden Global', 'Genesis Core', 'Veta Wallet', 'Genesis ID', 'Medardo', 'José', 'lempira', 'oro', 'plata'],
      androidIntentOptions: {
        EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 700,
        EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 700,
        EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 120000,
        EXTRA_MASK_OFFENSIVE_WORDS: false,
      } as any,
      iosTaskHint: 'dictation',
      iosCategory: {
        category: 'playAndRecord',
        categoryOptions: ['defaultToSpeaker', 'allowBluetooth', 'mixWithOthers'],
        mode: 'measurement',
      },
      volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
    });
    lastEventAt = Date.now();
  } catch (e: any) {
    starting = false;
    consecutiveFails += 1;
    cb.onError?.(String(e?.message || e));
    if (consecutiveFails >= 4 && Platform.OS === 'android') {
      unavailable = true;
      cb.onUnavailable?.('start-failed');
      return;
    }
    scheduleRestart(700);
  }
}

async function stop(abort = true) {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  try {
    if (abort) ExpoSpeechRecognitionModule.abort();
    else ExpoSpeechRecognitionModule.stop();
  } catch {
    /* */
  }
  starting = false;
  emitListening(false);
}

export async function nativeEnable() {
  wanted = true;
  unavailable = false;
  consecutiveFails = 0;
  await start();
}

export async function nativeMute() {
  wanted = false;
  await stop(true);
}

export async function nativeUnmute() {
  wanted = true;
  await start();
}

export function nativePause(pause: boolean) {
  if (paused === pause) return;
  paused = pause;
  if (pause) {
    void stop(true);
  } else {
    lastPartial = '';
    scheduleRestart(150);
  }
}

export function nativeIsWanted() {
  return wanted;
}
export function nativeIsPaused() {
  return paused;
}

/** ¿Está vivo? Si lleva >8 s sin ningún evento estando activo, algo se colgó. */
export function nativeWatchdogOk() {
  if (!wanted || paused) return true;
  if (!running && !starting && !restartTimer) return false;
  return Date.now() - lastEventAt < 8000;
}

export async function nativeRestart() {
  await stop(true);
  await sleep(250);
  consecutiveFails = 0;
  if (wanted && !paused) await start();
}

export async function nativeDestroy() {
  wanted = false;
  await stop(true);
  detach();
  cb = {};
}
