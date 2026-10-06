// Empaqueta para node LAS MULETILLAS de la mesa con el código REAL: la fachada del oído (lib/speech, con el oído
// Turbo y su motor), la orquesta y su armado de la mesa (lib/muletillas, lib/muletillasMesa), los clips con la voz
// del avatar (lib/muletillasAudio + lib/sfx), el ajuste y el interruptor remoto (lib/muletillasAjuste) y la voz de
// la mesa (lib/tts: para ver que el «mjm» NO pasa por ella). Lo nativo va simulado (./shims): el micrófono crudo
// (modules/aura-mic) con su cancelador de eco, la bocina que se cuela al micrófono, /api/tts y el disco.
//
// `SRC=/otra/copia/mobile/src node construir.cjs` empaqueta otra copia (la de main: no trae las muletillas y falla).
const path = require('path');
const fs = require('fs');
const RAIZ = path.resolve(__dirname, '../..');
const MODULOS = path.join(RAIZ, 'node_modules');
const esbuild = require(fs.existsSync(path.join(RAIZ, '../node_modules/esbuild')) ? path.join(RAIZ, '../node_modules/esbuild') : 'esbuild');
const SRC = path.resolve(process.env.SRC || path.join(RAIZ, 'src'));
const SALIDA = path.resolve(process.env.SALIDA || path.join(__dirname, 'out/muletillas.cjs'));
const SHIMS = path.join(__dirname, 'shims');
const OIDO = path.join(__dirname, '../oido/shims');

const alias = {
  name: 'alias',
  setup(b) {
    const mapa = {
      'react-native': path.join(SHIMS, 'react-native.js'),
      expo: path.join(SHIMS, 'expo.js'),
      'expo-av': path.join(SHIMS, 'expo-av.js'),
      'expo-file-system/legacy': path.join(SHIMS, 'expo-file-system.js'),
      'expo-constants': path.join(OIDO, 'expo-constants.js'),
      'expo-speech-recognition': path.join(OIDO, 'expo-speech-recognition.js'),
      '@react-native-async-storage/async-storage': path.join(SHIMS, 'async-storage.js'),
    };
    b.onResolve({ filter: /.*/ }, (a) => {
      if (mapa[a.path]) return { path: mapa[a.path] };
      if (a.path === './api' && a.importer.startsWith(path.join(SRC, 'lib'))) return { path: path.join(SHIMS, 'api.js') };
      return null;
    });
  },
};

const piezas = {
  SPEECH: 'lib/speech',
  ORQUESTA: 'lib/muletillas',
  MESA: 'lib/muletillasMesa',
  AUDIO: 'lib/muletillasAudio',
  AJUSTE: 'lib/muletillasAjuste',
  ASENTIR: 'lib/asentir',
  TTS: 'lib/tts',
  SONANDO: 'avatar3d/sonando',
};
const lineas = Object.entries(piezas)
  .filter(([, r]) => fs.existsSync(path.join(SRC, r + '.ts')))
  .map(([n, r]) => `export * as ${n} from ${JSON.stringify(path.join(SRC, r))};`);
fs.mkdirSync(path.dirname(SALIDA), { recursive: true });

esbuild
  .build({
    stdin: { contents: lineas.join('\n') + '\n', resolveDir: __dirname, loader: 'ts', sourcefile: 'entrada-muletillas.ts' },
    outfile: SALIDA,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [alias],
    // Los efectos de lib/sfx.ts (require de .mp3, como en Metro): aquí no hacen falta.
    loader: { '.mp3': 'empty', '.png': 'empty', '.jpg': 'empty', '.glb': 'empty' },
    nodePaths: [MODULOS],
    logLevel: 'error',
  })
  .then(() => console.log('construido', path.relative(process.cwd(), SALIDA), 'desde', SRC))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
