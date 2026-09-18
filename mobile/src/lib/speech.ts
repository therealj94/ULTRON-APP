/**
 * Escucha continua con VAD (idea DeskBot EnergyActivityDetector):
 * - Graba siempre; detecta inicio de voz por energía (dBFS) con umbral adaptativo.
 * - Cierra la frase tras ~700 ms de silencio → una sola transcripción por frase.
 * - Sin wake word: todo lo que dices es un comando.
 * - Se pausa solo mientras ULTRON reproduce audio (evita eco).
 * Fallback: si el dispositivo no reporta metering, usa chunks fijos de 3 s.
 */
import { Audio } from 'expo-av';
import { PermissionsAndroid, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { API_BASE } from '../config';

export type SpeechCallbacks = {
  onSpeechStart?: () => void;
  onLevel?: (level01: number) => void;
  onFinal?: (text: string) => void;
  onListeningChange?: (on: boolean) => void;
  onError?: (msg: string) => void;
};

const SILENCE_MS = 700;
const MIN_UTTERANCE_MS = 350;
const MAX_UTTERANCE_MS = 12_000;
const IDLE_ROTATE_MS = 9_000;
const FIXED_CHUNK_MS = 3_000;
const METER_INTERVAL_MS = 80;

const REC_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 48000,
  },
  ios: {
    extension: '.m4a',
    audioQuality: Audio.IOSAudioQuality.MEDIUM,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 48000,
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
  },
  web: {},
};

let callbacks: SpeechCallbacks = {};
let wanted = true;
let loopAlive = false;
let paused = false;
let recording: Audio.Recording | null = null;
let meteringSupported: boolean | null = null;
let noiseFloor = -60;
let lastLevelSent = 0;
let transcribeChain: Promise<void> = Promise.resolve();

// estado del chunk actual
let recStartedAt = 0;
let speechStartedAt = 0;
let lastVoiceAt = 0;
let meterSamples = 0;

export function setSpeechCallbacks(cb: SpeechCallbacks) {
  callbacks = cb;
}

export async function ensureSpeechPermissions(): Promise<boolean> {
  try {
    const r = await Audio.requestPermissionsAsync();
    if (Platform.OS !== 'android') return r.granted;
  } catch {
    /* */
  }
  if (Platform.OS !== 'android') return true;
  try {
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
      title: 'Micrófono ULTRON FP',
      message: 'Te escucho de forma continua para conversar con fluidez. El botón Mic solo silencia.',
      buttonPositive: 'Permitir',
      buttonNegative: 'Denegar',
    });
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

const HALLUCINATIONS = /^(subt[ií]tulos.*|gracias por ver.*|suscr[ií]bete.*|\.+|…|music|\[.*\])$/i;

async function transcribeFile(uri: string): Promise<string> {
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(`${API_BASE}/api/stt/transcribe`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64: `data:audio/m4a;base64,${b64}`, mimeType: 'audio/m4a', language: 'es' }),
    });
    clearTimeout(t);
    if (!res.ok) return '';
    const data = await res.json();
    const text = String(data.text || '').trim();
    if (text.length < 2 || HALLUCINATIONS.test(text)) return '';
    return text;
  } catch (e: any) {
    callbacks.onError?.(String(e?.message || e));
    return '';
  }
}

function threshold() {
  // 12 dB sobre el ruido de fondo, nunca más permisivo que -52 ni más estricto que -28
  return Math.min(-28, Math.max(-52, noiseFloor + 12));
}

function onStatus(st: Audio.RecordingStatus) {
  if (!st.isRecording) return;
  const m = st.metering;
  if (typeof m !== 'number' || Number.isNaN(m) || m <= -160) return;
  meterSamples += 1;
  meteringSupported = true;
  const now = Date.now();
  const th = threshold();
  const level = Math.max(0, Math.min(1, (m - (th - 10)) / 40));
  if (Math.abs(level - lastLevelSent) > 0.08 || (level === 0 && lastLevelSent !== 0)) {
    lastLevelSent = level;
    callbacks.onLevel?.(level);
  }
  if (m >= th) {
    if (!speechStartedAt) {
      speechStartedAt = now;
      callbacks.onSpeechStart?.();
    }
    lastVoiceAt = now;
  } else if (!speechStartedAt) {
    // EMA del ruido de fondo solo cuando no hay voz
    noiseFloor = noiseFloor * 0.92 + m * 0.08;
  }
}

