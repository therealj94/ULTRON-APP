/** Guiones y clips v3 Gabriela. Cero tokens al reproducir. */

export const LETRAS = {
  bohemian:
    "[casually] No soy Freddie, jefe. Pero ahí voy. [singing] Is this the real life? Is this just fantasy? Caught in a landslide, no escape from reality. Open your eyes, look up to the skies and see. [laughs] [warmly] ¿Qué tal canté, José? Mercury era un monstruo en ese escenario. Yo apenas sobreviví el primer verso. ¿Me das el diez o el aplazo?",
  ligera:
    "[smiling] Cerati. Un genio. Esta me la sé aunque no sea cantante. Ahí voy. [singing] Ella durmió al calor de las masas, y yo desperté queriendo soñarla. De aquel amor, de música ligera, nada nos libra, nada más queda. [laughs] [warmly] ¿Qué tal, José? Gustavo lo hacía parecer fácil. Yo la dejé temblando un poco. ¿La repetimos o seguimos?",
  bittersweet:
    "[softly] La de Medardo. The Verve. Sin red. [singing] You're a slave to money, then you die. I'll take you down the only road I've ever been down. You know the one that takes you to the places where all the veins meet, yeah. [laughs] [warmly] ¿Cómo la sentiste, José? Ashcroft canta como si le doliera el siglo. Yo apenas la rozé. ¿Le mandamos un audio a Medardo?",
  runaway:
    "[playful] Kanye. El rey. Brindis sucio, sin autotune. [singing] Let's have a toast for the douchebags. Let's have a toast for the assholes. Let's have a toast for the scumbags, every one of them that I know. [laughs] [warmly] ¿Qué tal, José? Ye lo tira como sentencia. Yo lo tiré como chiste. ¿Otro brindis o nos ponemos a trabajar?",
  bruno:
    "[softly] Bruno Mars. Die With A Smile. Si el mundo se acaba, esta. No soy cantante, ahí voy. [singing] If the world was ending, I'd wanna be next to you. If the party was over and our time on Earth was through. I'd wanna hold you just for a while and die with a smile. If the world was ending, I'd wanna be next to you. [laughs] [warmly] ¿Qué tal, José? Bruno la canta como si fuera la última noche. Yo la canté como si te estuviera cuidando el escritorio. ¿Otra, o trabajamos?",
} as const;

export const BANCO: { id: string; file: string; keys: RegExp }[] = [
  { id: 'bruno', file: '/voz/bruno.mp3', keys: /bruno|die with a smile|si el mundo|canta\s*5/i },
  { id: 'bohemian', file: '/voz/bohemian.mp3', keys: /bohemian|rhapsody|queen|\bcanta\s*1\b/i },
  { id: 'ligera', file: '/voz/ligera.mp3', keys: /m[uú]sica ligera|soda|cerati|\bcanta\s*2\b/i },
  { id: 'bittersweet', file: '/voz/bittersweet.mp3', keys: /bitter\s*sweet|sinfon[ií]a|the verve|medardo|favorita de medardo|\bcanta\s*3\b/i },
  { id: 'runaway', file: '/voz/runaway.mp3', keys: /runaway|kanye|toast|favorita de jos[eé]|\bcanta\s*4\b/i },
  { id: 'discurso', file: '/voz/discurso.mp3', keys: /discurso|v[eé]ndete|qui[eé]n eres de verdad|tu misi[oó]n|genesis core largo/i },
  { id: 'quien', file: '/voz/quien.mp3', keys: /qui[eé]n eres|qu[eé] eres|qui[eé]n sos|qu[eé] es ultron/i },
  { id: 'puedo', file: '/voz/puedo.mp3', keys: /qu[eé] puedes|qu[eé] hac[eé]s|capacidades|qu[eé] sabes hacer/i },
  { id: 'chiste1', file: '/voz/chiste1.mp3', keys: /chiste\s*1/i },
  { id: 'chiste2', file: '/voz/chiste2.mp3', keys: /chiste\s*2/i },
  { id: 'chiste3', file: '/voz/chiste3.mp3', keys: /chiste\s*3/i },
  { id: 'chiste4', file: '/voz/chiste4.mp3', keys: /chiste\s*4/i },
  { id: 'chiste5', file: '/voz/chiste5.mp3', keys: /chiste\s*5/i },
  { id: 'dias', file: '/voz/dias.mp3', keys: /buenos d[ií]as/i },
  { id: 'tardes', file: '/voz/tardes.mp3', keys: /buenas tardes/i },
  { id: 'noches', file: '/voz/noches.mp3', keys: /buenas noches/i },
  { id: 'calenta', file: '/voz/calenta.mp3', keys: /calentando el motor/i },
  { id: 'listos', file: '/voz/listos.mp3', keys: /estamos listos/i },
  { id: 'mmm', file: '/voz/mmm.mp3', keys: /^mmm|^d[eé]jame ver/i },
  { id: 'je', file: '/voz/je.mp3', keys: /^je je|^je\b/i },
  { id: 'uy', file: '/voz/uy.mp3', keys: /^uy\b/i },
  { id: 'vale', file: '/voz/vale.mp3', keys: /^vale,?\s*jefe/i },
  { id: 'entendido', file: '/voz/entendido.mp3', keys: /^entendido/i },
];

export function clipDeTexto(text: string) {
  const t = String(text || '');
  return BANCO.find((b) => b.id === t.trim() || b.keys.test(t)) || null;
}

export function saludoHora(d = new Date()) {
  const h = d.getHours();
  if (h < 12) return BANCO.find((b) => b.id === 'dias')!;
  if (h < 19) return BANCO.find((b) => b.id === 'tardes')!;
  return BANCO.find((b) => b.id === 'noches')!;
}

export function siguienteChiste() {
  let n = 0;
  try {
    n = Number(localStorage.getItem('ultron_chiste') || '0') || 0;
  } catch {
    n = 0;
  }
  const id = `chiste${(n % 5) + 1}`;
  try {
    localStorage.setItem('ultron_chiste', String(n + 1));
  } catch {
    /* */
  }
  return BANCO.find((b) => b.id === id)!;
}
