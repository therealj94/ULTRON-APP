/**
 * Oído de AU-RA: fachada sobre tres motores, elegible en Ajustes.
 *  - 'turbo' (por omisión desde el 2-oct): el micrófono crudo va EN VIVO a Scribe v2 Realtime Turbo
 *    (speechTurbo.ts / turboMotor.ts). Parciales mientras se habla, la frase ~0,05 s tras el cierre, las
 *    pistas de vocabulario de AU-RA y lo de dinero confirmado con Scribe v2. Necesita la APK que trae el
 *    micrófono crudo (modules/aura-mic); en una anterior, o si el micrófono no abre, cae al del teléfono.
 *  - 'native': reconocimiento del sistema (Google) en el teléfono. Parciales en vivo, sin subir audio.
 *  - 'cloud': grabación m4a con VAD por energía + Scribe en el servidor (el último recurso).
 * Si el motor elegido falla, se cae al siguiente (turbo → teléfono → nube) y a los 10 min se vuelve a
 * probar el elegido.
 */
import { ES_ELECTRUM } from '../variante';
import * as cloud from './speechCloud';
import * as native from './speechNative';
import * as turbo from './speechTurbo';
import { cuentaInterrupcion, esInterrupcionReal, quitarEco } from './interrupcion';
import type { OrquestaMuletillas } from './muletillas';
import { registroVoz } from './tts';
import { miga } from './reporte';

export type SttEngine = 'turbo' | 'native' | 'cloud';

/** ¿Se puede oír con Turbo en este teléfono? (AU-RA, con la APK que trae el micrófono crudo). */
export function turboPosible(): boolean {
  return !ES_ELECTRUM && turbo.turboDisponible();
}

export type SpeechCallbacks = {
  onSpeechStart?: () => void;
  onPartial?: (text: string) => void;
  onLevel?: (level01: number) => void;
  onFinal?: (text: string) => void;
  onListeningChange?: (on: boolean) => void;
  onError?: (msg: string) => void;
  onEngineChange?: (engine: SttEngine, reason: string) => void;
  /**
   * La persona le habló encima a AU-RA (José, 3-oct: «como ChatGPT con voz»): hay que callar la voz YA.
   * Lo que siga diciendo llega como siempre por onPartial y onFinal.
   */
  onBargeIn?: (parcial: string) => void;
  /**
   * Solo con Turbo (fin de turno semántico, lib/finDeTurno.ts): la idea parece cerrada pero el oído todavía espera su
   * silencio. Con el texto exacto, para empezar el turno especulativo (lib/turnoEspeculativo.ts); si la persona sigue
   * hablando llega `onEspeculativaCancelada`. La frase de verdad llega igual por onFinal.
   */
  onEspeculativa?: (text: string) => void;
  onEspeculativaCancelada?: () => void;
};

/**
 * Hablarle encima (Ajustes, NO por omisión desde el 3-oct: en el Samsung de José su eco la cortaba): con Turbo el micrófono sigue abierto mientras AU-RA habla,
 * con la cancelación de eco del teléfono, y si la persona la interrumpe se calla y la escucha.
 */
let oirEncima = false;
/** Lo que AU-RA decía cuando la interrumpieron: la frase de la persona puede empezar con ese eco. */
let ecoAlCortar: string[] | null = null;

export function setOirEncima(on: boolean) {
  oirEncima = on;
  turbo.turboOirEncima(on);
}

export function oyeEncima(): boolean {
  return oirEncima && engine === 'turbo';
}

/**
 * LAS MULETILLAS (lib/asentir.ts, lib/muletillas.ts): solo con el oído Turbo, que es el que ignora el tramo del «mjm».
 * La mesa (lib/muletillasMesa.ts) las arma; aquí se conectan al oído: cada trozo, el cancelador de eco en el micrófono
 * de escucha, y lo que entendió (parcial, especulada y final) sin lo que se coló.
 */
let muletillas: OrquestaMuletillas | null = null;

export function setMuletillas(m: OrquestaMuletillas | null) {
  muletillas = m;
  turbo.turboOyenteTrozo(m ? (i) => m.alTrozo(i) : null);
}

/** Con las muletillas encendidas, el micrófono de escucha de Turbo lleva el cancelador de eco del teléfono. */
export function setEcoAlEscuchar(on: boolean) {
  turbo.turboEcoAlEscuchar(on);
}

/** El oído ignora lo que entra durante `ms` (el «mjm» sonando por la bocina). Solo Turbo sabe hacerlo. */
export function ignorarTramoOido(ms: number) {
  if (engine === 'turbo') turbo.turboIgnorarTramo(ms);
}

let engine: SttEngine = turboPosible() ? 'turbo' : 'native';
/** El que eligió la persona (o el de omisión): a ese se vuelve tras caer por un fallo. */
let preferido: SttEngine = engine;
let callbacks: SpeechCallbacks = {};
let enabled = false;
/**
 * El oído cayó a otro motor por un FALLO del elegido (no porque la persona lo cambió en Ajustes) y desde
 * cuándo. Se vuelve a probar el elegido pasado VOLVER_A_NATIVO_MS (volverANativoSiToca) o la próxima vez
 * que el oído vuelve de otro dueño (reabrirMic).
 */
