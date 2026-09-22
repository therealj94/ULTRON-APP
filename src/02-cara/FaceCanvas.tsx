import React, { useEffect, useRef, useCallback } from 'react';
import { Mode, FaceState, AnimationEngineState, FaceTargets } from '../types';
import type { Emocion } from '../../lib/emocion';
import { playSfx } from '../03-voz/audio';
import type { Gesto } from './gestos';
import {
  type Vida,
  type Escena,
  getThemeColors,
  crearVida,
  clamp,
  smoothstep,
  backOut,
  approach,
  actualizarMotas,
  drawMotes,
  emitirChispa,
  actualizarChispas,
  drawChispas,
  drawHalo,
  drawVoiceRing,
  drawShockwaves,
  drawLivingEye,
  drawCyberMouth,
  mixHex,
} from './dibujo';
import {
  type CombatState,
  ensureRoundRect,
  drawLooiVisor,
  drawModeCrown,
  drawModeEnvironment,
  drawJediSaber,
  drawCombatBlasterTurrets,
  drawHolographicDrinkCup,
  drawCyberWavingHand,
  drawLaserBoltsAndImpacts,
  drawCameraViewfinderAndFlash,
} from './funPack';

export interface FaceCanvasProps {
  face: FaceState;
  mode: Mode;
  energy: number;
  soundFxEnabled: boolean;
  /** Emoción del cerebro (`[EMO:x]`). Al cambiar dispara una micro-expresión sobre la cara base. */
  emocion?: Emocion;
  /** Pack de juguete: blásters, sable, coronas de modo, escalada al picar. Por defecto apagado. */
  funMode?: boolean;
  hasVisor?: boolean;
  cameraGaze?: { x: number; y: number; active: boolean };
  isDrinking?: boolean;
  isWaving?: boolean;
  isCameraFlashing?: boolean;
  isCombatBlasterActive?: boolean;
  resetTrigger?: number;
  onDrinkComplete?: () => void;
  onWaveComplete?: () => void;
  onBlasterCombatEnd?: () => void;
  onTriggerBlasterCombat?: () => void;
  onSnapshotReady?: (dataUrl: string) => void;
  onFaceChange: (newFace: FaceState, durationMs?: number) => void;
  onModeChange: (newMode: Mode) => void;
  onToggleVisor?: () => void;
  onSwipeUp: () => void;
  onSwipeDown: () => void;
  onTriggerVoice: () => void;
  onSpeak: (text: string) => void;
  onWake: () => void;
  onSleep: () => void;
  onCloseOverlays: () => void;
  /** Reporta cada gesto táctil o de expresión que la cara ejecuta. */
  onGesto?: (g: Gesto) => void;
  lipLevel?: number;
  showHud?: boolean;
}

const MODES: Mode[] = ['GUARDIAN', 'MINING', 'GOLD', 'CREATIVE', 'ANALYTICAL', 'STRATEGIC', 'EXPLORER'];
const N_MOTAS = 40;
const WAKE_S = 1.5;

/** Duración (s) de la capa de expresión por emoción. */
const EXPRESION_DUR: Record<Emocion, number> = {
  neutral: 0,
  feliz: 2.8,
  risa: 3.4,
  sorpresa: 1.5,
  curioso: 2.8,
  pensando: 3.0,
  preocupado: 2.8,
  triste: 3.2,
  molesto: 2.4,
  cansado: 3.4,
  carino: 3.0,
  orgullo: 2.8,
  travieso: 2.2,
  canto: 4.0,
  oracion: 5.0, // y se sostiene mientras la cara base sea PRAY
};

const GESTO_POR_EMOCION: Record<Emocion, Gesto | null> = {
  neutral: null,
  feliz: 'feliz',
  risa: 'risa',
  sorpresa: 'sorpresa',
  curioso: 'curioso',
  pensando: 'pensar',
  preocupado: 'preocupado',
  triste: 'tristeza',
  molesto: 'molesto',
  cansado: 'cansado',
  carino: 'carino',
  orgullo: 'orgullo',
  travieso: 'travieso',
  canto: 'canto',
  oracion: 'orar',
};

/** Energía ambiental (motas, halo) por cara. */
const ENERGIA: Partial<Record<FaceState, number>> = {
  HAPPY: 0.95,
  LAUGH: 1,
  SING: 1,
  PURR: 0.85,
  WINK: 0.8,
  SPEAKING: 0.7,
  CURIOSITY: 0.7,
  SURPRISED: 0.75,
  STARTLE: 0.75,
  JEDI: 0.7,
  ANGRY: 0.8,
  FURY: 0.9,
  IDLE: 0.45,
  LISTENING: 0.5,
  THINKING: 0.45,
  CONCERNED: 0.4,
  SAD: 0.22,
  TIRED: 0.12,
  PRAY: 0.3,
  SLEEPING: 0.05,
};

interface Expresion {
  tipo: Emocion | null;
  t: number;
  dur: number;
  nextPulse: number;
}

/** Metas de la capa viva por cara (se recalculan cada frame; la expresión suma encima). */
interface MetasVida {
  lid: number;
  wide: number;
  browLift: number;
  browAsym: number;
  tilt: number;
  lift: number;
  gazeX: number;
  gazeY: number;
  breathRate: number;
  blinkSpeed: number;
  browWorry: number; // interiores de ceja arriba y juntos
  mouthRound: number; // boca en «o»
  mouthPress: number; // labio apretado
  mouthWidth: number; // ancho relativo de la boca
  mouthSkew: number; // boca ladeada (pensar / travieso)
}

function metasDeCara(f: FaceState, t: number, age: number): MetasVida {
  const M: MetasVida = {
    lid: 1,
    wide: 1,
    browLift: 0,
    browAsym: 0,
    tilt: 0,
    lift: 0,
    gazeX: 0,
    gazeY: 0,
    breathRate: 1,
    blinkSpeed: 1,
    browWorry: 0,
    mouthRound: 0,
    mouthPress: 0,
    mouthWidth: 1,
    mouthSkew: 0,
  };
  switch (f) {
    case 'THINKING':
      M.gazeX = -0.42;
      M.gazeY = -0.38;
      M.browAsym = 0.35;
      M.browLift = 0.12;
      M.tilt = -0.035;
      M.mouthRound = 0.3; // boca fruncida a un lado
      M.mouthWidth = 0.72;
      M.mouthSkew = 0.45;
      break;
    case 'CURIOSITY':
      M.tilt = 0.11;
      M.browAsym = 0.55;
      M.browLift = 0.3;
      M.mouthWidth = 0.9;
      break;
    case 'SURPRISED':
      M.wide = age < 1.4 ? 1.12 : 1.06;
      M.browLift = age < 1.2 ? 1.05 : 0.8;
      M.blinkSpeed = 1.3;
      M.mouthRound = 1;
      M.mouthWidth = 0.86;
      break;
    case 'STARTLE':
      M.wide = 1.08;
      M.browLift = 0.9;
      M.mouthRound = 0.8;
      break;
    case 'SAD':
      M.lid = 0.62;
      M.gazeY = 0.32;
      M.gazeX = 0.1;
      M.breathRate = 0.6;
      M.blinkSpeed = 0.75;
      M.tilt = 0.03;
      M.browWorry = 0.55;
      M.mouthWidth = 0.82;
      break;
    case 'TIRED':
      M.lid = 0.55;
      M.gazeY = 0.15 + 0.06 * Math.sin(t * 0.7);
      M.tilt = 0.025 * Math.sin(t * 0.5);
      M.breathRate = 0.7;
      M.blinkSpeed = 0.55;
      M.mouthWidth = 0.88;
      break;
    case 'SLEEPING':
      M.breathRate = 0.5;
      M.lift = -0.02;
      M.mouthWidth = 0.7;
      break;
    case 'PRAY':
      // Ojos cerrados los pone `cierre`; aquí quietud, respiración lenta, cejas serenas y boca chica.
      M.breathRate = 0.45;
      M.gazeX = 0;
      M.gazeY = 0;
      M.tilt = 0;
      M.browWorry = 0.3;
      M.browLift = 0.08;
      M.mouthWidth = 0.62;
      break;
    case 'LAUGH':
      M.browLift = 0.25;
      break;
    case 'SING':
      M.tilt = Math.sin(t * 1.7) * 0.05;
      M.mouthRound = 0.25;
      break;
    case 'PURR':
      M.tilt = 0.06 * Math.sin(t * 1.3);
      break;
    case 'CONCERNED':
      // Interiores de ceja arriba y juntos, párpados algo entrecerrados, comisuras abajo.
      M.lid = 0.86;
      M.browWorry = 0.7; // interiores arriba y juntos…
      M.mouthWidth = 0.92;
      break;
    case 'ANGRY':
      M.lid = 0.8;
      M.mouthPress = 0.9;
      M.mouthWidth = 1.08;
      break;
    case 'FURY':
      M.lid = 0.78;
      M.mouthPress = 0.55;
      M.mouthWidth = 1.1;
      break;
    case 'LISTENING':
      M.browLift = 0.12;
      break;
    case 'IDLE':
      M.mouthWidth = 0.95;
      break;
    default:
      break;
  }
  return M;
}

