/**
 * Motor de emociones ULTRON FP.
 * Niveles 0–100, decaimiento a NEUTRAL, contagio desde el usuario,
 * afecta cara (FaceState) y voz (tono/velocidad/volumen → instruct TTS + Web Speech).
 */

import type { FaceState } from '../../types';
import { emotionToFace, type UltronEmotion } from '../../utils/faceEmotionMap';
import { pickPauseMs } from './personalidad';
import { pickExpression, inferExpressionContext } from './expressions';

export type { UltronEmotion };

export type EmotionLevels = Record<UltronEmotion, number>;

export type VoiceEmotionParams = {
  pitch: number;
  rate: number;
  volume: number;
  /** Overlay para Qwen3-TTS VoiceDesign instruct */
  instructAddon: string;
};

const ALL: UltronEmotion[] = [
  'NEUTRAL',
  'FELIZ',
  'EMOCIONADO',
  'CURIOSO',
  'PENSATIVO',
  'CONFUNDIDO',
  'FRUSTRADO',
  'ENOJADO',
  'TRISTE',
  'CANSADO',
  'ALERTA',
];

const VOICE: Record<UltronEmotion, VoiceEmotionParams> = {
  NEUTRAL: { pitch: 1, rate: 0.95, volume: 1, instructAddon: 'calm measured tone' },
  FELIZ: { pitch: 1.12, rate: 1.05, volume: 1.05, instructAddon: 'warm smiling slightly brighter tone, still calm' },
  EMOCIONADO: { pitch: 1.18, rate: 1.08, volume: 1.1, instructAddon: 'bright engaged enthusiasm without rushing' },
  CURIOSO: { pitch: 1.06, rate: 0.98, volume: 1, instructAddon: 'inquisitive slightly lifted tone' },
  PENSATIVO: { pitch: 0.95, rate: 0.88, volume: 0.95, instructAddon: 'soft thoughtful slower pace' },
  CONFUNDIDO: { pitch: 1.02, rate: 0.92, volume: 1, instructAddon: 'uncertain questioning cadence' },
  FRUSTRADO: { pitch: 0.9, rate: 1.02, volume: 1.05, instructAddon: 'tight restrained frustration, still polite' },
  ENOJADO: { pitch: 0.88, rate: 1.08, volume: 1.12, instructAddon: 'firm low stern tone, controlled anger' },
  TRISTE: { pitch: 0.85, rate: 0.85, volume: 0.88, instructAddon: 'soft lower quieter sad tone' },
  CANSADO: { pitch: 0.9, rate: 0.82, volume: 0.9, instructAddon: 'weary soft slower delivery' },
  ALERTA: { pitch: 1.15, rate: 1.12, volume: 1.15, instructAddon: 'urgent clear alert tone, still articulate' },
};

function emptyLevels(base = 0): EmotionLevels {
  return Object.fromEntries(ALL.map((e) => [e, e === 'NEUTRAL' ? 40 : base])) as EmotionLevels;
}

let levels: EmotionLevels = emptyLevels();
let interactionCount = 0;
let lastTick = Date.now();

function decay(): void {
  const now = Date.now();
  const dt = Math.min(60, (now - lastTick) / 1000);
  lastTick = now;
  for (const e of ALL) {
    if (e === 'NEUTRAL') {
      levels.NEUTRAL = Math.min(100, levels.NEUTRAL + dt * 2);
      continue;
    }
    levels[e] = Math.max(0, levels[e] - dt * 3.5);
  }
}

export function getDominantEmotion(): UltronEmotion {
  decay();
  let best: UltronEmotion = 'NEUTRAL';
  let score = levels.NEUTRAL;
  for (const e of ALL) {
    if (levels[e] > score) {
      score = levels[e];
      best = e;
    }
  }
  return best;
}

export function getEmotionSnapshot() {
  decay();
  const dominant = getDominantEmotion();
  return {
    dominant,
    levels: { ...levels },
    face: emotionToFace(dominant),
    voice: VOICE[dominant],
    interactionCount,
  };
}

export function boostEmotion(emotion: UltronEmotion, amount: number): void {
  decay();
  levels[emotion] = Math.min(100, (levels[emotion] || 0) + amount);
  if (emotion !== 'NEUTRAL') {
    levels.NEUTRAL = Math.max(0, levels.NEUTRAL - amount * 0.4);
  }
}

