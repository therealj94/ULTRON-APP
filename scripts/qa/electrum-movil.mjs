#!/usr/bin/env node
/**
 * Fotografía las pantallas de la APP de Dr Electrum, montadas con react-native-web.
 *
 * Un APK se construye en CI y tarda; mirar el diseño no puede depender de eso. Esto lo monta en un
 * navegador a tamaño de teléfono y saca una captura por pantalla, que es como se vieron y
 * arreglaron los fallos de la cara del móvil en su momento.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || '/var/tmp/qa-elmovil';
const salida = process.argv[3] || 'qa-electrum-movil';
fs.mkdirSync(salida, { recursive: true });

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = createServer(async (req, res) => {
  const p = (req.url || '/').split('?')[0];
  const f = path.join(dir, p === '/' ? 'index.html' : p);
  try {
    const cuerpo = await readFile(f);
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' });
    res.end(cuerpo);
  } catch {
    res.writeHead(404).end('no');
  }
});
await new Promise((r) => srv.listen(4599, r));

const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-gl=swiftshader'] });
for (const [nombre, q, espera] of [['1-arranque', '', 900], ['2-entrar', '?p=entrar', 1400], ['3-campo', '?p=campo', 1600], ['4-arranque-tarde', '', 3200]]) {
  const p = await nav.newPage({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 });
  p.on('pageerror', (e) => console.log(`ERROR en ${nombre}:`, String((e && e.stack) || e).slice(0, 300)));
  await p.goto(`http://127.0.0.1:4599/${q}`, { waitUntil: 'load' });
  await p.waitForTimeout(espera);
  await p.screenshot({ path: path.join(salida, `${nombre}.png`) });
  console.log('captura', nombre);
  await p.close();
}
await nav.close();
srv.close();
