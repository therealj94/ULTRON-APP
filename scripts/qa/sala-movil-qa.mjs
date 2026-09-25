/**
 * La sala tal como la carga la APK: la página empaquetada (mobile/src/sala/salaHtml.ts) en un
 * Chromium con el mismo puente que react-native-webview (ReactNativeWebView.postMessage de ida,
 * window.__aura de vuelta), en un teléfono horizontal. Guarda capturas y falla si la sala no dice
 * «listo», si algo escribe un error en la consola o si un mensaje no produce lo que debe.
 *
 *   node scripts/qa/sala-movil-qa.mjs [carpeta-de-capturas]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const salida = process.argv[2] || 'qa-sala-movil';
fs.mkdirSync(salida, { recursive: true });
const mod = fs.readFileSync(new URL('../../mobile/src/sala/salaHtml.ts', import.meta.url), 'utf8');
const html = JSON.parse(mod.slice(mod.indexOf('export const SALA_HTML = ') + 25).trim().replace(/;$/, ''));

const navegador = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const errores = [];
async function probar(nombre, postura, vista) {
  const pag = await navegador.newPage({ viewport: vista, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  pag.on('console', (m) => m.type() === 'error' && errores.push(`${nombre}: ${m.text()}`));
  pag.on('pageerror', (e) => errores.push(`${nombre}: ${e.message}`));
  // Lo mismo que hace SalaAura: la postura antes de cargar, y un ReactNativeWebView que recoge mensajes.
  await pag.addInitScript((p) => {
    window.__auraPostura = p;
    window.__mensajes = [];
    window.ReactNativeWebView = { postMessage: (s) => window.__mensajes.push(JSON.parse(s)) };
  }, postura);
  // Una página propia servida de memoria (setContent no corre los scripts de inicio).
  await pag.route('https://sala.local/', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await pag.goto('https://sala.local/', { waitUntil: 'load' });
  await pag.waitForFunction(() => window.__mensajes.some((m) => m.tipo === 'listo' || m.tipo === 'fallo'), null, { timeout: 15000 });
  const msgs = await pag.evaluate(() => window.__mensajes);
  if (!msgs.some((m) => m.tipo === 'listo')) throw new Error(`${nombre}: la sala no dijo listo: ${JSON.stringify(msgs)}`);
  const aura = (m) => pag.evaluate((x) => window.__aura(x), m);
  const foto = (n) => pag.screenshot({ path: path.join(salida, `${nombre}-${n}.png`) });

  await aura({ tipo: 'estado', face: 'IDLE', emocion: 'neutral' });
  await aura({ tipo: 'postura', p: postura });
  await aura({ tipo: 'entrar' });
  await pag.waitForTimeout(1200);
  await foto('1-entrando');
  await pag.waitForTimeout(4500);
  await foto('2-en-su-sitio');
  await aura({ tipo: 'estado', face: 'THINKING', emocion: 'pensando' });
  await aura({ tipo: 'tarea', tarea: 'buscar' });
  await pag.waitForTimeout(4000);
  await foto('3-buscando');
  await aura({ tipo: 'estado', face: 'SPEAKING', emocion: 'feliz' });
  for (let i = 0; i < 20; i += 1) {
    await aura({ tipo: 'boca', n: (Math.sin(i) + 1) / 2 });
    await pag.waitForTimeout(66);
  }
  await foto('4-contestando');
  await aura({ tipo: 'estado', face: 'IDLE', emocion: 'feliz' });
  await aura({ tipo: 'tarea', tarea: 'enviar' });
  await aura({ tipo: 'estado', face: 'SPEAKING', emocion: 'orgullo' });
  await pag.waitForTimeout(2600);
  await foto('5-enviando');
  await aura({ tipo: 'estado', face: 'IDLE', emocion: 'neutral' });
  await pag.waitForTimeout(9000);
  await foto('6-de-vuelta');

  // Tocarle la cabeza. --aura-x/--aura-y es el ancla de la burbuja, un poco por encima de la cabeza:
  // se toca más abajo, en plena cara. La sala tiene que contestar con {tipo:'tocar'}.
  const antes = (await pag.evaluate(() => window.__mensajes)).length;
  const x = parseFloat(await pag.evaluate(() => getComputedStyle(document.getElementById('sala')).getPropertyValue('--aura-x'))) || vista.width / 2;
  const y = parseFloat(await pag.evaluate(() => getComputedStyle(document.getElementById('sala')).getPropertyValue('--aura-y'))) || vista.height / 3;
  await pag.mouse.click(x, y + Math.round(vista.height * 0.14));
  await pag.waitForTimeout(300);
  const nuevos = (await pag.evaluate(() => window.__mensajes)).slice(antes);
  if (!nuevos.some((m) => m.tipo === 'tocar')) errores.push(`${nombre}: tocarla no llegó al teléfono (${x},${y}) ${JSON.stringify(nuevos)}`);

  await aura({ tipo: 'estado', face: 'SLEEPING', emocion: 'cansado' });
  await pag.waitForTimeout(7000);
  await foto('7-dormida');
  console.log(`${nombre}: ok · ${JSON.stringify(nuevos)}`);
  await pag.close();
}

await probar('pie', 'pie', { width: 915, height: 412 });
await probar('sentada', 'sentada', { width: 800, height: 360 });
await navegador.close();
if (errores.length) {
  console.error(errores.join('\n'));
  process.exit(1);
}
console.log('sala del teléfono: sin errores');
