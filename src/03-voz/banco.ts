/** Letra EXACTA de cada clip. Si se regraba, usar este texto. */
export const LETRAS = {
  bohemian:
    "Is this the real life? Is this just fantasy? Caught in a landslide, no escape from reality. Open your eyes, look up to the skies and see.",
  ligera:
    "Ella durmió al calor de las masas, y yo desperté queriendo soñarla. De aquel amor, de música ligera, nada nos libra, nada más queda.",
  bittersweet:
    "You're a slave to money, then you die. I'll take you down the only road I've ever been down. You know the one that takes you to the places where all the veins meet, yeah.",
  runaway:
    "Let's have a toast for the douchebags. Let's have a toast for the assholes. Let's have a toast for the scumbags, every one of them that I know.",
} as const;

/** Clips de Gabriela ya grabados. Cero tokens. */

export const BANCO: { id: string; file: string; keys: RegExp }[] = [
  { id: 'bohemian', file: '/voz/bohemian.mp3', keys: /bohemian|rhapsody|queen|\bcanta\s*1\b|n[uú]mero\s*1/i },
  { id: 'ligera', file: '/voz/ligera.mp3', keys: /m[uú]sica ligera|soda|cerati|\bcanta\s*2\b/i },
  { id: 'bittersweet', file: '/voz/bittersweet.mp3', keys: /bitter\s*sweet|sinfon[ií]a|the verve|medardo|favorita de medardo|\bcanta\s*3\b/i },
  { id: 'runaway', file: '/voz/runaway.mp3', keys: /runaway|kanye|toast|favorita de jos[eé]|m[ií] favorita|\bcanta\s*4\b/i },
  { id: 'calenta', file: '/voz/calenta.mp3', keys: /calentando el motor/i },
  { id: 'listos', file: '/voz/listos.mp3', keys: /estamos listos/i },
  { id: 'mmm', file: '/voz/mmm.mp3', keys: /^mmm|^d[eé]jame ver/i },
  { id: 'je', file: '/voz/je.mp3', keys: /^je je|^je\b/i },
];

export function clipDeTexto(text: string) {
  const t = String(text || '');
  return BANCO.find((b) => b.id === t.trim() || b.keys.test(t)) || null;
}
