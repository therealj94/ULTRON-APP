// Empaqueta para node LA RECARGA con el código REAL: la raíz (App.tsx), lib/ota.ts (aplicarAhora y el hook que aplica
// lo descargado al abrir), lib/recarga.ts (la secuencia antes de reloadAsync), lib/avRegistro.ts (el registro de los
// sonidos de expo-av) y lib/barreraOta.ts, más el renderizador mínimo de pruebas/visor/montar.js. Lo de fuera va
// simulado (shims/): expo-av con la misma forma que el de verdad (createAsync → loadAsync del prototipo), expo-updates,
// react-native como etiquetas, la voz, el reporte y las dos apps (una pantalla con el cuerpo en video).
//
// `SRC=/otra/copia/mobile/src SALIDA=out/recarga-otro.cjs node construir.cjs` empaqueta otra copia (main sin el
// arreglo no trae lib/recarga.ts ni lib/avRegistro.ts: falla).
const path = require('path');
const fs = require('fs');
const RAIZ = path.resolve(__dirname, '../..');
const MODULOS = path.join(RAIZ, 'node_modules');
const esbuild = require(fs.existsSync(path.join(RAIZ, '../node_modules/esbuild')) ? path.join(RAIZ, '../node_modules/esbuild') : 'esbuild');
const SRC = path.resolve(process.env.SRC || path.join(RAIZ, 'src'));
const APP = path.join(path.dirname(SRC), 'App.tsx');
const SALIDA = path.resolve(process.env.SALIDA || path.join(__dirname, 'out/recarga.cjs'));
const SHIMS = path.join(__dirname, 'shims');
const VARIOS = path.join(SHIMS, 'varios.js');

const faltan = ['lib/recarga.ts', 'lib/avRegistro.ts', 'lib/ota.ts'].filter((r) => !fs.existsSync(path.join(SRC, r)));
if (faltan.length || !fs.existsSync(APP)) {
  console.error(`esta copia no trae: ${[...faltan, ...(fs.existsSync(APP) ? [] : ['App.tsx'])].join(', ')}`);
  process.exit(1);
}

/** Lo que se cambia por una pieza de shims/varios.js. */
const piezaDe = (a) => {
  const desdeLib = a.importer.startsWith(path.join(SRC, 'lib'));
  if (desdeLib && a.path === './tts') return 'tts';
  if (desdeLib && a.path === './reporte') return 'reporte';
  if (desdeLib && a.path === './recepcion') return 'recepcion';
  if (a.path === 'expo-constants') return 'constants';
  if (a.path === 'expo-splash-screen') return 'splash';
  if (a.importer === APP && (a.path === './src/app/AppAura' || a.path === './src/electrum/ElectrumApp')) return 'AppFalsa';
  // La burbuja del asistente digital (App.tsx la monta solo con `modo: 'burbuja'`): aquí no se arranca nunca.
  if (a.importer === APP && a.path === './src/burbuja/Burbuja') return 'BurbujaFalsa';
  return null;
};

const alias = {
  name: 'alias',
  setup(b) {
    const mapa = {
      'react-native': path.join(SHIMS, 'react-native.js'),
      'expo-av': path.join(SHIMS, 'expo-av.js'),
      'expo-updates': path.join(SHIMS, 'expo-updates.js'),
      'react-native-gesture-handler': path.join(SHIMS, 'vacio.js'),
    };
    b.onResolve({ filter: /.*/ }, (a) => {
      if (mapa[a.path]) return { path: mapa[a.path] };
      const pieza = piezaDe(a);
      if (pieza) return { path: pieza, namespace: 'pieza' };
      // Un solo React para todo (también para la copia de SRC fuera del repo).
      if (a.path === 'react' || a.path.startsWith('react/') || a.path === 'react-reconciler' || a.path === 'scheduler') return { path: require.resolve(a.path, { paths: [MODULOS] }) };
      return null;
    });
    b.onLoad({ filter: /.*/, namespace: 'pieza' }, (a) => {
      const exp =
        a.path === 'AppFalsa'
          ? `module.exports = { AppAura: V.AppFalsa, default: V.AppFalsa, __esModule: true };`
          : a.path === 'BurbujaFalsa'
            ? `module.exports = { RaizBurbuja: V.AppFalsa, __esModule: true };`
            : `module.exports = V.${a.path};`;
      return { contents: `const V = require(${JSON.stringify(VARIOS)});\n${exp}\n`, loader: 'js', resolveDir: __dirname };
    });
  },
};

// .js y no .ts: el tsc del teléfono (mobile/tsconfig.json) no la revisa (re-exporta un shim CommonJS).
const entrada = path.join(path.dirname(SALIDA), 'entrada-' + path.basename(SALIDA, '.cjs') + '.js');
fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(
  entrada,
  [
    // Primero el registro, como en index.js.
    `export * as REGISTRO from ${JSON.stringify(path.join(SRC, 'lib/avRegistro'))};`,
    `export { default as App } from ${JSON.stringify(APP.replace(/\.tsx$/, ''))};`,
    `export * as OTA from ${JSON.stringify(path.join(SRC, 'lib/ota'))};`,
    `export * as RECARGA from ${JSON.stringify(path.join(SRC, 'lib/recarga'))};`,
    `export * as BARRERA from ${JSON.stringify(path.join(SRC, 'lib/barreraOta'))};`,
    `export * as MONTAR from ${JSON.stringify(path.join(__dirname, '../visor/montar.js'))};`,
    `export * as AV from ${JSON.stringify(path.join(SHIMS, 'expo-av.js'))};`,
  ].join('\n') + '\n'
);

esbuild
  .build({
    entryPoints: [entrada],
    outfile: SALIDA,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [alias],
    nodePaths: [MODULOS],
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"', __DEV__: 'false' },
    loader: { '.png': 'empty', '.webp': 'empty', '.jpg': 'empty', '.wav': 'empty', '.mp3': 'empty', '.mp4': 'empty', '.glb': 'empty' },
    logLevel: 'error',
  })
  .then(() => console.log('construido', path.relative(process.cwd(), SALIDA), 'desde', SRC))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
