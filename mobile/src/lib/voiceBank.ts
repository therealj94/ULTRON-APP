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
  | 'puedo'
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
  | 'triste'
  | 'cansado'
  | 'carino'
  | 'molesto'
  | 'orgullo'
  | 'sorpresa'
  | 'oracion'
  | 'waymaker'
  | 'bienvenida'
  | 'felizdia'
  | 'bendicion'
  | 'cuna'
  | 'bienvenido'
  | 'vertejose'
  | 'vertemedardo'
  | 'holadenuevo'
  | 'unmomento'
  | 'sinconexion'
  | 'hastaluego'
  | 'denada'
  | 'vertecarlos'
  | 'vertemayra'
  | 'mealegra'
  | 'dameunsegundo'
  | 'claroquesi'
  | 'congusto'
  | 'perfecto'
  | 'yaesta'
  | 'aquilotenes'
  | 'noentendi'
  | 'cuandoquieras'
  | 'quedescanses'
  | 'risacorta'
  | 'jepicara'
  | 'sorpresaoh'
  | 'mmmpensando'
  | 'aww'
  | 'bostezo'
  | 'risatierna'
  | 'asombro'
  | 'hmm';

export const CLIP_IDS: readonly ClipId[] = ['mmm', 'je', 'uy', 'vale', 'entendido', 'dias', 'tardes', 'noches', 'calenta', 'listos', 'puedo', 'chiste1', 'chiste2', 'chiste3', 'chiste4', 'chiste5', 'bruno', 'bohemian', 'ligera', 'bittersweet', 'runaway', 'jesus', 'risa1', 'risa2', 'mmm2', 'uy2', 'aqui', 'listo', 'yaya', 'gracias', 'hola', 'despertar', 'triste', 'cansado', 'carino', 'molesto', 'orgullo', 'sorpresa', 'oracion', 'waymaker', 'bienvenida', 'felizdia', 'bendicion', 'cuna', 'bienvenido', 'vertejose', 'vertemedardo', 'holadenuevo', 'unmomento', 'sinconexion', 'hastaluego', 'denada', 'vertecarlos', 'vertemayra', 'mealegra', 'dameunsegundo', 'claroquesi', 'congusto', 'perfecto', 'yaesta', 'aquilotenes', 'noentendi', 'cuandoquieras', 'quedescanses', 'risacorta', 'jepicara', 'sorpresaoh', 'mmmpensando', 'aww', 'bostezo', 'risatierna', 'asombro', 'hmm'];

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
  bienvenido: require('../../assets/voice/bienvenido.mp3'),
  vertejose: require('../../assets/voice/vertejose.mp3'),
  vertemedardo: require('../../assets/voice/vertemedardo.mp3'),
  holadenuevo: require('../../assets/voice/holadenuevo.mp3'),
  unmomento: require('../../assets/voice/unmomento.mp3'),
  sinconexion: require('../../assets/voice/sinconexion.mp3'),
  hastaluego: require('../../assets/voice/hastaluego.mp3'),
  denada: require('../../assets/voice/denada.mp3'),
  risacorta: require('../../assets/voice/risacorta.mp3'),
  jepicara: require('../../assets/voice/jepicara.mp3'),
  sorpresaoh: require('../../assets/voice/sorpresaoh.mp3'),
  mmmpensando: require('../../assets/voice/mmmpensando.mp3'),
  aww: require('../../assets/voice/aww.mp3'),
  bostezo: require('../../assets/voice/bostezo.mp3'),
};

/** Ruta remota de cada clip (Render sirve /voz/<id>.mp3; las expresiones, /voz/expresiones/<toma>.mp3). */
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
  puedo: '/voz/puedo.mp3',
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
  triste: '/voz/triste.mp3',
  cansado: '/voz/cansado.mp3',
  carino: '/voz/carino.mp3',
  molesto: '/voz/molesto.mp3',
  orgullo: '/voz/orgullo.mp3',
  sorpresa: '/voz/sorpresa.mp3',
  oracion: '/voz/oracion.mp3',
  waymaker: '/voz/waymaker.mp3',
  bienvenida: '/voz/bienvenida.mp3',
  felizdia: '/voz/felizdia.mp3',
  bendicion: '/voz/bendicion.mp3',
  cuna: '/voz/cuna.mp3',
  bienvenido: '/voz/bienvenido.mp3',
  vertejose: '/voz/vertejose.mp3',
  vertemedardo: '/voz/vertemedardo.mp3',
  holadenuevo: '/voz/holadenuevo.mp3',
  unmomento: '/voz/unmomento.mp3',
  sinconexion: '/voz/sinconexion.mp3',
  hastaluego: '/voz/hastaluego.mp3',
  denada: '/voz/denada.mp3',
  vertecarlos: '/voz/vertecarlos.mp3',
  vertemayra: '/voz/vertemayra.mp3',
  mealegra: '/voz/mealegra.mp3',
  dameunsegundo: '/voz/dameunsegundo.mp3',
  claroquesi: '/voz/claroquesi.mp3',
  congusto: '/voz/congusto.mp3',
  perfecto: '/voz/perfecto.mp3',
  yaesta: '/voz/yaesta.mp3',
  aquilotenes: '/voz/aquilotenes.mp3',
  noentendi: '/voz/noentendi.mp3',
  cuandoquieras: '/voz/cuandoquieras.mp3',
  quedescanses: '/voz/quedescanses.mp3',
  risacorta: '/voz/expresiones/risa-corta-1.mp3',
  jepicara: '/voz/expresiones/je-picara-1.mp3',
  sorpresaoh: '/voz/expresiones/sorpresa-oh-1.mp3',
  mmmpensando: '/voz/expresiones/mmm-pensando-2.mp3',
  aww: '/voz/expresiones/aww-ternura-1.mp3',
  bostezo: '/voz/expresiones/bostezo-1.mp3',
  risatierna: '/voz/expresiones/risa-tierna-1.mp3',
  asombro: '/voz/expresiones/asombro-gasp-2.mp3',
  hmm: '/voz/expresiones/hmm-dudando-1.mp3',
};

