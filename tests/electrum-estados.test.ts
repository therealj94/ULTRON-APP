/**
 * «¿Cuántas concesiones están en exploración?»: el catastro dice «Explorar» y «S-Explorar», no
 * «exploración». El doctor contestaba que no había ninguna; había 86 vigentes y 90 solicitadas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { estadosQueCalzan, fasesDe, significadoEstado } from '../server/electrum/estados';
import { MANOS, manosDe } from '../server/electrum/manos';
import { convocar, herramientasDe } from '../server/electrum/especialistas';

const EXISTENTES = ['Otorgada', 'Solicitud', 'Delimitada', 'Explotar', 'S-Explotar', 'S-Explorar', 'Explorar', 'Suspenso'];

test('estados: «exploración» calza con Explorar y S-Explorar', () => {
  assert.deepEqual(estadosQueCalzan('exploración', EXISTENTES)!.sort(), ['Explorar', 'S-Explorar']);
  assert.deepEqual(estadosQueCalzan('en exploración vigente', EXISTENTES), ['Explorar']);
  assert.deepEqual(estadosQueCalzan('solicitudes de exploración', EXISTENTES), ['S-Explorar']);
  assert.deepEqual(estadosQueCalzan('explotación', EXISTENTES)!.sort(), ['Explotar', 'S-Explotar']);
  assert.deepEqual(estadosQueCalzan('en trámite', EXISTENTES)!.sort(), ['S-Explorar', 'S-Explotar', 'Solicitud']);
  assert.deepEqual(estadosQueCalzan('vigentes', EXISTENTES)!.sort(), ['Explorar', 'Explotar', 'Otorgada']);
  assert.deepEqual(estadosQueCalzan('Delimitada', EXISTENTES), ['Delimitada']);
  assert.deepEqual(estadosQueCalzan('caducada', EXISTENTES), []);
});

test('estados: cada uno se explica y las fases se suman aparte', () => {
  assert.equal(significadoEstado('Explorar'), 'exploración vigente');
  assert.equal(significadoEstado('S-Explorar'), 'solicitud de exploración');
  assert.equal(significadoEstado('S-Explotar'), 'solicitud de explotación');
  const f = fasesDe([{ nombre: 'Explorar', n: 86 }, { nombre: 'S-Explorar', n: 90 }, { nombre: 'Explotar', n: 124 }, { nombre: 'S-Explotar', n: 122 }, { nombre: 'Otorgada', n: 519 }]);
  assert.deepEqual(f, { exploracion: { vigentes: 86, solicitadas: 90 }, explotacion: { vigentes: 124, solicitadas: 122 } });
});

test('catastro_contar: registrada y ofrecida cuando se pregunta cuántas', () => {
  assert.ok(MANOS.catastro_contar);
  assert.equal(manosDe(['catastro_contar']).length, 1);
  assert.ok(herramientasDe(convocar('¿Cuántas concesiones están en estado de exploración?')).includes('catastro_contar'));
});
