import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { expresar, cancionPorPedido, vozDe } from '../server/voz';

test('expresar añade la etiqueta de la emoción y convierte risas escritas en risa real', () => {
  const t = expresar('Je je, el oro subió 5000 dólares.', 'feliz');
  assert.ok(t.startsWith('[warmly]'), t);
  assert.ok(/\[laughs\]/.test(t), t);
  assert.ok(!/5000/.test(t), 'las cifras van en palabras');
});

test('expresar en canto antepone [singing] y no fija emoción', () => {
  assert.ok(expresar('quiero conocer a Jesús', 'neutral', 'sing').startsWith('[singing]'));
});

test('expresar respeta guiones que ya traen etiquetas', () => {
  const g = '[softly] Ahí voy. [singing] la la la';
  assert.equal(expresar(g, 'risa'), g);
});

test('el repertorio se reconoce en lenguaje natural', () => {
  assert.equal(cancionPorPedido('canta quiero conocer a Jesús')?.id, 'jesus');
  assert.equal(cancionPorPedido('cantame la de Generación 12')?.id, 'jesus');
  assert.equal(cancionPorPedido('canta 1')?.id, 'bohemian');
  assert.equal(cancionPorPedido('cantá way maker')?.id, 'waymaker');
  assert.equal(cancionPorPedido('cantame algo en inglés')?.id, 'waymaker');
  assert.equal(cancionPorPedido('canta la de Medardo')?.id, 'bittersweet');
  assert.equal(cancionPorPedido('canta algo de salsa'), null);
});

describe('cada plataforma con su voz', () => {
  function conVoz(v: string | undefined, fn: () => void) {
    const antes = process.env.ELECTRUM_VOZ;
    if (v === undefined) delete process.env.ELECTRUM_VOZ;
    else process.env.ELECTRUM_VOZ = v;
    try {
      fn();
    } finally {
      if (antes === undefined) delete process.env.ELECTRUM_VOZ;
      else process.env.ELECTRUM_VOZ = antes;
    }
  }

  it('Dr Electrum no habla con la voz de ULTRON, ni siquiera por descuido', () => {
    // El respaldo NO es la voz de ULTRON a propósito: dos cerebros con la misma voz son la misma
    // cosa con dos nombres, y descubrirlo delante de un cliente es tarde.
    conVoz(undefined, () => {
      assert.notEqual(vozDe('electrum'), vozDe('ultron'));
      assert.equal(vozDe('electrum'), 'onwK4e9ZLuTAKqWW03F9', 'Daniel: grave y de edad, como corresponde a un doctor');
    });
  });

  it('ELECTRUM_VOZ manda sobre el respaldo', () => {
    conVoz('pqHfZKP75CvOlQylNhV4', () => {
      assert.equal(vozDe('electrum'), 'pqHfZKP75CvOlQylNhV4');
      assert.notEqual(vozDe('ultron'), 'pqHfZKP75CvOlQylNhV4', 'cambiar la del Doctor no toca la de ULTRON');
    });
  });

  it('una variable en blanco o con espacios no deja mudo al Doctor', () => {
    conVoz('   ', () => assert.equal(vozDe('electrum'), 'onwK4e9ZLuTAKqWW03F9'));
    conVoz('', () => assert.equal(vozDe('electrum'), 'onwK4e9ZLuTAKqWW03F9'));
  });
});
