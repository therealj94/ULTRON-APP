/**
 * La voz de la mesa: la del avatar en pantalla (Guardián, AU-RA o Claudio), en el idioma elegido,
 * siempre EN VIVO desde el servidor (ElevenLabs v4, con Voicebox de respaldo). Nunca la robótica del
 * sistema: si el servidor no da audio, se calla y el texto queda en pantalla.
 *
 * Ya no hay nada grabado en el teléfono: los saludos, «un momento» y las reacciones se dicen en vivo
 * con la voz del avatar (src/lib/frases.ts) y quedan en la caché de audio para la siguiente vez.
 *
 *  - Habla: GET /api/tts?text&emocion&performance&avatar&idioma descargado a disco, por oraciones,
 *    con la siguiente precargada mientras suena la actual.
 *  - Canciones: POST /api/cantar {id | letra, avatar, idioma}.
 *  - Oración: POST /api/orar {tema?, avatar, idioma} (el servidor la guarda por avatar e idioma).
 *  - Expresiones ([risa], [suspiro]…, src/lib/expresiones.ts): viajan dentro del texto y la voz las
 *    actúa; las demás etiquetas se quitan antes de pedir voz.
 *  - Reacciones sin palabras (speakReaccion): una expresión corta dicha por el avatar.
 *  - Lip-sync: cada reproducción emite un nivel 0..1 (setSpeechLevelListener) sobre la posición REAL
 *    del audio (positionMillis de expo-av, interpolada entre avisos). Si el servidor mandó los tiempos
 *    por letra (cabecera X-Ultron-Alineacion), la boca sale de ellos: el visema exacto de cada letra,
 *    30 veces por segundo, a senalVoz (avatar3d/sincronia.ts). Si no, la envolvente de lipsync.ts.
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
import { frase, reaccionDe, type FraseId } from './frases';
import { soloExpresiones } from './expresiones';
import type { AvatarId } from '../avatares/catalogo';
import { avatarActual, fijarAvatar } from '../avatares/actual';
import { senalVoz } from '../avatar3d/senalVoz';
import { ADELANTO_MS, BocaAlineada, Envolvente, PASO_BOCA_MS, RelojReproduccion, leerAlineacion, type AlineacionAudio } from '../avatar3d/sincronia';
import { idiomaActual } from '../i18n';

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

/** Los tiempos por letra de cada audio descargado (por su ruta en el teléfono) y de cada sonido preparado. */
const alineaciones = new Map<string, AlineacionAudio>();
const alineacionDeSonido = new WeakMap<Audio.Sound, AlineacionAudio>();

/** Una cabecera, sin importar mayúsculas (Android e iOS no las devuelven igual). */
function cabecera(h: unknown, nombre: string): string {
  if (!h || typeof h !== 'object') return '';
  const n = nombre.toLowerCase();
  for (const [k, v] of Object.entries(h as Record<string, unknown>)) if (k.toLowerCase() === n) return String(v ?? '');
  return '';
}

/** Quién habla: decide la voz que se pide al servidor (`avatar` en /api/tts). */
export function setAvatarVoz(id: AvatarId) {
  fijarAvatar(id);
}
const fileCache = new Map<string, string>();
/**
 * Tope de la caché de audios: antes solo crecía (un mp3 por frase distinta, para siempre en la sesión y
 * en disco). Al pasar el tope se borra el más viejo, del mapa y del disco. Map conserva el orden de
 * inserción, así que el primero es el más antiguo.
 */
const CACHE_MAX = 40;
function guardarEnCache(key: string, uri: string) {
  fileCache.delete(key);
  fileCache.set(key, uri);
  while (fileCache.size > CACHE_MAX) {
    const [viejo, ruta] = fileCache.entries().next().value as [string, string];
    fileCache.delete(viejo);
    alineaciones.delete(ruta);
    void FileSystem.deleteAsync(ruta, { idempotent: true }).catch(() => {});
  }
}
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
/**
 * Más oyentes del mismo nivel: la compañera AURA (src/compa) mueve su boquita con la misma voz que la
 * cara de la mesa, sin quitarle a la mesa su suscripción de siempre.
 */
const nivelOyentes = new Set<(level01: number) => void>();
export function escucharNivelVoz(cb: (level01: number) => void): () => void {
  nivelOyentes.add(cb);
  return () => {
    nivelOyentes.delete(cb);
  };
}
function emitLevel(v: number) {
  const q = Math.round(Math.max(0, Math.min(1, v)) * 50) / 50;
  if (q === lastLevel) return;
  lastLevel = q;
  levelListener?.(q);
  for (const f of nivelOyentes) f(q);
}

