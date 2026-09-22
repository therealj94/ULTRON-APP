/* Generado por scripts/build-voice-bank.mjs — no editar a mano. */
/* eslint-disable */

export type ClipId =
  | 'mmm'
  | 'je'
  | 'uy'
  | 'vale'
  | 'entendido'
  | 'dias'
  | 'tardes'
  | 'noches'
  | 'calenta'
  | 'listos'
  | 'quien'
  | 'puedo'
  | 'discurso'
  | 'chiste1'
  | 'chiste2'
  | 'chiste3'
  | 'chiste4'
  | 'chiste5'
  | 'bruno'
  | 'bohemian'
  | 'ligera'
  | 'bittersweet'
  | 'runaway'
  | 'jesus'
  | 'risa1'
  | 'risa2'
  | 'mmm2'
  | 'uy2'
  | 'aqui'
  | 'listo'
  | 'yaya'
  | 'gracias'
  | 'hola'
  | 'despertar'
  | 'bienvenida'
  | 'triste'
  | 'cansado'
  | 'carino'
  | 'molesto'
  | 'orgullo'
  | 'sorpresa'
  | 'oracion'
  | 'waymaker';

export const CLIP_IDS: readonly ClipId[] = ['mmm', 'je', 'uy', 'vale', 'entendido', 'dias', 'tardes', 'noches', 'calenta', 'listos', 'quien', 'puedo', 'discurso', 'chiste1', 'chiste2', 'chiste3', 'chiste4', 'chiste5', 'bruno', 'bohemian', 'ligera', 'bittersweet', 'runaway', 'jesus', 'risa1', 'risa2', 'mmm2', 'uy2', 'aqui', 'listo', 'yaya', 'gracias', 'hola', 'despertar', 'bienvenida', 'triste', 'cansado', 'carino', 'molesto', 'orgullo', 'sorpresa', 'oracion', 'waymaker'];

export function bankKey(t: string): string {
  return String(t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, '');
}

/** Clips empaquetados en el APK (assets/voice). Suenan sin red. */
export const VOICE_BANK: Partial<Record<ClipId, number>> = {
  mmm: require('../../assets/voice/mmm.mp3'),
  je: require('../../assets/voice/je.mp3'),
  uy: require('../../assets/voice/uy.mp3'),
  vale: require('../../assets/voice/vale.mp3'),
  entendido: require('../../assets/voice/entendido.mp3'),
  dias: require('../../assets/voice/dias.mp3'),
  tardes: require('../../assets/voice/tardes.mp3'),
  noches: require('../../assets/voice/noches.mp3'),
  calenta: require('../../assets/voice/calenta.mp3'),
  listos: require('../../assets/voice/listos.mp3'),
};

/** Ruta remota de cada clip (Render sirve /voz/<id>.mp3). */
export const REMOTE_CLIPS: Record<ClipId, string> = {
  mmm: '/voz/mmm.mp3',
  je: '/voz/je.mp3',
  uy: '/voz/uy.mp3',
  vale: '/voz/vale.mp3',
  entendido: '/voz/entendido.mp3',
  dias: '/voz/dias.mp3',
  tardes: '/voz/tardes.mp3',
  noches: '/voz/noches.mp3',
  calenta: '/voz/calenta.mp3',
  listos: '/voz/listos.mp3',
  quien: '/voz/quien.mp3',
  puedo: '/voz/puedo.mp3',
  discurso: '/voz/discurso.mp3',
  chiste1: '/voz/chiste1.mp3',
  chiste2: '/voz/chiste2.mp3',
  chiste3: '/voz/chiste3.mp3',
  chiste4: '/voz/chiste4.mp3',
  chiste5: '/voz/chiste5.mp3',
  bruno: '/voz/bruno.mp3',
  bohemian: '/voz/bohemian.mp3',
  ligera: '/voz/ligera.mp3',
  bittersweet: '/voz/bittersweet.mp3',
  runaway: '/voz/runaway.mp3',
  jesus: '/voz/jesus.mp3',
  risa1: '/voz/risa1.mp3',
  risa2: '/voz/risa2.mp3',
  mmm2: '/voz/mmm2.mp3',
  uy2: '/voz/uy2.mp3',
  aqui: '/voz/aqui.mp3',
  listo: '/voz/listo.mp3',
  yaya: '/voz/yaya.mp3',
  gracias: '/voz/gracias.mp3',
  hola: '/voz/hola.mp3',
  despertar: '/voz/despertar.mp3',
  bienvenida: '/voz/bienvenida.mp3',
  triste: '/voz/triste.mp3',
  cansado: '/voz/cansado.mp3',
  carino: '/voz/carino.mp3',
  molesto: '/voz/molesto.mp3',
  orgullo: '/voz/orgullo.mp3',
  sorpresa: '/voz/sorpresa.mp3',
  oracion: '/voz/oracion.mp3',
  waymaker: '/voz/waymaker.mp3',
};

