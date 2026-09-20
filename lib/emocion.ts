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

/** Instrucción que va al system prompt del 27B. Corta, para no gastar tokens. */
export const INSTRUCCION_EMOCION = `
EMOCIÓN (obligatorio): abre SIEMPRE la respuesta con una etiqueta [EMO:x] y nada más en esa línea, donde x es una de: ${EMOCIONES.join(', ')}. Elige la que de verdad sientes por lo que pasó en este turno, no la que queda bonita. Después de la etiqueta habla normal. Ejemplos: «[EMO:risa] Je, eso no me lo esperaba.» · «[EMO:preocupado] El ojo no responde desde hace un rato.» · «[EMO:pensando] Mmm… déjame comparar los dos números.» Nunca expliques la etiqueta ni la leas en voz alta.
`.trim();
