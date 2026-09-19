import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appendAprendido, bloqueLargoPlazo, leerAprendido } from '../lib/aprendido';
import { topeTokens } from '../lib/harness';

describe('LARGO PLAZO / cerebro-aprendido', () => {
  it('no guarda secretos', () => {
    const before = leerAprendido();
    const after = appendAprendido('api_key AKIA1234567890SECRET');
    assert.deepEqual(after, before);
  });

  it('mezcla extra sin duplicar', () => {
    const t = bloqueLargoPlazo(['villa de Roatán es garantía al 70%', 'villa de Roatán es garantía al 70%']);
    assert.match(t, /Roatán|Roatan/i);
    assert.equal(t.split('\n').filter((l) => /70%/.test(l)).length, 1);
  });

  it('tope 4k tokens recorta', () => {
    const s = 'x'.repeat(20_000);
    assert.equal(topeTokens(s, 4000).length, 16_000);
    assert.equal(topeTokens('hola', 4000), 'hola');
  });
});