/** Qué dice cada clip (burbuja y fallback a TTS si el clip no responde audio). */
export const CLIP_TEXT: Record<ClipId, string> = {
  mmm: "Mmm… déjame ver.",
  je: "Je, je.",
  uy: "Uy.",
  vale: "Vale, jefe.",
  entendido: "Entendido.",
  dias: "Buenos días, José. Estoy listo. ¿En qué te ayudo?",
  tardes: "Buenas tardes, José. Estoy listo. ¿En qué te ayudo?",
  noches: "Buenas noches, José. Estoy listo. ¿En qué te ayudo?",
  calenta: "Espera. Estamos calentando el motor de veintisiete B.",
  listos: "Estamos listos.",
  quien: "Soy AU-RA, la mesa de Orden Global.",
  puedo: "Esto es lo que puedo hacer.",
  discurso: "El discurso de AU-RA.",
  chiste1: "Chiste uno.",
  chiste2: "Chiste dos.",
  chiste3: "Chiste tres.",
  chiste4: "Chiste cuatro.",
  chiste5: "Chiste cinco.",
  bruno: "Die With A Smile — Bruno Mars.",
  bohemian: "Bohemian Rhapsody — Queen.",
  ligera: "De música ligera — Soda Stereo.",
  bittersweet: "Bitter Sweet Symphony — The Verve.",
  runaway: "Runaway — Kanye West.",
  jesus: "Quiero conocer a Jesús — Generación 12.",
  risa1: "Jajaja.",
  risa2: "Jeje, jajaja.",
  mmm2: "Mmm…",
  uy2: "Uy…",
  aqui: "Aquí estoy.",
  listo: "Listo.",
  yaya: "Ya, ya.",
  gracias: "Gracias.",
  hola: "Hola.",
  despertar: "Ya despierto.",
  bienvenida: "Bienvenido a la mesa.",
  triste: "Ay…",
  cansado: "Aaah…",
  carino: "Mmm… gracias.",
  molesto: "Oye…",
  orgullo: "Eso se nota.",
  sorpresa: "¡Uy!",
  oracion: "Oración por el día.",
  waymaker: "Way Maker — Sinach.",
};

/** Frase exacta (bankKey) → clip, para que speak() use el clip en vez de pedir TTS. */
export const PHRASE_TO_CLIP: Record<string, ClipId> = {
  // Déjame ver.
  "dejamever": 'mmm',
  // Mmm… déjame ver.
  "mmmdejamever": 'mmm',
  // Mmm.
  "mmm": 'mmm',
  // Jeje.
  "jeje": 'je',
  // Uy.
  "uy": 'uy',
  // Vale, jefe.
  "valejefe": 'vale',
  // Vale.
  "vale": 'vale',
  // Entendido.
  "entendido": 'entendido',
  // Buenos días, José. Estoy listo. ¿En qué te ayudo?
  "buenosdiasjoseestoylistoenqueteayudo": 'dias',
  // Buenas tardes, José. Estoy listo. ¿En qué te ayudo?
  "buenastardesjoseestoylistoenqueteayudo": 'tardes',
  // Buenas noches, José. Estoy listo. ¿En qué te ayudo?
  "buenasnochesjoseestoylistoenqueteayudo": 'noches',
  // Espera. Estamos calentando el motor de veintisiete B.
  "esperaestamoscalentandoelmotordeveintisieteb": 'calenta',
  // Estamos listos.
  "estamoslistos": 'listos',
  // Jajaja.
  "jajaja": 'risa1',
  // Jaja.
  "jaja": 'risa1',
  // Aquí estoy.
  "aquiestoy": 'aqui',
  // Listo.
  "listo": 'listo',
  // Ya, ya.
  "yaya": 'yaya',
  // Gracias.
  "gracias": 'gracias',
  // Hola.
  "hola": 'hola',
};

export const BUNDLED_CLIP_IDS: readonly ClipId[] = ['mmm', 'je', 'uy', 'vale', 'entendido', 'dias', 'tardes', 'noches', 'calenta', 'listos'];
