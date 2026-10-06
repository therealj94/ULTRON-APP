/**
 * El motor de caras DE VERDAD (src/caras/motorCarasHtml.ts) en un Chromium sin pantalla, el mismo
 * motor que la WebView de Android: carga face-api con su huella SRI, analiza fotos reales (las de
 * muestra del propio paquete) y mide cuánto separa a una persona de otra.
 *
 *   cd mobile && npx tsx pruebas/caras/navegador.mjs
 *
 * Los archivos del CDN (face-api, modelos, fotos de muestra) se bajan una vez con curl a una caché
 * temporal y se le sirven a la página interceptando las peticiones (así el navegador no necesita el
 * proxy). Sin red, sin Playwright o sin Chromium, se salta (no falla).
 *
 * Qué mide (lo imprime con «[caras]»):
 *  · cuántas caras encuentra en cada foto y cuánto tarda por foto;
 *  · la MISMA cara en variantes de la foto (más chica, más clara, más oscura, recortada, girada 6°):
 *    su distancia al original (debe quedar bajo UMBRAL);
 *  · caras de personas DISTINTAS: su distancia (debe quedar sobre UMBRAL);
 *  · con `identificar` (src/caras/caras.ts), aciertos, confusiones y «no sé» al reconocer las variantes.
 *  · caras LEJANAS (la foto achicada dentro de una de 1280×720, como la del bucle de la cámara): la foto
 *    entera con el detector chico a 416 (lo de antes) contra los recortes agrandados de las cajas de ML Kit
 *    (lo de ahora, `cajas` en el mensaje): cuántas ve y reconoce cada uno, y que ninguno confunda nombres.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MOTOR_CARAS_HTML, FACE_API_URL, MODELOS_URL, FACE_API_VERSION } from '../../src/caras/motorCarasHtml.ts';
import { UMBRAL, distancia, identificar } from '../../src/caras/caras.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MOVIL = path.resolve(AQUI, '../..');
const saltar = (por) => {
  console.log(`se salta: ${por}`);
  process.exit(0);
};

let chromium;
try {
  ({ chromium } = createRequire(path.join(MOVIL, '..', 'package.json'))('playwright-core'));
} catch {
  saltar('no está playwright-core (npm i en la raíz)');
}
function buscarChrome() {
  if (process.env.CHROME && fs.existsSync(process.env.CHROME)) return process.env.CHROME;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache/ms-playwright');
  if (!fs.existsSync(base)) return null;
  for (const d of fs.readdirSync(base).sort().reverse()) {
    for (const f of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
      const p = path.join(base, d, f);
      if (d.startsWith('chromium') && fs.existsSync(p)) return p;
    }
  }
  return null;
}
const chrome = buscarChrome();
if (!chrome) saltar('no hay Chromium instalado');

// ── la caché de lo que sirve el CDN ─────────────────────────────────────────────────────────
const CACHE = path.join(os.tmpdir(), `caras-cdn-${FACE_API_VERSION}`);
fs.mkdirSync(CACHE, { recursive: true });
const DEMO = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${FACE_API_VERSION}/demo/`;
const archivos = [
  FACE_API_URL,
  ...['tiny_face_detector_model', 'face_landmark_68_model', 'face_recognition_model'].flatMap((m) => [`${MODELOS_URL}${m}-weights_manifest.json`, `${MODELOS_URL}${m}.bin`]),
  ...[1, 2, 3, 4, 5, 6].map((i) => `${DEMO}sample${i}.jpg`),
];
const local = (url) => path.join(CACHE, url.replace(/^https:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_'));
try {
  for (const url of archivos) {
    const f = local(url);
    if (fs.existsSync(f) && fs.statSync(f).size > 0) continue;
    execFileSync('curl', ['-sfL', '--max-time', '120', '-o', f, url]);
  }
} catch (e) {
  saltar(`sin red para bajar face-api y sus modelos (${String(e.message || e).slice(0, 80)})`);
}

let fallos = 0;
const ok = (cond, que) => {
  console.log(`${cond ? '  ok  ' : 'FALLA '} ${que}`);
  if (!cond) fallos++;
};

const nav = await chromium.launch({ executablePath: chrome, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const pag = await nav.newPage({ viewport: { width: 64, height: 64 } });
  const errores = [];
  pag.on('pageerror', (e) => errores.push(String(e)));
  await pag.route('https://cdn.jsdelivr.net/**', async (ruta) => {
    const url = ruta.request().url();
    const f = local(url);
    if (!fs.existsSync(f)) return ruta.fulfill({ status: 404, body: 'no' });
    const tipo = url.endsWith('.js') ? 'application/javascript' : url.endsWith('.json') ? 'application/json' : url.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream';
    return ruta.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': tipo, 'access-control-allow-origin': '*' } });
  });
  // Un origen https para que la huella SRI y CORS se comporten como en la WebView.
  await pag.route('https://motor.caras.local/', (r) => r.fulfill({ status: 200, body: MOTOR_CARAS_HTML, headers: { 'content-type': 'text/html' } }));
  await pag.goto('https://motor.caras.local/');
  const esperar = async (pred, ms = 90_000) => {
    const hasta = Date.now() + ms;
    while (Date.now() < hasta) {
      const s = await pag.evaluate(() => window.__carasSalida || []);
      const m = s.find(pred);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  };
  const lista = await esperar((m) => m.tipo === 'lista' || m.tipo === 'fallo');
  ok(lista?.tipo === 'lista', `carga face-api con la huella SRI y los tres modelos (${lista?.motor || lista?.motivo || 'sin respuesta'})`);
  if (lista?.tipo !== 'lista') throw new Error('no cargó');

  let n = 0;
  const analizar = async (b64, cajas) => {
    const id = ++n;
    await pag.evaluate(([id, b64, cajas]) => window.__caras({ tipo: 'analizar', id, imagen: b64, ...(cajas ? { cajas } : {}) }), [id, b64, cajas || null]);
    const r = await esperar((m) => m.id === id && (m.tipo === 'caras' || m.tipo === 'error'), 60_000);
    if (!r || r.tipo !== 'caras') throw new Error(`análisis ${id}: ${r?.motivo || 'sin respuesta'}`);
    return r;
  };
  // Variantes de la misma foto, hechas en la página con un canvas (como saldría otra toma).
  const variante = (b64, v) =>
    pag.evaluate(
      async ([b64, v]) => {
        const img = new Image();
        img.src = `data:image/jpeg;base64,${b64}`;
        await img.decode();
        const W = Math.round(img.naturalWidth * (v.escala || 1));
        const H = Math.round(img.naturalHeight * (v.escala || 1));
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const g = c.getContext('2d');
        g.filter = `brightness(${v.brillo || 1})`;
        g.translate(W / 2, H / 2);
        g.rotate(((v.giro || 0) * Math.PI) / 180);
        g.drawImage(img, -W / 2 - (v.corrimiento || 0) * W, -H / 2, W, H);
        return c.toDataURL('image/jpeg', 0.8).split(',')[1];
      },
      [b64, v]
    );
  const VARIANTES = [
    { nombre: 'más chica', escala: 0.6 },
    { nombre: 'más clara', brillo: 1.3 },
    { nombre: 'más oscura', brillo: 0.7 },
    { nombre: 'corrida', corrimiento: 0.04 },
    { nombre: 'girada 6°', giro: 6 },
  ];
  const centro = (c) => ({ x: c.caja.x + c.caja.w / 2, y: c.caja.y + c.caja.h / 2 });
  const conocidas = [];
  const tiempos = [];
  const mismas = [];
  let aciertos = 0;
  let confusiones = 0;
  let noSe = 0;
  for (let i = 1; i <= 6; i++) {
    const b64 = fs.readFileSync(local(`${DEMO}sample${i}.jpg`)).toString('base64');
    const r = await analizar(b64);
    tiempos.push(r.ms);
    console.log(`[caras] sample${i}.jpg: ${r.caras.length} cara(s) en ${r.ms} ms`);
    const base = r.caras.filter((c) => c.caja.w > 0.04);
    base.forEach((c, k) => conocidas.push({ id: `s${i}c${k}`, nombre: `s${i}c${k}`, relacion: 'conocido', vectores: [c.vector], centro: centro(c) }));
    for (const v of VARIANTES) {
      const rv = await analizar(await variante(b64, v));
      tiempos.push(rv.ms);
      for (const c of rv.caras) {
        // La cara original más cercana en la foto (mismo lugar, corregido por el corrimiento).
        const p = centro(c);
        const cand = conocidas.filter((k) => k.id.startsWith(`s${i}c`));
        const orig = cand.map((k) => ({ k, d: Math.hypot(k.centro.x - p.x - (v.corrimiento || 0), k.centro.y - p.y) })).sort((a, b) => a.d - b.d)[0];
        if (!orig || orig.d > 0.06) continue;
        mismas.push(distancia(c.vector, orig.k.vectores[0]));
        const quien = identificar(c.vector, conocidas);
        if (!quien) noSe++;
        else if (quien.id === orig.k.id) aciertos++;
        else confusiones++;
      }
    }
  }
  const distintas = [];
  for (let a = 0; a < conocidas.length; a++) for (let b = a + 1; b < conocidas.length; b++) distintas.push(distancia(conocidas[a].vectores[0], conocidas[b].vectores[0]));
  const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const r3 = (x) => Math.round(x * 1000) / 1000;
  console.log(`[caras] ${conocidas.length} caras distintas en las 6 fotos; ${mismas.length} comparaciones de la misma cara en variantes`);
  console.log(`[caras] misma cara: mediana ${r3(med(mismas))}, máx ${r3(Math.max(...mismas))} · distintas: mediana ${r3(med(distintas))}, mín ${r3(Math.min(...distintas))} (umbral ${UMBRAL})`);
  const falsosRechazos = mismas.filter((d) => d >= UMBRAL).length;
  const falsasAceptaciones = distintas.filter((d) => d < UMBRAL).length;
  console.log(`[caras] con umbral ${UMBRAL}: ${falsosRechazos}/${mismas.length} rechazos falsos · ${falsasAceptaciones}/${distintas.length} aceptaciones falsas`);
  console.log(`[caras] identificar(): ${aciertos} aciertos · ${confusiones} confusiones · ${noSe} «no sé» · tiempo por foto: mediana ${med(tiempos)} ms (Chromium con SwiftShader, sin GPU)`);
  // ── caras LEJANAS: la foto de muestra achicada dentro de una foto de 1280×720 (como la del bucle) ──
  // Lo de antes (la foto entera con el detector chico a 416) contra lo de ahora (recortes agrandados de las
  // cajas que da ML Kit; aquí las cajas salen de la detección en la foto original, llevadas a la lejana).
  const lejana = (b64, escala) =>
    pag.evaluate(
      async ([b64, escala]) => {
        const img = new Image();
        img.src = `data:image/jpeg;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = 1280;
        c.height = 720;
        const g = c.getContext('2d');
        g.fillStyle = '#6b6b6b';
        g.fillRect(0, 0, 1280, 720);
        const w = 1280 * escala;
        const h = (w * img.naturalHeight) / img.naturalWidth;
        const x = (1280 - w) / 2;
        const y = (720 - h) / 2;
        g.drawImage(img, x, y, w, h);
        return { b64: c.toDataURL('image/jpeg', 0.5).split(',')[1], x: x / 1280, y: y / 720, w: w / 1280, h: h / 720 };
      },
      [b64, escala]
    );
  const lejos = { antes: { vistas: 0, aciertos: 0, confusiones: 0 }, ahora: { vistas: 0, aciertos: 0, confusiones: 0 }, total: 0, dAhora: [], px: [] };
  for (const escala of [0.45, 0.3]) {
    for (let i = 1; i <= 6; i++) {
      const b64 = fs.readFileSync(local(`${DEMO}sample${i}.jpg`)).toString('base64');
      const orig = conocidas.filter((k) => k.id.startsWith(`s${i}c`));
      const caras0 = (await analizar(b64)).caras.filter((c) => c.caja.w > 0.04);
      const f = await lejana(b64, escala);
      const enLejana = (c) => ({ x: f.x + c.x * f.w, y: f.y + c.y * f.h, w: c.w * f.w, h: c.h * f.h });
      const cajas = caras0.map((c) => enLejana(c.caja));
      lejos.total += cajas.length;
      for (const c of cajas) lejos.px.push(Math.round(c.w * 1280));
      const quienEs = (c) => {
        const p = { x: c.caja.x + c.caja.w / 2, y: c.caja.y + c.caja.h / 2 };
        return orig.map((k) => ({ k, d: Math.hypot(f.x + k.centro.x * f.w - p.x, f.y + k.centro.y * f.h - p.y) })).sort((a, b) => a.d - b.d)[0];
      };
      const contar = (lista, r, conIndice) => {
        for (const c of r.caras) {
          // Con recortes, el índice dice de qué caja es (las cajas salen de la misma detección que `conocidas`).
          const o = conIndice ? { k: orig[c.indice] } : quienEs(c);
          if (!o?.k || (!conIndice && o.d > 0.03)) continue;
          lista.vistas++;
          const q = identificar(c.vector, conocidas);
          if (q?.id === o.k.id) lista.aciertos++;
          else if (q) lista.confusiones++;
          if (conIndice) lejos.dAhora.push(distancia(c.vector, o.k.vectores[0]));
        }
      };
      contar(lejos.antes, await analizar(f.b64), false);
      contar(lejos.ahora, await analizar(f.b64, cajas), true);
    }
  }
  console.log(`[caras] lejanas (${lejos.total} caras de ${Math.min(...lejos.px)}-${Math.max(...lejos.px)} px de ancho, mediana ${med(lejos.px)}, en fotos de 1280×720): foto entera a 416 → ${lejos.antes.vistas} vistas, ${lejos.antes.aciertos} reconocidas, ${lejos.antes.confusiones} confusiones · recortes de las cajas de ML Kit → ${lejos.ahora.vistas} vistas, ${lejos.ahora.aciertos} reconocidas, ${lejos.ahora.confusiones} confusiones (mediana de distancia ${r3(med(lejos.dAhora))})`);
  ok(lejos.ahora.vistas > lejos.antes.vistas && lejos.ahora.aciertos > lejos.antes.aciertos, 'caras lejanas: los recortes de las cajas encuentran y reconocen más que la foto entera');
  ok(lejos.ahora.confusiones === 0 && lejos.antes.confusiones === 0, 'caras lejanas: nunca el nombre de otro (ni antes ni ahora)');

  ok(conocidas.length >= 6, 'encuentra caras en las fotos de muestra');
  ok(conocidas.every((c) => c.vectores[0].length === 128), 'cada cara da un vector de 128 números (y nada más)');
  ok(mismas.length >= 10 && falsosRechazos / mismas.length <= 0.1, 'la misma cara en otra toma queda bajo el umbral (≤ 10 % de rechazos)');
  ok(falsasAceptaciones === 0, 'ninguna pareja de personas distintas queda bajo el umbral');
  ok(confusiones === 0, 'identificar() nunca llama a alguien con el nombre de otro');
  ok(errores.length === 0, `sin errores de página${errores.length ? `: ${errores[0].slice(0, 120)}` : ''}`);
} catch (e) {
  ok(false, `el motor corre entero (${String(e.message || e).slice(0, 160)})`);
} finally {
  await nav.close();
}
console.log(fallos ? `\n${fallos} fallo(s)` : '\ntodo bien');
process.exit(fallos ? 1 : 0);
