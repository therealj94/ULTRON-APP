// Empaqueta para node el cliente REAL de Veta Wallet (sesión, tarjeta) y el desbloqueo con huella. Lo
// nativo (llavero, biometría), simulado en ./shims.
const path = require('path');
const fs = require('fs');
const RAIZ = path.resolve(__dirname, '../..');
const esbuild = require(fs.existsSync(path.join(RAIZ, '../node_modules/esbuild')) ? path.join(RAIZ, '../node_modules/esbuild') : 'esbuild');
const SH = path.join(__dirname, 'shims');
const mapa = { 'expo-secure-store': path.join(SH, 'expo-secure-store.js'), 'expo-local-authentication': path.join(SH, 'expo-local-authentication.js') };
esbuild.build({
  stdin: { contents: "export * as sesion from './src/cartera/veta/sesion.ts'; export * as desbloqueo from './src/cartera/veta/desbloqueo.ts';", resolveDir: RAIZ, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', outfile: path.join(__dirname, 'out/veta.cjs'), logLevel: 'error',
  plugins: [{ name: 'alias', setup(b) { b.onResolve({ filter: /.*/ }, (a) => (mapa[a.path] ? { path: mapa[a.path] } : null)); } }],
}).then(() => console.log("paquete listo: out/veta.cjs")).catch((e) => { console.error(e); process.exit(1); });
