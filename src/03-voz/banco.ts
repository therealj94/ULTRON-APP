/**
 * Banco de clips grabados con la voz oficial (public/voz). Cero red al reproducir.
 * Se graban con `scripts/grabar-banco.mjs`. Las canciones largas se grabaron en tomas únicas.
 */

export type Clip = { id: string; file: string; keys: RegExp; cara?: 'HAPPY' | 'LAUGH' | 'SING' | 'SAD' | 'TIRED' | 'SURPRISED' | 'ANGRY' | 'PURR' | 'PRAY' };

export const BANCO: Clip[] = [
  // Canciones (tomas únicas: habla + canto + risa + comentario)
  { id: 'jesus', file: '/voz/jesus.mp3', keys: /jes[uú]s|generaci[oó]n (12|doce)|conocer a jes/i, cara: 'SING' },
  { id: 'waymaker', file: '/voz/waymaker.mp3', keys: /way ?maker|sinach/i, cara: 'SING' },
  { id: 'oracion', file: '/voz/oracion.mp3', keys: /^oracion$|^oraci[oó]n$/i, cara: 'PRAY' },
  { id: 'bruno', file: '/voz/bruno.mp3', keys: /bruno|die with a smile|si el mundo|canta\s*5/i, cara: 'SING' },
  { id: 'bohemian', file: '/voz/bohemian.mp3', keys: /bohemian|rhapsody|queen|\bcanta\s*1\b/i, cara: 'SING' },
  { id: 'ligera', file: '/voz/ligera.mp3', keys: /m[uú]sica ligera|soda|cerati|\bcanta\s*2\b/i, cara: 'SING' },
  { id: 'bittersweet', file: '/voz/bittersweet.mp3', keys: /bitter\s*sweet|sinfon[ií]a|the verve|favorita de medardo|\bcanta\s*3\b/i, cara: 'SING' },
  { id: 'runaway', file: '/voz/runaway.mp3', keys: /runaway|kanye|toast|favorita de jos[eé]|\bcanta\s*4\b/i, cara: 'SING' },
  // Quién es y qué hace
  { id: 'discurso', file: '/voz/discurso.mp3', keys: /^discurso$|v[eé]ndete|qui[eé]n eres de verdad|tu misi[oó]n/i },
  { id: 'quien', file: '/voz/quien.mp3', keys: /^quien$|^qui[eé]n (eres|sos)\??$|^qu[eé] (eres|es ultron)\??$/i },
  { id: 'puedo', file: '/voz/puedo.mp3', keys: /^puedo$|^qu[eé] (puedes|pod[eé]s|hac[eé]s|sabes hacer)\??$|^capacidades$/i },
  // Chistes
  { id: 'chiste1', file: '/voz/chiste1.mp3', keys: /^chiste\s*1$/i, cara: 'LAUGH' },
  { id: 'chiste2', file: '/voz/chiste2.mp3', keys: /^chiste\s*2$/i, cara: 'LAUGH' },
  { id: 'chiste3', file: '/voz/chiste3.mp3', keys: /^chiste\s*3$/i, cara: 'LAUGH' },
  { id: 'chiste4', file: '/voz/chiste4.mp3', keys: /^chiste\s*4$/i, cara: 'LAUGH' },
  { id: 'chiste5', file: '/voz/chiste5.mp3', keys: /^chiste\s*5$/i, cara: 'LAUGH' },
  // Saludos y arranque
  { id: 'bienvenida', file: '/voz/bienvenida.mp3', keys: /^bienvenida$/i, cara: 'HAPPY' },
  { id: 'dias', file: '/voz/dias.mp3', keys: /^buenos d[ií]as/i, cara: 'HAPPY' },
  { id: 'tardes', file: '/voz/tardes.mp3', keys: /^buenas tardes/i, cara: 'HAPPY' },
  { id: 'noches', file: '/voz/noches.mp3', keys: /^buenas noches/i, cara: 'HAPPY' },
  { id: 'calenta', file: '/voz/calenta.mp3', keys: /calentando el motor/i },
  { id: 'listos', file: '/voz/listos.mp3', keys: /^estamos listos/i, cara: 'HAPPY' },
  { id: 'despertar', file: '/voz/despertar.mp3', keys: /^despertar$/i, cara: 'TIRED' },
  // Reacciones cortas (tacto, pensar, emociones)
  { id: 'aqui', file: '/voz/aqui.mp3', keys: /^aqu[ií]( estoy)?\.?$/i },
  { id: 'listo', file: '/voz/listo.mp3', keys: /^listo\.?$/i },
  { id: 'hola', file: '/voz/hola.mp3', keys: /^hola\.?$/i, cara: 'HAPPY' },
  { id: 'gracias', file: '/voz/gracias.mp3', keys: /^gracias\.?$/i, cara: 'HAPPY' },
  { id: 'yaya', file: '/voz/yaya.mp3', keys: /^ya,? ya\b/i, cara: 'LAUGH' },
  { id: 'risa1', file: '/voz/risa1.mp3', keys: /^risa1$|^risa$/i, cara: 'LAUGH' },
  { id: 'risa2', file: '/voz/risa2.mp3', keys: /^risa2$/i, cara: 'LAUGH' },
  { id: 'mmm', file: '/voz/mmm.mp3', keys: /^mmm$|^d[eé]jame ver\.?$/i },
  { id: 'mmm2', file: '/voz/mmm2.mp3', keys: /^mmm2$/i },
  { id: 'je', file: '/voz/je.mp3', keys: /^je je\.?$|^je\.?$/i, cara: 'LAUGH' },
  { id: 'uy', file: '/voz/uy.mp3', keys: /^uy\.?$/i, cara: 'SURPRISED' },
  { id: 'uy2', file: '/voz/uy2.mp3', keys: /^uy2$/i, cara: 'SURPRISED' },
  { id: 'vale', file: '/voz/vale.mp3', keys: /^vale,?\s*jefe\.?$/i },
  { id: 'entendido', file: '/voz/entendido.mp3', keys: /^entendido\.?$/i },
  { id: 'cansado', file: '/voz/cansado.mp3', keys: /^cansado$/i, cara: 'TIRED' },
  { id: 'carino', file: '/voz/carino.mp3', keys: /^cari[nñ]o$/i, cara: 'PURR' },
  { id: 'orgullo', file: '/voz/orgullo.mp3', keys: /^orgullo$/i, cara: 'HAPPY' },
  { id: 'sorpresa', file: '/voz/sorpresa.mp3', keys: /^sorpresa$/i, cara: 'SURPRISED' },
  { id: 'triste', file: '/voz/triste.mp3', keys: /^triste$/i, cara: 'SAD' },
  { id: 'molesto', file: '/voz/molesto.mp3', keys: /^molesto$/i, cara: 'ANGRY' },
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
