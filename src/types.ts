/**
 * Tipos compartidos de la mesa web. La emoción vive en lib/emocion.ts (contrato con servidor y APK).
 */
export type Mode = 
  | 'GUARDIAN'
  | 'MINING'
  | 'GOLD'
  | 'CREATIVE'
  | 'ANALYTICAL'
  | 'STRATEGIC'
  | 'EXPLORER';

export type FaceState = 
  | 'IDLE'
  | 'LISTENING'
  | 'THINKING'
  | 'SPEAKING'
  | 'HAPPY'
  | 'CONCERNED'
  | 'ANGRY'
  | 'FURY'
  | 'SLEEPING'
  | 'STARTLE'
  | 'PURR'
  | 'WINK'
  | 'CURIOSITY'
  | 'JEDI'
  | 'LAUGH'
  | 'SURPRISED'
  | 'SAD'
  | 'TIRED'
  | 'SING'
  | 'PRAY';

export interface FaceTargets {
  dilate: number;
  brow: number;
  mouth: number;
  smile: number;
  bounce: number;
}

export interface TouchRipple {
  id: number;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  color: string;
}

export interface AnimationEngineState {
  blink: number;
  blinkL: number;
  blinkR: number;
  blinking: boolean;
  phase: number;
  next: number;
  double: boolean;
  wink: number;
  lx: number;
  ly: number;
  tx: number;
  ty: number;
  saccadeIn: number;
  dilate: number;
  dilateT: number;
  brow: number;
  browT: number;
  breath: number;
  bounce: number;
  squashX: number;
  squashY: number;
  shake: number;
  tilt: number;
  mouth: number;
  mouthT: number;
  smile: number;
  smileT: number;
  pulse: number;
  think: number;
  sleepZ: number;
  // LOOI Interactive Physics
  jiggle: number;
  tickle: number;
  visorDrop: number; // 0 (hidden) to 1 (fully worn)
  shockwaves: TouchRipple[];
}

// Captured Snapshot Photo
export interface CapturedPhoto {
  id: string;
  timestamp: string;
  dataUrl: string;
  mode: Mode;
  caption: string;
}

// Spatial & Object Vision Detection
export interface DetectedObject {
  id: string;
  label: 'PERSON' | 'DRINK_CUP' | 'WAVING_HAND' | 'DEVICE' | 'FACE';
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number }; // normalized 0-1
  spatialZone: 'LEFT' | 'CENTER' | 'RIGHT';
  distance: 'NEAR' | 'OPTIMAL' | 'FAR';
}

