import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraerEmocion, normalizarEmocion, inferirEmocion, EMOCIONES } from '../lib/emocion';

test('extrae la etiqueta [EMO:x] y la quita del texto', () => {
  const r = extraerEmocion('[EMO:risa] Je, eso no me lo esperaba.');
  assert.equal(r.emocion, 'risa');
  assert.equal(r.texto, 'Je, eso no me lo esperaba.');
  assert.equal(r.explicita, true);
});

test('tolera etiquetas viejas [IDLE] / [TONO: BURLA] y nunca deja corchetes iniciales', () => {
  assert.equal(extraerEmocion('[IDLE] Todo bien, jefe.').texto, 'Todo bien, jefe.');
  assert.equal(extraerEmocion('[TONO: BURLA] Qué predecible.').emocion, 'travieso');
  assert.equal(extraerEmocion('[ENOJO_REAL] Ya.').emocion, 'molesto');
});

test('sin etiqueta infiere con cuidado y no inventa drama', () => {
  assert.equal(extraerEmocion('El oro cerró en tres mil.').emocion, 'neutral');
  assert.equal(inferirEmocion('Je je, esa estuvo buena.'), 'risa');
  assert.equal(inferirEmocion('El ojo no responde, cuidado.'), 'preocupado');
});

test('normaliza alias y acentos; lo desconocido es neutral', () => {
  assert.equal(normalizarEmocion('Cariño'), 'carino');
  assert.equal(normalizarEmocion('SORPRENDIDO'), 'sorpresa');
  assert.equal(normalizarEmocion('xyz'), 'neutral');
  for (const e of EMOCIONES) assert.equal(normalizarEmocion(e), e);
});
