/**
 * Voz de AU-RA — una sola voz (ElevenLabs v3, timbre Gabriela), nunca la robótica del sistema.
 *
 *  - Banco offline (assets/voice, generado por scripts/build-voice-bank.mjs): 0 ms, sin red.
 *  - Clips remotos (/voz/<id>.mp3): canciones grabadas, chistes, discurso y los clips nuevos; si el
 *    servidor no los sirve como audio, se cae a TTS con el texto del clip.
 *  - Resto: GET /api/tts?text&emocion&performance descargado a disco, por oraciones, con la siguiente
 *    oración precargada mientras suena la actual.
 *  - Canto real: POST /api/cantar {id} | {letra,titulo} → mp3 (hasta ~40 s la primera vez).
 *  - Oración del día: POST /api/orar {tema?} → mp3 (~3 min, cacheado), o el estático /voz/oracion.mp3.
 *  - Lip-sync: cada reproducción emite un nivel 0..1 a 20 Hz (setSpeechLevelListener) calculado con
 *    lipsync.ts sobre positionMillis (expo-av no da metering al reproducir).
 *
 * Todo lo que suena pasa por playPrepared() y comparte la generación `gen`: stopSpeaking() corta
 * cualquier cosa, y cada función avisa onStart/onAudioStart/onEnd para que la mesa pause el mic.
 */
import { Audio, type AVPlaybackSource } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { CANTAR_ENDPOINT, ORAR_ENDPOINT, TTS_ENDPOINT, sessionHeaders, ttsUrl } from './api';
import { API_BASE } from '../config';
import type { Emocion } from './emocion';
import { envolventeDeTexto, envolventeLibre, type EnvelopeKind } from './lipsync';
import { CLIP_TEXT, PHRASE_TO_CLIP, REMOTE_CLIPS, VOICE_BANK, bankKey, type ClipId } from './voiceBank';

type Perf = 'speak' | 'sing';

export type SpeakCallbacks = {
  /** Se decidió hablar (antes de tener audio). */
  onStart?: () => void;
  /** Empezó a sonar el primer audio: aquí se pausa el mic. */
  onAudioStart?: () => void;
  /** Terminó (o se canceló) todo el audio de esta locución. */
  onEnd?: () => void;
};

let current: Audio.Sound | null = null;
let gen = 0;
const fileCache = new Map<string, string>();
/** Última locución en curso: el StreamSpeaker espera a que termine (no corta un clip a la mitad). */
let lastSpeak: Promise<unknown> = Promise.resolve();
let releaseLastSpeak: (() => void) | null = null;

// ---------------------------------------------------------------- lip-sync
let levelListener: ((level01: number) => void) | null = null;
let lastLevel = -1;
/** La cara se suscribe aquí: 0..1 a ~20 Hz mientras suena algo, 0 al terminar. */
export function setSpeechLevelListener(cb: ((level01: number) => void) | null) {
  levelListener = cb;
  lastLevel = -1;
}
function emitLevel(v: number) {
  const q = Math.round(Math.max(0, Math.min(1, v)) * 50) / 50;
  if (q === lastLevel) return;
  lastLevel = q;
  levelListener?.(q);
}

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

// ---------------------------------------------------------------- banco / clips

/** ¿Está el clip empaquetado en el APK? */
export function isBundled(id: ClipId) {
  return VOICE_BANK[id] !== undefined;
}

const remoteOk = new Map<ClipId, { ok: boolean; at: number }>();
const REMOTE_NEG_TTL = 10 * 60_000;

/**
 * ¿Sirve el servidor este clip como audio? Los clips que aún no se subieron devuelven la SPA (HTML 200),
 * no 404: por eso se mira el content-type. Positivo se recuerda siempre; negativo 10 min.
 */
