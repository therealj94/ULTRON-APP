/**
 * ULTRON FP — 5 voces Qwen3-TTS (español neutro LATAM, ritmo calmado).
 * Se sintetizan en el nodo T4 (VoiceDesign instruct), no en el A10G del 27B.
 */
export type UltronVoiceId = 'ultron' | 'jarvis' | 'formal' | 'tierna' | 'estrategia' | 'orbita';

export interface UltronVoiceProfile {
  id: UltronVoiceId;
  name: string;
  label: string;
  description: string;
  /** Instruct para Qwen3-TTS VoiceDesign */
  instruct: string;
  language: 'Spanish';
  default?: boolean;
  /** Mapeo opcional a ElevenLabs (fallback) */
  elevenLabsVoiceId?: string;
}

export const ULTRON_VOICES: UltronVoiceProfile[] = [
  {
    id: 'ultron',
    name: 'ULTRON',
    label: 'Asistente',
    description: 'Voz profesional, clara y ágil. Predeterminada de la app nativa (motor rápido).',
    instruct:
      'Adult male, 35s, professional executive assistant, neutral Latin American Spanish, clear crisp articulation, confident mid-low pitch, brisk natural pace, friendly but not sensual, no breathiness',
    language: 'Spanish',
    elevenLabsVoiceId: 'onwK4e9ZLuTAKqWW03F9',
  },
  {
    id: 'jarvis',
    name: 'JARVIS',
    label: 'Principal',
    description: 'Formal, calmado, elegante. Voz por defecto de ULTRON.',
    instruct:
      'Adult male, 40s, calm British-butler elegance adapted to neutral Latin American Spanish, warm low pitch, slow measured pace, clear refined articulation, never rushed, never robotic',
    language: 'Spanish',
    default: true,
    elevenLabsVoiceId: 'pNInz6obpgDQGcFmaJgB',
  },
  {
    id: 'formal',
    name: 'FORMAL',
    label: 'Junta',
    description: 'Institucional y seria para contextos de junta directiva.',
    instruct:
      'Adult male, 45s, institutional boardroom tone, neutral Latin American Spanish, steady serious cadence, precise diction, calm authority, no emotion spikes',
    language: 'Spanish',
    elevenLabsVoiceId: 'JBFqnCBsd6RMkjVDRZzb',
  },
  {
    id: 'tierna',
    name: 'TIERNA',
    label: 'Cálida',
    description: 'Suave y amigable; combina con la cara redonda luminosa de ULTRON.',
    instruct:
      'Adult soft voice, gentle warm friendly tone, neutral Latin American Spanish, soft smile in the voice, slow calm pace, round luminous presence, never childish',
    language: 'Spanish',
    elevenLabsVoiceId: 'EXAVITQu4vr4xnSDxMaL',
  },
  {
    id: 'estrategia',
    name: 'ESTRATEGIA',
    label: 'Analítica',
    description: 'Precisa y neutra para reportes, números y Cerebro de Orden Global.',
    instruct:
      'Adult voice, analytical strategic briefing style, neutral Latin American Spanish, cool clear mid pitch, deliberate calm pacing, factual and precise, no drama',
    language: 'Spanish',
    elevenLabsVoiceId: 'N2lVS1w4EtoT3dr4eOWO',
  },
  {
    id: 'orbita',
    name: 'ÓRBITA',
    label: 'Exploradora',
    description: 'Curiosa y ligera para modos creativos / explore.',
    instruct:
      'Adult bright curious explorer voice, neutral Latin American Spanish, light mid pitch, calm playful clarity without rush, imaginative but composed',
    language: 'Spanish',
    elevenLabsVoiceId: 'pNInz6obpgDQGcFmaJgB',
  },
];

export function getVoice(id?: string): UltronVoiceProfile {
  const found = ULTRON_VOICES.find((v) => v.id === id || v.name.toLowerCase() === String(id || '').toLowerCase());
  return found || ULTRON_VOICES.find((v) => v.default)!;
}
