import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COT_FORZADO, esTareaDeCodigo, pideCodigo, requiereCot } from '../lib/prompts/cot';
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

it('«analiza» o «paso a paso» no es pedir código: no cambia las instrucciones al modo código', () => {
  assert.equal(pideCodigo('analiza paso a paso cuánto oro sale de cien toneladas'), false);
  assert.equal(requiereCot('analiza paso a paso cuánto oro sale de cien toneladas'), true);
  assert.equal(pideCodigo('escribe una función en python que sume'), true);
  assert.equal(pideCodigo('mira esto ```x = 1```'), true);
  assert.equal(pideCodigo('Traza misterio(10) paso a paso'), true);
});