let caidoPorFallo = false;
let caidoDesde = 0;
export const VOLVER_A_NATIVO_MS = 10 * 60_000;

function anotarMotor(next: SttEngine, porFallo: boolean) {
  caidoPorFallo = porFallo && next !== preferido;
  caidoDesde = Date.now();
}

/** El siguiente motor cuando uno falla: turbo → teléfono → nube. */
function siguienteMotor(de: SttEngine): SttEngine | null {
  if (de === 'turbo') return native.nativeAvailable() ? 'native' : 'cloud';
  if (de === 'native') return 'cloud';
  return null;
}

function motorPosible(e: SttEngine): boolean {
  if (e === 'turbo') return turboPosible();
  if (e === 'native') return native.nativeAvailable();
  return true;
}

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
      void switchEngine('cloud', `nativo no disponible (${reason})`, true);
    },
  });
  cloud.setSpeechCallbacks(common);
  turbo.turboOirEncima(oirEncima);
  turbo.turboCallbacks({
    ...common,
    onPartial: (t) => {
      const sin = muletillas ? muletillas.limpiarParcial(t) : t;
      callbacks.onPartial?.(ecoAlCortar ? quitarEco(sin, ecoAlCortar) : sin);
    },
    // Mientras AU-RA habla: ¿es su eco, un «ajá», o la persona interrumpiendo? (lib/interrupcion.ts)
    onPartialEncima: (t) => {
      const dichos = registroVoz.dichos();
      if (!esInterrupcionReal(t, dichos) || !turbo.turboTomarTurno()) return;
      ecoAlCortar = dichos;
      // Para ver en los logs si fue la persona o su eco, sin copiar lo dicho (puede ser privado): solo conteos.
      const c = cuentaInterrupcion(t, dichos);
      miga(`oído: la cortó (${c.palabras} palabras oídas, ${c.nuevas} no eran su eco${c.freno ? ', con freno' : ''})`);
      callbacks.onBargeIn?.(t);
      callbacks.onPartial?.(quitarEco(t, dichos));
    },
    onFinal: (t) => {
      const eco = ecoAlCortar;
      ecoAlCortar = null;
      // Sin las muletillas de AU-RA que se colaron al micrófono (lib/asentir.ts `quitarDelFinal`).
      const sin = muletillas ? muletillas.limpiarFinal(t) : t;
      const texto = eco ? quitarEco(sin, eco) : sin;
      if (texto) callbacks.onFinal?.(texto);
    },
    // Lo mismo que onFinal (sin el eco de su voz si la cortó): así la frase final y la especulada se comparan bien.
    onEspeculativa: (t) => {
      const sin = muletillas ? muletillas.limpiarEspeculada(t) : t;
      const texto = ecoAlCortar ? quitarEco(sin, ecoAlCortar) : sin;
      if (texto) callbacks.onEspeculativa?.(texto);
    },
    onEspeculativaCancelada: () => callbacks.onEspeculativaCancelada?.(),
    onMedida: (m) => miga(`oído: frase de ${(m.vozMs / 1000).toFixed(1)} s lista ${m.trasCallarMs} ms tras callar (${m.via})`),
    onSpeechStart: () => {
      // Una frase nueva oída sin interrupción de por medio ya no lleva el eco de antes.
      if (!turbo.turboOyendoEncima()) ecoAlCortar = null;
      callbacks.onSpeechStart?.();
    },
    onUnavailable: (reason) => {
      if (engine !== 'turbo') return;
      void switchEngine(siguienteMotor('turbo')!, `Turbo no disponible (${reason})`, true);
    },
  });
}

export function setSpeechCallbacks(cb: SpeechCallbacks) {
  callbacks = cb;
  wire();
}

export function currentSttEngine(): SttEngine {
  return engine;
}

async function switchEngine(next: SttEngine, reason: string, porFallo = false) {
  if (next === engine) return;
  const wasWanted = isMicWanted();
  const wasPaused = isMicPaused();
  if (engine === 'native') await native.nativeDestroy();
  else if (engine === 'turbo') turbo.turboDestruir();
  else await cloud.destroySpeech();
  engine = next;
  anotarMotor(next, porFallo);
  wire();
  callbacks.onEngineChange?.(next, reason);
  if (enabled && wasWanted && !suspendido) {
    if (next === 'native') {
      await native.nativeEnable();
      native.nativePause(wasPaused);
    } else if (next === 'turbo') {
      turbo.turboPausar(wasPaused);
      turbo.turboActivar();
    } else {
      cloud.pauseMicForTts(wasPaused);
      await cloud.enableAlwaysOnMic();
    }
  }
}

