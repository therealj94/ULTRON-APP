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
  ['SPEAKING-media', 'neutral', 0.35],
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
// En el preview no hay backend de voz: el reproductor (src/03-voz/player.ts, startLip) deja un setInterval
// de 40 ms que nunca se limpia en onended/onerror y manda lip=0 para siempre, pisando `setLip`.
// Sólo en QA se neutraliza: se devuelve un id válido sin programar nada (antes 1e9 ms desbordaba el
// int32 del temporizador y Chromium lo ejecutaba cada ~1 ms). El parche se limita a ESE callback
// (se reconoce por `getByteTimeDomainData` en su código, que sobrevive a la minificación); cualquier
// otro intervalo de 40 ms de la app corre normal. El arreglo real es del área de voz; hecho eso, borrar esto.
await page.addInitScript(() => {
  const orig = window.setInterval;
  let inerte = 1 << 20;
  window.setInterval = function (fn, ms, ...rest) {
    if (ms === 40 && typeof fn === 'function' && String(fn).includes('getByteTimeDomainData')) return ++inerte;
    return orig.call(window, fn, ms, ...rest);
  };
});
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(`${base}/?qa=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__ultron, null, { timeout: 15000 }).catch(() => {});
await page.evaluate(() => window.__ultron?.boot(false));
await page.mouse.click(640, 700); // gesto: desbloquea audio, cierra overlays
await page.waitForTimeout(1800); // wake-in de los ojos

// Apertura de ojos medida en el canvas (píxeles cian en la banda de los ojos). Sirve para no capturar
// a mitad de un parpadeo: cada estado se muestrea ~700 ms (más que un parpadeo, ~0.6 s), se toma el
// máximo y se espera a que la apertura vuelva a >= 92 % de ese máximo antes del screenshot.
const apertura = () =>
  page.evaluate(() => {
    const c = document.getElementById('ultron-face-canvas');
    if (!c) return -1;
    const ctx = c.getContext('2d');
    const r = c.getBoundingClientRect();
    const k = c.width / Math.max(1, r.width);
    const bandY = Math.round(200 * k), bandH = Math.round(320 * k);
    const d = ctx.getImageData(0, bandY, c.width, bandH).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i + 1] > 110 && d[i + 2] > 110) n++;
    return n;
  });
const sinParpadeo = async (ventanaMs = 700, timeoutMs = 1500) => {
  let max = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < ventanaMs) {
    max = Math.max(max, await apertura());
    await page.waitForTimeout(50);
  }
  const t1 = Date.now();
  while (Date.now() - t1 < timeoutMs) {
    const a = await apertura();
    if (a >= max * 0.92) return a;
    await page.waitForTimeout(50);
  }
  return -1;
};
const captura = async (nombre, esperarOjos = true) => {
  if (esperarOjos) await sinParpadeo();
  await page.screenshot({ path: path.join(out, `${nombre}.png`) });
  console.log('captura', nombre);
};

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
  await page.waitForTimeout(face === 'PRAY' || face === 'SLEEPING' ? 1600 : 500);
  await captura(estado); // + ~700 ms de muestreo sin parpadeo
}
// Tacto: cada vista se captura poco después del contacto (respuesta inmediata) y se deja asentar.
const reposo = async () => {
  await page.evaluate(() => { const u = window.__ultron; u.setEmocion('neutral'); u.setFace('IDLE'); u.setLip(0); });
  await page.waitForTimeout(1500);
};
const toque = async (nombre, x, y, esperaMs = 220) => {
  await reposo();
  await page.mouse.click(x, y);
  await page.waitForTimeout(esperaMs);
  await captura(nombre, false); // reacción inmediata: se captura al instante, sin esperar
};
// Geometría del dibujo: baseR = min(1280·0.115, 720·0.22) ≈ 147; ojos en 640 ± 232; boca ≈ 360 + 1.28·R.
await toque('TACTO-ojo', 640 - 232, 360, 160);
await toque('TACTO-barbilla', 640, 560, 260);
await toque('TACTO-mejilla', 1080, 480, 260); // fuera del radio del ojo (147 px), dentro de la mejilla
await toque('TACTO-frente', 640, 140, 260);
await toque('TACTO-centro', 640, 360, 160);

// Regresión (revisor): tocar la mejilla de una cara HAPPY no debe apagarle la sonrisa. Se captura
// 2.5 s después del tap (la envolvente touchSmile ya decayó): debe seguir con sonrisa amplia y comisuras.
await reposo();
await page.evaluate(() => { const u = window.__ultron; u.setEmocion('feliz'); u.setFace('HAPPY'); });
await page.waitForTimeout(1500);
await page.mouse.click(1080, 480);
await page.waitForTimeout(2500);
await captura('HAPPY-tocada');

// Ráfaga «ya, ya»: tres toques en 1.4 s → molestia juguetona y luego risa.
await reposo();
await page.mouse.click(1080, 480);
await page.waitForTimeout(250);
await page.mouse.click(1080, 480);
await page.waitForTimeout(250);
await page.mouse.click(1080, 480);
await page.waitForTimeout(450);
await page.screenshot({ path: path.join(out, 'YAYA-molesto.png') });
await page.waitForTimeout(1300);
await page.screenshot({ path: path.join(out, 'YAYA-risa.png') });

// Mirada a la persona (cameraGaze): brillo y giro sutil hacia el lado.
await reposo();
await page.evaluate(() => window.__ultron.setGaze(0.7, -0.15, true));
await page.waitForTimeout(600);
await captura('MIRADA-persona');
await page.evaluate(() => window.__ultron.setGaze(0, 0, false));

// Arrastre (al final: al soltar puede contar como swipe): los ojos siguen el dedo, la boca se estira.
await reposo();
await page.mouse.move(560, 300);
await page.mouse.down();
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(560 + i * 45, 300 + i * 12);
  await page.waitForTimeout(40);
}
await page.waitForTimeout(260);
await page.screenshot({ path: path.join(out, 'ARRASTRE.png') });
await page.mouse.up();

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
