/**
 * Voz de ULTRON — una sola voz neural, nunca la robótica del sistema.
 * - Frases grabadas (assets/voice) → 0 ms, funcionan sin red.
 * - Resto: /api/tts (ElevenLabs Flash) descargado directo a disco, por oraciones,
 *   con la siguiente oración precargada mientras suena la actual.
 */
import { Audio, type AVPlaybackSource } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { ttsUrl } from './api';
import { VOICE_BANK, bankKey } from './voiceBank';

type Perf = 'speak' | 'sing';

let current: Audio.Sound | null = null;
let gen = 0;
const fileCache = new Map<string, string>();

export function cleanForSpeech(text: string) {
  return String(text || '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\*+/g, '')
    .replace(/#+\s?/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (p.length <= 160) {
      out.push(p);
      continue;
    }
    let buf = '';
    for (const s of p.split(/(?<=[,;:])\s+/)) {
      if ((buf + ' ' + s).trim().length > 160 && buf) {
        out.push(buf.trim());
        buf = s;
      } else buf = (buf + ' ' + s).trim();
    }
    if (buf) out.push(buf);
  }
  // une colas muy cortas ("Sí.") a la anterior para no pagar una petición extra
  const merged: string[] = [];
  for (const s of out) {
    if (merged.length && s.length < 12) merged[merged.length - 1] += ' ' + s;
    else merged.push(s);
  }
  return merged.length ? merged : [text];
}

let audioModeSet = false;
async function ensureAudioMode() {
  if (audioModeSet) return;
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    audioModeSet = true;
  } catch {
    /* */
  }
}

function canned(text: string, perf: Perf): AVPlaybackSource | null {
  if (perf !== 'speak') return null;
  const hit = VOICE_BANK[bankKey(text)];
  return hit ? (hit as AVPlaybackSource) : null;
}

async function fetchSource(text: string, perf: Perf): Promise<AVPlaybackSource | null> {
  const pre = canned(text, perf);
  if (pre) return pre;
  const key = `${perf}|${text}`;
  const hit = fileCache.get(key);
  if (hit) return { uri: hit };
  const path = `${FileSystem.cacheDirectory}ultron-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.mp3`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await FileSystem.downloadAsync(ttsUrl(text, perf), path, { headers: { Accept: 'audio/mpeg' } });
      const info = await FileSystem.getInfoAsync(path);
      if (r.status === 200 && info.exists && (info.size || 0) > 64) {
        fileCache.set(key, path);
        return { uri: path };
      }
    } catch {
      /* reintento */
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  return null;
}

async function prepare(source: AVPlaybackSource): Promise<Audio.Sound | null> {
  try {
    const { sound } = await Audio.Sound.createAsync(source, { shouldPlay: false, progressUpdateIntervalMillis: 200 });
    return sound;
  } catch {
    return null;
  }
}

function playPrepared(sound: Audio.Sound, my: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    let guard: ReturnType<typeof setTimeout> | null = null;
    const end = () => {
      if (done) return;
      done = true;
      if (guard) clearTimeout(guard);
      if (current === sound) current = null;
      void sound.unloadAsync().catch(() => {});
      resolve();
    };
    if (my !== gen) return end();
    current = sound;
    sound.setOnPlaybackStatusUpdate((st) => {
      if (!st.isLoaded) {
        if ((st as any).error) end();
        return;
      }
      if (st.durationMillis && !guard) guard = setTimeout(end, st.durationMillis + 1500);
      if (st.didJustFinish) end();
    });
    sound.playAsync().catch(end);
    if (!guard) guard = setTimeout(end, 25_000);
  });
}

export async function stopSpeaking() {
  gen += 1;
  const s = current;
  current = null;
  if (s) {
    try {
      await s.stopAsync();
      await s.unloadAsync();
    } catch {
      /* */
    }
  }
}

export function isSpeaking() {
  return current !== null;
}

/** Calienta la caché del servidor/disco para frases que no están grabadas. */
export async function prefetchPhrases(phrases: string[]) {
  const queue = phrases.map(cleanForSpeech).filter((p) => p && !canned(p, 'speak'));
  const worker = async () => {
    while (queue.length) {
      const p = queue.shift()!;
      await fetchSource(p, 'speak').catch(() => null);
    }
  };
  await Promise.all([worker(), worker()]);
}

export async function speak(
  text: string,
  opts?: {
    performance?: Perf;
    onStart?: () => void;
    onEnd?: () => void;
    onAudioStart?: () => void;
  }
): Promise<boolean> {
  const clean = cleanForSpeech(text);
  if (!clean) {
    opts?.onEnd?.();
    return false;
  }
  await stopSpeaking();
  const my = gen;
  const perf = opts?.performance || 'speak';
  opts?.onStart?.();
  await ensureAudioMode();

  const sentences = perf === 'sing' ? [clean] : splitSentences(clean);
  const AHEAD = 2;
  const sources: Array<Promise<AVPlaybackSource | null>> = [];
  const launch = (i: number) => {
    if (i < sentences.length && !sources[i]) sources[i] = fetchSource(sentences[i], perf);
  };
  for (let i = 0; i < Math.min(AHEAD + 1, sentences.length); i++) launch(i);

  let spoke = false;
  let nextPrepared: Promise<Audio.Sound | null> | null = null;
  try {
    for (let i = 0; i < sentences.length; i++) {
      if (my !== gen) return spoke;
      launch(i + AHEAD);
      const sound = nextPrepared ? await nextPrepared : await (async () => {
        const src = await sources[i];
        return src ? prepare(src) : null;
      })();
      nextPrepared = null;
      if (my !== gen) {
        if (sound) void sound.unloadAsync().catch(() => {});
        return spoke;
      }
      if (!sound) continue;
      // precarga la siguiente mientras suena esta
      if (i + 1 < sentences.length) {
        nextPrepared = (async () => {
          const src = await sources[i + 1];
          return src ? prepare(src) : null;
        })();
      }
      if (!spoke) {
        spoke = true;
        opts?.onAudioStart?.();
      }
      await playPrepared(sound, my);
    }
    return spoke;
  } finally {
    if (nextPrepared) void nextPrepared.then((s) => s?.unloadAsync().catch(() => {}));
    if (my === gen) opts?.onEnd?.();
  }
}
