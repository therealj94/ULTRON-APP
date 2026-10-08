// Empaqueta para node la hoja «Por confirmar» de las caras y las voces (caras/HojaConsentimiento.tsx, tanda F1) con su
// lógica pura (caras/porConfirmar.ts), los clientes de verdad de /api/caras y /api/voces (caras/api.ts, voces/api.ts) y el
// renderizador mínimo del visor (pruebas/visor/montar.js), en UN módulo: el componente y el renderizador comparten React.
//
// Lo de fuera va simulado: react-native (etiquetas), AsyncStorage (en memoria), ../ui (Texto, Boton, Hoja y vibrar como
// etiquetas con sus manejadores), ../nucleo/tema (una paleta fija) y ../lib/api (el contrato de errores de lib/api.ts sobre
// el `fetch` global, que la prueba cambia por el servidor falso).
//
// `SRC=/otra/copia/mobile/src SALIDA=/tmp/consentimiento-antes.cjs node construir.cjs` empaqueta otra copia.
const path = require('path');
const fs = require('fs');
const RAIZ = path.resolve(__dirname, '../..');
const MODULOS = path.join(RAIZ, 'node_modules');
const esbuild = require(fs.existsSync(path.join(RAIZ, '../node_modules/esbuild')) ? path.join(RAIZ, '../node_modules/esbuild') : 'esbuild');
const SRC = path.resolve(process.env.SRC || path.join(RAIZ, 'src'));
const SALIDA = path.resolve(process.env.SALIDA || path.join(__dirname, 'out/consentimiento.cjs'));
const SHIMS = path.join(__dirname, 'shims');

const alias = {
  name: 'alias',
  setup(b) {
    const mapa = {
      'react-native': path.join(SHIMS, 'react-native.js'),
      '@react-native-async-storage/async-storage': path.join(SHIMS, 'async-storage.js'),
    };
    b.onResolve({ filter: /.*/ }, (a) => {
      if (mapa[a.path]) return { path: mapa[a.path] };
      if (a.path === '../ui') return { path: path.join(SHIMS, 'ui.js') };
      if (a.path === '../nucleo/tema') return { path: path.join(SHIMS, 'tema.js') };
      if (a.path === '../lib/api') return { path: path.join(SHIMS, 'api.js') };
      // Un solo React para todo (también para la copia de SRC fuera del repo, que no tiene node_modules).
      if (a.path === 'react' || a.path.startsWith('react/') || a.path === 'react-reconciler' || a.path === 'scheduler') return { path: require.resolve(a.path, { paths: [MODULOS] }) };
      return null;
    });
  },
};

const entrada = path.join(path.dirname(SALIDA), 'entrada-' + path.basename(SALIDA, '.cjs') + '.ts');
fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(
  entrada,
  [
    `export { ConsentimientoBiometria } from ${JSON.stringify(path.join(SRC, 'caras/HojaConsentimiento'))};`,
    `export * as PC from ${JSON.stringify(path.join(SRC, 'caras/porConfirmar'))};`,
    `export * as CARAS from ${JSON.stringify(path.join(SRC, 'caras/caras'))};`,
    `export * as MONTAR from ${JSON.stringify(path.join(__dirname, '../visor/montar.js'))};`,
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
    define: { 'process.env.NODE_ENV': '"development"' },
    loader: { '.png': 'empty', '.webp': 'empty', '.jpg': 'empty', '.wav': 'empty', '.mp3': 'empty' },
    logLevel: 'error',
  })
  .then(() => console.log('construido', path.relative(process.cwd(), SALIDA), 'desde', SRC))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