// ---------------------------------------------------------------- llamadas
/**
 * En una llamada (voz o video) la mesa no suena: nada se prepara ni se reproduce, y sobre todo no se
 * vuelve a fijar el modo de audio de expo-av (lo pone en modo multimedia y la llamada se oiría por el
 * altavoz equivocado o se cortaría). Al colgar, el modo se vuelve a fijar en la siguiente locución.
 */
let suspendida = false;
export function suspenderVoz(on: boolean) {
  if (suspendida === on) return;
  suspendida = on;
  if (on) void stopSpeaking();
  else audioModeSet = false;
}
export function vozSuspendida() {
  return suspendida;
}

/** El nivel de boca de una voz que no suena por aquí (la conversación fluida, por WebRTC). */
export function nivelExterno(v01: number) {
  emitLevel(v01);
}

/** Texto para pedir voz: sin markdown ni emojis. Las expresiones conocidas se quedan (suenan); el resto de corchetes, no. */
export function cleanForSpeech(text: string) {
  return soloExpresiones(String(text || ''))
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
  if (audioModeSet || suspendida) return;
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

// ---------------------------------------------------------------- descarga TTS

/**
 * Los audios de sesiones anteriores se quedaban en la caché del teléfono para siempre. La primera vez
 * que se pide voz en esta sesión se borran los `ultron-*` que haya (los de esta sesión aún no existen).
 */
let limpiezaHecha = false;
/** Solo se borra lo creado ANTES de arrancar: el nombre lleva la hora (base 36) y lo de ahora se queda. */
const INICIO_SESION = Date.now();
function limpiarAudiosViejos() {
  if (limpiezaHecha || !FileSystem.cacheDirectory) return;
  limpiezaHecha = true;
  const dir = FileSystem.cacheDirectory;
  void FileSystem.readDirectoryAsync(dir)
    .then((nombres) =>
      Promise.all(
        nombres
          .filter((n) => {
            const m = /^ultron(?:-p)?-([a-z0-9]+)-[a-z0-9]+\.(?:mp3|wav)$/.exec(n);
            return !!m && parseInt(m[1], 36) < INICIO_SESION;
          })
          .map((n) => FileSystem.deleteAsync(dir + n, { idempotent: true }).catch(() => {}))
      )
    )
    .catch(() => {});
}

function tmpPath(prefix: string, ext = 'mp3') {
  limpiarAudiosViejos();
  return `${FileSystem.cacheDirectory}${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
}

/**
 * `downloadAsync` escribe el archivo antes de saber qué llega. La voz del servidor es WAV (Voicebox)
 * y los clips son MP3; iOS elige el decodificador por la extensión, y un WAV guardado como `.mp3`
 * no suena. Se renombra según el content-type que contestó el servidor.
 */
async function conExtension(path: string, ct: string): Promise<string> {
  const ext = /wav/i.test(ct) ? 'wav' : /mpeg|mp3/i.test(ct) ? 'mp3' : null;
  if (!ext || path.endsWith(`.${ext}`)) return path;
  const nuevo = path.replace(/\.[a-z0-9]+$/, `.${ext}`);
  try {
    await FileSystem.moveAsync({ from: path, to: nuevo });
    return nuevo;
  } catch {
    return path;
  }
}

async function fetchSource(text: string, perf: Perf, emocion: Emocion, privado = false): Promise<AVPlaybackSource | null> {
  const avatar = avatarActual();
  const idioma = idiomaActual();
  if (privado) {
    // Lo que se lee de un chat cifrado: por POST (el texto no va en la URL), `privado` (el servidor no
    // guarda el audio en su caché) y sin la caché de aquí.
    const uri = await downloadPost(TTS_ENDPOINT, { text, performance: perf, emocion, avatar, idioma, privado: true }, 40_000);
    return uri ? { uri } : null;
  }
  const key = `${avatar}|${idioma}|${perf}|${emocion}|${text}`;
  const hit = fileCache.get(key);
  if (hit) return { uri: hit };
  const headers = { Accept: 'audio/*', ...(await sessionHeaders()) };
  for (let attempt = 0; attempt < 2; attempt++) {
    const path = tmpPath('ultron', 'wav');
    try {
      const r = await FileSystem.downloadAsync(ttsUrl(text, perf, emocion, avatar, idioma), path, { headers });
      const ct = String((r.headers as any)?.['Content-Type'] || (r.headers as any)?.['content-type'] || '');
      const info = await FileSystem.getInfoAsync(path);
      if (r.status === 200 && info.exists && (info.size || 0) > 64 && (!ct || /audio|octet/.test(ct))) {
        const uri = await conExtension(path, ct);
        const al = leerAlineacion(cabecera(r.headers, 'X-Ultron-Alineacion'));
        if (al) alineaciones.set(uri, al);
        guardarEnCache(key, uri);
        return { uri };
      }
      await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
      if (r.status === 200 && ct && !/audio|octet/.test(ct)) {
        // servidor sin GET /api/tts: devolvió HTML. Usar POST.
        const uri = await downloadPost(TTS_ENDPOINT, { text, performance: perf, emocion, avatar, idioma }, 40_000);
        if (uri) guardarEnCache(key, uri);
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
            const path = tmpPath('ultron-p', /mpeg|mp3/.test(ct) ? 'mp3' : 'wav');
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
  if (suspendida) return null;
  try {
    const { sound } = await Audio.Sound.createAsync(source, { shouldPlay: false, progressUpdateIntervalMillis: 50 });
    const uri = typeof source === 'object' && source && 'uri' in source ? String((source as { uri?: string }).uri || '') : '';
    const al = uri ? alineaciones.get(uri) : undefined;
    if (al) alineacionDeSonido.set(sound, al);
    return sound;
  } catch {
    return null;
  }
}

type PlayMeta = { text?: string | null; kind?: EnvelopeKind };

/**
 * Reproduce y, mientras suena, emite el nivel de boca sobre la posición real del audio (interpolada
 * entre avisos de expo-av). Con los tiempos por letra del servidor: el visema exacto de cada letra
 * (un poco adelantado, ADELANTO_MS, por lo que tarda en llegar a la pantalla), abriendo rápido y
 * cerrando suave. Sin ellos: la envolvente por sílabas del texto (si cuadra con la duración) o libre.
 */
function playPrepared(sound: Audio.Sound, my: number, maxMs = 25_000, meta: PlayMeta = {}): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    let guard: ReturnType<typeof setTimeout> | null = null;
    let env: ((posMs: number) => number) | null = null;
    const kind: EnvelopeKind = meta.kind || 'speak';
    const reloj = new RelojReproduccion();
    const al = alineacionDeSonido.get(sound);
    const alineada = al ? new BocaAlineada(al) : null;
    const suave = new Envolvente();
    let antes = Date.now();
    const tick = setInterval(() => {
      const ahora = Date.now();
      const dt = ahora - antes;
      antes = ahora;
      if (!reloj.activo) {
        suave.cortar();
        senalVoz.formaReproducida(null);
        return emitLevel(0);
      }
      const pos = reloj.posicion(ahora);
      if (alineada) {
        const b = alineada.en(pos + ADELANTO_MS);
        senalVoz.formaReproducida(b.visema);
        return emitLevel(suave.seguir(b.nivel, dt));
      }
      emitLevel((env || (env = envolventeLibre(kind)))(pos));
    }, alineada ? PASO_BOCA_MS : 50);
    const end = () => {
      if (done) return;
      done = true;
      clearInterval(tick);
      senalVoz.formaReproducida(null);
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
      reloj.aviso(st.positionMillis || 0, Date.now(), st.isPlaying);
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
  // La boca se cierra ya, no cuando el reproductor termine de parar.
  senalVoz.formaReproducida(null);
  emitLevel(0);
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

/** Una frase corta de la mesa («un momento», «de nada»), dicha en vivo por el avatar. */
export async function speakFrase(id: FraseId, opts?: SpeakCallbacks & { emocion?: Emocion }): Promise<boolean> {
  return speak(frase(id), opts);
}

/**
 * Reacción sin palabras por emoción (risa, sorpresa, cariño, sueño, pensar): una expresión corta que
 * la voz del avatar actúa. Sin reacción para esa emoción, no suena nada.
 */
export async function speakReaccion(emocion: string, opts?: SpeakCallbacks): Promise<boolean> {
  const texto = reaccionDe(emocion);
  if (!texto) return false;
  return speak(texto, { ...opts, emocion: emocion === 'risa' ? 'risa' : 'neutral' });
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
 * Canciones: POST /api/cantar → el repertorio (grabado con la voz de AU-RA: solo ella lo canta) o
 * una letra libre dicha por el avatar en pantalla (el servidor la guarda por avatar e idioma).
 */
export async function speakSong(req: SongRequest, opts?: SpeakCallbacks & { onPreparing?: () => void }): Promise<boolean> {
  await stopSpeaking();
  const my = gen;
  opts?.onStart?.();
  await ensureAudioMode();
  beginSpeak();
  try {
    const avatar = avatarActual();
    const idioma = idiomaActual();
    // Una letra libre la dice quien está en pantalla (su voz, su caché). El repertorio grabado es
    // de AU-RA: con otro avatar el servidor no lo sirve (la mesa lo explica antes de pedirlo).
    const key = `${avatar}|${idioma}|` + ('id' in req ? `id:${req.id}` : `letra:${req.titulo || ''}|${req.letra}`);
    let uri = songCache.get(key) || null;
    const meta: PlayMeta = { kind: 'sing', text: 'letra' in req ? req.letra : null };
    if (!uri) {
      opts?.onPreparing?.();
      uri = await downloadPost(CANTAR_ENDPOINT, { ...(req as Record<string, unknown>), avatar, idioma }, 55_000);
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
 * Oración: POST /api/orar {tema?, avatar, idioma} → audio (~3 min la del día; el servidor la guarda
 * por avatar e idioma). Cara PRAY, mic pausado y boca con envolvente 'pray'.
 */
export async function speakPrayer(opts?: SpeakCallbacks & { tema?: string; onPreparing?: () => void }): Promise<boolean> {
  await stopSpeaking();
  const my = gen;
  opts?.onStart?.();
  await ensureAudioMode();
  beginSpeak();
  try {
    const tema = (opts?.tema || '').trim();
    const avatar = avatarActual();
    const idioma = idiomaActual();
    const meta: PlayMeta = { kind: 'pray' };
    const key = `${avatar}|${idioma}|tema:${tema}`;
    let uri = prayerCache.get(key) || null;
    if (!uri) {
      opts?.onPreparing?.();
      uri = await downloadPost(ORAR_ENDPOINT, { ...(tema ? { tema } : {}), avatar, idioma }, 90_000);
      if (uri) prayerCache.set(key, uri);
    }
    if (my !== gen) return false;
    return await playSource(uri ? { uri } : null, my, opts, 300_000, meta);
  } finally {
    endSpeak();
    if (my === gen) opts?.onEnd?.();
  }
}

/** Calienta la caché de audio con frases que se van a decir pronto (saludos, «un momento»). */
export async function prefetchPhrases(phrases: string[], emocion: Emocion = 'neutral') {
  const queue = phrases.map(cleanForSpeech).filter(Boolean);
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
    /** Texto de un chat de la persona (una lectura): sin caché ni aquí ni en el servidor. */
    privado?: boolean;
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
    if (i < sentences.length && !sources[i]) sources[i] = fetchSource(sentences[i], perf, emocion, !!opts?.privado);
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
 * Desde cuántas letras ANTES de la coma sale la primera frase: el mismo número que el servidor
 * (lib/trozos.ts COMA_PRIMERA) y la mesa web (src/03-voz/frases.ts). Si no coinciden, un tramo que el
 * servidor ya soltó se queda esperando aquí. tests/web-frases.test.ts vigila que sigan iguales.
 */
export const COMA_PRIMERA = 28;
const RE_COMA_PRIMERA = new RegExp(`^([\\s\\S]{${COMA_PRIMERA - 1},}?[^\\d\\s][,;:])(\\s+|$)([\\s\\S]*)$`);

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
    // La PRIMERA frase larga sale en su coma (como la corta el servidor, lib/trozos COMA_PRIMERA): su
    // audio se pide mientras el cerebro sigue escribiendo. Antes esperaba al punto y una respuesta de
    // una sola frase sonaba recién al final.
    const coma = !m && !this.sources.size ? this.buf.match(RE_COMA_PRIMERA) : null;
    if (m && m[1].trim().length >= 6) {
      const sentence = cleanForSpeech(m[1]);
      this.buf = m[3] || '';
      if (sentence) this.enqueue(sentence);
    } else if (coma) {
      const sentence = cleanForSpeech(coma[1]);
      this.buf = coma[3] || '';
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
