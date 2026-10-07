// Empaqueta para node el cliente REAL de Veta Wallet (sesión, tarjeta, seguimiento de la recarga), el
// desbloqueo con huella, la cartera conectada y la generación de la cuenta de AURA. Lo nativo (llavero,
// biometría) y lo de afuera (la API de AURA, el relevo del chat), simulado en ./shims.
//
// `SRC=/otra/copia/mobile/src node construir.cjs` empaqueta otra copia (para ver fallar una prueba contra
// el código de antes; lo que esa copia no tenga, no se exporta).
const path = require('path');
const fs = require('fs');
const RAIZ = path.resolve(__dirname, '../..');
const esbuild = require(fs.existsSync(path.join(RAIZ, '../node_modules/esbuild')) ? path.join(RAIZ, '../node_modules/esbuild') : 'esbuild');
const SRC = path.resolve(process.env.SRC || path.join(RAIZ, 'src'));
const SH = path.join(__dirname, 'shims');
const mapa = { 'expo-secure-store': path.join(SH, 'expo-secure-store.js'), 'expo-local-authentication': path.join(SH, 'expo-local-authentication.js') };
const piezas = {
  sesion: 'cartera/veta/sesion',
  desbloqueo: 'cartera/veta/desbloqueo',
  recarga: 'cartera/veta/recarga',
  conexion: 'cartera/conexion',
  cuenta: 'lib/cuenta',
  // La entrada con clave de AU-RA: la clave solo detrás de la huella (auditoría del 7-oct, M-9).
  creds: 'lib/credsSeguras',
};
const entrada = Object.entries(piezas)
  .filter(([, r]) => fs.existsSync(path.join(SRC, r + '.ts')))
  .map(([n, r]) => `export * as ${n} from ${JSON.stringify(path.join(SRC, r))};`)
  .join('\n');
esbuild.build({
  stdin: { contents: entrada, resolveDir: RAIZ, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', outfile: path.join(__dirname, 'out/veta.cjs'), logLevel: 'error',
  nodePaths: [path.join(RAIZ, 'node_modules')],
  plugins: [{ name: 'alias', setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      if (mapa[a.path]) return { path: mapa[a.path] };
      // La cartera habla con el servidor de AURA y con el relevo del chat: aquí, los de mentira.
      if (a.importer.endsWith(`conexion.ts`) && a.path === '../lib/api') return { path: path.join(SH, 'api.js') };
      if (a.importer.endsWith(`conexion.ts`) && a.path === '../pulse/relevo') return { path: path.join(SH, 'relevo.js') };
      return null;
    });
  } }],
}).then(() => console.log('paquete listo: out/veta.cjs desde', SRC)).catch((e) => { console.error(e); process.exit(1); });
