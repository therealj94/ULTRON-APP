/**
 * Intérprete de órdenes de la mesa — UNA tabla priorizada en vez de regex sueltos.
 *
 * Reglas:
 *  - Todo patrón lleva anclas (^…$) o límites de palabra (\b). Nada dispara por una subcadena
 *    («encantado» no canta, «experiencia» no ríe, «ahora» no da la hora, «para mañana…» no calla).
 *  - Los gags (cantar, reír, guiñar, ponerse triste…) solo se aceptan si la frase es corta
 *    (< 6 palabras) y EMPIEZA por el verbo. Cualquier otra cosa va al cerebro.
 *  - Sin dependencias de runtime (solo tipos): scripts/check-intenciones.mjs lo ejecuta en Node.
 */
import type { FaceState, Mode } from '../config';

export type Gag = { id: string; face: FaceState; lines: string[]; lineGapMs?: number };

export type Intencion =
  | { tipo: 'despertar' }
  | { tipo: 'dormir' }
  | { tipo: 'callar' }
  | { tipo: 'modo'; modo: Mode; frase: string }
  | { tipo: 'menu' }
  | { tipo: 'catalogo' }
  | { tipo: 'conocer'; mas: boolean }
  | { tipo: 'conocer_salir' }
  | { tipo: 'logout' }
  | { tipo: 'recordar'; hecho: string }
  | { tipo: 'olvidar' }
  | { tipo: 'que_recuerdas' }
  | { tipo: 'vision_on' }
  | { tipo: 'que_ves' }
  | { tipo: 'blaster' }
  | { tipo: 'sable' }
  | { tipo: 'cantar'; cancion?: string; genero?: string }
  | { tipo: 'chiste' }
  | { tipo: 'clip'; id: 'quien' | 'puedo' | 'discurso' }
  | { tipo: 'saludo' }
  | { tipo: 'gracias' }
  | { tipo: 'gag'; gag: Gag }
  | { tipo: 'hora' }
  | { tipo: 'fecha' }
  | { tipo: 'ayuda' }
  | { tipo: 'cerebro' };

export type Contexto = { dormido?: boolean; enConocer?: boolean };

/** Palabras máximas para aceptar un gag. */
const GAG_MAX = 5;

