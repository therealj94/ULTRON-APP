/** Guiones y clips v3 Gabriela. Cero tokens al reproducir. */

export const LETRAS = {
  bohemian:
    "[casually] No soy Freddie, jefe. Pero ahí voy. [singing] Is this the real life? Is this just fantasy? Caught in a landslide, no escape from reality. Open your eyes, look up to the skies and see. [laughs] [warmly] ¿Qué tal canté, José? Mercury era un monstruo en ese escenario. Yo apenas sobreviví el primer verso. ¿Me das el diez o el aplazo?",
  ligera:
    "[casually] Cerati. Un genio. Esta me la sé aunque no sea cantante. Ahí voy. [singing] Ella durmió al calor de las masas… y yo desperté queriendo soñarla… De aquel amor, de música ligera… nada nos libra… nada más queda. [laughs] [warmly] ¿Qué tal, José? Gustavo lo hacía parecer fácil. Yo la dejé temblando un poco. ¿La repetimos o seguimos?",
  bittersweet:
    "[softly] La de Medardo. The Verve. Sin red. Ahí voy. [singing] You're a slave to money then you die… I'll take you down the only road I've ever been down… You know the one that takes you to the places where all the veins meet, yeah… [laughs] [warmly] ¿Cómo la sentiste, José? Ashcroft canta como si le doliera el siglo. Yo apenas la rozé. ¿Le mandamos un audio a Medardo?",
  runaway:
    "[playful] Kanye. El rey. Brindis sucio, sin autotune. Ahí voy. [singing] Let's have a toast for the douchebags… Let's have a toast for the assholes… Let's have a toast for the scumbags, every one of them that I know… [laughs] [warmly] ¿Qué tal, José? Ye lo tira como sentencia. Yo lo tiré como chiste. ¿Otro brindis o nos ponemos a trabajar?",
  bruno:
    "[softly] Bruno Mars. Die With A Smile. Si el mundo se acaba, esta. No soy cantante. Ahí voy. [singing] If the world was ending, I'd wanna be next to you… If the party was over and our time on Earth was through… I'd wanna hold you just for a while and die with a smile… [laughs] [warmly] ¿Qué tal, José? Bruno la canta como si fuera la última noche. Yo la canté como si te estuviera cuidando el escritorio. ¿Otra, o trabajamos?",
} as const;

export const CANCION_IDS = ['bohemian', 'ligera', 'bittersweet', 'runaway', 'bruno'] as const;

/** Texto limpio que dispara el clip (sin tags). Para bankKey / TTS. */
export const TEXTO_CLIP: Record<string, string> = {
  dias: 'Buenos días, José. Aquí. ¿En qué te ayudo?',
  tardes: 'Buenas tardes, José. Aquí. ¿En qué te ayudo?',
  noches: 'Buenas noches, José. Aquí. ¿En qué te ayudo?',
  aqui: 'Aquí.',
  hola: 'Hola.',
  listo_corto: 'Listo.',
  foto: 'Foto.',
  salud: 'Salud.',
  blaster: 'Blaster.',
  te_escucho: 'Te escucho.',
  mic_on: 'Micrófono activado. Te escucho.',
  genesis_ok: 'Quedó en Genesis Core. La próxima pregunta ya lo usa.',
  genesis_preg: '¿Lo actualizo en el cerebro Genesis Core?',
  genesis_pide: 'Decime el hecho y después, actualiza el cerebro.',
  privado: 'ULTRON es privado. Entra con tu sesión de junta.',
  sin_cerebro: 'No alcanzo al cerebro remoto. Eso sí consta.',
  gafas_on: 'Gafas puestas.',
  gafas_off: 'Gafas guardadas.',
  sable: 'Sable listo.',
  espera: 'Déjame ver.',
  voy: 'Voy.',
  un_segundo: 'Un segundo.',
  a_ver: 'A ver.',
  calenta: 'Calentando el motor.',
  listos: 'Estamos listos.',
  en_que: '¿En qué te ayudo?',
  dime: 'Dime.',
  seguimos: '¿Seguimos?',
  lo_guardo: '¿Lo guardo en el cerebro?',
  confirmas: '¿Confirmás?',
  despacho_no: 'Sin autorización expresa de la junta, no puedo despachar.',
  despacho_ok: 'Autorizado por el directorio. Despacho ejecutado.',
  enlace: 'Enlace con cerebro exterior establecido.',
  enojado: 'Enojado.',
  furia: 'Furia.',
  feliz: 'Feliz.',
  preocupado: 'Preocupado.',
  curioso: 'Curioso.',
  guino: 'Guiño.',
  asi: 'Así.',
  susto: 'Susto.',
  pensando: 'Pensando.',
  mmm: 'Mmm.',
  je: 'Je.',
  uy: 'Uy.',
  vale: 'Vale, jefe.',
  entendido: 'Entendido.',
};