export async function remoteClipAvailable(id: ClipId): Promise<boolean> {
  const hit = remoteOk.get(id);
  if (hit && (hit.ok || Date.now() - hit.at < REMOTE_NEG_TTL)) return hit.ok;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6_000);
  try {
    const res = await fetch(`${API_BASE}${REMOTE_CLIPS[id]}`, { method: 'HEAD', signal: ctrl.signal });
    const ct = String(res.headers.get('content-type') || '');
    const ok = res.ok && /audio|octet/.test(ct);
    remoteOk.set(id, { ok, at: Date.now() });
    return ok;
  } catch {
    remoteOk.set(id, { ok: false, at: Date.now() });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Fuente de un clip: asset local si está empaquetado; si no, remoto cuando el servidor lo sirve. */
async function clipSource(id: ClipId): Promise<AVPlaybackSource | null> {
  const local = VOICE_BANK[id];
  if (local !== undefined) return local;
  return (await remoteClipAvailable(id)) ? { uri: `${API_BASE}${REMOTE_CLIPS[id]}` } : null;
}

/** Clip que dice exactamente esta frase (0 ms si está empaquetado). */
export function clipForPhrase(text: string): ClipId | null {
  return PHRASE_TO_CLIP[bankKey(text)] || null;
}

// ---------------------------------------------------------------- descarga TTS

function tmpPath(prefix: string, ext = 'mp3') {
  return `${FileSystem.cacheDirectory}${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
}

async function fetchSource(text: string, perf: Perf, emocion: Emocion): Promise<AVPlaybackSource | null> {
  if (perf === 'speak') {
    const clip = clipForPhrase(text);
    if (clip) {
      const src = await clipSource(clip);
      if (src) return src;
    }
  }
  const key = `${perf}|${emocion}|${text}`;
  const hit = fileCache.get(key);
  if (hit) return { uri: hit };
  const headers = { Accept: 'audio/*', ...(await sessionHeaders()) };
  for (let attempt = 0; attempt < 2; attempt++) {
    const path = tmpPath('ultron');
    try {
      const r = await FileSystem.downloadAsync(ttsUrl(text, perf, emocion), path, { headers });
      const ct = String((r.headers as any)?.['Content-Type'] || (r.headers as any)?.['content-type'] || '');
      const info = await FileSystem.getInfoAsync(path);
      if (r.status === 200 && info.exists && (info.size || 0) > 64 && (!ct || /audio|octet/.test(ct))) {
        fileCache.set(key, path);
        return { uri: path };
      }
      await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
      if (r.status === 200 && ct && !/audio|octet/.test(ct)) {
        // servidor sin GET /api/tts: devolvió HTML. Usar POST.
        const uri = await downloadPost(TTS_ENDPOINT, { text, performance: perf, emocion }, 40_000);
        if (uri) fileCache.set(key, uri);
        return uri ? { uri } : null;
      }
    } catch {
      /* reintento */
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  return null;
}

/**
 * POST JSON → audio → disco. FileSystem.downloadAsync solo hace GET, así que /api/cantar y el POST de
 * /api/tts van por XHR (blob → base64 → archivo).
 */
async function downloadPost(url: string, body: Record<string, unknown>, timeoutMs: number): Promise<string | null> {
  const headers = await sessionHeaders();
  return new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Accept', 'audio/*');
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.responseType = 'blob';
      xhr.timeout = timeoutMs;
      xhr.onerror = () => resolve(null);
      xhr.ontimeout = () => resolve(null);
      xhr.onload = () => {
        if (xhr.status !== 200 || !xhr.response) return resolve(null);
        const blob: Blob = xhr.response;
        const ct = String(xhr.getResponseHeader('content-type') || blob.type || '');
        if (!/audio|octet/.test(ct)) return resolve(null);
        const reader = new FileReader();
        reader.onerror = () => resolve(null);
        reader.onloadend = async () => {
          try {
            const dataUrl = String(reader.result || '');
            const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
            if (b64.length < 100) return resolve(null);
            const path = tmpPath('ultron-p', /wav/.test(ct) ? 'wav' : 'mp3');
            await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 });
            resolve(path);
          } catch {
            resolve(null);
          }
        };
        reader.readAsDataURL(blob);
      };
      xhr.send(JSON.stringify(body));
    } catch {
      resolve(null);
    }
  });
}

// ---------------------------------------------------------------- reproducción

async function prepare(source: AVPlaybackSource): Promise<Audio.Sound | null> {
  try {
    const { sound } = await Audio.Sound.createAsync(source, { shouldPlay: false, progressUpdateIntervalMillis: 50 });
    return sound;
  } catch {
    return null;
  }
}

type PlayMeta = { text?: string | null; kind?: EnvelopeKind };

/**
 * Reproduce y, mientras suena, emite el nivel de boca: envolvente por sílabas del texto (si se conoce y
 * cuadra con la duración real) o libre. La posición se interpola entre actualizaciones de estado para
 * mantener 20 Hz aunque Android reporte más lento.
 */
function playPrepared(sound: Audio.Sound, my: number, maxMs = 25_000, meta: PlayMeta = {}): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    let guard: ReturnType<typeof setTimeout> | null = null;
    let env: ((posMs: number) => number) | null = null;
    let playing = false;
    let lastPos = 0;
    let lastAt = Date.now();
    const kind: EnvelopeKind = meta.kind || 'speak';
    const tick = setInterval(() => {
      if (!playing) return emitLevel(0);
      const pos = lastPos + (Date.now() - lastAt);
      emitLevel((env || (env = envolventeLibre(kind)))(pos));
    }, 50);
    const end = () => {
      if (done) return;
      done = true;
      clearInterval(tick);
      emitLevel(0);
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
      playing = st.isPlaying;
      lastPos = st.positionMillis || 0;
      lastAt = Date.now();
      if (st.durationMillis && !guard) {
        guard = setTimeout(end, st.durationMillis + 1500);
        env = envolventeDeTexto(meta.text, st.durationMillis, kind);
      }
      if (st.didJustFinish) end();
    });
    sound.playAsync().catch(end);
    if (!guard) guard = setTimeout(end, maxMs);
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

function beginSpeak() {
  releaseLastSpeak?.();
  lastSpeak = new Promise<void>((r) => (releaseLastSpeak = r));
}
function endSpeak() {
  releaseLastSpeak?.();
  releaseLastSpeak = null;
}

/** Reproduce una fuente ya resuelta con el protocolo de callbacks. */
async function playSource(source: AVPlaybackSource | null, my: number, cb: SpeakCallbacks | undefined, maxMs: number, meta: PlayMeta = {}): Promise<boolean> {
  if (!source || my !== gen) return false;
  const sound = await prepare(source);
  if (!sound || my !== gen) {
    if (sound) void sound.unloadAsync().catch(() => {});
    return false;
  }
  cb?.onAudioStart?.();
  await playPrepared(sound, my, maxMs, meta);
  return true;
}

/**
 * Clip del banco por id (local → remoto → TTS con su texto). Ideal para «mmm», risas, «ya, ya».
 * `fallback: false` = si no hay clip, no hablar nada (para no pagar TTS por una muletilla).
 */
export async function speakClip(id: ClipId, opts?: SpeakCallbacks & { fallback?: boolean; emocion?: Emocion }): Promise<boolean> {
  await stopSpeaking();
  const my = gen;
  opts?.onStart?.();
  await ensureAudioMode();
  beginSpeak();
  try {
    const text = CLIP_TEXT[id];
    const src = await clipSource(id);
    if (src) return await playSource(src, my, opts, 120_000, { text });
    if (opts?.fallback === false || my !== gen) return false;
    const tts = await fetchSource(text, 'speak', opts?.emocion || 'neutral');
    return await playSource(tts, my, opts, 25_000, { text });
  } finally {
    endSpeak();
    if (my === gen) opts?.onEnd?.();
  }
}

/** URL/ruta arbitraria (p. ej. un mp3 del servidor). Avisa onAudioStart/onEnd como todo lo demás. */
export async function speakUrl(pathOrUrl: string, opts?: SpeakCallbacks) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
  await stopSpeaking();
  const my = gen;
  opts?.onStart?.();
  await ensureAudioMode();
  beginSpeak();
  try {
    return await playSource({ uri: url }, my, opts, 120_000);
  } finally {
    endSpeak();
    if (my === gen) opts?.onEnd?.();
  }
}

export type SongRequest = { id: string } | { letra: string; titulo?: string };

const songCache = new Map<string, string>();

/**
 * AU-RA canta de verdad: POST /api/cantar → mp3 (la primera vez puede tardar ~40 s; el servidor lo
 * cachea). Para ids del repertorio, si el clip estático /voz/<id>.mp3 existe se usa directo (más rápido).
 */
export async function speakSong(req: SongRequest, opts?: SpeakCallbacks & { onPreparing?: () => void }): Promise<boolean> {
  await stopSpeaking();
  const my = gen;
  opts?.onStart?.();
  await ensureAudioMode();
  beginSpeak();
  try {
    const key = 'id' in req ? `id:${req.id}` : `letra:${req.titulo || ''}|${req.letra}`;
    let uri = songCache.get(key) || null;
    const meta: PlayMeta = { kind: 'sing', text: 'letra' in req ? req.letra : null };
    if (!uri && 'id' in req && (req.id as ClipId) in REMOTE_CLIPS && (await remoteClipAvailable(req.id as ClipId))) {
      return await playSource({ uri: `${API_BASE}${REMOTE_CLIPS[req.id as ClipId]}` }, my, opts, 180_000, meta);
    }
    if (!uri) {
      opts?.onPreparing?.();
      uri = await downloadPost(CANTAR_ENDPOINT, req as Record<string, unknown>, 55_000);
      if (uri) songCache.set(key, uri);
    }
    if (my !== gen) return false;
    return await playSource(uri ? { uri } : null, my, opts, 180_000, meta);
  } finally {
    endSpeak();
    if (my === gen) opts?.onEnd?.();
  }
}

const prayerCache = new Map<string, string>();

/**
 * Oración del día: POST /api/orar {} | {tema} → mp3 (~3 min; el servidor lo cachea). Sin tema, si el
 * estático /voz/oracion.mp3 existe se usa directo. Cara PRAY, mic pausado y boca con envolvente 'pray'.
 */
export async function speakPrayer(opts?: SpeakCallbacks & { tema?: string; onPreparing?: () => void }): Promise<boolean> {
  await stopSpeaking();
  const my = gen;
  opts?.onStart?.();
  await ensureAudioMode();
  beginSpeak();
  try {
    const tema = (opts?.tema || '').trim();
    const meta: PlayMeta = { kind: 'pray' };
    const key = `tema:${tema}`;
    let uri = prayerCache.get(key) || null;
    if (!uri && !tema && (await remoteClipAvailable('oracion'))) {
      return await playSource({ uri: `${API_BASE}${REMOTE_CLIPS.oracion}` }, my, opts, 300_000, meta);
    }
    if (!uri) {
      opts?.onPreparing?.();
      uri = await downloadPost(ORAR_ENDPOINT, tema ? { tema } : {}, 90_000);
      if (uri) prayerCache.set(key, uri);
    }
    if (my !== gen) return false;
    return await playSource(uri ? { uri } : null, my, opts, 300_000, meta);
  } finally {
    endSpeak();
    if (my === gen) opts?.onEnd?.();
  }
}

/** Calienta la caché del servidor/disco para frases que no están grabadas. */
export async function prefetchPhrases(phrases: string[], emocion: Emocion = 'neutral') {
  const queue = phrases.map(cleanForSpeech).filter((p) => p && !clipForPhrase(p));
  const worker = async () => {
    while (queue.length) {
      const p = queue.shift()!;
      await fetchSource(p, 'speak', emocion).catch(() => null);
    }
  };
  await Promise.all([worker(), worker()]);
}

export async function speak(
  text: string,
  opts?: SpeakCallbacks & {
    performance?: Perf;
    emocion?: Emocion;
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
  const emocion = opts?.emocion || 'neutral';
  opts?.onStart?.();
  await ensureAudioMode();
  beginSpeak();

  const sentences = perf === 'sing' ? [clean] : splitSentences(clean);
  const AHEAD = 2;
  const sources: Array<Promise<AVPlaybackSource | null>> = [];
  const launch = (i: number) => {
    if (i < sentences.length && !sources[i]) sources[i] = fetchSource(sentences[i], perf, emocion);
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
      await playPrepared(sound, my, perf === 'sing' ? 120_000 : 25_000, { text: sentences[i], kind: perf === 'sing' ? 'sing' : emocion === 'oracion' ? 'pray' : 'speak' });
    }
    return spoke;
  } finally {
    if (nextPrepared) void nextPrepared.then((s) => s?.unloadAsync().catch(() => {}));
    endSpeak();
    if (my === gen) opts?.onEnd?.();
  }
}

/**
 * Locutor incremental: recibe texto a trozos (stream del cerebro) y va hablando cada oración
 * completa mientras siguen llegando las siguientes. Misma cola/generación que speak(): si algo
 * llama a stopSpeaking(), el locutor se detiene.
 */
export class StreamSpeaker {
  private buf = '';
  private queue: string[] = [];
  private pumping = false;
  private closed = false;
  private my: number;
  private spoke = false;
  private nextPrepared: Promise<Audio.Sound | null> | null = null;
  private sources = new Map<string, Promise<AVPlaybackSource | null>>();
  private resolveDone!: () => void;
  readonly done: Promise<void>;

  constructor(private opts: { emocion?: Emocion; onAudioStart?: () => void; onSentence?: (s: string) => void }) {
    // Comparte generación con speak(): stopSpeaking() lo cancela; no corta un clip en curso.
    this.my = gen;
    this.done = new Promise<void>((r) => (this.resolveDone = r));
    void ensureAudioMode();
  }

  /** La emoción llega antes del primer delta; si cambia antes de pedir audio, se aplica. */
  setEmocion(e: Emocion) {
    if (!this.sources.size) this.opts.emocion = e;
  }

  /** Texto nuevo del stream. */
  push(piece: string) {
    if (this.closed) return;
    this.buf += piece;
    // corta en fin de oración; deja el resto en buffer
    const m = this.buf.match(/^([\s\S]*?[.!?…])(\s+|$)([\s\S]*)$/);
    if (m && m[1].trim().length >= 6) {
      const sentence = cleanForSpeech(m[1]);
      this.buf = m[3] || '';
      if (sentence) this.enqueue(sentence);
    } else if (this.buf.length > 220) {
      const cut = this.buf.lastIndexOf(',');
      if (cut > 60) {
        const sentence = cleanForSpeech(this.buf.slice(0, cut + 1));
        this.buf = this.buf.slice(cut + 1);
        if (sentence) this.enqueue(sentence);
      }
    }
  }

  /** Fin del stream: habla lo que quede y resuelve `done` cuando termina el audio. */
  end() {
    if (this.closed) return;
    this.closed = true;
    const rest = cleanForSpeech(this.buf);
    this.buf = '';
    if (rest) this.enqueue(rest);
    if (!this.pumping && !this.queue.length) this.resolveDone();
  }

  cancel() {
    this.closed = true;
    this.queue = [];
    this.buf = '';
    this.resolveDone();
  }

  get hasSpoken() {
    return this.spoke;
  }

  private source(sentence: string) {
    let p = this.sources.get(sentence);
    if (!p) {
      p = fetchSource(sentence, 'speak', this.opts.emocion || 'neutral');
      this.sources.set(sentence, p);
    }
    return p;
  }

  private enqueue(sentence: string) {
    this.queue.push(sentence);
    void this.source(sentence);
    if (!this.pumping) void this.pump();
  }

  private async pump() {
    this.pumping = true;
    try {
      if (!this.spoke) await lastSpeak.catch(() => {});
      while (this.queue.length && this.my === gen) {
        const sentence = this.queue.shift()!;
        const sound = this.nextPrepared
          ? await this.nextPrepared
          : await (async () => {
              const src = await this.source(sentence);
              return src ? prepare(src) : null;
            })();
        this.nextPrepared = null;
        if (this.my !== gen) {
          if (sound) void sound.unloadAsync().catch(() => {});
          break;
        }
        if (this.queue[0]) {
          const nxt = this.queue[0];
          this.nextPrepared = (async () => {
            const src = await this.source(nxt);
            return src ? prepare(src) : null;
          })();
        }
        if (!sound) continue;
        if (!this.spoke) {
          this.spoke = true;
          this.opts.onAudioStart?.();
        }
        this.opts.onSentence?.(sentence);
        await playPrepared(sound, this.my, 25_000, { text: sentence, kind: this.opts.emocion === 'oracion' ? 'pray' : 'speak' });
      }
    } finally {
      this.pumping = false;
      if (this.nextPrepared) void this.nextPrepared.then((s) => s?.unloadAsync().catch(() => {}));
      this.nextPrepared = null;
      if (this.my !== gen) {
        this.queue = [];
        this.resolveDone();
      } else if (this.closed && !this.queue.length) this.resolveDone();
    }
  }
}
