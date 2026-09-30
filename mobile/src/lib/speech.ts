/**
 * Oído de AU-RA: fachada sobre dos motores, elegible en Ajustes.
 *  - 'native' (default): reconocimiento del sistema (Google) en el teléfono. Parciales en vivo,
 *    final ~0.3 s tras callar, sin subir audio. Cae solo a la nube si el servicio no existe.
 *  - 'cloud': grabación con VAD por energía + Whisper en el servidor propio de AU-RA (más lento,
 *    ~1.5 s, pero funciona en teléfonos sin servicios de Google).
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
  if (suspendido) {
    queridoAlVolver.abierto = true;
    return;
  }
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

/*
 * Llamada en curso (voz o video): el oído se suelta del todo y NADIE lo vuelve a armar hasta colgar.
 * El motor de la nube fija el modo de audio de expo-av al grabar y eso rompe el de la llamada; el
 * nativo le quita el micrófono. Mientras dure, las órdenes de abrir/pausar/reiniciar se anotan y al
 * colgar queda exactamente como se pidió por última vez.
 */
let suspendido = false;
/** Lo que se quería antes de (o durante) la llamada: se aplica al colgar. */
let queridoAlVolver = { abierto: false, pausado: false };

export function oidoSuspendido() {
  return suspendido;
}

export async function suspenderOido(on: boolean) {
  if (suspendido === on) return;
  if (on) {
    queridoAlVolver = { abierto: isMicWanted(), pausado: isMicPaused() };
    suspendido = true;
    if (engine === 'native') await native.nativeMute();
    else await cloud.muteMic();
    return;
  }
  suspendido = false;
  const q = queridoAlVolver;
  if (engine === 'native') native.nativePause(q.pausado);
  else cloud.pauseMicForTts(q.pausado);
  if (enabled && q.abierto) await unmuteMic();
}

export async function muteMic() {
  if (suspendido) {
    queridoAlVolver.abierto = false;
    return;
  }
  return engine === 'native' ? native.nativeMute() : cloud.muteMic();
}

export async function unmuteMic() {
  if (suspendido) {
    queridoAlVolver.abierto = true;
    return;
  }
  return engine === 'native' ? native.nativeUnmute() : cloud.unmuteMic();
}

/** Pausa la captura mientras AU-RA habla. */
export function pauseMicForTts(pause: boolean) {
  if (suspendido) {
    queridoAlVolver.pausado = pause;
    return;
  }
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
  if (suspendido) return true;
  return engine === 'native' ? native.nativeWatchdogOk() : cloud.micWatchdogOk();
}

export async function restartMic() {
  if (suspendido) return;
  return engine === 'native' ? native.nativeRestart() : cloud.restartMic();
}

/**
 * Reabrir el oído DE VERDAD: un reconocedor nuevo que quiere oír, sin pausa (el oído vuelve de la
 * conversación en vivo o de una llamada, o el doble toque lo pide). No es «unmute»: el de antes pudo
 * quedar colgado mientras otro tenía el micrófono.
 */
export async function reabrirMic() {
  if (suspendido) {
    queridoAlVolver = { abierto: true, pausado: false };
    return;
  }
  if (engine === 'native') {
    native.nativePause(false);
    return native.nativeReabrir();
  }
  cloud.pauseMicForTts(false);
  await cloud.unmuteMic();
  return cloud.restartMic();
}

/**
 * ¿Hay un motor oyendo AHORA? La etiqueta «te escucho» sale de aquí, no de lo que se pidió: pedir
 * que escuche no es que escuche.
 */
/** ¿Dio señales de vida de verdad hace poco? (sin el plazo de gracia de un arranque; el vigilante). */
export function oidoVivoDeVerdad(): boolean {
  if (suspendido) return true;
  return engine === 'native' ? native.nativeVidaReciente() : cloud.micWatchdogOk();
}

export function oidoEscuchando(): boolean {
  if (suspendido) return false;
  return engine === 'native' ? native.nativeEscuchando() : cloud.escuchandoAhora();
}

/**
 * El reconocedor del teléfono no revive ni reiniciándolo: el oído sigue por la nube (Whisper en el
 * servidor). Devuelve false si ya estaba en la nube (no hay a dónde caer).
 */
export async function caerANube(motivo: string): Promise<boolean> {
  if (engine === 'cloud') return false;
  await switchEngine('cloud', motivo);
  return true;
}

export async function destroySpeech() {
  enabled = false;
  await native.nativeDestroy();
  await cloud.destroySpeech();
  callbacks = {};
}
