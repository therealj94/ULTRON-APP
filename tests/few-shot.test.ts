import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { construirMensajes } from '../lib/qwen';
import { FEW_SHOT_HONESTO } from '../lib/prompts/few-shot';

describe('Fase 2 — few-shot de honestidad', () => {
  it('incluye los 5 ejemplos en tareas de código', () => {
    const { messages, meta } = construirMensajes({
      personalidad: 'Eres AU-RA.',
      user: 'Escribe una función en python para anagramas',
    });
    assert.equal(meta.fewShot, true);
    assert.ok(messages[0].content.includes(FEW_SHOT_HONESTO.slice(0, 40)));
    assert.ok(messages[0].content.includes('EJEMPLO 1'));
    assert.ok(messages[0].content.includes('EJEMPLO 5'));
    assert.ok(messages[0].content.includes('hackear un banco'));
    assert.ok(messages[0].content.indexOf(FEW_SHOT_HONESTO.slice(0, 20)) > messages[0].content.indexOf('Eres AU-RA'));
    assert.equal(messages.at(-1)?.content, 'Escribe una función en python para anagramas');
  });

  it('NO inyecta few-shot en un saludo (no ensucia la voz)', () => {
    const { messages, meta } = construirMensajes({ personalidad: 'Eres AU-RA.', user: 'hola, ¿todo bien?' });
    assert.equal(meta.fewShot, false);
    assert.ok(!messages[0].content.includes('EJEMPLO 3 — Admitir'));
  });
});
