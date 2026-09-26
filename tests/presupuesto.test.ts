/**
 * EL RELOJ DE UNA PETICIÓN Y LA CADENA DEL OÍDO (lib/presupuesto.ts, lib/oido.ts).
 *
 * Dos gastos que no se veían:
 *
 *  1. El oído probaba un proveedor tras otro, cada uno con su tope, cuando el teléfono corta a los
 *     16 s. Todo lo de después era pagar respuestas que nadie esperaba.
 *  2. Un audio en silencio que el primero contestaba bien («no hay voz») se le mandaba igual a
 *     Gemini: un silencio, dos facturas. Un vacío bien contestado es una respuesta, no un fallo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { presupuesto, MINIMO_UTIL_MS, PRESUPUESTO_OIDO_MS, PRESUPUESTO_VISION_MS } from '../lib/presupuesto';
import { oirEnCadena, transcribirAudio, type ProveedorOido, type Escucha } from '../lib/oido';
import { guardarCaja } from '../lib/boveda';
import { voiceboxFalso, conVoicebox, CLAVE_FALSA } from './voicebox-falso';

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
  const whisper = falso('voicebox', () => ({ texto: '', via: 'voicebox:whisper' }));
  const gemini = falso('gemini', () => ({ texto: 'no debería llegar acá', via: 'gemini' }));
  const r = await oirEnCadena([whisper.p, gemini.p], AUDIO, 'audio/m4a', 'es', presupuesto(15_000));
  assert.equal(r.motivo, 'respondio');
  assert.deepEqual(r.escucha, { texto: '', via: 'voicebox:whisper' });
  assert.equal(gemini.llamadas.length, 0, 'Gemini no se enteró del silencio');

  const oido = await transcribirAudio({ audio: AUDIO, mime: 'audio/m4a', proveedores: [whisper.p, gemini.p] });
  assert.equal(oido.texto, '');
  assert.equal(oido.via, 'voicebox:whisper');
  assert.match(oido.detalle, /no había voz/);
});

test('un fallo (null o excepción) sí pasa al siguiente', async () => {
  const nulo = falso('nulo', () => null);
  const whisper = falso('voicebox', () => {
    throw new Error('502 caído');
  });
  const gemini = falso('gemini', () => ({ texto: 'hola Aura', via: 'gemini' }));
  const r = await oirEnCadena([nulo.p, whisper.p, gemini.p], AUDIO, 'audio/m4a', 'es', presupuesto(15_000));
  assert.deepEqual(r.intentados, ['nulo', 'voicebox', 'gemini']);
  assert.equal(r.escucha?.texto, 'hola Aura');
});

test('lo que no está configurado no cuenta como intento', async () => {
  const whisper = falso('voicebox', () => ({ texto: 'x', via: 'voicebox:whisper' }), false);
  const gemini = falso('gemini', () => ({ texto: 'hola', via: 'gemini' }));
  const r = await oirEnCadena([whisper.p, gemini.p], AUDIO, 'audio/m4a', 'es', presupuesto(15_000));
  assert.deepEqual(r.intentados, ['gemini']);
  assert.equal(whisper.llamadas.length, 0);
});

test('cuando se acaba el tiempo del cliente, no se llama a nadie más', async () => {
  let t = 0;
  const reloj = presupuesto(15_000, () => t);
  // El primero se cuelga hasta su tope de 12 s; el segundo llega con 3 s.
  const lento = falso('lento', () => {
    t += 12_000;
    return null;
  });
  const whisper = falso('voicebox', () => {
    t += 3_000;
    return null;
  });
  const gemini = falso('gemini', () => ({ texto: 'tarde', via: 'gemini' }));
  const r = await oirEnCadena([lento.p, whisper.p, gemini.p], AUDIO, 'audio/m4a', 'es', reloj);
  assert.equal(r.motivo, 'tiempo');
  assert.deepEqual(r.intentados, ['lento', 'voicebox']);
  assert.equal(gemini.llamadas.length, 0, 'Gemini no se llama pasado el corte del teléfono');
  assert.equal(whisper.llamadas[0], 3_000, 'el segundo recibió solo lo que quedaba');

  t = 0;
  const oido = await transcribirAudio({
    audio: AUDIO,
    mime: 'audio/m4a',
    presupuesto: presupuesto(15_000, () => t),
    proveedores: [falso('lento', () => ((t += 14_000), null)).p, gemini.p],
  });
  assert.equal(oido.via, 'tiempo');
  assert.equal(oido.texto, '');
});

test('sin ningún proveedor lo dice sin nombres de variables', async () => {
  const oido = await transcribirAudio({ audio: AUDIO, mime: 'audio/m4a', proveedores: [falso('x', () => null, false).p] });
  assert.equal(oido.via, 'ninguno');
  assert.doesNotMatch(oido.detalle, /[A-Z]{3,}_[A-Z_]+/, 'nada de VOICEBOX_CLAVE ni GEMINI_API_KEY para quien habla');
});

/* ------------------------------------------------------------------ con los proveedores de verdad */

/**
 * La cadena real (Whisper de Voicebox y Gemini). Voicebox es un servidor HTTP local con la forma
 * del de verdad; Gemini, un `fetch` de mentira. Es la prueba que importa: que el vacío de Whisper no
 * llegue a Gemini no depende de la cadena abstracta sino de cómo el proveedor de Voicebox distingue
 * «contestó sin voz» de «falló».
 */
