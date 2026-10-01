/**
 * El espacio fijo de cada persona en el nodo (lib/espacio-nodo.ts). 1-oct: los reintentos de ElevenLabs
 * caían en espacios distintos y releían 7 360 fichas cada uno, a la vez.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ESPACIO_COMUN, _olvidarEspacios, espacioDe } from '../lib/espacio-nodo';

test('cada persona siempre en el mismo espacio; sin persona, el común', () => {
  _olvidarEspacios();
  const jose = espacioDe('j@x.com');
  assert.equal(espacioDe('J@X.com'), jose, 'el correo no distingue mayúsculas');
  assert.equal(espacioDe('j@x.com'), jose);
  assert.equal(espacioDe(''), ESPACIO_COMUN);
  assert.equal(espacioDe(null), ESPACIO_COMUN);
  assert.notEqual(jose, ESPACIO_COMUN, 'una persona no usa el espacio común');
});

test('personas distintas, espacios distintos; con todos ocupados se cede el de quien lleva más rato sin hablar', () => {
  _olvidarEspacios();
  const a = espacioDe('a@x.com');
  const b = espacioDe('b@x.com');
  const c = espacioDe('c@x.com');
  assert.equal(new Set([a, b, c, ESPACIO_COMUN]).size, 4, 'tres personas y el común, cada uno el suyo');
  espacioDe('a@x.com'); // a vuelve a hablar: b es ahora el más viejo
  const d = espacioDe('d@x.com');
  assert.equal(d, b, 'd toma el de b');
  assert.equal(espacioDe('a@x.com'), a, 'a conserva el suyo');
  assert.equal(espacioDe('c@x.com'), c);
});
