/**
 * Emoción de AU-RA — copia cliente del contrato del servidor (lib/emocion.ts).
 * El servidor manda `emocion` en /api/turno (JSON) y como evento SSE `emocion` en /api/turno/stream;
 * la cara la traduce a un FaceState y la voz la recibe en /api/tts?emocion=.
 */
import type { FaceState } from '../config';

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
  if (legacy) return { texto: t.slice(legacy[0].length), emocion: null };
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
