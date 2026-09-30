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
  // La hoja «Más» (José: en su Samsung las tarjetas salían apiladas): letra 1.0, 1.3 y 2.0; 360/412; acostado.
  ['mas-360-letra-1.3', '?p=mas&escala=1.3', 360, 780],
  ['mas-360-letra-2.0', '?p=mas&escala=2', 360, 780],
  ['mas-412-letra-1.3', '?p=mas&escala=1.3', 412, 915],
  ['mas-412-letra-2.0', '?p=mas&escala=2', 412, 915],
  ['mas-apaisada', '?p=mas', 780, 360],
  ['mas-apaisada-letra-2.0', '?p=mas&escala=2', 915, 412],
  ['tutorial-1-hablar', '?p=tutorial&paso=0', 360, 780],
  ['tutorial-3-chat', '?p=tutorial&paso=2', 360, 780],
  ['tutorial-7-camara', '?p=tutorial&paso=6', 360, 780],
  ['transicion-1-grande', '?p=transicion&h=1', 360, 780],
  ['transicion-2', '?p=transicion&h=0.7', 360, 780],
  ['transicion-3', '?p=transicion&h=0.4', 360, 780],
  ['transicion-4-chiquita', '?p=transicion&h=0', 360, 780],
  // La llamada del avatar (compa/LlamadaAvatar): entrante, en llamada, minimizada sobre los chats, colgada
  // y la compañera entrando caminando; en 360 y 412 de ancho, acostado y con la letra grande.
  ['llamada-1-entrante-claudio-360', '?p=llamada&e=sonando&a=claudio', 360, 780],
  ['llamada-1-entrante-aura-412', '?p=llamada&e=sonando&a=aura', 412, 915],
  ['llamada-1-entrante-recordatorio-360', '?p=llamada&e=sonando&a=antonio&rec=1', 360, 780],
  ['llamada-1-entrante-apaisada', '?p=llamada&e=sonando&a=claudio', 780, 360],
  ['llamada-2-conectando-360', '?p=llamada&e=conectando&a=claudio', 360, 780],
  ['llamada-3-en-llamada-claudio-360', '?p=llamada&e=en_llamada&a=claudio', 360, 780],
  ['llamada-3-en-llamada-aura-412', '?p=llamada&e=en_llamada&a=aura', 412, 915],
  ['llamada-3-en-llamada-letra-grande', '?p=llamada&e=en_llamada&a=claudio&escala=1.6', 412, 915],
  ['llamada-3-silenciada-360', '?p=llamada&e=silenciado&a=claudio', 360, 780],
  ['llamada-3-en-llamada-apaisada', '?p=llamada&e=en_llamada&a=antonio', 780, 360],
  ['llamada-4-minimizada-sobre-chats-360', '?p=llamada&e=en_llamada&a=claudio&min=1', 360, 780],
  ['llamada-4-minimizada-sobre-chats-412', '?p=llamada&e=silenciado&a=aura&min=1', 412, 915],
  ['llamada-5-colgada-360', '?p=llamada&e=colgada&a=claudio', 360, 780],
  ['llamada-5-perdida-360', '?p=llamada&e=perdida&a=claudio&rec=1', 360, 780],
  ['llamada-6-compania-entra-1', '?p=compania&t=0.15', 360, 780],
  ['llamada-6-compania-entra-2', '?p=compania&t=0.55', 360, 780],
  ['llamada-6-compania-entra-3-llego', '?p=compania&t=1', 360, 780],
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
  // En la llamada del avatar: cada botón (rechazar, contestar, silenciar, altavoz, minimizar, colgar, la píldora) dentro y de 48 px o más.
  if (qs.includes('p=llamada')) {
    const deLlamada = await pag.evaluate(() =>
      [...document.querySelectorAll('[aria-label]')]
        .map((e) => ({ l: e.getAttribute('aria-label'), r: e.getBoundingClientRect() }))
        .filter((b) => /Rechazar|contestar|Silenciar|Silenciado|Altavoz|Minimizar|Colgar|volver a la llamada/.test(b.l || ''))
        .map((b) => ({ l: b.l.slice(0, 28), x: Math.round(b.r.left), d: Math.round(b.r.right), arriba: Math.round(b.r.top), abajo: Math.round(b.r.bottom), alto: Math.round(b.r.height), ancho: Math.round(b.r.width) }))
    );
    botones.push(...deLlamada.map((b) => ({ ...b, llamada: true })));
    if (!deLlamada.length && !qs.includes('e=colgada') && !qs.includes('e=perdida')) botones.push({ l: 'la llamada no tiene botones', x: -1, d: 0, alto: 0 });
  }
  // La hoja «Más»: ninguna tarjeta se encima con otra (los rectángulos medidos), todas dentro de lo ancho
  // y de 48 px o más; lo que no cabe de alto tiene que poder desplazarse (su contenedor desplazable).
  if (qs.includes('p=mas')) {
    const t = await pag.evaluate(() => {
      const tarjetas = [...document.querySelectorAll('[aria-label]')]
        .filter((e) => /^(Conversar|Que |Colgar|Escribir|Cámara|Caras|Avatar|Modo |Qué puedo|Ajustes|Chats)/.test(e.getAttribute('aria-label') || '') && e.getAttribute('aria-label').includes('. '))
        .map((e) => {
          const r = e.getBoundingClientRect();
          let p = e.parentElement;
          let desplaza = false;
          while (p) {
            const cs = getComputedStyle(p);
            if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight) desplaza = true;
            p = p.parentElement;
          }
          return { l: e.getAttribute('aria-label').split('.')[0], x: r.left, y: r.top, w: r.width, h: r.height, desplaza };
        });
      return tarjetas;
    });
    for (let i = 0; i < t.length; i++)
      for (let j = i + 1; j < t.length; j++) {
        const a = t[i], b = t[j];
        const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ix > 1 && iy > 1) botones.push({ l: `«${a.l}» se encima con «${b.l}»`, x: -1, d: 0, alto: 0 });
      }
    for (const a of t) {
      if (a.h < 48 || a.x < 0 || a.x + a.w > w + 1) botones.push({ l: `tarjeta «${a.l}» ${Math.round(a.w)}×${Math.round(a.h)}`, x: -1, d: 0, alto: 0 });
      if (a.y + a.h > h + 1 && !a.desplaza) botones.push({ l: `tarjeta «${a.l}» fuera de la pantalla y sin desplazamiento`, x: -1, d: 0, alto: 0 });
    }
    if (t.length < 8) botones.push({ l: `la hoja tiene ${t.length} tarjetas`, x: -1, d: 0, alto: 0 });
    console.log(`     hoja «Más»: ${t.length} tarjetas, ${t.filter((a) => a.y + a.h > h).length} por debajo (desplazables)`);
  }
  const malos = botones.filter((b) => b.x < 0 || b.d > w || b.alto < 48 || (b.llamada && (b.ancho < 48 || b.abajo > h || b.arriba < 0)));
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
