/**
 * EL OJO DE VERDAD (6-oct, José: «la cámara toma como una foto y se traba»).
 *
 * En producción, `/api/vision/analyze` modo estructurado falló cada 20 s durante 10 minutos con la `via` del nodo
 * del ojo (ultron-manos, gemma-3-4b por Hugging Face). Lo que se encontró, probado contra el nodo con fotos
 * SINTÉTICAS (tests/fixtures/ojo/respuestas-gemma.json, sin personas reales):
 *
 *  · el nodo corta el pedido a 500 caracteres y el pedido medía ~1000: llegaba partido en `"prec`, sin la prioridad
 *    ni las reglas; gemma contestaba JSON con sangría y cajas, 8-20 s, y su tope de 400 fichas lo cortaba a medias;
 *  · cuando su modelo falla, el nodo contesta 200 con `{ok:false, texto:<error del proveedor>}`: ese error se tomaba
 *    como lo visto (prosa → «escena: You have depleted your monthly included credits…») o, si el error venía en JSON,
 *    como una vista vacía → 503;
 *  · lo que gemma hace distinto a lo pedido: todo lo leído en UNA cadena con saltos, `"lugar":"izquierda"`, comentarios
 *    y comas colgando, claves inventadas.
 *
 * Estas pruebas solo usan lo que ya existía (parsearVista, verEstructurado): fallan con el código anterior.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parsearVista, vistaVacia } from '../lib/vision-estructurada';
import { verEstructurado } from '../lib/vision';
import { guardarCaja } from '../lib/boveda';

type Caso = { nombre: string; fuente: string; modelo: string; pedido: string; ms: number; ok: boolean; texto: string };
const FIXTURE: { casos: Caso[] } = JSON.parse(readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'ojo', 'respuestas-gemma.json'), 'utf8'));
const caso = (n: string) => {
  const c = FIXTURE.casos.find((x) => x.nombre === n);
  assert.ok(c, `falta el caso ${n} en el fixture`);
  return c!;
};
const FOTO = `data:image/jpeg;base64,${Buffer.alloc(900, 7).toString('base64')}`;

/** Solo el nodo del ojo configurado (sin Gemini ni Bedrock), con su respuesta simulada. */
function soloElOjo(t: any, responder: (cuerpo: any) => Response) {
  const fetchOriginal = globalThis.fetch;
  const warnOriginal = console.warn;
  const env = { GEMINI_API_KEY: process.env.GEMINI_API_KEY, ULTRON_VISION_BEDROCK: process.env.ULTRON_VISION_BEDROCK };
  delete process.env.GEMINI_API_KEY;
  process.env.ULTRON_VISION_BEDROCK = 'no';
  guardarCaja('ojo_url', 'http://ojo.prueba:8787');
  guardarCaja('ojo_clave', 'clave-ojo');
  guardarCaja('gemini', '');
  const pedidos: any[] = [];
  const avisos: string[] = [];
  console.warn = (...a: unknown[]) => void avisos.push(a.map(String).join(' '));
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const cuerpo = JSON.parse(String(init?.body || '{}'));
    pedidos.push(cuerpo);
    return responder(cuerpo);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = fetchOriginal;
    console.warn = warnOriginal;
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    guardarCaja('ojo_url', '');
    guardarCaja('ojo_clave', '');
  });
  return { pedidos, avisos };
}

test('el nodo con los créditos agotados (200, ok:false): es un fallo, no «la cámara ve un aviso de créditos»', async (t) => {
  const c = caso('nodo-creditos-agotados');
  const { avisos } = soloElOjo(t, () => new Response(JSON.stringify({ ok: false, texto: c.texto, modelo: 'hf-vl' }), { status: 200 }));
  const r = await verEstructurado(FOTO, 'escena');
  assert.equal(r.fallo, true, `no puede salir como vista: ${JSON.stringify(r.vista)}`);
  assert.equal(r.vista, null);
  assert.ok(avisos.some((a) => /depleted/.test(a)), `el porqué queda en el registro: ${avisos.join(' | ')}`);
});

