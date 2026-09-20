#!/usr/bin/env node
/**
 * Renderiza un PDF en Chromium y saca una captura por página.
 *
 * Un PDF que compila no es un PDF que se ve bien. Las métricas mal, una tabla que se sale del
 * papel o una imagen del revés no dan ningún error: salen en la hoja. Esto lo mira.
 *
 *   CHROMIUM_PATH=... node scripts/qa/ver-pdf.mjs archivo.pdf salida/ [paginas]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const archivo = path.resolve(process.argv[2]);
const salida = process.argv[3] || 'qa-pdf';
const paginas = Number(process.argv[4] || 1);
fs.mkdirSync(salida, { recursive: true });

const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await nav.newPage({ viewport: { width: 900, height: 1180 } });
p.on('pageerror', (e) => console.log('ERROR:', String(e).slice(0, 160)));
await p.goto(`file://${archivo}`, { waitUntil: 'load' });
await p.waitForTimeout(3000);

for (let i = 1; i <= paginas; i += 1) {
  if (i > 1) {
    // El visor de Chromium va por páginas con Re Pág.
    await p.keyboard.press('PageDown');
    await p.waitForTimeout(700);
  }
  const f = path.join(salida, `pag-${i}.png`);
  await p.screenshot({ path: f });
  console.log('captura', f);
}
await nav.close();
