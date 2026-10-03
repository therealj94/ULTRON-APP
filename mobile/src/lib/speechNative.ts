/**
 * Oído nativo: Android SpeechRecognizer / iOS SFSpeechRecognizer vía expo-speech-recognition.
 * - Continuo, sin beep (continuous:true usa fuente de audio propia), resultados parciales
 *   para que la cara reaccione mientras hablas y finales en ~300 ms tras callar.
 * - No sube audio a ningún servidor: el reconocimiento lo hace el sistema (Google) en el teléfono.
 * - Se reinicia solo ante `end`, `no-speech`, `network`, etc. Si el servicio no existe
 *   (`service-not-allowed` / `language-not-supported`) avisa con onUnavailable para caer a la nube.
 * - Se pausa mientras AU-RA habla (evita que se escuche a sí mismo).
 * - `abort()` del módulo contesta SIEMPRE con un `end` que llega DESPUÉS (aunque no hubiera nada
 *   escuchando; lo documenta también electrum/dictado.ts). Antes ese `end` viejo caía encima del
 *   arranque siguiente: borraba `starting`, programaba OTRO `start()` y el módulo destruía el
 *   reconocedor que se estaba creando (Android contesta con `busy`/`client` y vuelta a empezar). El
 *   motor quedaba «encendido» y sin oír, y el vigilante lo daba por bueno porque llegaban eventos.
 *   Ahora cada `abort()` cuenta un `end` pendiente que se descarta si ya hay otro arranque en curso.
 * - VIDA: solo cuentan los eventos de un reconocedor que de verdad escucha (`start`, volumen, voz,
 *   resultados). Un bucle de `error` + `end` no es vida: el vigilante lo ve y lo reinicia.
 */
import { Platform } from 'react-native';
import { localeActual } from '../i18n';
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
/** Último evento de un reconocedor que escucha de verdad (start, volumen, voz, resultado). */
let ultimaVidaAt = 0;
/** Desde cuándo corre el plazo de gracia de un arranque pedido (abrir, soltar la pausa, reiniciar). */
let plazoDesde = Date.now();
/** `end` que todavía van a llegar por los `abort()` pedidos (uno por cada uno). */
let finesPendientes = 0;
/**
 * La sesión del reconocedor se abortó (silenciar, la pausa mientras AU-RA habla, reiniciar, reabrir,
 * destruir): sus eventos pueden llegar tarde, incluso después de soltar la pausa o de reabrir. Hasta que
 * ARRANCA una sesión nueva (`start`) o llega el `end` del último abort(), ningún resultado es de esta
 * conversación (Codex en #138: mirar solo `wanted` dejaba pasar el final viejo si se reabría rápido; y la
 * auditoría del 3-oct, VOICE03: mirar solo `paused` lo dejaba pasar al soltar la pausa de la voz antes del
 * arranque nuevo). Todo abort() corta la sesión (`cortarSesion`), no solo el de silenciar.
 */
let sesionCortada = false;
/**
 * Cada corte tiene su número: la red de seguridad (un teléfono que no avisa ni `start` ni `end`) suelta
 * solo el corte que la armó; uno que llegue tarde no puede soltar un corte más nuevo.
 */
let corte = 0;
let redCorte: ReturnType<typeof setTimeout> | null = null;
/** Lo que espera la red de seguridad desde que se vuelve a pedir oír tras un corte. */
export const RED_CORTE_MS = 3_000;
let lastPartial = '';
let lastFinalAt = 0;
let lastFinalText = '';
let consecutiveFails = 0;
/**
 * Hasta cuándo el motor está marcado no disponible (0: disponible). Antes era para siempre: cuatro
 * arranques fallidos (p. ej. justo cuando la conversación en vivo soltaba el audio) lo apagaban hasta
 * reiniciar la app. Ahora se vuelve a probar pasado REINTENTO_NATIVO_MS; solo «el idioma no está» es
 * para siempre (no se arregla solo).
 */
