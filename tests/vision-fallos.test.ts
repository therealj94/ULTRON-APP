/**
 * CUANDO EL OJO NO VE (lib/vision.ts).
 *
 * Una cuota agotada de Gemini (429) terminaba como `via: 'ninguno'` con «Falta GEMINI_API_KEY»:
 * mentía sobre la causa —la llave estaba— y le enseñaba al usuario, por el 503 de
 * `/api/vision/analyze`, cómo se llaman las variables del servidor. Ahora el código de Gemini va al
 * registro y a quien mandó la foto le llega una frase fija.
 *
 * Y el reloj: nodo 28 s + Gemini 28 s no caben en los 35 s del teléfono. Con el presupuesto, lo
 * que el nodo se come ya no se le puede dar a Gemini.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { verImagen, vistaFallida, NO_PUDE_VER } from '../lib/vision';
import { presupuesto } from '../lib/presupuesto';
import { guardarCaja } from '../lib/boveda';

const FOTO = `data:image/jpeg;base64,${Buffer.alloc(900, 7).toString('base64')}`;
const VARIABLE = /[A-Z]{3,}_[A-Z_]+/;

function preparar(t: any, opts: { ojo?: boolean; gemini?: boolean }) {
  const fetchOriginal = globalThis.fetch;
  const warnOriginal = console.warn;
  const env = { ULTRON_OJO_URL: process.env.ULTRON_OJO_URL, PLAYWRIGHT_NODE_URL: process.env.PLAYWRIGHT_NODE_URL, ULTRON_OJO_CLAVE: process.env.ULTRON_OJO_CLAVE, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
  for (const k of Object.keys(env)) delete process.env[k];
  guardarCaja('ojo_url', opts.ojo ? 'http://ojo.prueba' : '');
  guardarCaja('ojo_clave', opts.ojo ? 'clave-ojo' : '');
  guardarCaja('gemini', opts.gemini ? 'llave-de-prueba' : '');
  const avisos: string[] = [];
  console.warn = (...a: unknown[]) => void avisos.push(a.map(String).join(' '));
  t.after(() => {
    globalThis.fetch = fetchOriginal;
    console.warn = warnOriginal;
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
    guardarCaja('ojo_url', '');
    guardarCaja('ojo_clave', '');
    guardarCaja('gemini', '');
  });
  return avisos;
}

test('Gemini con la cuota agotada: el 429 va al registro, al usuario una frase humana', async (t) => {
  const avisos = preparar(t, { gemini: true });
  globalThis.fetch = (async () => new Response('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}', { status: 429 })) as typeof fetch;

  const v = await verImagen(FOTO);
  assert.equal(v.via, 'error', 'no es «falta configuración»: la llave está y Gemini dijo que no');
  assert.equal(v.texto, NO_PUDE_VER);
  assert.doesNotMatch(v.texto, VARIABLE);
  assert.ok(vistaFallida(v));
  assert.ok(avisos.some((a) => /\[vision gemini\].*429/.test(a)), `el registro tiene el código: ${avisos.join(' | ')}`);
});

test('sin nada configurado, el nombre de la variable va solo al registro', async (t) => {
  const avisos = preparar(t, {});
  let llamadas = 0;
  globalThis.fetch = (async () => {
    llamadas += 1;
    return new Response('{}');
  }) as typeof fetch;

  const v = await verImagen(FOTO);
  assert.equal(v.via, 'ninguno');
  assert.equal(v.texto, NO_PUDE_VER);
  assert.equal(llamadas, 0);
  assert.ok(avisos.some((a) => /GEMINI_API_KEY/.test(a)), 'quien mantiene el servidor sí ve qué falta');
});

test('lo que el nodo se come del reloj no se le da a Gemini', async (t) => {
  preparar(t, { ojo: true, gemini: true });
  const pedidos: string[] = [];
  globalThis.fetch = ((url: any, init: any) => {
    const u = String(url);
    pedidos.push(u.includes('generativelanguage') ? 'gemini' : 'ojo');
    // El nodo dormido: no contesta hasta que le cortan.
    return new Promise((_ok, mal) => init.signal.addEventListener('abort', () => mal(init.signal.reason)));
  }) as typeof fetch;

  // `AbortSignal.timeout` no sostiene el proceso (en el servidor lo sostiene el puerto abierto); acá
  // hace falta algo vivo mientras tanto o la prueba termina antes que el corte.
  const vivo = setInterval(() => {}, 100);
  t.after(() => clearInterval(vivo));
  const t0 = Date.now();
  const v = await verImagen(FOTO, undefined, { presupuesto: presupuesto(1_800) });
  const ms = Date.now() - t0;
  assert.deepEqual(pedidos, ['ojo'], 'Gemini no se llama cuando ya no queda tiempo útil');
  assert.equal(v.via, 'tiempo');
  assert.equal(v.texto, NO_PUDE_VER);
  assert.ok(ms < 4_000, `el nodo se cortó con el presupuesto (${ms} ms), no a los 28 s`);
});

test('cuando el ojo ve, se usa lo que vio', async (t) => {
  preparar(t, { gemini: true });
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Una roca con vetas de cuarzo.' }] } }] }), { status: 200 })) as typeof fetch;
  const v = await verImagen(FOTO, undefined, { presupuesto: presupuesto(33_000) });
  assert.equal(v.texto, 'Una roca con vetas de cuarzo.');
  assert.match(v.via, /^gemini:/);
  assert.equal(vistaFallida(v), false);
});
