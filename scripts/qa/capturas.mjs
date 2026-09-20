#!/usr/bin/env node
/**
 * Capturas de la cara en cada estado, con Chromium headless (Playwright).
 * Uso: node scripts/qa/capturas.mjs [urlBase] [dirSalida]
 *   urlBase por defecto http://127.0.0.1:3459 (levantar antes: npm run build && NODE_ENV=production PORT=3459 node dist/server.cjs)
 * Genera dirSalida/<estado>.png y dirSalida/hoja.png (mosaico).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:3459';
const out = process.argv[3] || path.join(process.cwd(), 'qa-capturas');
fs.mkdirSync(out, { recursive: true });

const ESTADOS = [
  ['IDLE', 'neutral', 0],
  ['LISTENING', 'neutral', 0],
  ['THINKING', 'pensando', 0],
  ['SPEAKING', 'neutral', 0.7],
  ['SPEAKING-cerrada', 'neutral', 0.05],
  ['HAPPY', 'feliz', 0],
  ['LAUGH', 'risa', 0.6],
  ['SURPRISED', 'sorpresa', 0],
  ['CURIOSITY', 'curioso', 0],
  ['CONCERNED', 'preocupado', 0],
  ['SAD', 'triste', 0],
  ['ANGRY', 'molesto', 0],
  ['TIRED', 'cansado', 0],
  ['PURR', 'carino', 0],
  ['WINK', 'travieso', 0],
  ['SING', 'canto', 0.8],
  ['PRAY', 'oracion', 0.4],
  ['SLEEPING', 'neutral', 0],
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(`${base}/?qa=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__ultron, null, { timeout: 15000 }).catch(() => {});
await page.evaluate(() => window.__ultron?.boot(false));
await page.mouse.click(640, 700); // gesto: desbloquea audio, cierra overlays
await page.waitForTimeout(1800); // wake-in de los ojos

for (const [estado, emocion, lip] of ESTADOS) {
  const face = String(estado).split('-')[0];
  await page.evaluate(
    ({ face, emocion, lip }) => {
      const u = window.__ultron;
      u.setEmocion(emocion);
      u.setFace(face);
      u.setLip(lip);
    },
    { face, emocion, lip }
  );
  await page.waitForTimeout(face === 'PRAY' || face === 'SLEEPING' ? 1600 : 1100);
  await page.screenshot({ path: path.join(out, `${estado}.png`) });
  console.log('captura', estado);
}
// Tacto: toque en el ojo izquierdo y en la barbilla
await page.evaluate(() => { const u = window.__ultron; u.setEmocion('neutral'); u.setFace('IDLE'); u.setLip(0); });
await page.waitForTimeout(600);
await page.mouse.click(640 - 220, 360);
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(out, 'TACTO-ojo.png') });
await page.waitForTimeout(1600);
await page.mouse.click(640, 560);
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(out, 'TACTO-barbilla.png') });

// Mosaico
const files = fs.readdirSync(out).filter((f) => f.endsWith('.png') && f !== 'hoja.png').sort();
const cols = 4;
const w = 320, h = 180;
const rows = Math.ceil(files.length / cols);
const hoja = await browser.newPage({ viewport: { width: cols * w, height: rows * (h + 22) } });
const items = files.map((f) => ({ f, data: fs.readFileSync(path.join(out, f)).toString('base64') }));
await hoja.setContent(
  `<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${w}px);font:11px monospace;color:#05E1FF">` +
    items.map((it) => `<div><img src="data:image/png;base64,${it.data}" width="${w}" height="${h}" style="display:block"><div style="padding:3px 6px">${it.f.replace('.png', '')}</div></div>`).join('') +
    '</body>'
);
await hoja.screenshot({ path: path.join(out, 'hoja.png'), fullPage: true });
console.log('hoja', path.join(out, 'hoja.png'));
await browser.close();