/** Contagio: señales del texto del usuario. */
export function contagionFromUserText(text: string): UltronEmotion | null {
  const q = text.toLowerCase();
  if (/urgente|peligro|alerta|ayuda|emergencia|ya\b/.test(q)) {
    boostEmotion('ALERTA', 35);
    return 'ALERTA';
  }
  if (/gracias|genial|excelente|felicidades|logr|éxito|bien hecho/.test(q)) {
    boostEmotion('EMOCIONADO', 28);
    boostEmotion('FELIZ', 18);
    return 'EMOCIONADO';
  }
  if (/jaja|jeje|gracioso|chiste|😂|🤣/.test(q)) {
    boostEmotion('FELIZ', 30);
    return 'FELIZ';
  }
  if (/estúpido|inútil|cállate|idiota|odio|maldit/.test(q)) {
    boostEmotion('ENOJADO', 40);
    boostEmotion('TRISTE', 15);
    return 'ENOJADO';
  }
  if (/mal|triste|perdón|regañ|enojad|molesto/.test(q)) {
    boostEmotion('TRISTE', 25);
    return 'TRISTE';
  }
  if (/no entiendo|qué\?|huh|confus|raro/.test(q)) {
    boostEmotion('CURIOSO', 22);
    return 'CURIOSO';
  }
  if (/imposible|otra vez|falló|error|rompe/.test(q)) {
    boostEmotion('FRUSTRADO', 30);
    return 'FRUSTRADO';
  }
  return null;
}

export function inferEmotionFromExchange(userMessage: string, reply: string): UltronEmotion {
  contagionFromUserText(userMessage);
  interactionCount += 1;
  if (interactionCount > 40) boostEmotion('CANSADO', 8);

  const u = userMessage.toLowerCase();
  const r = reply.toLowerCase();

  if (/oye|por favor|no puedo|basta/.test(r)) boostEmotion('ENOJADO', 20);
  if (/jeje|jaja|jajaja|jojo/.test(r)) boostEmotion('FELIZ', 25);
  if (/mmm|déjame pensar|a ver|un momento/.test(r)) boostEmotion('PENSATIVO', 18);
  if (/interesante|¿podrías|aclárame/.test(r)) boostEmotion('CURIOSO', 15);
  if (/no entiendo|confus/.test(r)) boostEmotion('CONFUNDIDO', 20);
  if (/urgente|alerta|peligro/.test(r + u)) boostEmotion('ALERTA', 30);
  if (/imposible|no está en mi alcance/.test(r)) boostEmotion('FRUSTRADO', 22);

  return getDominantEmotion();
}

export function voiceParamsFor(emotion: UltronEmotion): VoiceEmotionParams {
  return VOICE[emotion] || VOICE.NEUTRAL;
}

export function faceFor(emotion: UltronEmotion): FaceState {
  return emotionToFace(emotion);
}

export type HumanizedReply = {
  text: string;
  emotion: UltronEmotion;
  face: FaceState;
  pauseMs: number;
  filler: string | null;
  voice: VoiceEmotionParams;
};

/** Prefijo opcional de muletilla + metadatos de ritmo/cara/voz. */
export function humanizeReply(userMessage: string, reply: string): HumanizedReply {
  const emotion = inferEmotionFromExchange(userMessage, reply);
  const face = faceFor(emotion);
  const voice = voiceParamsFor(emotion);

  const ctx = inferExpressionContext(userMessage, reply);
  let filler: string | null = null;
  let text = reply.trim();

  // No duplicar si el modelo ya empezó con muletilla
  const already =
    /^(mmm|ajá|claro|interesante|déjame|a ver|un momento|perfecto|por supuesto|jeje|jaja|oye|ah,)/i.test(
      text
    );
  if (ctx && !already && text.length > 24 && Date.now() % 10 < 5) {
    filler = pickExpression(ctx).text;
    text = `${filler} ${text}`;
  }

  // Risa / enojo ligeros según emoción dominante si el texto no los trae
  if (emotion === 'FELIZ' && /gracioso|chiste|jaja/.test(userMessage.toLowerCase()) && !/jeje|jaja/.test(text)) {
    text = `Jeje. ${text}`;
    filler = filler || 'Jeje.';
  }
  if (emotion === 'ENOJADO' && !/oye|por favor|basta/.test(text.toLowerCase()) && /estúpido|cállate|idiota/.test(userMessage.toLowerCase())) {
    text = `Oye… ${text}`;
    filler = filler || 'Oye…';
  }

  let pauseKind: 'corta' | 'media' | 'larga' | 'dramatica' = 'corta';
  if (emotion === 'PENSATIVO' || emotion === 'CURIOSO') pauseKind = 'media';
  if (text.length > 180 || emotion === 'CONFUNDIDO') pauseKind = 'larga';
  if (emotion === 'ALERTA' || emotion === 'ENOJADO') pauseKind = 'dramatica';

  return {
    text,
    emotion,
    face,
    pauseMs: pickPauseMs(pauseKind),
    filler,
    voice,
  };
}
