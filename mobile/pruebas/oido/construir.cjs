// Empaqueta para node el OÍDO de la app con el código REAL: la fachada del reconocimiento
// (lib/speech + speechNative + speechCloud), el dueño del audio y su vigilante (compa/duenoAudio), el
// control de la conversación en vivo (compa/sesion), el ánimo de la compañera (compa/animo) y la voz
// de la mesa (lib/tts). Lo nativo va simulado (./shims): el reconocedor de Android con sus tiempos y
// sus `end` tardíos, y un /api/tts que tarda lo que diga la prueba.
//
// `SRC=/otra/copia/mobile/src node construir.cjs` empaqueta otra copia (p. ej. la de main, para ver
// fallar las pruebas contra el código de antes).
const path = require('path');
const fs = require('fs');
const RAIZ = path.resolve(__dirname, '../..');
const MODULOS = path.join(RAIZ, 'node_modules');
const esbuild = require(fs.existsSync(path.join(RAIZ, '../node_modules/esbuild')) ? path.join(RAIZ, '../node_modules/esbuild') : 'esbuild');
const SRC = path.resolve(process.env.SRC || path.join(RAIZ, 'src'));
const SALIDA = path.resolve(process.env.SALIDA || path.join(__dirname, 'out/oido.cjs'));
const SHIMS = path.join(__dirname, 'shims');

const alias = {
  name: 'alias',
  setup(b) {
    const mapa = {
      'react-native': path.join(SHIMS, 'react-native.js'),
      'expo-speech-recognition': path.join(SHIMS, 'expo-speech-recognition.js'),
      'expo-av': path.join(SHIMS, 'expo-av.js'),
      'expo-file-system/legacy': path.join(SHIMS, 'expo-file-system.js'),
      'expo-constants': path.join(SHIMS, 'expo-constants.js'),
    };
    b.onResolve({ filter: /.*/ }, (a) => {
      if (mapa[a.path]) return { path: mapa[a.path] };
      if (a.path === './api' && (a.importer.endsWith(`speechCloud.ts`) || a.importer.endsWith(`tts.ts`))) return { path: path.join(SHIMS, 'api.js') };
      return null;
    });
  },
};

const piezas = {
  SPEECH: 'lib/speech',
  NATIVO: 'lib/speechNative',
  DUENO: 'compa/duenoAudio',
  SESION: 'compa/sesion',
  CICLO: 'compa/llamadaCiclo',
  // El intérprete de la mesa: «llámame» lo reconoce aquí, sin red.
  INTENCIONES: 'lib/intenciones',
  ANIMO: 'compa/animo',
  I18N: 'i18n',
  // La voz de la mesa (speak, StreamSpeaker) y sus frases: para medir cuándo empieza a sonar la respuesta.
  TTS: 'lib/tts',
  FRASES: 'lib/frases',
  FRASES_ESTADO: 'compa/frasesEstado',
};
// Lo que no exista en esa copia (p. ej. el ciclo de la llamada en main) se deja fuera.
const lineas = Object.entries(piezas)
  .filter(([, r]) => fs.existsSync(path.join(SRC, r + '.ts')))
  .map(([n, r]) => `export * as ${n} from ${JSON.stringify(path.join(SRC, r))};`);
fs.mkdirSync(path.dirname(SALIDA), { recursive: true });

esbuild
  .build({
    // La entrada va en memoria: un archivo .ts suelto lo tomaría el typecheck de la app (y con SRC de
    // otra copia, fallaría).
    stdin: { contents: lineas.join('\n') + '\n', resolveDir: __dirname, loader: 'ts', sourcefile: 'entrada-oido.ts' },
    outfile: SALIDA,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [alias],
    nodePaths: [MODULOS],
    logLevel: 'error',
  })
  .then(() => console.log('construido', path.relative(process.cwd(), SALIDA), 'desde', SRC))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
