/**
 * El vigía del nodo A10G (scripts/nodo-a10g/vigia): sus pruebas en Python corren acá también, y lo
 * que reporta llega a la pantalla en cifras, sin nombres de servicios.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { autocuraDe } from '../lib/nodo';

const hayPython = spawnSync('python3', ['--version']).status === 0;

test('vigía: reinicia lo caído, aprende el remedio, el tiempo y el precursor, y se frena', { skip: hayPython ? false : 'sin python3' }, () => {
  const r = spawnSync('python3', ['-m', 'unittest', 'probar_vigia'], { cwd: 'scripts/nodo-a10g/vigia', encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  assert.match(r.stderr, /Ran 1\d tests/);
});

test('autocura: cifras para la pantalla, sin nombres de servicios', () => {
  const ahora = 1_790_586_200_000;
  const v = {
    actualizado: ahora / 1000 - 30,
    sano: true,
    incidentes_24h: 2,
    prevenidos_24h: 1,
    ultimo: { sintoma: 'motor_mudo', inicio: ahora / 1000 - 600, duracion: 34.2, resuelto: 'ultron-motor' },
    aprendido: { motor_mudo: { remedio: 'ultron-motor' } },
    necesita_persona: [],
  };
  const a = autocuraDe(v, ahora)!;
  assert.deepEqual(a, { activa: true, sano: true, resueltas24h: 2, prevenidas24h: 1, aprendidas: 1, ultima: { hace_s: 600, duro_s: 34, sola: false } });
  assert.doesNotMatch(JSON.stringify(a), /ultron-motor|motor_mudo/);
  assert.equal(autocuraDe({ ...v, actualizado: ahora / 1000 - 900 }, ahora)!.activa, false, 'un vigía callado no se muestra como activo');
  assert.equal(autocuraDe(null, ahora), null);
  assert.equal(autocuraDe({ sano: true }, ahora), null);
});