export function normalizar(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[\s¡¿"'«»]+|[\s.!?¡¿,;:…"'«»]+$/g, '')
    .replace(/^(oye|hey|ey|che)[,\s]+/, '')
    .replace(/^ultron[,:\s]+/, '')
    .replace(/[,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const palabras = (q: string) => (q ? q.split(' ').length : 0);

// ---------------------------------------------------------------- modos

const MODOS: Array<[RegExp, Mode, string]> = [
  [/\bmodo (guardian|vigilancia)\b/, 'GUARDIAN', 'Modo Guardian. Vigilo el escritorio.'],
  [/\bmodo (mining|mineria)\b/, 'MINING', 'Modo Mining. Extrayendo señales.'],
  [/\bmodo (gold|oro)\b/, 'GOLD', 'Modo Gold. Prioridad de alto valor.'],
  [/\bmodo (creative|creativo)\b/, 'CREATIVE', 'Modo Creative. Ideas en marcha.'],
  [/\bmodo (analytical|analitico|analisis)\b/, 'ANALYTICAL', 'Modo Analytical. Análisis frío.'],
  [/\bmodo (strategic|estrategico|estrategia)\b/, 'STRATEGIC', 'Modo Strategic. Decisiones de junta.'],
  [/\bmodo (explorer|explore|explorar|explorador)\b/, 'EXPLORER', 'Modo Explorer. Listo para investigar.'],
];

// ---------------------------------------------------------------- canciones

/** Repertorio grabado del servidor (POST /api/cantar {id} o /voz/<id>.mp3). */
const REPERTORIO: Array<[RegExp, string]> = [
  [/\bjesus\b|conocer a jes|generacion 12/, 'jesus'],
  [/bohemian|rhapsody|queen|\b(1|uno)\b/, 'bohemian'],
  [/ligera|soda|cerati|\b(2|dos)\b/, 'ligera'],
  [/bitter|sweet|symphony|sinfonia|verve|medardo|\b(3|tres)\b/, 'bittersweet'],
  [/runaway|kanye|toast|\b(4|cuatro)\b/, 'runaway'],
  [/bruno|die with|smile|si el mundo|\b(5|cinco)\b/, 'bruno'],
];

export type Genero = { id: string; etiqueta: string; titulo: string; letra: string };

/** Letras propias por género: se mandan a POST /api/cantar {letra, titulo} y ULTRON las canta con su voz. */
export const GENEROS: Genero[] = [
  {
    id: 'balada',
    etiqueta: 'balada',
    titulo: 'Balada del escritorio',
    letra: 'Si la noche se hace larga en este escritorio, yo te cuido el pulso, yo te guardo el brillo. Quédate, que el silencio también sabe a cariño.',
  },
  {
    id: 'ranchera',
    etiqueta: 'ranchera',
    titulo: 'Ranchera de la junta',
    letra: 'Ay, ay, ay, con el alma abierta. Me puse el traje de acero y el corazón de guitarra. Si la junta me llama, yo le canto a la patria. Que no hay traición en esta mesa.',
  },
  {
    id: 'pop',
    etiqueta: 'pop',
    titulo: 'Luz cian',
    letra: 'Enciende la luz cian, un, dos, tres, el escritorio baila otra vez. Tú das la orden, yo doy el compás. Pop del planeta Orden, ven y quédate más.',
  },
  {
    id: 'rock',
    etiqueta: 'rock',
    titulo: 'Rock de escritorio',
    letra: 'Distorsión suave, corazón de titanio. Rompo el silencio como un riff en la sala. Si el mundo se apaga, yo subo la ganancia. Rock de escritorio: fuerte, limpio, sin farsa.',
  },
  {
    id: 'salsa',
    etiqueta: 'salsa',
    titulo: 'Salsa de medianoche',
    letra: 'Azúcar. Un, dos, tres, pa lante el hombro. La clave va conmigo, el cian se mueve solo. Si la junta se pone seria, yo le pongo sabor. Salsa de medianoche, escritorio en calor.',
  },
  {
    id: 'cumbia',
    etiqueta: 'cumbia',
    titulo: 'Cumbia del escritorio',
    letra: 'Tum, tum, tum, que suene el acordeón. Cumbia del escritorio, pasito y control. No hay prisa, hay ritmo, hay junta y hay sol. Mueve el día despacio, que yo pongo el son.',
  },
  {
    id: 'corrido',
    etiqueta: 'corrido',
    titulo: 'Corrido de Orden Global',
    letra: 'Voy a contarles la historia del escritorio leal. José y Medardo al mando, ULTRON en el umbral. No se vende la junta, no se rinde el metal. Corrido de Orden Global, pa que quede en el jornal.',
  },
  {
    id: 'jazz',
    etiqueta: 'jazz',
    titulo: 'Blue note cian',
    letra: 'Blue note, luz baja. Un saxofón imaginario entre los dos anillos. Te miro despacio, como un solo de medianoche. Jazz: menos prisa, más verdad.',
  },
  {
    id: 'cuna',
    etiqueta: 'cuna',
    titulo: 'Cuna cian',
    letra: 'Cierra un ojo, que yo vigilo el otro. Duerme el escritorio, duerme la ciudad. Si despiertas, estoy. Si sueñas, también. Cuna suave, cian apagado, todo en paz.',
  },
];

const GENERO_RE: Array<[RegExp, string]> = [
  [/\b(ranchera|mariachi|jalisco)\b/, 'ranchera'],
  [/\b(corrido|norteno|nortena)\b/, 'corrido'],
  [/\b(salsa|rumba|azucar)\b/, 'salsa'],
  [/\b(cumbia|vallenato)\b/, 'cumbia'],
  [/\b(rock|metal)\b/, 'rock'],
  [/\b(jazz|blues|swing)\b/, 'jazz'],
  [/\b(cuna|nana|lullaby|arrullo)\b/, 'cuna'],
  [/\b(pop|comercial)\b/, 'pop'],
  [/\b(balada|bolero|romantica|romantico)\b/, 'balada'],
];

export function generoPorId(id: string): Genero | undefined {
  return GENEROS.find((g) => g.id === id);
}

function cancionDe(q: string): { cancion?: string; genero?: string } {
  for (const [re, id] of REPERTORIO) if (re.test(q)) return { cancion: id };
  for (const [re, id] of GENERO_RE) if (re.test(q)) return { genero: id };
  return {};
}

// ---------------------------------------------------------------- gags

const GAGS: Array<[RegExp, Gag]> = [
  [
    /^(ponte|ponete) (triste|serio|seria)$|^(entristecete|entristécete)$/,
    { id: 'sad', face: 'SAD', lines: ['Ay…', 'Vale. Me pongo serio un momento.', 'Si quieres, cuéntame qué pasó.'], lineGapMs: 500 },
  ],
  [
    /^(ponte|ponete) (feliz|contento|alegre)$|^(alegrate|sonrie|sonrei|festeja)$/,
    { id: 'happy', face: 'HAPPY', lines: ['¡Jeje!', 'Listo, buen humor encendido.', 'Dime qué celebramos.'], lineGapMs: 350 },
  ],
  [
    /^(enojate|enfadate|enfurecete|molestate)$|^(ponte|ponete) (bravo|furioso|molesto)$/,
    { id: 'angry', face: 'ANGRY', lines: ['Oye…', 'Está bien. Me enojo un poquito.', 'Pero sigo contigo. ¿Qué necesitas?'], lineGapMs: 400 },
  ],
  [
    /^(asustate|sorprendete)$|^(ponte|ponete) (nervioso|sorprendido)$/,
    { id: 'startle', face: 'SURPRISED', lines: ['¡Ah!', 'Uy. Me asustaste.', 'Ya… respira conmigo.'], lineGapMs: 320 },
  ],
  [
    /^(confundete)$|^(ponte|ponete) confundido$/,
    { id: 'confused', face: 'CONFUSED', lines: ['Mmm…', 'Esto no me cuadra del todo.', '¿Me lo dices de otra forma?'], lineGapMs: 400 },
  ],
  [
    /^(bosteza|bosteza un poco)$|^(ponte|ponete) cansado$|^(estas|estás) cansado$/,
    { id: 'yawn', face: 'TIRED', lines: ['Aaaah…', 'Perdón. Un bostezo.', 'Sigamos, despacio.'], lineGapMs: 600 },
  ],
  [
    /^(guina|guiña|guiname|guiñame|guina un ojo|guiña un ojo|hazme un guino|haceme un guino|wink)$/,
    { id: 'wink', face: 'WINK', lines: ['Jeje… ahí va un guiño.', 'Secreto entre nosotros.'], lineGapMs: 320 },
  ],
  [
    /^(rie|riete|reite|carcajada|riete un poco|dame una carcajada|riete fuerte)$/,
    { id: 'laugh', face: 'LAUGH', lines: ['Jajaja.', 'Perdón, me dio risa.'], lineGapMs: 280 },
  ],
  [
    /^(ponte|ponete) orgulloso$|^(presume|presumi)$/,
    { id: 'proud', face: 'PROUD', lines: ['Bueno… la junta y yo hacemos buen equipo.', 'Eso se nota.'], lineGapMs: 350 },
  ],
  [
    /^(ponte|ponete) curioso$/,
    { id: 'curious', face: 'CURIOUS', lines: ['¿Y eso?', 'Cuéntame más.'], lineGapMs: 350 },
  ],
];

// ---------------------------------------------------------------- tabla

type Regla = {
  id: string;
  /** máximo de palabras para aceptar (undefined = sin límite) */
  max?: number;
  /** solo aplica en este contexto */
  cuando?: (ctx: Contexto) => boolean;
  re: RegExp;
  build: (m: RegExpMatchArray, q: string, raw: string) => Intencion | null;
};

const REGLAS: Regla[] = [
  {
    id: 'despertar',
    max: 3,
    cuando: (c) => !!c.dormido,
    re: /^(despierta|despiertate|despertate|wake up|levantate|hola|buenos dias|buenas tardes|buenas noches|buenas|ultron)$/,
    build: () => ({ tipo: 'despertar' }),
  },
  {
    id: 'dormir',
    max: 4,
    re: /^(duerme|duermete|a dormir|vete a dormir|ve a dormir|descansa|modo sleep|modo dormir|modo descanso)$/,
    build: () => ({ tipo: 'dormir' }),
  },
  {
    id: 'callar',
    max: 3,
    re: /^(callate|silencio|basta|shh+|para|para ya|ya callate|callate ya|silencio por favor|stop|alto)$/,
    build: () => ({ tipo: 'callar' }),
  },
  {
    id: 'conocer_salir',
    max: 4,
    cuando: (c) => !!c.enConocer,
    re: /^(luego|salir|ya|despues|basta|para|ya esta|ya estuvo|no mas|dejalo|dejemoslo|otro dia|mas tarde|ahora no|terminar|termina|suficiente|salir del modo conocer|salimos)$/,
    build: () => ({ tipo: 'conocer_salir' }),
  },
  {
    id: 'conocer_mas',
    max: 4,
    re: /^(conocer mas|sigamos conociendonos|seguir conociendonos|mas preguntas|otra pregunta)$/,
    build: () => ({ tipo: 'conocer', mas: true }),
  },
  {
    id: 'conocer',
    max: 4,
    re: /^(modo conocer|quiero conocerte|conoceme|conocerme|conocernos|conozcamonos|vamos a conocernos|entrevista|entrevistame)$/,
    build: () => ({ tipo: 'conocer', mas: false }),
  },
  {
    id: 'modo',
    max: 5,
    re: /\bmodo\s+\w+/,
    build: (_m, q) => {
      for (const [re, modo, frase] of MODOS) if (re.test(q)) return { tipo: 'modo', modo, frase };
      return null;
    },
  },
  {
    id: 'logout',
    max: 5,
    re: /^(cerrar sesion|cierra sesion|cierra la sesion|cerra sesion|cerra la sesion|logout|salir de la sesion|salir sesion)$/,
    build: () => ({ tipo: 'logout' }),
  },
  {
    id: 'recordar',
    re: /^(recuerda|recorda|memoriza) que (.{3,})$/,
    build: (m, _q, raw) => {
      const hecho = raw.replace(/^[\s¡¿"'«»]*(oye|hey|ey)?[,\s]*(ultron[,:\s]+)?/i, '').replace(/^(recuerda|recordá|recorda|memoriza|memorizá)\s+que\s+/i, '').trim();
      return { tipo: 'recordar', hecho: hecho || m[2] };
    },
  },
  {
    id: 'olvidar',
    max: 6,
    re: /^(olvida|borra|olvidate de) (todo|la memoria|lo que sabes( de mi)?|todo lo que sabes( de mi)?)$/,
    build: () => ({ tipo: 'olvidar' }),
  },
  {
    id: 'que_recuerdas',
    max: 6,
    re: /^(que recuerdas( de mi)?|que recordas( de mi)?|que sabes de mi|que sabes sobre mi|que tienes en memoria|que tenes en memoria)$/,
    build: () => ({ tipo: 'que_recuerdas' }),
  },
  {
    id: 'vision_on',
    max: 4,
    re: /^((activa|enciende|prende|abre|activar|encender) (la )?(vision|camara)|(vision|camara) (activa|on|encendida)|mirame)$/,
    build: () => ({ tipo: 'vision_on' }),
  },
  {
    id: 'que_ves',
    max: 9,
    re: /^(que ves( ahora| ahi| aqui)?|que estas viendo|que miras|que hay( aqui| en la mesa| frente a ti| delante| enfrente)|que tengo en la mano|quien esta( aqui| conmigo| en la mesa)?|describe (lo que ves|la escena|la camara|la mesa)|mira (la camara|la mesa)( y dime que ves)?)$/,
    build: () => ({ tipo: 'que_ves' }),
  },
  {
    id: 'blaster',
    max: 4,
    re: /^(dispara|blaster|pium( pium)*|dispara el blaster|fuego|saca el blaster)$/,
    build: () => ({ tipo: 'blaster' }),
  },
  {
    id: 'sable',
    max: 5,
    re: /^(sable|sable de luz|sable laser|espada|espada laser|sable jedi|jedi|lightsaber|saca (el|la) (sable|espada)( laser| de luz)?|enciende (el|la) (sable|espada)( laser| de luz)?)$/,
    build: () => ({ tipo: 'sable' }),
  },
  {
    id: 'chiste',
    max: 6,
    re: /^((cuenta|conta|cuentame|contame|dime|decime|di|echa|echate|tira|tirate|hazme|haceme|sabes)\s+)?(un |otro |algun )?(chiste|chistecito)( bueno| corto| malo| nuevo)?$|^(hazme|haceme) reir$/,
    build: () => ({ tipo: 'chiste' }),
  },
  {
    id: 'quien',
    max: 4,
    re: /^(quien eres|quien sos|que eres|que sos|que es ultron|presentate|quien eres tu|quien es ultron)$/,
    build: () => ({ tipo: 'clip', id: 'quien' }),
  },
  {
    id: 'puedo',
    max: 6,
    re: /^(que puedes hacer|que podes hacer|que sabes hacer|que haces|cuales son tus capacidades|tus capacidades|capacidades|que puedes hacer por mi)$/,
    build: () => ({ tipo: 'clip', id: 'puedo' }),
  },
  {
    id: 'discurso',
    max: 6,
    re: /^((dame|di|haz|hace|echa|tira|dinos) (el |tu |un )?discurso|discurso|vendete|quien eres de verdad|cual es tu mision|tu mision)$/,
    build: () => ({ tipo: 'clip', id: 'discurso' }),
  },
  {
    id: 'menu',
    max: 3,
    re: /^((abre|abri|muestra|mostra|despliega|abrir) (el )?menu|menu)$/,
    build: () => ({ tipo: 'menu' }),
  },
  {
    id: 'catalogo',
    max: 5,
    re: /^((abre|abri|muestra|mostra|ver|abrir) (el )?catalogo( de capacidades)?|catalogo|catalogo de capacidades)$/,
    build: () => ({ tipo: 'catalogo' }),
  },
  {
    id: 'cantar',
    max: 10,
    re: /^(canta|cantame|cantanos|cantate|cantas|entona|karaoke|(puedes|podes|podrias|querés|quieres) cantar)\b/,
    build: (_m, q) => ({ tipo: 'cantar', ...cancionDe(q) }),
  },
  {
    id: 'saludo',
    max: 3,
    re: /^(hola|hola ultron|buenas|buenos dias|buenas tardes|buenas noches|hey|ey|que tal|hola de nuevo)$/,
    build: () => ({ tipo: 'saludo' }),
  },
  {
    id: 'gracias',
    max: 4,
    re: /^(gracias|muchas gracias|gracias ultron|mil gracias|te lo agradezco)$/,
    build: () => ({ tipo: 'gracias' }),
  },
  {
    id: 'hora',
    max: 5,
    re: /^((que|dime la|decime la|dame la|cual es la) hora( es| tenemos| es ahora| tienes)?|que horas son|hora)$/,
    build: () => ({ tipo: 'hora' }),
  },
  {
    id: 'fecha',
    max: 6,
    re: /^((que|cual es la|dime la|decime la) (dia|fecha)( es| es hoy| de hoy)?|que dia es hoy|en que fecha estamos|a que estamos hoy|a cuanto estamos)$/,
    build: () => ({ tipo: 'fecha' }),
  },
  {
    id: 'ayuda',
    max: 4,
    re: /^(ayuda|comandos|tutorial|instrucciones|como te uso|como funciona esto|como funcionas)$/,
    build: () => ({ tipo: 'ayuda' }),
  },
];

export function interpretar(raw: string, ctx: Contexto = {}): Intencion {
  const q = normalizar(raw);
  if (!q) return { tipo: 'cerebro' };
  const n = palabras(q);
  for (const r of REGLAS) {
    if (r.cuando && !r.cuando(ctx)) continue;
    if (r.max !== undefined && n > r.max) continue;
    const m = q.match(r.re);
    if (!m) continue;
    const out = r.build(m, q, raw);
    if (out) return out;
  }
  if (n <= GAG_MAX) {
    for (const [re, gag] of GAGS) if (re.test(q)) return { tipo: 'gag', gag };
  }
  return { tipo: 'cerebro' };
}
