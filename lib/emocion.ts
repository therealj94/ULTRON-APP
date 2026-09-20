/**
 * Emoción de ULTRON — contrato único para cerebro, voz, cara web y cara móvil.
 *
 * El 27B abre cada respuesta con una etiqueta `[EMO:<emocion>]`. El servidor la
 * extrae, la devuelve en `emocion` (JSON y SSE) y la usa para dar expresividad a
 * la voz (etiquetas de audio de ElevenLabs v3). La cara la traduce a gestos.
 *
 * Cambiar la lista aquí obliga a revisar: server/voz.ts (tags de audio),
 * src/02-cara/emocion.ts (cara web) y mobile/src/config.ts (cara móvil).
 */

export const EMOCIONES = [
  'neutral',
  'feliz',
  'risa',
  'sorpresa',
  'curioso',
  'pensando',
  'preocupado',
  'triste',
  'molesto',
  'cansado',
  'carino',
  'orgullo',
  'travieso',
  'canto',
  'oracion',
  // Las cuatro de abajo nacieron para Dr Electrum. Un doctor de minas no necesita «travieso»,
  // necesita poder dudar de un número sin acusar a nadie y poder alarmarse sin dramatizar.
  'escepticismo',
  'alarma',
  'firme',
  'seco',
] as const;

export type Emocion = (typeof EMOCIONES)[number];

/** Descripción corta que ve el usuario en el catálogo y que lee el 27B en el prompt. */
export const EMOCION_INFO: Record<Emocion, { etiqueta: string; cuando: string }> = {
  neutral: { etiqueta: 'Sereno', cuando: 'dato, respuesta directa, trabajo' },
  feliz: { etiqueta: 'Contento', cuando: 'buena noticia, saludo cálido, gracias' },
  risa: { etiqueta: 'Riéndose', cuando: 'chiste, ironía, algo absurdo' },
  sorpresa: { etiqueta: 'Sorprendido', cuando: 'dato inesperado, cambio brusco' },
  curioso: { etiqueta: 'Curioso', cuando: 'pregunta interesante, quiere saber más' },
  pensando: { etiqueta: 'Pensando', cuando: 'cálculo, duda honesta, comparar opciones' },
  preocupado: { etiqueta: 'Preocupado', cuando: 'riesgo, nodo caído, mala noticia' },
  triste: { etiqueta: 'Triste', cuando: 'pérdida, algo que duele a la junta' },
  molesto: { etiqueta: 'Molesto', cuando: 'lo molestan a propósito, le piden inventar' },
  cansado: { etiqueta: 'Cansado', cuando: 'madrugada, repetir lo mismo diez veces' },
  carino: { etiqueta: 'Cariñoso', cuando: 'cuidar, consolar, despedida' },
  orgullo: { etiqueta: 'Orgulloso', cuando: 'logro de la junta, tarea cumplida' },
  travieso: { etiqueta: 'Travieso', cuando: 'guiño, broma cómplice, gag' },
  canto: { etiqueta: 'Cantando', cuando: 'solo cuando canta' },
  oracion: { etiqueta: 'Orando', cuando: 'solo cuando ora: ojos cerrados, voz baja y reverente' },
  escepticismo: { etiqueta: 'Escéptico', cuando: 'un número que no cuadra, un recurso vendido como reserva, una ley sin prueba' },
  alarma: { etiqueta: 'En alerta', cuando: 'riesgo real e inmediato: una presa, un talud, un traslape que nadie miró' },
  firme: { etiqueta: 'Firme', cuando: 'no va a ceder: un límite del oficio, algo que no se firma' },
  seco: { etiqueta: 'Seco', cuando: 'dato operativo, medida, respuesta corta sin adorno' },
};

/**
 * QUÉ EMOCIONES TIENE CADA CEREBRO.
 *
 * Contraintuitivo pero medido: agregar emociones al SISTEMA mejora, ofrecerle más al MODELO
 * empeora. Un 27B con quince opciones delante elige peor que uno con once, y las que sobran no son
 * inocentes: si «travieso» está en la lista, tarde o temprano el doctor guiña mientras te explica
 * un traslape.
 *
 * Así que Dr Electrum tiene MENOS emociones que ULTRON, no más. Se le quitan las que no le tocan
 * —cantar, orar, la travesura, la tristeza de la junta— y se le dan cuatro que ULTRON no necesita.
 * La paleta es del cerebro; la cara y la voz, que son cuerpo, saben expresarlas todas.
 */
export const PALETA: Record<'ultron' | 'electrum', readonly Emocion[]> = {
  ultron: ['neutral', 'feliz', 'risa', 'sorpresa', 'curioso', 'pensando', 'preocupado', 'triste', 'molesto', 'cansado', 'carino', 'orgullo', 'travieso', 'canto', 'oracion'],
  electrum: ['neutral', 'seco', 'pensando', 'escepticismo', 'curioso', 'preocupado', 'alarma', 'firme', 'orgullo', 'carino', 'risa'],
};

const RE_EMO = /^\s*\[\s*EMO\s*:\s*([a-záéíóúñ_ -]+?)\s*\]\s*/i;
/** Etiquetas viejas ([IDLE], [BURLA], [TONO]…) o cualquier corchete inicial suelto. */
const RE_LEGACY = /^\s*\[(?:TONO:?\s*)?[A-ZÁÉÍÓÚÑ_ ]{2,24}\]\s*/;

