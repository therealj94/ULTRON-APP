/**
 * La respuesta en vivo de Dr Electrum (src-electrum/panel/frasesTurno.ts): las frases del stream se
 * enseñan y se dicen una sola vez (aunque un reintento las vuelva a mandar), el `fin` entero solo se dice
 * si no llegó ninguna, y la pregunta lleva su id y lo que la persona alcanzó a oír si interrumpió.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FrasesDelTurno, TOPE_OIDO, fraseDeEvento, interrumpidoDelTurno, juntarFrases, nuevoIdTurno } from '../src-electrum/panel/frasesTurno';

test('una frase del stream se valida; sin `voz` se dice su texto', () => {
  assert.deepEqual(fraseDeEvento({ i: 0, texto: 'Los Chaguites vence en diciembre.', voz: '[calm] Los Chaguites vence en diciembre.' }), {
    i: 0,
    texto: 'Los Chaguites vence en diciembre.',
    voz: '[calm] Los Chaguites vence en diciembre.',
  });
  assert.deepEqual(fraseDeEvento({ i: 2, texto: 'Hola.' }), { i: 2, texto: 'Hola.', voz: 'Hola.' });
  assert.equal(fraseDeEvento({ i: -1, texto: 'x' }), null);
  assert.equal(fraseDeEvento({ i: 1.5, texto: 'x' }), null);
  assert.equal(fraseDeEvento({ i: 1, texto: '  ' }), null);
  assert.equal(fraseDeEvento(null), null);
});

test('las frases se arman en orden y un reintento no las repite', () => {
  const f = new FrasesDelTurno();
  assert.equal(f.decirFinEntero(), true);
  assert.equal(f.recibir({ i: 0, texto: 'Primera.', voz: 'Primera.' }), true);
  assert.equal(f.recibir({ i: 2, texto: 'Tercera.', voz: 'Tercera.' }), true);
  assert.equal(f.recibir({ i: 1, texto: 'Segunda.', voz: 'Segunda.' }), true);
  // El reintento con el mismo idTurno vuelve a mandar la primera: ni se enseña ni se dice otra vez.
  assert.equal(f.recibir({ i: 0, texto: 'Primera.', voz: 'Primera.' }), false);
  assert.equal(f.cuantas, 3);
  assert.equal(f.texto(), 'Primera. Segunda. Tercera.');
  // Ya se dijeron: el `fin` no se repite.
  assert.equal(f.decirFinEntero(), false);
});

test('a la voz: la primera va sola, las demás juntas hasta el tope', () => {
  const cola = ['Uno.', 'Dos dos.', 'Tres tres tres.'];
  assert.deepEqual(juntarFrases(cola, 0), { texto: 'Uno.', usadas: 1 });
  assert.deepEqual(juntarFrases(cola, 420), { texto: 'Uno. Dos dos. Tres tres tres.', usadas: 3 });
  assert.deepEqual(juntarFrases(cola, 14), { texto: 'Uno. Dos dos.', usadas: 2 });
  // Una frase más larga que el tope sale entera (no se parte aquí).
  const larga = 'x'.repeat(500);
  assert.deepEqual(juntarFrases([larga, 'Dos.'], 420), { texto: larga, usadas: 1 });
  assert.deepEqual(juntarFrases([], 420), { texto: '', usadas: 0 });
});

test('cada pregunta lleva un id propio', () => {
  const a = nuevoIdTurno();
  const b = nuevoIdTurno();
  assert.ok(a.length >= 8);
  assert.notEqual(a, b);
});

test('lo que alcanzó a oír viaja una vez, con tope, quedándose con el final', () => {
  assert.equal(interrumpidoDelTurno(null), undefined);
  assert.deepEqual(interrumpidoDelTurno(''), { oido: '' });
  assert.deepEqual(interrumpidoDelTurno('  Los Chaguites tiene 478 hectáreas y…  '), { oido: 'Los Chaguites tiene 478 hectáreas y…' });
  const largo = `${'a'.repeat(600)} y aquí quedó`;
  const r = interrumpidoDelTurno(largo)!;
  assert.ok(r.oido.length <= TOPE_OIDO, String(r.oido.length));
  assert.ok(r.oido.startsWith('…'));
  assert.ok(r.oido.endsWith('y aquí quedó'));
});
