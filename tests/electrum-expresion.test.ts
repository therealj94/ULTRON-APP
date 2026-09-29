import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMOCION_DE, METAS, expresionDeLinea, reaccionA, sinEtiquetas } from '../src-electrum/personajes/expresion';
import { EMOCIONES } from '../lib/emocion';

test('la etiqueta de la voz decide la expresión de la cara', () => {
  assert.equal(expresionDeLinea('[laughs] ¡No me diga!'), 'risa');
  assert.equal(expresionDeLinea('[curious] Doctor, ¿qué tenemos aquí?'), 'curioso');
  assert.equal(expresionDeLinea('[thoughtful] Mmm, depende del rumbo.'), 'pensativo');
  assert.equal(expresionDeLinea('[surprised] ¿Tanto?'), 'sorpresa');
  assert.equal(expresionDeLinea('[serious] Eso vence en marzo.'), 'serio');
  assert.equal(expresionDeLinea('[sighs] Otra vez el traslape.'), 'triste');
  assert.equal(expresionDeLinea('[whispers] Entre nos…'), 'susurro');
  assert.equal(expresionDeLinea('[warmly] Clarísimo, gracias.'), 'feliz');
  // La primera etiqueta que se reconoce manda; las desconocidas se saltan.
  assert.equal(expresionDeLinea('[pause] [chuckles] Bueno…'), 'risa');
});

test('sin etiqueta, la puntuación dice algo; con soloEtiquetas, no', () => {
  assert.equal(expresionDeLinea('¡Qué bonito!'), 'feliz');
  assert.equal(expresionDeLinea('¿Y eso?'), 'curioso');
  assert.equal(expresionDeLinea('Son 86 concesiones.'), 'neutral');
  assert.equal(expresionDeLinea('¡Qué bonito!', true), 'neutral');
  assert.equal(expresionDeLinea(null), 'neutral');
});

test('quien escucha reacciona a medias, no imita', () => {
  assert.equal(reaccionA('risa'), 'feliz');
  assert.equal(reaccionA('sorpresa'), 'curioso');
  assert.equal(reaccionA('triste'), 'serio');
  assert.equal(reaccionA('pensativo'), 'neutral');
});

test('cada expresión tiene metas y una emoción válida para la cara principal', () => {
  for (const [e, m] of Object.entries(METAS)) {
    for (const v of Object.values(m)) assert.ok(Number.isFinite(v), e);
    assert.ok((EMOCIONES as readonly string[]).includes(EMOCION_DE[e as keyof typeof EMOCION_DE]), e);
  }
});

test('el subtítulo va sin etiquetas', () => {
  assert.equal(sinEtiquetas('[laughs] [warmly] ¡Claro que sí!'), '¡Claro que sí!');
});
