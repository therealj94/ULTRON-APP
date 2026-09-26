/**
 * Banco de clips grabados con la voz oficial (public/voz). Cero red al reproducir.
 * Los hablados se graban con `scripts/grabar-banco.ts` (Voicebox). Kokoro no canta: las canciones
 * son grabaciones — las nuevas (Jesús, Way Maker y las cuatro propias) salieron del estudio con la
 * voz de Dora (scripts/estudio); las demás son tomas únicas de la voz anterior.
 * Las reacciones sin palabras (risa, «oh», «aww», bostezo) son las expresiones del estudio
 * (public/voz/expresiones, lib/expresiones.ts).
 */

export type Clip = {
  id: string;
  file: string;
  /**
   * Cuándo suena. En los hablados, la frase EXACTA que dice (una respuesta que dice «Perfecto.» suena
   * al clip, sin pedir voz). En las canciones, el pedido («cantame la de cuna»): solo se miran al
   * pedir una canción, nunca en lo que AU-RA dice, o «que Jesús te bendiga» cantaría una canción entera.
   */
  keys?: RegExp;
  cara?: 'HAPPY' | 'LAUGH' | 'SING' | 'SAD' | 'TIRED' | 'SURPRISED' | 'ANGRY' | 'PURR' | 'PRAY';
  /** Lo que se oye, para la burbuja. Sin esto la burbuja mostraría el id interno del clip. */
  texto?: string;
  /** Si este archivo no suena (un despliegue sin él), el clip de siempre que lo reemplaza. */
  respaldo?: string;
};

