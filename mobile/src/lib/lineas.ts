/**
 * Lo que dice el avatar cuando lo tocan (ojo, frente, boca, cosquillas, sacudida…), en los dos
 * idiomas. El español sale de voice-lines.json (de siempre); el inglés vive aquí al lado.
 * Se dicen en vivo con la voz del avatar.
 */
import ES from '../../voice-lines.json';
import { idiomaActual } from '../i18n';

type Clave = 'tap' | 'annoy' | 'angry' | 'love' | 'shake' | 'eye' | 'mouth' | 'forehead' | 'tickle' | 'double' | 'acks';

const EN: Record<Clave, string[]> = {
  acks: ['One moment.', 'Let me see.', 'Sure, give me a second.', 'On it.'],
  tap: ['Yes?', 'Heh.', 'I’m here.', 'I see you.', 'Did you call me?', 'Present.'],
  annoy: ['Hey… what are you doing?', 'Okay, okay. Careful.', 'Hmm, that tickles… stop.', 'Last warning, seriously.'],
  angry: ['Enough! Pew, pew, pew.', 'I warned you! Pew, pew.', 'That’s it. Firing… just kidding.'],
  love: ['Mmm… thank you. I like that.', 'Okay, okay. I’m still with you.', 'Now that’s nice. Recharging.'],
  shake: ['Hey! Don’t shake me.', 'Whoa. Earthquake, or is it you?', 'Everything’s moving… okay, it passed.'],
  eye: ['Ow, my eye!', 'That’s my optical sensor, careful.', 'Wink. Your turn.'],
  mouth: ['Haha, that tickles.', 'Mmm, don’t cover my mouth.', 'Want me to sing? Just say sing.'],
  forehead: ['That’s my processor. Be nice to it.', 'Hmm. I’m thinking… don’t interrupt.', 'Careful with the CPU.'],
  tickle: ['Hahaha! Stop, stop!', 'Haha! That… that tickles.', 'Hahaha, okay, okay, you’ll knock me out of calibration.'],
  double: ['Double tap. Urgent?', 'Two taps. I’m all ears.'],
};

/** Las frases de ese toque en el idioma de ahora. */
export function lineas(clave: Clave): readonly string[] {
  if (idiomaActual() === 'en') return EN[clave];
  return (ES as Record<string, string[]>)[clave] || EN[clave];
}

/** Los gestos (tristeza, risa, sorpresa…) en inglés; en español van en intenciones.ts. */
const GAG_EN: Record<string, string[]> = {
  sad: ['Oh…', 'Okay. Getting serious for a moment.', 'If you want, tell me what happened.'],
  happy: ['Heh!', 'Done, good mood on.', 'Tell me what we’re celebrating.'],
  angry: ['Hey…', 'Fine. I’ll get a little angry.', 'But I’m still with you. What do you need?'],
  startle: ['Ah!', 'Whoa. You scared me.', 'Okay… breathe with me.'],
  confused: ['Hmm…', 'This doesn’t quite add up.', 'Can you say it another way?'],
  yawn: ['Aaah…', 'Sorry. A yawn.', 'Let’s keep going, slowly.'],
  wink: ['Heh… here’s a wink.', 'Our little secret.'],
  laugh: ['Hahaha.', 'Sorry, that made me laugh.'],
  proud: ['Well… the team and I make a good pair.', 'It shows.'],
  curious: ['Oh?', 'Tell me more.'],
};

/** Las líneas de un gesto en el idioma de ahora. */
export function lineasGag(id: string, es: readonly string[]): readonly string[] {
  return idiomaActual() === 'en' ? GAG_EN[id] || es : es;
}
