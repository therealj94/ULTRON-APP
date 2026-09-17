import type { FaceState } from '../config';

export type VoiceAct = {
  id: string;
  face: FaceState;
  lines: string[];
  lineGapMs?: number;
};

export function matchVoiceAct(raw: string): VoiceAct | null {
  const q = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (/canta|cancion|karaoke|entona|hum(ea)?/.test(q)) {
    return {
      id: 'song',
      face: 'MUSIC',
      lines: [
        'Mmm…',
        'Que la noche sea larga…',
        'y el corazón no se apague…',
        'Contigo en el escritorio, ULTRON sigue aquí.',
      ],
      lineGapMs: 900,
    };
  }
  if (/ponte triste|se triste|estas triste|estate triste/.test(q)) {
    return {
      id: 'sad',
      face: 'CONCERNED',
      lines: ['Ay…', 'Perdón. Ahora sí… me siento un poco triste.', 'Si quieres, cuéntame qué pasó.'],
      lineGapMs: 700,
    };
  }
  if (/ponte feliz|se feliz|alegra|sonrie|festeja/.test(q)) {
    return {
      id: 'happy',
      face: 'HAPPY',
      lines: ['¡Jeje!', 'Listo… ahora sí estoy de buen humor.', 'Dime qué celebramos.'],
      lineGapMs: 450,
    };
  }
  if (/enojate|enoja|ponte bravo|enfad|furia/.test(q)) {
    return {
      id: 'angry',
      face: 'ANGRY',
      lines: ['Oye…', 'Está bien. Me enojo un poquito.', 'Pero sigo contigo. ¿Qué necesitas?'],
      lineGapMs: 550,
    };
  }
  if (/asust|sorprende|alerta|asustate/.test(q)) {
    return {
      id: 'startle',
      face: 'STARTLE',
      lines: ['¡Ah!', 'Uy. Me asustaste.', 'Ya… respira conmigo.'],
      lineGapMs: 400,
    };
  }
  if (/confund|desconcierta/.test(q)) {
    return {
      id: 'confused',
      face: 'CONFUSED',
      lines: ['Mmm…', 'Esto no me cuadra del todo.', '¿Me lo dices de otra forma?'],
      lineGapMs: 500,
    };
  }
  if (/bostez|cansad|duerme un poco/.test(q)) {
    return {
      id: 'yawn',
      face: 'YAWNING',
      lines: ['Aaaah…', 'Perdón. Un bostezo.', 'Sigamos… despacio.'],
      lineGapMs: 800,
    };
  }
  if (/guiña|guiño|wink/.test(q)) {
    return {
      id: 'wink',
      face: 'WINK',
      lines: ['Jeje… ahí va un guiño.', 'Secreto entre nosotros.'],
      lineGapMs: 400,
    };
  }
  if (/rie|ríete|carcajada|jaja/.test(q)) {
    return {
      id: 'laugh',
      face: 'HAPPY',
      lines: ['Jaja…', 'Jajaja…', 'Perdón, me dio risa.'],
      lineGapMs: 350,
    };
  }
  if (/quien eres|que eres|presentate/.test(q)) {
    return {
      id: 'who',
      face: 'HAPPY',
      lines: [
        'Soy ULTRON FP.',
        'Tu asistente nativo de junta directiva.',
        'Cámara, micrófono, memoria y voz… todo aquí en el aparato.',
      ],
      lineGapMs: 500,
    };
  }
  return null;
}
