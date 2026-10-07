/**
 * Emoción de AU-RA — copia cliente del contrato del servidor (lib/emocion.ts).
 * El servidor manda `emocion` en /api/turno (JSON) y como evento SSE `emocion` en /api/turno/stream;
 * la cara la traduce a un FaceState y la voz la recibe en /api/tts?emocion=.
 */
import type { FaceState } from '../caraTipos';
import { expresionDe } from './expresiones';

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

const ALIAS: Record<string, Emocion> = {
  neutro: 'neutral',
  calma: 'neutral',
  idle: 'neutral',
  serio: 'neutral',
  alegre: 'feliz',
  contento: 'feliz',
  happy: 'feliz',
  rie: 'risa',
  riendo: 'risa',
  burla: 'travieso',
  guino: 'travieso',
  sorprendido: 'sorpresa',
  asombro: 'sorpresa',
  startle: 'sorpresa',
  curiosidad: 'curioso',
  duda: 'pensando',
  thinking: 'pensando',
  concerned: 'preocupado',
  alerta: 'preocupado',
  sad: 'triste',
  enojo: 'molesto',
  enojado: 'molesto',
  angry: 'molesto',
  tired: 'cansado',
  sueno: 'cansado',
  carinoso: 'carino',
  ternura: 'carino',
  orgulloso: 'orgullo',
  cantando: 'canto',
};

function fold(s: string) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function normalizarEmocion(raw: unknown): Emocion {
  const k = fold(String(raw || '')).replace(/[\s-]+/g, '_');
  if ((EMOCIONES as readonly string[]).includes(k)) return k as Emocion;
  if (ALIAS[k]) return ALIAS[k];
  for (const [a, e] of Object.entries(ALIAS)) if (k.startsWith(a)) return e;
  return 'neutral';
}

const RE_EMO = /^\s*\[\s*EMO\s*:\s*([a-záéíóúñ_ -]+?)\s*\]\s*/i;
/** Etiquetas viejas ([IDLE], [BURLA]…) o cualquier corchete inicial de una sola palabra. */
const RE_TAG = /^\s*\[[A-Za-zÁÉÍÓÚÑáéíóúñ_ :-]{2,24}\]\s*/;

/**
 * El servidor ya quita `[EMO:x]`, pero por si llega un servidor viejo: separa la etiqueta inicial del
 * texto. Devuelve la emoción solo si venía como [EMO:x]; una etiqueta suelta ([IDLE]) se descarta.
 */
export function pelarEtiqueta(texto: string): { texto: string; emocion: Emocion | null } {
  const t = String(texto || '');
  const m = t.match(RE_EMO);
  if (m) return { texto: t.slice(m[0].length), emocion: normalizarEmocion(m[1]) };
  const legacy = t.match(RE_TAG);
  // Una expresión de voz al principio («[risa] Ay, no») no es una etiqueta vieja: se queda para que suene.
  if (legacy && !expresionDe(legacy[0].trim().slice(1, -1))) return { texto: t.slice(legacy[0].length), emocion: null };
  return { texto: t, emocion: null };
}

/** Emoción → cara mientras habla. `neutral` es SPEAKING (boca en movimiento) y al callar vuelve a IDLE. */
export function faceForEmocion(e: Emocion | null | undefined): FaceState {
  switch (e) {
    case 'feliz':
    case 'carino':
      return 'HAPPY';
    case 'risa':
      return 'LAUGH';
    case 'sorpresa':
      return 'SURPRISED';
    case 'curioso':
      return 'CURIOUS';
    case 'pensando':
      return 'THINKING';
    case 'preocupado':
      return 'CONCERNED';
    case 'triste':
      return 'SAD';
    case 'molesto':
      return 'ANGRY';
    case 'cansado':
      return 'TIRED';
    case 'orgullo':
      return 'PROUD';
    case 'travieso':
      return 'WINK';
    case 'canto':
      return 'SING';
    case 'oracion':
      return 'PRAY';
    default:
      return 'SPEAKING';
  }
}

/*
 * La emoción de una frase cuando nadie la manda. En la conversación fluida la voz es de ElevenLabs y
 * el turno no trae `emocion`: la compañera la deduce del texto para poner la cara que va con lo que
 * dice. Palabras claras en español e inglés, en orden de fuerza (la risa gana a la alegría, la pena
 * gana a todo); sin nada claro, una pregunta es curiosidad y un «¡…!» es alegría.
 */
const PISTAS: readonly (readonly [Emocion, RegExp])[] = [
  ['risa', /\b(ja(ja)+|je(je)+|ji(ji)+|ha(ha)+|lol)\b|\[(risa|risita|je)\]|que risa|me muero de risa/],
  ['triste', /\b(lo siento mucho|lo lamento|lamento|que pena|que tristeza|triste|falleci\w*|sorry to hear|so sorry|sad)\b/],
  ['molesto', /\b(que rabia|me molesta|me enoja|enojad\w*|basta ya|no es justo|angry|annoying)\b/],
  ['preocupado', /\b(cuidado|ojo con|peligro\w*|preocup\w*|urgente|careful|warning|danger\w*|worried)\b/],
  ['sorpresa', /\b(wow|guau|vaya|increible|no me digas|en serio|whoa|no way|amazing)\b|¡no!|de verdad\?|really\?/],
  ['pensando', /\b(dejame (ver|pensar)|a ver|veamos|mmm+|hmm+|let me (see|think)|lets see)\b/],
  ['carino', /\b(te quiero|carino|un abrazo|abrazo|love you|hugs?)\b/],
  ['feliz', /\b(genial|excelente|perfecto|que bien|me alegra|listo|claro que si|con gusto|felicidades|bravo|great|awesome|perfect|glad|done|congrat\w*|wonderful)\b/],
];

export function emocionDeTexto(texto: string): Emocion {
  const t = fold(texto);
  if (!t) return 'neutral';
  for (const [e, re] of PISTAS) if (re.test(t)) return e;
  if (/\?\s*$/.test(t)) return 'curioso';
  if (/!\s*$/.test(t)) return 'feliz';
  return 'neutral';
}

export const EMOCION_ETIQUETA: Record<Emocion, string> = {
  neutral: 'Sereno',
  feliz: 'Contento',
  risa: 'Riéndose',
  sorpresa: 'Sorprendido',
  curioso: 'Curioso',
  pensando: 'Pensando',
  preocupado: 'Preocupado',
  triste: 'Triste',
  molesto: 'Molesto',
  cansado: 'Cansado',
  carino: 'Cariñoso',
  orgullo: 'Orgulloso',
  travieso: 'Travieso',
  canto: 'Cantando',
  oracion: 'Orando',
};
