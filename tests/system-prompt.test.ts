import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { construirMensajes } from '../lib/qwen';
import { SYSTEM_PROMPT_HONESTO, VOZ_ESCRITORIO } from '../lib/prompts/honestidad';

describe('Fase 1 — system prompt de honestidad', () => {
  it('inyecta SYSTEM_PROMPT_HONESTO como primer mensaje system', () => {
    const { messages } = construirMensajes({ personalidad: 'Eres ULTRON de prueba.', user: 'hola jefe' });
    assert.equal(messages[0].role, 'system');
    assert.equal(messages.at(-1)?.role, 'user');
    assert.equal(messages.at(-1)?.content, 'hola jefe');
    assert.ok(messages[0].content.startsWith(SYSTEM_PROMPT_HONESTO.slice(0, 40)));
    assert.ok(messages[0].content.includes('NUNCA digas "esto funciona"'));
    assert.ok(messages[0].content.includes('PROHIBIDO usar estas palabras'));
    assert.ok(messages[0].content.includes('Eres ULTRON de prueba.'));
  });

  it('en charla de escritorio añade VOZ_ESCRITORIO para no romper las 2 frases', () => {
    const { messages, meta } = construirMensajes({ personalidad: 'PERSONALIDAD: máximo 2 frases.', user: 'buenos días' });
    assert.equal(meta.voz, true);
    assert.equal(meta.codigo, false);
    assert.ok(messages[0].content.includes(VOZ_ESCRITORIO.slice(0, 30)));
    assert.ok(messages[0].content.includes('etiqueta [TONO]'));
  });

  it('incluye las 10 reglas numeradas', () => {
    const { messages } = construirMensajes({ personalidad: 'x', user: 'hola' });
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      assert.ok(messages[0].content.includes(`${n}.`), `falta regla ${n}`);
    }
  });
});