test('el pedido que recibe el nodo cabe en sus 500 caracteres y lleva la prioridad del foco', async (t) => {
  const { pedidos } = soloElOjo(t, () => new Response(JSON.stringify({ ok: true, texto: caso('corto-leer-grande').texto }), { status: 200 }));
  for (const foco of ['escena', 'leer', 'precio', 'que_es'] as const) {
    const r = await verEstructurado(FOTO, foco);
    assert.equal(r.fallo, false);
    const p = String(pedidos.at(-1)?.prompt || '');
    // ultron-manos: `String(req.body.pregunta || req.body.prompt).slice(0, 500)`; lo de después no lo lee el modelo.
    assert.ok(p.length <= 500, `${foco}: ${p.length} caracteres; el nodo lo corta en 500`);
    assert.match(p, /JSON/);
    assert.match(p, /Sin nombres de personas/);
  }
  assert.match(String(pedidos[1].prompt), /leer todo el texto/i);
  assert.match(String(pedidos[2].prompt), /precios/i);
});

test('las respuestas reales de gemma (largas, cortadas por el tope, con ``` o sin ellas) dan una vista', () => {
  for (const c of FIXTURE.casos.filter((x) => x.ok)) {
    const v = parsearVista(c.texto);
    assert.equal(vistaVacia(v), false, `${c.nombre}: vacía`);
    assert.equal(v.formato, 'json', `${c.nombre}: no leyó el JSON`);
    assert.ok(v.escena || v.textos.length, `${c.nombre}: sin escena ni texto`);
  }
});

test('todo lo leído en UNA cadena con saltos de línea: una entrada por línea', () => {
  const v = parsearVista(caso('corto-texto-con-saltos').texto);
  assert.ok(v.textos.length >= 4, `salieron ${v.textos.length}: ${JSON.stringify(v.textos)}`);
  assert.ok(v.textos.some((x) => /^Total/.test(x.texto)), JSON.stringify(v.textos));
  assert.ok(v.textos.every((x) => !/\n/.test(x.texto)));
});

test('«"lugar":"izquierda"» (el modelo confundió el campo): una posición no es un lugar; «Centro» se dice «centro»', () => {
  const v = parsearVista(caso('primer-corto-lugar-posicion').texto);
  assert.equal(v.lugar, '');
  const w = parsearVista('{"escena":"Una mesa","lugar":"Derecha","objetos":[{"nombre":"Taza","donde":"Derecha"},{"nombre":"laptop","donde":"Left"}]}');
  assert.equal(w.lugar, '');
  assert.deepEqual(
    w.objetos.map((o) => o.donde),
    ['derecha', 'izquierda']
  );
});

test('comentarios y comas colgando (lo que JSON.parse no acepta): se leen igual', () => {
  const v = parsearVista('```json\n{"escena":"Una mesa con una taza", // lo principal\n "objetos":[{"nombre":"taza","donde":"derecha"},/* fondo */ {"nombre":"laptop","donde":"izquierda"},],\n "texto":["L 45.00",],}\n```');
  assert.equal(v.escena, 'Una mesa con una taza');
  assert.deepEqual(
    v.objetos.map((o) => o.nombre),
    ['taza', 'laptop']
  );
  assert.deepEqual(
    v.textos.map((x) => x.texto),
    ['L 45.00']
  );
});

test('JSON con claves que no se pidieron pero con una descripción: se rescata como prosa en vez de «no pude ver»', () => {
  const v = parsearVista('{"descripcion_general": "Un hombre con camisa azul junto a una laptop y una taza de café en una mesa de madera."}');
  assert.equal(vistaVacia(v), false);
  assert.match(v.escena, /laptop/);
  // Un error del proveedor en JSON no es una descripción (que mire el siguiente ojo).
  assert.equal(vistaVacia(parsearVista('{"error":{"message":"Model too busy, unable to get response in less than 60 second(s)"}}')), true);
  assert.equal(vistaVacia(parsearVista('{"message":"Request timed out while waiting for the model","type":"timeout"}')), true);
  // Una lista con la vista dentro también vale.
  const w = parsearVista('[{"escena":"Una factura","texto":["Total L 425.50"]}]');
  assert.equal(w.escena, 'Una factura');
  assert.equal(w.textos[0]?.texto, 'Total L 425.50');
});
