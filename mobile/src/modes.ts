export type ModeId = 'GUARDIAN' | 'GOLD' | 'CREATIVE' | 'STRATEGIC';

export const MODES: Record<ModeId, { label: string; color: string; instruct: string; hint: string; voice: string }> = {
  GUARDIAN: {
    label: 'Guardian',
    color: '#05E1FF',
    instruct: 'Adult male, calm boardroom Spanish, measured pace',
    hint: 'Mesa. Datos.',
    voice: 'formal',
  },
  GOLD: {
    label: 'Oro',
    color: '#F5C542',
    instruct: 'Warm low male voice, Spanish, slightly slower, gold desk',
    hint: 'Spot y cotizar.',
    voice: 'formal',
  },
  CREATIVE: {
    label: 'Orbita',
    color: '#C084FC',
    instruct: 'Light playful Spanish, young adult',
    hint: 'Juego y canción.',
    voice: 'tierna',
  },
  STRATEGIC: {
    label: 'Junta',
    color: '#7DD3FC',
    instruct: 'Formal Latin American Spanish, short sentences',
    hint: 'Corto y firme.',
    voice: 'formal',
  },
};

export const SING_INSTRUCT =
  'Sing softly in Spanish, short melody, not spoken, gentle humming tone, one verse only';

export const API = 'https://ultron-looi-desk.onrender.com';
