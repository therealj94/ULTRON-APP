/** Clips de Gabriela ya grabados. Cero tokens. */

export const BANCO: { id: string; file: string; keys: RegExp; face?: string }[] = [
  { id: 'bittersweet', file: '/voz/bittersweet.mp3', keys: /bitter\s*sweet|sinfon[ií]a|favorita|the verve|medardo.*canta|canta.*medardo/i },
  { id: 'bohemian', file: '/voz/bohemian.mp3', keys: /bohemian|rhapsody|queen|mama just killed/i },
  { id: 'ligera', file: '/voz/ligera.mp3', keys: /m[uú]sica ligera|soda|cerati/i },
  { id: 'runaway', file: '/voz/runaway.mp3', keys: /runaway|kanye/i },
  { id: 'calenta', file: '/voz/calenta.mp3', keys: /calentando el motor/i },
  { id: 'listos', file: '/voz/listos.mp3', keys: /estamos listos/i },
  { id: 'mmm', file: '/voz/mmm.mp3', keys: /^mmm|^d[eé]jame ver/i },
  { id: 'je', file: '/voz/je.mp3', keys: /^je je|^je\b/i },
];

export function clipDeTexto(text: string) {
  const t = String(text || '');
  return BANCO.find((b) => b.id === t.trim() || b.keys.test(t)) || null;
}