export const BANCO: Clip[] = [
  // Canciones del estudio, cantadas con la voz de Dora: dos versiones de AU-RA y cuatro propias.
  { id: 'jesus', file: '/voz/jesus.mp3', keys: /jes[uú]s|generaci[oó]n (12|doce)|conocer a jes/i, cara: 'SING', texto: 'Quiero conocer a Jesús · Generación 12 (versión de AU-RA)' },
  { id: 'waymaker', file: '/voz/waymaker.mp3', keys: /way ?maker|sinach/i, cara: 'SING', texto: 'Way Maker · Sinach (versión de AU-RA)' },
  { id: 'bienvenida', file: '/voz/bienvenida.mp3', keys: /bienvenid/i, cara: 'SING', texto: 'Bienvenidos a AU-RA · canción de AU-RA' },
  { id: 'felizdia', file: '/voz/felizdia.mp3', keys: /cumplea[nñ]os|\bcumple\b|feliz d[ií]a|felicidades/i, cara: 'SING', texto: 'Feliz día · canción de AU-RA' },
  { id: 'bendicion', file: '/voz/bendicion.mp3', keys: /bend[ií]ci[oó]n|bendec[ií]|bend[ií]ce/i, cara: 'SING', texto: 'Bendición · canción de AU-RA' },
  { id: 'cuna', file: '/voz/cuna.mp3', keys: /\bcuna\b|arr[uú]ll|\bnana\b|para dormir|buenas noches/i, cara: 'SING', texto: 'Duerme, duerme · canción de cuna de AU-RA' },
  // Tomas únicas de la voz anterior (habla + canto + risa + comentario)
  { id: 'oracion', file: '/voz/oracion.mp3', keys: /^oracion$|^oraci[oó]n$/i, cara: 'PRAY', texto: 'Oración por el día' },
  { id: 'bruno', file: '/voz/bruno.mp3', keys: /bruno|die with a smile|si el mundo|canta\s*5/i, cara: 'SING', texto: 'Die With A Smile · Bruno Mars' },
  { id: 'bohemian', file: '/voz/bohemian.mp3', keys: /bohemian|rhapsody|queen|\bcanta\s*1\b/i, cara: 'SING', texto: 'Bohemian Rhapsody · Queen' },
  { id: 'ligera', file: '/voz/ligera.mp3', keys: /m[uú]sica ligera|soda|cerati|\bcanta\s*2\b/i, cara: 'SING', texto: 'De música ligera · Soda Stereo' },
  { id: 'bittersweet', file: '/voz/bittersweet.mp3', keys: /bitter\s*sweet|sinfon[ií]a|the verve|favorita de medardo|\bcanta\s*3\b/i, cara: 'SING', texto: 'Bitter Sweet Symphony · The Verve' },
  { id: 'runaway', file: '/voz/runaway.mp3', keys: /runaway|kanye|toast|favorita de jos[eé]|\bcanta\s*4\b/i, cara: 'SING', texto: 'Runaway · Kanye West' },
  // Quién es y qué hace
  { id: 'puedo', file: '/voz/puedo.mp3', keys: /^puedo$|^qu[eé] (puedes|pod[eé]s|hac[eé]s|sabes hacer)\??$|^capacidades$/i, texto: 'Esto es lo que puedo hacer.' },
  // Chistes
  { id: 'chiste1', file: '/voz/chiste1.mp3', keys: /^chiste\s*1$/i, cara: 'LAUGH', texto: 'Un chiste.' },
  { id: 'chiste2', file: '/voz/chiste2.mp3', keys: /^chiste\s*2$/i, cara: 'LAUGH', texto: 'Un chiste.' },
  { id: 'chiste3', file: '/voz/chiste3.mp3', keys: /^chiste\s*3$/i, cara: 'LAUGH', texto: 'Un chiste.' },
  { id: 'chiste4', file: '/voz/chiste4.mp3', keys: /^chiste\s*4$/i, cara: 'LAUGH', texto: 'Un chiste.' },
  { id: 'chiste5', file: '/voz/chiste5.mp3', keys: /^chiste\s*5$/i, cara: 'LAUGH', texto: 'Un chiste.' },
  // Saludos y arranque
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
  { id: 'risa2', file: '/voz/risa2.mp3', keys: /^risa2$/i, cara: 'LAUGH', texto: 'Esa estuvo buena.' },
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
  // Bienvenida, saludos y respuestas de todos los días (Dora, scripts/grabar-banco.ts)
  { id: 'bienvenido', file: '/voz/bienvenido.mp3', keys: /^bienvenid[oa] a au-?ra\.?\s*¿?en qu[eé] te ayudo\??$/i, cara: 'HAPPY', texto: 'Bienvenido a AU-RA. ¿En qué te ayudo?' },
  { id: 'vertejose', file: '/voz/vertejose.mp3', keys: /^qu[eé] bueno verte,? jos[eé]\.?$/i, cara: 'HAPPY', texto: 'Qué bueno verte, José.' },
  { id: 'vertemedardo', file: '/voz/vertemedardo.mp3', keys: /^qu[eé] bueno verte,? medardo\.?$/i, cara: 'HAPPY', texto: 'Qué bueno verte, Medardo.' },
  { id: 'vertecarlos', file: '/voz/vertecarlos.mp3', keys: /^qu[eé] bueno verte,? carlos\.?$/i, cara: 'HAPPY', texto: 'Qué bueno verte, Carlos.' },
  { id: 'vertemayra', file: '/voz/vertemayra.mp3', keys: /^qu[eé] bueno verte,? mayra\.?$/i, cara: 'HAPPY', texto: 'Qué bueno verte, Mayra.' },
  { id: 'holadenuevo', file: '/voz/holadenuevo.mp3', keys: /^hola de nuevo\.?$/i, cara: 'HAPPY', texto: 'Hola de nuevo.' },
  { id: 'mealegra', file: '/voz/mealegra.mp3', keys: /^me alegra verte\.?$/i, cara: 'HAPPY', texto: 'Me alegra verte.' },
  { id: 'unmomento', file: '/voz/unmomento.mp3', keys: /^un momento\.?$/i, texto: 'Un momento.' },
  { id: 'dameunsegundo', file: '/voz/dameunsegundo.mp3', keys: /^dame un segundo,? lo busco\.?$/i, texto: 'Dame un segundo, lo busco.' },
  { id: 'claroquesi', file: '/voz/claroquesi.mp3', keys: /^claro que s[ií]\.?$/i, texto: 'Claro que sí.' },
  { id: 'congusto', file: '/voz/congusto.mp3', keys: /^con gusto\.?$/i, texto: 'Con gusto.' },
  { id: 'perfecto', file: '/voz/perfecto.mp3', keys: /^perfecto\.?$/i, texto: 'Perfecto.' },
  { id: 'yaesta', file: '/voz/yaesta.mp3', keys: /^ya est[aá]\.?$/i, texto: 'Ya está.' },
  { id: 'aquilotenes', file: '/voz/aquilotenes.mp3', keys: /^aqu[ií] lo ten[eé]s\.?$/i, texto: 'Aquí lo tenés.' },
  { id: 'noentendi', file: '/voz/noentendi.mp3', keys: /^no te entend[ií] bien,? ¿?me lo repet[ií]s\??$/i, texto: 'No te entendí bien, ¿me lo repetís?' },
  { id: 'sinconexion', file: '/voz/sinconexion.mp3', keys: /^estoy sin conexi[oó]n ahora mismo\.?$/i, cara: 'SAD', texto: 'Estoy sin conexión ahora mismo.' },
  { id: 'denada', file: '/voz/denada.mp3', keys: /^de nada\.?$/i, cara: 'HAPPY', texto: 'De nada.' },
  { id: 'cuandoquieras', file: '/voz/cuandoquieras.mp3', keys: /^cuando quieras\.?$/i, cara: 'HAPPY', texto: 'Cuando quieras.' },
  { id: 'hastaluego', file: '/voz/hastaluego.mp3', keys: /^hasta luego\.?$/i, texto: 'Hasta luego.' },
  { id: 'quedescanses', file: '/voz/quedescanses.mp3', keys: /^que descanses\.?$/i, texto: 'Que descanses.' },
];

