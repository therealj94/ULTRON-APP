#!/usr/bin/env node
/**
 * CAPTURAS DE SU COMPUTADORA EN EL TELÉFONO: la hoja real (mobile/src/ajustes/Computadora.tsx) montada con react-native-web
 * (vite.config.mts de esta carpeta) en Chromium a tamaño de teléfono, en cada momento de una tarea (main.tsx): apagada,
 * lista, en fila, trabajando, esperando su sí, con el control, terminada, fallida y sin noticias.
 *
 *   node scripts/qa/computadora-movil/capturas.mjs <salida> [--sin-construir] [escena ...]
 *
 * Primero fotografía un escritorio de mentira (escritorio.html, 1280×800 como el nodo) en cuatro momentos y se los da a
 * la hoja como la pantalla de su computadora. Además de las fotos, comprueba lo que se puede comprobar sin teléfono: que
 * los mandos (Detener, Tomar el control, Sí / No) estén dentro de la pantalla y midan 44 px o más, y anota los errores.
 * Chromium: PLAYWRIGHT_BROWSERS_PATH (o CHROMIUM_PATH para uno concreto). Nunca instala navegadores.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const aqui = import.meta.dirname;
const raiz = path.resolve(aqui, '../../..');
const args = process.argv.slice(2);
const salida = path.resolve(args.find((a) => !a.startsWith('--')) || '/tmp/computadora-movil');
const elegidas = args.filter((a) => !a.startsWith('--')).slice(1);
const web = path.join(salida, '_web');
fs.mkdirSync(salida, { recursive: true });
if (!args.includes('--sin-construir')) {
  execFileSync('npx', ['vite', 'build', '--config', path.join(aqui, 'vite.config.mts'), '--outDir', web, '--emptyOutDir', '--logLevel', 'warn'], { cwd: raiz, stdio: 'inherit' });
}

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png' };
const srv = createServer(async (req, res) => {
  const p = (req.url || '/').split('?')[0];
  const f = p === '/escritorio.html' ? path.join(aqui, 'escritorio.html') : path.join(web, p === '/' ? 'index.html' : p);
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

// El escritorio de mentira: 1280×800 a escala 0,75 → JPEG de 960×600, como las miniaturas del nodo.
const capturas = {};
{
  const pag = await nav.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 0.75 });
  for (const f of ['1', '2', '3', '4']) {
    await pag.goto(`${base}/escritorio.html?f=${f}`, { waitUntil: 'load' });
    capturas[f] = (await pag.screenshot({ type: 'jpeg', quality: 70 })).toString('base64');
  }
  await pag.close();
}

// [nombre, escena, ancho, alto, espera ms]. «sinrespuesta» espera a que fallen tres lecturas seguidas (cada 2,5 s).
const ESCENAS = [
  ['1-apagada-360', 'apagada', 360, 780, 900],
  ['2-lista-360', 'lista', 360, 780, 900],
  ['3-en-fila-360', 'enfila', 360, 780, 900],
  ['4-trabajando-360', 'trabajando', 360, 780, 1500],
  ['4-trabajando-412', 'trabajando', 412, 915, 1500],
  ['5-espera-su-si-360', 'confirmar', 360, 780, 1500],
  ['6-con-el-control-360', 'control', 360, 780, 2200],
  ['7-terminada-360', 'terminada', 360, 780, 1500],
  ['8-fallo-360', 'fallo', 360, 780, 1500],
  ['9-sin-noticias-360', 'sinrespuesta', 360, 780, 9000],
].filter(([n, e]) => !elegidas.length || elegidas.some((x) => n.includes(x) || e === x));

const MANDOS = /^(Detener|Stop|Tomar el control|Pausar|Seguir|Devolver|Sí, hazlo|No$|Ver en grande|Pantalla completa)/;
let problemas = 0;
for (const [nombre, escena, w, h, espera] of ESCENAS) {
  const pag = await nav.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const errores = [];
  pag.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));
  await pag.addInitScript((c) => {
    globalThis.__PC_CAPTURAS = c;
  }, capturas);
  await pag.goto(`${base}/?p=${escena}`, { waitUntil: 'networkidle' });
  await pag.waitForTimeout(espera);
  await pag.screenshot({ path: path.join(salida, `${nombre}.png`) });
  // La hoja entera (desplazada hasta abajo por partes) para leer todo lo que dice, no solo lo que cabe.
  const largo = await pag.evaluate(() => {
    const d = [...document.querySelectorAll('div')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4).sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    return d ? { alto: d.scrollHeight, visible: d.clientHeight } : null;
  });
  const mandos = await pag.evaluate((re) => {
    const r = new RegExp(re);
    return [...document.querySelectorAll('[role="button"],button')]
      .map((e) => ({ t: (e.getAttribute('aria-label') || e.textContent || '').trim(), b: e.getBoundingClientRect() }))
      .filter((m) => r.test(m.t))
      .map((m) => ({ t: m.t.slice(0, 24), x: Math.round(m.b.left), d: Math.round(m.b.right), arriba: Math.round(m.b.top), abajo: Math.round(m.b.bottom), alto: Math.round(m.b.height) }));
  }, MANDOS.source);
  const mal = mandos.filter((m) => m.x < 0 || m.d > w + 1 || m.alto < 44 || m.abajo > h + 1);
  problemas += mal.length + errores.length;
  console.log(`${nombre}: ${errores.length ? `ERRORES ${errores.join(' | ')} ` : ''}${largo ? `hoja ${largo.alto}px (se ven ${largo.visible}) ` : ''}mandos ${mandos.map((m) => `${m.t}[${m.alto}px@${m.arriba}]`).join(', ') || '—'}${mal.length ? ` · FUERA/CHICOS: ${mal.map((m) => m.t).join(', ')}` : ''}`);
  await pag.close();
}
await nav.close();
srv.close();
console.log(problemas ? `\n${problemas} problema(s)` : '\nsin problemas medibles');
process.exit(problemas ? 1 : 0);
