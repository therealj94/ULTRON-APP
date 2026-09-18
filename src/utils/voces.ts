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
    instruct: '',
  },
  {
    id: 'luna',
    etiqueta: 'Luna',
    rol: 'Mujer · asistente',
    motor: 'tierna',
    instruct: '',
  },
  {
    id: 'looi',
    etiqueta: 'Looi',
    rol: 'Compañero de mesa',
    motor: 'orbita',
    instruct: 'Cute small desktop robot, short Spanish, slightly synthetic.',
  },
];

export function vozPorId(id?: string | null): VozUltron {
  return VOCES.find((v) => v.id === id) || VOCES[0];
}
