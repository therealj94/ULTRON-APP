import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expresar, cancionPorPedido } from '../server/voz';

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
  assert.equal(cancionPorPedido('canta la de Medardo')?.id, 'bittersweet');
  assert.equal(cancionPorPedido('canta algo de salsa'), null);
});
