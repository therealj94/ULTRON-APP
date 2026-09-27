/**
 * El guardián que rechaza texto ilegible no puede rechazar un informe por estar en inglés.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pareceProsa } from '../server/electrum/aprender';

const repetir = (t: string, n: number) => Array.from({ length: n }, () => t).join(' ');

test('prosa en español: pasa', () => {
  assert.equal(pareceProsa(repetir('La concesión de explotación se otorga por un plazo que fija la ley y el titular debe cumplir con el canon.', 12)), true);
});

test('prosa en inglés: pasa', () => {
  assert.equal(pareceProsa(repetir('The Vueltas del Rio area is underlain by metamorphosed tuff and andesite, which comprise a synclinorium with the axis to the east.', 12)), true);
});

test('codificación propia: no pasa', () => {
  assert.equal(pareceProsa(repetir('IUDJPHQWDGRV FRQFHVLRQ PLQHUD HALWDFLRQ GHUHFKR WLWXODU', 40)), false);
});
