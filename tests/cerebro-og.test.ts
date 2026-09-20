import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hechosOG, hechoCerebroOG } from '../lib/cerebro-og';

test('la cadena 5550 trae Besu, QBFT y ORIGEN nativa', () => {
  const h = hechosOG('contame un dato que te sorprenda de la cadena 5550').join('\n');
  assert.match(h, /Besu/);
  assert.match(h, /QBFT|Chain id 5550/);
});

test('ORIGEN trae el respaldo 1/55 g de oro', () => {
  const h = hechosOG('¿qué es ORIGEN y cuánto oro respalda?').join('\n');
  assert.match(h, /1\/55 g de oro/);
});

test('Próspera trae CIADI y RFSA; un saludo no trae nada', () => {
  assert.match(hechosOG('¿qué opinás de abrir sociedad en Próspera?').join('\n'), /CIADI|RFSA|ZEDE/);
  assert.equal(hechoCerebroOG('hola, ¿cómo amaneciste?'), null);
});