/** Qué dice cada clip (burbuja y fallback a TTS si el clip no responde audio). */
export const CLIP_TEXT: Record<ClipId, string> = {
  mmm: "Mmm… déjame ver.",
  je: "Je, je.",
  uy: "Uy.",
  vale: "Vale, jefe.",
  entendido: "Entendido.",
  dias: "Buenos días, José. Estoy lista. ¿En qué te ayudo?",
  tardes: "Buenas tardes, José. Estoy lista. ¿En qué te ayudo?",
  noches: "Buenas noches, José. Estoy lista. ¿En qué te ayudo?",
  calenta: "Espera. Estamos calentando el motor de veintisiete B.",
  listos: "Estamos listos.",
  puedo: "Esto es lo que puedo hacer.",
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
  jesus: "Quiero conocer a Jesús — Generación 12 (versión de AU-RA).",
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
  triste: "Ay…",
  cansado: "Aaah…",
  carino: "Mmm… gracias.",
  molesto: "Oye…",
  orgullo: "Eso se nota.",
  sorpresa: "¡Uy!",
  oracion: "Oración por el día.",
  waymaker: "Way Maker — Sinach (versión de AU-RA).",
  bienvenida: "Bienvenidos a AU-RA — canción de AU-RA.",
  felizdia: "Feliz día — canción de AU-RA.",
  bendicion: "Bendición — canción de AU-RA.",
  cuna: "Duerme, duerme — canción de cuna de AU-RA.",
  bienvenido: "Bienvenido a AU-RA. ¿En qué te ayudo?",
  vertejose: "Qué bueno verte, José.",
  vertemedardo: "Qué bueno verte, Medardo.",
  holadenuevo: "Hola de nuevo.",
  unmomento: "Un momento.",
  sinconexion: "Estoy sin conexión ahora mismo.",
  hastaluego: "Hasta luego.",
  denada: "De nada.",
  vertecarlos: "Qué bueno verte, Carlos.",
  vertemayra: "Qué bueno verte, Mayra.",
  mealegra: "Me alegra verte.",
  dameunsegundo: "Dame un segundo, lo busco.",
  claroquesi: "Claro que sí.",
  congusto: "Con gusto.",
  perfecto: "Perfecto.",
  yaesta: "Ya está.",
  aquilotenes: "Aquí lo tenés.",
  noentendi: "No te entendí bien, ¿me lo repetís?",
  cuandoquieras: "Cuando quieras.",
  quedescanses: "Que descanses.",
  risacorta: "Ji, ji, ji.",
  jepicara: "Je, je, je.",
  sorpresaoh: "Oh.",
  mmmpensando: "Mmm.",
  aww: "Aww.",
  bostezo: "Aaah…",
  risatierna: "Ji, ji.",
  asombro: "Ah.",
  hmm: "Mmm, no sé.",
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
  // Buenos días, José. Estoy lista. ¿En qué te ayudo?
  "buenosdiasjoseestoylistaenqueteayudo": 'dias',
  // Buenas tardes, José. Estoy lista. ¿En qué te ayudo?
  "buenastardesjoseestoylistaenqueteayudo": 'tardes',
  // Buenas noches, José. Estoy lista. ¿En qué te ayudo?
  "buenasnochesjoseestoylistaenqueteayudo": 'noches',
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
  // Bienvenido a AU-RA. ¿En qué te ayudo?
  "bienvenidoaauraenqueteayudo": 'bienvenido',
  // Qué bueno verte, José.
  "quebuenovertejose": 'vertejose',
  // Qué bueno verte, Medardo.
  "quebuenovertemedardo": 'vertemedardo',
  // Hola de nuevo.
  "holadenuevo": 'holadenuevo',
  // Un momento.
  "unmomento": 'unmomento',
  // Estoy sin conexión ahora mismo.
  "estoysinconexionahoramismo": 'sinconexion',
  // Hasta luego.
  "hastaluego": 'hastaluego',
  // De nada.
  "denada": 'denada',
  // Qué bueno verte, Carlos.
  "quebuenovertecarlos": 'vertecarlos',
  // Qué bueno verte, Mayra.
  "quebuenovertemayra": 'vertemayra',
  // Me alegra verte.
  "mealegraverte": 'mealegra',
  // Dame un segundo, lo busco.
  "dameunsegundolobusco": 'dameunsegundo',
  // Claro que sí.
  "claroquesi": 'claroquesi',
  // Con gusto.
  "congusto": 'congusto',
  // Perfecto.
  "perfecto": 'perfecto',
  // Ya está.
  "yaesta": 'yaesta',
  // Aquí lo tenés.
  "aquilotenes": 'aquilotenes',
  // No te entendí bien, ¿me lo repetís?
  "noteentendibienmelorepetis": 'noentendi',
  // Cuando quieras.
  "cuandoquieras": 'cuandoquieras',
  // Que descanses.
  "quedescanses": 'quedescanses',
};

export const BUNDLED_CLIP_IDS: readonly ClipId[] = ['mmm', 'je', 'uy', 'vale', 'entendido', 'dias', 'tardes', 'noches', 'calenta', 'listos', 'bienvenido', 'vertejose', 'vertemedardo', 'holadenuevo', 'unmomento', 'sinconexion', 'hastaluego', 'denada', 'risacorta', 'jepicara', 'sorpresaoh', 'mmmpensando', 'aww', 'bostezo'];
