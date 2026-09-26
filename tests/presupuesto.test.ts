/**
 * EL RELOJ DE UNA PETICIÓN Y LA CADENA DEL OÍDO (lib/presupuesto.ts, lib/oido.ts, server/desk.ts).
 *
 * Dos gastos que no se veían:
 *
 *  1. El oído probaba el nodo local 12 s, Scribe v2 20 s, Scribe v1 20 s y Gemini 20 s, cuando el
 *     teléfono corta a los 16 s. Todo lo de después era pagar respuestas que nadie esperaba.
 *  2. Un audio en silencio que Scribe contestaba bien («no hay voz») se le mandaba igual a Gemini:
 *     un silencio, dos facturas. Un vacío bien contestado es una respuesta, no un fallo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { presupuesto, MINIMO_UTIL_MS, PRESUPUESTO_OIDO_MS, PRESUPUESTO_VISION_MS } from '../lib/presupuesto';
import { oirEnCadena, transcribirAudio, type ProveedorOido, type Escucha } from '../lib/oido';
import { guardarCaja } from '../lib/boveda';

/* ------------------------------------------------------------------ el reloj */

test('el presupuesto cuenta hacia abajo y nunca da negativo', () => {
  let t = 1_000;
  const p = presupuesto(15_000, () => t);
  assert.equal(p.queda(), 15_000);
  t += 4_000;
  assert.equal(p.queda(), 11_000);
  t += 20_000;
  assert.equal(p.queda(), 0);
  assert.equal(p.alcanza(), false);
});

test('el tope de cada llamada es el suyo o lo que quede, lo que sea menos', () => {
  let t = 0;
  const p = presupuesto(15_000, () => t);
  assert.equal(p.tope(12_000), 12_000, 'con tiempo de sobra manda el tope del proveedor');
  t = 10_000;
  assert.equal(p.tope(20_000), 5_000, 'con poco tiempo manda lo que queda');
  assert.equal(p.tope(), 5_000, 'sin tope propio, lo que queda');
});

test('no se empieza una llamada que no tiene tiempo de contestar', () => {
  let t = 0;
  const p = presupuesto(10_000, () => t);
  t = 10_000 - MINIMO_UTIL_MS + 1;
  assert.equal(p.alcanza(), false);
  t = 10_000 - MINIMO_UTIL_MS;
  assert.equal(p.alcanza(), true);
});

test('sin tiempo, la señal nace cortada; con tiempo, corta sola', async () => {
  let t = 0;
  const p = presupuesto(1_000, () => t);
  t = 5_000;
  assert.equal(p.senal(20_000).aborted, true, 'la llamada ni sale');

  const q = presupuesto(80);
  const s = q.senal(20_000);
  assert.equal(s.aborted, false);
  await new Promise((r) => setTimeout(r, 160));
  assert.equal(s.aborted, true, 'cortó por el presupuesto, no a los 20 s del proveedor');
});

test('los presupuestos caben dentro de lo que espera el teléfono', () => {
  // mobile/src/lib/api.ts: `transcribe` corta a 16 s y `describeImage` a 35 s.
  assert.ok(PRESUPUESTO_OIDO_MS < 16_000);
  assert.ok(PRESUPUESTO_VISION_MS < 35_000);
});

/* ------------------------------------------------------------------ la cadena del oído */

function falso(nombre: string, hace: (reloj: any) => Promise<Escucha> | Escucha, listo = true) {
  const llamadas: number[] = [];
  const p: ProveedorOido = {
    nombre,
    listo: () => listo,
    oir: async (_a, _m, _l, reloj) => {
      llamadas.push(reloj.queda());
      return hace(reloj);
    },
  };
  return { p, llamadas };
}

const AUDIO = Buffer.alloc(4000, 1);

test('un vacío bien contestado corta la cadena: el silencio no se le paga a otro', async () => {
  const scribe = falso('scribe', () => ({ texto: '', via: 'elevenlabs:scribe_v2' }));
  const gemini = falso('gemini', () => ({ texto: 'no debería llegar acá', via: 'gemini' }));
  const r = await oirEnCadena([scribe.p, gemini.p], AUDIO, 'audio/m4a', 'es', presupuesto(15_000));
  assert.equal(r.motivo, 'respondio');
  assert.deepEqual(r.escucha, { texto: '', via: 'elevenlabs:scribe_v2' });
  assert.equal(gemini.llamadas.length, 0, 'Gemini no se enteró del silencio');

  const oido = await transcribirAudio({ audio: AUDIO, mime: 'audio/m4a', proveedores: [scribe.p, gemini.p] });
  assert.equal(oido.texto, '');
  assert.equal(oido.via, 'elevenlabs:scribe_v2');
  assert.match(oido.detalle, /no había voz/);
});

test('un fallo (null o excepción) sí pasa al siguiente', async () => {
  const local = falso('local', () => null);
  const scribe = falso('scribe', () => {
    throw new Error('429 cuota');
  });
  const gemini = falso('gemini', () => ({ texto: 'hola Aura', via: 'gemini' }));
  const r = await oirEnCadena([local.p, scribe.p, gemini.p], AUDIO, 'audio/m4a', 'es', presupuesto(15_000));
  assert.deepEqual(r.intentados, ['local', 'scribe', 'gemini']);
  assert.equal(r.escucha?.texto, 'hola Aura');
});

