export type VozId = 'marco' | 'luna' | 'looi';

export interface VozUltron {
  id: VozId;
  etiqueta: string;
  rol: string;
  motor: string;
  instruct: string;
}

export const VOCES: VozUltron[] = [
  {
    id: 'marco',
    etiqueta: 'Marco',
    rol: 'Hombre · asistente',
    motor: 'formal',
    instruct:
      'Adult male assistant, 35 years old, calm clear Latin American Spanish, mid-low pitch, measured pace, no cartoon, no shout. Professional desk aide.',
  },
  {
    id: 'luna',
    etiqueta: 'Luna',
    rol: 'Mujer · asistente',
    motor: 'tierna',
    instruct:
      'Adult female assistant, warm and clear Latin American Spanish, natural mid pitch, unhurried, no little-girl voice, no whisper.',
  },
  {
    id: 'looi',
    etiqueta: 'Looi',
    rol: 'Compañero de mesa',
    motor: 'orbita',
    instruct:
      'Small cute desktop robot companion. Light mid-high pitch, slightly synthetic mecha-cute, playful short phrases, Spanish, not a child, not sexy, like a pocket robot pet.',
  },
];

export function vozPorId(id?: string | null): VozUltron {
  return VOCES.find((v) => v.id === id) || VOCES[0];
}
