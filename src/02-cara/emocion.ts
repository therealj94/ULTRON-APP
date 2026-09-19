import type { FaceState } from '../types';
import type { Emocion } from '../../lib/emocion';

/**
 * Emoción del cerebro (`[EMO:x]`, ver lib/emocion.ts) → FaceState base de la cara.
 * La micro-expresión fina (cejas, párpados, sacudida de risa…) la pone la capa
 * `expresion` dentro de FaceCanvas cuando cambia la prop `emocion`; esto es sólo
 * la cara "de fondo" que App puede fijar mientras habla o al terminar.
 */
export const CARA_POR_EMOCION: Record<Emocion, FaceState> = {
  neutral: 'IDLE',
  feliz: 'HAPPY',
  risa: 'LAUGH',
  sorpresa: 'SURPRISED',
  curioso: 'CURIOSITY',
  pensando: 'THINKING',
  preocupado: 'CONCERNED',
  triste: 'SAD',
  molesto: 'ANGRY',
  cansado: 'TIRED',
  carino: 'PURR',
  orgullo: 'HAPPY',
  travieso: 'WINK',
  canto: 'SING',
};

export function caraDeEmocion(e: Emocion): FaceState {
  return CARA_POR_EMOCION[e] ?? 'IDLE';
}

/** Cara según lo que dijo el jefe. Hold 1.2–3.4s lo pone App. */
export function caraDeTexto(texto: string): FaceState {
  const t = texto.toLowerCase();
  if (/\b(para|calla|silencio|basta)\b/.test(t)) return 'IDLE';
  if (/\b(jedi|sable)\b/.test(t)) return 'JEDI';
  if (/\b(furia|furioso)\b/.test(t)) return 'FURY';
  if (/\b(enoj|molesto|carajo|mierda|odio)\b/.test(t)) return 'ANGRY';
  if (/\b(canta|canción|favorita)\b/.test(t)) return 'SING';
  if (/\b(jaj|jeje|jiji)/.test(t)) return 'LAUGH';
  if (/\b(precio|oro|plata|hnl|dólar|cuánto)\b/.test(t)) return 'THINKING';
  if (/\b(busca|investiga|web|página)\b/.test(t)) return 'THINKING';
  if (/\b(gracias|bien|bueno)\b/.test(t)) return 'HAPPY';
  if (/\b(hola|hey|ultron)\b/.test(t)) return 'WINK';
  return 'LISTENING';
}