const CORTOS = new Set(Object.keys(TEXTO_CLIP));

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
  { id: 'privado', file: '/voz/privado.mp3', keys: /ultron es privado|entra con tu sesi[oó]n/i },
  { id: 'genesis_ok', file: '/voz/genesis_ok.mp3', keys: /qued[oó] en genesis core/i },
  { id: 'genesis_pide', file: '/voz/genesis_pide.mp3', keys: /decime el hecho y despu[eé]s/i },
  { id: 'genesis_preg', file: '/voz/genesis_preg.mp3', keys: /^\s*¿?lo actualizo en el cerebro/i },
  { id: 'mic_on', file: '/voz/mic_on.mp3', keys: /micr[oó]fono activado/i },
  { id: 'te_escucho', file: '/voz/te_escucho.mp3', keys: /^te escucho\.?$/i },
  { id: 'sable', file: '/voz/sable.mp3', keys: /^sable listo\.?$/i },
  { id: 'gafas_on', file: '/voz/gafas_on.mp3', keys: /^gafas puestas\.?$/i },
  { id: 'gafas_off', file: '/voz/gafas_off.mp3', keys: /^gafas guardadas\.?$/i },
  { id: 'despacho_no', file: '/voz/despacho_no.mp3', keys: /sin autorizaci[oó]n expresa de la junta/i },
  { id: 'despacho_ok', file: '/voz/despacho_ok.mp3', keys: /autorizado por el directorio/i },
  { id: 'enlace', file: '/voz/enlace.mp3', keys: /enlace con cerebro exterior/i },
  { id: 'sin_cerebro', file: '/voz/sin_cerebro.mp3', keys: /no alcanzo al cerebro remoto/i },
  { id: 'lo_guardo', file: '/voz/lo_guardo.mp3', keys: /^\s*¿?lo guardo en el cerebro/i },
  { id: 'en_que', file: '/voz/en_que.mp3', keys: /^\s*¿?en qu[eé] te ayudo/i },
  { id: 'seguimos', file: '/voz/seguimos.mp3', keys: /^\s*¿?seguimos\??\.?$/i },
  { id: 'confirmas', file: '/voz/confirmas.mp3', keys: /^\s*¿?confirm[aá]s\??\.?$/i },
  { id: 'dime', file: '/voz/dime.mp3', keys: /^dime\.?$/i },
  { id: 'espera', file: '/voz/espera.mp3', keys: /^d[eé]jame ver|^espera\.?$/i },
  { id: 'voy', file: '/voz/voy.mp3', keys: /^voy\.?$/i },
  { id: 'un_segundo', file: '/voz/un_segundo.mp3', keys: /^un segundo\.?$/i },
  { id: 'a_ver', file: '/voz/a_ver.mp3', keys: /^a ver\.?$/i },
  { id: 'aqui', file: '/voz/aqui.mp3', keys: /^aqu[ií]\.?$/i },
  { id: 'hola', file: '/voz/hola.mp3', keys: /^hola\.?$/i },
  { id: 'listo_corto', file: '/voz/listo_corto.mp3', keys: /^listo\.?$/i },
  { id: 'foto', file: '/voz/foto.mp3', keys: /^foto\.?$/i },
  { id: 'salud', file: '/voz/salud.mp3', keys: /^salud\.?$/i },
  { id: 'blaster', file: '/voz/blaster.mp3', keys: /^blaster\.?$/i },
  { id: 'enojado', file: '/voz/enojado.mp3', keys: /^enojado\.?$/i },
  { id: 'furia', file: '/voz/furia.mp3', keys: /^furia\.?$/i },
  { id: 'feliz', file: '/voz/feliz.mp3', keys: /^feliz\.?$/i },
  { id: 'preocupado', file: '/voz/preocupado.mp3', keys: /^preocupado\.?$/i },
  { id: 'curioso', file: '/voz/curioso.mp3', keys: /^curioso\.?$/i },
  { id: 'guino', file: '/voz/guino.mp3', keys: /^gui[nñ]o\.?$/i },
  { id: 'asi', file: '/voz/asi.mp3', keys: /^as[ií]\.?$/i },
  { id: 'susto', file: '/voz/susto.mp3', keys: /^susto\.?$/i },
  { id: 'pensando', file: '/voz/pensando.mp3', keys: /^pensando\.?$/i },
  { id: 'mmm', file: '/voz/mmm.mp3', keys: /^mmm\.?$/i },
  { id: 'je', file: '/voz/je.mp3', keys: /^je je|^je\.?$/i },
  { id: 'uy', file: '/voz/uy.mp3', keys: /^uy\b/i },
  { id: 'vale', file: '/voz/vale.mp3', keys: /^vale,?\s*jefe/i },
  { id: 'entendido', file: '/voz/entendido.mp3', keys: /^entendido/i },
];

export const PRELOAD_CLIPS = [
  '/voz/bohemian.mp3',
  '/voz/ligera.mp3',
  '/voz/bittersweet.mp3',
  '/voz/runaway.mp3',
  '/voz/bruno.mp3',
  '/voz/dias.mp3',
  '/voz/tardes.mp3',
  '/voz/noches.mp3',
  '/voz/discurso.mp3',
  '/voz/quien.mp3',
  '/voz/puedo.mp3',
  '/voz/mmm.mp3',
  '/voz/calenta.mp3',
  '/voz/aqui.mp3',
  '/voz/hola.mp3',
  '/voz/listo_corto.mp3',
  '/voz/espera.mp3',
  '/voz/te_escucho.mp3',
];

export function clipDeTexto(text: string) {
  const t = String(text || '');
  return BANCO.find((b) => b.id === t.trim() || b.keys.test(t)) || null;
}

/** Solo frases cortas o id exacto. No dispara canciones por una palabra suelta en un párrafo. */
export function clipCanned(text: string) {
  const t = String(text || '').trim();
  if (!t) return null;
  const byId = BANCO.find((b) => b.id === t);
  if (byId) return byId;
  if (t.length > 96) return null;
  return BANCO.find((b) => CORTOS.has(b.id) && b.keys.test(t)) || null;
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

export function bankKey(t: string): string {
  return String(t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, '');
}
