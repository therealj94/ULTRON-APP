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
  // Las fuentes IBM Plex (src/fuentes, copiadas de windows/marca/fuentes) viajan con el Centro: la CSP solo
  // deja cargar fuentes propias (font-src 'self'). estilos.css las pide con rutas relativas.
  loader: { '.css': 'css', '.woff2': 'file' }, assetNames: 'fuentes/[name]',
});
cpSync(join(aqui, 'public'), salida, { recursive: true });
cpSync(join(aqui, 'src', 'fuentes', 'OFL-IBM-Plex.txt'), join(salida, 'fuentes', 'OFL-IBM-Plex.txt'));

// Mismo color-scheme que la página: si no coinciden, Chromium pinta el iframe sobre un fondo blanco opaco.
const shim = '<meta name="color-scheme" content="dark"><style>:root,html,body{color-scheme:dark;background:transparent!important}</style><script>window.ReactNativeWebView={postMessage:function(s){try{parent.postMessage({avatar3d:JSON.parse(s)},"*")}catch(e){}}};' +
  'addEventListener("message",function(e){if(e.data&&e.data.aAvatar&&window.__aura)window.__aura(e.data.aAvatar)});</script>';
const origen = join(aqui, '..', '..', 'vendor', 'aura-avatar-suite', 'integration');
// AU-RA ya no usa su modelo 3D (es el orbe, abajo): solo Claudio y ANT-ONIO.
for (const id of ['claudio', 'antonio']) {
  const f = join(origen, `${id}-embed.html`);
  if (!existsSync(f)) continue;
  const html = readFileSync(f, 'utf8').replace('<body', shim + '<body');
  writeFileSync(join(salida, 'avatar', `${id}.html`), html);
}
// La cara de AU-RA: su orbe de partículas (aprobado por José). La fuente de verdad es src/14-orbe/orbe.html; aquí
// solo se copia tal cual (test/orbe.test.mjs comprueba que la copia armada es idéntica). El notch la publica aparte
// desde el .csproj (OrbeAssets/orbe.html).
const orbe = join(aqui, '..', '..', 'src', '14-orbe', 'orbe.html');
if (!existsSync(orbe)) throw new Error('Falta el orbe de AU-RA: ' + orbe);
cpSync(orbe, join(salida, 'avatar', 'orbe.html'));
// La hoja «idle» de cada avatar (la misma del notch) para el respaldo sin WebGL.
const hojas = join(aqui, '..', 'src', 'Aura.Windows', 'AvatarAssets');
for (const id of ['claudio', 'antonio']) {
  const f = join(hojas, id, 'idle.png');
  if (existsSync(f)) cpSync(f, join(salida, 'avatar', `${id}-idle.png`));
}
// El recorrido (src/recorrido): los clips de Claudio y ANT-ONIO, sus fotos y los sonidos, los MISMOS
// archivos de la app del teléfono (no se duplican en el repo; viajan en el instalador).
const movil = join(aqui, '..', '..', 'mobile', 'assets');
const CLIPS = ['reposo', 'escucha', 'habla', 'piensa', 'risa', 'saluda', 'senala', 'sorpresa'];
const SONIDOS = { 'whoosh.mp3': 'sfx', 'tap.mp3': 'sfx', 'teclado.mp3': 'sfx', 'papel.mp3': 'sfx', 'chispa.wav': 'recorrido', 'capitulo.wav': 'recorrido', 'timbre.wav': 'llamada' };
mkdirSync(join(salida, 'recorrido', 'video'), { recursive: true });
mkdirSync(join(salida, 'recorrido', 'sonidos'), { recursive: true });
const faltan = [];
const copiar = (de, a) => (existsSync(de) ? cpSync(de, a) : faltan.push(de));
for (const q of ['claudio', 'antonio']) {
  for (const c of CLIPS) copiar(join(movil, 'avatares', 'video', `${q}-${c}.mp4`), join(salida, 'recorrido', 'video', `${q}-${c}.mp4`));
  copiar(join(movil, 'avatares', q, 'base.webp'), join(salida, 'recorrido', `${q}.webp`));
}
for (const [f, carpeta] of Object.entries(SONIDOS)) copiar(join(movil, carpeta, f), join(salida, 'recorrido', 'sonidos', f));
if (faltan.length) throw new Error('Faltan archivos del recorrido:\n' + faltan.join('\n'));
console.log('Centro armado en', salida);
