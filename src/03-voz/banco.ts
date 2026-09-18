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
