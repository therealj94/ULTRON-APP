import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extraerJsonTool, esSoloJsonTool, quitarJsonTool, topeTokens } from '../lib/harness';

describe('Function call JSON', () => {
  it('parsea tool web/pagina/spot', () => {
    const w = extraerJsonTool('{"tool":"web","q":"tipo de cambio BCH"}');
    assert.equal(w?.tool, 'web');
    assert.equal(w?.q, 'tipo de cambio BCH');
    assert.equal(extraerJsonTool('{"tool":"spot_oro"}')?.tool, 'spot_oro');
    assert.equal(esSoloJsonTool('{"tool":"pagina","url":"https://bch.hn"}'), true);
    assert.equal(esSoloJsonTool('El oro está en 2400.\n{"tool":"web","q":"x"}'), false);
    assert.equal(quitarJsonTool('mira\n{"tool":"web","q":"x"}').includes('tool'), false);
    assert.equal(topeTokens('hola', 4000), 'hola');
    assert.equal(topeTokens('x'.repeat(20), 1).length, 4);
  });
});
