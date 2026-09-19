import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { criticaActiva, criticarCodigo } from '../lib/critico';

const ANAGRAMA_ROTO = `
def son_anagramas(a, b):
    return sorted(a) == sorted(b)
`;

describe('Fase 4 — crítico Claude', () => {
  it('está apagado por defecto (no añade latencia ni costo a la voz)', () => {
    const prev = process.env.CRITICA_ACTIVA;
    delete process.env.CRITICA_ACTIVA;
    assert.equal(criticaActiva(), false);
    if (prev !== undefined) process.env.CRITICA_ACTIVA = prev;
  });

  it('omite la crítica si no hay ANTHROPIC_API_KEY aunque el flag esté on', async () => {
    const prevA = process.env.CRITICA_ACTIVA;
    const prevK = process.env.ANTHROPIC_API_KEY;
    process.env.CRITICA_ACTIVA = 'true';
    delete process.env.ANTHROPIC_API_KEY;
    const r = await criticarCodigo(ANAGRAMA_ROTO, 'escribe anagramas');
    assert.equal(r.skipped, true);
    assert.equal(r.bugs, false);
    assert.match(r.texto, /ANTHROPIC_API_KEY/);
    if (prevA === undefined) delete process.env.CRITICA_ACTIVA;
    else process.env.CRITICA_ACTIVA = prevA;
    if (prevK === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevK;
  });

  it('e2e anagramas: Claude detecta el bug de sorted() (se salta sin clave)', async () => {
    if (!process.env.ANTHROPIC_API_KEY || !criticaActiva()) {
      return;
    }
    const r = await criticarCodigo(
      ANAGRAMA_ROTO,
      'Escribe una función que diga si dos frases son anagramas. Debe ignorar mayúsculas y espacios.'
    );
    assert.equal(r.skipped, false);
    assert.equal(r.bugs, true);
    assert.match(r.texto, /espacio|case|mayúscul|ignor/i);
  });
});
