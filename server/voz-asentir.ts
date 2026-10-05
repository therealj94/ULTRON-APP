/**
 * ASENTIR NO ES INTERRUMPIR NI ES UNA PREGUNTA (docs/voz/SPEECH-ENGINE.md).
 *
 * El adaptador de Speech Engine (server/voz-motor.ts) lo usa para que un «ajá» mientras AURA habla no corte
 * la respuesta; la comparación de los dos caminos (server/voz-medidas.ts) lo usa para que un turno que solo
 * asiente no cuente como una respuesta comparable. Sin dependencias del resto del servidor.
 */
import type { Idioma } from './eleven';

/**
 * Lo que es asentir mientras AURA habla: la misma lista que los agentes le dan a ElevenLabs
 * (scripts/elevenlabs-agentes.ts, ASENTIR → `interruption_ignore_terms`; una prueba mira que sigan iguales)
 * más sus variantes escritas («mjm», «aja»). En Speech Engine la lista también se le da al recurso (`turn`);
 * esto es la red por si igual llega como turno.
 */
export const ASENTIR_MOTOR: Record<Idioma, string[]> = {
  es: ['ajá', 'sí', 'ok', 'okay', 'mhm', 'claro', 'ya', 'exacto', 'ah ok', 'vale'],
  en: ['uh-huh', 'yeah', 'yes', 'ok', 'okay', 'mhm', 'right', 'sure', 'got it'],
};
const VARIANTES_ASENTIR = ['aja', 'aha', 'aham', 'ajam', 'mjm', 'mm', 'mmm', 'hmm', 'mhmm', 'uh huh', 'si', 'ah', 'oh ok'];
const plano = (t: string) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-–—]/g, ' ')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const ASENTIR_PLANO = new Set([...ASENTIR_MOTOR.es, ...ASENTIR_MOTOR.en, ...VARIANTES_ASENTIR].map(plano));

/** ¿La frase es solo asentir («Ajá.», «sí, sí», «mjm»)? Como mucho cuatro palabras, todas de asentir. */
export function esAsentimiento(texto: string): boolean {
  const p = plano(texto);
  if (!p) return false;
  if (ASENTIR_PLANO.has(p)) return true;
  const palabras = p.split(' ');
  if (palabras.length > 4) return false;
  // «ah ok ah ok», «sí sí», «mjm, ajá»: cada palabra (o pareja) es de asentir.
  for (let i = 0; i < palabras.length; ) {
    if (i + 1 < palabras.length && ASENTIR_PLANO.has(`${palabras[i]} ${palabras[i + 1]}`)) i += 2;
    else if (ASENTIR_PLANO.has(palabras[i])) i += 1;
    else return false;
  }
  return true;
}
