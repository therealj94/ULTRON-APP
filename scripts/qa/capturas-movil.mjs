#!/usr/bin/env node
/**
 * Capturas de la cara del MÓVIL (mobile/src/components/UltronFace.tsx) en un navegador.
 *
 * La cara del teléfono está escrita en React Native, así que no se puede mirar con Playwright tal cual.
 * scripts/qa/cara-movil/ la monta con react-native-web; este script la fotografía estado por estado y
 * arma una hoja de contactos. Es la única forma honesta de revisar el diseño del móvil sin un teléfono
 * delante: así se vieron los tres fallos que se arreglaron en 4.1.2 (párpado recto que partía el ojo,
 * ojo hueco al orar y boca de un hilo en reposo).
 *
 * Uso:
 *   npx vite build --config scripts/qa/cara-movil/vite.config.mts --outDir /tmp/qacara --emptyOutDir
 *   node scripts/qa/capturas-movil.mjs /tmp/qacara [dirSalida] [estado ...]
 * CHROMIUM_PATH apunta a un Chromium ya instalado si Playwright no trae el suyo.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const DIR = process.argv[2];
const SALIDA = process.argv[3] || path.join(process.cwd(), 'qa-capturas-movil');
const ESTADOS = process.argv.slice(4);
if (!DIR) {
  console.error('Falta el directorio del banco compilado. Ver la cabecera de este archivo.');
  process.exit(1);
}
const PREDETERMINADOS = ['IDLE', 'SPEAKING', 'HAPPY', 'LAUGH', 'SURPRISED', 'ANGRY', 'PRAY', 'SLEEPING'].map((f) => `face=${f}`);
const lista = ESTADOS.length ? ESTADOS : PREDETERMINADOS;
await mkdir(SALIDA, { recursive: true });

const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = createServer(async (req, res) => {
  const f = new URL(req.url, 'http://x').pathname === '/' ? '/index.html' : new URL(req.url, 'http://x').pathname;
  try {
    const b = await readFile(path.join(DIR, f));
    res.writeHead(200, { 'content-type': tipos[path.extname(f)] || 'application/octet-stream' });
    res.end(b);
  } catch {
    res.writeHead(404);
    res.end('no');
  }
});
await new Promise((r) => srv.listen(4599, r));

const navegador = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
// Samsung Galaxy S25+ en horizontal, en puntos: 891 × 411. Es el teléfono de la junta.
const pagina = await navegador.newPage({ viewport: { width: 891, height: 411 }, deviceScaleFactor: 2 });
pagina.on('pageerror', (e) => console.log('  ERROR de página:', String(e).slice(0, 300)));
for (const estado of lista) {
  await pagina.goto(`http://127.0.0.1:4599/?${estado}`, { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(1400); // que arranquen respiración, parpadeo y visemas
  const nombre = estado.replace(/[^a-zA-Z0-9]+/g, '_');
  await pagina.screenshot({ path: path.join(SALIDA, `${nombre}.png`) });
  console.log('captura', nombre);
}
await navegador.close();
srv.close();
