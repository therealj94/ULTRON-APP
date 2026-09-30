/**
 * Lo que dice la compañera en sus globitos. Cortito, con gracia, en el idioma elegido (tr al momento
 * de decirlo, así cambia con el idioma sin reiniciar nada).
 */
import { idiomaActual, tr } from '../i18n';
import { avatarActual } from '../avatares/actual';
import { fraseDeEstado, type EstadoFrase } from './frasesEstado';

export type GrupoFrase = 'toque' | 'caricia' | 'enojo' | 'levantar' | 'soltar' | 'dormir' | 'despertar' | 'volver' | 'dormidaToque';

const FRASES: Record<GrupoFrase, () => string[]> = {
  toque: () => [tr('¡Jiji!', 'Hehe!'), tr('¡Me gusta!', 'I like that!'), tr('¿Me llamabas?', 'You called?'), tr('¡Hola, hola!', 'Hi there!'), tr('Aquí estoy', 'Right here')],
  caricia: () => [tr('Mmm… qué rico', 'Mmm… so nice'), tr('¡Otra vez!', 'Again!'), tr('Me encanta', 'I love it'), tr('¡Jiji, cosquillas!', 'Hehe, tickles!')],
  enojo: () => [tr('¡Oye!', 'Hey!'), tr('¡Ya, ya, ya!', 'Okay, okay!'), tr('¡Me vas a marear!', 'You’ll make me dizzy!'), tr('¡Oye, que duele!', 'Hey, that hurts!')],
  levantar: () => [tr('¡Wiii!', 'Wheee!'), tr('¡Uy, qué alto!', 'Whoa, so high!'), tr('¿A dónde vamos?', 'Where are we going?')],
  soltar: () => [tr('¡Uf!', 'Oof!'), tr('Aquí me quedo', 'I’ll stay here'), tr('¡Aterricé!', 'Landed!')],
  dormir: () => [tr('Zzz… dos toques y despierto', 'Zzz… tap twice to wake me')],
  // Al tocarla todavía no escucha nadie (la conversación empieza a conectar): «te escucho» lo dice
  // cuando de verdad escucha (el estado `escuchando` de la voz), no antes.
  despertar: () => [tr('¡Aquí estoy!', 'I’m here!')],
  volver: () => [tr('¡Ya volví!', 'I’m back!'), tr('¿Qué tal la llamada?', 'How was the call?')],
  dormidaToque: () => [tr('Zzz… (dos toques y despierto)', 'Zzz… (tap twice to wake me)')],
};

/** Una frase del grupo; `n` elige cuál (la máquina lleva la cuenta, así no se repite seguido). */
export function fraseCompa(grupo: GrupoFrase, n: number): string {
  const l = FRASES[grupo]();
  return l[((n % l.length) + l.length) % l.length];
}

/** Una frase del banco de estados (compa/frasesEstado.ts) con el avatar y el idioma de ahora, sin repetir seguidas. */
const deEstado = (estado: EstadoFrase) => fraseDeEstado(estado, avatarActual(), idiomaActual()).texto;

export const textoCompa = {
  escuchando: () => deEstado('escuchando'),
  conectando: () => deEstado('conectando'),
  pensando: () => deEstado('pensando'),
  perdon: () => deEstado('disculpa'),
  enviado: (para?: string) => (para ? tr(`✔ ¡Listo! Enviado a ${para}`, `✔ Done! Sent to ${para}`) : tr('✔ ¡Listo! Enviado', '✔ Done! Sent')),
  noEnviado: () => tr('No pude enviarlo', 'I couldn’t send it'),
  listo: () => deEstado('listo'),
  noPude: () => deEstado('no_pude'),
  borrador: (para: string) => tr(`✎ Borrador para ${para}`, `✎ Draft for ${para}`),
  noAbrio: () => tr('No pude conectarme. Tócame dos veces para intentar otra vez', 'I couldn’t connect. Tap me twice to try again'),
  /** Fuera de una llamada: cómo pedirle que llame. */
  pideLlamada: () => tr('Dime «llámame» y te llamo', 'Say "call me" and I’ll call you'),
};
