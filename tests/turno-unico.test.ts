/** Una frase, un turno (server/turno-unico.ts): los reintentos de la app no corren otro turno. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { claveTurno, idTurnoValido, reclamarTurno, _olvidarTurnos, _cuantosTurnos, MAX_TURNOS, type TurnoGuardado } from '../server/turno-unico';

const respuesta = (reply = 'Listo, ya está.'): TurnoGuardado => ({ reply, voz: reply, emocion: 'neutral', via: 'qwen', herramientas: [], acciones: [] });

test('el id: solo un texto corto y limpio; la clave lleva quién habla', () => {
  assert.equal(idTurnoValido('abc12345'), 'abc12345');
  assert.equal(idTurnoValido('corto'), null);
  assert.equal(idTurnoValido(12345678), null);
  assert.equal(idTurnoValido('con espacios dentro'), null);
  assert.equal(claveTurno('Majo@Orden.org', 'abc12345'), 'majo@orden.org|abc12345');
  assert.equal(claveTurno('majo@orden.org', undefined), null, 'sin id, como antes');
  assert.notEqual(claveTurno('a@x.org', 'abc12345'), claveTurno('b@x.org', 'abc12345'), 'el mismo id de otra persona es otro turno');
});

test('sin clave (cliente viejo): siempre se corre', async () => {
  _olvidarTurnos();
  const r = await reclamarTurno(null);
  assert.ok('terminar' in r);
  assert.equal(_cuantosTurnos(), 0);
});

test('el reintento de un turno que ya contestó recibe la misma respuesta, sin correr otro', async () => {
  _olvidarTurnos();
  const clave = claveTurno('majo@orden.org', 'frase-0001');
  const primero = await reclamarTurno(clave);
  assert.ok('terminar' in primero);
  primero.terminar(respuesta('El oro está en 4 163 dólares.'));
  const otra = await reclamarTurno(clave);
  assert.ok('previo' in otra);
  assert.equal(otra.previo.reply, 'El oro está en 4 163 dólares.');
});

test('el reintento de un turno EN CURSO lo espera (no corre uno en paralelo)', async () => {
  _olvidarTurnos();
  const clave = claveTurno('majo@orden.org', 'frase-0002');
  const primero = await reclamarTurno(clave);
  assert.ok('terminar' in primero);
  const reintento = reclamarTurno(clave);
  setTimeout(() => primero.terminar(respuesta('Te escribí a Beto.')), 20);
  const r = await reintento;
  assert.ok('previo' in r, 'esperó al de antes');
  assert.equal(r.previo.reply, 'Te escribí a Beto.');
});

test('si el turno anterior terminó sin respuesta, el reintento corre uno nuevo (para eso reintenta)', async () => {
  _olvidarTurnos();
  const clave = claveTurno('majo@orden.org', 'frase-0003');
  const primero = await reclamarTurno(clave);
  assert.ok('terminar' in primero);
  const reintento = reclamarTurno(clave);
  primero.terminar(null);
  const r = await reintento;
  assert.ok('terminar' in r, 'corre el suyo');
  // Terminar dos veces no cambia nada.
  r.terminar(respuesta('Ahora sí.'));
  r.terminar(null);
  const tercero = await reclamarTurno(clave);
  assert.ok('previo' in tercero && tercero.previo.reply === 'Ahora sí.');
});

test('un turno colgado no deja al reintento esperando para siempre', async () => {
  _olvidarTurnos();
  const clave = claveTurno('majo@orden.org', 'frase-0004');
  await reclamarTurno(clave);
  const r = await reclamarTurno(clave, 30);
  assert.ok('terminar' in r);
});

test('tamaño acotado', async () => {
  _olvidarTurnos();
  for (let i = 0; i < MAX_TURNOS + 50; i++) {
    const r = await reclamarTurno(claveTurno('majo@orden.org', `frase-${String(i).padStart(6, '0')}`));
    if ('terminar' in r) r.terminar(respuesta());
  }
  assert.ok(_cuantosTurnos() <= MAX_TURNOS);
});
