/**
 * Canto — cuatro ganchos de texto FIJO e idioma FIJO (no se traducen ni se reescriben).
 * Tomas embebidas en assets/sing (a capella, una voz). Si falta la toma → "Me falta la toma de canto, jefe."
 * Solo se canta si el jefe dice «canta». Al terminar: SMILE + frase DESPUÉS_CANTO en español.
 */
import type { AVPlaybackSource } from 'expo-av';

export type Hook = {
  id: 'mia' | 'dramatica' | 'ligera' | 'piano';
  label: string;
  lang: 'en' | 'es';
  lyrics: string;
  /** Frase DESPUÉS_CANTO ({jefe} → trato). */
  after: string;
  take: AVPlaybackSource | null;
};

function take(name: string): AVPlaybackSource | null {
  try {
    switch (name) {
      case 'mia':
        return require('../../assets/sing/mia.mp3');
      case 'dramatica':
        return require('../../assets/sing/dramatica.mp3');
      case 'ligera':
        return require('../../assets/sing/ligera.mp3');
      case 'piano':
        return require('../../assets/sing/piano.mp3');
    }
  } catch {
    /* toma ausente */
  }
  return null;
}

export const HOOKS: Hook[] = [
  {
    id: 'mia',
    label: 'la mía',
    lang: 'en',
    lyrics: 'The street keeps time, the day runs long,\na bittersweet line and I hum it wrong.\nStill it stays when the noise is gone—\nthis little note is the one you want.',
    after: 'Esta es la tuya, {jefe}. ¿Sigo o me detengo?',
    take: take('mia'),
  },
  {
    id: 'dramatica',
    label: 'la dramática',
    lang: 'en',
    lyrics: "Night goes up, the quiet falls,\na lonely line that answers calls.\nIf the echo asks, I don't pretend—\nI hold the note that doesn't end.",
    after: '{Jefe}, no sabía que tenías esos gustos. ¿Sigo o me detengo?',
    take: take('dramatica'),
  },
  {
    id: 'ligera',
    label: 'la suave',
    lang: 'es',
    lyrics: 'Luz baja, radio en la cocina,\nuna canción liviana camina.\nSi te hace falta un poco de aire,\njefe, esto es solo un compás que cae.',
    after: '{Jefe}, no sabía que tenías esos gustos. ¿Sigo o me detengo?',
    take: take('ligera'),
  },
  {
    id: 'piano',
    label: 'la íntima',
    lang: 'en',
    lyrics: "I ran too far, I hit the brake,\na quiet fault I wouldn't fake.\nIf you want silence, this is the line;\nif you want more, I give you mine.",
    after: '{Jefe}, no sabía que tenías esos gustos. ¿Sigo o me detengo?',
    take: take('piano'),
  },
];

export const NO_MORE_HOOKS = 'Solo tengo esos cuatro ganchos, {jefe}.';
export const MISSING_TAKE = 'Me falta la toma de canto, {jefe}.';

export function withTrato(line: string, trato: string) {
  const cap = trato.charAt(0).toUpperCase() + trato.slice(1);
  return line.replace(/\{Jefe\}/g, cap).replace(/\{jefe\}/g, trato);
}

/**
 * Qué gancho pidió. null → no es un pedido de canto. 'other' → otra canción (no la tenemos).
 * Sin nombre / «la mía» → mia. «dramática» / «la larga» → dramatica. «ligera» / «la suave» → ligera. «piano» / «la íntima» → piano.
 */
export function pickHook(q: string): Hook | 'other' | null {
  const t = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!/\bcanta(me|nos|la|r)?\b/.test(t)) return null;
  const rest = t.replace(/^.*?\bcanta(me|nos|la|r)?\b/, '').replace(/\b(una|un|algo|por favor|ultron|jefe|la cancion|cancion|otra vez|de nuevo)\b/g, '').trim();
  if (!rest || /\bla mia\b|\bmia\b/.test(rest)) return HOOKS[0];
  if (/dramatic|la larga\b|\blarga\b/.test(rest)) return HOOKS[1];
  if (/ligera|la suave\b|\bsuave\b/.test(rest)) return HOOKS[2];
  if (/piano|intima/.test(rest)) return HOOKS[3];
  return 'other';
}
