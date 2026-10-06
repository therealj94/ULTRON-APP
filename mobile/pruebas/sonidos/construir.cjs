// Empaqueta para node LOS SONIDOS DE TRABAJO con el código REAL (José, 6-oct: «si está haciendo o pensando algo que se
// escuchen cosas como eso del teclado, tanto con el avatar como en la llamada»): la mesa (compa/trabajoMesa), la llamada
// (compa/ambiente), lo puro (compa/sonidosTrabajo), el reproductor (compa/ambienteSonido, con expo-av simulado), el
// ajuste y el interruptor remoto (lib/ambienteAjuste, con el disco y /api/movil/config simulados), el validador del
// canal de acciones (compa/acciones) y, del micrófono de la mesa, el silencio con hora (lib/silencioMesa) y la gracia
// del segundo plano (lib/appDelante). Los .mp3 se vuelven su nombre de archivo (para ver cuál se pidió).
//
// `SRC=/otra/copia/mobile/src node construir.cjs` empaqueta otra copia (la de main no trae nada de esto: falla).
const path = require('path');
const fs = require('fs');
const RAIZ = path.resolve(__dirname, '../..');
const MODULOS = path.join(RAIZ, 'node_modules');
const esbuild = require(fs.existsSync(path.join(RAIZ, '../node_modules/esbuild')) ? path.join(RAIZ, '../node_modules/esbuild') : 'esbuild');
const SRC = path.resolve(process.env.SRC || path.join(RAIZ, 'src'));
const SALIDA = path.resolve(process.env.SALIDA || path.join(__dirname, 'out/sonidos.cjs'));
const SHIMS = path.join(__dirname, 'shims');

const alias = {
  name: 'alias',
  setup(b) {
    const mapa = {
      'react-native': path.join(SHIMS, 'react-native.js'),
      'expo-av': path.join(SHIMS, 'expo-av.js'),
      '@react-native-async-storage/async-storage': path.join(SHIMS, 'async-storage.js'),
    };
    b.onResolve({ filter: /.*/ }, (a) => {
      if (mapa[a.path]) return { path: mapa[a.path] };
      if (a.importer.startsWith(path.join(SRC, 'lib')) && a.path === './api') return { path: path.join(SHIMS, 'api.js') };
      if (a.importer.startsWith(path.join(SRC, 'lib')) && a.path === './reporte') return { path: path.join(SHIMS, 'reporte.js') };
      return null;
    });
    // Un .mp3 es su nombre (en Metro, un número de recurso): así se ve qué archivo pidió el reproductor.
    b.onLoad({ filter: /\.mp3$/ }, (a) => ({ contents: `module.exports = ${JSON.stringify(path.basename(a.path))};`, loader: 'js' }));
  },
};

const piezas = {
  TRABAJO: 'compa/trabajoMesa',
  AMBIENTE: 'compa/ambiente',
  SONIDOS: 'compa/sonidosTrabajo',
  REPRODUCTOR: 'compa/ambienteSonido',
  AJUSTE: 'lib/ambienteAjuste',
  SFX: 'lib/sfx',
  FRASES: 'compa/frasesEstado',
  ACCIONES: 'compa/acciones',
  NARRADOR: 'compa/narrador',
  SILENCIO: 'lib/silencioMesa',
  DELANTE: 'lib/appDelante',
};
const faltan = Object.entries(piezas).filter(([, r]) => !fs.existsSync(path.join(SRC, r + '.ts')));
if (faltan.length) {
  console.error(`esta copia no trae: ${faltan.map(([, r]) => r).join(', ')}`);
  process.exit(1);
}
const lineas = Object.entries(piezas).map(([n, r]) => `export * as ${n} from ${JSON.stringify(path.join(SRC, r))};`);
fs.mkdirSync(path.dirname(SALIDA), { recursive: true });

esbuild
  .build({
    stdin: { contents: lineas.join('\n') + '\n', resolveDir: __dirname, loader: 'ts', sourcefile: 'entrada-sonidos.ts' },
    outfile: SALIDA,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [alias],
    loader: { '.png': 'empty', '.jpg': 'empty', '.glb': 'empty' },
    nodePaths: [MODULOS],
    logLevel: 'error',
  })
  .then(() => console.log('construido', path.relative(process.cwd(), SALIDA), 'desde', SRC))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
