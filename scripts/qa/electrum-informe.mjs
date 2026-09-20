#!/usr/bin/env node
/**
 * El recorrido completo del informe: abrir Dr Electrum con la llave de demostración, abrir el mapa,
 * pulsar PDF y quedarse con el documento que sale.
 *
 * No se prueba la ruta con curl a propósito: lo que hay que comprobar es que la captura del lienzo
 * de MapLibre llega de verdad al PDF. Eso solo pasa si el navegador la hizo.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2];
const llave = process.argv[3];
const salida = process.argv[4] || 'qa-informe';
fs.mkdirSync(salida, { recursive: true });

const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-gl=swiftshader'] });
const p = await nav.newPage({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
p.on('pageerror', (e) => console.log('ERROR:', String((e && e.stack) || e).slice(0, 900)));
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/arcgisonline|openstreetmap|ERR_TOO_MANY/.test(t)) console.log('consola:', t.slice(0, 200)); });
p.on('response', (r) => r.url().includes('/api/electrum') && console.log('respuesta', r.status(), r.url().replace(/^https?:\/\/[^/]+/, '')));

await p.goto(`${base}/electrum.html?llave=${encodeURIComponent(llave)}`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
await p.click('text=DR ELECTRUM');           // la cara cede el paso, aparece el mapa
await p.waitForTimeout(6000);                 // que carguen las teselas: sin ellas la captura es negra

const captura = await p.evaluate(() => {
  const m = window.__mapa;
  const l = m?.getCanvas?.();
  return l ? { w: l.width, h: l.height, muestra: l.toDataURL('image/jpeg', 0.8).length } : null;
});
console.log('lienzo del mapa:', JSON.stringify(captura));

// Dos pasos, como en la vida real: el botón PIDE el informe, la tarjeta que aparece lo BAJA.
await p.click('button[title^="Informe de la cartera"]');
await p.waitForSelector('text=se guarda media hora', { timeout: 30000 });
await p.screenshot({ path: path.join(salida, 'tarjeta.png') });
const [descarga] = await Promise.all([
  p.waitForEvent('download', { timeout: 25000 }),
  p.click('text=se guarda media hora'),
]);
const destino = path.join(salida, descarga.suggestedFilename() || 'informe.pdf');
await descarga.saveAs(destino);
console.log('informe', destino, fs.statSync(destino).size, 'bytes');

await p.screenshot({ path: path.join(salida, 'pantalla.png') });
await nav.close();
