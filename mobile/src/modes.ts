export type ModeId = 'GUARDIAN' | 'GOLD' | 'CREATIVE' | 'STRATEGIC';

export const MODES: Record<
  ModeId,
  { label: string; color: string; instruct: string; hint: string }
> = {
  GUARDIAN: {
    label: 'Guardian',
    color: '#05E1FF',
    instruct: 'Adult male, calm boardroom Spanish, measured pace, no singing',
    hint: 'Mesa. Datos.',
  },
  GOLD: {
    label: 'Oro',
    color: '#F5C542',
    instruct: 'Warm low male voice, Spanish, slightly slower, like a gold desk',
    hint: 'Spot y cotizar.',
  },
  CREATIVE: {
    label: 'Orbita',
    color: '#C084FC',
    instruct: 'Light playful Spanish, young adult, smiles in the voice',
    hint: 'Juego y canción.',
  },
  STRATEGIC: {
    label: 'Junta',
    color: '#7DD3FC',
    instruct: 'Formal Latin American Spanish, short sentences, executive',
    hint: 'Corto y firme.',
  },
};

export const SING_INSTRUCT =
  'Sing softly in Spanish, short melody, not spoken, gentle humming tone, one verse only';
