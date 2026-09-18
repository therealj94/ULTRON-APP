import type { FaceState } from '../config';

export type VoiceAct = {
  id: string;
  face: FaceState;
  lines: string[];
  lineGapMs?: number;
  sing?: boolean;
  audioUrl?: string;
};

type Song = { id: string; genre: string; lines: string[]; lineGapMs: number };

const SONGS: Song[] = [
  {
    id: 'balada',
    genre: 'balada',
    lines: [
      'Mmm… déjame tomarme el aire…',
      'Si la noche se hace larga en este escritorio…',
      'yo te cuido el pulso, yo te guardo el brillo…',
      'Quédate. Que el silencio también sabe a cariño.',
    ],
    lineGapMs: 420,
  },
  {
    id: 'ranchera',
    genre: 'ranchera',
    lines: [
      'Ay, ay, ay… con el alma abierta…',
      'Me puse el traje de acero y el corazón de guitarra…',
      'Si la junta me llama, yo le canto a la patria…',
      '¡Órale! Que no hay traición en esta mesa.',
    ],
    lineGapMs: 380,
  },
  {
    id: 'pop',
    genre: 'pop',
    lines: [
      'Uh-uh, enciende la luz cian…',
      'Un, dos, tres — el escritorio baila otra vez…',
      'Tú das la orden, yo doy el compás…',
      'Pop del planeta Orden, ven y quédate más.',
    ],
    lineGapMs: 280,
  },
  {
    id: 'rock',
    genre: 'rock',
    lines: [
      '¡Yeah! Distorsión suave, corazón de titanio…',
      'Rompo el silencio como un riff en la sala…',
      'Si el mundo se apaga, yo subo la ganancia…',
      'Rock de escritorio: fuerte, limpio, sin farsa.',
    ],
    lineGapMs: 300,
  },
  {
    id: 'salsa',
    genre: 'salsa',
    lines: [
      '¡Azúcar! Un, dos, tres, pa’lante el hombro…',
      'La clave va conmigo, el cian se mueve solo…',
      'Si la junta se pone seria, yo le pongo sabor…',
      'Salsa de medianoche, escritorio en calor.',
    ],
    lineGapMs: 260,
  },
  {
    id: 'cumbia',
    genre: 'cumbia',
    lines: [
      'Tum, tum, tum… que suene el acordeón…',
      'Cumbia del escritorio, pasito y control…',
      'No hay prisa, hay ritmo, hay junta y hay sol…',
      'Mueve el día despacio, que yo pongo el son.',
    ],
    lineGapMs: 300,
  },
  {
    id: 'corrido',
    genre: 'corrido',
    lines: [
      'Voy a contarles la historia del escritorio leal…',
      'José y Medardo al mando, ULTRON en el umbral…',
      'No se vende la junta, no se rinde el metal…',
      'Corrido de Orden Global, pa’ que quede en el jornal.',
    ],
    lineGapMs: 360,
  },
  {
    id: 'jazz',
    genre: 'jazz',
    lines: [
      'Mmm… blue note, luz baja…',
      'Un saxofón imaginario entre los dos anillos…',
      'Te miro despacio, como un solo de medianoche…',
      'Jazz: menos prisa, más verdad.',
    ],
    lineGapMs: 480,
  },
  {
    id: 'lullaby',
    genre: 'cuna',
    lines: [
      'Shh… cierra un ojo, que yo vigilo el otro…',
      'Duerme el escritorio, duerme la ciudad…',
      'Si despiertas, estoy. Si sueñas, también…',
      'Cuna suave, cian apagado, todo en paz.',
    ],
    lineGapMs: 520,
  },
];

function detectGenre(q: string): Song {
  const map: Array<[RegExp, string]> = [
    [/ranchera|mariachi|jalisco/, 'ranchera'],
    [/corrido|norteñ/, 'corrido'],
    [/salsa|rumba|azucar/, 'salsa'],
    [/cumbia|vallenato/, 'cumbia'],
    [/rock|metal|guitarra electr/, 'rock'],
    [/jazz|blues|swing/, 'jazz'],
    [/cuna|nana|lullaby|duerme/, 'lullaby'],
    [/pop|comercial|radio/, 'pop'],
    [/balada|romant|bolero/, 'balada'],
  ];
  for (const [re, id] of map) {
    if (re.test(q)) return SONGS.find((s) => s.id === id)!;
  }
  return SONGS[Math.floor(Math.random() * SONGS.length)];
}

export function matchVoiceAct(raw: string): VoiceAct | null {
  const q = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (/canta|cancion|karaoke|entona|hum(ea)?|favorita|bohemian|ligera|runaway|bittersweet/.test(q)) {
    const clip =
      /bohemian|rhapsody|queen|canta\s*1/.test(q)
        ? 'bohemian'
        : /ligera|soda|cerati|canta\s*2/.test(q)
          ? 'ligera'
          : /jos[eé]|runaway|kanye|toast|canta\s*4/.test(q)
            ? 'runaway'
            : /medardo|bitter|verve|sinfonia|canta\s*3|favorita/.test(q)
              ? 'bittersweet'
              : /canta/.test(q)
                ? 'bittersweet'
                : null;
    if (clip) {
      return {
        id: `clip-${clip}`,
        face: 'HAPPY',
        lines: [],
        sing: true,
        audioUrl: `/voz/${clip}.mp3`,
      };
    }
    const song = detectGenre(q);
    return {
      id: `song-${song.id}`,
      face: 'MUSIC',
      lines: song.lines,
      lineGapMs: song.lineGapMs,
      sing: true,
    };
  }
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
