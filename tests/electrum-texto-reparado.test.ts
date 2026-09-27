/**
 * Los acentos rotos de las capas («MontaÃ±a Verde», «Santa BÃ¡rbara»), tal como salieron en la ficha
 * de El Mochito en producción, se reparan; un texto sano no se toca.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { repararTexto } from '../server/electrum/gis';
import { conTextoReparado } from '../server/electrum/db';

test('repararTexto: UTF-8 leído como latin1 vuelve a su forma', () => {
  assert.equal(repararTexto('MontaÃ±a Verde'), 'Montaña Verde');
  assert.equal(repararTexto('Santa BÃ¡rbara'), 'Santa Bárbara');
  assert.equal(repararTexto('RÃ­o Ulua, CopÃ¡n'), 'Río Ulua, Copán');
});

test('repararTexto: lo sano queda igual, aunque tenga acentos, eñes o signos', () => {
  for (const s of ['Montaña Verde', 'Santa Bárbara', '¿Qué?', 'Ñ', 'São Paulo', 'Â', 'Ã', 'plain', '', 'Canal 5 · Río', 'MontaÃ±a y también ñ']) {
    assert.equal(repararTexto(s), s, s);
  }
  // Con la huella pero que no es UTF-8 válido al releer: no se inventa nada.
  assert.equal(repararTexto('Ã©ÿ'), 'Ã©ÿ');
});

test('conTextoReparado: solo las columnas de texto de cada fila', () => {
  const filas = conTextoReparado([{ nombre: 'MontaÃ±a Verde', km: 3.7, dentro: false, detalle: null }]);
  assert.deepEqual(filas, [{ nombre: 'Montaña Verde', km: 3.7, dentro: false, detalle: null }]);
});
