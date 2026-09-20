#!/usr/bin/env node
/**
 * Capturas de Dr Electrum FP: la cara en el centro, y la cara cediéndole el paso al mapa.
 *
 * El movimiento central de esta interfaz —la cara que se aparta— no se puede revisar leyendo código:
 * o se mira, o no se sabe. Esto lo mira.
 *
 *   npm run build && NODE_ENV=production PORT=3460 node dist/server.cjs
 *   CHROMIUM_PATH=... node scripts/qa/electrum.mjs http://127.0.0.1:3460 ./qa-electrum
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:3460';
const out = process.argv[3] || path.join(process.cwd(), 'qa-electrum');
fs.mkdirSync(out, { recursive: true });

const navegador = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=swiftshader'],
});

async function mirar(nombre, ancho, alto, hacer) {
  // El proxy del entorno de desarrollo firma con su propia autoridad y Chromium no la conoce, así
  // que sin esto las teselas del mapa no cargan y la captura sale negra. Solo afecta a QA local.
  const p = await navegador.newPage({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  p.on('pageerror', (e) => console.log(`  ERROR en ${nombre}:`, String(e).slice(0, 200)));
  await p.goto(`${base}/electrum.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  if (hacer) await hacer(p);
  await p.screenshot({ path: path.join(out, `${nombre}.png`) });
  console.log('captura', nombre);
  await p.close();
}

// 1. Como recibe: cara completa, centrada.
await mirar('1-cara', 1280, 800);

// 2. La cara cede el paso. Se fuerza el escenario de trabajo tocando la marca.
await mirar('2-trabajo', 1280, 800, async (p) => {
  await p.click('text=DR ELECTRUM');
  await p.waitForTimeout(5000); // que termine de encogerse y el mapa de encuadrar
});

// 3. A media transición, que es donde se ve si el movimiento está bien resuelto.
await mirar('3-a-medias', 1280, 800, async (p) => {
  await p.click('text=DR ELECTRUM');
  await p.waitForTimeout(300);
});

// 4. Teléfono: el panel tiene que volverse lámina de abajo, no media pantalla vacía.
await mirar('4-telefono', 400, 820, async (p) => {
  await p.click('text=DR ELECTRUM');
  await p.waitForTimeout(1800);
});

await navegador.close();
console.log('en', out);
