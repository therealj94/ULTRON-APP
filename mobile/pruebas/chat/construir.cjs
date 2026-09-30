// Empaqueta el código REAL del chat (candado, relevo, genesis, chats, borradores) para node, con
// esbuild y los shims de Expo de ./shims. `SRC=/otra/copia/mobile/src node construir.cjs` empaqueta
// otra copia (así se corre la misma prueba contra el código de antes y se ve fallar).
const path = require('path');
const fs = require('fs');
const RAIZ = path.resolve(__dirname, '../..');
const MODULOS = path.join(RAIZ, 'node_modules');
const esbuild = require(fs.existsSync(path.join(RAIZ, '../node_modules/esbuild')) ? path.join(RAIZ, '../node_modules/esbuild') : 'esbuild');
const SRC = path.resolve(process.env.SRC || path.join(RAIZ, 'src'));
const SALIDA = path.resolve(process.env.SALIDA || path.join(__dirname, 'out/movil.cjs'));
const S = path.join(__dirname, 'shims');

const alias = {
  name: 'alias',
  setup(b) {
    const mapa = {
      'expo-crypto': 'expo-crypto.js',
      'expo-secure-store': 'expo-secure-store.js',
      'expo-constants': 'expo-constants.js',
      'react-native': 'react-native.js',
      'expo-web-browser': 'expo-web-browser.js',
    };
    b.onResolve({ filter: /.*/ }, (a) => {
      if (mapa[a.path]) return { path: path.join(S, mapa[a.path]) };
      if (a.path === './api' && a.importer.includes(`${path.sep}lib${path.sep}`)) return { path: path.join(S, 'api.js') };
      if (a.path === './storage' && a.importer.includes(`${path.sep}lib${path.sep}`)) return { path: path.join(S, 'storage.js') };
      return null;
    });
  },
};

const existe = (r) => fs.existsSync(path.join(SRC, r));
const lineas = [
  `export * as CANDADO from ${JSON.stringify(path.join(SRC, 'pulse/candado'))};`,
  `export * as RELEVO from ${JSON.stringify(path.join(SRC, 'pulse/relevo'))};`,
  `export * as GENESIS from ${JSON.stringify(path.join(SRC, 'lib/genesis'))};`,
  // Lo nuevo de la 5.0 solo si está (el código de antes no lo tiene).
  existe('pulse/chats.ts') ? `export * as CHATS from ${JSON.stringify(path.join(SRC, 'pulse/chats'))};` : '',
  existe('pulse/borradores.ts') ? `export * as BORRADORES from ${JSON.stringify(path.join(SRC, 'pulse/borradores'))};` : '',
  existe('nucleo/contrato.ts') ? `export * as CONTRATO from ${JSON.stringify(path.join(SRC, 'nucleo/contrato'))};` : '',
];
const entrada = path.join(path.dirname(SALIDA), 'entrada-' + path.basename(SALIDA, '.cjs') + '.ts');
fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(entrada, lineas.filter(Boolean).join('\n') + '\n');

esbuild
  .build({
    entryPoints: [entrada],
    outfile: SALIDA,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [alias],
    nodePaths: [MODULOS],
    // El catálogo de avatares arrastra imágenes: para la lógica no hacen falta.
    loader: { '.png': 'empty', '.webp': 'empty', '.jpg': 'empty', '.wav': 'empty', '.mp3': 'empty' },
    logLevel: 'error',
  })
  .then(() => console.log('construido', path.relative(process.cwd(), SALIDA), 'desde', SRC))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
