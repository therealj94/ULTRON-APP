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
    const prevUrl = clave('voicebox_url');
    const prev = clave('voicebox_clave');
    guardarCaja('voicebox_url', 'https://voz.prueba');
    guardarCaja('voicebox_clave', 'clave_test_overlay_no_se_imprime');
    assert.equal(clave('voicebox_clave'), 'clave_test_overlay_no_se_imprime');
    const f = fotoBoveda();
    assert.ok(f.cajas.find((c) => c.id === 'voz')?.listo);
    assert.ok(!JSON.stringify(f).includes('clave_test_overlay'));
    guardarCaja('voicebox_url', prevUrl);
    guardarCaja('voicebox_clave', prev);
  });

  it('sin la llave de Voicebox la voz no se marca lista', () => {
    const prevUrl = clave('voicebox_url');
    const prev = clave('voicebox_clave');
    const envUrl = process.env.VOICEBOX_URL;
    const envClave = process.env.VOICEBOX_CLAVE;
    guardarCaja('voicebox_url', 'https://voz.prueba');
    guardarCaja('voicebox_clave', '');
    delete process.env.VOICEBOX_CLAVE;
    try {
      assert.equal(cajas().find((c) => c.id === 'voz')?.listo, false);
      assert.ok(!cajas().some((c) => /eleven|chatterbox/i.test(`${c.id} ${c.nombre}`)), 'no queda rastro de las voces viejas');
    } finally {
      guardarCaja('voicebox_url', prevUrl);
      guardarCaja('voicebox_clave', prev);
      if (envUrl !== undefined) process.env.VOICEBOX_URL = envUrl;
      if (envClave !== undefined) process.env.VOICEBOX_CLAVE = envClave;
    }
  });

  it('parsea bóveda y urgente por Telegram', () => {
    assert.equal(parsePedido('abre la bóveda').accion, 'boveda');
    assert.equal(parsePedido('avísame urgente que cayó el nodo').accion, 'urgente');
    const u = parsePedido('llámanos por telegram: junta ahora');
    assert.equal(u.accion, 'urgente');
    assert.equal(u.canal, 'telegram');
  });
});