async function startRecording(): Promise<boolean> {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    const rec = new Audio.Recording();
    await rec.prepareToRecordAsync(REC_OPTIONS);
    rec.setProgressUpdateInterval(METER_INTERVAL_MS);
    rec.setOnRecordingStatusUpdate(onStatus);
    await rec.startAsync();
    recording = rec;
    recStartedAt = Date.now();
    speechStartedAt = 0;
    lastVoiceAt = 0;
    meterSamples = 0;
    callbacks.onListeningChange?.(true);
    return true;
  } catch (e: any) {
    callbacks.onError?.(String(e?.message || e));
    callbacks.onListeningChange?.(false);
    return false;
  }
}

async function stopRecording(): Promise<string | null> {
  const rec = recording;
  recording = null;
  if (!rec) return null;
  try {
    rec.setOnRecordingStatusUpdate(null);
    await rec.stopAndUnloadAsync();
    return rec.getURI();
  } catch {
    return null;
  }
}

async function discard(uri: string | null) {
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    /* */
  }
}

function queueTranscription(uri: string) {
  transcribeChain = transcribeChain.then(async () => {
    const text = await transcribeFile(uri);
    await discard(uri);
    if (text && wanted) callbacks.onFinal?.(text);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loop() {
  while (loopAlive) {
    if (!wanted || paused) {
      if (recording) await discard(await stopRecording());
      callbacks.onListeningChange?.(false);
      await sleep(150);
      continue;
    }
    if (!recording) {
      const ok = await startRecording();
      if (!ok) {
        await sleep(1200);
        continue;
      }
    }
    await sleep(100);
    if (!recording || !wanted || paused) continue;

    const now = Date.now();
    const elapsed = now - recStartedAt;

    // Fallback sin metering: chunks fijos
    if (meteringSupported === false || (meteringSupported === null && elapsed > 1800 && meterSamples === 0)) {
      meteringSupported = false;
      if (elapsed >= FIXED_CHUNK_MS) {
        const uri = await stopRecording();
        if (uri) queueTranscription(uri);
      }
      continue;
    }

    if (speechStartedAt) {
      const spoke = lastVoiceAt - speechStartedAt;
      const silence = now - lastVoiceAt;
      if ((silence >= SILENCE_MS && spoke >= MIN_UTTERANCE_MS) || now - speechStartedAt >= MAX_UTTERANCE_MS) {
        const uri = await stopRecording();
        if (uri) queueTranscription(uri);
      } else if (silence >= SILENCE_MS) {
        // ruido corto, no voz
        await discard(await stopRecording());
      }
    } else if (elapsed >= IDLE_ROTATE_MS) {
      await discard(await stopRecording());
    }
  }
  await discard(await stopRecording());
  callbacks.onListeningChange?.(false);
}

export async function enableAlwaysOnMic() {
  wanted = true;
  if (loopAlive) return;
  loopAlive = true;
  void loop();
}

export async function muteMic() {
  wanted = false;
  await discard(await stopRecording());
  callbacks.onListeningChange?.(false);
}

export async function unmuteMic() {
  wanted = true;
  if (!loopAlive) {
    loopAlive = true;
    void loop();
  }
}

/** Pausar captura mientras ULTRON reproduce audio (evita eco). */
export function pauseMicForTts(pause: boolean) {
  paused = pause;
}

export function isMicWanted() {
  return wanted;
}

export function isMicPaused() {
  return paused;
}

export async function destroySpeech() {
  loopAlive = false;
  wanted = false;
  await discard(await stopRecording());
  callbacks = {};
}
