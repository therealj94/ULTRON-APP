/**
 * ¿Está listo el cerebro?, sin una inferencia por consulta (lib/nodo-listo.ts; auditoría A09).
 *
 * Antes GET /api/nodo/listo mandaba un chat al nodo en CADA consulta, sin limitador: cien consultas
 * durante un arranque lento eran cien inferencias.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { crearComprobadorListo, LISTO_TTL_MS, NO_LISTO_TTL_MS } from '../lib/nodo-listo';

test('100 consultas a la vez contra un nodo que tarda: UNA comprobación', async () => {
  let inferencias = 0;
  let soltar: (v: { listo: boolean }) => void = () => {};
  const c = crearComprobadorListo(() => {
    inferencias++;
    return new Promise((r) => (soltar = r));
  });
  const todas = Array.from({ length: 100 }, () => c.estado());
  await new Promise((r) => setTimeout(r, 5));
  soltar({ listo: false });
  const r = await Promise.all(todas);
  assert.equal(inferencias, 1);
  assert.ok(r.every((x) => x.listo === false));
});

test('el resultado se guarda: «listo» un buen rato, «no listo» poco', async () => {
  let t = 1_000_000;
  let inferencias = 0;
  let listo = false;
  const c = crearComprobadorListo(async () => (inferencias++, { listo }), { ahora: () => t });
  await c.estado();
  for (let i = 0; i < 50; i++) await c.estado();
  assert.equal(inferencias, 1, 'dentro del plazo de «no listo», nada nuevo');
  t += NO_LISTO_TTL_MS + 1;
  listo = true;
  assert.equal((await c.estado()).listo, true);
  assert.equal(inferencias, 2);
  t += LISTO_TTL_MS - 1000;
  for (let i = 0; i < 50; i++) assert.equal((await c.estado()).listo, true);
  assert.equal(inferencias, 2, 'listo se recuerda');
  t += 2000;
  await c.estado();
  assert.equal(inferencias, 3);
});

test('un fallo de la comprobación es «no listo», no una excepción', async () => {
  const c = crearComprobadorListo(async () => {
    throw new Error('ECONNREFUSED');
  });
  const e = await c.estado();
  assert.equal(e.listo, false);
  assert.match(e.motivo || '', /ECONNREFUSED/);
});
