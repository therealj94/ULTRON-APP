#!/usr/bin/env node
/** La web de Dr Electrum, de extremo a extremo: entrar, expedientes, cargador, hablar, informe. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2];
const token = process.argv[3];
const salida = process.argv[4] || 'qa-web';
fs.mkdirSync(salida, { recursive: true });

const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-gl=swiftshader'] });
const ctx = await nav.newContext({ viewport: { width: 1280, height: 820 }, ignoreHTTPSErrors: true });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('ERROR:', String((e && e.stack) || e).slice(0, 400)));
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/arcgis|openstreetmap|ERR_TOO|tile/.test(t)) console.log('consola:', t.slice(0, 200)); });
p.on('response', (r) => r.url().includes('/api/electrum') && console.log('  ', r.status(), r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 60)));

// 1. Sin sesión: la pantalla tiene que DECIRLO, no quedarse muda.
await p.goto(`${base}/electrum.html`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);
await p.click('text=DR ELECTRUM');
await p.waitForTimeout(1500);
await p.click('text=Expedientes');
await p.waitForTimeout(1500);
await p.screenshot({ path: path.join(salida, '1-sin-puerta.png') });
console.log('1 sin puerta ok');

// 2. Con sesión: el cargador y lo cargado.
await ctx.addInitScript((t) => { try { localStorage.setItem('ultron_sesion_token', t); } catch {} }, token);
await p.goto(`${base}/electrum.html`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);
await p.click('text=DR ELECTRUM');
await p.waitForTimeout(2000);
await p.click('text=Expedientes');
await p.waitForTimeout(2000);
await p.screenshot({ path: path.join(salida, '2-expedientes.png') });
console.log('2 expedientes ok');

// 3. Subir un archivo de verdad por el cargador.
await p.setInputFiles('input[type=file]', 'tests/fixtures/gis/catastro.zip');
await p.waitForTimeout(6000);
await p.screenshot({ path: path.join(salida, '3-cargado.png') });
console.log('3 carga ok');

// 4. La consulta, con sus botones nuevos.
await p.click('text=Consulta');
await p.waitForTimeout(900);
await p.screenshot({ path: path.join(salida, '4-consulta.png') });

// 5. Teléfono.
const tel = await ctx.newPage();
await tel.setViewportSize({ width: 400, height: 840 });
await tel.goto(`${base}/electrum.html`, { waitUntil: 'domcontentloaded' });
await tel.waitForTimeout(1200);
await tel.click('text=DR ELECTRUM');
await tel.waitForTimeout(1800);
await tel.click('text=Expedientes');
await tel.waitForTimeout(1800);
await tel.screenshot({ path: path.join(salida, '5-telefono.png') });
console.log('5 teléfono ok');

await nav.close();
