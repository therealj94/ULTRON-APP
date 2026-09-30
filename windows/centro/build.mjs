// Arma el Centro en windows/src/Aura.Windows/CentroAssets (lo sirve la WebView2 como https://centro.aura.local/).
// Los avatares 3D son los mismos de la app (vendor/aura-avatar-suite/integration/*-embed.html), con un
// puente mínimo para que hablen con la página (allá lo hacía window.ReactNativeWebView).
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const salida = join(aqui, '..', 'src', 'Aura.Windows', 'CentroAssets');
const vigilar = process.argv.includes('--vigilar');
rmSync(salida, { recursive: true, force: true });
mkdirSync(join(salida, 'avatar'), { recursive: true });

await build({
  entryPoints: [join(aqui, 'src', 'main.ts')],
  bundle: true, format: 'iife', target: 'es2022', minify: !vigilar, sourcemap: vigilar ? 'inline' : false,
  outfile: join(salida, 'centro.js'), legalComments: 'none',
  loader: { '.css': 'css' },
});
cpSync(join(aqui, 'public'), salida, { recursive: true });

const shim = '<script>window.ReactNativeWebView={postMessage:function(s){try{parent.postMessage({avatar3d:JSON.parse(s)},"*")}catch(e){}}};' +
  'addEventListener("message",function(e){if(e.data&&e.data.aAvatar&&window.__aura)window.__aura(e.data.aAvatar)});</script>';
const origen = join(aqui, '..', '..', 'vendor', 'aura-avatar-suite', 'integration');
for (const id of ['aura', 'claudio', 'antonio']) {
  const f = join(origen, `${id}-embed.html`);
  if (!existsSync(f)) continue;
  const html = readFileSync(f, 'utf8').replace('<body', shim + '<body');
  writeFileSync(join(salida, 'avatar', `${id}.html`), html);
}
console.log('Centro armado en', salida);
