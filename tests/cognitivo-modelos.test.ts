/**
 * El modelo chico contesta solo lo trivial y seguro; si falla, no contesta (y lo hace Qwen).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { preguntarModeloChico, usarModeloChico, modeloChicoConfigurado } from '../lib/cognitivo/modelos';
import type { Clasificacion } from '../lib/cognitivo/traza';
import { disponible, resetInterruptoresTest } from '../lib/cognitivo/interruptor';

test.beforeEach(() => resetInterruptoresTest());

async function conEntorno<T>(vars: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const antes: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    antes[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const saludo = { tarea: 'conversacion', riesgo: 10, nivelRiesgo: 'bajo', requiereQwen: false, agente: 'general', revisionHumana: false, confianza: 0.9, fuente: 'reglas' } as unknown as Clasificacion;

test('solo lo trivial y seguro, y solo si está activo', () =>
  conEntorno({ MODELO_CHICO_URL: 'http://127.0.0.1:9', MODELO_CHICO_MODO: 'activo' }, async () => {
    assert.equal(usarModeloChico(saludo), true);
    assert.equal(usarModeloChico({ ...saludo, requiereQwen: true }), false);
    assert.equal(usarModeloChico({ ...saludo, tarea: 'analisis_documento' }), false);
    assert.equal(usarModeloChico({ ...saludo, riesgo: 40 }), false);
    assert.equal(usarModeloChico({ ...saludo, inyeccion: true } as Clasificacion), false);
    assert.equal(usarModeloChico(null), false);
    await conEntorno({ MODELO_CHICO_MODO: undefined }, () => {
      assert.equal(modeloChicoConfigurado(), false, 'apagado por omisión');
      assert.equal(usarModeloChico(saludo), false);
    });
  }));

test('pide sin pensamiento, limpia el que venga, y devuelve null si falla', async () => {
  const pedidos: any[] = [];
  let modo: 'bien' | 'piensa' | 'mal' | 'vacio' = 'bien';
  const s = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      pedidos.push({ url: req.url, auth: req.headers.authorization, cuerpo: JSON.parse(b) });
      if (modo === 'mal') return res.writeHead(500).end('{}');
      const content = modo === 'vacio' ? '' : modo === 'piensa' ? '<think>el usuario saluda…</think>\n¡Hola, José!' : '¡Hola! ¿En qué te ayudo?';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 20, completion_tokens: 8 } }));
    });
  });
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', () => ok()));
  const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  try {
    await conEntorno({ MODELO_CHICO_URL: url, MODELO_CHICO_API_KEY: 'k-prueba', MODELO_CHICO_NOMBRE: 'chico' }, async () => {
      const r = await preguntarModeloChico([{ role: 'user', content: 'hola' }]);
      assert.equal(r?.texto, '¡Hola! ¿En qué te ayudo?');
      assert.equal(pedidos[0].url, '/v1/chat/completions');
      assert.equal(pedidos[0].auth, 'Bearer k-prueba');
      assert.equal(pedidos[0].cuerpo.model, 'chico');
      assert.deepEqual(pedidos[0].cuerpo.chat_template_kwargs, { enable_thinking: false });
      modo = 'piensa';
      assert.equal((await preguntarModeloChico([{ role: 'user', content: 'hola' }]))?.texto, '¡Hola, José!');
      modo = 'mal';
      assert.equal(await preguntarModeloChico([{ role: 'user', content: 'hola' }]), null);
      assert.equal(disponible('modelo_chico'), false, 'un 500 abre el circuito');
      const antes = pedidos.length;
      assert.equal(await preguntarModeloChico([{ role: 'user', content: 'hola' }]), null);
      assert.equal(pedidos.length, antes, 'con el circuito abierto no se le pide');
      resetInterruptoresTest();
      modo = 'vacio';
      assert.equal(await preguntarModeloChico([{ role: 'user', content: 'hola' }]), null);
    });
    resetInterruptoresTest();
    await conEntorno({ MODELO_CHICO_URL: 'http://127.0.0.1:9' }, async () => {
      assert.equal(await preguntarModeloChico([{ role: 'user', content: 'hola' }]), null, 'caído');
    });
  } finally {
    s.close();
  }
});
