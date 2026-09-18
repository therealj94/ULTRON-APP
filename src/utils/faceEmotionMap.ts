/**
 * Mapeo emoción ULTRON → FaceState existente en FaceCanvas.
 * No reescribe el canvas: reutiliza targets ya animados (ojos/corona/boca vía getTargetsFor).
 */
import type { FaceState } from '../types';

export type UltronEmotion =
  | 'NEUTRAL'
  | 'FELIZ'
  | 'EMOCIONADO'
  | 'CURIOSO'
  | 'PENSATIVO'
  | 'CONFUNDIDO'
  | 'FRUSTRADO'
  | 'ENOJADO'
  | 'TRISTE'
  | 'CANSADO'
  | 'ALERTA';

/**
 * Tabla pedida (ojos/corona/boca) → FaceState más cercano en el motor actual:
 * NEUTRAL→IDLE, FELIZ→HAPPY, EMOCIONADO→HAPPY+bounce, CURIOSO→CURIOSITY,
 * PENSATIVO→THINKING, CONFUNDIDO→CONFUSED, FRUSTRADO→CONCERNED,
 * ENOJADO→ANGRY, TRISTE→CONCERNED, CANSADO→YAWNING, ALERTA→STARTLE/FURY.
 */
export const EMOTION_FACE_MAP: Record<UltronEmotion, FaceState> = {
  NEUTRAL: 'IDLE',
  FELIZ: 'HAPPY',
  EMOCIONADO: 'HAPPY',
  CURIOSO: 'CURIOSITY',
  PENSATIVO: 'THINKING',
  CONFUNDIDO: 'CONFUSED',
  FRUSTRADO: 'CONCERNED',
  ENOJADO: 'ANGRY',
  TRISTE: 'CONCERNED',
  CANSADO: 'YAWNING',
  ALERTA: 'STARTLE',
};

export function emotionToFace(emotion: UltronEmotion): FaceState {
  return EMOTION_FACE_MAP[emotion] || 'IDLE';
}

/** Duración sugerida de la expresión facial (ms). */
export function emotionFaceDuration(emotion: UltronEmotion): number {
  switch (emotion) {
    case 'ALERTA':
    case 'ENOJADO':
      return 4500;
    case 'EMOCIONADO':
    case 'FELIZ':
      return 3500;
    case 'PENSATIVO':
    case 'CURIOSO':
      return 2800;
    case 'CANSADO':
      return 5000;
    default:
      return 2200;
  }
}
