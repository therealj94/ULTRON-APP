import type { FaceState } from '../types';

/** Cara según lo que dijo el jefe. Hold 1.2–3.4s lo pone App. */
export function caraDeTexto(texto: string): FaceState {
  const t = texto.toLowerCase();
  if (/\b(para|calla|silencio|basta)\b/.test(t)) return 'IDLE';
  if (/\b(enoj|molesto|carajo|mierda|odio)\b/.test(t)) return 'CONCERNED';
  if (/\b(canta|canción|favorita)\b/.test(t)) return 'HAPPY';
  if (/\b(precio|oro|plata|hnl|dólar|cuánto)\b/.test(t)) return 'THINKING';
  if (/\b(busca|investiga|web|página)\b/.test(t)) return 'THINKING';
  if (/\b(gracias|bien|jaj|jeje|bueno)\b/.test(t)) return 'HAPPY';
  if (/\b(hola|hey|ultron)\b/.test(t)) return 'WINK';
  return 'LISTENING';
}
