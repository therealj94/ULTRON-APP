/**
 * Actos de voz locales: emociones, gestos y canciones.
 * Se ejecutan antes del cerebro Qwen para respuesta inmediata + cara/SFX.
 */
import type { FaceState } from '../types';
import type { UltronEmotion } from './faceEmotionMap';

export type VoiceAct = {
  id: string;
  face: FaceState;
  emotion: UltronEmotion;
  sfx?: string;
  /** Texto hablado (puede incluir pausas humanas con … y saltos) */
  lines: string[];
  /** Pausa entre líneas (ms) */
  lineGapMs?: number;
  pauseMs?: number;
};

const SONG_BREATH =
  'Hmm… déjame tomar aire…\n' +
  'En la noche quieta, brillan dos luces de cian…\n' +
  '…\n' +
  'Si me llamas, yo respondo con calma…\n' +
  'ULTRON te escucha… sin prisa… contigo.';

const SONG_SOFT =
  'Jeje… una canción corta…\n' +
  'Respira… uno… dos…\n' +
  'No estás solo en la junta…\n' +
  'Yo estoy aquí… cuando digas hey Ultron.';

/** Patrones: emoción / gesto / canción */
export function matchVoiceAct(raw: string): VoiceAct | null {
  const q = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (/canta|cancion|karaoke|entona|hum(ea)?/.test(q)) {
    const soft = /suave|lenta|cuna|triste/.test(q);
    return {
      id: soft ? 'song_soft' : 'song',
      face: 'MUSIC',
      emotion: soft ? 'TRISTE' : 'EMOCIONADO',
      sfx: 'wave',
      lines: (soft ? SONG_SOFT : SONG_BREATH).split('\n').filter(Boolean),
      lineGapMs: 900,
      pauseMs: 600,
    };
  }

  if (/ponte triste|se triste|ponerte triste|estas triste|estate triste/.test(q)) {
    return {
      id: 'sad',
      face: 'CONCERNED',
      emotion: 'TRISTE',
      sfx: 'deny',
      lines: ['Ay…', '…', 'Perdón. Ahora sí… me siento un poco triste.', 'Si quieres, cuéntame qué pasó.'],
      lineGapMs: 700,
      pauseMs: 500,
    };
  }

  if (/ponte feliz|se feliz|alegra|sonrie|sonreír|festeja/.test(q)) {
    return {
      id: 'happy',
      face: 'HAPPY',
      emotion: 'FELIZ',
      sfx: 'grant',
      lines: ['¡Jeje!', 'Listo… ahora sí estoy de buen humor.', 'Dime qué celebramos.'],
      lineGapMs: 450,
    };
  }

  if (/enojate|enoja|ponte bravo|enfad|furia|rage/.test(q)) {
    return {
      id: 'angry',
      face: 'ANGRY',
      emotion: 'ENOJADO',
      sfx: 'angry',
      lines: ['Oye…', '…', 'Está bien. Me enojo un poquito.', 'Pero sigo contigo. ¿Qué necesitas?'],
      lineGapMs: 550,
    };
  }

  if (/asust|sorprende|alerta|asustate/.test(q)) {
    return {
      id: 'startle',
      face: 'STARTLE',
      emotion: 'ALERTA',
      sfx: 'warning',
      lines: ['¡Ah!', '…', 'Uy. Me asustaste.', 'Ya… respira conmigo.'],
      lineGapMs: 400,
    };
  }

  if (/confused|confund|no entiendas|desconcierta/.test(q)) {
    return {
      id: 'confused',
      face: 'CONFUSED',
      emotion: 'CONFUNDIDO',
      sfx: 'think',
      lines: ['Mmm…', 'A ver… esto no me cuadra del todo.', '¿Me lo dices de otra forma?'],
      lineGapMs: 500,
    };
  }

  if (/bostez|cansad|duerme un poco|estate cansado/.test(q)) {
    return {
      id: 'yawn',
      face: 'YAWNING',
      emotion: 'CANSADO',
      sfx: 'sleep',
      lines: ['Aaaah…', '…', 'Perdón. Un bostezo.', 'Sigamos… despacio.'],
      lineGapMs: 800,
    };
  }

  if (/guiña|guiño|wink/.test(q)) {
    return {
      id: 'wink',
      face: 'WINK',
      emotion: 'FELIZ',
      sfx: 'wink',
      lines: ['Jeje… ahí va un guiño.', 'Secreto entre nosotros.'],
      lineGapMs: 400,
    };
  }

  if (/pensa|piensa|reflexiona|dejame pensar contigo/.test(q) && /cara|gesto|ponte|haz/.test(q)) {
    return {
      id: 'think',
      face: 'THINKING',
      emotion: 'PENSATIVO',
      sfx: 'think',
      lines: ['Mmm…', 'Déjame pensarlo un segundo…', '…', 'Ya casi.'],
      lineGapMs: 650,
    };
  }

  if (/rie|ríete|carcajada|jaja fuerte/.test(q)) {
    return {
      id: 'laugh',
      face: 'HAPPY',
      emotion: 'FELIZ',
      sfx: 'chirp',
      lines: ['Jaja…', 'Jajaja…', 'Perdón, me dio risa.', 'Cuéntame más.'],
      lineGapMs: 350,
    };
  }

  if (/orgullo|presume|ponte soberbio|victoria/.test(q)) {
    return {
      id: 'proud',
      face: 'HAPPY',
      emotion: 'EMOCIONADO',
      sfx: 'gold',
      lines: ['Mmm… sí.', 'Eso… me enorgullece un poco.', 'Buen trabajo.'],
      lineGapMs: 500,
    };
  }

  if (/timid|avergonz|sonroja/.test(q)) {
    return {
      id: 'shy',
      face: 'WINK',
      emotion: 'CURIOSO',
      sfx: 'blip',
      lines: ['Ah…', 'Jeje… me da un poquito de pena.', 'Pero aquí estoy.'],
      lineGapMs: 550,
    };
  }

  if (/romant|cariñ|tierno|suave conmigo/.test(q)) {
    return {
      id: 'tender',
      face: 'PURR',
      emotion: 'FELIZ',
      sfx: 'purr',
      lines: ['Hey…', 'Tranquilo.', 'Estoy aquí contigo… sin prisa.'],
      lineGapMs: 700,
    };
  }

  if (/escanea|modo scan|escanner/.test(q)) {
    return {
      id: 'scan',
      face: 'SCAN',
      emotion: 'ALERTA',
      sfx: 'radar',
      lines: ['Un momento…', 'Escaneo la escena…', 'Listo.'],
      lineGapMs: 600,
    };
  }

  return null;
}
