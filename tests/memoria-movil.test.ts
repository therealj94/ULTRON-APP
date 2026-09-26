/**
 * Memoria de largo plazo por persona en el teléfono compartido de la mesa (mobile/src/lib/memoriaUsuario.ts).
 *
 * Antes había una sola lista para todos y cada turno le mandaba al cerebro lo de cualquiera. Aquí se
 * prueba que cada quien tiene su clave y que el reparto de la lista vieja no le pasa a nadie lo ajeno.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAVE_MEMORIA_COMPARTIDA,
  MAX_HECHOS,
  agregarHecho,
  claveMemoria,
  firmadoPor,
  hechosValidos,
  migrarCompartida,
} from '../mobile/src/lib/memoriaUsuario';

const h = (hecho: string, at = '2026-09-01T00:00:00.000Z') => ({ hecho, at });

test('cada persona tiene su clave: por correo, y sin correo por nombre', () => {
  const jose = claveMemoria({ name: 'José', correo: 'jose@ordenglobal.org' });
  const medardo = claveMemoria({ name: 'Medardo', correo: 'medardo@ordenglobal.org' });
  assert.notEqual(jose, medardo);
  assert.equal(jose, claveMemoria({ name: 'Otro nombre', correo: '  JOSE@ordenglobal.org ' }), 'el correo manda, sin mayúsculas ni espacios');
  assert.notEqual(claveMemoria({ name: 'Ana', correo: '' }), claveMemoria({ name: 'Luis', correo: '' }));
  assert.equal(claveMemoria({ name: ' Ana ' }), claveMemoria({ name: 'ana' }));
  assert.notEqual(jose, CLAVE_MEMORIA_COMPARTIDA);
  assert.notEqual(claveMemoria({ name: '' }), CLAVE_MEMORIA_COMPARTIDA);
});

test('la lista vieja se reparte sin pasarle a nadie lo de otro', () => {
  const vieja = [h('Medardo: su hija se llama Sofía'), h('José: la junta es los lunes'), h('José: prefiere café sin azúcar'), h('suelto sin firma')];
  const deJose = migrarCompartida(vieja, null, 'José');
  assert.deepEqual(
    deJose.map((f) => f.hecho),
    ['José: la junta es los lunes', 'José: prefiere café sin azúcar'],
  );
  assert.ok(!deJose.some((f) => f.hecho.includes('Sofía')), 'lo de Medardo no pasa a José');
  assert.ok(!deJose.some((f) => f.hecho === 'suelto sin firma'), 'lo que no tiene dueño claro se descarta');
});

test('solo cuenta la firma exacta: un nombre que empieza igual no hereda', () => {
  assert.ok(firmadoPor('José: algo', 'José'));
  assert.ok(!firmadoPor('José Luis: algo', 'José'));
  assert.ok(!firmadoPor('Josefina: algo', 'José'));
  assert.ok(!firmadoPor('jose: algo', 'José'));
  assert.ok(!firmadoPor(': algo', ''), 'sin nombre no se reclama nada');
  assert.deepEqual(migrarCompartida([h('José Luis: x'), h('Josefina: y')], [], 'José'), []);
});

test('el reparto respeta lo propio, no repite y tiene tope', () => {
  const propia = [h('José: ya lo tenía', '2026-09-20T00:00:00.000Z')];
  const vieja = [h('José: ya lo tenía'), h('José: nuevo')];
  assert.deepEqual(
    migrarCompartida(vieja, propia, 'José').map((f) => f.hecho),
    ['José: ya lo tenía', 'José: nuevo'],
  );
  const muchos = Array.from({ length: 90 }, (_, i) => h(`José: hecho ${i}`));
  assert.equal(migrarCompartida(muchos, [], 'José').length, MAX_HECHOS);
});

test('lo guardado roto no rompe nada', () => {
  assert.deepEqual(hechosValidos(null), []);
  assert.deepEqual(hechosValidos('texto'), []);
  assert.deepEqual(hechosValidos([null, 3, { hecho: '' }, { hecho: 'José: ok' }, { nada: 1 }]), [{ hecho: 'José: ok', at: '' }]);
  assert.deepEqual(migrarCompartida({ no: 'lista' }, 'roto', 'José'), []);
});

test('agregar un hecho lo pone al frente, sin repetir y con tope', () => {
  const at = '2026-09-26T00:00:00.000Z';
  const lista = [h('José: a'), h('José: b')];
  assert.deepEqual(agregarHecho(lista, ' José: b ', at).map((f) => f.hecho), ['José: b', 'José: a']);
  assert.equal(agregarHecho(lista, '   ', at), lista, 'vacío no cambia nada');
  const llena = Array.from({ length: MAX_HECHOS }, (_, i) => h(`José: ${i}`));
  const nueva = agregarHecho(llena, 'José: nuevo', at);
  assert.equal(nueva.length, MAX_HECHOS);
  assert.equal(nueva[0].hecho, 'José: nuevo');
});
