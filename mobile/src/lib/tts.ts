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
 *
 * VOZ EN STREAMING (5.5, docs/adr/ADR-voz-en-streaming.md): con el módulo nativo (modules/aura-voz) y permiso
 * (lib/guardiaVoz.ts: interruptor remoto, Ajustes, guardia), el habla de `speak` y del locutor por frases no baja cada
 * frase entera: la pide en PCM (/api/tts/pcm) y suena con el primer trozo (lib/sonidoVivo.ts, con la misma cara que
 * un sonido de expo-av, así todo lo de arriba sigue igual). La frase siguiente se encadena sin hueco. Si el nativo falla
 * antes de sonar, ESA frase va por el camino de siempre (no se pierde) y, si el fallo es del módulo o se repite, el
 * camino nuevo queda apagado hasta reabrir la app. Canciones, oraciones, lo privado y el relleno siguen como siempre.
 */
import { Audio, type AVPlaybackSource } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { CANTAR_ENDPOINT, ORAR_ENDPOINT, TTS_ENDPOINT, renovarTokenVoz, sessionHeaders, ttsPcmUrl, ttsUrl } from './api';
import { moduloVoz } from './auraVoz';
import { CentralVoz, SonidoVivo, type FalloVoz, type Reproducible } from './sonidoVivo';
import { cabecerasVoz, falloDeSesion } from './vozNativa';
import { API_BASE } from '../config';
import type { Emocion } from './emocion';
import { envolventeDeTexto, envolventeLibre, type EnvelopeKind } from './lipsync';
import { frase, reaccionDe, type FraseId } from './frases';
import { quitarExpresiones, soloExpresiones } from './expresiones';
import type { AvatarId } from '../avatares/catalogo';
import { avatarActual, fijarAvatar } from '../avatares/actual';
import { senalVoz } from '../avatar3d/senalVoz';
import { vozSonando } from '../avatar3d/sonando';
import { ADELANTO_MS, BocaAlineada, Envolvente, PASO_BOCA_MS, RelojReproduccion, leerAlineacion, type AlineacionAudio } from '../avatar3d/sincronia';
import { idiomaActual } from '../i18n';
import { RegistroVoz } from './interrupcion';
import { faltaDecir } from './reemplazoVoz';
import { CORTADO, carreraConCorte } from './relleno';
import { COMA_PRIMERA as COMA_PRIMERA_CORTES, avanzarEstado, cortesDe, estadoInicial, letras, siguienteCorte, tienePalabras, type EstadoCorte } from './cortesVoz';

type Perf = 'speak' | 'sing';

export type SpeakCallbacks = {
  /** Se decidió hablar (antes de tener audio). */
  onStart?: () => void;
  /**
   * El primer audio ya está preparado y se manda a sonar (justo ANTES de play): aquí se pausa el mic. No es
   * el comienzo audible (el reproductor todavía no confirmó nada): ese es `onSuena`.
   */
  onAudioStart?: () => void;
  /**
   * El reproductor confirmó que el primer audio SUENA (su primer aviso con isPlaying). Es lo más cerca del
   * altavoz que se sabe desde JS: la traza mide aquí (auditoría externa del 6-oct, §7.1).
   */
  onSuena?: () => void;
  /** Terminó (o se canceló) todo el audio de esta locución. */
  onEnd?: () => void;
};

/**
 * Lo que espera a que el reproductor confirme que suena el audio que se acaba de mandar a sonar (cuandoSuene):
 * la mesa lo usa para medir «contestó con voz» en el comienzo REAL, no al pedir play.
 */
let alSonar: Array<() => void> = [];
/**
 * `f` se llama cuando el próximo audio que se manda a sonar lo confirme el reproductor (su primer aviso con
 * isPlaying). Si se calla todo antes (stopSpeaking), no se llama: ese audio nunca sonó.
 */
export function cuandoSuene(f: () => void) {
  alSonar.push(f);
}
function avisarQueSuena() {
  const fs = alSonar;
  alSonar = [];
  for (const f of fs) {
    try {
      f();
    } catch {
      /* quien mide no rompe la voz */
    }
  }
}

/**
 * Un corte para trabajo que se puede tirar (descargas de voz): quien lo pidió ya no lo quiere. Cancelar un
 * locutor aborta sus descargas en vuelo en vez de esperarlas (auditoría externa del 6-oct, VOZ-03).
 */
export class CorteIO {
  abortado = false;
  private fs = new Set<() => void>();
  /** `f` corre al abortar (o ya, si ya se abortó). Devuelve cómo quitarlo cuando el trabajo terminó solo. */
  alAbortar(f: () => void): () => void {
    if (this.abortado) {
      f();
      return () => {};
    }
    this.fs.add(f);
    return () => {
      this.fs.delete(f);
    };
  }
  abortar() {
    if (this.abortado) return;
    this.abortado = true;
    // De lo último a lo primero: en el reproductor en streaming, lo encadenado DETRÁS se cancela antes que lo que suena
    // (si no, al callar la que suena, la siguiente arrancaría un instante antes de que llegue su propio cancelar).
    const fs = [...this.fs].reverse();
    this.fs.clear();
    for (const f of fs) {
      try {
        f();
      } catch {
        /* */
      }
    }
  }
}

let current: Reproducible | null = null;
let gen = 0;

/**
 * Lo que va diciendo la voz, frase por frase (lib/interrupcion.ts): el oído lo usa para no confundir
 * el eco de AU-RA con la persona, y al interrumpirla se sabe qué alcanzó a oír.
 */
export const registroVoz = new RegistroVoz();
/** Cuánto va (0..1) de la frase que suena ahora, por la posición real del audio. */
let fraccionActual: (() => number) | null = null;
export function fraccionSonando(): number | undefined {
  try {
    return fraccionActual?.() ?? undefined;
  } catch {
    return undefined;
  }
}

/** Los tiempos por letra de cada audio descargado (por su ruta en el teléfono) y de cada sonido preparado. */
const alineaciones = new Map<string, AlineacionAudio>();
const alineacionDeSonido = new WeakMap<object, AlineacionAudio>();

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