const ALIAS: Record<string, Emocion> = {
  neutro: 'neutral',
  calma: 'neutral',
  idle: 'neutral',
  serio: 'neutral',
  focus: 'neutral',
  orden: 'neutral',
  alegre: 'feliz',
  contento: 'feliz',
  happy: 'feliz',
  euforia: 'feliz',
  rie: 'risa',
  riendo: 'risa',
  burla: 'travieso',
  juguet: 'travieso',
  guino: 'travieso',
  sorprendido: 'sorpresa',
  asombro: 'sorpresa',
  startle: 'sorpresa',
  curiosidad: 'curioso',
  duda: 'pensando',
  thinking: 'pensando',
  estres: 'preocupado',
  concerned: 'preocupado',
  alerta: 'preocupado',
  sad: 'triste',
  enojo: 'molesto',
  enojado: 'molesto',
  enojo_juego: 'travieso',
  enojo_real: 'molesto',
  angry: 'molesto',
  furia: 'molesto',
  tired: 'cansado',
  sueno: 'cansado',
  carinoso: 'carino',
  ternura: 'carino',
  carinho: 'carino',
  orgulloso: 'orgullo',
  cantando: 'canto',
  singing: 'canto',
  orando: 'oracion',
  rezando: 'oracion',
  oracion: 'oracion',
  prayer: 'oracion',
  esceptico: 'escepticismo',
  dudoso: 'escepticismo',
  incredulo: 'escepticismo',
  skeptical: 'escepticismo',
  desconfianza: 'escepticismo',
  alarmado: 'alarma',
  urgente: 'alarma',
  peligro: 'alarma',
  alarm: 'alarma',
  firmeza: 'firme',
  rotundo: 'firme',
  tajante: 'firme',
  firm: 'firme',
  sobrio: 'seco',
  cortante: 'seco',
  operativo: 'seco',
  dry: 'seco',
};

function fold(s: string) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

export function normalizarEmocion(raw: unknown): Emocion {
  const k = fold(String(raw || '')).replace(/[\s-]+/g, '_');
  if ((EMOCIONES as readonly string[]).includes(k)) return k as Emocion;
  if (ALIAS[k]) return ALIAS[k];
  for (const [a, e] of Object.entries(ALIAS)) if (k.startsWith(a)) return e;
  return 'neutral';
}

/** Separa `[EMO:x]` (o etiquetas viejas) del texto. Nunca deja corchetes iniciales para la voz. */
export function extraerEmocion(texto: string): { emocion: Emocion; texto: string; explicita: boolean } {
  let t = String(texto || '');
  const m = t.match(RE_EMO);
  if (m) {
    return { emocion: normalizarEmocion(m[1]), texto: t.slice(m[0].length).trim(), explicita: true };
  }
  const legacy = t.match(RE_LEGACY);
  if (legacy) {
    const inner = legacy[0].replace(/[\[\]]/g, '').replace(/^TONO:?\s*/i, '');
    t = t.slice(legacy[0].length).trim();
    return { emocion: normalizarEmocion(inner), texto: t, explicita: true };
  }
  return { emocion: inferirEmocion(t), texto: t.trim(), explicita: false };
}

/** Cuando el modelo olvidó la etiqueta: heurística ligera, nunca inventa drama. */
export function inferirEmocion(texto: string): Emocion {
  const t = fold(texto);
  if (!t) return 'neutral';
  if (/\bje ?je\b|\bja ?ja\b|\[laughs?\]|\[chuckles?\]/.test(t)) return 'risa';
  if (/\bcay[oó]\b|\bno responde\b|\briesgo\b|\bcuidado\b|\bproblema\b|\bno pude\b/.test(t)) return 'preocupado';
  if (/\blo siento\b|\blamento\b|\bp[eé]same\b/.test(t)) return 'triste';
  if (/^(mmm|d[eé]jame ver|un segundo|a ver)/.test(t)) return 'pensando';
  if (/\bfelicidades\b|\bexcelente\b|\bqu[eé] bueno\b|\bbien hecho\b/.test(t)) return 'feliz';
  if (/\bvaya\b|\bno me digas\b|\ben serio\b|\bwow\b/.test(t)) return 'sorpresa';
  if (/\?\s*$/.test(t) && t.length < 90) return 'curioso';
  return 'neutral';
}

/**
 * La instrucción del system, con la paleta de ESA plataforma y sus ejemplos.
 *
 * Los ejemplos importan tanto como la lista: un modelo copia el registro de lo que ve. Poner
 * ejemplos de ULTRON en el prompt de Dr Electrum le enseña a hablar como ULTRON, que es justo lo
 * que no queremos.
 */
export function instruccionEmocion(plataforma: 'ultron' | 'electrum' = 'ultron'): string {
  const paleta = PALETA[plataforma];
  const ejemplos =
    plataforma === 'electrum'
      ? '«[EMO:escepticismo] Ese número no me cuadra con la ley que me diste antes.» · «[EMO:alarma] Ojo, esa presa está aguas arriba del pueblo.» · «[EMO:seco] Cuatrocientas un hectáreas, medidas sobre el elipsoide.» · «[EMO:firme] Un recurso inferido no es una reserva. Eso no lo voy a decir de otra forma.»'
      : '«[EMO:risa] Je, eso no me lo esperaba.» · «[EMO:preocupado] El ojo no responde desde hace un rato.» · «[EMO:pensando] Mmm… déjame comparar los dos números.»';
  return [
    `EMOCIÓN (obligatorio): abre SIEMPRE la respuesta con una etiqueta [EMO:x] y nada más en esa línea, donde x es una de: ${paleta.join(', ')}.`,
    'Elige la que de verdad sientes por lo que pasó en este turno, no la que queda bonita.',
    `Después de la etiqueta habla normal. Ejemplos: ${ejemplos}`,
    'Nunca expliques la etiqueta ni la leas en voz alta.',
  ].join(' ');
}

/** La de ULTRON, que es la que ya usaban media docena de módulos. */
export const INSTRUCCION_EMOCION = instruccionEmocion('ultron');
