import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { enrutar } from '../lib/skills';

describe('Router de skills', () => {
  it('spot oro / plata / hnl', () => {
    assert.equal(enrutar('precio del oro').skill, 'spot_oro');
    assert.equal(enrutar('cuánto está el gold').skill, 'spot_oro');
    assert.equal(enrutar('spot xag').skill, 'spot_plata');
    assert.equal(enrutar('usd a hnl').skill, 'fx_hnl');
  });

  it('busca gana a tipo de cambio (BCH)', () => {
    assert.equal(enrutar('busca tipo de cambio BCH').skill, 'web');
  });

  it('canto 1–5 y nombres', () => {
    assert.equal(enrutar('canta 1').payload.clip, 'bohemian');
    assert.equal(enrutar('bohemian').payload.clip, 'bohemian');
    assert.equal(enrutar('canta 5').payload.clip, 'bruno');
    assert.equal(enrutar('runaway').skill, 'canto');
  });

  it('cerebro, clima, visión, http', () => {
    assert.equal(enrutar('actualiza el cerebro').skill, 'cerebro');
    assert.equal(enrutar('aprendé eso').skill, 'cerebro');
    assert.equal(enrutar('clima en San Pedro Sula').skill, 'clima');
    assert.equal(enrutar('clima').payload.ciudad, 'Tegucigalpa');
    assert.equal(enrutar('qué ves').skill, 'vision');
    assert.equal(enrutar('https://example.com/x').skill, 'web');
    assert.equal(enrutar('abre la página https://bch.hn').skill, 'pagina');
  });

  it('default chat', () => {
    assert.equal(enrutar('qué hora es').skill, 'chat');
    assert.equal(enrutar('hola jefe').skill, 'chat');
    assert.equal(enrutar('modo oro').skill, 'chat');
  });
});
