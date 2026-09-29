/**
 * Las frases cortas de la mesa (saludos, «un momento», «de nada», reacciones), en español e inglés.
 *
 * Antes eran clips grabados con la voz de Dora (assets/voice y /voz/*.mp3). Ya no hay nada grabado:
 * cada frase se dice EN VIVO con la voz del avatar que está en pantalla y en el idioma elegido, así
 * AU-RA, Claudio y el Guardián suenan siempre como ellos mismos. La primera vez se pide al servidor;
 * después sale de la caché de audio del teléfono (tts.ts), sin esperar.
 *
 * Las frases no llevan género («estoy lista»): las dicen tres personajes distintos.
 * Las etiquetas entre corchetes ([risa], [sorpresa]…) son expresiones que ElevenLabs actúa.
 */
import { de, type Bilingue } from '../i18n';

export const FRASES = {
  mmm: { es: 'Mmm… déjame ver.', en: 'Hmm… let me see.' },
  unmomento: { es: 'Un momento.', en: 'One moment.' },
  dameunsegundo: { es: 'Dame un segundo, lo busco.', en: 'Give me a second, I’ll look it up.' },
  puedo: { es: 'Esto es lo que puedo hacer.', en: 'Here’s what I can do.' },
  hola: { es: 'Hola. Aquí estoy.', en: 'Hi. I’m here.' },
  listo: { es: 'Listo.', en: 'Done.' },
  todo: { es: 'Aquí tienes todo lo que puedo hacer.', en: 'Here’s everything I can do.' },
  despertar: { es: 'Ya despierto.', en: 'I’m awake.' },
  je: { es: '[risita] Je, je.', en: '[risita] Heh, heh.' },
  aqui: { es: 'Aquí estoy.', en: 'I’m here.' },
  holadenuevo: { es: 'Hola de nuevo.', en: 'Hello again.' },
  mealegra: { es: 'Me alegra verte.', en: 'Good to see you.' },
  denada: { es: 'De nada.', en: 'You’re welcome.' },
  cuandoquieras: { es: 'Cuando quieras.', en: 'Anytime.' },
  bienvenido: { es: 'Bienvenido. ¿En qué te ayudo?', en: 'Welcome. How can I help?' },
  sinconexion: { es: 'Estoy sin conexión ahora mismo.', en: 'I’m offline right now.' },
  noentendi: { es: 'No te entendí bien, ¿me lo repites?', en: 'I didn’t quite catch that. Could you say it again?' },
  yaya: { es: 'Ya, ya.', en: 'Okay, okay.' },
  triste: { es: 'Ay…', en: 'Oh…' },
  molesto: { es: 'Oye…', en: 'Hey…' },
  sorpresa: { es: '[sorpresa] ¡Uy!', en: '[sorpresa] Whoa!' },
  bostezo: { es: '[bostezo] Aaah…', en: '[bostezo] Aaah…' },
  orgullo: { es: 'Eso se nota.', en: 'It shows.' },
  risacorta: { es: '[risa] Je, je.', en: '[risa] Heh, heh.' },
} satisfies Record<string, Bilingue>;

export type FraseId = keyof typeof FRASES;

/** La frase en el idioma de ahora. */
export function frase(id: FraseId): string {
  return de(FRASES[id]);
}

/** «Qué bueno verte, José.» con el primer nombre de quien entra; sin nombre, la bienvenida. */
export function saludoConNombre(nombre: string): string {
  const primero = String(nombre || '').trim().split(/\s+/)[0] || '';
  if (!primero) return frase('bienvenido');
  return de({ es: `Qué bueno verte, ${primero}.`, en: `Great to see you, ${primero}.` });
}

/**
 * Reacciones sin palabras por emoción: una expresión corta que la voz actúa. Varias por emoción,
 * para que no suene siempre igual.
 */
export const REACCIONES: Record<string, Bilingue[]> = {
  risa: [
    { es: '[risa] Ja, ja.', en: '[risa] Ha, ha.' },
    { es: '[risita] Ji, ji.', en: '[risita] Hee, hee.' },
  ],
  sorpresa: [
    { es: '[sorpresa] ¡Oh!', en: '[sorpresa] Oh!' },
    { es: '[asombro] ¡Ah!', en: '[asombro] Ah!' },
  ],
  pensando: [
    { es: '[mmm] Mmm.', en: '[hmm] Hmm.' },
    { es: '[hmm] Mmm, a ver.', en: '[hmm] Hmm, let’s see.' },
  ],
  carino: [{ es: '[aww] Aww.', en: '[aww] Aww.' }],
  cansado: [{ es: '[bostezo] Aaah…', en: '[bostezo] Aaah…' }],
};

export function reaccionDe(emocion: string): string | null {
  const clave = emocion === 'ternura' ? 'carino' : emocion === 'sueno' ? 'cansado' : emocion;
  const lista = REACCIONES[clave];
  if (!lista?.length) return null;
  return de(lista[Math.floor(Math.random() * lista.length)]);
}
