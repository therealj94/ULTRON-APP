// Empaqueta para node las pestañas de los chats (whatsapp/ChatsConWhatsapp.tsx) con el renderizador mínimo de
// ../visor/montar.js, en UN módulo (el componente y el renderizador comparten el mismo React).
//
// Lo de fuera va simulado: react-native (etiquetas y un deslizador que anota cada scrollTo, ./shims/react-native.js),
// las cuatro páginas (./shims/paginas.js: dibujan el cambio de pestañas y anotan si están a la vista) y la API de
// WhatsApp con lo guardado en el teléfono (./shims/wa.js: la prueba decide cuándo contesta). El tema, el idioma y la
// lógica de WhatsApp van de verdad.
//
// `SRC=/otra/copia/mobile/src SALIDA=/tmp/chats-antes.cjs node construir.cjs` empaqueta otra copia (para ver fallar
// la prueba contra el código de antes; después `CHATS=/tmp/chats-antes.cjs node pestanas.cjs`).
const path = require('path');
const fs = require('fs');
const RAIZ = path.resolve(__dirname, '../..');
const MODULOS = path.join(RAIZ, 'node_modules');
const esbuild = require(fs.existsSync(path.join(RAIZ, '../node_modules/esbuild')) ? path.join(RAIZ, '../node_modules/esbuild') : 'esbuild');
const SRC = path.resolve(process.env.SRC || path.join(RAIZ, 'src'));
const SALIDA = path.resolve(process.env.SALIDA || path.join(__dirname, 'out/chats.cjs'));
const SHIMS = path.join(__dirname, 'shims');

const PAGINAS = ['../pulse/PantallaChats', '../correo/PantallaCorreos', '../cartera/PantallaCartera', './PantallaWhatsapp', '../ui/Letra'];

const alias = {
  name: 'alias',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      if (a.path === 'react-native') return { path: path.join(SHIMS, 'react-native.js') };
      if (a.importer.endsWith(`whatsapp${path.sep}ChatsConWhatsapp.tsx`)) {
        if (PAGINAS.includes(a.path)) return { path: path.join(SHIMS, 'paginas.js') };
        if (a.path === './api' || a.path === './guardado') return { path: path.join(SHIMS, 'wa.js') };
      }
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
    `export * as CHATS from ${JSON.stringify(path.join(SRC, 'whatsapp/ChatsConWhatsapp'))};`,
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
    logLevel: 'error',
  })
  .then(() => console.log('construido', path.relative(process.cwd(), SALIDA), 'desde', SRC))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
