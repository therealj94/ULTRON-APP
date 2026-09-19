import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buscarSnippets, SNIPPETS } from '../lib/rag';
import { construirMensajes } from '../lib/qwen';

describe('Fase 6 — RAG de snippets verificados', () => {
  it('el corpus es no vacío y cada snippet tiene código', () => {
    assert.ok(SNIPPETS.length >= 20);
    for (const s of SNIPPETS) {
      assert.ok(s.codigo.trim().length > 10, s.id);
      assert.ok(s.tags.length > 0, s.id);
    }
  });

  it('busca anagramas y normalizar por tags', () => {
    const a = buscarSnippets('función de anagramas ignorando espacios', 3);
    assert.ok(a.some((s) => s.id === 'anagramas'));
    const n = buscarSnippets('normalizar acentos café cafe', 3);
    assert.ok(n.some((s) => s.id === 'normalize'));
  });

  it('inyecta snippets en el system prompt de una tarea de código', () => {
    const { messages, meta } = construirMensajes({
      personalidad: 'p',
      user: 'Escribe código python de anagramas',
    });
    assert.ok(meta.rag >= 1);
    assert.ok(messages[0].content.includes('SNIPPETS VERIFICADOS'));
    assert.ok(messages[0].content.includes('son_anagramas'));
  });

  it('no inyecta RAG en un saludo', () => {
    const { messages, meta } = construirMensajes({ personalidad: 'p', user: 'hola' });
    assert.equal(meta.rag, 0);
    assert.ok(!messages[0].content.includes('SNIPPETS VERIFICADOS'));
  });
});
