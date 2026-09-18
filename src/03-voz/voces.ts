export type VozId = 'marco' | 'luna' | 'looi';

export interface VozUltron {
  id: VozId;
  etiqueta: string;
  rol: string;
  motor: string;
  instruct: string;
  elevenVoiceId: string;
  stability: number;
  similarity: number;
}

/**
 * IDs oficiales ElevenLabs. Se FIJAN para que no “cambie la voz” entre turnos.
 * Luna = Rachel (21m00…) — la femenina más humana / asistente de la librería preset.
 * Marco = Daniel (onwK4e9…) — grave, estable.
 * Looi = Bella (EXAVIT…) — más juguetona, misma familia neural.
 */
export const VOCES: VozUltron[] = [
  {
    id: 'marco',
    etiqueta: 'Marco',
    rol: 'Hombre · asistente',
    motor: 'formal',
    instruct: 'Male desk assistant, mid-low, dry Spanish, close-mic, no reverb.',
    elevenVoiceId: 'onwK4e9ZLuTAKqWW03F9',
    stability: 0.62,
    similarity: 0.82,
  },
  {
    id: 'luna',
    etiqueta: 'Luna',
    rol: 'Mujer · asistente',
    motor: 'tierna',
    instruct: 'Female assistant, warm, clear, human, Spanish Latin America, never valley-girl, never announcer.',
    elevenVoiceId: '21m00Tcm4TlvDq8ikWAM',
    stability: 0.58,
    similarity: 0.8,
  },
  {
    id: 'looi',
    etiqueta: 'Looi',
    rol: 'Compañero de mesa',
    motor: 'orbita',
    instruct: 'Cute small desktop companion, short Spanish, slight smile, still human.',
    elevenVoiceId: 'EXAVITQu4vr4xnSDxMaL',
    stability: 0.52,
    similarity: 0.78,
  },
];

export function vozPorId(id?: string | null): VozUltron {
  return VOCES.find((v) => v.id === id) || VOCES[1];
}
