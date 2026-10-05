/**
 * Una captura de «Lo que veo» con una foto de verdad (no es una prueba: es para MIRARLA). Las cajas salen
 * del motor de caras sobre la foto SIN espejar (como las de ML Kit sobre la foto del bucle) y se dibujan con
 * las cuentas de la app (lib/vistaEnVivo.ts) sobre la foto ESPEJADA (como la vista previa de la cámara
 * frontal) en un marco con su proporción. Si las cuentas del espejo estuvieran mal, los recuadros caerían
 * en la cara de al lado. También la trasera (sin espejo) en un marco que recorta (cover).
 *
 *   cd mobile && PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx tsx pruebas/caras/captura-vista.mjs [salida.png]
 *
 * Usa la caché de navegador.mjs (córrelo antes una vez). Sin Chromium o sin la caché, se salta.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MOTOR_CARAS_HTML, FACE_API_VERSION } from '../../src/caras/motorCarasHtml.ts';
import { cajaEnPantalla, lineaEstado, marcoParaFoto } from '../../src/lib/vistaEnVivo.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MOVIL = path.resolve(AQUI, '../..');
const salida = process.argv[2] || path.join(os.tmpdir(), 'lo-que-veo.png');
const CACHE = path.join(os.tmpdir(), `caras-cdn-${FACE_API_VERSION}`);
const local = (url) => path.join(CACHE, url.replace(/^https:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_'));
const muestra = local(`https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${FACE_API_VERSION}/demo/sample1.jpg`);
if (!fs.existsSync(muestra)) {
  console.log('se salta: corre antes pruebas/caras/navegador.mjs (baja la caché)');
  process.exit(0);
}
const { chromium } = createRequire(path.join(MOVIL, '..', 'package.json'))('playwright-core');
const base = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache/ms-playwright');
const dir = fs.readdirSync(base).find((d) => d.startsWith('chromium-'));
const nav = await chromium.launch({ executablePath: path.join(base, dir, 'chrome-linux/chrome'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const pag = await nav.newPage({ viewport: { width: 860, height: 520 } });
  await pag.route('https://cdn.jsdelivr.net/**', (r) => {
    const f = local(r.request().url());
    return fs.existsSync(f) ? r.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'access-control-allow-origin': '*', 'content-type': f.endsWith('.js') ? 'application/javascript' : 'application/octet-stream' } }) : r.fulfill({ status: 404 });
  });
  await pag.route('https://motor.caras.local/', (r) => r.fulfill({ status: 200, body: MOTOR_CARAS_HTML, headers: { 'content-type': 'text/html' } }));
  await pag.goto('https://motor.caras.local/');
  await pag.waitForFunction(() => (window.__carasSalida || []).some((m) => m.tipo === 'lista'), null, { timeout: 120_000 });
  const b64 = fs.readFileSync(muestra).toString('base64');
  await pag.evaluate((b64) => window.__caras({ tipo: 'analizar', id: 1, imagen: b64 }), b64);
  await pag.waitForFunction(() => (window.__carasSalida || []).some((m) => m.id === 1), null, { timeout: 60_000 });
  const r = await pag.evaluate(() => window.__carasSalida.find((m) => m.id === 1));
  const dims = await pag.evaluate(async (b64) => {
    const i = new Image();
    i.src = `data:image/jpeg;base64,${b64}`;
    await i.decode();
    return { w: i.naturalWidth, h: i.naturalHeight };
  }, b64);
  const nombres = ['José · tú', 'Ana · tu esposa', 'Persona'];
  const panel = (titulo, marco, espejo) => {
    const cajas = r.caras
      .map((c, i) => ({ r: cajaEnPantalla(c.caja, dims, marco, espejo), t: nombres[i] || 'Persona', conocida: i < 2 }))
      .filter((x) => x.r)
      .map(({ r: q, t, conocida }) => `<div style="position:absolute;left:${q.left}px;top:${q.top}px;width:${q.width}px;height:${q.height}px;border:2px solid ${conocida ? '#D6B56C' : 'rgba(255,255,255,.9)'};border-radius:6px"><span style="position:absolute;left:-2px;top:-22px;white-space:nowrap;font:800 12.5px sans-serif;padding:2px 6px;border-radius:6px;background:${conocida ? '#D6B56C' : 'rgba(255,255,255,.9)'};color:#111">${t}</span></div>`)
      .join('');
    const estado = lineaEstado({ lado: espejo ? 'frontal' : 'trasera', personas: r.caras.length, mirando: true, nombres: nombres.slice(0, 2), reconociendo: true });
    // La vista previa llena el marco (cover) y, con la frontal, se ve espejada.
    return `<div style="display:inline-block;margin:12px;vertical-align:top"><div style="color:#ddd;font:700 13px sans-serif;margin-bottom:6px">${titulo}</div>
      <div style="position:relative;width:${marco.w}px;height:${marco.h}px;overflow:hidden;border:2px solid rgba(255,255,255,.75);border-radius:16px;background:#000">
        <img src="data:image/jpeg;base64,${b64}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;${espejo ? 'transform:scaleX(-1)' : ''}">
        ${cajas}
        <div style="position:absolute;right:8px;top:8px;display:flex;gap:8px">${['Trasera', 'Cerrar'].map((b) => `<span style="background:rgba(18,19,22,.82);color:#F2EEE8;font:800 13px sans-serif;border-radius:999px;padding:7px 12px;border:1px solid rgba(255,255,255,.35)">${b}</span>`).join('')}</div>
        <div style="position:absolute;left:0;right:0;bottom:0;padding:7px 12px;background:rgba(18,19,22,.72);color:#F2EEE8;font:700 13.5px sans-serif;text-align:center">${estado}</div>
      </div></div>`;
  };
  const m1 = marcoParaFoto(dims, { w: 400, h: 440 });
  const html = `<body style="margin:0;background:#232528">${panel('Frontal (espejada), marco con la proporción de la foto', m1, true)}${panel('Trasera, marco 3:4 (recorta: cover)', { w: 330, h: 440 }, false)}</body>`;
  await pag.setContent(html);
  await pag.screenshot({ path: salida });
  console.log(`[vista] ${r.caras.length} caras; captura en ${salida}`);
} finally {
  await nav.close();
}