/**
 * Con la conversación en vivo (la llamada del avatar) abierta habla el agente por WebRTC: la mesa no le
 * pone su voz encima. No basta con callar lo que suena al abrirse: cada `speak()` empieza una generación
 * nueva, así que un turno que ya venía en camino (su locutor por frases), la segunda parte de una
 * reacción («ya, ya» y la risa) o una canción pedida desde el menú volvían a sonar encima del agente.
 * Aquí se corta en la raíz: no se pide audio ni se reproduce nada; el texto sigue llegando a la pantalla.
 * Lo fija el VozProvider (llamadaCiclo.ts, `seguirVozMesa`). Aparte de `suspendida`: esa es la de las
 * llamadas de PULSE2CHAT, con su propio dueño y su modo de audio.
 */
let callaPorConversacion = false;
export function callarPorConversacion(on: boolean) {
  if (callaPorConversacion === on) return;
  callaPorConversacion = on;
  if (on) void stopSpeaking();
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
  // Por los fines de frase del contrato compartido (lib/cortesVoz.ts): «Dr. Gómez», «EE. UU.» o «1.500» no
  // se parten (antes cualquier punto con espacio detrás partía, y «Dr.» sonaba suelto).
  const parts: string[] = [];
  let desde = 0;
  for (const c of cortesDe(text, { comas: false })) {
    parts.push(text.slice(desde, c.fin).trim());
    desde = c.fin;
  }
  parts.push(text.slice(desde).trim());
  for (let i = parts.length - 1; i >= 0; i--) if (!parts[i]) parts.splice(i, 1);
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

// ---------------------------------------------------------------- voz en streaming (modules/aura-voz)

/** Lo fija lib/guardiaVoz.ts (remoto, Ajustes, guardia). Hasta que lo lea, el camino de siempre. */
let vivoPermitido = false;
/** Por qué el camino nuevo quedó apagado en esta sesión (null: no falló). No se reintenta hasta reabrir la app. */
let falloVivo: string | null = null;
/** Frases seguidas que fallaron antes de sonar por el nativo (una que suena lo vuelve a cero). */
let fallosSeguidos = 0;
let central: CentralVoz | null | undefined;
type OyenteVozVivo = { alFallar?: (f: FalloVoz, apagada: string | null) => void; alSonar?: () => void };
const oyentesVivo = new Set<OyenteVozVivo>();

export function permitirVozEnVivo(on: boolean) {
  vivoPermitido = on;
}

/** Qué pasa con la voz en streaming (Ajustes y el diagnóstico). */
export function estadoVozEnVivo(): { disponible: boolean; permitida: boolean; fallo: string | null } {
  return { disponible: !!centralVoz(), permitida: vivoPermitido, fallo: falloVivo };
}

/**
 * Lo que se espera antes de la PRIMERA frase por el nativo (lib/guardiaVoz.ts: anotar «arrancando» en el disco, por si
 * el módulo cierra la app). false: no quedó anotado y esta sesión va por el camino de siempre. Se vuelve a pedir si se
 * fija otra vez (al volver de segundo plano).
 */
let antesDeVivo: (() => Promise<boolean>) | null = null;
let antesDeVivoP: Promise<boolean> | null = null;
export function alPrimeraVozEnVivo(f: (() => Promise<boolean>) | null) {
  antesDeVivo = f;
  antesDeVivoP = null;
}

/** Solo pruebas (pruebas/oido/vozvivo.cjs): como reabrir la app, sin el fallo de la sesión. */
export function _olvidarFalloVozEnVivo() {
  falloVivo = null;
  fallosSeguidos = 0;
}

/** Quien cuida el camino nuevo (lib/guardiaVoz.ts): fallos (y si lo apagaron en la sesión) y frases que sonaron. */
export function escucharVozEnVivo(o: OyenteVozVivo): () => void {
  oyentesVivo.add(o);
  return () => {
    oyentesVivo.delete(o);
  };
}

function centralVoz(): CentralVoz | null {
  if (central !== undefined) return central;
  try {
    const m = moduloVoz();
    central = m ? new CentralVoz(m) : null;
  } catch {
    central = null;
  }
  return central;
}

/** ¿Esta locución va por el camino nuevo? Solo habla (no canto), no privada y sin la voz suspendida. */
function usarVivo(perf: Perf, privado: boolean): boolean {
  return vivoPermitido && !falloVivo && perf === 'speak' && !privado && !suspendida && !callaPorConversacion && !!centralVoz();
}

function anotarFalloVivo(f: FalloVoz) {
  fallosSeguidos += 1;
  if (!falloVivo && falloDeSesion(f, fallosSeguidos)) falloVivo = `${f.codigo}${f.status ? ` ${f.status}` : ''}: ${f.motivo}`.slice(0, 160);
  for (const o of [...oyentesVivo]) {
    try {
      o.alFallar?.(f, falloVivo);
    } catch {
      /* */
    }
  }
}

function anotarSonoVivo() {
  fallosSeguidos = 0;
  for (const o of [...oyentesVivo]) {
    try {
      o.alSonar?.();
    } catch {
      /* */
    }
  }
}

/** Una frase por el camino nuevo: todavía no se bajó nada; el nativo la empieza a bajar al prepararla. */
type PedidoVivo = { url: string; texto: string; perf: Perf; emocion: Emocion; vecinos?: VecinosVoz; voz?: AvatarId; corte?: CorteIO; alListo?: () => void };
type Fuente = AVPlaybackSource | { vivo: PedidoVivo };
function esVivo(f: Fuente | null | undefined): f is { vivo: PedidoVivo } {
  return !!f && typeof f === 'object' && 'vivo' in (f as object);
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

/**
 * Lo dicho justo antes y lo que viene, como ElevenLabs los quiere (`previous_text` / `next_text`): texto
 * plano, sin etiquetas, corto. Con ellos la frase no arranca con entonación de comienzo, y el servidor
 * pone el tono de la emoción solo en la primera (la que no tiene `previo`) — auditoría externa, 1-oct.
 */
export type VecinosVoz = { previo?: string; siguiente?: string };
function vecinosLimpios(v?: VecinosVoz): { previo?: string; siguiente?: string } {
  const limpio = (t?: string) => quitarExpresiones(String(t || '')).replace(/\s+/g, ' ').trim();
  const previo = limpio(v?.previo).slice(-200);
  const siguiente = limpio(v?.siguiente).slice(0, 200);
  return { ...(previo ? { previo } : {}), ...(siguiente ? { siguiente } : {}) };
}

/**
 * GET a disco. Con un `corte`, la descarga se puede abortar (createDownloadResumable + cancelAsync): quien la
 * pidió (un locutor cancelado) no la espera ni la deja corriendo. Sin corte, como siempre.
 */
async function descargar(url: string, path: string, headers: Record<string, string>, corte?: CorteIO): Promise<FileSystem.FileSystemDownloadResult | null> {
  if (!corte || typeof FileSystem.createDownloadResumable !== 'function') return FileSystem.downloadAsync(url, path, { headers });
  const tarea = FileSystem.createDownloadResumable(url, path, { headers });
  const quitar = corte.alAbortar(() => void tarea.cancelAsync().catch(() => {}));
  try {
    return (await tarea.downloadAsync()) || null;
  } finally {
    quitar();
  }
}

/** Los vecinos cambian la entonación (y el tono va solo en la primera): forman parte de la clave. */
function claveAudio(avatar: string, idioma: string, perf: Perf, emocion: Emocion, text: string, v: { previo?: string; siguiente?: string }) {
  return `${avatar}|${idioma}|${perf}|${emocion}|${text}|${(v.previo || '').slice(-40)}|${(v.siguiente || '').slice(0, 40)}`;
}

/**
 * De dónde sale la voz de una frase: por el camino nuevo (un pedido que el nativo baja y suena a medida que llega)
 * o por el de siempre (fetchSource: la frase entera en disco). Lo que ya está en la caché de aquí (los saludos y
 * «un momento» que se precalientan) sale de ahí: suena sin esperar a nadie.
 */
async function fuenteDe(text: string, perf: Perf, emocion: Emocion, privado = false, vecinos?: VecinosVoz, voz?: AvatarId, corte?: CorteIO, permitirVivo = true): Promise<Fuente | null> {
  if (callaPorConversacion || corte?.abortado) return null;
  if (permitirVivo && usarVivo(perf, privado)) {
    const avatar = voz || avatarActual();
    const idioma = idiomaActual();
    const v = vecinosLimpios(vecinos);
    const hit = fileCache.get(claveAudio(avatar, idioma, perf, emocion, text, v));
    if (hit) return { uri: hit };
    return { vivo: { url: ttsPcmUrl(text, perf, emocion, avatar, idioma, v), texto: text, perf, emocion, vecinos, voz, corte } };
  }
  return fetchSource(text, perf, emocion, privado, vecinos, voz, corte);
}

/**
 * La frase entera en disco. `deLaPersona`: la voz de algo que la persona está esperando (una respuesta, una canción que
 * pidió); si el token venció, la renovación puede pedir la huella (lib/permisoHuella.ts). Lo que se precarga
 * (prefetchPhrases, prepararHabla) pasa false: no pregunta, falla callado y espera.
 */
async function fetchSource(text: string, perf: Perf, emocion: Emocion, privado = false, vecinos?: VecinosVoz, voz?: AvatarId, corte?: CorteIO, deLaPersona = true): Promise<AVPlaybackSource | null> {
  // Con la conversación en vivo nadie la va a oír: ni se le pide al servidor (cuesta voz).
  if (callaPorConversacion || corte?.abortado) return null;
  // `voz`: habla otro que el avatar de la mesa (los anfitriones del recorrido, recorrido/).
  const avatar = voz || avatarActual();
  const idioma = idiomaActual();
  if (privado) {
    // Lo que se lee de un chat cifrado: por POST (el texto no va en la URL), `privado` (el servidor no
    // guarda el audio en su caché) y sin la caché de aquí.
    const uri = await downloadPost(TTS_ENDPOINT, { text, performance: perf, emocion, avatar, idioma, privado: true, ...vecinosLimpios(vecinos) }, 40_000, corte, false, deLaPersona);
    return uri && !corte?.abortado ? { uri } : null;
  }
  const v = perf === 'sing' ? {} : vecinosLimpios(vecinos);
  const key = claveAudio(avatar, idioma, perf, emocion, text, v);
  const hit = fileCache.get(key);
  if (hit) return { uri: hit };
  let headers: Record<string, string> = { Accept: 'audio/*', ...(await sessionHeaders()) };
  let renovado = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (corte?.abortado) return null;
    const path = tmpPath('ultron', 'wav');
    try {
      const r = await descargar(ttsUrl(text, perf, emocion, avatar, idioma, v), path, headers, corte);
      if (!r || corte?.abortado) {
        // Abortada: ni se reintenta ni se guarda lo que haya quedado a medias.
        await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
        return null;
      }
      // La voz pide sesión (lo no guardado): con el token vencido se renueva una vez y se vuelve a pedir.
      if (r.status === 401 && !renovado) {
        renovado = true;
        await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
        if (!(await renovarTokenVoz(deLaPersona))) return null;
        headers = { Accept: 'audio/*', ...(await sessionHeaders()) };
        attempt -= 1;
        continue;
      }
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
        const uri = await downloadPost(TTS_ENDPOINT, { text, performance: perf, emocion, avatar, idioma, ...v }, 40_000, corte, false, deLaPersona);
        if (uri) guardarEnCache(key, uri);
        return uri && !corte?.abortado ? { uri } : null;
      }
    } catch {
      /* reintento */
    }
    if (corte?.abortado) return null;
    await new Promise((res) => setTimeout(res, 250));
  }
  return null;
}