let noDisponibleHasta = 0;
export const REINTENTO_NATIVO_MS = 10 * 60_000;
const noDisponible = () => Date.now() < noDisponibleHasta;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function setNativeCallbacks(next: NativeCallbacks) {
  cb = next;
}

export function nativeAvailable(): boolean {
  try {
    return !noDisponible() && ExpoSpeechRecognitionModule.isRecognitionAvailable();
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

/** Algo que prueba que el reconocedor está oyendo. */
function vida() {
  const t = Date.now();
  lastEventAt = t;
  ultimaVidaAt = t;
}

function emitListening(on: boolean) {
  if (running === on) return;
  running = on;
  cb.onListeningChange?.(on);
}

/** Un abort(): lo que esa sesión mande desde ahora no es un turno. */
function cortarSesion() {
  sesionCortada = true;
  corte += 1;
  if (redCorte) {
    clearTimeout(redCorte);
    redCorte = null;
  }
}

/** La sesión nueva arrancó (o terminó la abortada): sus resultados vuelven a contar. */
function soltarCorte() {
  sesionCortada = false;
  if (redCorte) {
    clearTimeout(redCorte);
    redCorte = null;
  }
}

/**
 * Se vuelve a pedir oír tras un corte: si el teléfono no avisa ni `start` ni `end`, el corte se suelta
 * solo pasado RED_CORTE_MS (si no, el oído quedaría sordo para siempre). Versionado: si mientras tanto
 * hubo otro corte, este reloj ya no es de nadie.
 */
function armarRedCorte() {
  if (!sesionCortada || redCorte) return;
  const mio = corte;
  redCorte = setTimeout(() => {
    redCorte = null;
    if (mio === corte) sesionCortada = false;
  }, RED_CORTE_MS);
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
      soltarCorte();
      vida();
      starting = false;
      consecutiveFails = 0;
      emitListening(true);
    })
  );
  subs.push(
    M.addListener('speechstart', () => {
      vida();
      if (!paused) cb.onSpeechStart?.();
    })
  );
  subs.push(
    M.addListener('volumechange', (e: any) => {
      vida();
      // rango -2..10 → 0..1
      const v = typeof e?.value === 'number' ? Math.max(0, Math.min(1, (e.value + 1) / 9)) : 0;
      if (!paused) cb.onLevel?.(v);
    })
  );
  subs.push(
    M.addListener('result', (e: any) => {
      vida();
      // Silenciado, pausado, o de una sesión abortada (antes del `start` de la nueva): no es un turno
      // (Codex, 3-oct y #138; VOICE03).
      if (paused || !wanted || sesionCortada) return;
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
      const code = String(e?.error || 'unknown') as ExpoSpeechRecognitionErrorCode | string;
      // El «aborted» es el eco de un abort() pedido: no toca el arranque que pueda venir detrás.
      if (code === 'aborted') return;
      starting = false;
      if (code === 'service-not-allowed' || code === 'language-not-supported' || code === 'not-allowed') {
        if (code !== 'not-allowed') noDisponibleHasta = code === 'language-not-supported' ? Infinity : Date.now() + REINTENTO_NATIVO_MS;
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
      if (finesPendientes > 0) {
        finesPendientes -= 1;
        // Terminó la última sesión abortada: ya no puede mandar resultados. Con otro abort() en camino,
        // todavía no (su sesión puede seguir mandando).
        if (finesPendientes === 0) soltarCorte();
        // El `end` de un abort() viejo: si ya se pidió otro arranque (o ya arrancó), no es de él.
        if (starting || running) return;
      }
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
  if (!wanted || paused || starting || running || noDisponible()) return;
  starting = true;
  armarRedCorte();
  attach();
  try {
    ExpoSpeechRecognitionModule.start({
      // El idioma que la persona eligió al entrar.
      lang: localeActual(),
      interimResults: true,
      maxAlternatives: 1,
      continuous: true,
      requiresOnDeviceRecognition: false,
      addsPunctuation: false,
      contextualStrings: ['Aura', 'AU-RA', 'Orden Global', 'Genesis Core', 'Veta Wallet', 'Genesis ID', 'Medardo', 'José', 'lempira', 'oro', 'plata'],
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
      noDisponibleHasta = Date.now() + REINTENTO_NATIVO_MS;
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
    if (abort) {
      cortarSesion();
      ExpoSpeechRecognitionModule.abort();
      finesPendientes += 1;
    } else ExpoSpeechRecognitionModule.stop();
  } catch {
    /* */
  }
  starting = false;
  emitListening(false);
}

/** Desde ahora cuenta el plazo para dar señales de vida (al abrir, al soltar la pausa, al reiniciar). */
function darPlazo() {
  plazoDesde = Date.now();
}

export async function nativeEnable() {
  wanted = true;
  noDisponibleHasta = 0;
  consecutiveFails = 0;
  darPlazo();
  await start();
}

export async function nativeMute() {
  wanted = false;
  await stop(true);
}

export async function nativeUnmute() {
  if (!wanted) darPlazo();
  wanted = true;
  // La red de seguridad (un teléfono que no avisa ni `start` ni `end`) la arma `start()`.
  await start();
}

export function nativePause(pause: boolean) {
  if (paused === pause) return;
  paused = pause;
  if (pause) {
    void stop(true);
  } else {
    lastPartial = '';
    darPlazo();
    scheduleRestart(150);
  }
}

export function nativeIsWanted() {
  return wanted;
}
export function nativeIsPaused() {
  return paused;
}

/** Sin señales de vida más de esto (queriendo oír y sin pausa), el reconocedor está muerto o mudo. */
export const SIN_VIDA_MS = 8000;

/**
 * ¿Está vivo? Queriendo oír y sin pausa, tiene que haber dado señales de vida (start, volumen, voz,
 * resultados) en los últimos SIN_VIDA_MS. Un bucle de `error` + `end` NO cuenta (antes sí: cualquier
 * evento lo daba por bueno y un reconocedor que fallaba al arrancar una y otra vez nunca se reiniciaba).
 */
export function nativeWatchdogOk() {
  if (!wanted || paused) return true;
  const t = Date.now();
  return t - ultimaVidaAt < SIN_VIDA_MS || t - plazoDesde < SIN_VIDA_MS;
}

/**
 * ¿Dio señales de vida DE VERDAD hace poco? (sin contar el plazo de gracia de un arranque). El
 * vigilante solo da por revivido un reconocedor así; si no, cada reinicio le regalaba otro plazo y
 * nunca llegaba al tope.
 */
export function nativeVidaReciente() {
  if (!wanted || paused) return true;
  return Date.now() - ultimaVidaAt < SIN_VIDA_MS;
}

/**
 * ¿Está oyendo AHORA? Para la etiqueta: «te escucho» solo si el reconocedor escucha (entre frase y
 * frase se reinicia en ~300 ms) o acaba de pedirse y está en su plazo corto de arranque.
 */
export function nativeEscuchando(plazoMs = 2500) {
  if (!wanted || paused || noDisponible()) return false;
  const t = Date.now();
  return running || t - ultimaVidaAt < plazoMs || t - plazoDesde < plazoMs;
}

export async function nativeRestart() {
  darPlazo();
  await stop(true);
  await sleep(250);
  consecutiveFails = 0;
  darPlazo();
  if (wanted && !paused) await start();
}

/**
 * Reabrir de verdad (el oído vuelve de otro dueño o el doble toque lo pide): un reconocedor NUEVO,
 * no el que quedó de antes. Quiere oír aunque estuviera silenciado.
 */
export async function nativeReabrir() {
  wanted = true;
  noDisponibleHasta = 0;
  await nativeRestart();
}

export async function nativeDestroy() {
  wanted = false;
  await stop(true);
  detach();
  // Los `end` que falten llegan sin oyentes: no hay que descartar nada al volver a enganchar.
  finesPendientes = 0;
  cb = {};
}
