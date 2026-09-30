/**
 * La charla de siempre al instante (lib/charla-rapida.ts): «hola», «¿cómo estás?», «gracias», «adiós»
 * hablados se contestan sin modelo, con la forma de ser del avatar y en su idioma; lo que no es SOLO
 * charla (o puede ser el «sí» de algo pendiente) no entra.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { respuestaCharla, tipoCharla } from '../lib/charla-rapida';

test('qué es charla y qué no', () => {
  assert.equal(tipoCharla('¿Cómo estás?'), 'como_estas');
  assert.equal(tipoCharla('hola aura, ¿qué tal?'), 'como_estas');
  assert.equal(tipoCharla('Hola, buenos días'), 'saludo');
  assert.equal(tipoCharla('muchas gracias'), 'gracias');
  assert.equal(tipoCharla('adiós, nos vemos'), 'adios');
  assert.equal(tipoCharla('how are you?'), 'como_estas');
  assert.equal(tipoCharla('hello there'), 'saludo');
  assert.equal(tipoCharla('thank you so much'), 'gracias');
  // No es solo charla: lo contesta el cerebro.
  assert.equal(tipoCharla('hola, ¿qué hora es?'), null);
  assert.equal(tipoCharla('gracias, mándaselo a Beto'), null);
  assert.equal(tipoCharla('¿cómo está el oro hoy?'), null);
  // Puede ser el «sí» de algo pendiente: tampoco.
  assert.equal(tipoCharla('ok'), null);
  assert.equal(tipoCharla('listo'), null);
  assert.equal(tipoCharla('dale'), null);
});

test('contesta como el avatar, en su idioma, con el nombre y sin repetirse seguido', () => {
  const a = respuestaCharla('¿cómo estás?', { avatar: 'claudio', idioma: 'es', azar: () => 0 });
  const b = respuestaCharla('¿cómo estás?', { avatar: 'claudio', idioma: 'es', azar: () => 0 });
  assert.ok(a && b);
  assert.notEqual(a.texto, b.texto, 'no la misma dos veces seguidas');
  assert.equal(a.emocion, 'feliz');
  const en = respuestaCharla('hi', { avatar: 'antonio', idioma: 'en', nombre: 'José', azar: () => 0 });
  assert.match(en!.texto, /José/);
  assert.doesNotMatch(en!.texto.replace('José', ''), /[áéíóú¿¡]/, 'en inglés');
  const sin = respuestaCharla('hola', { avatar: 'aura', idioma: 'es', azar: () => 0.99 });
  assert.doesNotMatch(sin!.texto, /\{n\}|, !/, 'sin nombre la frase queda bien');
  assert.equal(respuestaCharla('gracias', { avatar: 'ojos' })!.emocion, 'carino');
  assert.equal(respuestaCharla('explícame el contrato'), null);
});