/** Cambia el motor desde Ajustes. */
export async function setSttEngine(next: SttEngine) {
  preferido = next;
  if (!motorPosible(next)) {
    let otro = siguienteMotor(next);
    while (otro && !motorPosible(otro)) otro = siguienteMotor(otro);
    const destino = otro || 'cloud';
    const motivo = next === 'turbo' ? 'esta versión de la app todavía no trae el oído Turbo' : 'este teléfono no tiene reconocimiento del sistema';
    if (destino === engine) {
      caidoPorFallo = true;
      caidoDesde = Date.now();
      callbacks.onEngineChange?.(engine, motivo);
      return;
    }
    return switchEngine(destino, motivo, true);
  }
  caidoPorFallo = false;
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
  if (engine === 'turbo') {
    if (!turboPosible()) {
      engine = siguienteMotor('turbo')!;
      anotarMotor(engine, true);
      wire();
      callbacks.onEngineChange?.(engine, 'esta versión de la app todavía no trae el oído Turbo');
    } else {
      turbo.turboActivar();
      return;
    }
  }
  if (engine === 'native') {
    if (!native.nativeAvailable()) {
      engine = 'cloud';
      anotarMotor('cloud', true);
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
    else if (engine === 'turbo') turbo.turboSilenciar();
    else await cloud.muteMic();
    return;
  }
  suspendido = false;
  const q = queridoAlVolver;
  if (engine === 'native') native.nativePause(q.pausado);
  else if (engine === 'turbo') turbo.turboPausar(q.pausado);
  else cloud.pauseMicForTts(q.pausado);
  if (enabled && q.abierto) await unmuteMic();
}

export async function muteMic() {
  if (suspendido) {
    queridoAlVolver.abierto = false;
    return;
  }
  if (engine === 'turbo') return turbo.turboSilenciar();
  return engine === 'native' ? native.nativeMute() : cloud.muteMic();
}

export async function unmuteMic() {
  if (suspendido) {
    queridoAlVolver.abierto = true;
    return;
  }
  if (engine === 'turbo') return turbo.turboActivar();
  return engine === 'native' ? native.nativeUnmute() : cloud.unmuteMic();
}

/** Pausa la captura mientras AU-RA habla. */
export function pauseMicForTts(pause: boolean) {
  // Empieza a hablar AU-RA: una muletilla que todavía suene se calla (nunca encima de su voz).
  if (pause) muletillas?.callar();
  if (suspendido) {
    queridoAlVolver.pausado = pause;
    return;
  }
  if (engine === 'native') native.nativePause(pause);
  else if (engine === 'turbo') turbo.turboPausar(pause);
  else cloud.pauseMicForTts(pause);
}

export function isMicWanted() {
  if (engine === 'turbo') return turbo.turboQuiere();
  return engine === 'native' ? native.nativeIsWanted() : cloud.isMicWanted();
}

export function isMicPaused() {
  if (engine === 'turbo') return turbo.turboPausado();
  return engine === 'native' ? native.nativeIsPaused() : cloud.isMicPaused();
}

export function micWatchdogOk() {
  if (suspendido) return true;
  if (engine === 'turbo') return turbo.turboVivo();
  return engine === 'native' ? native.nativeWatchdogOk() : cloud.micWatchdogOk();
}

export async function restartMic() {
  if (suspendido) return;
  if (engine === 'turbo') return turbo.turboReiniciar();
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
  // El oído vuelve de otro dueño: si había caído por un fallo, se prueba otra vez el elegido.
  await probarNativo('el oído vuelve: se prueba otra vez el oído elegido');
  if (engine === 'turbo') {
    turbo.turboPausar(false);
    turbo.turboActivar();
    return turbo.turboReiniciar();
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
  if (engine === 'turbo') return turbo.turboEscuchando();
  return engine === 'native' ? native.nativeVidaReciente() : cloud.micWatchdogOk();
}

export function oidoEscuchando(): boolean {
  if (suspendido) return false;
  if (engine === 'turbo') return turbo.turboEscuchando();
  return engine === 'native' ? native.nativeEscuchando() : cloud.escuchandoAhora();
}

/**
 * El motor de ahora no revive ni reiniciándolo: el oído sigue por el siguiente (turbo → teléfono → nube).
 * Devuelve false si ya estaba en la nube (no hay a dónde caer). El nombre quedó de cuando solo había dos.
 */
export async function caerANube(motivo: string): Promise<boolean> {
  const otro = siguienteMotor(engine);
  if (!otro) return false;
  await switchEngine(otro, motivo, true);
  return true;
}

/** Vuelve al motor elegido si el oído cayó a otro por un fallo y el elegido se puede usar. */
async function probarNativo(motivo: string): Promise<boolean> {
  if (engine === preferido || !caidoPorFallo || suspendido || !motorPosible(preferido)) return false;
  await switchEngine(preferido, motivo);
  caidoPorFallo = false;
  return true;
}

/** Pasados VOLVER_A_NATIVO_MS en otro motor por un fallo, se vuelve a probar el elegido (el vigilante lo llama). */
export async function volverANativoSiToca(ahora = Date.now()): Promise<boolean> {
  if (engine === preferido || !caidoPorFallo || ahora - caidoDesde < VOLVER_A_NATIVO_MS) return false;
  return probarNativo('pasó un rato: se prueba otra vez el oído elegido');
}

export async function destroySpeech() {
  enabled = false;
  await native.nativeDestroy();
  await cloud.destroySpeech();
  turbo.turboDestruir();
  callbacks = {};
}
