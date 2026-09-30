#!/usr/bin/env node
/**
 * CAPTURAS DE LA MESA DEL TELÉFONO (la OTA sobre 4.7.0): la barra de tres botones, la hoja «Más», el recorrido y la
 * transición grande → chiquita, montadas con react-native-web (vite.config.mts de esta carpeta) en
 * Chromium a tamaño de teléfono: 360×780 (angosto) y 412×915, y con la letra del sistema al 160 %.
 *
 *   node scripts/qa/mesa-movil/capturas.mjs <salida> [--sin-construir]
 *
 * Además de las fotos, comprueba lo que se puede comprobar sin teléfono: que ningún botón de la barra
 * quede fuera de la pantalla ni mida menos de 48 px de alto, y anota los errores de página.
 * Chromium: PLAYWRIGHT_BROWSERS_PATH (o CHROMIUM_PATH para uno concreto).
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const aqui = import.meta.dirname;
const raiz = path.resolve(aqui, '../../..');
const salida = path.resolve(process.argv[2] || '/tmp/mesa-movil');
const web = path.join(salida, '_web');
fs.mkdirSync(salida, { recursive: true });
if (!process.argv.includes('--sin-construir')) {
  execFileSync('npx', ['vite', 'build', '--config', path.join(aqui, 'vite.config.mts'), '--outDir', web, '--emptyOutDir', '--logLevel', 'warn'], { cwd: raiz, stdio: 'inherit' });
}

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png' };
const srv = createServer(async (req, res) => {
  const p = (req.url || '/').split('?')[0];
  const f = path.join(web, p === '/' ? 'index.html' : p);
  try {
    const cuerpo = await readFile(f);
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' });
    res.end(cuerpo);
  } catch {
    res.writeHead(404).end('no');
  }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

const ESCENAS = [
  ['barra-360', '?p=barra', 360, 780],
  ['barra-412', '?p=barra', 412, 915],
  ['barra-360-letra-grande', '?p=barra&escala=1.6', 360, 780],
  ['barra-en-vivo-360', '?p=vivo', 360, 780],
  ['mas-360', '?p=mas', 360, 780],
  ['mas-412-letra-grande', '?p=mas&escala=1.6', 412, 915],
  ['tutorial-1-hablar', '?p=tutorial&paso=0', 360, 780],
  ['tutorial-3-chat', '?p=tutorial&paso=2', 360, 780],
  ['tutorial-7-camara', '?p=tutorial&paso=6', 360, 780],
  ['transicion-1-grande', '?p=transicion&h=1', 360, 780],
  ['transicion-2', '?p=transicion&h=0.7', 360, 780],
  ['transicion-3', '?p=transicion&h=0.4', 360, 780],
  ['transicion-4-chiquita', '?p=transicion&h=0', 360, 780],
];

// Un Chromium ya instalado: CHROMIUM_PATH, o el de PLAYWRIGHT_BROWSERS_PATH aunque sea de otra versión de Playwright.
function buscarChrome() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const pbp = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!pbp || !fs.existsSync(pbp)) return undefined;
  for (const d of fs.readdirSync(pbp).sort().reverse()) {
    const p = path.join(pbp, d, 'chrome-linux/chrome');
    if (d.startsWith('chromium-') && fs.existsSync(p)) return p;
  }
  return undefined;
}
const nav = await chromium.launch({ executablePath: buscarChrome() });
let problemas = 0;
for (const [nombre, qs, w, h] of ESCENAS) {
  const pag = await nav.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const errores = [];
  pag.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));
  await pag.goto(`${base}/${qs}`, { waitUntil: 'networkidle' });
  await pag.waitForTimeout(500);
  await pag.screenshot({ path: path.join(salida, `${nombre}.png`) });
  // Los botones de la barra (por su etiqueta accesible): dentro de la pantalla y de 48 px o más.
  const botones = await pag.evaluate(() =>
    [...document.querySelectorAll('[aria-label]')]
      .map((e) => ({ l: e.getAttribute('aria-label'), r: e.getBoundingClientRect() }))
      .filter((b) => /Abrir tus chats|micrófono|Más opciones/.test(b.l || ''))
      .map((b) => ({ l: b.l.slice(0, 28), x: Math.round(b.r.left), d: Math.round(b.r.right), alto: Math.round(b.r.height) }))
  );
  const malos = botones.filter((b) => b.x < 0 || b.d > w || b.alto < 48);
  if (qs.includes('p=barra') || qs.includes('p=vivo')) {
    if (botones.length !== 3) malos.push({ l: `hay ${botones.length} botones en la barra (deben ser 3)` });
  }
  problemas += malos.length + errores.length;
  console.log(`${malos.length || errores.length ? 'MAL ' : 'ok  '} ${nombre}${botones.length ? `  botones: ${botones.map((b) => `${b.l.split(':')[0]} ${b.alto}px`).join(' · ')}` : ''}${malos.length ? `  ${JSON.stringify(malos)}` : ''}${errores.length ? `  errores: ${errores.join(' | ')}` : ''}`);
  await pag.close();
}
await nav.close();
srv.close();
console.log(problemas ? `\n${problemas} problema(s)` : `\ntodo bien · capturas en ${salida}`);
process.exit(problemas ? 1 : 0);