export const FaceCanvas: React.FC<FaceCanvasProps> = ({
  face,
  mode,
  energy,
  soundFxEnabled,
  emocion,
  funMode = false,
  hasVisor = false,
  cameraGaze,
  isDrinking = false,
  isWaving = false,
  isCameraFlashing = false,
  isCombatBlasterActive = false,
  resetTrigger = 0,
  onDrinkComplete,
  onWaveComplete,
  onBlasterCombatEnd,
  onTriggerBlasterCombat,
  onSnapshotReady,
  onFaceChange,
  onModeChange,
  onToggleVisor,
  onSwipeUp,
  onSwipeDown,
  onTriggerVoice,
  onSpeak,
  onWake,
  onSleep,
  onCloseOverlays,
  onGesto,
  lipLevel = 0,
  showHud = false,
}) => {
  void onToggleVisor;
  void onTriggerVoice;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lipRef = useRef(0);
  lipRef.current = lipLevel;
  const cameraFlashLiveRef = useRef(false);
  cameraFlashLiveRef.current = isCameraFlashing;

  // Estado de escena que sobrevive al bucle de 60fps
  const stateRef = useRef<{
    face: FaceState;
    prevFace: FaceState;
    mode: Mode;
    energy: number;
    hasVisor: boolean;
    funMode: boolean;
    showHud: boolean;
    t: number;
    faceSince: number;
    poke: number;
    lastPokeTime: number;
    lastInteraction: number;
    burstActive: boolean;
    burstSpoken: boolean;
    lipSeen: number;
    lipSeenAt: number;
    mix: number;
  }>({
    face,
    prevFace: face,
    mode,
    energy,
    hasVisor,
    funMode,
    showHud,
    t: 0,
    faceSince: 0,
    poke: 0,
    lastPokeTime: 0,
    lastInteraction: 0,
    burstActive: false,
    burstSpoken: false,
    lipSeen: 0,
    lipSeenAt: 0,
    mix: 1,
  });

  const animRef = useRef<AnimationEngineState>({
    blink: 1,
    blinkL: 1,
    blinkR: 1,
    blinking: false,
    phase: 0,
    next: 2.4,
    double: false,
    wink: 0,
    lx: 0,
    ly: 0,
    tx: 0,
    ty: 0,
    saccadeIn: 0,
    dilate: 0.36,
    dilateT: 0.36,
    brow: 0,
    browT: 0,
    breath: 1,
    bounce: 0,
    squashX: 1,
    squashY: 1,
    shake: 0,
    tilt: 0,
    mouth: 0.08,
    mouthT: 0.08,
    smile: 0.15,
    smileT: 0.15,
    pulse: 0,
    think: 0,
    sleepZ: 0,
    jiggle: 0,
    tickle: 0,
    visorDrop: hasVisor ? 1 : 0,
    shockwaves: [],
  });

  const vidaRef = useRef<Vida>(crearVida(N_MOTAS));
  const expRef = useRef<Expresion>({ tipo: null, t: 0, dur: 0, nextPulse: 0 });

  // Seguimiento táctil
  const touchState = useRef<{
    startX: number;
    startY: number;
    downTime: number;
    movedDistance: number;
    tapHandled: boolean;
    dragReported: boolean;
    strokePoints: Array<{ x: number; y: number; time: number }>;
  }>({
    startX: 0,
    startY: 0,
    downTime: 0,
    movedDistance: 0,
    tapHandled: false,
    dragReported: false,
    strokePoints: [],
  });

  const combatRef = useRef<CombatState>({
    isActive: false,
    level: 0,
    shotsRemaining: 0,
    lastShotTime: 0,
    startTime: 0,
    lasers: [],
    impacts: [],
    weapon: 'none',
  });
  const drinkRef = useRef({ isActive: false, progress: 0 });
  const waveRef = useRef({ isActive: false, progress: 0 });
  const flashRef = useRef({ alpha: 0 });
  const timersRef = useRef<number[]>([]);

  // Refs estables para el bucle (evitan re-crear el rAF)
  const cameraGazeRef = useRef(cameraGaze);
  const soundFxEnabledRef = useRef(soundFxEnabled);
  const onBlasterCombatEndRef = useRef(onBlasterCombatEnd);
  const onSpeakRef = useRef(onSpeak);
  const onFaceChangeRef = useRef(onFaceChange);
  const onGestoRef = useRef(onGesto);
  useEffect(() => {
    soundFxEnabledRef.current = soundFxEnabled;
    onBlasterCombatEndRef.current = onBlasterCombatEnd;
    onSpeakRef.current = onSpeak;
    onFaceChangeRef.current = onFaceChange;
    onGestoRef.current = onGesto;
  }, [soundFxEnabled, onBlasterCombatEnd, onSpeak, onFaceChange, onGesto]);

  const gesto = useCallback((g: Gesto) => {
    onGestoRef.current?.(g);
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  }, []);
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const id of timers) window.clearTimeout(id);
      timers.length = 0;
    };
  }, []);

  // ───────────────────────── fun pack: armas ─────────────────────────
  const disarmCombat = useCallback(() => {
    const C = combatRef.current;
    const wasActive = C.isActive;
    C.isActive = false;
    C.shotsRemaining = 0;
    C.lasers = [];
    C.impacts = [];
    C.level = 0;
    C.weapon = 'none';
    animRef.current.shake = 0;
    onBlasterCombatEndRef.current?.();
    if (wasActive) onFaceChangeRef.current('IDLE', 0);
  }, []);

  const triggerBlasterCombat = useCallback(() => {
    const C = combatRef.current;
    if (C.isActive) return;
    if (!stateRef.current.funMode) {
      // Sin funMode no hay armas: cerramos el ciclo para que App no quede colgada.
      onBlasterCombatEndRef.current?.();
      return;
    }
    C.isActive = true;
    C.weapon = 'blaster';
    C.startTime = performance.now();
    C.shotsRemaining = 8;
    C.lastShotTime = performance.now();
    onFaceChangeRef.current('FURY', 2600);
    playSfx('gun_draw', soundFxEnabledRef.current);
    onSpeakRef.current('Blasters fuera.');
    animRef.current.shake = 1.2;
    onTriggerBlasterCombat?.();
  }, [onTriggerBlasterCombat]);

  const triggerJediSaber = useCallback(() => {
    if (!stateRef.current.funMode) return;
    const C = combatRef.current;
    C.isActive = true;
    C.weapon = 'jedi';
    C.shotsRemaining = 0;
    C.lasers = [];
    C.level = 1;
    onFaceChangeRef.current('JEDI', 4000);
    playSfx('gun_draw', soundFxEnabledRef.current);
    onSpeakRef.current('Sable listo.');
    animRef.current.shake = 0.4;
  }, []);

  // Reset externo
  useEffect(() => {
    if (resetTrigger > 0) {
      disarmCombat();
      drinkRef.current.isActive = false;
      drinkRef.current.progress = 0;
      waveRef.current.isActive = false;
      waveRef.current.progress = 0;
      animRef.current.shake = 0;
      animRef.current.jiggle = 0;
      stateRef.current.poke = 0;
      stateRef.current.burstActive = false;
      stateRef.current.burstSpoken = false;
      expRef.current.tipo = null;
      onFaceChange('IDLE', 0);
    }
  }, [resetTrigger, disarmCombat, onFaceChange]);

  // Sincronía de blásters externos
  useEffect(() => {
    if (isCombatBlasterActive && !combatRef.current.isActive) {
      triggerBlasterCombat();
    } else if (!isCombatBlasterActive && combatRef.current.isActive) {
      disarmCombat();
    }
  }, [isCombatBlasterActive, triggerBlasterCombat, disarmCombat]);

  // Apagar funMode en caliente desarma
  useEffect(() => {
    stateRef.current.funMode = funMode;
    if (!funMode && combatRef.current.isActive) disarmCombat();
  }, [funMode, disarmCombat]);

  // Flash de cámara + captura
  useEffect(() => {
    if (isCameraFlashing) {
      flashRef.current.alpha = 1.0;
      playSfx('shutter', soundFxEnabled);
      const timer = setTimeout(() => {
        if (canvasRef.current && onSnapshotReady) {
          try {
            onSnapshotReady(canvasRef.current.toDataURL('image/png'));
          } catch (err) {
            console.error('Canvas snapshot error:', err);
          }
        }
      }, 70);
      return () => clearTimeout(timer);
    }
  }, [isCameraFlashing, onSnapshotReady, soundFxEnabled]);

  // Vaso
  useEffect(() => {
    if (isDrinking) {
      drinkRef.current.isActive = true;
      drinkRef.current.progress = 0;
      onFaceChange('HAPPY', 3200);
      playSfx('sip', soundFxEnabled);
      gesto('sip');
      const timer = setTimeout(() => {
        drinkRef.current.isActive = false;
        onDrinkComplete?.();
        onSpeak('¡Electrolitos corporativos al 100%! Muy refrescante.');
      }, 3400);
      return () => clearTimeout(timer);
    } else {
      drinkRef.current.isActive = false;
    }
  }, [isDrinking, onDrinkComplete, onFaceChange, onSpeak, soundFxEnabled, gesto]);

  // Mano que saluda
  useEffect(() => {
    if (isWaving) {
      waveRef.current.isActive = true;
      waveRef.current.progress = 0;
      onFaceChange('WINK', 2800);
      playSfx('wave', soundFxEnabled);
      const timer = setTimeout(() => {
        waveRef.current.isActive = false;
        onWaveComplete?.();
        onSpeak('¡Hola! Saludos cordiales de AU-RA.');
      }, 2800);
      return () => clearTimeout(timer);
    } else {
      waveRef.current.isActive = false;
    }
  }, [isWaving, onWaveComplete, onFaceChange, onSpeak, soundFxEnabled]);

  function getTargetsFor(f: FaceState): FaceTargets {
    switch (f) {
      case 'LISTENING':
        return { dilate: 0.46, brow: 0.04, mouth: 0.1, smile: 0.14, bounce: 0.04 };
      case 'THINKING':
        return { dilate: 0.25, brow: 0.42, mouth: 0.04, smile: 0, bounce: 0 };
      case 'SPEAKING':
        return { dilate: 0.4, brow: 0.06, mouth: 0.3, smile: 0.22, bounce: 0.05 };
      case 'HAPPY':
        return { dilate: 0.38, brow: -0.28, mouth: 0.24, smile: 1, bounce: 0.15 };
      case 'PURR':
        return { dilate: 0.42, brow: -0.35, mouth: 0.18, smile: 1.2, bounce: 0.22 };
      case 'WINK':
        return { dilate: 0.36, brow: -0.15, mouth: 0.2, smile: 0.8, bounce: 0.1 };
      case 'CONCERNED':
        return { dilate: 0.32, brow: 0.28, mouth: 0.08, smile: -0.6, bounce: 0 }; // …con un leve ceño (SAD no lo tiene)
      case 'ANGRY':
        return { dilate: 0.22, brow: 0.88, mouth: 0.06, smile: -0.7, bounce: 0 };
      case 'FURY':
        return { dilate: 0.18, brow: 1.05, mouth: 0.2, smile: -1.0, bounce: 0.08 };
      case 'SLEEPING':
        return { dilate: 0.2, brow: 0.05, mouth: 0, smile: 0, bounce: 0 };
      case 'STARTLE':
        return { dilate: 0.58, brow: 0.55, mouth: 0.45, smile: -0.25, bounce: 0.2 };
      case 'CURIOSITY':
        return { dilate: 0.5, brow: 0.05, mouth: 0.16, smile: 0.25, bounce: 0.06 };
      case 'JEDI':
        return { dilate: 0.4, brow: -0.1, mouth: 0.18, smile: 0.35, bounce: 0.08 };
      case 'LAUGH':
        return { dilate: 0.34, brow: -0.2, mouth: 0.2, smile: 1.1, bounce: 0.15 };
      case 'SURPRISED':
        return { dilate: 0.2, brow: 0.02, mouth: 0.62, smile: 0.05, bounce: 0.1 };
      case 'SAD':
        return { dilate: 0.3, brow: -0.5, mouth: 0.05, smile: -0.7, bounce: 0 };
      case 'TIRED':
        return { dilate: 0.28, brow: -0.15, mouth: 0.06, smile: -0.05, bounce: 0 };
      case 'SING':
        return { dilate: 0.4, brow: -0.2, mouth: 0.3, smile: 0.7, bounce: 0.1 };
      case 'PRAY':
        return { dilate: 0.3, brow: -0.1, mouth: 0.05, smile: 0.32, bounce: 0 };
      case 'IDLE':
      default:
        return { dilate: 0.36, brow: 0, mouth: 0.08, smile: 0.15, bounce: 0 };
    }
  }

  /** Reacciones de entrada a una cara (una sola vez por cambio). */
  const entrarCara = useCallback(
    (f: FaceState) => {
      const A = animRef.current;
      const V = vidaRef.current;
      const S = stateRef.current;
      const tg = getTargetsFor(f);
      A.dilateT = tg.dilate;
      A.browT = tg.brow;
      A.mouthT = tg.mouth;
      A.smileT = tg.smile;
      S.faceSince = S.t;

      switch (f) {
        case 'ANGRY':
        case 'FURY':
          A.shake = 1.4;
          break;
        case 'CONCERNED':
        case 'STARTLE':
          A.shake = 0.7;
          break;
        case 'HAPPY':
        case 'PURR':
          A.bounce = 0.25;
          break;
        case 'LAUGH':
          V.laughAmp = 1;
          V.laughPhase = 0;
          A.bounce = 0.2;
          gesto('risa');
          break;
        case 'SURPRISED':
          V.freeze = 0.35;
          A.dilate = Math.min(A.dilate, 0.24); // pupila se cierra de golpe: ojos enormes y claros
          V.wide = Math.max(V.wide, 1.08);
          V.browLift = Math.max(V.browLift, 1.0);
          V.mouthRound = 1;
          A.bounce = 0.12;
          A.blinking = false;
          A.wink = 0;
          gesto('sorpresa');
          break;
        case 'TIRED':
          V.yawning = true;
          V.yawn = 0;
          gesto('bostezo');
          break;
        case 'SAD':
          gesto('tristeza');
          break;
        case 'SING':
          gesto('canto');
          break;
        case 'THINKING':
          V.hmmIn = 1.6 + Math.random() * 1.2;
          gesto('thinkHold');
          break;
        case 'SLEEPING':
          gesto('sleepBreathe');
          break;
        case 'PRAY':
          V.flutterIn = 2.5 + Math.random() * 3;
          V.flutterPhase = -1;
          V.flutter = 0;
          A.wink = 0;
          gesto('orar');
          break;
        default:
          break;
      }
    },
    [gesto]
  );

  // Props → estado de escena
  useEffect(() => {
    const S = stateRef.current;
    const changed = S.face !== face;
    S.prevFace = S.face;
    S.face = face;
    S.mode = mode;
    S.energy = energy;
    S.hasVisor = hasVisor;
    S.showHud = showHud;
    if (changed || S.t < 0.01) entrarCara(face);
  }, [face, mode, energy, hasVisor, showHud, entrarCara]);

  // ───────────────────────── capa de expresión ─────────────────────────
  const iniciarExpresion = useCallback(
    (e: Emocion) => {
      const X = expRef.current;
      const A = animRef.current;
      const V = vidaRef.current;
      if (e === 'neutral') {
        X.tipo = null;
        return;
      }
      X.tipo = e;
      X.t = 0;
      X.dur = EXPRESION_DUR[e] ?? 2.8;
      X.nextPulse = 1.1;
      switch (e) {
        case 'risa':
          V.laughAmp = Math.max(V.laughAmp, 0.9);
          V.laughPhase = 0;
          A.bounce = Math.max(A.bounce, 0.15);
          break;
        case 'sorpresa':
          V.freeze = 0.25;
          A.dilate = Math.min(0.7, A.dilate + 0.14);
          A.bounce = Math.max(A.bounce, 0.1);
          A.blinking = false;
          A.wink = 0;
          break;
        case 'molesto':
          A.shake = Math.max(A.shake, 0.35);
          break;
        case 'feliz':
          A.bounce = Math.max(A.bounce, 0.18);
          break;
        case 'orgullo':
          A.bounce = Math.max(A.bounce, 0.22);
          break;
        case 'curioso':
          A.bounce = Math.max(A.bounce, 0.06);
          break;
        case 'travieso':
          A.blinking = true;
          A.phase = 0;
          A.double = false;
          A.wink = 1; // guiño con el ojo derecho
          break;
        default:
          break;
      }
      const g = GESTO_POR_EMOCION[e];
      if (g) gesto(g);
    },
    [gesto]
  );

  useEffect(() => {
    if (emocion) iniciarExpresion(emocion);
  }, [emocion, iniciarExpresion]);

  useEffect(() => {
    cameraGazeRef.current = cameraGaze;
    if (cameraGaze && cameraGaze.active) {
      animRef.current.tx = cameraGaze.x * 0.95;
      animRef.current.ty = cameraGaze.y * 0.65;
      stateRef.current.lastInteraction = performance.now();
    }
  }, [cameraGaze]);

  const scheduleBlink = useCallback((type: 'single' | 'double' | 'wink' = 'single') => {
    const A = animRef.current;
    if (A.blinking) return;
    A.blinking = true;
    A.phase = 0;
    A.double = type === 'double';
    A.wink = type === 'wink' ? (Math.random() < 0.5 ? -1 : 1) : 0;
  }, []);

  const addShockwave = (x: number, y: number, color: string) => {
    animRef.current.shockwaves.push({ id: Math.random(), x, y, radius: 4, maxRadius: 120, alpha: 1, color });
    if (animRef.current.shockwaves.length > 5) animRef.current.shockwaves.shift();
  };

  // ───────────────────────── bucle principal ─────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    ensureRoundRect(ctx);

    let animId = 0;
    let lastTime = performance.now();
    let running = false;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    window.addEventListener('resize', resize);
    resize();

    /** Sacudida de risa compartida por la cara LAUGH y la expresión 'risa'. */
    const reir = (V: Vida, dt: number) => {
      if (V.laughAmp <= 0.01) {
        V.laughAmp = 0;
        return;
      }
      V.laughPhase += dt * Math.PI * 2 * 5; // ~5 Hz
      V.laughAmp *= 1 - dt * 0.42;
      const s = Math.abs(Math.sin(V.laughPhase));
      V.mouthExtra += V.laughAmp * (0.22 + 0.5 * s);
      V.jolt += V.laughAmp * 0.1 * s;
      V.tiltT += V.laughAmp * 0.06 * Math.sin(V.laughPhase * 0.5);
      V.browLiftT += V.laughAmp * 0.3;
      V.smileExtra += V.laughAmp * 0.5;
    };

    /** Balanceo y chispas de canto (cara SING y expresión 'canto'). */
    const cantar = (V: Vida, t: number, lip: number, dt: number, baseR: number, w: number) => {
      V.swayX = Math.sin(t * 1.7) * 0.07 * w;
      V.tiltT += Math.sin(t * 1.7) * 0.05 * w;
      V.jolt += Math.abs(Math.sin(t * 3.4)) * 0.02 * lip * w;
      V.sparkAcc += dt * (1.5 + lip * 14) * w;
      while (V.sparkAcc > 1) {
        V.sparkAcc -= 1;
        emitirChispa(V.sparkles, (Math.random() - 0.5) * baseR * 1.6, baseR * 1.25, baseR);
      }
    };

    const render = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.06);
      lastTime = now;

      const S = stateRef.current;
      const A = animRef.current;
      const V = vidaRef.current;
      const X = expRef.current;
      S.t += dt;
      const age = S.t - S.faceSince;
      const lip = clamp(lipRef.current, 0, 1);
      if (lip > 0.02) {
        S.lipSeen = lip;
        S.lipSeenAt = S.t;
      }
      const W = canvas.width;
      const H = canvas.height;
      const baseR = Math.min(W * 0.115, H * 0.22);

      // Despertar: párpados de 0 → 1 con leve rebote en los primeros 1.5 s
      V.wakeT += dt;
      V.wake = V.wakeT < 0.12 ? 0 : V.wakeT > WAKE_S + 0.12 ? 1 : backOut((V.wakeT - 0.12) / WAKE_S);
      const awake = V.wakeT > WAKE_S + 0.1;

      // Visor
      const targetVisor = S.hasVisor ? 1 : 0;
      A.visorDrop += (targetVisor - A.visorDrop) * Math.min(1, dt * 4.2);

      // ── metas de la capa viva según cara ──
      const M = metasDeCara(S.face, S.t, age);
      V.lidT = M.lid;
      V.wideT = M.wide;
      V.browLiftT = M.browLift;
      V.browAsymT = M.browAsym;
      V.tiltT = M.tilt;
      V.liftT = M.lift;
      V.gazeXT = M.gazeX;
      V.gazeYT = M.gazeY;
      V.breathRate = M.breathRate;
      V.blinkSpeed = M.blinkSpeed;
      V.browWorryT = M.browWorry;
      V.mouthRoundT = M.mouthRound;
      V.mouthPressT = M.mouthPress;
      V.mouthWidthT = M.mouthWidth;
      V.mouthSkewT = M.mouthSkew;
      V.mouthExtra = 0;
      V.browExtra = 0;
      V.smileExtra = 0;
      V.dilateExtra = 0;
      V.swayX = 0;
      V.jolt = 0;

      // ── vida en reposo: tic de ceja de 1 px y deriva lenta de pupila ──
      const enReposo = S.face === 'IDLE' || S.face === 'LISTENING' || S.face === 'THINKING' || S.face === 'SPEAKING';
      if (enReposo && awake) {
        V.browTwitchIn -= dt;
        if (V.browTwitchIn <= 0) {
          V.browTwitch = 1;
          V.browTwitchSide = Math.random() < 0.5 ? -1 : 1;
          V.browTwitchIn = 2.5 + Math.random() * 4.5;
        }
      }
      V.browTwitch = V.browTwitch > 0.01 ? V.browTwitch * (1 - dt * 5.5) : 0;
      V.pupilDrift = 0.045 * Math.sin(S.t * 0.33) + 0.02 * Math.sin(S.t * 0.91 + 1.3);
      if (S.face !== 'SLEEPING' && S.face !== 'SURPRISED') V.dilateExtra += V.pupilDrift;

      // ── reacciones táctiles inmediatas (envolventes que decaen) ──
      if (V.touchOh > 0.01) {
        V.mouthRoundT += V.touchOh;
        V.mouthExtra += 0.42 * V.touchOh;
        V.browLiftT += 0.35 * V.touchOh;
        V.touchOh *= 1 - dt * 2.8;
      } else V.touchOh = 0;
      if (V.touchSmile > 0.01) {
        V.smileExtra += 0.7 * V.touchSmile;
        V.mouthExtra += 0.08 * V.touchSmile;
        V.mouthSkewT += V.touchSmileSide * 0.5 * V.touchSmile; // ladeada hacia el dedo toda la sonrisa, sin tirón
        V.touchSmile *= 1 - dt * 1.8;
      } else V.touchSmile = 0;
      if (V.annoy > 0.01) {
        V.browExtra += 0.75 * V.annoy;
        V.lidT *= 1 - 0.28 * V.annoy;
        V.mouthPressT += 0.8 * V.annoy;
        V.smileExtra -= 0.4 * V.annoy;
        V.annoy *= 1 - dt * 1.3;
      } else V.annoy = 0;
      V.squashL = V.squashL > 0.01 ? V.squashL * (1 - dt * 6.5) : 0;
      V.squashR = V.squashR > 0.01 ? V.squashR * (1 - dt * 6.5) : 0;
      // Arrastre: la boca se estira levemente hacia el lado del dedo.
      const arrastrando = touchState.current.downTime > 0 && touchState.current.movedDistance > 12 && V.lastTouch;
      V.mouthStretchT = arrastrando && V.lastTouch ? clamp(V.lastTouch.x * 2.2, -1, 1) * 0.7 : 0;

      // ── atención a la persona (cámara): brillo +8 %, giro sutil; al perderla vuelve despacio ──
      const camNow = cameraGazeRef.current;
      V.atencionT = camNow && camNow.active ? 1 : 0;
      V.atencion = approach(V.atencion, V.atencionT, V.atencionT > V.atencion ? 2.6 : 0.7, dt);
      if (camNow && camNow.active) V.camX = approach(V.camX, clamp(camNow.x, -1, 1), 2.5, dt);
      let energiaT = (ENERGIA[S.face] ?? 0.45) * (0.55 + 0.45 * clamp(S.energy / 100, 0, 1));
      let mouthGain = S.face === 'SING' ? 1.0 : 0.78;
      let ringOn = S.face === 'SPEAKING' || S.face === 'SING' || S.face === 'PRAY';
      V.cierreT = 0;
      V.serenidadT = 0;

      // Dinámicas propias de cada cara
      if (S.face === 'LAUGH') reir(V, dt);
      if (S.face === 'PRAY') {
        // Ora en voz alta: ojos cerrados, cabeza quieta, boca sigue la voz (más baja).
        V.cierreT = 1;
        V.serenidadT = 1;
        mouthGain = 0.7;
        A.tx = approach(A.tx, 0, 2, dt);
        A.ty = approach(A.ty, 0, 2, dt);
      }
      if (S.face === 'SING') cantar(V, S.t, lip, dt, baseR, 1);
      if (S.face === 'LISTENING') {
        V.dilateExtra += 0.03 * Math.sin(S.t * 2);
        if (now - S.lastInteraction > 1200) {
          A.tx = approach(A.tx, 0, 1.4, dt);
          A.ty = approach(A.ty, 0, 1.4, dt);
        }
      }
      if (V.yawning) {
        V.yawn += dt / 1.9;
        const k = Math.sin(Math.PI * clamp(V.yawn, 0, 1));
        V.mouthExtra += k * 0.85;
        V.lidT *= 1 - 0.45 * k;
        V.browLiftT += k * 0.2;
        V.tiltT += k * 0.03;
        if (V.yawn >= 1) {
          V.yawning = false;
          V.yawn = 0;
        }
      }
      // "Hmm" pensativo
      const pensando = S.face === 'THINKING' || X.tipo === 'pensando';
      if (pensando) {
        V.hmmIn -= dt;
        if (V.hmmIn <= 0) {
          V.hmm = 1;
          V.hmmIn = 2.6 + Math.random() * 2.2;
          gesto('hmm');
        }
      }
      if (V.hmm > 0.01) {
        V.hmm *= 1 - dt * 2.6;
        V.browLiftT += V.hmm * 0.25;
        V.mouthExtra += V.hmm * 0.1;
        V.jolt += V.hmm * 0.03;
        V.dilateExtra += V.hmm * 0.05;
      } else V.hmm = 0;

      // ── capa de expresión (emoción del cerebro) sobre la cara base ──
      if (X.tipo) {
        X.t += dt;
        // 'oracion' se sostiene mientras la cara base siga en PRAY; al salir, decae normal.
        if (X.tipo === 'oracion' && S.face === 'PRAY') X.t = Math.min(X.t, 0.3);
        if (X.t >= X.dur) X.tipo = null;
      }
      if (X.tipo) {
        const w = smoothstep(X.t / 0.3) * smoothstep((X.dur - X.t) / 0.7);
        switch (X.tipo) {
          case 'feliz':
            V.smileExtra += 0.55 * w;
            V.browExtra -= 0.15 * w;
            energiaT += 0.3 * w;
            break;
          case 'risa':
            X.nextPulse -= dt;
            if (X.nextPulse <= 0) {
              V.laughAmp = Math.max(V.laughAmp, 0.65);
              X.nextPulse = 1.1 + Math.random() * 0.4;
            }
            if (S.face !== 'LAUGH') reir(V, dt);
            energiaT += 0.4 * w;
            break;
          case 'sorpresa':
            V.browLiftT += 1.1 * w;
            V.wideT += 0.1 * w;
            V.dilateExtra -= 0.14 * w;
            V.mouthExtra += 0.32 * w;
            V.mouthRoundT += 0.9 * w;
            break;
          case 'curioso':
            V.tiltT += (S.face === 'CURIOSITY' ? 0.03 : 0.12) * w;
            V.browAsymT += 0.6 * w;
            V.browLiftT += 0.25 * w;
            V.dilateExtra += 0.08 * w;
            break;
          case 'pensando':
            V.gazeXT += -0.4 * w;
            V.gazeYT += -0.35 * w;
            V.browAsymT += 0.3 * w;
            break;
          case 'preocupado':
            V.browWorryT += 0.9 * w;
            V.smileExtra -= 0.5 * w;
            V.lidT *= 1 - 0.15 * w;
            V.mouthPressT += 0.25 * w;
            break;
          case 'triste':
            V.browExtra -= 0.45 * w;
            V.browWorryT += 0.5 * w;
            V.lidT *= 1 - 0.3 * w;
            V.gazeYT += 0.3 * w;
            V.smileExtra -= 0.5 * w;
            V.breathRate = 1 - 0.4 * w;
            energiaT *= 1 - 0.5 * w;
            break;
          case 'molesto':
            V.browExtra += 0.7 * w;
            V.dilateExtra -= 0.12 * w;
            V.smileExtra -= 0.55 * w;
            V.lidT *= 1 - 0.15 * w;
            V.mouthPressT += 0.8 * w;
            break;
          case 'cansado':
            V.lidT *= 1 - 0.4 * w;
            V.gazeYT += 0.12 * w;
            V.browExtra -= 0.1 * w;
            V.blinkSpeed = 1 - 0.45 * w;
            V.breathRate = 1 - 0.3 * w;
            energiaT *= 1 - 0.6 * w;
            break;
          case 'carino':
            V.smileExtra += 0.45 * w;
            V.lidT *= 1 - 0.2 * w;
            V.dilateExtra += 0.08 * w;
            V.tiltT += 0.05 * w;
            break;
          case 'orgullo':
            V.liftT += 0.08 * w;
            V.smileExtra += 0.55 * w;
            V.browExtra -= 0.2 * w;
            V.browLiftT += 0.15 * w;
            break;
          case 'travieso':
            V.smileExtra += 0.45 * w;
            V.mouthSkewT += 0.8 * w;
            V.browAsymT += 0.5 * w;
            break;
          case 'canto':
            cantar(V, S.t, lip, dt, baseR, w);
            V.smileExtra += 0.4 * w;
            mouthGain = 1.0;
            ringOn = ringOn || lip > 0.02;
            energiaT += 0.4 * w;
            break;
          case 'oracion':
            // Ojos cerrados suaves, cejas relajadas con interior arriba, sonrisa mínima,
            // respiración muy lenta, motas lentas, halo cálido y estable.
            V.cierreT = Math.max(V.cierreT, w);
            V.serenidadT = Math.max(V.serenidadT, w);
            V.browExtra -= 0.1 * w;
            V.browWorryT += 0.3 * w;
            V.smileExtra += 0.2 * w;
            V.mouthWidthT = Math.min(V.mouthWidthT, 1 - 0.35 * w);
            V.breathRate = Math.min(V.breathRate, 1 - 0.55 * w);
            energiaT = Math.min(energiaT, 0.3 + 0.7 * (1 - w) * energiaT);
            mouthGain = Math.min(mouthGain, 0.7);
            ringOn = ringOn || lip > 0.02;
            break;
          default:
            break;
        }
      }

      // ── suavizados de la capa viva ──
      V.lid = approach(V.lid, V.lidT, 4, dt);
      V.wide = approach(V.wide, V.wideT, S.face === 'SURPRISED' && age < 0.5 ? 18 : 5, dt);
      V.browLift = approach(V.browLift, V.browLiftT, X.tipo === 'sorpresa' || S.face === 'SURPRISED' ? 14 : 5, dt);
      V.browAsym = approach(V.browAsym, V.browAsymT, 4, dt);
      V.tilt = approach(V.tilt, V.tiltT, 3.2, dt);
      V.lift = approach(V.lift, V.liftT, 3, dt);
      V.gazeX = approach(V.gazeX, V.gazeXT, 2.8, dt);
      V.gazeY = approach(V.gazeY, V.gazeYT, 2.8, dt);
      V.mouthSkew = approach(V.mouthSkew, V.mouthSkewT, 5, dt);
      V.browWorry = approach(V.browWorry, V.browWorryT, 5, dt);
      V.mouthRound = approach(V.mouthRound, clamp(V.mouthRoundT, 0, 1), V.mouthRoundT > V.mouthRound ? 14 : 6, dt);
      V.mouthPress = approach(V.mouthPress, clamp(V.mouthPressT, 0, 1), 6, dt);
      V.mouthWidth = approach(V.mouthWidth, V.mouthWidthT, 5, dt);
      V.mouthStretch = approach(V.mouthStretch, V.mouthStretchT, 7, dt);
      V.energia = approach(V.energia, clamp(energiaT, 0, 1), 1.5, dt);
      if (V.freeze > 0) V.freeze -= dt;
      V.serenidad = approach(V.serenidad, clamp(V.serenidadT, 0, 1), 2.5, dt);

      // Cierre de ojos sereno: rampa lineal, ~0.8 s para cerrar y ~0.6 s para abrir.
      if (V.cierre < V.cierreT) V.cierre = Math.min(V.cierreT, V.cierre + dt / 0.8);
      else if (V.cierre > V.cierreT) V.cierre = Math.max(V.cierreT, V.cierre - dt / 0.6);
      // Micro-aleteo ocasional con los ojos cerrados (dos temblores en 0.36 s).
      if (V.cierre >= 0.98) {
        if (V.flutterPhase < 0) {
          V.flutterIn -= dt;
          if (V.flutterIn <= 0) {
            V.flutterPhase = 0;
            V.flutterIn = 3 + Math.random() * 4;
          }
        }
        if (V.flutterPhase >= 0) {
          V.flutterPhase += dt;
          V.flutter = V.flutterPhase < 0.36 ? 0.11 * Math.abs(Math.sin((V.flutterPhase * Math.PI) / 0.18)) : 0;
          if (V.flutterPhase >= 0.36) V.flutterPhase = -1;
        }
      } else {
        V.flutter = 0;
        V.flutterPhase = -1;
      }

      // ── parpadeo autónomo ──
      if (S.face !== 'SLEEPING' && S.face !== 'PRAY' && V.cierre < 0.05 && awake && V.freeze <= 0) {
        A.next -= dt;
        if (A.next <= 0 && !A.blinking) {
          const r = Math.random();
          if (r < 0.18) scheduleBlink('double');
          else if (r < 0.26) scheduleBlink('wink');
          else scheduleBlink('single');
          V.longBlink = V.blinkSpeed < 0.7 && Math.random() < 0.35;
          A.next = (3.2 + Math.random() * 4.2) / Math.max(0.45, V.blinkSpeed);
        }
      }
      if (A.blinking) {
        const hold = V.longBlink && !A.double && A.phase > 1.3 && A.phase < 1.85 ? 0.35 : 1;
        A.phase += dt * (A.double ? 6.6 : 5.2) * V.blinkSpeed * hold;
        let b = 1;
        if (A.phase < Math.PI) {
          b = Math.max(0.04, Math.cos(A.phase));
        } else if (A.double && A.phase < Math.PI * 2) {
          b = Math.max(0.04, Math.abs(Math.sin(A.phase)));
        } else {
          A.blinking = false;
          A.phase = 0;
          A.wink = 0;
          V.longBlink = false;
          b = 1;
        }
        A.blink = b;
        A.blinkL = A.wink > 0 ? 1 : b;
        A.blinkR = A.wink < 0 ? 1 : b;
      } else if (S.face === 'SLEEPING') {
        A.blink = A.blinkL = A.blinkR = 0.06;
      } else if (S.face === 'WINK') {
        A.blinkL = 1;
        A.blinkR = 0.08;
      } else if (S.face === 'PURR') {
        A.blink = A.blinkL = A.blinkR = 0.22;
      } else {
        A.blink = A.blinkL = A.blinkR = 1;
      }

      // ── mirada: micro-sacadas hacia el último toque, luego vuelta al centro ──
      const camActive = !!(cameraGazeRef.current && cameraGazeRef.current.active);
      const pointerDown = touchState.current.downTime > 0;
      if (V.freeze <= 0 && !camActive && !pointerDown && V.serenidad < 0.5) {
        A.saccadeIn -= dt;
        if (A.saccadeIn <= 0) {
          const lt = V.lastTouch;
          const ageT = lt ? (now - lt.t) / 1000 : 99;
          if (lt && ageT > 0.5 && ageT < 7) {
            const k = 1 - ageT / 7; // retorno lento al centro
            A.tx = lt.x * 1.4 * k + (Math.random() - 0.5) * 0.14;
            A.ty = lt.y * 0.9 * k + (Math.random() - 0.5) * 0.1;
            A.saccadeIn = 0.45 + Math.random() * 0.9;
          } else if (now - S.lastInteraction > 3500) {
            A.tx = (Math.random() - 0.5) * 0.45;
            A.ty = (Math.random() - 0.5) * 0.3;
            A.saccadeIn = 1.4 + Math.random() * 2.6;
          }
        }
      }
      if (pointerDown) {
        // Muelle sub-amortiguado: los ojos persiguen el dedo con un pelo de rebote.
        const kx = clamp(A.tx + V.gazeX, -1, 1);
        const ky = clamp(A.ty + V.gazeY, -1, 1);
        V.lookVX += ((kx - A.lx) * 55 - V.lookVX * 10) * dt;
        V.lookVY += ((ky - A.ly) * 55 - V.lookVY * 10) * dt;
        A.lx = clamp(A.lx + V.lookVX * dt, -1.1, 1.1);
        A.ly = clamp(A.ly + V.lookVY * dt, -1.1, 1.1);
      } else {
        V.lookVX = V.lookVY = 0;
        const gRate = camActive ? 4.5 : 3.4;
        A.lx = approach(A.lx, clamp(A.tx + V.gazeX, -1, 1), gRate, dt);
        A.ly = approach(A.ly, clamp(A.ty + V.gazeY, -1, 1), gRate, dt);
      }

      // ── parámetros faciales ──
      const dilRate = S.face === 'SURPRISED' && age < 0.5 ? 16 : 4.2;
      A.dilate = approach(A.dilate, A.dilateT, dilRate, dt);
      // Caras que hablan: la boca sigue lipLevel con ataque rápido; si la señal se queda en 0
      // más de 1.5 s, entra un visema sintético para que nunca hable "mudo".
      const hablando =
        S.face === 'SPEAKING' || S.face === 'SING' || S.face === 'PRAY' || X.tipo === 'canto' || X.tipo === 'oracion';
      const hablaConLabio = hablando && lip > 0.02;
      const sinSenal = hablando && S.t - S.lipSeenAt > 1.5;
      let mouthWant: number;
      let jawT = 0;
      /** Elige un visema nuevo: redondo («o/u»), ancho («e/i») o neutro («a»), con asimetría propia. */
      const nuevoVisema = () => {
        const r = Math.random();
        if (r < 0.38) {
          V.visRoundT = 0.65 + Math.random() * 0.35;
          V.visWideT = 0;
        } else if (r < 0.72) {
          V.visRoundT = 0;
          V.visWideT = 0.6 + Math.random() * 0.4;
        } else {
          V.visRoundT = 0;
          V.visWideT = 0;
        }
        V.visAsymT = (Math.random() - 0.5) * 0.6;
        V.visHold = 0.1 + Math.random() * 0.1;
      };
      if (hablaConLabio) {
        // Ataque (la señal sube de golpe) → nueva forma; una vocal sostenida cambia sola cada ~0.4 s.
        const rise = lip - V.visLast;
        V.visHold -= dt;
        if ((rise > 0.1 && V.visHold <= 0) || V.visHold < -0.32) nuevoVisema();
        V.visLast = approach(V.visLast, lip, 22, dt);
        mouthWant = 0.1 + lip * mouthGain * (1 + 0.2 * V.visRound);
        jawT = lip;
      } else if (sinSenal) {
        const vis = Math.abs(Math.sin(S.t * 11)) * (0.6 + 0.4 * Math.sin(S.t * 3.1));
        V.visHold -= dt;
        if (V.visHold <= 0) {
          nuevoVisema();
          V.visHold = 0.18 + Math.random() * 0.14;
        }
        mouthWant = 0.12 + 0.34 * mouthGain * vis;
        jawT = 0.6 * vis;
      } else {
        V.visRoundT = 0;
        V.visWideT = 0;
        V.visAsymT = 0;
        V.visLast = approach(V.visLast, 0, 6, dt);
        mouthWant = A.mouthT + (S.face === 'IDLE' ? 0.04 * Math.sin(S.t * 1.3) : 0);
      }
      const mouthRate = hablando ? (mouthWant > A.mouth ? 20 : 11) : 9;
      A.mouth = approach(A.mouth, mouthWant, mouthRate, dt);
      V.jaw = approach(V.jaw, clamp(jawT, 0, 1), jawT > V.jaw ? 18 : 8, dt);
      V.visRound = approach(V.visRound, V.visRoundT, V.visRoundT > V.visRound ? 24 : 12, dt);
      V.visWide = approach(V.visWide, V.visWideT, V.visWideT > V.visWide ? 24 : 12, dt);
      V.visAsym = approach(V.visAsym, V.visAsymT, 10, dt);
      A.smile = approach(A.smile, A.smileT, 4.2, dt);
      A.brow = approach(A.brow, A.browT, 3.2, dt);

      // Anillo de voz
      const ringT = ringOn ? lip : 0;
      V.ring = approach(V.ring, ringT, ringT > V.ring ? 18 : 5, dt);
      V.ring2 = approach(V.ring2, V.ring, 4, dt);

      // Oscilaciones secundarias
      V.breathPhase += dt * 2.2 * V.breathRate;
      A.breath = 1 + 0.02 * Math.sin(V.breathPhase);
      A.pulse = (A.pulse + dt * 0.8) % 1;
      A.think += dt * 3.5;
      A.sleepZ += dt;

      if (A.jiggle > 0.001) A.jiggle *= 0.945;
      if (A.tickle > 0.001) A.tickle *= 0.96;
      if (A.shake > 0.001) A.shake *= 0.94;
      if (A.bounce > 0.001) A.bounce *= 0.965;
      A.squashX = 1 + A.jiggle * 0.18 * Math.sin(S.t * 7);
      A.squashY = 1 - A.jiggle * 0.14 * Math.sin(S.t * 7);

      // Ambiente
      actualizarMotas(V.motes, dt, V.energia, S.t);
      actualizarChispas(V.sparkles, dt);
      for (let i = A.shockwaves.length - 1; i >= 0; i--) {
        const sw = A.shockwaves[i];
        const kk = sw.radius / sw.maxRadius;
        sw.radius += dt * (420 * (1 - kk * 0.7) + 40);
        sw.alpha = Math.max(0, 1 - kk);
        if (sw.alpha <= 0) A.shockwaves.splice(i, 1);
      }

      // ── fun pack: blásters / sable ──
      const C = combatRef.current;
      if (C.isActive && C.weapon === 'jedi') {
        C.level = Math.min(1, C.level + dt * 5);
      } else if (C.isActive) {
        if (C.shotsRemaining > 0) C.level = Math.min(1, C.level + dt * 4.0);
        if (C.level > 0.75 && C.shotsRemaining > 0 && now - C.lastShotTime > 140) {
          C.lastShotTime = now;
          C.shotsRemaining--;
          const side = C.shotsRemaining % 2 === 0 ? -1 : 1;
          const originX = W / 2 + (side < 0 ? -W * 0.28 : W * 0.28);
          const originY = H / 2;
          const targetX = W * 0.12 + Math.random() * (W * 0.76);
          const targetY = H * 0.12 + Math.random() * (H * 0.76);
          C.lasers.push({
            id: Math.random(),
            startX: originX,
            startY: originY,
            currentX: originX,
            currentY: originY,
            targetX,
            targetY,
            progress: 0,
            color: '#FF1133',
            side: side < 0 ? 'left' : 'right',
          });
          playSfx('laser', soundFxEnabledRef.current);
          A.shake = 1.6;
        }
        for (let i = C.lasers.length - 1; i >= 0; i--) {
          const l = C.lasers[i];
          l.progress += dt * 5.0;
          l.currentX = l.startX + (l.targetX - l.startX) * Math.min(1, l.progress);
          l.currentY = l.startY + (l.targetY - l.startY) * Math.min(1, l.progress);
          if (l.progress >= 1) {
            C.impacts.push({
              id: Math.random(),
              x: l.targetX,
              y: l.targetY,
              radius: 20 + Math.random() * 16,
              alpha: 1,
              angle: Math.random() * Math.PI * 2,
            });
            C.lasers.splice(i, 1);
          }
        }
        for (let i = C.impacts.length - 1; i >= 0; i--) {
          const imp = C.impacts[i];
          imp.alpha -= dt * 0.8;
          if (imp.alpha <= 0) C.impacts.splice(i, 1);
        }
        if (C.shotsRemaining <= 0) {
          C.level = Math.max(0, C.level - dt * 3.5);
          if (C.level <= 0.02) {
            C.isActive = false;
            C.level = 0;
            C.lasers = [];
            C.impacts = [];
            A.shake = 0;
            onBlasterCombatEndRef.current?.();
            onFaceChangeRef.current('IDLE', 0);
            onSpeakRef.current?.('Sistemas de armas enfriados y retraídos.');
          }
        }
      } else {
        C.level = Math.max(0, C.level - dt * 4.0);
        if (C.level <= 0.02) {
          C.level = 0;
          C.lasers = [];
          C.impacts = [];
        }
      }

      const D = drinkRef.current;
      D.progress = D.isActive ? Math.min(1, D.progress + dt * 3.0) : Math.max(0, D.progress - dt * 3.5);
      const Wv = waveRef.current;
      Wv.progress = Wv.isActive ? Math.min(1, Wv.progress + dt * 3.0) : Math.max(0, Wv.progress - dt * 3.5);
      if (flashRef.current.alpha > 0.01) flashRef.current.alpha = Math.max(0, flashRef.current.alpha - dt * 3.2);

      drawScene(ctx, canvas, S, A, V, lip);
      animId = requestAnimationFrame(render);
    };

    const start = () => {
      if (running) return;
      running = true;
      lastTime = performance.now();
      animId = requestAnimationFrame(render);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(animId);
    };
    const onVis = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVis);
    if (!document.hidden) start();

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      stop();
      window.removeEventListener('resize', resize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ───────────────────────── dibujo de la escena ─────────────────────────
  function drawScene(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    S: typeof stateRef.current,
    A: AnimationEngineState,
    V: Vida,
    lip: number
  ) {
    const W = canvas.width;
    const H = canvas.height;
    const base = getThemeColors(S.mode);
    // Atención a la persona: la cara se ilumina hasta un 8 %.
    const at = clamp(V.atencion, 0, 1);
    const theme =
      at > 0.01
        ? { ...base, primary: mixHex(base.primary, '#ffffff', 0.08 * at), glow: mixHex(base.glow, '#ffffff', 0.1 * at) }
        : base;
    const fun = S.funMode;
    const E: Escena = { face: S.face, mode: S.mode, t: S.t, lip, funMode: fun };

    // OLED negro
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);

    const baseR = Math.min(W * 0.115, H * 0.22);
    const eyeSpacing = baseR * 1.58;
    const quieto = 1 - 0.85 * V.serenidad; // en oración la cabeza casi no se mece
    // Giro sutil hacia la persona detectada: traslación 1.5 % del ancho + inclinación ~1.5°.
    const camShift = V.camX * at;
    const cx = W / 2 + camShift * W * 0.015;
    const cy = H / 2 + Math.sin(S.t * 1.15) * (baseR * 0.018) * quieto - (A.bounce + V.lift + V.jolt) * baseR;

    // Halo exterior que respira (en oración: cálido, más presente y estable)
    const breathK = (A.breath - 1) / 0.02; // −1..1
    const haloI =
      (0.45 + 0.22 * breathK * quieto + V.energia * 0.35 + V.ring * 0.4 * quieto + 0.2 * V.serenidad + 0.12 * at) *
      clamp(V.wake, 0, 1);
    drawHalo(ctx, cx, cy, baseR, theme, haloI, V.serenidad);

    // Motas ambientales (detrás de la cara)
    drawMotes(ctx, W, H, baseR, V.motes, theme, V.energia, A.breath, V.wake, S.t);

    drawShockwaves(ctx, A.shockwaves);

    const shakeX = A.shake * (Math.sin(S.t * 37.1) * 0.7 + Math.sin(S.t * 19.3) * 0.3) * 10;
    const shakeY = A.shake * (Math.sin(S.t * 29.7) * 0.6 + Math.cos(S.t * 13.1) * 0.4) * 7;

    // Respiración visible: toda la cara escala ±1.5 % (menos en oración).
    const breathScale = 1 + breathK * 0.015 * (0.4 + 0.6 * quieto);
    ctx.save();
    ctx.translate(cx + shakeX + V.swayX * baseR, cy + shakeY);
    ctx.rotate(V.tilt + camShift * 0.028);
    ctx.scale(A.squashX * breathScale, A.squashY * breathScale);

    if (fun && S.showHud) {
      drawModeCrown(ctx, 0, -baseR * 1.45, baseR, S.mode, theme, S.t);
    }

    // Ojos
    drawLivingEye(ctx, -eyeSpacing, 0, baseR, theme, E, A, V, -1);
    drawLivingEye(ctx, eyeSpacing, 0, baseR, theme, E, A, V, 1);

    if (A.visorDrop > 0.01) {
      drawLooiVisor(ctx, 0, 0, baseR, eyeSpacing, A.visorDrop, S.t);
    }

    // Boca
    drawCyberMouth(ctx, 0, baseR * 1.28, baseR, theme, E, A, V);

    // Chispas de canto (suben desde la boca)
    drawChispas(ctx, V.sparkles, theme, S.t);

    if (fun && S.showHud) {
      drawModeEnvironment(ctx, baseR, S.mode, theme, S.t);
    }

    if (fun) {
      if (combatRef.current.weapon === 'jedi' || S.face === 'JEDI') {
        drawJediSaber(ctx, W, H, S.t);
      } else if (combatRef.current.level > 0.005) {
        drawCombatBlasterTurrets(ctx, baseR, eyeSpacing, combatRef.current, S.t);
      }
    }
    if (drinkRef.current.progress > 0.005) {
      drawHolographicDrinkCup(ctx, baseR, eyeSpacing, drinkRef.current.progress, S.t);
    }
    if (waveRef.current.progress > 0.005) {
      drawCyberWavingHand(ctx, baseR, eyeSpacing, waveRef.current.progress, S.t);
    }
    ctx.restore();

    // Anillo de voz (espacio de pantalla, no gira con la cabeza)
    drawVoiceRing(ctx, cx, cy, baseR, eyeSpacing, theme, V.ring, V.ring2);

    if (fun && (combatRef.current.lasers.length > 0 || combatRef.current.impacts.length > 0)) {
      drawLaserBoltsAndImpacts(ctx, W, H, combatRef.current);
    }
    if (cameraFlashLiveRef.current || flashRef.current.alpha > 0.01) {
      drawCameraViewfinderAndFlash(ctx, W, H, flashRef.current.alpha, cameraFlashLiveRef.current);
    }
  }

  // ───────────────────────── mapa táctil ─────────────────────────
  type Zona = 'ojoIzq' | 'ojoDer' | 'centro' | 'frente' | 'barbilla' | 'mejilla' | 'fuera';

  const zonaDe = (clientX: number, clientY: number): Zona => {
    const canvas = canvasRef.current;
    if (!canvas) return 'fuera';
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left - rect.width / 2;
    const y = clientY - rect.top - rect.height / 2;
    const baseR = Math.min(rect.width * 0.115, rect.height * 0.22);
    const eyeSpacing = baseR * 1.58;
    if (Math.hypot(x + eyeSpacing, y) < baseR * 1.1) return 'ojoIzq';
    if (Math.hypot(x - eyeSpacing, y) < baseR * 1.1) return 'ojoDer';
    if (Math.abs(x) < baseR * 0.5 && Math.abs(y) < baseR * 0.6) return 'centro'; // entre los ojos; debajo (y > 0.6R) manda 'barbilla'
    if (y < -baseR * 1.2 && Math.abs(x) < eyeSpacing + baseR * 1.4) return 'frente';
    if (y > baseR * 0.6 && y < baseR * 2.7 && Math.abs(x) < baseR * 1.9) return 'barbilla';
    if (y > -baseR * 0.6 && y < baseR * 2.2 && Math.abs(x) < eyeSpacing + baseR * 2.2) return 'mejilla';
    return 'fuera';
  };

  const guinar = (side: -1 | 1) => {
    const A = animRef.current;
    A.wink = side;
    A.blinking = true;
    A.phase = 0;
    A.double = false;
    A.jiggle = 0.45;
    A.bounce = 0.18;
    A.smileT = 0.9;
    onFaceChange('WINK', 1600);
    playSfx('wink', soundFxEnabled);
    gesto('tapOjo');
    gesto('wink');
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ts = touchState.current;
    const now = performance.now();
    ts.startX = e.clientX;
    ts.startY = e.clientY;
    ts.downTime = now;
    ts.movedDistance = 0;
    ts.tapHandled = false;
    ts.dragReported = false;
    ts.strokePoints = [{ x: e.clientX, y: e.clientY, time: now }];
    stateRef.current.lastInteraction = now;
    // Captura del puntero: si el dedo/ratón se suelta sobre un overlay (barra, panel, burbuja),
    // el pointerup igual llega aquí y el arrastre no queda pegado (boca estirada, mirada clavada).
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* algunos WebViews no lo soportan; la red de seguridad es soltarPuntero() */
    }

    const rect = e.currentTarget.getBoundingClientRect();
    vidaRef.current.lastTouch = {
      x: (e.clientX - rect.left) / rect.width - 0.5,
      y: (e.clientY - rect.top) / rect.height - 0.5,
      t: now,
    };

    const theme = getThemeColors(stateRef.current.mode);
    const kx = e.currentTarget.width / Math.max(1, rect.width);
    const ky = e.currentTarget.height / Math.max(1, rect.height);
    addShockwave((e.clientX - rect.left) * kx, (e.clientY - rect.top) * ky, theme.primary);
    playSfx('tap', soundFxEnabled);

    if (stateRef.current.face === 'SLEEPING') return; // el despertar se decide al soltar

    // Respuesta inmediata (<50 ms): las pupilas saltan al punto de contacto y la zona tocada reacciona.
    const A = animRef.current;
    const V = vidaRef.current;
    const lt = vidaRef.current.lastTouch!;
    A.tx = lt.x * 1.4;
    A.ty = lt.y * 0.9;
    A.lx = clamp(A.tx, -1, 1) * 0.9;
    A.ly = clamp(A.ty, -1, 1) * 0.9;
    V.lookVX = V.lookVY = 0;

    const z = zonaDe(e.clientX, e.clientY);
    if (z === 'ojoIzq') {
      V.squashL = 1;
      guinar(-1);
      ts.tapHandled = true;
    } else if (z === 'ojoDer') {
      V.squashR = 1;
      guinar(1);
      ts.tapHandled = true;
    } else if (z === 'centro') {
      V.squashL = V.squashR = 0.85;
      V.touchOh = 0.6;
    } else if (z === 'barbilla') {
      V.touchOh = 1; // «oh» corto
      V.browLift = Math.max(V.browLift, 0.5);
    } else if (z === 'mejilla') {
      V.touchSmile = 1;
      V.touchSmileSide = clamp(lt.x * 3, -1, 1); // la sonrisa tira hacia el lado tocado (vía mouthSkewT)
    } else if (z === 'frente') {
      V.browLift = Math.max(V.browLift, 1);
      V.wide = Math.max(V.wide, 1.05);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    stateRef.current.lastInteraction = performance.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width - 0.5;
    const relY = (e.clientY - rect.top) / rect.height - 0.5;

    // Imán de mirada hacia el dedo / puntero
    animRef.current.tx = relX * 1.4;
    animRef.current.ty = relY * 0.9;

    const ts = touchState.current;
    if (ts.downTime > 0) {
      ts.movedDistance += Math.hypot(e.clientX - ts.startX, e.clientY - ts.startY);
      ts.strokePoints.push({ x: e.clientX, y: e.clientY, time: performance.now() });
      vidaRef.current.lastTouch = { x: relX, y: relY, t: performance.now() };
      if (!ts.dragReported && ts.movedDistance > 40) {
        ts.dragReported = true;
        gesto('arrastre');
      }

      // Frotar mejilla (mitad inferior, trazo) → ronroneo
      if (ts.strokePoints.length > 8) {
        const recent = ts.strokePoints.slice(-6);
        const dist = Math.hypot(recent[recent.length - 1].x - recent[0].x, recent[recent.length - 1].y - recent[0].y);
        if (dist > 30 && relY > 0) {
          animRef.current.tickle = Math.min(1, animRef.current.tickle + 0.1);
          if (animRef.current.tickle > 0.4 && stateRef.current.face !== 'PURR') {
            onFaceChange('PURR', 3400);
            playSfx('purr', soundFxEnabled);
            animRef.current.bounce = 0.3;
            gesto('frotarMejilla');
          }
        }
      }
    }
  };

  /** Red de seguridad: termina el contacto sin gesto (cancel, pérdida de captura, salida del canvas). */
  const soltarPuntero = () => {
    const ts = touchState.current;
    if (ts.downTime === 0) return;
    ts.downTime = 0;
    ts.movedDistance = 0;
    const V = vidaRef.current;
    V.mouthStretchT = 0;
    V.lookVX = V.lookVY = 0;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ts = touchState.current;
    if (ts.downTime === 0) return; // ya se soltó por cancel / pérdida de captura
    const holdDuration = performance.now() - ts.downTime;
    const deltaX = e.clientX - ts.startX;
    const deltaY = e.clientY - ts.startY;
    ts.downTime = 0;

    if (ts.movedDistance < 24) onCloseOverlays();

    if (ts.movedDistance > 70 && Math.abs(deltaY) > Math.abs(deltaX) && deltaY < -40) {
      onSwipeUp();
      playSfx('mode', soundFxEnabled);
      gesto('swipeArriba');
      return;
    }
    if (ts.movedDistance > 70 && Math.abs(deltaY) > Math.abs(deltaX) && deltaY > 40) {
      onSwipeDown();
      playSfx('mode', soundFxEnabled);
      gesto('swipeAbajo');
      return;
    }
    if (ts.movedDistance > 70 && Math.abs(deltaX) > Math.abs(deltaY)) {
      const currentIndex = MODES.indexOf(stateRef.current.mode);
      const step = deltaX > 0 ? 1 : -1;
      onModeChange(MODES[(currentIndex + step + MODES.length) % MODES.length]);
      playSfx('mode', soundFxEnabled);
      gesto('swipeLado');
      return;
    }

    // Pulsación larga → dormir / despertar
    if (holdDuration > 650 && ts.movedDistance < 40) {
      gesto('longPress');
      if (stateRef.current.face === 'SLEEPING') {
        onWake();
        gesto('despertar');
      } else {
        onSleep();
        gesto('dormir');
      }
      return;
    }

    if (ts.movedDistance < 28) handleTap(e.clientX, e.clientY);
  };

  const handleTap = (clientX: number, clientY: number) => {
    const S = stateRef.current;
    const A = animRef.current;
    const V = vidaRef.current;
    const C = combatRef.current;
    const ts = touchState.current;

    if (S.funMode) {
      if (C.isActive && C.weapon === 'blaster') {
        triggerJediSaber();
        S.poke = 4;
        return;
      }
      if (C.isActive && C.weapon === 'jedi') {
        disarmCombat();
        playSfx('tap', soundFxEnabled);
        onSpeak('Sable guardado.');
        return;
      }
    }

    if (S.face === 'SLEEPING') {
      onWake();
      gesto('despertar');
      return;
    }

    const now = performance.now();
    S.poke = now - S.lastPokeTime < 1400 ? S.poke + 1 : 1;
    S.lastPokeTime = now;

    A.jiggle = Math.max(A.jiggle, 0.4);
    A.bounce = Math.max(A.bounce, 0.15);
    // Segundo toque seguido: ya frunce un poco (cejas) antes del «ya, ya».
    if (!S.funMode && S.poke === 2) V.annoy = Math.max(V.annoy, 0.55);

    // ── escalada de juguete (sólo funMode) ──
    if (S.funMode) {
      A.smileT = Math.min(1.2, A.smileT + 0.35);
      if (S.poke === 1) {
        if (!ts.tapHandled) {
          scheduleBlink('wink');
          playSfx('wink', soundFxEnabled);
        }
      } else if (S.poke === 2) {
        onFaceChange('ANGRY', 2200);
        playSfx('deny', soundFxEnabled);
        onSpeak('Cuidado.');
      } else if (S.poke === 3) {
        triggerBlasterCombat();
      } else {
        triggerJediSaber();
        S.poke = 0;
      }
      return;
    }

    // ── mapa humano ──
    if (S.poke >= 3) {
      // "Ya, ya": molestia de juego 1.2 s y luego risa
      if (!S.burstActive) {
        S.burstActive = true;
        V.annoy = 1; // cejas juntas, párpados bajos, labio apretado… y luego risa
        V.touchSmile = 0;
        A.smileT = -0.2;
        A.smile = Math.min(A.smile, 0.3);
        A.blinking = false;
        A.wink = 0;
        A.blinkL = A.blinkR = 1;
        onFaceChange('ANGRY', 1200);
        A.shake = 0.8;
        playSfx('deny', soundFxEnabled);
        gesto('molestoJuego');
        later(() => {
          V.annoy = 0;
          onFaceChangeRef.current('LAUGH', 1800);
          V.laughAmp = 1;
          V.laughPhase = 0;
          gesto('risa');
          // Se dice al reír, no antes: la cara de habla que pone App no debe tapar la fase de molestia.
          if (!S.burstSpoken) {
            S.burstSpoken = true;
            onSpeakRef.current('Ya, ya. Je.');
          }
        }, 1200);
        later(() => {
          S.burstActive = false;
          S.burstSpoken = false;
          S.poke = 0;
        }, 3400);
      }
      return;
    }
    if (ts.tapHandled) return; // guiño ya hecho al bajar el dedo

    const z = zonaDe(clientX, clientY);
    if (z === 'frente') {
      V.browLift = Math.max(V.browLift, 0.6);
      A.dilate = Math.min(0.7, A.dilate + 0.1);
      onFaceChange('CURIOSITY', 1800);
      playSfx('blip', soundFxEnabled);
      gesto('tapFrente');
      gesto('curioso');
      return;
    }
    if (z === 'barbilla') {
      V.laughAmp = 1;
      V.laughPhase = 0;
      A.tickle = Math.min(1, A.tickle + 0.5);
      onFaceChange('LAUGH', 2200);
      playSfx('chirp', soundFxEnabled);
      gesto('tapBarbilla');
      gesto('risa');
      return;
    }
    // Mejilla u otro sitio: guiño suave; la sonrisa ya la puso `touchSmile` al bajar el dedo.
    // Sólo SUBE la meta (tope 0.6): una cara que ya sonríe más (HAPPY 1.0, PURR, LAUGH…) no se apaga por tocarla.
    if (A.smileT < 0.6) A.smileT = Math.min(0.6, A.smileT + 0.15);
    scheduleBlink(Math.random() < 0.5 ? 'wink' : 'double');
    playSfx('wink', soundFxEnabled);
    gesto('tapMejilla');
  };

  return (
    <canvas
      ref={canvasRef}
      id="ultron-face-canvas"
      className="absolute inset-0 w-full h-full cursor-crosshair touch-none select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={soltarPuntero}
      onLostPointerCapture={soltarPuntero}
      onPointerLeave={soltarPuntero}
    />
  );
};