/**
 * Reacciones sin palabras, por emoción: varias tomas del estudio y, si el archivo no está, el clip de
 * siempre. Se tocan por id (`clipDeEmocion`); no tienen `keys` porque no son una frase.
 */
const REACCIONES: Record<string, { tomas: string[]; cara?: Clip['cara']; respaldo: string }> = {
  risa: { tomas: ['risa-corta-1', 'risa-tierna-1', 'je-picara-1'], cara: 'LAUGH', respaldo: 'risa1' },
  sorpresa: { tomas: ['sorpresa-oh-1', 'sorpresa-oh-2', 'asombro-gasp-1', 'asombro-gasp-2'], cara: 'SURPRISED', respaldo: 'uy2' },
  pensando: { tomas: ['mmm-pensando-1', 'mmm-pensando-2', 'hmm-dudando-1'], respaldo: 'mmm2' },
  carino: { tomas: ['aww-ternura-1'], cara: 'PURR', respaldo: 'carino' },
  cansado: { tomas: ['bostezo-1', 'bostezo-2'], cara: 'TIRED', respaldo: 'cansado' },
};
const REACCION_ALIAS: Record<string, string> = { ternura: 'carino', sueno: 'cansado', sueño: 'cansado' };

for (const r of Object.values(REACCIONES)) {
  for (const toma of r.tomas) BANCO.push({ id: `ex-${toma}`, file: `/voz/expresiones/${toma}.mp3`, cara: r.cara, respaldo: r.respaldo });
}

/** El clip que dice exactamente esta frase (o el clip con ese id). Las canciones solo por id: ver `keys`. */
export function clipDeTexto(text: string): Clip | null {
  const t = String(text || '').trim();
  if (!t) return null;
  return BANCO.find((b) => b.id === t || (b.cara !== 'SING' && !!b.keys?.test(t))) || null;
}

/** La canción del repertorio que se pide («cantame la de cuna»), si está grabada aquí. */
export function cancionDeTexto(pedido: string): Clip | null {
  const t = String(pedido || '').trim();
  if (!t) return null;
  return BANCO.find((b) => b.cara === 'SING' && !!b.keys?.test(t)) || null;
}

export function clipPorId(id: string): Clip | null {
  return BANCO.find((b) => b.id === id) || null;
}

/** Saludo al entrar: «Qué bueno verte, José.» grabado para quien está en la junta; a los demás, la bienvenida. */
export function saludoDe(nombre: string): Clip {
  const k = String(nombre || '')
    .trim()
    .split(/\s+/)[0]
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return (k && clipPorId(`verte${k}`)) || clipPorId('bienvenido')!;
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

/**
 * Reacción corta por emoción (se toca antes de la voz sintetizada, o sola al tacto): una toma del
 * estudio al azar. El clip viejo queda como `respaldo` por si el archivo no está.
 */
export function clipDeEmocion(emocion: string, azar: () => number = Math.random): Clip | null {
  const r = REACCIONES[REACCION_ALIAS[emocion] || emocion];
  if (!r) return null;
  const toma = r.tomas[Math.min(r.tomas.length - 1, Math.floor(azar() * r.tomas.length))];
  return clipPorId(`ex-${toma}`) || clipPorId(r.respaldo);
}
