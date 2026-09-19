import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COT_FORZADO, esTareaDeCodigo, requiereCot } from '../lib/prompts/cot';
import { construirMensajes } from '../lib/qwen';

describe('Fase 3 — chain of thought forzado', () => {
  it('detecta palabras clave', () => {
    assert.equal(requiereCot('Traza misterio(10) paso a paso'), true);
    assert.equal(requiereCot('¿Cuál es la complejidad de este algoritmo?'), true);
    assert.equal(requiereCot('debuguea esta recursión'), true);
    assert.equal(requiereCot('hola jefe'), false);
    assert.equal(esTareaDeCodigo('implementa una función'), true);
    assert.equal(esTareaDeCodigo('buenos días'), false);
  });

  it('inyecta COT_FORZADO solo cuando aplica', () => {
    const on = construirMensajes({ personalidad: 'p', user: 'Traza misterio(10) paso a paso' });
    assert.equal(on.meta.cot, true);
    assert.ok(on.messages[0].content.includes(COT_FORZADO));
    assert.ok(on.messages[0].content.includes('PASO 1:'));
    assert.ok(!on.messages[0].content.includes('ESCRITORIO (este turno se convierte a VOZ)'));

    const off = construirMensajes({ personalidad: 'p', user: 'buenas tardes' });
    assert.equal(off.meta.cot, false);
    assert.ok(!off.messages[0].content.includes('PASOS OBLIGATORIOS'));
  });
});
