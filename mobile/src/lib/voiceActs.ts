import type { FaceState } from '../config';

export type VoiceAct = {
  id: string;
  face: FaceState;
  lines: string[];
  lineGapMs?: number;
};

export function matchVoiceAct(raw: string): VoiceAct | null {
  const q = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Canto: lo resuelve src/lib/sing.ts (cuatro ganchos fijos). Aquí solo gestos hablados.
  if (/espada|sable|jedi|lightsaber|sable de luz/.test(q)) {
    return {
      id: 'saber',
      face: 'ANGRY',
      lines: ['Sable listo.', 'Que la fuerza… bueno, que Orden Global te acompañe.'],
      lineGapMs: 280,
    };
  }
  if (/ponte triste|se triste|estas triste|estate triste/.test(q)) {
    return {
      id: 'sad',
      face: 'CONCERNED',
      lines: ['Ay…', 'Vale. Me pongo serio un momento.', 'Si quieres, cuéntame qué pasó.'],
      lineGapMs: 500,
    };
  }
  if (/ponte feliz|se feliz|alegra|sonrie|festeja/.test(q)) {
    return {
      id: 'happy',
      face: 'HAPPY',
      lines: ['¡Jeje!', 'Listo, buen humor encendido.', 'Dime qué celebramos.'],
      lineGapMs: 350,
    };
  }
  if (/enojate|enoja|ponte bravo|enfad|furia/.test(q)) {
    return {
      id: 'angry',
      face: 'ANGRY',
      lines: ['Oye…', 'Está bien. Me enojo un poquito.', 'Pero sigo contigo. ¿Qué necesitas?'],
      lineGapMs: 400,
    };
  }
  if (/asust|sorprende|alerta|asustate/.test(q)) {
    return {
      id: 'startle',
      face: 'STARTLE',
      lines: ['¡Ah!', 'Uy. Me asustaste.', 'Ya… respira conmigo.'],
      lineGapMs: 320,
    };
  }
  if (/confund|desconcierta/.test(q)) {
    return {
      id: 'confused',
      face: 'CONFUSED',
      lines: ['Mmm…', 'Esto no me cuadra del todo.', '¿Me lo dices de otra forma?'],
      lineGapMs: 400,
    };
  }
  if (/bostez|cansad|duerme un poco/.test(q)) {
    return {
      id: 'yawn',
      face: 'YAWNING',
      lines: ['Aaaah…', 'Perdón. Un bostezo.', 'Sigamos, despacio.'],
      lineGapMs: 600,
    };
  }
  if (/guiña|guiño|wink/.test(q)) {
    return {
      id: 'wink',
      face: 'WINK',
      lines: ['Jeje… ahí va un guiño.', 'Secreto entre nosotros.'],
      lineGapMs: 320,
    };
  }
  if (/rie|ríete|carcajada|jaja/.test(q)) {
    return {
      id: 'laugh',
      face: 'HAPPY',
      lines: ['Jaja…', 'Jajaja…', 'Perdón, me dio risa.'],
      lineGapMs: 280,
    };
  }
  if (/quien eres|que eres|presentate/.test(q)) {
    return {
      id: 'who',
      face: 'HAPPY',
      lines: [
        'Soy ULTRON FP, asistente de mesa de Orden Global.',
        'Cámara, voz y memoria. La junta decide; yo ejecuto.',
      ],
      lineGapMs: 380,
    };
  }
  return null;
}

export const SONG_HINT =
  'Puedo cantar balada, ranchera, pop, rock, salsa, cumbia, corrido, jazz o cuna. Dime el género.';