test('Whisper contesta sin voz: Gemini no recibe el audio', async (t) => {
  let respuesta: (crudo: string) => { status?: number; json?: any; texto?: string } = () => ({ texto: '' });
  const vb = await voiceboxFalso({ transcripcion: (crudo) => respuesta(crudo) });
  const fetchOriginal = globalThis.fetch;
  let gemini: { status: number; cuerpo: string } = { status: 200, cuerpo: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'inventado' }] } }] }) };
  const aGemini: string[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url).includes('generativelanguage')) {
      aGemini.push('gemini');
      return new Response(gemini.cuerpo, { status: gemini.status });
    }
    return fetchOriginal(url, init);
  }) as typeof fetch;
  guardarCaja('gemini', 'llave-de-prueba');
  t.after(async () => {
    globalThis.fetch = fetchOriginal;
    guardarCaja('gemini', '');
    await vb.cerrar();
  });

  await conVoicebox(vb.url, CLAVE_FALSA, async () => {
    const oido = await transcribirAudio({ audio: AUDIO, mime: 'audio/m4a', presupuesto: presupuesto(PRESUPUESTO_OIDO_MS) });
    assert.deepEqual(vb.pedidos.map((p) => p.ruta), ['POST /transcribe']);
    assert.equal(vb.pedidos[0].clave, CLAVE_FALSA, 'la llave va en X-Voz-Clave');
    assert.match(vb.pedidos[0].crudo, /name="model"\r\n\r\nturbo/, 'modelo turbo');
    assert.match(vb.pedidos[0].crudo, /name="language"\r\n\r\nes/, 'en español');
    assert.match(vb.pedidos[0].crudo, /name="file"; filename="voz\.m4a"/, 'el archivo con su extensión');
    assert.deepEqual(aGemini, []);
    assert.equal(oido.texto, '');
    assert.equal(oido.via, 'voicebox:whisper');

    // Lo que Whisper «oye» en el silencio (créditos de subtítulos) tampoco es voz.
    respuesta = () => ({ texto: 'Subtítulos realizados por la comunidad de Amara.org' });
    const alucinado = await transcribirAudio({ audio: AUDIO, mime: 'audio/m4a' });
    assert.equal(alucinado.texto, '');
    assert.deepEqual(aGemini, []);

    // Con voz, el texto tal cual.
    respuesta = () => ({ texto: ' hola Aura, ¿cómo está el oro? ' });
    const bien = await transcribirAudio({ audio: AUDIO, mime: 'audio/m4a' });
    assert.equal(bien.texto, 'hola Aura, ¿cómo está el oro?');
    assert.equal(bien.via, 'voicebox:whisper');

    // Y si Voicebox falla de verdad (502), entonces sí va Gemini.
    respuesta = () => ({ status: 502, json: { detail: 'caído' } });
    gemini = { status: 200, cuerpo: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hola Aura' }] } }] }) };
    const otra = await transcribirAudio({ audio: AUDIO, mime: 'audio/m4a', presupuesto: presupuesto(PRESUPUESTO_OIDO_MS) });
    assert.deepEqual(aGemini, ['gemini'], 'un 502 no es silencio');
    assert.equal(otra.texto, 'hola Aura');

    // Un 200 sin `text` es una respuesta rota, no silencio: también pasa a Gemini.
    aGemini.length = 0;
    respuesta = () => ({ json: { error: 'modelo sin cargar' } });
    const rota = await transcribirAudio({ audio: AUDIO, mime: 'audio/m4a' });
    assert.deepEqual(aGemini, ['gemini']);
    assert.equal(rota.texto, 'hola Aura');

    // Gemini con cuota agotada: es un fallo, no «no había voz».
    aGemini.length = 0;
    respuesta = () => ({ status: 502, json: { detail: 'caído' } });
    gemini = { status: 429, cuerpo: '{"error":{"code":429}}' };
    const nada = await transcribirAudio({ audio: AUDIO, mime: 'audio/m4a', presupuesto: presupuesto(PRESUPUESTO_OIDO_MS) });
    assert.equal(nada.via, 'error');
    assert.doesNotMatch(nada.detalle, /[A-Z]{3,}_[A-Z_]+/);
  });

  // Con la llave equivocada, Voicebox contesta 403 y cuenta como fallo.
  aGemini.length = 0;
  gemini = { status: 200, cuerpo: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'de reserva' }] } }] }) };
  await conVoicebox(vb.url, 'otra-llave', async () => {
    const r = await transcribirAudio({ audio: AUDIO, mime: 'audio/m4a' });
    assert.equal(r.texto, 'de reserva');
    assert.deepEqual(aGemini, ['gemini']);
  });
});

test('sin VOICEBOX_URL el Whisper propio no cuenta como intento', async (t) => {
  const gemini = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  t.after(() => {
    if (gemini !== undefined) process.env.GEMINI_API_KEY = gemini;
  });
  await conVoicebox(undefined, CLAVE_FALSA, async () => {
    const oido = await transcribirAudio({ audio: AUDIO, mime: 'audio/m4a' });
    assert.equal(oido.via, 'ninguno');
  });
});
