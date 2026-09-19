import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cajas, clave, fotoBoveda, guardarCaja } from '../lib/boveda';
import { parsePedido } from '../lib/taller';

describe('Bóveda honesta', () => {
  it('no marca Gemini listo sin clave y no dumpa secretos', () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const g = cajas().find((c) => c.id === 'gemini');
    assert.equal(g?.listo, false);
    const f = fotoBoveda();
    assert.equal(f.honesto, true);
    assert.ok(!JSON.stringify(f).includes('AIza'));
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
  });

  it('el overlay gana sin persistir en logs', () => {
    const prev = clave('elevenlabs');
    guardarCaja('elevenlabs', 'sk_test_overlay_no_se_imprime');
    assert.equal(clave('elevenlabs'), 'sk_test_overlay_no_se_imprime');
    const f = fotoBoveda();
    assert.ok(f.cajas.find((c) => c.id === 'elevenlabs')?.listo);
    assert.ok(!JSON.stringify(f).includes('sk_test_overlay'));
    guardarCaja('elevenlabs', prev);
  });

  it('parsea bóveda y urgente por Telegram', () => {
    assert.equal(parsePedido('abre la bóveda').accion, 'boveda');
    assert.equal(parsePedido('avísame urgente que cayó el nodo').accion, 'urgente');
    const u = parsePedido('llámanos por telegram: junta ahora');
    assert.equal(u.accion, 'urgente');
    assert.equal(u.canal, 'telegram');
  });
});
