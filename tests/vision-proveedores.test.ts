/**
 * LOS OJOS DE RESERVA (lib/vision.ts): si el nodo del ojo no ve, mira el siguiente.
 *
 * 6-oct: Render no tiene GEMINI_API_KEY (`/api/health` → geminiFallback:false), así que cuando el modelo del nodo
 * (Hugging Face) fallaba no había reserva y TODA vista de la cámara era un 503. Ahora Bedrock (el mismo AWS del cerebro
 * rápido, gemma-3-12b) mira después del nodo y de Gemini; cada ojo recibe su pedido (el nodo y Bedrock el corto que cabe
 * en 500 caracteres, Gemini el largo con cajas), y una respuesta que no es una vista pasa al siguiente.
 *
 * Bedrock va con un cliente de prueba (ponerClienteBedrockVision): nada sale a la red.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MODELO_VISION_BEDROCK, bedrockVision, ordenOjos, ponerClienteBedrockVision, verEstructurado, verImagen } from '../lib/vision';
import { TOPE_PEDIDO_OJO, pareceErrorDeServicio, promptCompacto, promptEstructurado } from '../lib/vision-estructurada';
import { guardarCaja } from '../lib/boveda';

type Caso = { nombre: string; texto: string };
const FIXTURE: { casos: Caso[] } = JSON.parse(readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'ojo', 'respuestas-gemma.json'), 'utf8'));
const caso = (n: string) => FIXTURE.casos.find((x) => x.nombre === n)!.texto;
const FOTO = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(900, 7)]).toString('base64')}`;

type Pedido = { modelId: string; prompt: string; formato: string; bytes: number; maxTokens?: number };

function preparar(t: any, o: { ojo?: (cuerpo: any) => Response; gemini?: (cuerpo: any) => Response; bedrock?: (p: Pedido) => string | Error }) {
  const fetchOriginal = globalThis.fetch;
  const warnOriginal = console.warn;
  const env = { GEMINI_API_KEY: process.env.GEMINI_API_KEY, ULTRON_VISION_BEDROCK: process.env.ULTRON_VISION_BEDROCK, ULTRON_VISION_ORDEN: process.env.ULTRON_VISION_ORDEN };
  for (const k of Object.keys(env)) delete process.env[k];
  guardarCaja('ojo_url', o.ojo ? 'http://ojo.prueba:8787' : '');
  guardarCaja('ojo_clave', o.ojo ? 'clave-ojo' : '');
  guardarCaja('gemini', o.gemini ? 'llave-de-prueba' : '');
  const orden: string[] = [];
  const alOjo: any[] = [];
  const aGemini: any[] = [];
  const aBedrock: Pedido[] = [];
  const avisos: string[] = [];
  console.warn = (...a: unknown[]) => void avisos.push(a.map(String).join(' '));
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const cuerpo = JSON.parse(String(init?.body || '{}'));
    if (String(url).includes('generativelanguage')) {
      orden.push('gemini');
      aGemini.push(cuerpo);
      return o.gemini!(cuerpo);
    }
    orden.push('ojo');
    alOjo.push(cuerpo);
    return o.ojo!(cuerpo);
  }) as typeof fetch;
  if (o.bedrock) {
    ponerClienteBedrockVision({
      send: async (cmd: any) => {
        orden.push('bedrock');
        const contenido = cmd.input.messages[0].content;
        const p: Pedido = { modelId: cmd.input.modelId, prompt: contenido[1].text, formato: contenido[0].image.format, bytes: contenido[0].image.source.bytes.length, maxTokens: cmd.input.inferenceConfig?.maxTokens };
        aBedrock.push(p);
        const r = o.bedrock!(p);
        if (r instanceof Error) throw r;
        return { output: { message: { role: 'assistant', content: [{ text: r }] } }, stopReason: 'end_turn' };
      },
    });
  } else process.env.ULTRON_VISION_BEDROCK = 'no';
  t.after(() => {
    globalThis.fetch = fetchOriginal;
    console.warn = warnOriginal;
    ponerClienteBedrockVision(null);
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    guardarCaja('ojo_url', '');
    guardarCaja('ojo_clave', '');
    guardarCaja('gemini', '');
  });
  return { orden, alOjo, aGemini, aBedrock, avisos };
}

const creditos = () => new Response(JSON.stringify({ ok: false, texto: caso('nodo-creditos-agotados'), modelo: 'hf-vl' }), { status: 200 });

test('el pedido corto cabe en los 500 caracteres del nodo para los cuatro focos; el largo (Gemini) no cabría', () => {
  for (const f of ['escena', 'leer', 'precio', 'que_es'] as const) {
    assert.ok(promptCompacto(f).length < TOPE_PEDIDO_OJO, `${f}: ${promptCompacto(f).length}`);
    assert.doesNotMatch(promptCompacto(f), /box_2d/, 'sin cajas: las de gemma no se dibujan y gastan fichas');
    assert.match(promptCompacto(f), /una línea/);
  }
  assert.ok(promptEstructurado('escena').length > TOPE_PEDIDO_OJO, 'por eso el nodo no recibe el largo');
});

test('el nodo sin créditos (ok:false) → mira Bedrock, con el pedido corto y la foto en bytes', async (t) => {
  const s = preparar(t, { ojo: creditos, bedrock: () => caso('bedrock-gemma-3-12b-it-escritorio-grande') });
  const r = await verEstructurado(FOTO, 'escena');
  assert.deepEqual(s.orden, ['ojo', 'bedrock']);
  assert.equal(r.fallo, false);
  assert.equal(r.via, `bedrock:${MODELO_VISION_BEDROCK}`);
  assert.ok(r.vista?.textos.some((x) => x.texto === 'L 45.00'), JSON.stringify(r.vista));
  assert.equal(r.vista?.cajasFiables, false, 'las cajas de Bedrock no se dibujan');
  assert.equal(s.aBedrock[0].prompt, promptCompacto('escena'));
  assert.equal(s.aBedrock[0].formato, 'jpeg');
  assert.ok(s.aBedrock[0].bytes > 800);
  assert.ok((s.aBedrock[0].maxTokens ?? 999) <= 400, 'respuesta corta');
  assert.equal(s.alOjo[0].prompt, promptCompacto('escena'), 'el nodo también recibe el corto');
  assert.ok(s.avisos.some((a) => /\[vision ojo\].*depleted/.test(a)), s.avisos.join(' | '));
});

test('una respuesta que no es vista (plantilla vacía, aviso del servicio en prosa) pasa al siguiente ojo', async (t) => {
  const vacia = '{"escena":"","lugar":"","personas":[],"principal":"","objetos":[],"texto":[],"precios":[]}';
  const s = preparar(t, { ojo: () => new Response(JSON.stringify({ ok: true, texto: vacia }), { status: 200 }), bedrock: () => caso('bedrock-gemma-3-12b-it-documento-grande') });
  const r = await verEstructurado(FOTO, 'leer');
  assert.deepEqual(s.orden, ['ojo', 'bedrock']);
  assert.equal(r.fallo, false);
  assert.ok((r.vista?.textos.length ?? 0) >= 4);
});

test('el aviso de créditos SIN ok:false (otra versión del nodo) tampoco es lo que vio; si Bedrock tampoco, fallo con el porqué', async (t) => {
  const s2 = preparar(t, { ojo: () => new Response(JSON.stringify({ texto: caso('nodo-creditos-agotados') }), { status: 200 }), bedrock: () => new Error('AccessDeniedException: no model access') });
  const r2 = await verEstructurado(FOTO, 'escena');
  assert.deepEqual(s2.orden, ['ojo', 'bedrock']);
  assert.equal(r2.fallo, true);
  assert.equal(r2.via, 'error');
  assert.ok(s2.avisos.some((a) => /bedrock falló.*AccessDenied/.test(a)), `el porqué de Bedrock queda en el registro: ${s2.avisos.join(' | ')}`);
});

test('Gemini recibe el pedido largo con cajas y va antes que Bedrock; el orden se cambia con ULTRON_VISION_ORDEN', async (t) => {
  const gem = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: caso('corto-precio') }] } }] }), { status: 200 });
  const s = preparar(t, { ojo: creditos, gemini: gem, bedrock: () => caso('bedrock-gemma-3-4b-it-escritorio-grande') });
  const r = await verEstructurado(FOTO, 'precio');
  assert.deepEqual(s.orden, ['ojo', 'gemini']);
  assert.match(r.via, /^gemini:/);
  assert.equal(s.aGemini[0].contents[0].parts[1].text, promptEstructurado('precio'));
  process.env.ULTRON_VISION_ORDEN = 'bedrock';
  const r2 = await verEstructurado(FOTO, 'escena');
  assert.equal(s.orden.at(-1), 'bedrock');
  assert.match(r2.via, /^bedrock:/);
  assert.deepEqual(ordenOjos({ ULTRON_VISION_ORDEN: 'bedrock, ojo' }), ['bedrock', 'ojo', 'gemini']);
  assert.deepEqual(ordenOjos({}), ['ojo', 'gemini', 'bedrock']);
});

test('la descripción libre (Telegram, PDFs, /vision/analyze sin modo) también cae a Bedrock si el nodo no ve', async (t) => {
  const s = preparar(t, { ojo: creditos, bedrock: (p) => `Veo: ${p.prompt.slice(0, 10)}… una roca con vetas de cuarzo.` });
  const v = await verImagen(FOTO, 'Describe la roca.');
  assert.deepEqual(s.orden, ['ojo', 'bedrock']);
  assert.match(v.texto, /vetas de cuarzo/);
  assert.equal(s.aBedrock[0].prompt, 'Describe la roca.');
});

test('Bedrock solo con credenciales de AWS; «no» lo apaga; dentro de node --test solo si se pide', () => {
  const aws = { AWS_ACCESS_KEY_ID: 'AKIA-prueba', AWS_SECRET_ACCESS_KEY: 'secreto-prueba' };
  assert.equal(bedrockVision({}), null, 'sin credenciales no hay Bedrock');
  assert.deepEqual(bedrockVision({ ...aws }), { modelo: MODELO_VISION_BEDROCK, region: 'us-west-2' });
  assert.deepEqual(bedrockVision({ ...aws, CEREBRO_VOZ_REGION: 'us-east-1', ULTRON_VISION_BEDROCK: 'amazon.nova-pro-v1:0' }), { modelo: 'amazon.nova-pro-v1:0', region: 'us-east-1' });
  assert.equal(bedrockVision({ ...aws, ULTRON_VISION_BEDROCK: 'no' }), null);
  assert.equal(bedrockVision({ ...aws, NODE_TEST_CONTEXT: 'child-v8' }), null, 'las pruebas no salen a la red');
  assert.equal(bedrockVision({ ...aws, NODE_TEST_CONTEXT: 'child-v8', ULTRON_VISION_BEDROCK: '1' })?.modelo, MODELO_VISION_BEDROCK);
});

test('qué es un aviso del servicio y qué es algo visto', () => {
  assert.equal(pareceErrorDeServicio(caso('nodo-creditos-agotados')), true);
  assert.equal(pareceErrorDeServicio('Rate limit reached for requests'), true);
  assert.equal(pareceErrorDeServicio('Una persona con camisa azul frente a una laptop; un cartel dice «CAFÉ L 45.00».'), false);
  assert.equal(pareceErrorDeServicio(''), false);
});
