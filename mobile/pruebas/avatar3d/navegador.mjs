/**
 * La escena 3D de verdad, en un Chromium sin pantalla (el mismo motor que la WebView de Android):
 * arranca, recibe un .glb en pedazos como se lo manda el teléfono, lo carga, pone la cara y la boca
 * que pide el estado, hace un gesto, contesta qué zona hay bajo un dedo y mide sus cuadros.
 *
 *   cd mobile && node pruebas/avatar3d/navegador.mjs [modelo.glb] [mapeo.json]
 *
 * Sin modelo usa mobile/assets/avatar3d/aura.glb (el de Codex, cuando esté). Sin Playwright o sin
 * navegador se salta (no falla): es una prueba para quien conecta el modelo, no para cada máquina.
 * AVATAR3D_FOTO=/ruta.png guarda cómo se ve.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MOVIL = path.resolve(AQUI, '../..');
const glb = path.resolve(process.argv[2] || path.join(MOVIL, 'assets/avatar3d/aura.glb'));
const mapeoRuta = process.argv[3] || glb.replace(/\.glb$/i, '.mapeo.json');

function saltar(por) {
  console.log(`se salta: ${por}`);
  process.exit(0);
}

if (!fs.existsSync(glb)) saltar(`no hay modelo en ${path.relative(process.cwd(), glb)}`);
let chromium;
try {
  const req = createRequire(path.join(MOVIL, '..', 'package.json'));
  ({ chromium } = req('playwright-core'));
} catch {
  saltar('no está playwright-core (npm i en la raíz)');
}
// Un Chromium ya instalado (PLAYWRIGHT_BROWSERS_PATH o CHROME=/ruta/al/binario).
function buscarChrome() {
  if (process.env.CHROME && fs.existsSync(process.env.CHROME)) return process.env.CHROME;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(process.env.HOME || '', '.cache/ms-playwright');
  if (!fs.existsSync(base)) return null;
  for (const d of fs.readdirSync(base).sort().reverse()) {
    for (const f of ['chrome-linux/chrome', 'chrome-linux/headless_shell', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = path.join(base, d, f);
      if (d.startsWith('chromium') && fs.existsSync(p)) return p;
    }
  }
  return null;
}
const chrome = buscarChrome();
if (!chrome) saltar('no hay Chromium instalado');

const fuente = fs.readFileSync(path.join(MOVIL, 'src/avatar3d/escenaHtml.ts'), 'utf8');
const html = JSON.parse(/export const ESCENA_HTML = (".*");\s*$/m.exec(fuente)[1]);
const mapeo = fs.existsSync(mapeoRuta) ? JSON.parse(fs.readFileSync(mapeoRuta, 'utf8')) : null;

let fallos = 0;
const ok = (cond, que) => {
  console.log(`${cond ? '  ok  ' : 'FALLA '} ${que}`);
  if (!cond) fallos++;
};

const nav = await chromium.launch({ executablePath: chrome, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const pag = await nav.newPage({ viewport: { width: 360, height: 480 }, deviceScaleFactor: 2 });
  const errores = [];
  pag.on('pageerror', (e) => errores.push(String(e)));
  await pag.setContent(html);
  const esperar = async (tipo, ms = 20_000) => {
    const hasta = Date.now() + ms;
    while (Date.now() < hasta) {
      const s = await pag.evaluate(() => window.__avatarSalida || []);
      const f = s.find((m) => m.tipo === 'fallo');
      if (f) return f;
      const m = s.find((x) => x.tipo === tipo);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  };
  const lista = await esperar('lista');
  ok(lista?.tipo === 'lista', `la página arranca con WebGL (${lista?.motivo || 'lista'})`);
  if (lista?.tipo !== 'lista') throw new Error('sin escena');

  await pag.evaluate((m) => window.__avatar({ tipo: 'config', camara: 'cuerpo', fpsMax: 60, dprMax: 2, mapeo: m, reducido: false }), mapeo);
  // El modelo en pedazos de 3·64 KB (base64 sin relleno en medio), como lo manda Avatar3D.tsx.
  const bytes = fs.readFileSync(glb);
  const PASO = 3 * 65536;
  const total = Math.ceil(bytes.length / PASO);
  for (let i = 0; i < total; i++) {
    const b64 = bytes.subarray(i * PASO, (i + 1) * PASO).toString('base64');
    await pag.evaluate((m) => window.__avatar(m), { tipo: 'trozo', i, total, b64 });
  }
  await pag.evaluate((n) => window.__avatar({ tipo: 'fin', bytes: n }), bytes.length);
  const listo = await esperar('listo');
  ok(listo?.tipo === 'listo', `el modelo carga (${(bytes.length / 1024).toFixed(0)} KB)`);
  if (listo?.tipo !== 'listo') throw new Error(listo?.motivo || 'no cargó');
  console.log('        ', JSON.stringify(listo.info));

  // Enojada y hablando con una «a»: la cara y la boca van a donde dice el mapeo.
  const estado = { expresion: 'enojada', hablando: true, escuchando: false, silenciado: false, pensando: false, caminando: false, dir: 1, mirar: { x: 0.5, y: 0, activa: true }, gesto: { nombre: 'saludar', n: 1 }, globo: '' };
  await pag.evaluate((e) => {
    window.__avatar({ tipo: 'estado', estado: e });
    window.__avatar({ tipo: 'boca', nivel: 0.8, visema: 'aa', peso: 1 });
  }, estado);
  await new Promise((r) => setTimeout(r, 1200));
  const d = await pag.evaluate(() => window.__avatarDepurar());
  console.log('        ', JSON.stringify(d));
  const pesos = Object.entries(d.pesos).filter(([, v]) => v > 0.3);
  ok(pesos.length > 0 || listo.info.morphs === 0, `la expresión mueve blendshapes (${pesos.map(([k, v]) => `${k}=${v.toFixed(2)}`).join(', ') || 'el modelo no tiene'})`);
  // Sin su animación de reposo o sin «saludar» (un modelo de prueba cualquiera), no hay qué exigir: el revisor ya lo dice.
  const sinIdle = listo.info.faltan.includes('animación idle');
  ok(!!d.base || sinIdle, `hay animación de fondo (${d.base || 'el modelo no trae idle'})`);
  const conSaludo = listo.info.clips.some((c) => /saludar|wave/i.test(c));
  ok(!!d.gesto || !conSaludo, `el gesto «saludar» suena (${d.gesto || 'el modelo no trae saludar'})`);

  // Un dedo en el centro del cuerpo toca algo; en la esquina, nada.
  const zona = async (x, y, id) => {
    await pag.evaluate((m) => window.__avatar(m), { tipo: 'zona', id, x, y });
    const s = await pag.evaluate(() => window.__avatarSalida);
    return s.filter((m) => m.tipo === 'zona' && m.id === id).pop();
  };
  const centro = await zona(0.5, 0.45, 1);
  const esquina = await zona(0.02, 0.02, 2);
  ok(!!centro?.zona, `el centro es una zona (${centro?.zona})`);
  ok(esquina && esquina.zona === null, 'la esquina vacía no es ninguna');

  const r = await esperar('rendimiento', 15_000);
  ok(r?.tipo === 'rendimiento', `mide sus cuadros (${r ? `${r.fps} fps a ${r.dpr}×${r.lento ? ', lento: en un teléfono caería a 2D' : ''}` : 'sin respuesta'})`);
  ok(!errores.length, `sin errores en la página${errores.length ? `: ${errores[0]}` : ''}`);
  if (process.env.AVATAR3D_FOTO) await pag.screenshot({ path: process.env.AVATAR3D_FOTO });
} catch (e) {
  fallos++;
  console.log(`FALLA  ${String(e?.message || e)}`);
} finally {
  await nav.close();
}
console.log(fallos ? `\n${fallos} con fallos` : '\ntodo bien');
process.exit(fallos ? 1 : 0);
