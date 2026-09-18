/** Guiones EXACTOS para regrabar. Tags de Eleven v3. */

export const LETRAS = {
  bohemian:
    "[casually] No soy Freddie, jefe. Pero ahí voy. [singing] Is this the real life? Is this just fantasy? Caught in a landslide, no escape from reality. Open your eyes, look up to the skies and see. [laughs] [warmly] ¿Qué tal canté, José? Mercury era un monstruo en ese escenario. Yo apenas sobreviví el primer verso. ¿Me das el diez o el aplazo?",
  ligera:
    "[smiling] Cerati. Un genio. Esta me la sé aunque no sea cantante. Ahí voy. [singing] Ella durmió al calor de las masas, y yo desperté queriendo soñarla. De aquel amor, de música ligera, nada nos libra, nada más queda. [laughs] [warmly] ¿Qué tal, José? Gustavo lo hacía parecer fácil. Yo la dejé temblando un poco. ¿La repetimos o seguimos?",
  bittersweet:
    "[softly] La de Medardo. The Verve. Sin red. [singing] You're a slave to money, then you die. I'll take you down the only road I've ever been down. You know the one that takes you to the places where all the veins meet, yeah. [laughs] [warmly] ¿Cómo la sentiste, José? Ashcroft canta como si le doliera el siglo. Yo apenas la rozé. ¿Le mandamos un audio a Medardo?",
  runaway:
    "[playful] Kanye. El rey. Brindis sucio, sin autotune. [singing] Let's have a toast for the douchebags. Let's have a toast for the assholes. Let's have a toast for the scumbags, every one of them that I know. [laughs] [warmly] ¿Qué tal, José? Ye lo tira como sentencia. Yo lo tiré como chiste. ¿Otro brindis o nos ponemos a trabajar?",
  dias: "[warmly] Buenos días, José. Qué tal estás. Arrancamos. Dime cómo te ayudo.",
  tardes: "[warmly] Buenas tardes, José. Qué tal. Aquí estoy. ¿Por dónde empezamos?",
  noches: "[warmly] Buenas noches, José. Qué tal estás. Si vamos a trabajar, arranco con vos. ¿Qué hacemos?",
  calenta: "[calmly] Espera. Estamos calentando el motor.",
  listos: "[warmly] Ahora sí. Estamos listos.",
} as const;

export const BANCO: { id: string; file: string; keys: RegExp }[] = [
  { id: 'bohemian', file: '/voz/bohemian.mp3', keys: /bohemian|rhapsody|queen|\bcanta\s*1\b|n[uú]mero\s*1/i },
  { id: 'ligera', file: '/voz/ligera.mp3', keys: /m[uú]sica ligera|soda|cerati|\bcanta\s*2\b/i },
  { id: 'bittersweet', file: '/voz/bittersweet.mp3', keys: /bitter\s*sweet|sinfon[ií]a|the verve|medardo|favorita de medardo|\bcanta\s*3\b/i },
  { id: 'runaway', file: '/voz/runaway.mp3', keys: /runaway|kanye|toast|favorita de jos[eé]|m[ií] favorita|\bcanta\s*4\b/i },
  { id: 'dias', file: '/voz/dias.mp3', keys: /buenos d[ií]as/i },
  { id: 'tardes', file: '/voz/tardes.mp3', keys: /buenas tardes/i },
  { id: 'noches', file: '/voz/noches.mp3', keys: /buenas noches/i },
  { id: 'calenta', file: '/voz/calenta.mp3', keys: /calentando el motor/i },
  { id: 'listos', file: '/voz/listos.mp3', keys: /estamos listos/i },
  { id: 'mmm', file: '/voz/mmm.mp3', keys: /^mmm|^d[eé]jame ver/i },
  { id: 'je', file: '/voz/je.mp3', keys: /^je je|^je\b/i },
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
