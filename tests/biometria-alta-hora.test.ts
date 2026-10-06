/**
 * Un alta justo después de «olvida todas», en el MISMO milisegundo (servidor rápido; falló así en el CI del 6-oct): la
 * persona nueva se guarda. Antes su `creado` era igual a `borradoTodo` y `aplicarLapidas` (que borra lo creado `<=`)
 * la tiraba. Lo de antes del borrado sigue sin volver.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { aplicarLapidas, horaDeAlta } from '../lib/biometria-durable';

test('el alta en el mismo milisegundo que «olvida todas» o la marca de agua queda; lo de antes, no', () => {
  const t = 1_800_000_000_000;
  const d = { borradoTodo: t, lapidas: [] };
  const vieja = { id: 'a', creado: t };
  const nueva = { id: 'c', creado: horaDeAlta(d, t) };
  assert.deepEqual(aplicarLapidas([vieja, nueva], d).map((p) => p.id), ['c']);
  const m = { marcaLapidas: t, vivosEnMarca: [], lapidas: [] };
  assert.deepEqual(aplicarLapidas([{ id: 'n', creado: horaDeAlta(m, t) }], m).map((p) => p.id), ['n']);
  assert.equal(horaDeAlta({}, t), t, 'sin borrados, la hora de siempre');
  assert.equal(horaDeAlta(null, t), t);
});