test('lo que no está configurado no cuenta como intento', async () => {
  const local = falso('local', () => ({ texto: 'x', via: 'local' }), false);
  const gemini = falso('gemini', () => ({ texto: 'hola', via: 'gemini' }));
  const r = await oirEnCadena([local.p, gemini.p], AUDIO, 'audio/m4a', 'es', presupuesto(15_000));
  assert.deepEqual(r.intentados, ['gemini']);
  assert.equal(local.llamadas.length, 0);
});

test('cuando se acaba el tiempo del cliente, no se llama a nadie más', async () => {
  let t = 0;
  const reloj = presupuesto(15_000, () => t);
  // El nodo local se cuelga hasta su tope de 12 s; Scribe, que es de pago, llega con 3 s.
  const local = falso('local', () => {
    t += 12_000;
    return null;
  });
  const scribe = falso('scribe', () => {
    t += 3_000;
    return null;
  });
  const gemini = falso('gemini', () => ({ texto: 'tarde', via: 'gemini' }));
  const r = await oirEnCadena([local.p, scribe.p, gemini.p], AUDIO, 'audio/m4a', 'es', reloj);
  assert.equal(r.motivo, 'tiempo');
  assert.deepEqual(r.intentados, ['local', 'scribe']);
  assert.equal(gemini.llamadas.length, 0, 'Gemini no se llama pasado el corte del teléfono');
  assert.equal(scribe.llamadas[0], 3_000, 'Scribe recibió solo lo que quedaba');

  t = 0;
  const oido = await transcribirAudio({
    audio: AUDIO,
    mime: 'audio/m4a',
    presupuesto: presupuesto(15_000, () => t),
    proveedores: [falso('local', () => ((t += 14_000), null)).p, gemini.p],
  });
  assert.equal(oido.via, 'tiempo');
  assert.equal(oido.texto, '');
});

test('sin ningún proveedor lo dice sin nombres de variables', async () => {
  const oido = await transcribirAudio({ audio: AUDIO, mime: 'audio/m4a', proveedores: [falso('x', () => null, false).p] });
  assert.equal(oido.via, 'ninguno');
  assert.doesNotMatch(oido.detalle, /[A-Z]{3,}_[A-Z_]+/, 'nada de ELEVENLABS_API_KEY ni GEMINI_API_KEY para quien habla');
});

/* ------------------------------------------------------------------ con los proveedores de verdad */

/**
 * La cadena real (Scribe y Gemini), con `fetch` de mentira. Es la prueba que importa: que el vacío
 * de Scribe no llegue a Gemini no depende de la cadena abstracta sino de cómo `elevenTranscribe`
 * y el proveedor de Scribe distinguen «contestó sin voz» de «falló».
 */
test('Scribe contesta sin voz: ni Scribe v1 ni Gemini reciben el audio', async (t) => {
  const fetchOriginal = globalThis.fetch;
  const stt = process.env.ULTRON_STT_URL;
  delete process.env.ULTRON_STT_URL;
  guardarCaja('elevenlabs', 'llave-de-prueba');
  guardarCaja('gemini', 'llave-de-prueba');
  const pedidos: string[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    pedidos.push(u.includes('elevenlabs') ? `eleven:${init?.body?.get?.('model_id')}` : u.includes('generativelanguage') ? 'gemini' : u);
    if (u.includes('elevenlabs')) return new Response(JSON.stringify({ text: '' }), { status: 200 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'inventado' }] } }] }), { status: 200 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = fetchOriginal;
    if (stt !== undefined) process.env.ULTRON_STT_URL = stt;
    guardarCaja('elevenlabs', '');
    guardarCaja('gemini', '');
  });

  const oido = await transcribirAudio({ audio: AUDIO, mime: 'audio/m4a', presupuesto: presupuesto(PRESUPUESTO_OIDO_MS) });
  assert.deepEqual(pedidos, ['eleven:scribe_v2']);
  assert.equal(oido.texto, '');
  assert.equal(oido.via, 'elevenlabs:scribe_v2');

  // Y si Scribe falla de verdad (cuota), entonces sí va Gemini.
  pedidos.length = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    pedidos.push(u.includes('elevenlabs') ? `eleven:${init?.body?.get?.('model_id')}` : 'gemini');
    if (u.includes('elevenlabs')) return new Response('quota_exceeded', { status: 429 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hola Aura' }] } }] }), { status: 200 });
  }) as typeof fetch;
  const otra = await transcribirAudio({ audio: AUDIO, mime: 'audio/m4a', presupuesto: presupuesto(PRESUPUESTO_OIDO_MS) });
  assert.deepEqual(pedidos, ['eleven:scribe_v2', 'gemini'], 'un 429 no es silencio; y v1 no se prueba si v2 dio 429');
  assert.equal(otra.texto, 'hola Aura');

  // Gemini con cuota agotada: es un fallo, no «no había voz».
  pedidos.length = 0;
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    pedidos.push(u.includes('elevenlabs') ? 'eleven' : 'gemini');
    return new Response('{"error":{"code":429}}', { status: 429 });
  }) as typeof fetch;
  const nada = await transcribirAudio({ audio: AUDIO, mime: 'audio/m4a', presupuesto: presupuesto(PRESUPUESTO_OIDO_MS) });
  assert.equal(nada.via, 'error');
  assert.doesNotMatch(nada.detalle, /[A-Z]{3,}_[A-Z_]+/);
});
