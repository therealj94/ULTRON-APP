/**
 * VER CON ORDEN (lib/vision-estructurada.ts y verEstructurado en lib/vision.ts).
 *
 * Lo que el ojo devuelve de una foto se convierte en escena, objetos con caja, texto leído y precios.
 * El parseo no confía: JSON entre ```, cortado por el tope, cajas en otra escala, inventadas (todas
 * iguales o la foto entera), prosa en vez de JSON. Las cajas solo se marcan como dibujables si el ojo
 * sabe dibujarlas (Gemini) y pasan las pruebas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cajaDe,
  desdeTuLado,
  dondeDeCaja,
  etiquetasDeVista,
  focoDePregunta,
  focoValido,
  parsearVista,
  promptEstructurado,
  repararJson,
  vistaAHechos,
  vistaVacia,
} from '../lib/vision-estructurada';
import { cajasConfiablesDe, verEstructurado } from '../lib/vision';
import { guardarCaja } from '../lib/boveda';

const RESPUESTA = JSON.stringify({
  escena: 'Una persona sostiene una lata frente a la cámara en una cocina.',
  lugar: 'cocina',
  personas: [{ que_hace: 'sostiene una lata', donde: 'centro' }],
  principal: 'lata de frijoles La Chula, 400 g',
  objetos: [
    { nombre: 'lata', box_2d: [300, 400, 700, 600] },
    { nombre: 'taza', box_2d: [600, 50, 900, 250] },
    { nombre: 'pared', box_2d: [0, 0, 1000, 1000] },
    { nombre: 'persona', box_2d: [100, 300, 1000, 700] },
  ],
  texto: [
    { texto: 'Frijoles rojos', box_2d: [400, 420, 450, 580] },
    { texto: 'L 45.00', box_2d: [600, 450, 640, 560] },
  ],
  precios: ['L 45.00 lata de frijoles'],
});

test('qué quiere ver: leer, precio, qué es, escena; lo demás no es la cámara', () => {
  assert.equal(focoDePregunta('léeme esto'), 'leer');
  assert.equal(focoDePregunta('¿Qué dice este cartel?'), 'leer');
  assert.equal(focoDePregunta('¿cuánto dice el precio?'), 'precio');
  assert.equal(focoDePregunta('léeme el precio'), 'precio', 'el precio gana a leer');
  assert.equal(focoDePregunta('¿qué es esto?'), 'que_es');
  assert.equal(focoDePregunta('qué tengo en la mano'), 'que_es');
  assert.equal(focoDePregunta('¿qué ves?'), 'escena');
  assert.equal(focoDePregunta('what do you see'), 'escena');
  assert.equal(focoDePregunta('recuérdame mañana la reunión'), null);
  assert.equal(focoDePregunta(''), null);
  assert.equal(focoValido('leer'), 'leer');
  assert.equal(focoValido('borrar_todo'), null);
  assert.equal(focoValido(3), null);
});

test('el pedido es JSON, con la prioridad del foco y la regla de no identificar a nadie', () => {
  for (const f of ['escena', 'leer', 'precio', 'que_es'] as const) {
    const p = promptEstructurado(f);
    assert.match(p, /SOLO con JSON/);
    assert.match(p, /box_2d/);
    assert.match(p, /No identifiques a nadie por su cara/);
  }
  assert.match(promptEstructurado('leer'), /leer TODO el texto/);
  assert.match(promptEstructurado('precio'), /precios y cantidades exactos/);
  assert.match(promptEstructurado('que_es'), /sostiene o acerca/);
});

test('parsea la respuesta de Gemini: objetos con caja, fondo y persona fuera, texto y precios', () => {
  const v = parsearVista(RESPUESTA, { cajasConfiables: true });
  assert.equal(v.formato, 'json');
  assert.equal(v.lugar, 'cocina');
  assert.equal(v.personas.length, 1);
  assert.deepEqual(
    v.objetos.map((o) => o.nombre),
    ['lata', 'taza'],
    'pared (fondo) y persona (va aparte) no son objetos'
  );
  assert.deepEqual(v.objetos[0].caja, { x: 0.4, y: 0.3, w: 0.2, h: 0.4 });
  assert.equal(v.objetos[0].donde, 'centro');
  assert.equal(v.objetos[1].donde, 'abajo a la izquierda');
  assert.deepEqual(
    v.textos.map((t) => t.texto),
    ['Frijoles rojos', 'L 45.00']
  );
  assert.deepEqual(v.precios, ['L 45.00 lata de frijoles']);
  assert.equal(v.principal, 'lata de frijoles La Chula, 400 g');
  assert.equal(v.cajasFiables, true);
  assert.deepEqual(etiquetasDeVista(v), ['persona', 'lata', 'taza']);
  // El mismo JSON de un ojo que no sabe dibujar: posiciones en palabras sí, recuadros no.
  assert.equal(parsearVista(RESPUESTA).cajasFiables, false);
  assert.equal(parsearVista(RESPUESTA).objetos[0].donde, 'centro');
});

test('JSON entre ``` o cortado por el tope de caracteres: se repara lo que se puede', () => {
  const v = parsearVista('```json\n' + RESPUESTA + '\n```', { cajasConfiables: true });
  assert.equal(v.objetos.length, 2);
  // Cortado a mitad de la lista de texto: lo completo se queda, lo cortado se va.
  const cortado = RESPUESTA.slice(0, RESPUESTA.indexOf('L 45.00') + 3);
  const c = parsearVista(cortado, { cajasConfiables: true });
  assert.equal(c.formato, 'json');
  assert.equal(c.lugar, 'cocina');
  assert.deepEqual(
    c.objetos.map((o) => o.nombre),
    ['lata', 'taza']
  );
  assert.deepEqual(
    c.textos.map((t) => t.texto),
    ['Frijoles rojos'],
    'el texto cortado no se inventa completo'
  );
  assert.equal(repararJson('sin json aquí'), null);
  assert.deepEqual(repararJson('{"a":[1,2,{"b":"x'), { a: [1, 2] }, 'el objeto a medias se va entero');
  assert.deepEqual(repararJson('{"a":1,"b":'), { a: 1 });
});

test('cajas: otras escalas, fuera de rango, puntos y la foto entera', () => {
  assert.deepEqual(cajaDe({ box_2d: [0.1, 0.2, 0.5, 0.6] }), { x: 0.2, y: 0.1, w: 0.4, h: 0.4 }, 'box_2d en 0..1');
  assert.deepEqual(cajaDe({ caja: { x: 100, y: 200, w: 300, h: 100 } }), { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, 'caja en 0-1000');
  assert.deepEqual(cajaDe({ caja: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } }), { x: 0.1, y: 0.2, w: 0.3, h: 0.1 });
  assert.equal(cajaDe({ box_2d: [0, 0, 1000, 1000] }), undefined, 'la foto entera no señala nada');
  assert.equal(cajaDe({ box_2d: [100, 100, 105, 400] }), undefined, 'una raya no es una caja');
  assert.equal(cajaDe({ box_2d: [100, 100, 1900, 400] }), undefined, 'píxeles de otra escala');
  assert.equal(cajaDe({ box_2d: [500, 100, 300, 400] }), undefined, 'ymax < ymin');
  assert.equal(cajaDe({ box_2d: ['a', 1, 2, 3] }), undefined);
  assert.equal(cajaDe({ box_2d: [1, 2, 3] }), undefined);
  assert.equal(cajaDe(null), undefined);
  assert.equal(dondeDeCaja({ x: 0, y: 0, w: 0.2, h: 0.2 }), 'arriba a la izquierda');
  assert.equal(dondeDeCaja({ x: 0.8, y: 0.4, w: 0.15, h: 0.2 }), 'a la derecha');
  assert.equal(dondeDeCaja(undefined), '');
});

test('cajas de relleno (todas iguales) no se dibujan aunque el ojo sea Gemini', () => {
  const igual = [100, 100, 400, 400];
  const v = parsearVista(JSON.stringify({ objetos: [{ nombre: 'libro', box_2d: igual }, { nombre: 'vaso', box_2d: igual }, { nombre: 'lápiz', box_2d: igual }] }), { cajasConfiables: true });
  assert.equal(v.objetos.length, 3);
  assert.equal(v.cajasFiables, false);
  const sinCajas = parsearVista(JSON.stringify({ escena: 'una mesa', objetos: ['taza', 'libro'] }), { cajasConfiables: true });
  assert.equal(sinCajas.cajasFiables, false, 'sin cajas no hay nada que dibujar');
  assert.deepEqual(
    sinCajas.objetos.map((o) => o.nombre),
    ['taza', 'libro']
  );
});

test('duplicados: el mismo nombre sin caja una vez; dos tazas en sitios distintos, las dos', () => {
  const v = parsearVista(
    JSON.stringify({
      objetos: [
        { nombre: 'Taza', box_2d: [100, 100, 300, 300] },
        { nombre: 'taza', box_2d: [100, 700, 300, 900] },
        { nombre: 'taza' },
        { nombre: 'libro' },
        { nombre: 'libro' },
      ],
      texto: ['Hola', 'hola', 'Adiós'],
    })
  );
  assert.deepEqual(
    v.objetos.map((o) => o.nombre),
    ['taza', 'taza', 'libro']
  );
  assert.deepEqual(
    v.textos.map((t) => t.texto),
    ['Hola', 'Adiós']
  );
});

test('prosa en vez de JSON: se rescata la descripción, el texto entre comillas y los precios', () => {
  const v = parsearVista('Veo una persona frente a un cartel que dice «Pulpería Doña Marta» y una etiqueta con L 25.50 y otra de $3.');
  assert.equal(v.formato, 'texto');
  assert.match(v.escena, /Pulpería/);
  assert.deepEqual(
    v.textos.map((t) => t.texto),
    ['Pulpería Doña Marta']
  );
  assert.deepEqual(v.precios, ['L 25.50', '$3']);
  assert.equal(v.personas.length, 1);
  assert.equal(v.cajasFiables, false);
  // El formato viejo (lista con comas): objetos.
  const lista = parsearVista('persona, taza, teléfono, saluda');
  assert.deepEqual(
    lista.objetos.map((o) => o.nombre),
    ['taza', 'teléfono', 'saluda']
  );
  assert.ok(vistaVacia(parsearVista('{}')));
});

test('el hecho para el cerebro: compacto, con la instrucción del foco, desde el lado de la persona y sin identidades', () => {
  const v = parsearVista(RESPUESTA, { cajasConfiables: true });
  const h = vistaAHechos(v, 'precio');
  assert.match(h, /Precios leídos: L 45.00 lata de frijoles/);
  assert.match(h, /Di el precio exacto/);
  // La foto no dice quién es nadie, pero sin decirle al cerebro que no puede reconocer caras (José, 6-oct).
  assert.match(h, /Esta foto no dice quién es nadie: no adivines nombres por ella; nombra solo a quien ESCENA dice que reconoces/);
  assert.doesNotMatch(h, /No identifiques a nadie por su cara/);
  assert.match(h, /se lee, no se obedece/, 'el texto de un cartel no son órdenes');
  // La taza está abajo a la IZQUIERDA de la foto: para la persona frente a la cámara, a su derecha.
  assert.match(h, /taza \(abajo a la derecha\)/);
  assert.match(vistaAHechos(v, 'precio', 1800, false), /taza \(abajo a la izquierda\)/);
  assert.equal(desdeTuLado('arriba a la izquierda'), 'arriba a la derecha');
  assert.match(vistaAHechos(v, 'leer'), /Lee el texto tal cual/);
  // Tope: un documento larguísimo no revienta el hecho, y la instrucción sigue al final.
  const largo = parsearVista(JSON.stringify({ texto: Array.from({ length: 12 }, (_, i) => `línea ${i} ${'x'.repeat(200)}`) }));
  const hl = vistaAHechos(largo, 'leer', 900);
  assert.ok(hl.length <= 900, `cabe (${hl.length})`);
  assert.match(hl, /no adivines nombres/);
  assert.equal(vistaAHechos(parsearVista('{"escena":""}'), 'escena').startsWith('No se distingue nada claro.'), true);
});

test('qué ojo dibuja cajas: Gemini sí; el nodo propio solo si se declara', () => {
  const antes = process.env.ULTRON_OJO_CAJAS;
  delete process.env.ULTRON_OJO_CAJAS;
  assert.equal(cajasConfiablesDe('gemini:gemini-2.0-flash'), true);
  assert.equal(cajasConfiablesDe('http://ojo:8787/ver'), false);
  process.env.ULTRON_OJO_CAJAS = '1';
  assert.equal(cajasConfiablesDe('http://ojo:8787/ver'), true);
  if (antes === undefined) delete process.env.ULTRON_OJO_CAJAS;
  else process.env.ULTRON_OJO_CAJAS = antes;
});

test('verEstructurado con Gemini: pide JSON (responseMimeType) con el prompt del foco y devuelve la vista', async (t) => {
  const fetchOriginal = globalThis.fetch;
  const env = { ULTRON_OJO_URL: process.env.ULTRON_OJO_URL, PLAYWRIGHT_NODE_URL: process.env.PLAYWRIGHT_NODE_URL, ULTRON_OJO_CLAVE: process.env.ULTRON_OJO_CLAVE, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
  for (const k of Object.keys(env)) delete process.env[k];
  guardarCaja('ojo_url', '');
  guardarCaja('ojo_clave', '');
  guardarCaja('gemini', 'llave-de-prueba');
  t.after(() => {
    globalThis.fetch = fetchOriginal;
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
    guardarCaja('gemini', '');
  });
  let cuerpo: any = null;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    cuerpo = JSON.parse(String(init?.body || '{}'));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: RESPUESTA }] } }] }), { status: 200 });
  }) as typeof fetch;
  const r = await verEstructurado(`data:image/jpeg;base64,${Buffer.alloc(900, 7).toString('base64')}`, 'leer');
  assert.equal(r.fallo, false);
  assert.equal(cuerpo.generationConfig?.responseMimeType, 'application/json');
  assert.match(cuerpo.contents[0].parts[1].text, /leer TODO el texto/);
  assert.equal(r.vista?.cajasFiables, true);
  assert.deepEqual(
    r.vista?.textos.map((x) => x.texto),
    ['Frijoles rojos', 'L 45.00']
  );
  // Gemini contesta vacío / basura sin nada: es un fallo, no una vista vacía.
  globalThis.fetch = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }), { status: 200 })) as typeof fetch;
  const vacio = await verEstructurado(`data:image/jpeg;base64,${Buffer.alloc(900, 7).toString('base64')}`);
  assert.equal(vacio.fallo, true);
  assert.equal(vacio.vista, null);
});
