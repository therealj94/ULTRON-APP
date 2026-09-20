/**
 * Banco de clips grabados con la voz oficial (public/voz). Cero red al reproducir.
 * Se graban con `scripts/grabar-banco.mjs`. Las canciones largas se grabaron en tomas únicas.
 */

export type Clip = {
  id: string;
  file: string;
  keys: RegExp;
  cara?: 'HAPPY' | 'LAUGH' | 'SING' | 'SAD' | 'TIRED' | 'SURPRISED' | 'ANGRY' | 'PURR' | 'PRAY';
  /** Lo que se oye, para la burbuja. Sin esto la burbuja mostraría el id interno del clip. */
  texto?: string;
};

export const BANCO: Clip[] = [
  // Canciones (tomas únicas: habla + canto + risa + comentario)
  { id: 'jesus', file: '/voz/jesus.mp3', keys: /jes[uú]s|generaci[oó]n (12|doce)|conocer a jes/i, cara: 'SING', texto: 'Quiero conocer a Jesús · Generación 12' },
  { id: 'waymaker', file: '/voz/waymaker.mp3', keys: /way ?maker|sinach/i, cara: 'SING', texto: 'Way Maker · Sinach' },
  { id: 'oracion', file: '/voz/oracion.mp3', keys: /^oracion$|^oraci[oó]n$/i, cara: 'PRAY', texto: 'Oración por el día' },
  { id: 'bruno', file: '/voz/bruno.mp3', keys: /bruno|die with a smile|si el mundo|canta\s*5/i, cara: 'SING', texto: 'Die With A Smile · Bruno Mars' },
  { id: 'bohemian', file: '/voz/bohemian.mp3', keys: /bohemian|rhapsody|queen|\bcanta\s*1\b/i, cara: 'SING', texto: 'Bohemian Rhapsody · Queen' },
  { id: 'ligera', file: '/voz/ligera.mp3', keys: /m[uú]sica ligera|soda|cerati|\bcanta\s*2\b/i, cara: 'SING', texto: 'De música ligera · Soda Stereo' },
  { id: 'bittersweet', file: '/voz/bittersweet.mp3', keys: /bitter\s*sweet|sinfon[ií]a|the verve|favorita de medardo|\bcanta\s*3\b/i, cara: 'SING', texto: 'Bitter Sweet Symphony · The Verve' },
  { id: 'runaway', file: '/voz/runaway.mp3', keys: /runaway|kanye|toast|favorita de jos[eé]|\bcanta\s*4\b/i, cara: 'SING', texto: 'Runaway · Kanye West' },
  // Quién es y qué hace
  { id: 'discurso', file: '/voz/discurso.mp3', keys: /^discurso$|v[eé]ndete|qui[eé]n eres de verdad|tu misi[oó]n/i, texto: 'Quién soy y para qué estoy.' },
  { id: 'quien', file: '/voz/quien.mp3', keys: /^quien$|^qui[eé]n (eres|sos)\??$|^qu[eé] (eres|es ultron)\??$/i, texto: '¿Quién soy? Te cuento.' },
  { id: 'puedo', file: '/voz/puedo.mp3', keys: /^puedo$|^qu[eé] (puedes|pod[eé]s|hac[eé]s|sabes hacer)\??$|^capacidades$/i, texto: 'Esto es lo que puedo hacer.' },
  // Chistes
  { id: 'chiste1', file: '/voz/chiste1.mp3', keys: /^chiste\s*1$/i, cara: 'LAUGH', texto: 'Un chiste.' },
  { id: 'chiste2', file: '/voz/chiste2.mp3', keys: /^chiste\s*2$/i, cara: 'LAUGH', texto: 'Un chiste.' },
  { id: 'chiste3', file: '/voz/chiste3.mp3', keys: /^chiste\s*3$/i, cara: 'LAUGH', texto: 'Un chiste.' },
  { id: 'chiste4', file: '/voz/chiste4.mp3', keys: /^chiste\s*4$/i, cara: 'LAUGH', texto: 'Un chiste.' },
  { id: 'chiste5', file: '/voz/chiste5.mp3', keys: /^chiste\s*5$/i, cara: 'LAUGH', texto: 'Un chiste.' },
  // Saludos y arranque
  { id: 'bienvenida', file: '/voz/bienvenida.mp3', keys: /^bienvenida$/i, cara: 'HAPPY', texto: 'ULTRON, en línea. Orden Global.' },
  { id: 'dias', file: '/voz/dias.mp3', keys: /^buenos d[ií]as/i, cara: 'HAPPY', texto: 'Buenos días.' },
  { id: 'tardes', file: '/voz/tardes.mp3', keys: /^buenas tardes/i, cara: 'HAPPY', texto: 'Buenas tardes.' },
  { id: 'noches', file: '/voz/noches.mp3', keys: /^buenas noches/i, cara: 'HAPPY', texto: 'Buenas noches.' },
  { id: 'calenta', file: '/voz/calenta.mp3', keys: /calentando el motor/i, texto: 'Espera, estamos calentando el motor.' },
  { id: 'listos', file: '/voz/listos.mp3', keys: /^estamos listos/i, cara: 'HAPPY', texto: 'Estamos listos.' },
  { id: 'despertar', file: '/voz/despertar.mp3', keys: /^despertar$/i, cara: 'TIRED', texto: 'Mmm… ya desperté. ¿Qué necesitás?' },
  // Reacciones cortas (tacto, pensar, emociones)
  { id: 'aqui', file: '/voz/aqui.mp3', keys: /^aqu[ií]( estoy)?\.?$/i, texto: 'Aquí estoy.' },
  { id: 'listo', file: '/voz/listo.mp3', keys: /^listo\.?$/i, texto: 'Listo.' },
  { id: 'hola', file: '/voz/hola.mp3', keys: /^hola\.?$/i, cara: 'HAPPY', texto: 'Hola. Qué bueno verte.' },
  { id: 'gracias', file: '/voz/gracias.mp3', keys: /^gracias\.?$/i, cara: 'HAPPY', texto: 'Gracias. De verdad.' },
  { id: 'yaya', file: '/voz/yaya.mp3', keys: /^ya,? ya\b/i, cara: 'LAUGH', texto: 'Ya, ya. Te vi.' },
  { id: 'risa1', file: '/voz/risa1.mp3', keys: /^risa1$|^risa$/i, cara: 'LAUGH', texto: 'Ay, no. Je je.' },
  { id: 'risa2', file: '/voz/risa2.mp3', keys: /^risa2$/i, cara: 'LAUGH', texto: 'Je. Esa estuvo buena.' },
  { id: 'mmm', file: '/voz/mmm.mp3', keys: /^mmm$|^d[eé]jame ver\.?$/i, texto: 'Mmm… déjame ver.' },
  { id: 'mmm2', file: '/voz/mmm2.mp3', keys: /^mmm2$/i, texto: 'Mmm… déjame pensarlo un segundo.' },
  { id: 'je', file: '/voz/je.mp3', keys: /^je je\.?$|^je\.?$/i, cara: 'LAUGH', texto: 'Je je.' },
  { id: 'uy', file: '/voz/uy.mp3', keys: /^uy\.?$/i, cara: 'SURPRISED', texto: 'Uy.' },
  { id: 'uy2', file: '/voz/uy2.mp3', keys: /^uy2$/i, cara: 'SURPRISED', texto: 'Uy. Eso no me lo esperaba.' },
  { id: 'vale', file: '/voz/vale.mp3', keys: /^vale,?\s*jefe\.?$/i, texto: 'Vale, jefe.' },
  { id: 'entendido', file: '/voz/entendido.mp3', keys: /^entendido\.?$/i, texto: 'Entendido.' },
  { id: 'cansado', file: '/voz/cansado.mp3', keys: /^cansado$/i, cara: 'TIRED', texto: 'Va. Una cosa a la vez.' },
  { id: 'carino', file: '/voz/carino.mp3', keys: /^cari[nñ]o$/i, cara: 'PURR', texto: 'Tranquilo. Aquí estoy contigo.' },
  { id: 'orgullo', file: '/voz/orgullo.mp3', keys: /^orgullo$/i, cara: 'HAPPY', texto: 'Eso. Así se hace.' },
  { id: 'sorpresa', file: '/voz/sorpresa.mp3', keys: /^sorpresa$/i, cara: 'SURPRISED', texto: '¿En serio? Contame más.' },
  { id: 'triste', file: '/voz/triste.mp3', keys: /^triste$/i, cara: 'SAD', texto: 'Lo siento. De verdad lo siento.' },
  { id: 'molesto', file: '/voz/molesto.mp3', keys: /^molesto$/i, cara: 'ANGRY', texto: 'Ya. Basta. Hablemos en serio.' },
];

export function clipDeTexto(text: string): Clip | null {
  const t = String(text || '').trim();
  if (!t) return null;
  return BANCO.find((b) => b.id === t || b.keys.test(t)) || null;
}

export function clipPorId(id: string): Clip | null {
  return BANCO.find((b) => b.id === id) || null;
}

export function saludoHora(d = new Date()): Clip {
  const h = d.getHours();
  if (h < 12) return clipPorId('dias')!;
  if (h < 19) return clipPorId('tardes')!;
  return clipPorId('noches')!;
}

export function siguienteChiste(): Clip {
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
  return clipPorId(id)!;
}

/** Clip corto de reacción por emoción (se toca antes de la voz sintetizada, si hay). */
export function clipDeEmocion(emocion: string): Clip | null {
  const mapa: Record<string, string> = {
    risa: Math.random() < 0.5 ? 'risa1' : 'risa2',
    sorpresa: 'uy2',
    pensando: 'mmm2',
  };
  const id = mapa[emocion];
  return id ? clipPorId(id) : null;
}
