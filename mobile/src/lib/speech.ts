/**
 * Micrófono siempre-on sin módulo ASR nativo roto en EAS:
 * graba chunks cortos con expo-av → /api/stt/transcribe.
 * El botón Mic solo MUTEA / DESMUTEA.
 *
 * VAD (idea DeskBot EnergyActivityDetector): no enviar silencio al STT.
 * Usa metering dBFS de expo-av; si el dispositivo no reporta metering, se transcribe igual.
 */
import { Audio } from 'expo-av';
import { PermissionsAndroid, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { API_BASE } from '../config';

/** dBFS: ~0 pico, ~-160 silencio. Umbral suave para voz conversacional. */
const VAD_METERING_THRESHOLD_DB = -48;
/** Mínimo de muestras metering válidas para confiar en el gate. */
const VAD_MIN_SAMPLES = 3;

export type SpeechCallbacks = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onListeningChange?: (on: boolean) => void;
  onError?: (msg: string) => void;
};

let callbacks: SpeechCallbacks = {};
let wanted = true;
let loopAlive = false;
let recording: Audio.Recording | null = null;
let pausedForTts = false;
/** Peak metering del chunk actual (dBFS); null si aún no hubo lecturas. */
let chunkPeakMetering: number | null = null;
let chunkMeterSamples = 0;

export function setSpeechCallbacks(cb: SpeechCallbacks) {
  callbacks = cb;
}

export async function ensureSpeechPermissions(): Promise<boolean> {
  try {
    await Audio.requestPermissionsAsync();
  } catch {
    /* */
  }
  if (Platform.OS !== 'android') return true;
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Micrófono ULTRON FP',
        message:
          'Necesito el micrófono siempre activo para oír «hey ULTRON» y tus comandos. El botón Mic solo silencia.',
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

async function transcribeFile(uri: string): Promise<string> {
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const res = await fetch(`${API_BASE}/api/stt/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64: `data:audio/m4a;base64,${b64}`,
        mimeType: 'audio/m4a',
        language: 'es-ES',
      }),
    });
    if (!res.ok) return '';
    const data = await res.json();
    return String(data.text || data.summary || '').trim();
  } catch (e: any) {
    callbacks.onError?.(String(e?.message || e));
    return '';
  }
}

function resetChunkMeter() {
  chunkPeakMetering = null;
  chunkMeterSamples = 0;
}

function onRecordingStatus(status: Audio.RecordingStatus) {
  if (!status.isRecording) return;
  const m = status.metering;
  if (typeof m !== 'number' || Number.isNaN(m)) return;
  chunkMeterSamples += 1;
  chunkPeakMetering =
    chunkPeakMetering == null ? m : Math.max(chunkPeakMetering, m);
}

/** true = hay actividad de voz (o metering no disponible → no bloquear). */
function chunkHasVoiceActivity(): boolean {
  if (chunkMeterSamples < VAD_MIN_SAMPLES || chunkPeakMetering == null) {
    return true;
  }
  return chunkPeakMetering >= VAD_METERING_THRESHOLD_DB;
}

async function stopRecording(): Promise<string | null> {
  if (!recording) return null;
  try {
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    recording = null;
    return uri;
  } catch {
    recording = null;
    return null;
  }
}

async function startChunk() {
  if (!wanted || pausedForTts || !loopAlive) return;
  try {
    resetChunkMeter();
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    const rec = new Audio.Recording();
    await rec.prepareToRecordAsync({
      ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
      isMeteringEnabled: true,
    });
    rec.setProgressUpdateInterval(100);
    rec.setOnRecordingStatusUpdate(onRecordingStatus);
    await rec.startAsync();
    recording = rec;
    callbacks.onListeningChange?.(true);
  } catch (e: any) {
    callbacks.onError?.(String(e?.message || e));
    callbacks.onListeningChange?.(false);
  }
}

async function tickLoop() {
  while (loopAlive) {
    if (!wanted || pausedForTts) {
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }
    await startChunk();
    // Escucha ~2.4s por chunk
    await new Promise((r) => setTimeout(r, 2400));
    if (!loopAlive) break;
    const hadVoice = chunkHasVoiceActivity();
    const uri = await stopRecording();
    callbacks.onListeningChange?.(false);
    if (uri && wanted && !pausedForTts) {
      if (hadVoice) {
        const text = await transcribeFile(uri);
        if (text) {
          callbacks.onPartial?.(text);
          callbacks.onFinal?.(text);
        }
      }
      try {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch {
        /* */
      }
    }
    resetChunkMeter();
    await new Promise((r) => setTimeout(r, 180));
  }
}

export async function enableAlwaysOnMic() {
  wanted = true;
  if (loopAlive) return;
  loopAlive = true;
  void tickLoop();
}

export async function muteMic() {
  wanted = false;
  const uri = await stopRecording();
  if (uri) {
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
      /* */
    }
  }
  callbacks.onListeningChange?.(false);
}

export async function unmuteMic() {
  wanted = true;
  if (!loopAlive) {
    loopAlive = true;
    void tickLoop();
  }
}

/** Pausar captura mientras ULTRON habla (evita eco). */
export function pauseMicForTts(pause: boolean) {
  pausedForTts = pause;
  if (pause) {
    void stopRecording();
    callbacks.onListeningChange?.(false);
  }
}

export function isMicWanted() {
  return wanted;
}

export async function destroySpeech() {
  loopAlive = false;
  wanted = false;
  await stopRecording();
  callbacks = {};
}
