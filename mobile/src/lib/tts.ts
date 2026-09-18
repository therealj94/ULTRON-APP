/**
 * TTS neural only (nunca voz robótica del sistema).
 * Pipeline por frases + prefetch. performance=sing usa modelo musical.
 */
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { synthesizeTts } from './api';

let sound: Audio.Sound | null = null;
let gen = 0;
let audioModeReady = false;

const fileCache = new Map<string, string>();

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += chars[(triple >> 18) & 63];
    out += chars[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? chars[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? chars[triple & 63] : '=';
  }
  return out;
}

function cleanForSpeech(text: string) {
  return text
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\*+/g, '')
    .replace(/^(hmm|mmm|eh|ehm|bueno|a ver|vaya)[…,.]*\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?…;:])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (p.length <= 140) {
      out.push(p);
      continue;
    }
    const sub = p.split(/(?<=,)\s+/);
    let buf = '';
    for (const s of sub) {
      if ((buf + ' ' + s).trim().length > 140 && buf) {
        out.push(buf.trim());
        buf = s;
      } else buf = (buf + ' ' + s).trim();
    }
    if (buf) out.push(buf);
  }
  return out.length ? out : [text];
}

async function ensureAudioMode() {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    audioModeReady = true;
  } catch {
    audioModeReady = false;
  }
}

function cacheKey(text: string, voiceId: string, performance: string) {
  return `${voiceId}|${performance}|${text}`;
}

async function fetchToFile(text: string, voiceId: string, performance: 'speak' | 'sing'): Promise<string | null> {
  const key = cacheKey(text, voiceId, performance);
  const hit = fileCache.get(key);
  if (hit) return hit;
  let buf = await synthesizeTts({ text, voiceId, engine: 'fast', performance });
  if (!buf || buf.byteLength < 64) {
    buf = await synthesizeTts({ text, voiceId, engine: 'fast', performance });
  }
  if (!buf || buf.byteLength < 64) return null;
  try {
    const path = `${FileSystem.cacheDirectory}ultron-tts-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.mp3`;
    await FileSystem.writeAsStringAsync(path, bytesToBase64(buf), {
      encoding: FileSystem.EncodingType.Base64,
    });
    fileCache.set(key, path);
    return path;
  } catch {
    return null;
  }
}

function playFile(uri: string, my: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const end = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve();
    };
    (async () => {
      try {
        if (my !== gen) return end();
        const { sound: s } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
        if (my !== gen) {
          await s.unloadAsync().catch(() => {});
          return end();
        }
        sound = s;
        s.setOnPlaybackStatusUpdate((st) => {
          if (!st.isLoaded) {
            if ((st as any).error) end();
            return;
          }
          const dur = st.durationMillis || 8000;
          if (!timer) timer = setTimeout(end, dur + 800);
          if (st.didJustFinish) {
            void s.unloadAsync().catch(() => {});
            if (sound === s) sound = null;
            end();
          }
        });
        timer = setTimeout(end, 20_000);
      } catch {
        end();
      }
    })();
  });
}

export async function stopSpeaking() {
  gen += 1;
  if (sound) {
    const s = sound;
    sound = null;
    try {
      await s.stopAsync();
      await s.unloadAsync();
    } catch {
      /* */
    }
  }
}

export function isSpeaking() {
  return sound !== null;
}

export async function prefetchPhrases(phrases: string[], voiceId: string) {
  const queue = phrases.map((p) => cleanForSpeech(p)).filter(Boolean);
  const first = queue.shift();
  if (first) await fetchToFile(first, voiceId, 'speak').catch(() => null);
  const worker = async () => {
    while (queue.length) {
      const p = queue.shift()!;
      await fetchToFile(p, voiceId, 'speak').catch(() => null);
    }
  };
  await Promise.all([worker(), worker()]);
}

export async function speak(
  text: string,
  opts?: {
    voiceId?: string;
    performance?: 'speak' | 'sing';
    onStart?: () => void;
    onEnd?: () => void;
    onAudioStart?: () => void;
  }
) {
  const clean = cleanForSpeech(text);
  if (!clean) {
    opts?.onEnd?.();
    return;
  }
  await stopSpeaking();
  const my = gen;
  const voiceId = opts?.voiceId || 'ultron';
  const performance = opts?.performance || 'speak';
  opts?.onStart?.();
  await ensureAudioMode();

  const sentences = performance === 'sing' ? [clean] : splitSentences(clean);
  const jobs: Promise<string | null>[] = [];
  const MAX_AHEAD = 3;
  let audioStarted = false;

  const launch = (i: number) => {
    if (i < sentences.length && !jobs[i]) jobs[i] = fetchToFile(sentences[i], voiceId, performance);
  };
  for (let i = 0; i < Math.min(MAX_AHEAD, sentences.length); i++) launch(i);

  try {
    for (let i = 0; i < sentences.length; i++) {
      if (my !== gen) return;
      launch(i + MAX_AHEAD - 1);
      const uri = await jobs[i];
      if (my !== gen) return;
      if (!uri) continue; // nunca caer a voz de sistema
      if (!audioStarted) {
        audioStarted = true;
        opts?.onAudioStart?.();
      }
      await playFile(uri, my);
    }
  } finally {
    if (my === gen) opts?.onEnd?.();
  }
}
