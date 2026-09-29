/**
 * DE LA VOZ A LA CARA: la etiqueta con la que se dice cada línea ([laughs], [curious],
 * [thoughtful]…, las mismas que actúa Eleven v4) decide la expresión de quien la dice, y cómo
 * reaccionan los que escuchan. Sin DOM: se prueba solo.
 */

import type { Emocion } from '../../lib/emocion';

export type Expresion = 'neutral' | 'feliz' | 'risa' | 'curioso' | 'pensativo' | 'sorpresa' | 'serio' | 'triste' | 'susurro';

/** Lo que mueve cada rasgo. Cejas y sonrisa en −1..1; ojos 0..1,3 (1 = abiertos normales). */
export type Metas = {
  ceja: number; // arriba (+) / ceño (−)
  cejaInterior: number; // preocupación: interiores arriba (+)
  cejaAsim: number; // una más arriba que la otra (curiosidad)
  sonrisa: number;
  ojos: number;
  inclinacion: number; // grados de la cabeza
  miradaY: number; // −1 arriba (pensar) … 1 abajo
  bocaO: number; // 0..1: boca redonda (sorpresa)
  rebote: number; // 0..1: la risa sacude
};

export const METAS: Record<Expresion, Metas> = {
  neutral: { ceja: 0, cejaInterior: 0, cejaAsim: 0, sonrisa: 0.15, ojos: 1, inclinacion: 0, miradaY: 0, bocaO: 0, rebote: 0 },
  feliz: { ceja: 0.25, cejaInterior: 0, cejaAsim: 0, sonrisa: 0.75, ojos: 0.88, inclinacion: 2, miradaY: 0, bocaO: 0, rebote: 0 },
  risa: { ceja: 0.35, cejaInterior: 0.1, cejaAsim: 0, sonrisa: 1, ojos: 0.5, inclinacion: -4, miradaY: -0.2, bocaO: 0, rebote: 1 },
  curioso: { ceja: 0.55, cejaInterior: 0, cejaAsim: 0.6, sonrisa: 0.25, ojos: 1.1, inclinacion: 7, miradaY: 0, bocaO: 0.15, rebote: 0 },
  pensativo: { ceja: 0.2, cejaInterior: 0.2, cejaAsim: 0.35, sonrisa: 0, ojos: 0.8, inclinacion: -6, miradaY: -0.9, bocaO: 0, rebote: 0 },
  sorpresa: { ceja: 1, cejaInterior: 0.2, cejaAsim: 0, sonrisa: 0.1, ojos: 1.3, inclinacion: 0, miradaY: 0, bocaO: 1, rebote: 0 },
  serio: { ceja: -0.55, cejaInterior: -0.3, cejaAsim: 0, sonrisa: -0.25, ojos: 0.9, inclinacion: 0, miradaY: 0.1, bocaO: 0, rebote: 0 },
  triste: { ceja: -0.1, cejaInterior: 0.8, cejaAsim: 0, sonrisa: -0.45, ojos: 0.78, inclinacion: -3, miradaY: 0.4, bocaO: 0, rebote: 0 },
  susurro: { ceja: 0.1, cejaInterior: 0.1, cejaAsim: 0, sonrisa: 0.1, ojos: 0.85, inclinacion: 5, miradaY: 0.2, bocaO: 0.3, rebote: 0 },
};

const TAGS: Array<[RegExp, Expresion]> = [
  [/laugh|chuckl|giggl|risa|risita/, 'risa'],
  [/surpris|gasp|amaz|asombr|sorpres|impress|wow/, 'sorpresa'],
  [/curious|intrigu|interest|curios/, 'curioso'],
  [/thought|hesit|measur|pensa|hmm|mmm|consider/, 'pensativo'],
  [/sigh|sad|tired|suspir|trist|wistful/, 'triste'],
  [/serious|firm|concern|annoy|stern|grave|preocup|urgent/, 'serio'],
  [/whisper|quiet|hush|susurr|soft/, 'susurro'],
  [/warm|cheer|happ|excit|ecsta|enthus|proud|smil|grin|feliz|tender|reassur|encourag|playful|amus/, 'feliz'],
];

/** La expresión de una línea, por su PRIMERA etiqueta reconocible. «¡» y «?» también dicen algo. */
export function expresionDeLinea(texto: string | null | undefined, soloEtiquetas = false): Expresion {
  const t = String(texto || '');
  for (const m of t.matchAll(/\[([^\]\n]{1,40})\]/g)) {
    const k = m[1].toLowerCase();
    const hit = TAGS.find(([re]) => re.test(k));
    if (hit) return hit[1];
  }
  if (soloEtiquetas) return 'neutral';
  const sin = t.replace(/\[[^\]\n]{1,40}\]/g, '').trim();
  if (/^¡|!\s*$/.test(sin)) return 'feliz';
  if (/\?\s*$/.test(sin)) return 'curioso';
  return 'neutral';
}

/**
 * Cómo reacciona quien ESCUCHA a lo que dice otro: devuelve la risa a medias, se sorprende un
 * poco, se pone serio con lo serio. Nunca copia entera la expresión: escuchar no es imitar.
 */
export function reaccionA(e: Expresion): Expresion {
  if (e === 'risa') return 'feliz';
  if (e === 'sorpresa') return 'curioso';
  if (e === 'serio' || e === 'triste') return 'serio';
  if (e === 'feliz') return 'feliz';
  return 'neutral';
}

/** La línea sin etiquetas, para el subtítulo. */
export const sinEtiquetas = (t: string | null | undefined) => String(t || '').replace(/\[[^\]\n]{1,40}\]\s*/g, '').trim();

/** La misma expresión en el idioma de la cara principal (FaceCanvas) de Dr Electrum. */
export const EMOCION_DE: Record<Expresion, Emocion> = {
  neutral: 'neutral',
  feliz: 'feliz',
  risa: 'risa',
  curioso: 'curioso',
  pensativo: 'pensando',
  sorpresa: 'sorpresa',
  serio: 'firme',
  triste: 'preocupado',
  susurro: 'carino',
};
