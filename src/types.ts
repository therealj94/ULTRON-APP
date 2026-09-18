export type Mode = 
  | 'GUARDIAN'
  | 'MINING'
  | 'GOLD'
  | 'CREATIVE'
  | 'ANALYTICAL'
  | 'STRATEGIC'
  | 'EXPLORER'
  | 'CONOCER';

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
  | 'CONFUSED'
  | 'MUSIC'
  | 'OFFLINE'
  | 'SCAN'
  | 'YAWNING'
  | 'CURIOSITY';

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
  // Interactive Physics
  jiggle: number;
  tickle: number;
  visorDrop: number; // 0 (hidden) to 1 (fully worn)
  shockwaves: TouchRipple[];
  yawn: number; // 0..1 mouth open for idle yawn
  nextYawn: number; // seconds until next idle yawn
}

export interface AgenticHarnessState {
  modelName: string; // 'Qwen 2.5 / 3.8 27B'
  autoModeSwitch: boolean;
  currentIntent: string;
  detectedTopic: string;
  lastConfidence: number;
  activeTools: Array<{
    name: string;
    description: string;
    state: 'idle' | 'executing' | 'success';
  }>;
  chainOfThought: string;
  tokenSpeed: number;
}

export interface UltronSessionState {
  face: FaceState;
  prevFace: FaceState;
  mix: number;
  mode: Mode;
  t: number;
  poke: number;
  lp: number;
  li: number;
  energy: number;
  micEnabled: boolean;
  speakerEnabled: boolean;
  soundFxEnabled: boolean;
  visionEnabled: boolean;
  isKioskFrame: boolean;
  isBooting: boolean;
  permissions: {
    wa: boolean;
    em: boolean;
    cal: boolean;
  };
}

export interface BackendBridgeConfig {
  enabled: boolean;
  wsUrl: string;
  restUrl: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  log: Array<{
    timestamp: string;
    direction: 'in' | 'out';
    payload: string;
  }>;
}

export interface BoardPermissionRequest {
  id: string;
  serviceKey: 'wa' | 'em' | 'cal';
  title: string;
  description: string;
  payloadSummary: string;
}

// ElevenLabs Voice Integration
export interface ElevenLabsVoiceConfig {
  apiKey: string;
  voiceId: string;
  name: string;
  category: string;
  description: string;
  stability: number;
  similarityBoost: number;
  pitch: number;
  rate: number;
}

// Captured Snapshot Photo
export interface CapturedPhoto {
  id: string;
  timestamp: string;
  dataUrl: string;
  mode: Mode;
  caption: string;
}

// Biometric Auth State
export interface BiometricAuthState {
  isScanning: boolean;
  progress: number; // 0 to 100
  status: 'idle' | 'scanning' | 'granted' | 'denied';
  userName?: string;
  role?: string;
  clearanceLevel?: string;
}

// Laser Blaster Combat State (When user taps repeatedly and Ultron gets angry)
export interface BlasterLaserBolt {
  id: number;
  side: 'left' | 'right';
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  progress: number; // 0 to 1
  color: string;
}

export interface BulletImpact {
  id: number;
  x: number;
  y: number;
  alpha: number;
  radius: number;
}

export interface CombatBlasterState {
  isActive: boolean;
  level: number; // 0 (normal) to 1 (full combat deploy)
  firing: boolean;
  shotsRemaining: number;
  lasers: BlasterLaserBolt[];
  impacts: BulletImpact[];
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

export interface SpatialTrackingData {
  userPresent: boolean;
  userPosition: { x: number; y: number; z: number }; // -1 to 1, z: 0 (near) to 1 (far)
  dominantDirection: 'LEFT' | 'CENTER' | 'RIGHT';
  objects: DetectedObject[];
}