/**
 * POST JSON → audio → disco. FileSystem.downloadAsync solo hace GET, así que /api/cantar y el POST de
 * /api/tts van por XHR (blob → base64 → archivo).
 */
async function downloadPost(url: string, body: Record<string, unknown>, timeoutMs: number, corte?: CorteIO, renovado = false, deLaPersona = true): Promise<string | null> {
  const headers = await sessionHeaders();
  if (corte?.abortado) return null;
  const r = await postAudio(url, body, timeoutMs, headers, corte);
  // Token vencido (la voz, el canto o la oración que no estaban guardados piden sesión): se renueva una vez y se repite.
  if (r === 401 && !renovado && !corte?.abortado && (await renovarTokenVoz(deLaPersona))) return downloadPost(url, body, timeoutMs, corte, true, deLaPersona);
  return typeof r === 'string' ? r : null;
}

/** El POST de audio: la ruta del archivo, 401 si el servidor pidió sesión, o null. */
function postAudio(url: string, body: Record<string, unknown>, timeoutMs: number, headers: Record<string, string>, corte?: CorteIO): Promise<string | 401 | null> {
  return new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      // Abortada (el locutor se canceló): se corta la petición y nadie espera su respuesta.
      corte?.alAbortar(() => {
        try {
          xhr.abort();
        } catch {
          /* */
        }
        resolve(null);
      });
      xhr.open('POST', url);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Accept', 'audio/*');
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.responseType = 'blob';
      xhr.timeout = timeoutMs;
      xhr.onerror = () => resolve(null);
      xhr.ontimeout = () => resolve(null);
      xhr.onload = () => {
        if (xhr.status === 401) return resolve(401);
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

async function prepare(source: Fuente): Promise<Reproducible | null> {
  // Todo lo que suena pasa por aquí (frases, el locutor del turno, canciones, oraciones).
  if (suspendida || callaPorConversacion) return null;
  if (esVivo(source)) return prepararVivo(source.vivo);
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

/**
 * Encola la frase en el nativo (empieza a bajar; suena con playAsync). Si el puente no la acepta, o el nativo falla
 * antes de sonar, la misma frase por el camino de siempre (`respaldo`): nunca se pierde.
 */
async function prepararVivo(p: PedidoVivo): Promise<Reproducible | null> {
  const respaldo = async (): Promise<Reproducible | null> => {
    const src = await fetchSource(p.texto, p.perf, p.emocion, false, p.vecinos, p.voz, p.corte);
    return src ? prepare(src) : null;
  };
  const c = centralVoz();
  if (!c) return respaldo();
  if (antesDeVivo) {
    if (!antesDeVivoP) antesDeVivoP = antesDeVivo().catch(() => false);
    if (!(await antesDeVivoP)) {
      if (!falloVivo) falloVivo = 'guardia: no se pudo anotar en el disco';
      return respaldo();
    }
  }
  const cabeceras = cabecerasVoz(await sessionHeaders().catch(() => ({})));
  if (p.corte?.abortado || suspendida || callaPorConversacion) return null;
  const s = c.crear({ url: p.url, cabeceras, respaldo, alFallar: anotarFalloVivo, alSonar: anotarSonoVivo, alListo: p.alListo });
  if (!s) return respaldo();
  // Un locutor cancelado aborta sus descargas: la del nativo también.
  p.corte?.alAbortar(() => void s.unloadAsync());
  return s;
}

/**
 * Cuando `actual` suene por el nativo, la frase preparada detrás (`siguiente`) puede encadenarse: sonará en cuanto
 * termine, sin hueco. `sigueValiendo` se mira en ese momento (y lo que la invalide después la cancela en el nativo).
 */
function encadenarDetras(actual: Reproducible, siguiente: Promise<Reproducible | null> | null | undefined, sigueValiendo: () => boolean) {
  if (!(actual instanceof SonidoVivo) || !siguiente) return;
  actual.cuandoSuene(() => {
    void siguiente.then((s) => {
      if (s instanceof SonidoVivo && sigueValiendo()) s.encadenar();
    });
  });
}

type PlayMeta = {
  text?: string | null;
  kind?: EnvelopeKind;
  /** El reproductor confirmó que suena (primer aviso con isPlaying, sin haber terminado): una vez. */
  alSonar?: () => void;
  /**
   * La locución a la que pertenece este audio (un `speak`, un locutor, una canción): su primer «suena» la pasa a
   * hablando en avatar3d/sonando.ts (la cara habla desde ahí, no desde que se pidió play).
   */
  locucion?: object;
};

/**
 * Reproduce y, mientras suena, emite el nivel de boca sobre la posición real del audio (interpolada
 * entre avisos de expo-av). Con los tiempos por letra del servidor: el visema exacto de cada letra
 * (un poco adelantado, ADELANTO_MS, por lo que tarda en llegar a la pantalla), abriendo rápido y
 * cerrando suave. Sin ellos: la envolvente por sílabas del texto (si cuadra con la duración) o libre.
 */
/**
 * Cómo se suelta la espera de la frase que suena ahora. stopSpeaking la llama: parar el sonido no dispara
 * su final natural, y sin esto el turno quedaba esperando al guard (hasta 25 s) con la voz ya callada y la
 * siguiente pregunta en cola (auditoría de Codex del 3-oct, VOZ 001).
 */
let soltarActual: (() => void) | null = null;

function playPrepared(sound: Reproducible, my: number, maxMs = 25_000, meta: PlayMeta = {}): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    let guard: ReturnType<typeof setTimeout> | null = null;
    let env: ((posMs: number) => number) | null = null;
    const kind: EnvelopeKind = meta.kind || 'speak';
    const reloj = new RelojReproduccion();
    const al = alineacionDeSonido.get(sound);
    const alineada = al ? new BocaAlineada(al) : null;
    // Por el nativo: la boca sale del volumen REAL que suena en esa posición (lib/vozNativa.ts nivelDeRms).
    const vivo = sound instanceof SonidoVivo ? sound : null;
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
      const real = vivo?.nivelBoca();
      if (real != null) return emitLevel(suave.seguir(real, dt));
      emitLevel((env || (env = envolventeLibre(kind)))(pos));
    }, alineada || vivo ? PASO_BOCA_MS : 50);
    let duracion = 0;
    let confirmada = false;
    const end = () => {
      if (done) return;
      done = true;
      clearInterval(tick);
      if (fraccionActual === fraccion) fraccionActual = null;
      // Sonó entera (no la cortaron): cuenta como oída.
      if (my === gen && meta.text) registroVoz.termino();
      senalVoz.formaReproducida(null);
      emitLevel(0);
      if (guard) clearTimeout(guard);
      if (current === sound) current = null;
      if (soltarActual === end) soltarActual = null;
      // Calló (terminó, la cortaron o falló): el cuerpo deja de hablar (avatar3d/sonando.ts).
      vozSonando.sonar(sound, false);
      void sound.unloadAsync().catch(() => {});
      resolve();
    };
    const fraccion = () => (duracion > 0 ? reloj.posicion(Date.now()) / duracion : NaN);
    if (my !== gen) return end();
    current = sound;
    soltarActual = end;
    fraccionActual = fraccion;
    if (meta.text && kind !== 'sing') registroVoz.empezo(meta.text);
    sound.setOnPlaybackStatusUpdate((st) => {
      if (done) return;
      if (!st.isLoaded) {
        vozSonando.sonar(sound, false, meta.locucion);
        if ((st as any).error) end();
        return;
      }
      // El cuerpo habla mientras el reproductor dice que suena: no al pedir el audio, ni pausado o cargando.
      // De otra generación (ya la callaron) no cuenta: un aviso tardío no reabre la boca.
      vozSonando.sonar(sound, !!st.isPlaying && !st.didJustFinish && my === gen, meta.locucion);
      // El comienzo REAL de la voz: el primer aviso del reproductor diciendo que suena (no el play pedido).
      if (!confirmada && st.isPlaying && !st.didJustFinish && my === gen) {
        confirmada = true;
        avisarQueSuena();
        try {
          meta.alSonar?.();
        } catch {
          /* quien mide no rompe la voz */
        }
      }
      reloj.aviso(st.positionMillis || 0, Date.now(), !!st.isPlaying);
      if (st.durationMillis) duracion = st.durationMillis;
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

/** Los locutores por frases vivos: al cambiar la generación se sueltan YA (no al volver la red). */
const locutoresVivos = new Set<{ alCambiarGen: () => void }>();

/**
 * Calla ESTE sonido si es el que suena ahora, sin cambiar la generación: lo usa un locutor cancelado para cortar
 * lo suyo sin tocar lo de nadie más (si ya suena otro, no hace nada).
 */
function callarSonido(sound: Reproducible) {
  if (current !== sound) return;
  current = null;
  fraccionActual = null;
  registroVoz.callo();
  senalVoz.formaReproducida(null);
  emitLevel(0);
  const soltar = soltarActual;
  soltarActual = null;
  void sound.stopAsync().catch(() => {});
  soltar?.();
}

export async function stopSpeaking() {
  gen += 1;
  // Lo que esperaba el comienzo del audio de antes ya no lo va a ver: ese audio no suena.
  alSonar = [];
  // El reproductor en streaming se calla en el acto y vacía su cola (lo encadenado detrás tampoco suena).
  if (central) central.parar();
  for (const l of [...locutoresVivos]) l.alCambiarGen();
  const s = current;
  current = null;
  fraccionActual = null;
  registroVoz.callo();
  // La boca se cierra ya, no cuando el reproductor termine de parar.
  senalVoz.formaReproducida(null);
  emitLevel(0);
  const soltar = soltarActual;
  soltarActual = null;
  if (s) {
    try {
      await s.stopAsync();
      await s.unloadAsync();
    } catch {
      /* */
    }
  }
  // La espera de esa frase se suelta ya (quien hablaba sigue con el turno siguiente), no al guard.
  soltar?.();
  // Nada suena ni se prepara: el cuerpo deja de hablar ya (avatar3d/sonando.ts).
  vozSonando.callar();
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
  await playPrepared(sound, my, maxMs, { ...meta, alSonar: cb?.onSuena });
  return true;
}

/**
 * Una locución de un solo audio (canción, oración, un mp3): prepara desde que se pide hasta que suena, habla
 * mientras suena y termina al final (avatar3d/sonando.ts). Devuelve la locución y cómo cerrarla.
 */
function locucionSuelta(): { locucion: object; cerrar: () => void } {
  const locucion = {};
  vozSonando.preparar(locucion, true);
  return { locucion, cerrar: () => vozSonando.terminar(locucion) };
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
  const loc = locucionSuelta();
  opts?.onStart?.();
  await ensureAudioMode();
  beginSpeak();
  try {
    return await playSource({ uri: url }, my, opts, 120_000, { locucion: loc.locucion });
  } finally {
    loc.cerrar();
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
  const loc = locucionSuelta();
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
    const meta: PlayMeta = { kind: 'sing', text: 'letra' in req ? req.letra : null, locucion: loc.locucion };
    if (!uri) {
      opts?.onPreparing?.();
      uri = await downloadPost(CANTAR_ENDPOINT, { ...(req as Record<string, unknown>), avatar, idioma }, 55_000);
      if (uri) songCache.set(key, uri);
    }
    if (my !== gen) return false;
    return await playSource(uri ? { uri } : null, my, opts, 180_000, meta);
  } finally {
    loc.cerrar();
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
  const loc = locucionSuelta();
  opts?.onStart?.();
  await ensureAudioMode();
  beginSpeak();
  try {
    const tema = (opts?.tema || '').trim();
    const avatar = avatarActual();
    const idioma = idiomaActual();
    const meta: PlayMeta = { kind: 'pray', locucion: loc.locucion };
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
    loc.cerrar();
    endSpeak();
    if (my === gen) opts?.onEnd?.();
  }
}

/** Calienta la caché de audio con frases que se van a decir pronto (saludos, «un momento»). */
export async function prefetchPhrases(phrases: string[], emocion: Emocion = 'neutral', voz?: AvatarId) {
  const queue = phrases.map(cleanForSpeech).filter(Boolean);
  const worker = async () => {
    while (queue.length) {
      const p = queue.shift()!;
      await fetchSource(p, 'speak', emocion, false, undefined, voz, undefined, false).catch(() => null);
    }
  };
  await Promise.all([worker(), worker()]);
}

/**
 * Deja listo el audio de un texto entero, partido igual que lo parte `speak` (con sus vecinos, que son
 * parte de la clave de la caché): cuando llegue su turno suena sin esperar al servidor. Lo usa el
 * recorrido para preparar la frase que sigue mientras suena la de ahora.
 */
export async function prepararHabla(text: string, o?: { emocion?: Emocion; voz?: AvatarId }): Promise<void> {
  const clean = cleanForSpeech(text);
  if (!clean || callaPorConversacion) return;
  const frases = splitSentences(clean);
  await Promise.all(frases.map((f, i) => fetchSource(f, 'speak', o?.emocion || 'neutral', false, { previo: frases[i - 1], siguiente: frases[i + 1] }, o?.voz, undefined, false).catch(() => null)));
}

export async function speak(
  text: string,
  opts?: SpeakCallbacks & {
    performance?: Perf;
    emocion?: Emocion;
    /** Texto de un chat de la persona (una lectura): sin caché ni aquí ni en el servidor. */
    privado?: boolean;
    /** Con la voz de este avatar en vez del de la mesa (los anfitriones del recorrido). */
    voz?: AvatarId;
    /**
     * Si esto se cumple ANTES de que empiece a sonar, no suena nada (y la cola de voz se suelta enseguida); si ya suena,
     * termina la frase en curso y no empieza la siguiente. Es el relleno del turno: el primer texto de la respuesta lo
     * corta (lib/relleno.ts). Antes la respuesta esperaba a que el relleno se bajara y sonara entero.
     */
    hastaQue?: Promise<unknown>;
  }
): Promise<boolean> {
  const clean = cleanForSpeech(text);
  // Con la conversación en vivo, ni siquiera el stopSpeaking de abajo: comparte el nivel de la boca con
  // el agente y se la cerraría de golpe a media frase.
  if (!clean || callaPorConversacion) {
    opts?.onEnd?.();
    return false;
  }
  await stopSpeaking();
  const my = gen;
  const perf = opts?.performance || 'speak';
  const emocion = opts?.emocion || 'neutral';
  // Pidió decir algo y el audio todavía no suena: el cuerpo piensa (no habla) hasta la primera sílaba.
  const locucion = {};
  vozSonando.preparar(locucion, true);
  opts?.onStart?.();
  await ensureAudioMode();
  beginSpeak();

  const sentences = perf === 'sing' ? [clean] : splitSentences(clean);
  const AHEAD = 2;
  const sources: Array<Promise<Fuente | null>> = [];
  // El relleno (`hastaQue`) va por el camino de siempre: su corte gana mientras se BAJA, y por el nativo ya estaría sonando.
  const vivoOk = !opts?.hastaQue;
  const launch = (i: number) => {
    if (i < sentences.length && !sources[i]) sources[i] = fuenteDe(sentences[i], perf, emocion, !!opts?.privado, { previo: sentences[i - 1], siguiente: sentences[i + 1] }, opts?.voz, undefined, vivoOk);
  };
  for (let i = 0; i < Math.min(AHEAD + 1, sentences.length); i++) launch(i);

  let spoke = false;
  let nextPrepared: Promise<Reproducible | null> | null = null;
  let cortado = false;
  void opts?.hastaQue?.then(() => (cortado = true));
  try {
    for (let i = 0; i < sentences.length; i++) {
      if (my !== gen || cortado) return spoke;
      launch(i + AHEAD);
      const sound = nextPrepared ? await nextPrepared : await (async () => {
        // Mientras se baja la primera, el corte la gana: no se espera al servidor para no decirla.
        const src = spoke ? await sources[i] : await carreraConCorte(sources[i], opts?.hastaQue);
        if (src === CORTADO) return null;
        return src ? prepare(src) : null;
      })();
      nextPrepared = null;
      if (my !== gen || cortado) {
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
      const primera = !spoke;
      if (!spoke) {
        spoke = true;
        // Todavía no suena (se manda a sonar): sigue «preparando» hasta que el reproductor lo confirme (locucion).
        opts?.onAudioStart?.();
      }
      // Por el nativo: la siguiente suena pegada a esta (sin hueco), si nada la invalidó.
      const siguiente = nextPrepared;
      encadenarDetras(sound, siguiente, () => my === gen && !cortado && nextPrepared === siguiente);
      await playPrepared(sound, my, perf === 'sing' ? 120_000 : 25_000, {
        text: sentences[i],
        kind: perf === 'sing' ? 'sing' : emocion === 'oracion' ? 'pray' : 'speak',
        alSonar: primera ? opts?.onSuena : undefined,
        locucion,
      });
    }
    return spoke;
  } finally {
    // Terminó, la cortaron o no sonó nada: ni prepara ni habla (la cara deja de hablar en el acto).
    vozSonando.terminar(locucion);
    if (nextPrepared) void nextPrepared.then((s) => s?.unloadAsync().catch(() => {}));
    endSpeak();
    if (my === gen) opts?.onEnd?.();
  }
}

/**
 * Desde cuántas letras ANTES de la coma sale la primera frase: el mismo número que el servidor
 * (lib/trozos.ts COMA_PRIMERA) y la mesa web (src/03-voz/frases.ts), porque los tres cortan con el mismo
 * contrato (lib/cortesVoz.ts). tests/web-frases.test.ts vigila que sigan iguales.
 */
export const COMA_PRIMERA = COMA_PRIMERA_CORTES;

/**
 * Una frase de menos letras que esto («Sí.», «Ok.», «¡Va!») se junta con la siguiente si la siguiente ya llegó
 * entera (una petición de voz en vez de dos, y no suena entrecortado). Si no llegó, sale sola: nunca se queda
 * esperando y tapando lo de detrás (VOZ-01: antes no se cortaba y todo lo de detrás esperaba al final).
 */
export const FRASE_CORTA_LETRAS = 6;

/** Cómo terminó un locutor: dijo todo lo que le dieron (`terminado`) o lo cortaron (`cancelado`). */
export type FinLocutor = 'terminado' | 'cancelado';

type FraseCola = { texto: string; previo: string; v: number };

/** Suelta un sonido preparado que ya nadie va a usar (cuando llegue, si todavía no llegó). */
function soltarPreparado(p: Promise<Reproducible | null>) {
  void p.then((s) => s?.unloadAsync().catch(() => {})).catch(() => {});
}

/**
 * Locutor incremental: recibe texto a trozos (stream del cerebro) y va hablando cada frase completa mientras
 * siguen llegando las siguientes. Misma generación que speak(): si algo llama a stopSpeaking(), el locutor se
 * suelta en ese momento (sus descargas se abortan y `done` se resuelve sin esperar a la red).
 *
 * Dos maneras de cambiar lo que dice (auditoría externa del 6-oct, VOZ-03):
 *  · `cancel()` CANCELA: inmediato. Calla lo suyo que suena, aborta descargas, suelta lo preparado, y nada de
 *    este locutor vuelve a sonar (cada `await` mira si sigue vigente). `done` se resuelve ya; `fin` dice
 *    'cancelado'. Llamarlo dos veces no hace nada más.
 *  · `reemplazar()` REEMPLAZA: la frase que suena termina (no se corta a media palabra), pero la cola y lo
 *    preparado del texto viejo se tiran y no reviven; de lo nuevo se dice lo que falta.
 */
export class StreamSpeaker {
  /** Lo recibido desde el principio (o desde el último `reemplazar`): los cortes son posiciones de este texto. */
  private texto = '';
  /** Hasta dónde ya se cortó (lib/cortesVoz.ts) y el estado del corte en esa posición. */
  private cortado = 0;
  private estadoCorte: EstadoCorte = estadoInicial();
  /** Hasta dónde ya se mandó a decir: entre `emitido` y `cortado` queda, como mucho, un pedazo sin palabras. */
  private emitido = 0;
  /**
   * Las frases por decir, cada una con la que se dijo antes (su `previo`: entonación y tono) y la versión
   * del texto a la que pertenecen (`reemplazar` la sube: lo de una versión vieja ya no suena).
   */
  private queue: FraseCola[] = [];
  /** La versión del texto: sube con cada `replace` del servidor. */
  private version = 0;
  /** Las frases que ya empezaron a sonar, en orden: lo que la persona ya oyó. */
  private oido: string[] = [];
  private pumping = false;
  private closed = false;
  private cancelado = false;
  private terminadoCon: FinLocutor | null = null;
  private my: number;
  private spoke = false;
  /** El sonido que puso ESTE locutor y suena ahora (cancelar lo calla; no toca el de nadie más). */
  private sonido: Reproducible | null = null;
  /** Esta locución en avatar3d/sonando.ts: prepara desde la primera frase, habla desde que suena, termina al resolver. */
  private readonly locucion = {};
  /** La frase siguiente, preparándose mientras suena la actual (o mientras termina el relleno). */
  private nextPrepared: { frase: FraseCola; p: Promise<Reproducible | null> } | null = null;
  private sources = new Map<string, Promise<Fuente | null>>();
  /** Las descargas de este locutor: cancelar las aborta. */
  private io = new CorteIO();
  private soltarEsperas!: () => void;
  /** Se resuelve al cancelar: toda espera del locutor compite con esto (la red abandonada no retiene a nadie). */
  private readonly cortadoP: Promise<null>;
  private resolverFin!: (f: FinLocutor) => void;
  /** Cómo terminó: 'terminado' (dijo todo) o 'cancelado'. Se resuelve una sola vez. */
  readonly fin: Promise<FinLocutor>;
  /** Terminó o lo cancelaron (lo de siempre; `fin` dice cuál). */
  readonly done: Promise<void>;
  private readonly vivo = {
    alCambiarGen: () => {
      if (this.my !== gen) this.cancel();
    },
  };

  /**
   * `onAudioStart`: la primera frase se manda a sonar (antes de play; aquí se pausa el mic).
   * `onSuena`: el reproductor confirmó que la primera frase suena (el comienzo real, para la traza).
   * `onAudioBajado`: el audio de la primera frase terminó de bajar (todavía no suena; lib/trazaTurno.ts «tts»).
   */
  constructor(
    private opts: {
      emocion?: Emocion;
      onAudioStart?: () => void;
      onSuena?: () => void;
      onSentence?: (s: string) => void;
      onAudioBajado?: () => void;
    }
  ) {
    // Comparte generación con speak(): stopSpeaking() lo cancela; no corta un clip en curso.
    this.my = gen;
    this.cortadoP = new Promise<null>((r) => (this.soltarEsperas = () => r(null)));
    this.fin = new Promise<FinLocutor>((r) => (this.resolverFin = r));
    this.done = this.fin.then(() => undefined);
    locutoresVivos.add(this.vivo);
    void ensureAudioMode();
  }

  /** La emoción llega antes del primer delta; si cambia antes de pedir audio, se aplica. */
  setEmocion(e: Emocion) {
    if (!this.sources.size) this.opts.emocion = e;
  }

  /** ¿Sigue valiendo lo de este locutor? (cancelado o callado por otra locución: no). */
  private vigente() {
    return !this.cancelado && this.my === gen;
  }

  /** Espera `p`, pero si cancelan antes devuelve null en seguida. */
  private esperar<T>(p: Promise<T>): Promise<T | null> {
    return Promise.race([p, this.cortadoP]);
  }

  private resolver(f: FinLocutor) {
    if (this.terminadoCon) return;
    this.terminadoCon = f;
    locutoresVivos.delete(this.vivo);
    vozSonando.terminar(this.locucion);
    this.resolverFin(f);
  }

  /** Texto nuevo del stream. */
  push(piece: string) {
    if (this.closed) return;
    this.texto += piece;
    this.cortar();
  }

  /**
   * Saca TODAS las frases que ya se pueden decir (VOZ-01: antes salía una por trozo y «Sí.» no salía nunca).
   * Cada vuelta avanza al menos un carácter, así que el bucle tiene tope. Una frase corta se junta con la
   * siguiente si ya llegó entera; si no, sale sola. Un pedazo sin palabras (solo signos o una etiqueta) va
   * con lo que siga. Nada se pierde, se repite ni se desordena: los pedazos son tramos seguidos del texto.
   */
  private cortar() {
    for (let vueltas = 0; vueltas <= this.texto.length; vueltas++) {
      const c = siguienteCorte(this.texto, this.cortado, this.estadoCorte);
      if (!c || c.fin <= this.cortado) return;
      this.cortado = c.fin;
      this.estadoCorte = avanzarEstado(this.estadoCorte, c);
      const pieza = this.texto.slice(this.emitido, this.cortado);
      if (!tienePalabras(pieza)) continue;
      if (letras(pieza) < FRASE_CORTA_LETRAS && siguienteCorte(this.texto, this.cortado, this.estadoCorte)) continue;
      this.emitido = this.cortado;
      const sentence = cleanForSpeech(pieza);
      if (sentence) this.enqueue(sentence);
    }
  }

  /** Fin del stream: habla lo que quede y resuelve `done` cuando termina el audio. */
  end() {
    if (this.closed) return;
    this.closed = true;
    const resto = this.texto.slice(this.emitido);
    this.emitido = this.cortado = this.texto.length;
    const rest = tienePalabras(resto) ? cleanForSpeech(resto) : '';
    if (rest) this.enqueue(rest);
    if (!this.pumping && !this.queue.length) this.resolver('terminado');
  }

  /**
   * CANCELAR: inmediato y para siempre. Lo suyo que suena se calla, las descargas se abortan, lo preparado
   * se suelta y `done` se resuelve ya (sin esperar a la red). Dos veces: no pasa nada más.
   */
  cancel() {
    if (this.cancelado) return;
    this.cancelado = true;
    this.closed = true;
    this.queue = [];
    this.texto = '';
    this.emitido = this.cortado = 0;
    this.io.abortar();
    if (this.nextPrepared) {
      soltarPreparado(this.nextPrepared.p);
      this.nextPrepared = null;
    }
    const s = this.sonido;
    this.sonido = null;
    if (s) callarSonido(s);
    this.soltarEsperas();
    this.resolver('cancelado');
  }

  /** ¿Lo cancelaron (o lo calló otra locución)? */
  get fueCancelado() {
    return this.cancelado;
  }

  /**
   * REEMPLAZAR: el servidor corrigió lo dicho (`replace`, con el texto ENTERO hasta ahí; auditoría del 3-oct
   * VOICE02). Lo que todavía no sonó del texto viejo se tira —la cola, el trozo a medias y el audio ya
   * preparado— y no vuelve; la frase que está sonando termina (no se corta a media palabra). De lo corregido
   * se dice solo lo que falta (lib/reemplazoVoz.ts): si lo oído coincide, sigue donde iba; si no, desde la
   * frase que difiere, con `aviso` delante («Corrijo:») para que se entienda que corrige.
   */
  reemplazar(texto: string, aviso = '') {
    if (this.closed) return;
    this.version++;
    this.queue = [];
    this.texto = '';
    this.emitido = this.cortado = 0;
    this.estadoCorte = estadoInicial();
    if (this.nextPrepared) {
      soltarPreparado(this.nextPrepared.p);
      this.nextPrepared = null;
    }
    // La entonación sigue a lo último que de verdad sonó, no a lo que se tiró.
    this.ultima = this.oido[this.oido.length - 1] || '';
    const { decir, corrige } = faltaDecir(this.oido.join(' '), cleanForSpeech(texto));
    if (decir) this.push(corrige && aviso ? `${aviso} ${decir}` : decir);
  }

  get hasSpoken() {
    return this.spoke;
  }

  /** La última frase que se mandó a decir: es el `previo` de la siguiente (entonación y tono solo al empezar). */
  private ultima = '';

  private source(sentence: string, previo?: string) {
    // La clave lleva lo dicho antes: la misma frase después de otra se pide aparte (sin el tono del
    // comienzo y con su entonación seguida) — revisión de Codex en #111.
    const clave = `${previo || ''}\u0000${sentence}`;
    let p = this.sources.get(clave);
    if (!p) {
      const primera = !this.sources.size;
      p = fuenteDe(sentence, 'speak', this.opts.emocion || 'neutral', false, { previo }, undefined, this.io);
      // Bajado no es sonando: la traza lo llama «tts» (lib/trazaTurno.ts); lo que suena lo dice onSuena. Por el nativo,
      // «bajado» es haber juntado el prebúfer (el aviso «listo»).
      if (primera && this.opts.onAudioBajado) {
        void p.then((src) => {
          if (!src) return;
          if (esVivo(src)) src.vivo.alListo = () => this.vigente() && this.opts.onAudioBajado?.();
          else if (this.vigente()) this.opts.onAudioBajado?.();
        });
      }
      this.sources.set(clave, p);
    }
    return p;
  }

  /**
   * Prepara una frase. Después de CADA espera mira si sigue valiendo (no cancelado, misma generación, misma
   * versión del texto): si no, lo que llegó se suelta y no suena.
   */
  private preparar(f: FraseCola): Promise<Reproducible | null> {
    return (async () => {
      const src = await this.source(f.texto, f.previo);
      if (!src || !this.vigente() || f.v !== this.version) return null;
      const sound = await prepare(src);
      if (sound && (!this.vigente() || f.v !== this.version)) {
        void sound.unloadAsync().catch(() => {});
        return null;
      }
      return sound;
    })();
  }

  private enqueue(sentence: string) {
    // Hay algo que decir y todavía no suena: la cara piensa (no habla) hasta la primera sílaba.
    if (!this.spoke && this.vigente()) vozSonando.preparar(this.locucion, true);
    this.queue.push({ texto: sentence, previo: this.ultima, v: this.version });
    void this.source(sentence, this.ultima);
    this.ultima = sentence;
    if (!this.pumping) void this.pump();
  }

  private async pump() {
    this.pumping = true;
    try {
      if (!this.spoke) {
        // Mientras termina lo que suena (el relleno), la primera frase ya se prepara: al soltarse, suena sin esperar.
        const primera = this.queue[0];
        if (primera && !this.nextPrepared) this.nextPrepared = { frase: primera, p: this.preparar(primera) };
        await this.esperar(lastSpeak.catch(() => {}));
      }
      while (this.queue.length && this.vigente()) {
        const frase = this.queue.shift()!;
        const lista = this.nextPrepared;
        this.nextPrepared = null;
        // Lo preparado es de ESTA frase o no sirve (una cola reemplazada no revive con su audio viejo).
        let prep: Promise<Reproducible | null>;
        if (lista && lista.frase === frase) prep = lista.p;
        else {
          if (lista) soltarPreparado(lista.p);
          prep = this.preparar(frase);
        }
        const sound = await this.esperar(prep);
        if (!this.vigente()) {
          // Cancelado mientras se bajaba o preparaba: lo que llegue (ahora o después) se suelta, no suena.
          soltarPreparado(prep);
          break;
        }
        // Mientras se preparaba, el servidor corrigió el texto: esta frase ya no va.
        if (frase.v !== this.version) {
          if (sound) void sound.unloadAsync().catch(() => {});
          continue;
        }
        if (this.queue[0]) this.nextPrepared = { frase: this.queue[0], p: this.preparar(this.queue[0]) };
        if (!sound) continue;
        if (!this.spoke) {
          this.spoke = true;
          this.opts.onAudioStart?.();
        }
        this.oido.push(frase.texto);
        this.opts.onSentence?.(frase.texto);
        // Los avisos de arriba pueden haber cancelado (cancelar es síncrono): entonces esto ya no suena.
        if (!this.vigente()) {
          void sound.unloadAsync().catch(() => {});
          break;
        }
        const primera = this.oido.length === 1;
        this.sonido = sound;
        // Por el nativo: la siguiente suena pegada a esta (sin hueco), si para entonces sigue valiendo.
        const sig = this.nextPrepared;
        encadenarDetras(sound, sig?.p, () => !!sig && this.nextPrepared === sig && this.vigente() && sig.frase.v === this.version);
        await playPrepared(sound, this.my, 25_000, {
          text: frase.texto,
          kind: this.opts.emocion === 'oracion' ? 'pray' : 'speak',
          alSonar: primera ? () => this.vigente() && this.opts.onSuena?.() : undefined,
          locucion: this.locucion,
        });
        if (this.sonido === sound) this.sonido = null;
      }
    } finally {
      this.pumping = false;
      if (this.nextPrepared) soltarPreparado(this.nextPrepared.p);
      this.nextPrepared = null;
      if (!this.vigente()) this.cancel();
      else if (this.closed && !this.queue.length) this.resolver('terminado');
    }
  }
}
