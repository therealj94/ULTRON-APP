/**
 * Las órdenes de voz que decide Laya («comando»): se actúa solo cuando la orden gana claro y
 * «ninguna» no le discute; en la duda, la frase va al cerebro como pregunta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decidirComando, interpretarComando, PALABRAS_MAX } from '../server/electrum/comando-voz';

const r = (grupo: string, p: Record<string, number>) => ({ p, etiquetas: [], grupos: { accion: grupo } });

test('comando-laya: una orden clara se ejecuta', () => {
  assert.deepEqual(decidirComando(r('rotar_derecha', { rotar_derecha: 0.91, ninguna: 0.05 })), { id: 'rotar_derecha', p: 0.91 });
});

test('comando-laya: en la duda, pregunta para el cerebro', () => {
  assert.equal(decidirComando(r('mover_arriba', { mover_arriba: 0.52, ninguna: 0.2 })).id, 'ninguna');
  assert.equal(decidirComando(r('mover_arriba', { mover_arriba: 0.8, ninguna: 0.6 })).id, 'ninguna');
  assert.equal(decidirComando(r('ninguna', { ninguna: 0.9 })).id, 'ninguna');
  assert.deepEqual(decidirComando(null), { id: null, p: 0 });
});

test('comando-laya: sin Laya configurado, null; una frase larga ni se consulta', async () => {
  const antes = process.env.ULTRON_LAYA_URL;
  delete process.env.ULTRON_LAYA_URL;
  try {
    assert.equal((await interpretarComando('súbeme un poquito el mapa')).id, null);
    const largo = Array.from({ length: PALABRAS_MAX + 3 }, () => 'palabra').join(' ');
    assert.equal((await interpretarComando(largo)).id, 'ninguna');
  } finally {
    if (antes !== undefined) process.env.ULTRON_LAYA_URL = antes;
  }
});
