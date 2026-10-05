// Empaqueta para node el visor de la computadora (app/VisorComputadora.tsx) con su estado de módulo (app/visor.ts), el
// lote de teclado (lib/entradaRemota.ts) y el renderizador mínimo de montar.js, en UN módulo: el componente y el
// renderizador comparten el mismo React (el de la app, 19.x, con el react-reconciler que ya trae Skia).
//
// Lo de fuera va simulado: react-native (etiquetas, ./shims/react-native.js), la zona segura, ../ui (Texto y vibrar) y
// ../lib/api (el mismo contrato de errores sobre el `fetch` global, que la prueba cambia por el servidor falso).
//
// `SRC=/otra/copia/mobile/src SALIDA=/tmp/visor-antes.cjs node construir.cjs` empaqueta otra copia (para ver fallar la
// prueba contra el código de antes; después `VISOR=/tmp/visor-antes.cjs node lote.cjs`).
const path = require('path');
const fs = require('fs');
const RAIZ = path.resolve(__dirname, '../..');
const MODULOS = path.join(RAIZ, 'node_modules');
const esbuild = require(fs.existsSync(path.join(RAIZ, '../node_modules/esbuild')) ? path.join(RAIZ, '../node_modules/esbuild') : 'esbuild');
const SRC = path.resolve(process.env.SRC || path.join(RAIZ, 'src'));
const SALIDA = path.resolve(process.env.SALIDA || path.join(__dirname, 'out/visor.cjs'));
const SHIMS = path.join(__dirname, 'shims');

const alias = {
  name: 'alias',
  setup(b) {
    const mapa = {
      'react-native': path.join(SHIMS, 'react-native.js'),
      'react-native-safe-area-context': path.join(SHIMS, 'safe-area.js'),
    };
    b.onResolve({ filter: /.*/ }, (a) => {
      if (mapa[a.path]) return { path: mapa[a.path] };
      const desdeApp = a.importer.includes(`${path.sep}app${path.sep}`);
      if (desdeApp && a.path === '../ui') return { path: path.join(SHIMS, 'ui.js') };
      if (desdeApp && a.path === '../lib/api') return { path: path.join(SHIMS, 'api.js') };
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
    `export { VisorComputadora } from ${JSON.stringify(path.join(SRC, 'app/VisorComputadora'))};`,
    `export * as VISOR from ${JSON.stringify(path.join(SRC, 'app/visor'))};`,
    `export * as ENTRADA from ${JSON.stringify(path.join(SRC, 'lib/entradaRemota'))};`,
    `export * as MONTAR from ${JSON.stringify(path.join(__dirname, 'montar.js'))};`,
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
    // Sin leer los tsconfig de la copia (mobile/tsconfig.json extiende el de Expo; src/app trae el suyo para la web).
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
    jsx: 'automatic',
    // React en desarrollo (avisos de hooks y claves visibles en la prueba).
    define: { 'process.env.NODE_ENV': '"development"' },
    loader: { '.png': 'empty', '.webp': 'empty', '.jpg': 'empty', '.wav': 'empty', '.mp3': 'empty' },
    logLevel: 'error',
  })
  .then(() => console.log('construido', path.relative(process.cwd(), SALIDA), 'desde', SRC))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
