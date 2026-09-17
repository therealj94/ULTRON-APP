import React, { useEffect, useRef, useCallback } from 'react';
import {
  Mode,
  FaceState,
  AnimationEngineState,
  FaceTargets,
  TouchRipple,
  BlasterLaserBolt,
  BulletImpact,
} from '../types';
import { playSfx } from '../utils/audio';

interface FaceCanvasProps {
  face: FaceState;
  mode: Mode;
  energy: number;
  soundFxEnabled: boolean;
  hasVisor?: boolean;
  cameraGaze?: { x: number; y: number; active: boolean };
  // New interactive actions requested by user
  isDrinking?: boolean;
  isWaving?: boolean;
  isCameraFlashing?: boolean;
  isCombatBlasterActive?: boolean;
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
}

const MODES: Mode[] = ['GUARDIAN', 'MINING', 'GOLD', 'CREATIVE', 'ANALYTICAL', 'STRATEGIC', 'EXPLORER'];

export const FaceCanvas: React.FC<FaceCanvasProps> = ({
  face,
  mode,
  energy,
  soundFxEnabled,
  hasVisor = false,
  cameraGaze,
  isDrinking = false,
  isWaving = false,
  isCameraFlashing = false,
  isCombatBlasterActive = false,
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
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // References to preserve state across 60fps render loop
  const stateRef = useRef<{
    face: FaceState;
    prevFace: FaceState;
    mode: Mode;
    energy: number;
    hasVisor: boolean;
    t: number;
    poke: number;
    lastPokeTime: number;
    lastInteraction: number;
    mix: number;
  }>({
    face,
    prevFace: face,
    mode,
    energy,
    hasVisor,
    t: 0,
    poke: 0,
    lastPokeTime: 0,
    lastInteraction: 0,
    mix: 1,
  });

  const animRef = useRef<AnimationEngineState>({
    blink: 1,
    blinkL: 1,
    blinkR: 1,
    blinking: false,
    phase: 0,
    next: 1.8,
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

  // Touch tracking
  const touchState = useRef<{
    startX: number;
    startY: number;
    downTime: number;
    movedDistance: number;
    touches: number;
    strokePoints: Array<{ x: number; y: number; time: number }>;
  }>({
    startX: 0,
    startY: 0,
    downTime: 0,
    movedDistance: 0,
    touches: 0,
    strokePoints: [],
  });

  // Combat Blaster State (Gun Draw & Rapid Laser Fire when tapped repeatedly)
  const combatRef = useRef<{
    isActive: boolean;
    level: number; // 0 to 1
    shotsRemaining: number;
    lastShotTime: number;
    lasers: BlasterLaserBolt[];
    impacts: BulletImpact[];
  }>({
    isActive: false,
    level: 0,
    shotsRemaining: 0,
    lastShotTime: 0,
    lasers: [],
    impacts: [],
  });

  // Holographic Refreshing Drink State (Soda / Water recognition)
  const drinkRef = useRef<{
    isActive: boolean;
    progress: number;
  }>({
    isActive: false,
    progress: 0,
  });

  // Cyber-Robotic Waving Hand State (Hand greeting recognition)
  const waveRef = useRef<{
    isActive: boolean;
    progress: number;
  }>({
    isActive: false,
    progress: 0,
  });

  // Optical Camera Viewfinder & Shutter Flash State
  const flashRef = useRef<{
    alpha: number;
  }>({
    alpha: 0,
  });

  const triggerBlasterCombat = useCallback(() => {
    const C = combatRef.current;
    if (C.isActive) return;
    C.isActive = true;
    C.shotsRemaining = 12;
    C.lastShotTime = performance.now();
    onFaceChange('FURY', 4500);
    playSfx('gun_draw', soundFxEnabled);
    onSpeak('¡LÍMITE DE CONTACTO EXCEDIDO! ¡DESPLEGANDO CAÑONES BLASTER!');
    animRef.current.shake = 1.8;
    onTriggerBlasterCombat?.();
  }, [onFaceChange, onSpeak, soundFxEnabled, onTriggerBlasterCombat]);

  // Sync external combat blaster prop
  useEffect(() => {
    if (isCombatBlasterActive && !combatRef.current.isActive) {
      triggerBlasterCombat();
    }
  }, [isCombatBlasterActive, triggerBlasterCombat]);

  // Handle camera shutter flash & high-res snapshot capture
  useEffect(() => {
    if (isCameraFlashing) {
      flashRef.current.alpha = 1.0;
      playSfx('shutter', soundFxEnabled);
      const timer = setTimeout(() => {
        if (canvasRef.current && onSnapshotReady) {
          try {
            const dataUrl = canvasRef.current.toDataURL('image/png');
            onSnapshotReady(dataUrl);
          } catch (err) {
            console.error('Canvas snapshot error:', err);
          }
        }
      }, 70);
      return () => clearTimeout(timer);
    }
  }, [isCameraFlashing, onSnapshotReady, soundFxEnabled]);

  // Handle Drink Action
  useEffect(() => {
    if (isDrinking) {
      drinkRef.current.isActive = true;
      drinkRef.current.progress = 0;
      onFaceChange('HAPPY', 3200);
      playSfx('sip', soundFxEnabled);
      const timer = setTimeout(() => {
        drinkRef.current.isActive = false;
        onDrinkComplete?.();
        onSpeak('¡Electrolitos corporativos al 100%! Muy refrescante.');
      }, 3400);
      return () => clearTimeout(timer);
    } else {
      drinkRef.current.isActive = false;
    }
  }, [isDrinking, onDrinkComplete, onFaceChange, onSpeak, soundFxEnabled]);

  // Handle Hand Wave Action
  useEffect(() => {
    if (isWaving) {
      waveRef.current.isActive = true;
      waveRef.current.progress = 0;
      onFaceChange('WINK', 2800);
      playSfx('wave', soundFxEnabled);
      const timer = setTimeout(() => {
        waveRef.current.isActive = false;
        onWaveComplete?.();
        onSpeak('¡Hola! Saludos cordiales de Ultron.');
      }, 2800);
      return () => clearTimeout(timer);
    } else {
      waveRef.current.isActive = false;
    }
  }, [isWaving, onWaveComplete, onFaceChange, onSpeak, soundFxEnabled]);

  // Sync props to stateRef
  useEffect(() => {
    stateRef.current.face = face;
    stateRef.current.mode = mode;
    stateRef.current.energy = energy;
    stateRef.current.hasVisor = hasVisor;

    const tg = getTargetsFor(face);
    animRef.current.dilateT = tg.dilate;
    animRef.current.browT = tg.brow;
    animRef.current.mouthT = tg.mouth;
    animRef.current.smileT = tg.smile;

    if (face === 'ANGRY' || face === 'FURY') {
      animRef.current.shake = 1.4;
    } else if (face === 'CONCERNED' || face === 'STARTLE') {
      animRef.current.shake = 0.7;
    } else if (face === 'HAPPY' || face === 'PURR') {
      animRef.current.bounce = 0.25;
    }
  }, [face, mode, energy, hasVisor]);

  // Keep stable refs for animation loop to avoid re-instantiating requestAnimationFrame
  const cameraGazeRef = useRef(cameraGaze);
  const soundFxEnabledRef = useRef(soundFxEnabled);
  const onBlasterCombatEndRef = useRef(onBlasterCombatEnd);
  const onSpeakRef = useRef(onSpeak);

  useEffect(() => {
    cameraGazeRef.current = cameraGaze;
    if (cameraGaze && cameraGaze.active) {
      animRef.current.tx = cameraGaze.x * 0.95;
      animRef.current.ty = cameraGaze.y * 0.65;
      stateRef.current.lastInteraction = performance.now();
    }
  }, [cameraGaze]);

  useEffect(() => {
    soundFxEnabledRef.current = soundFxEnabled;
  }, [soundFxEnabled]);

  useEffect(() => {
    onBlasterCombatEndRef.current = onBlasterCombatEnd;
    onSpeakRef.current = onSpeak;
  }, [onBlasterCombatEnd, onSpeak]);

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  function getTargetsFor(f: FaceState): FaceTargets {
    switch (f) {
      case 'LISTENING':
        return { dilate: 0.46, brow: 0.2, mouth: 0.12, smile: 0.1, bounce: 0.04 };
      case 'THINKING':
        return { dilate: 0.25, brow: 0.42, mouth: 0.04, smile: 0, bounce: 0 };
      case 'SPEAKING':
        return { dilate: 0.4, brow: 0.12, mouth: 0.65, smile: 0.2, bounce: 0.05 };
      case 'HAPPY':
        return { dilate: 0.38, brow: -0.28, mouth: 0.24, smile: 1, bounce: 0.15 };
      case 'PURR':
        return { dilate: 0.42, brow: -0.35, mouth: 0.18, smile: 1.2, bounce: 0.22 };
      case 'WINK':
        return { dilate: 0.36, brow: -0.15, mouth: 0.2, smile: 0.8, bounce: 0.1 };
      case 'CONCERNED':
        return { dilate: 0.32, brow: 0.5, mouth: 0.12, smile: -0.6, bounce: 0 };
      case 'ANGRY':
        return { dilate: 0.22, brow: 0.88, mouth: 0.14, smile: -0.9, bounce: 0 };
      case 'FURY':
        return { dilate: 0.18, brow: 1.05, mouth: 0.2, smile: -1.0, bounce: 0.08 };
      case 'SLEEPING':
        return { dilate: 0.2, brow: 0.05, mouth: 0, smile: 0, bounce: 0 };
      case 'STARTLE':
        return { dilate: 0.58, brow: 0.55, mouth: 0.45, smile: -0.25, bounce: 0.2 };
      case 'IDLE':
      default:
        return { dilate: 0.36, brow: 0, mouth: 0.08, smile: 0.15, bounce: 0 };
    }
  }

  const scheduleBlink = useCallback((type: 'single' | 'double' | 'wink' = 'single') => {
    const A = animRef.current;
    if (A.blinking) return;
    A.blinking = true;
    A.phase = 0;
    A.double = type === 'double';
    A.wink = type === 'wink' ? (Math.random() < 0.5 ? -1 : 1) : 0;
  }, []);

  const addShockwave = (x: number, y: number, color: string) => {
    animRef.current.shockwaves.push({
      id: Math.random(),
      x,
      y,
      radius: 6,
      maxRadius: 110,
      alpha: 1,
      color,
    });
    // Limit to 5 active ripples
    if (animRef.current.shockwaves.length > 5) {
      animRef.current.shockwaves.shift();
    }
  };

  // Main Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let animId: number;
    let lastTime = performance.now();

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

    const render = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.06);
      lastTime = now;

      const S = stateRef.current;
      const A = animRef.current;
      S.t += dt;

      // Animate visor drop (LOOI sunglasses)
      const targetVisor = S.hasVisor ? 1 : 0;
      A.visorDrop += (targetVisor - A.visorDrop) * Math.min(1, dt * 10);

      // Autonomous Blink Timer
      if (S.face !== 'SLEEPING') {
        A.next -= dt;
        if (A.next <= 0 && !A.blinking) {
          const r = Math.random();
          if (r < 0.18) scheduleBlink('double');
          else if (r < 0.28) scheduleBlink('wink');
          else scheduleBlink('single');
          A.next = 2.2 + Math.random() * 3.5;
        }
      }

      // Blink animation progression
      if (A.blinking) {
        A.phase += dt * (A.double ? 9.5 : 7.2);
        let b = 1;
        if (A.phase < Math.PI) {
          b = Math.max(0.04, Math.cos(A.phase));
        } else if (A.double && A.phase < Math.PI * 2) {
          b = Math.max(0.04, Math.abs(Math.sin(A.phase)));
        } else {
          A.blinking = false;
          A.phase = 0;
          A.wink = 0;
          b = 1;
        }
        A.blink = b;
        A.blinkL = A.wink > 0 ? 1 : b;
        A.blinkR = A.wink < 0 ? 1 : b;
      } else if (S.face === 'SLEEPING') {
        A.blink = 0.06;
        A.blinkL = 0.06;
        A.blinkR = 0.06;
      } else if (S.face === 'WINK') {
        A.blinkL = 1;
        A.blinkR = 0.08;
      } else if (S.face === 'PURR') {
        A.blink = 0.22;
        A.blinkL = 0.22;
        A.blinkR = 0.22;
      } else {
        A.blink = 1;
        A.blinkL = 1;
        A.blinkR = 1;
      }

      // Idle Micro-Saccades if not tracked by camera or touch
      if (now - S.lastInteraction > 3500 && (!cameraGazeRef.current || !cameraGazeRef.current.active)) {
        A.saccadeIn -= dt;
        if (A.saccadeIn <= 0) {
          A.tx = (Math.random() - 0.5) * 0.45;
          A.ty = (Math.random() - 0.5) * 0.3;
          A.saccadeIn = 1.4 + Math.random() * 2.6;
        }
      }

      // Look interpolation with elastic damping
      A.lx += (A.tx - A.lx) * Math.min(1, dt * 7);
      A.ly += (A.ty - A.ly) * Math.min(1, dt * 7);

      // Facial Parameter Lerping
      A.dilate += (A.dilateT - A.dilate) * Math.min(1, dt * 6);
      A.brow += (A.browT - A.brow) * Math.min(1, dt * 6);
      A.mouth += (A.mouthT - A.mouth) * Math.min(1, dt * 10);
      A.smile += (A.smileT - A.smile) * Math.min(1, dt * 7);

      // Organic Secondary Oscillations
      A.breath = 1 + 0.02 * Math.sin(S.t * 2.2);
      A.pulse = (A.pulse + dt * 0.8) % 1;
      A.think += dt * 3.5;
      A.sleepZ += dt;

      // Jiggle and decay
      if (A.jiggle > 0.001) A.jiggle *= 0.88;
      if (A.tickle > 0.001) A.tickle *= 0.92;
      if (A.shake > 0.001) A.shake *= 0.9;
      if (A.bounce > 0.001) A.bounce *= 0.92;

      // Squashing
      A.squashX = 1 + A.jiggle * 0.15 * Math.sin(S.t * 18);
      A.squashY = 1 - A.jiggle * 0.12 * Math.sin(S.t * 18);

      // Update and filter shockwaves
      for (let i = A.shockwaves.length - 1; i >= 0; i--) {
        const sw = A.shockwaves[i];
        sw.radius += dt * 180;
        sw.alpha = Math.max(0, 1 - sw.radius / sw.maxRadius);
        if (sw.alpha <= 0) {
          A.shockwaves.splice(i, 1);
        }
      }

      // Update Combat Blaster System
      const C = combatRef.current;
      if (C.isActive) {
        C.level = Math.min(1, C.level + dt * 3.5);
        // Rapid fire bursts when blasters are extended
        if (C.level > 0.75 && C.shotsRemaining > 0 && now - C.lastShotTime > 150) {
          C.lastShotTime = now;
          C.shotsRemaining--;
          const side = C.shotsRemaining % 2 === 0 ? -1 : 1;
          const originX = canvas.width / 2 + (side < 0 ? -canvas.width * 0.28 : canvas.width * 0.28);
          const originY = canvas.height / 2;
          const targetX = canvas.width * 0.12 + Math.random() * (canvas.width * 0.76);
          const targetY = canvas.height * 0.12 + Math.random() * (canvas.height * 0.76);

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

        // Advance laser bolts
        for (let i = C.lasers.length - 1; i >= 0; i--) {
          const l = C.lasers[i];
          l.progress += dt * 4.5;
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

        // Fade impacts on screen glass
        for (let i = C.impacts.length - 1; i >= 0; i--) {
          const imp = C.impacts[i];
          imp.alpha -= dt * 0.55;
          if (imp.alpha <= 0) {
            C.impacts.splice(i, 1);
          }
        }

        // Finish combat when all shots fired and impacts settling
        if (C.shotsRemaining <= 0 && C.lasers.length === 0) {
          C.level = Math.max(0, C.level - dt * 2.0);
          if (C.level <= 0.01) {
            C.isActive = false;
            onBlasterCombatEndRef.current?.();
            onSpeakRef.current?.('Sistemas de armas enfriados y retraídos.');
          }
        }
      } else {
        C.level = Math.max(0, C.level - dt * 3.0);
      }

      // Update Drink and Wave Progress
      const D = drinkRef.current;
      if (D.isActive) {
        D.progress = Math.min(1, D.progress + dt * 3.0);
      } else {
        D.progress = Math.max(0, D.progress - dt * 3.5);
      }

      const Wv = waveRef.current;
      if (Wv.isActive) {
        Wv.progress = Math.min(1, Wv.progress + dt * 3.0);
      } else {
        Wv.progress = Math.max(0, Wv.progress - dt * 3.5);
      }

      // Update Camera Flash Alpha
      if (flashRef.current.alpha > 0.01) {
        flashRef.current.alpha = Math.max(0, flashRef.current.alpha - dt * 3.2);
      }

      // Clear & Draw
      drawScene(ctx, canvas, S, A);

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  // Color Palette per Mode (High-contrast OLED palette inspired by LOOI & Boardroom Tablets)
  function getThemeColors(m: Mode) {
    switch (m) {
      case 'GOLD':
        return {
          primary: '#F5C542',
          glow: '#FFE17D',
          core: '#FFF4C2',
          accent: '#FFB800',
          dark: '#3D2800',
        };
      case 'CREATIVE':
        return {
          primary: '#05E1FF',
          glow: '#67EFFF',
          core: '#E0FAFF',
          accent: '#FF4DF0',
          dark: '#002530',
        };
      case 'ANALYTICAL':
        return {
          primary: '#05E1FF',
          glow: '#4FE4FF',
          core: '#D8F7FF',
          accent: '#00FFA3',
          dark: '#00242E',
        };
      case 'STRATEGIC':
        return {
          primary: '#05E1FF',
          glow: '#4AE1FF',
          core: '#D9F8FF',
          accent: '#4C82FF',
          dark: '#001E2B',
        };
      case 'EXPLORER':
        return {
          primary: '#05E1FF',
          glow: '#64E5FF',
          core: '#E3FAFF',
          accent: '#26C6DA',
          dark: '#00222B',
        };
      case 'MINING':
        return {
          primary: '#05E1FF',
          glow: '#59E3FF',
          core: '#DDF9FF',
          accent: '#FF9E2C',
          dark: '#00222B',
        };
      case 'GUARDIAN':
      default:
        return {
          primary: '#05E1FF',
          glow: '#5CE4FF',
          core: '#E0F9FF',
          accent: '#00C8FF',
          dark: '#001E29',
        };
    }
  }

  // Master Canvas Drawing Function
  function drawScene(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    S: typeof stateRef.current,
    A: AnimationEngineState
  ) {
    const W = canvas.width;
    const H = canvas.height;

    // Pitch Black OLED Canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);

    // Subtle Vignette Glow according to energy
    const theme = getThemeColors(S.mode);
    const bgRad = ctx.createRadialGradient(W / 2, H / 2, H * 0.1, W / 2, H / 2, W * 0.65);
    bgRad.addColorStop(0, theme.primary + '0a');
    bgRad.addColorStop(1, '#000000');
    ctx.fillStyle = bgRad;
    ctx.fillRect(0, 0, W, H);

    // Draw touch shockwaves
    for (const sw of A.shockwaves) {
      ctx.save();
      ctx.strokeStyle = sw.color;
      ctx.globalAlpha = sw.alpha * 0.8;
      ctx.lineWidth = 3;
      ctx.shadowColor = sw.color;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.stroke();

      // Outer faint echo ring
      if (sw.radius > 20) {
        ctx.globalAlpha = sw.alpha * 0.35;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.radius * 0.7, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Geometry Metrics (Desk Stand Landscape Ratio)
    const baseR = Math.min(W * 0.115, H * 0.22);
    const eyeSpacing = baseR * 1.58;
    const cx = W / 2;
    const cy = H / 2 + Math.sin(S.t * 2) * (baseR * 0.04) - A.bounce * baseR;

    const shakeX = (Math.random() - 0.5) * A.shake * 12;
    const shakeY = (Math.random() - 0.5) * A.shake * 8;

    ctx.save();
    ctx.translate(cx + shakeX, cy + shakeY);
    ctx.scale(A.squashX, A.squashY);

    // 1. Draw Top Mode Crown / Emblem (Faithful to Photo 3)
    drawModeCrown(ctx, 0, -baseR * 1.45, baseR, S.mode, theme, S.t, A);

    // 2. Draw the Two Volumetric Living Eyes (LOOI Style)
    const leftX = -eyeSpacing;
    const rightX = eyeSpacing;
    const eyeY = 0;

    drawLivingEye(ctx, leftX, eyeY, baseR, theme, S, A, -1);
    drawLivingEye(ctx, rightX, eyeY, baseR, theme, S, A, 1);

    // 3. Draw Cyber Red Visor Sunglasses if equipped (LOOI Photo 2)
    if (A.visorDrop > 0.01) {
      drawLooiVisor(ctx, 0, eyeY, baseR, eyeSpacing, A.visorDrop, S.t);
    }

    // 4. Draw Reactive Mouth Line
    drawCyberMouth(ctx, 0, baseR * 1.25, baseR, theme.primary, S, A);

    // 5. Special Mode Ambient Overlays (Stars, Sparks, Data Nodes)
    drawModeEnvironment(ctx, baseR, S.mode, theme, S.t);

    // 6. Dual Retractable Combat Blaster Cannons (Rage trigger)
    if (combatRef.current.level > 0.005) {
      drawCombatBlasterTurrets(ctx, baseR, eyeSpacing, combatRef.current, S.t);
    }

    // 7. Holographic Drink Cup with Ice & Neon Straw
    if (drinkRef.current.progress > 0.005) {
      drawHolographicDrinkCup(ctx, baseR, eyeSpacing, drinkRef.current.progress, S.t);
    }

    // 8. Cute Articulated Cyber-Robotic Waving Hand
    if (waveRef.current.progress > 0.005) {
      drawCyberWavingHand(ctx, baseR, eyeSpacing, waveRef.current.progress, S.t);
    }

    ctx.restore();

    // 9. Fullscreen Lasers and Glass Impact Fractures
    if (combatRef.current.lasers.length > 0 || combatRef.current.impacts.length > 0) {
      drawLaserBoltsAndImpacts(ctx, W, H, combatRef.current);
    }

    // 10. Optical Camera Viewfinder & Shutter Flash
    if (isCameraFlashing || flashRef.current.alpha > 0.01) {
      drawCameraViewfinderAndFlash(ctx, W, H, flashRef.current.alpha, isCameraFlashing);
    }
  }

  // Draw OLED Volumetric Eye (LOOI Inspired)
  function drawLivingEye(
    ctx: CanvasRenderingContext2D,
    ex: number,
    ey: number,
    R: number,
    theme: ReturnType<typeof getThemeColors>,
    S: typeof stateRef.current,
    A: AnimationEngineState,
    side: number // -1 = Left, 1 = Right
  ) {
    const open = side < 0 ? A.blinkL : A.blinkR;
    const isHappy = S.face === 'HAPPY' || S.face === 'PURR' || A.smile > 0.75;
    const rx = R;
    const ry = Math.max(2, R * open);

    ctx.save();
    ctx.translate(ex, ey);

    // Thinking slight tilt
    if (S.face === 'THINKING') {
      ctx.rotate(side * 0.12 * Math.sin(S.t * 2));
    }

    // Happy Crescent Eyes (When smiling or petted)
    if (isHappy && open > 0.15) {
      ctx.save();
      ctx.strokeStyle = theme.primary;
      ctx.lineWidth = R * 0.18;
      ctx.lineCap = 'round';
      ctx.shadowColor = theme.glow;
      ctx.shadowBlur = 24;

      ctx.beginPath();
      // Upward welcoming arc
      ctx.arc(0, R * 0.18, rx * 0.85, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();

      // Inner white core
      ctx.strokeStyle = theme.core;
      ctx.lineWidth = R * 0.08;
      ctx.beginPath();
      ctx.arc(0, R * 0.18, rx * 0.85, Math.PI * 1.2, Math.PI * 1.8);
      ctx.stroke();

      ctx.restore();
      ctx.restore();
      return;
    }

    // Outer Multi-layer OLED Neon Halo
    const halo = ctx.createRadialGradient(0, 0, rx * 0.4, 0, 0, rx * 1.45);
    halo.addColorStop(0, theme.primary + '38');
    halo.addColorStop(0.65, theme.primary + '12');
    halo.addColorStop(1, '#00000000');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 1.4, ry * 1.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Solid Volumetric Glowing Disc (LOOI Hallmark)
    if (open > 0.1) {
      ctx.save();
      // Clip eye boundary for pupil and glyphs
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();

      // Deep, rich spherical gradient disc
      const eyeGrad = ctx.createRadialGradient(
        A.lx * rx * 0.25,
        A.ly * ry * 0.25 - ry * 0.1,
        rx * 0.1,
        0,
        0,
        rx * 1.05
      );
      eyeGrad.addColorStop(0, theme.core);
      eyeGrad.addColorStop(0.35, theme.primary);
      eyeGrad.addColorStop(0.85, theme.glow + 'cc');
      eyeGrad.addColorStop(1, theme.dark);

      ctx.fillStyle = eyeGrad;
      ctx.shadowColor = theme.primary;
      ctx.shadowBlur = 28;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();

      // Draw Mode Specific Eye Glyphs (Faithful to Image 3 Tablets!)
      drawModeEyeGlyph(ctx, rx, ry, side, S.mode, theme, S.t, A);

      // Specular Catchlight Highlights (LOOI's adorable eye reflections)
      const lookOffsetX = A.lx * rx * 0.32;
      const lookOffsetY = A.ly * ry * 0.32;

      // Primary top-left catchlight
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 8;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(
        lookOffsetX - rx * 0.32,
        lookOffsetY - ry * 0.32,
        rx * 0.16 * A.breath,
        0,
        Math.PI * 2
      );
      ctx.fill();

      // Secondary micro-sparkle bottom-right
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.arc(
        lookOffsetX + rx * 0.28,
        lookOffsetY + ry * 0.28,
        rx * 0.08,
        0,
        Math.PI * 2
      );
      ctx.fill();

      ctx.restore();
    }

    // Outer Precision Neon Border Ring
    ctx.strokeStyle = theme.primary;
    ctx.lineWidth = R * 0.055;
    ctx.shadowColor = theme.glow;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Expressive Cyber Eyebrow
    if (Math.abs(A.brow) > 0.08 || S.face === 'ANGRY' || S.face === 'CONCERNED') {
      ctx.strokeStyle = theme.primary;
      ctx.lineWidth = R * 0.07;
      ctx.lineCap = 'round';
      ctx.shadowColor = theme.glow;
      ctx.shadowBlur = 12;

      const browY = -ry * (1.15 + A.brow * 0.28);
      ctx.beginPath();
      if (side < 0) {
        ctx.moveTo(-rx * 0.95, browY - A.brow * R * 0.2);
        ctx.lineTo(rx * 0.65, browY + A.brow * R * 0.22);
      } else {
        ctx.moveTo(rx * 0.95, browY - A.brow * R * 0.2);
        ctx.lineTo(-rx * 0.65, browY + A.brow * R * 0.22);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  // Draw Specific In-Eye Glyphs from User Tablet Image 3
  function drawModeEyeGlyph(
    ctx: CanvasRenderingContext2D,
    rx: number,
    ry: number,
    side: number,
    m: Mode,
    theme: ReturnType<typeof getThemeColors>,
    t: number,
    A: AnimationEngineState
  ) {
    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#000000';
    ctx.lineWidth = rx * 0.09;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.85;

    const ix = A.lx * rx * 0.2;
    const iy = A.ly * ry * 0.2;

    switch (m) {
      case 'MINING':
        if (side < 0) {
          // Left Eye: Double Concentric Ring
          ctx.beginPath();
          ctx.arc(ix, iy, rx * 0.42, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          // Right Eye: Pickaxe (Laser-cut silhouette)
          ctx.save();
          ctx.translate(ix, iy);
          ctx.rotate(Math.PI * 0.25);
          // Pickaxe head arc
          ctx.lineWidth = rx * 0.12;
          ctx.beginPath();
          ctx.arc(0, -rx * 0.2, rx * 0.38, Math.PI * 0.2, Math.PI * 0.8);
          ctx.stroke();
          // Pickaxe handle
          ctx.lineWidth = rx * 0.09;
          ctx.beginPath();
          ctx.moveTo(0, -rx * 0.2);
          ctx.lineTo(0, rx * 0.42);
          ctx.stroke();
          ctx.restore();
        }
        break;

      case 'GOLD':
        // Dual glowing gold rings
        ctx.beginPath();
        ctx.arc(ix, iy, rx * 0.46, 0, Math.PI * 2);
        ctx.stroke();
        break;

      case 'CREATIVE':
        // Paintbrush in both eyes
        ctx.save();
        ctx.translate(ix, iy);
        ctx.rotate(side * -0.4);
        ctx.lineWidth = rx * 0.08;
        // Brush handle
        ctx.beginPath();
        ctx.moveTo(0, rx * 0.45);
        ctx.lineTo(0, -rx * 0.1);
        ctx.stroke();
        // Brush bristle tip
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.moveTo(-rx * 0.12, -rx * 0.1);
        ctx.lineTo(rx * 0.12, -rx * 0.1);
        ctx.lineTo(0, -rx * 0.42);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;

      case 'ANALYTICAL':
        if (side < 0) {
          // Left Eye: Target concentric ring
          ctx.beginPath();
          ctx.arc(ix, iy, rx * 0.45, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          // Right Eye: Magnifying glass / Precision scanner
          ctx.save();
          ctx.translate(ix, iy);
          ctx.beginPath();
          ctx.arc(-rx * 0.08, -ry * 0.08, rx * 0.28, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(rx * 0.12, ry * 0.12);
          ctx.lineTo(rx * 0.38, ry * 0.38);
          ctx.stroke();
          ctx.restore();
        }
        break;

      case 'STRATEGIC':
        if (side < 0) {
          // Left Eye: Knight Chess Piece (♞)
          ctx.font = `bold ${Math.round(rx * 0.82)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('♞', ix, iy);
        } else {
          // Right Eye: Rook Chess Piece (♜)
          ctx.font = `bold ${Math.round(rx * 0.82)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('♜', ix, iy);
        }
        break;

      case 'GUARDIAN':
        // Heraldic knight shield in both eyes
        ctx.save();
        ctx.translate(ix, iy);
        ctx.beginPath();
        ctx.moveTo(-rx * 0.28, -ry * 0.32);
        ctx.lineTo(rx * 0.28, -ry * 0.32);
        ctx.lineTo(rx * 0.28, 0);
        ctx.quadraticCurveTo(rx * 0.25, ry * 0.36, 0, ry * 0.44);
        ctx.quadraticCurveTo(-rx * 0.25, ry * 0.36, -rx * 0.28, 0);
        ctx.closePath();
        ctx.stroke();
        // Shield vertical divider
        ctx.beginPath();
        ctx.moveTo(0, -ry * 0.32);
        ctx.lineTo(0, ry * 0.42);
        ctx.stroke();
        ctx.restore();
        break;

      case 'EXPLORER':
        if (side < 0) {
          // Left Eye: Compass with needle
          ctx.save();
          ctx.translate(ix, iy);
          ctx.beginPath();
          ctx.arc(0, 0, rx * 0.42, 0, Math.PI * 2);
          ctx.stroke();
          // Needle
          ctx.rotate(t * 0.8);
          ctx.beginPath();
          ctx.moveTo(0, -rx * 0.38);
          ctx.lineTo(rx * 0.1, 0);
          ctx.lineTo(0, rx * 0.38);
          ctx.lineTo(-rx * 0.1, 0);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        } else {
          // Right Eye: 8-point nautical windrose star
          ctx.save();
          ctx.translate(ix, iy);
          ctx.rotate(t * 0.3);
          for (let i = 0; i < 4; i++) {
            ctx.rotate(Math.PI / 4);
            ctx.beginPath();
            ctx.moveTo(0, -rx * 0.42);
            ctx.lineTo(0, rx * 0.42);
            ctx.stroke();
          }
          ctx.restore();
        }
        break;

      default:
        // Standard Pupil
        ctx.beginPath();
        ctx.arc(ix, iy, rx * A.dilate * A.breath, 0, Math.PI * 2);
        ctx.fill();
        break;
    }

    ctx.restore();
  }

  // Draw LOOI Red Cyberpunk Sunglasses (Photo 2)
  function drawLooiVisor(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    baseR: number,
    eyeSpacing: number,
    dropProgress: number,
    t: number
  ) {
    ctx.save();
    // Drop down from forehead
    const startY = cy - baseR * 2.2;
    const finalY = cy - baseR * 0.15;
    const curY = lerp(startY, finalY, dropProgress);

    ctx.translate(cx, curY);

    const visorW = eyeSpacing * 2.2 + baseR * 1.5;
    const visorH = baseR * 1.25;

    // Glowing red drop shadow
    ctx.shadowColor = '#FF2A4D';
    ctx.shadowBlur = 28;

    // Outer Futuristic Red Bezel Frame
    ctx.fillStyle = '#CC0D28';
    ctx.strokeStyle = '#FF3B5C';
    ctx.lineWidth = baseR * 0.08;
    ctx.lineJoin = 'miter';

    ctx.beginPath();
    // Modern angular shape like LOOI Photo 2
    ctx.moveTo(-visorW * 0.5, -visorH * 0.4);
    ctx.lineTo(-visorW * 0.15, -visorH * 0.55);
    ctx.lineTo(0, -visorH * 0.38); // bridge dip
    ctx.lineTo(visorW * 0.15, -visorH * 0.55);
    ctx.lineTo(visorW * 0.5, -visorH * 0.4);
    ctx.lineTo(visorW * 0.44, visorH * 0.5);
    ctx.lineTo(0, visorH * 0.3); // bottom center
    ctx.lineTo(-visorW * 0.44, visorH * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Dark Tinted Lens Cutout
    ctx.fillStyle = 'rgba(15, 0, 3, 0.78)';
    ctx.beginPath();
    ctx.moveTo(-visorW * 0.45, -visorH * 0.3);
    ctx.lineTo(-visorW * 0.12, -visorH * 0.45);
    ctx.lineTo(-visorW * 0.02, -visorH * 0.28);
    ctx.lineTo(-visorW * 0.02, visorH * 0.22);
    ctx.lineTo(-visorW * 0.38, visorH * 0.4);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(visorW * 0.45, -visorH * 0.3);
    ctx.lineTo(visorW * 0.12, -visorH * 0.45);
    ctx.lineTo(visorW * 0.02, -visorH * 0.28);
    ctx.lineTo(visorW * 0.02, visorH * 0.22);
    ctx.lineTo(visorW * 0.38, visorH * 0.4);
    ctx.closePath();
    ctx.fill();

    // Star Catchlight Sparkle on Right Lens (Exact from LOOI Photo 2!)
    const starX = visorW * 0.36;
    const starY = -visorH * 0.08;
    const starR = baseR * 0.25 * (0.85 + 0.15 * Math.sin(t * 5));

    ctx.save();
    ctx.translate(starX, starY);
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = '#FFFFFF';
    ctx.shadowBlur = 18;

    // 4-point glittering star
    ctx.beginPath();
    ctx.moveTo(0, -starR);
    ctx.quadraticCurveTo(0, 0, starR, 0);
    ctx.quadraticCurveTo(0, 0, 0, starR);
    ctx.quadraticCurveTo(0, 0, -starR, 0);
    ctx.quadraticCurveTo(0, 0, 0, -starR);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  // Draw Mode Crowns / Emblems (Exact to Photo 3 Tablets)
  function drawModeCrown(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    R: number,
    m: Mode,
    theme: ReturnType<typeof getThemeColors>,
    t: number,
    A: AnimationEngineState
  ) {
    ctx.save();
    ctx.translate(cx, cy);

    ctx.strokeStyle = theme.primary;
    ctx.fillStyle = theme.primary;
    ctx.lineWidth = R * 0.06;
    ctx.shadowColor = theme.glow;
    ctx.shadowBlur = 20;

    switch (m) {
      case 'MINING': {
        // Rotating Mechanical Gear on forehead
        ctx.save();
        ctx.rotate(t * 1.5);
        const gearR = R * 0.48;
        const teeth = 10;
        ctx.beginPath();
        for (let i = 0; i < teeth * 2; i++) {
          const angle = (i * Math.PI) / teeth;
          const r = i % 2 === 0 ? gearR : gearR * 0.76;
          const gx = Math.cos(angle) * r;
          const gy = Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(gx, gy);
          else ctx.lineTo(gx, gy);
        }
        ctx.closePath();
        ctx.stroke();
        // Inner bore
        ctx.beginPath();
        ctx.arc(0, 0, gearR * 0.32, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        break;
      }

      case 'GOLD': {
        // 3D Gold Ingot on forehead (Image 3)
        ctx.save();
        const ingotW = R * 0.85;
        const ingotH = R * 0.38;

        // Ingot Top Face (bright metallic gold)
        const topGrad = ctx.createLinearGradient(-ingotW * 0.4, -ingotH, ingotW * 0.4, 0);
        topGrad.addColorStop(0, '#FFF6A3');
        topGrad.addColorStop(0.5, '#F5C542');
        topGrad.addColorStop(1, '#D99B00');
        ctx.fillStyle = topGrad;

        ctx.beginPath();
        ctx.moveTo(-ingotW * 0.38, -ingotH * 0.8);
        ctx.lineTo(ingotW * 0.38, -ingotH * 0.8);
        ctx.lineTo(ingotW * 0.5, 0);
        ctx.lineTo(-ingotW * 0.5, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Ingot Front Face
        const frontGrad = ctx.createLinearGradient(0, 0, 0, ingotH);
        frontGrad.addColorStop(0, '#F5C542');
        frontGrad.addColorStop(1, '#875C00');
        ctx.fillStyle = frontGrad;

        ctx.beginPath();
        ctx.moveTo(-ingotW * 0.5, 0);
        ctx.lineTo(ingotW * 0.5, 0);
        ctx.lineTo(ingotW * 0.42, ingotH * 0.65);
        ctx.lineTo(-ingotW * 0.42, ingotH * 0.65);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Gold Shimmer Glint
        const glintX = Math.sin(t * 3) * (ingotW * 0.28);
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(glintX, -ingotH * 0.4, R * 0.08, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
        break;
      }

      case 'CREATIVE': {
        // Glowing Lightbulb with internal filament and radiation sparks
        const bulbR = R * 0.38;
        ctx.beginPath();
        ctx.arc(0, -bulbR * 0.3, bulbR, Math.PI * 0.75, Math.PI * 2.25);
        ctx.lineTo(bulbR * 0.4, bulbR * 0.75);
        ctx.lineTo(-bulbR * 0.4, bulbR * 0.75);
        ctx.closePath();
        ctx.stroke();

        // Screw base
        ctx.beginPath();
        ctx.moveTo(-bulbR * 0.3, bulbR * 0.95);
        ctx.lineTo(bulbR * 0.3, bulbR * 0.95);
        ctx.moveTo(-bulbR * 0.2, bulbR * 1.15);
        ctx.lineTo(bulbR * 0.2, bulbR * 1.15);
        ctx.stroke();

        // Filament
        ctx.lineWidth = R * 0.04;
        ctx.beginPath();
        ctx.moveTo(-bulbR * 0.2, bulbR * 0.5);
        ctx.lineTo(0, -bulbR * 0.3);
        ctx.lineTo(bulbR * 0.2, bulbR * 0.5);
        ctx.stroke();

        // Radiating light rays
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI * 0.8 + (i * Math.PI * 0.6) / 4;
          const r1 = bulbR * 1.35;
          const r2 = bulbR * 1.75 + Math.sin(t * 6 + i) * (bulbR * 0.25);
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r1, -bulbR * 0.3 + Math.sin(a) * r1);
          ctx.lineTo(Math.cos(a) * r2, -bulbR * 0.3 + Math.sin(a) * r2);
          ctx.stroke();
        }
        break;
      }

      case 'ANALYTICAL': {
        // Telemetry Crown: Connected nodes and peak graph
        const pts = [
          { x: -R * 0.65, y: R * 0.2 },
          { x: -R * 0.35, y: -R * 0.4 },
          { x: 0, y: -R * 0.1 },
          { x: R * 0.35, y: -R * 0.55 },
          { x: R * 0.65, y: R * 0.1 },
        ];
        ctx.beginPath();
        pts.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();

        // Nodes
        pts.forEach((p, i) => {
          ctx.fillStyle = i === 3 ? '#00FFA3' : theme.primary;
          ctx.beginPath();
          ctx.arc(p.x, p.y, R * 0.08, 0, Math.PI * 2);
          ctx.fill();
        });
        break;
      }

      case 'STRATEGIC': {
        // Tactical Crown with tactical directional vectors
        ctx.beginPath();
        ctx.moveTo(-R * 0.6, R * 0.15);
        ctx.lineTo(-R * 0.4, -R * 0.45);
        ctx.lineTo(0, -R * 0.15);
        ctx.lineTo(R * 0.4, -R * 0.45);
        ctx.lineTo(R * 0.6, R * 0.15);
        ctx.closePath();
        ctx.stroke();

        // Central strategic diamond
        ctx.fillStyle = theme.primary;
        ctx.beginPath();
        ctx.moveTo(0, -R * 0.5);
        ctx.lineTo(R * 0.1, -R * 0.35);
        ctx.lineTo(0, -R * 0.2);
        ctx.lineTo(-R * 0.1, -R * 0.35);
        ctx.closePath();
        ctx.fill();
        break;
      }

      case 'GUARDIAN': {
        // Fortress Battlement Crown with locks
        const cw = R * 0.85;
        const ch = R * 0.42;
        ctx.beginPath();
        ctx.moveTo(-cw * 0.5, ch * 0.5);
        ctx.lineTo(-cw * 0.5, -ch * 0.5);
        ctx.lineTo(-cw * 0.25, -ch * 0.5);
        ctx.lineTo(-cw * 0.25, -ch * 0.15);
        ctx.lineTo(-cw * 0.08, -ch * 0.15);
        ctx.lineTo(-cw * 0.08, -ch * 0.5);
        ctx.lineTo(cw * 0.08, -ch * 0.5);
        ctx.lineTo(cw * 0.08, -ch * 0.15);
        ctx.lineTo(cw * 0.25, -ch * 0.15);
        ctx.lineTo(cw * 0.25, -ch * 0.5);
        ctx.lineTo(cw * 0.5, -ch * 0.5);
        ctx.lineTo(cw * 0.5, ch * 0.5);
        ctx.closePath();
        ctx.stroke();

        // Peripheral Floating Padlocks
        const drawLock = (px: number, py: number) => {
          ctx.save();
          ctx.translate(px, py);
          ctx.beginPath();
          ctx.arc(0, -R * 0.1, R * 0.08, Math.PI, 0);
          ctx.stroke();
          ctx.fillRect(-R * 0.1, -R * 0.02, R * 0.2, R * 0.16);
          ctx.restore();
        };
        drawLock(-R * 0.88, -R * 0.15 + Math.sin(t * 2) * 5);
        drawLock(R * 0.88, -R * 0.25 + Math.cos(t * 2.2) * 5);
        break;
      }

      case 'EXPLORER': {
        // Astrological Telescope angled to the upper right
        ctx.save();
        ctx.rotate(-Math.PI * 0.18);
        ctx.beginPath();
        // Main barrel
        ctx.rect(-R * 0.14, -R * 0.65, R * 0.28, R * 0.8);
        ctx.stroke();
        // Front lens hood
        ctx.beginPath();
        ctx.rect(-R * 0.2, -R * 0.82, R * 0.4, R * 0.18);
        ctx.stroke();
        // Eyepiece
        ctx.beginPath();
        ctx.rect(-R * 0.09, R * 0.15, R * 0.18, R * 0.18);
        ctx.stroke();
        ctx.restore();
        break;
      }
    }

    ctx.restore();
  }

  // Draw Cybernetic Reactive Mouth
  function drawCyberMouth(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    baseR: number,
    color: string,
    S: typeof stateRef.current,
    A: AnimationEngineState
  ) {
    ctx.save();
    ctx.translate(cx, cy);

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = baseR * 0.06;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;

    const mw = baseR * 0.85;

    if (S.mode === 'CREATIVE') {
      // Wavy whimsical mouth (from Tablet Image 3)
      ctx.beginPath();
      for (let x = -mw * 0.5; x <= mw * 0.5; x += 4) {
        const wave = Math.sin(x * 0.12 + S.t * 6) * (baseR * 0.12);
        if (x === -mw * 0.5) ctx.moveTo(x, wave);
        else ctx.lineTo(x, wave);
      }
      ctx.stroke();
    } else if (S.mode === 'EXPLORER') {
      // Inverted crescent curve (from Tablet Image 3)
      ctx.beginPath();
      ctx.arc(0, baseR * 0.45, mw * 0.5, Math.PI * 1.25, Math.PI * 1.75);
      ctx.stroke();
    } else if (S.face === 'SPEAKING') {
      // Viseme talking modulation
      const visemeH = baseR * (0.15 + 0.3 * Math.abs(Math.sin(S.t * 14)));
      ctx.beginPath();
      ctx.ellipse(0, 0, mw * 0.42, visemeH, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (S.mode === 'GOLD' || S.face === 'HAPPY' || S.face === 'PURR') {
      // Warm welcoming smile
      ctx.beginPath();
      ctx.arc(0, -baseR * 0.25, mw * 0.5, Math.PI * 0.22, Math.PI * 0.78);
      ctx.stroke();
    } else {
      // Resolute board horizontal line
      ctx.beginPath();
      ctx.moveTo(-mw * 0.45, 0);
      ctx.lineTo(mw * 0.45, 0);
      ctx.stroke();
    }

    ctx.restore();
  }

  // Draw Mode Floating Atmospheric Particles
  function drawModeEnvironment(
    ctx: CanvasRenderingContext2D,
    R: number,
    m: Mode,
    theme: ReturnType<typeof getThemeColors>,
    t: number
  ) {
    ctx.save();
    if (m === 'CREATIVE') {
      // Color paint specks floating around
      const colors = ['#05E1FF', '#FF3BB0', '#FFD800', '#00FFA3'];
      for (let i = 0; i < 14; i++) {
        const a = t * 0.4 + i * 0.75;
        const r = R * (1.9 + (i % 3) * 0.3);
        const px = Math.cos(a) * r * 1.35;
        const py = Math.sin(a * 0.8) * r * 0.65;
        ctx.fillStyle = colors[i % colors.length];
        ctx.globalAlpha = 0.55 + 0.35 * Math.sin(t * 3 + i);
        ctx.beginPath();
        ctx.arc(px, py, R * 0.045, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (m === 'GOLD') {
      // Golden 4-point twinkling stars
      ctx.fillStyle = '#FFE58F';
      ctx.shadowColor = '#F5C542';
      ctx.shadowBlur = 10;
      for (let i = 0; i < 9; i++) {
        const a = t * 0.3 + i * 1.1;
        const r = R * (1.85 + (i % 4) * 0.25);
        const px = Math.cos(a) * r * 1.4;
        const py = Math.sin(a) * r * 0.7;
        const sr = R * 0.07 * (0.5 + 0.5 * Math.abs(Math.sin(t * 2 + i)));

        ctx.save();
        ctx.translate(px, py);
        ctx.beginPath();
        ctx.moveTo(0, -sr);
        ctx.lineTo(sr * 0.25, -sr * 0.25);
        ctx.lineTo(sr, 0);
        ctx.lineTo(sr * 0.25, sr * 0.25);
        ctx.lineTo(0, sr);
        ctx.lineTo(-sr * 0.25, sr * 0.25);
        ctx.lineTo(-sr, 0);
        ctx.lineTo(-sr * 0.25, -sr * 0.25);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  // 6. Draw Combat Blaster Turrets (Dual Retractable Mecha Cannons)
  function drawCombatBlasterTurrets(
    ctx: CanvasRenderingContext2D,
    baseR: number,
    eyeSpacing: number,
    combat: typeof combatRef.current,
    t: number
  ) {
    const lvl = combat.level;
    if (lvl <= 0.005) return;

    const turretDistance = eyeSpacing + baseR * (0.85 + lvl * 0.65);

    // Left Blaster Cannon
    drawSingleBlasterTurret(ctx, -turretDistance, 0, -1, lvl, t, combat);
    // Right Blaster Cannon
    drawSingleBlasterTurret(ctx, turretDistance, 0, 1, lvl, t, combat);
  }

  function drawSingleBlasterTurret(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    side: number,
    level: number,
    t: number,
    combat: typeof combatRef.current
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(side, 1);

    // Mechanical mounting arm connecting from head
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-35 * (1 - level), 0);
    ctx.lineTo(20, 0);
    ctx.stroke();

    // Hydraulic piston detail
    ctx.strokeStyle = '#05E1FF';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-15 * (1 - level), -5);
    ctx.lineTo(15, -5);
    ctx.stroke();

    // Heavy Armor Housing
    ctx.fillStyle = '#0F172A';
    ctx.strokeStyle = '#EF4444';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#EF4444';
    ctx.shadowBlur = 10 * level;

    ctx.beginPath();
    ctx.roundRect(-22, -26, 44, 52, [8, 14, 14, 8]);
    ctx.fill();
    ctx.stroke();

    // Warning hazard stripes / glowing red energy chamber
    ctx.fillStyle = '#FF1133';
    ctx.shadowColor = '#FF1133';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.roundRect(-10, -16, 20, 32, 4);
    ctx.fill();

    // Energy core pulsing
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0, 0, 4 + Math.sin(t * 16) * 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Twin Plasma Barrels extending forward
    const firingThisSide = combat.shotsRemaining > 0 && ((side < 0 && combat.shotsRemaining % 2 === 0) || (side > 0 && combat.shotsRemaining % 2 !== 0));
    const recoil = firingThisSide ? -8 : 0;

    ctx.fillStyle = '#334155';
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 1.5;

    // Upper barrel
    ctx.beginPath();
    ctx.roundRect(16 + recoil, -18, 28, 9, 3);
    ctx.fill();
    ctx.stroke();

    // Lower barrel
    ctx.beginPath();
    ctx.roundRect(16 + recoil, 9, 28, 9, 3);
    ctx.fill();
    ctx.stroke();

    // Barrel interior plasma glow
    ctx.fillStyle = '#FF1133';
    ctx.fillRect(40 + recoil, -16, 5, 5);
    ctx.fillRect(40 + recoil, 11, 5, 5);

    // Muzzle flash when firing
    if (firingThisSide) {
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = '#FF4400';
      ctx.shadowBlur = 30;
      ctx.beginPath();
      ctx.arc(50 + recoil, -14, 14, 0, Math.PI * 2);
      ctx.arc(50 + recoil, 13, 14, 0, Math.PI * 2);
      ctx.fill();

      // Muzzle spark spikes
      ctx.strokeStyle = '#FFAA00';
      ctx.lineWidth = 2;
      for (let s = 0; s < 5; s++) {
        const a = (s / 5) * Math.PI * 2 + t * 20;
        ctx.beginPath();
        ctx.moveTo(50 + recoil, -14);
        ctx.lineTo(50 + recoil + Math.cos(a) * 25, -14 + Math.sin(a) * 25);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  // 7. Draw Holographic Drink Cup (Refreshing Soda / Water)
  function drawHolographicDrinkCup(
    ctx: CanvasRenderingContext2D,
    baseR: number,
    eyeSpacing: number,
    progress: number,
    t: number
  ) {
    if (progress <= 0.005) return;

    ctx.save();
    // Position on lower right near mouth
    const cupX = eyeSpacing * 0.98;
    const cupY = baseR * 0.95 + (1 - progress) * 80;
    ctx.translate(cupX, cupY);
    ctx.globalAlpha = Math.min(1, progress * 1.2);

    // Holographic Cup Body (Tapered tumbler glass)
    ctx.strokeStyle = '#05E1FF';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#05E1FF';
    ctx.shadowBlur = 18;

    // Glass Tumbler
    ctx.beginPath();
    ctx.moveTo(-22, -35);
    ctx.lineTo(22, -35);
    ctx.lineTo(16, 42);
    ctx.quadraticCurveTo(0, 48, -16, 42);
    ctx.closePath();

    // Liquid fill (sparkling cyan/blue soda)
    const liquidGrad = ctx.createLinearGradient(0, -25, 0, 42);
    liquidGrad.addColorStop(0, 'rgba(5, 225, 255, 0.45)');
    liquidGrad.addColorStop(0.5, 'rgba(0, 180, 255, 0.65)');
    liquidGrad.addColorStop(1, 'rgba(0, 100, 220, 0.85)');
    ctx.fillStyle = liquidGrad;
    ctx.fill();
    ctx.stroke();

    // Liquid surface meniscus wave
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.ellipse(0, -22 + Math.sin(t * 4) * 2, 18, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 3 Floating 3D-styled Ice Cubes
    for (let c = 0; c < 3; c++) {
      const ix = -10 + c * 10 + Math.sin(t * 2 + c) * 3;
      const iy = -12 + (c % 2) * 16 + Math.cos(t * 3 + c) * 2;
      ctx.save();
      ctx.translate(ix, iy);
      ctx.rotate(0.2 * (c + 1) + Math.sin(t * 2) * 0.1);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1;
      ctx.strokeRect(-6, -6, 12, 12);
      ctx.fillRect(-6, -6, 12, 12);
      ctx.restore();
    }

    // Carbonated fizzy rising bubbles
    for (let b = 0; b < 7; b++) {
      const by = 35 - ((t * 25 + b * 14) % 65);
      const bx = Math.sin(b * 3 + t * 4) * 12;
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = '#05E1FF';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(bx, by, 1.8 + (b % 3) * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Glowing Neon Straw curving directly toward Ultron's mouth
    ctx.strokeStyle = '#FF3BB0';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#FF3BB0';
    ctx.shadowBlur = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(4, 30);
    ctx.lineTo(12, -35);
    // Bend toward mouth (to the left)
    ctx.quadraticCurveTo(15, -55, -25, -52);
    ctx.stroke();

    // Inner bright core of straw
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // "ELECTRO-DRINK" hologram label badge
    ctx.fillStyle = '#05E1FF';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('REFRESH · 100%', 0, 24);

    ctx.restore();
  }

  // 8. Draw Cute Cyber-Robotic Waving Hand
  function drawCyberWavingHand(
    ctx: CanvasRenderingContext2D,
    baseR: number,
    eyeSpacing: number,
    progress: number,
    t: number
  ) {
    if (progress <= 0.005) return;

    ctx.save();
    // Position on right side of face
    const handX = eyeSpacing * 1.38;
    const handY = -baseR * 0.15 + (1 - progress) * 60;
    ctx.translate(handX, handY);
    ctx.globalAlpha = Math.min(1, progress * 1.2);

    // Oscillation for wave gesture (back and forth)
    const waveAngle = Math.sin(t * 8) * 0.38;
    ctx.rotate(waveAngle);

    // Sleek robotic arm link
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(35, 45);
    ctx.lineTo(0, 15);
    ctx.stroke();

    // Glowing cyan cyber conduit
    ctx.strokeStyle = '#05E1FF';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(30, 42);
    ctx.lineTo(0, 15);
    ctx.stroke();

    // Palm base plate
    ctx.fillStyle = '#0F172A';
    ctx.strokeStyle = '#05E1FF';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#05E1FF';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.roundRect(-14, -10, 28, 26, 8);
    ctx.fill();
    ctx.stroke();

    // Center repulsor palm beacon (pulsing friendly greeting light)
    ctx.fillStyle = '#05E1FF';
    ctx.beginPath();
    ctx.arc(0, 3, 5 + Math.sin(t * 10) * 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0, 3, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 4 Articulated fingers waving
    const fingerHeights = [18, 22, 21, 16];
    const fingerXs = [-9, -3, 3, 9];

    for (let f = 0; f < 4; f++) {
      const fx = fingerXs[f];
      const fh = fingerHeights[f];
      const fBend = Math.sin(t * 8 + f * 0.4) * 3;

      ctx.save();
      ctx.translate(fx, -10);
      ctx.fillStyle = '#0F172A';
      ctx.strokeStyle = '#05E1FF';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(-2.5, -fh + fBend, 5, fh, 3);
      ctx.fill();
      ctx.stroke();

      // Finger tip LED node
      ctx.fillStyle = '#00FFA3';
      ctx.beginPath();
      ctx.arc(0, -fh + fBend + 2.5, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Thumb pointing outward
    ctx.save();
    ctx.translate(14, 0);
    ctx.rotate(0.5);
    ctx.fillStyle = '#0F172A';
    ctx.strokeStyle = '#05E1FF';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-2.5, -12, 5, 12, 3);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Radiating friendly greeting sparkle stars around hand
    for (let s = 0; s < 4; s++) {
      const sa = t * 3 + s * 1.57;
      const sr = 24 + Math.sin(t * 4 + s) * 6;
      ctx.fillStyle = '#05E1FF';
      ctx.shadowColor = '#05E1FF';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(Math.cos(sa) * sr, Math.sin(sa) * sr - 10, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // 9. Draw Laser Bolts and Glass Impact Fractures across Full Screen
  function drawLaserBoltsAndImpacts(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    combat: typeof combatRef.current
  ) {
    ctx.save();

    // Laser Beams
    for (const l of combat.lasers) {
      const dx = l.targetX - l.startX;
      const dy = l.targetY - l.startY;
      const angle = Math.atan2(dy, dx);
      const len = 42;

      ctx.save();
      ctx.translate(l.currentX, l.currentY);
      ctx.rotate(angle);

      // Outer plasma trail
      ctx.strokeStyle = '#FF1133';
      ctx.lineWidth = 6;
      ctx.shadowColor = '#FF0033';
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.lineTo(0, 0);
      ctx.stroke();

      // White hot core
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#FFFFFF';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(-len * 0.7, 0);
      ctx.lineTo(0, 0);
      ctx.stroke();

      ctx.restore();
    }

    // Impact Craters on the Screen Glass
    for (const imp of combat.impacts) {
      ctx.save();
      ctx.translate(imp.x, imp.y);
      ctx.globalAlpha = Math.min(1, imp.alpha);

      // Red thermal burn glow
      const burnGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, imp.radius);
      burnGrad.addColorStop(0, 'rgba(255, 50, 50, 0.85)');
      burnGrad.addColorStop(0.4, 'rgba(255, 0, 0, 0.45)');
      burnGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = burnGrad;
      ctx.beginPath();
      ctx.arc(0, 0, imp.radius, 0, Math.PI * 2);
      ctx.fill();

      // Shattered Glass Radial Fracture Spikes
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.6;
      ctx.shadowColor = '#FF3366';
      ctx.shadowBlur = 8;

      for (let r = 0; r < 7; r++) {
        const a = imp.angle + (r / 7) * Math.PI * 2;
        const rad = imp.radius * (0.8 + (r % 3) * 0.35);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * rad * 0.5, Math.sin(a) * rad * 0.5);
        ctx.lineTo(Math.cos(a + 0.15) * rad, Math.sin(a + 0.15) * rad);
        ctx.stroke();
      }

      // Concentric fracture ring
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, imp.radius * 0.45, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }

    ctx.restore();
  }

  // 10. Draw Optical Camera Viewfinder & White Shutter Flash
  function drawCameraViewfinderAndFlash(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    flashAlpha: number,
    isViewfinderActive: boolean
  ) {
    ctx.save();

    // Camera viewfinder reticles if active
    if (isViewfinderActive) {
      const marginX = W * 0.08;
      const marginY = H * 0.08;
      const bracketLen = Math.min(W, H) * 0.08;

      ctx.strokeStyle = '#05E1FF';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#05E1FF';
      ctx.shadowBlur = 12;

      // Top-Left bracket
      ctx.beginPath();
      ctx.moveTo(marginX + bracketLen, marginY);
      ctx.lineTo(marginX, marginY);
      ctx.lineTo(marginX, marginY + bracketLen);
      ctx.stroke();

      // Top-Right bracket
      ctx.beginPath();
      ctx.moveTo(W - marginX - bracketLen, marginY);
      ctx.lineTo(W - marginX, marginY);
      ctx.lineTo(W - marginX, marginY + bracketLen);
      ctx.stroke();

      // Bottom-Left bracket
      ctx.beginPath();
      ctx.moveTo(marginX, H - marginY - bracketLen);
      ctx.lineTo(marginX, H - marginY);
      ctx.lineTo(marginX + bracketLen, H - marginY);
      ctx.stroke();

      // Bottom-Right bracket
      ctx.beginPath();
      ctx.moveTo(W - marginX - bracketLen, H - marginY);
      ctx.lineTo(W - marginX, H - marginY);
      ctx.lineTo(W - marginX, H - marginY - bracketLen);
      ctx.stroke();

      // Center auto-focus targeting box
      ctx.strokeStyle = 'rgba(5, 225, 255, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(W / 2 - 30, H / 2 - 30, 60, 60);

      // Center crosshair dot
      ctx.fillStyle = '#05E1FF';
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, 3, 0, Math.PI * 2);
      ctx.fill();

      // Telemetry OSD
      ctx.fillStyle = '#05E1FF';
      ctx.font = 'bold 11px monospace';
      ctx.fillText('AF-L · 4K UHD 60FPS · ISO 400 · 1/500s', marginX + 8, marginY + 24);

      // Flashing REC indicator
      ctx.fillStyle = '#FF1133';
      ctx.beginPath();
      ctx.arc(W - marginX - 45, marginY + 20, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 11px monospace';
      ctx.fillText('REC', W - marginX - 35, marginY + 24);
    }

    // Pure White Shutter Flash
    if (flashAlpha > 0.005) {
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, flashAlpha)})`;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.restore();
  }

  // Pointer & Tactile Gesture Handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ts = touchState.current;
    ts.startX = e.clientX;
    ts.startY = e.clientY;
    ts.downTime = performance.now();
    ts.movedDistance = 0;
    ts.touches = (e.pointerType === 'touch' ? 1 : 1);
    ts.strokePoints = [{ x: e.clientX, y: e.clientY, time: performance.now() }];

    stateRef.current.lastInteraction = performance.now();

    // Spawn energetic touch shockwave at contact point
    const theme = getThemeColors(stateRef.current.mode);
    addShockwave(e.clientX, e.clientY, theme.primary);
    playSfx('tap', soundFxEnabled);

    // Check if tapped directly on an eye for an interactive wink!
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left - rect.width / 2;
      const clickY = e.clientY - rect.top - rect.height / 2;
      const baseR = Math.min(rect.width * 0.115, rect.height * 0.22);
      const eyeSpacing = baseR * 1.58;

      const distLeftEye = Math.hypot(clickX - (-eyeSpacing), clickY);
      const distRightEye = Math.hypot(clickX - eyeSpacing, clickY);

      if (distLeftEye < baseR * 1.1) {
        // Tapped Left Eye -> Wink right, squish left
        animRef.current.blinkL = 0.05;
        animRef.current.jiggle = 1.2;
        playSfx('wink', soundFxEnabled);
        return;
      } else if (distRightEye < baseR * 1.1) {
        // Tapped Right Eye -> Wink left, squish right
        animRef.current.blinkR = 0.05;
        animRef.current.jiggle = 1.2;
        playSfx('wink', soundFxEnabled);
        return;
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    stateRef.current.lastInteraction = performance.now();
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width - 0.5;
    const relY = (e.clientY - rect.top) / rect.height - 0.5;

    // Magnetic eye attraction towards finger/mouse
    animRef.current.tx = relX * 1.4;
    animRef.current.ty = relY * 0.9;

    const ts = touchState.current;
    if (ts.downTime > 0) {
      ts.movedDistance += Math.hypot(e.clientX - ts.startX, e.clientY - ts.startY);
      ts.strokePoints.push({ x: e.clientX, y: e.clientY, time: performance.now() });

      // Cheek Rubbing / Petting Interaction (Tickle & Purr)
      if (ts.strokePoints.length > 8) {
        const recent = ts.strokePoints.slice(-6);
        const dist = Math.hypot(
          recent[recent.length - 1].x - recent[0].x,
          recent[recent.length - 1].y - recent[0].y
        );

        // If gentle circular rubbing on lower half of screen (cheeks)
        if (dist > 30 && relY > 0) {
          animRef.current.tickle = Math.min(1, animRef.current.tickle + 0.1);
          if (animRef.current.tickle > 0.4 && stateRef.current.face !== 'PURR') {
            onFaceChange('PURR', 2200);
            playSfx('purr', soundFxEnabled);
            animRef.current.bounce = 0.3;
          }
        }
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ts = touchState.current;
    const holdDuration = performance.now() - ts.downTime;
    const deltaX = e.clientX - ts.startX;
    const deltaY = e.clientY - ts.startY;
    ts.downTime = 0;

    // Tap outside open panels closes them if slight movement
    if (ts.movedDistance < 24) {
      onCloseOverlays();
    }

    // Swipe Up -> Open Dock
    if (ts.movedDistance > 70 && Math.abs(deltaY) > Math.abs(deltaX) && deltaY < -40) {
      onSwipeUp();
      playSfx('mode', soundFxEnabled);
      return;
    }

    // Swipe Down -> Open Settings
    if (ts.movedDistance > 70 && Math.abs(deltaY) > Math.abs(deltaX) && deltaY > 40) {
      onSwipeDown();
      playSfx('mode', soundFxEnabled);
      return;
    }

    // Swipe Horizontal -> Cycle Mode
    if (ts.movedDistance > 70 && Math.abs(deltaX) > Math.abs(deltaY)) {
      const currentIndex = MODES.indexOf(stateRef.current.mode);
      const step = deltaX > 0 ? 1 : -1;
      const nextIndex = (currentIndex + step + MODES.length) % MODES.length;
      onModeChange(MODES[nextIndex]);
      playSfx('mode', soundFxEnabled);
      return;
    }

    // Long Press (> 650ms) -> Toggle Sleep / Wake
    if (holdDuration > 650) {
      if (stateRef.current.face === 'SLEEPING') {
        onWake();
      } else {
        onSleep();
      }
      return;
    }

    // Tap Sequences
    if (ts.movedDistance < 28) {
      handlePoke();
    }
  };

  const handlePoke = () => {
    const S = stateRef.current;
    if (S.face === 'SLEEPING') {
      onWake();
      return;
    }

    const now = performance.now();
    S.poke = now - S.lastPokeTime < 750 ? S.poke + 1 : 1;
    S.lastPokeTime = now;

    // Shake reaction
    animRef.current.jiggle = 1.0;

    if (S.poke === 1) {
      scheduleBlink('single');
      playSfx('tap', soundFxEnabled);
    } else if (S.poke === 2) {
      // 2 Taps -> Listen for voice order
      onTriggerVoice();
    } else if (S.poke === 3) {
      onFaceChange('STARTLE', 1400);
      onSpeak('¡Atención en el visor!');
      playSfx('warning', soundFxEnabled);
    } else if (S.poke === 4) {
      onFaceChange('ANGRY', 2400);
      onSpeak('Por favor, no golpees la pantalla.');
      playSfx('angry', soundFxEnabled);
    } else {
      // 5 or more taps: COMBAT BLASTER MODE TRIGGERED!
      triggerBlasterCombat();
    }
  };

  return (
    <canvas
      ref={canvasRef}
      id="ultron-face-canvas"
      className="absolute inset-0 w-full h-full cursor-crosshair touch-none select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        touchState.current.downTime = 0;
      }}
    />
  );
};
