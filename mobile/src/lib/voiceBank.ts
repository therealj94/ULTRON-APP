/** Clips remotos v3 (Render /voz). El banco viejo de otra voz se retiró. */

export function bankKey(t: string): string {
  return String(t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, '');
}

export const REMOTE_CLIPS: Record<string, string> = {
  buenosdiasjoseestoylistoenqueteayudo: '/voz/dias.mp3',
  buenastardesjoseestoylistoenqueteayudo: '/voz/tardes.mp3',
  buenasnochesjoseestoylistoenqueteayudo: '/voz/noches.mp3',
  dejamever: '/voz/mmm.mp3',
  jeje: '/voz/je.mp3',
  entendido: '/voz/entendido.mp3',
  valejefe: '/voz/vale.mp3',
  uy: '/voz/uy.mp3',
};

export const VOICE_BANK: Record<string, never> = {};
