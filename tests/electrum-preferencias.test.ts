/**
 * El panel de caras se pliega y cómo lo deja cada quien sigue con la persona, no con el navegador.
 * Aquí: plegado por defecto, solo claves conocidas y booleanas, y cada persona con lo suyo.
 */
import './datos-prueba'; // la junta inventada de las pruebas (lo real vive en Render)
import test from 'node:test';
import assert from 'node:assert/strict';
import { guardarPreferencias, preferenciasDe, PREFERENCIAS, sanearPreferencias } from '../server/electrum/preferencias';

test('plegado por defecto, dentro y fuera del recorrido', async () => {
  assert.equal(PREFERENCIAS.retratosPlegados, true);
  assert.equal(PREFERENCIAS.retratosPlegadosRecorrido, true);
  const p = await preferenciasDe(`nadie-${Date.now()}`);
  assert.deepEqual(p, { retratosPlegados: true, retratosPlegadosRecorrido: true });
});

test('solo claves conocidas y booleanas', () => {
  assert.deepEqual(sanearPreferencias({ retratosPlegados: false, otra: true, retratosPlegadosRecorrido: 'no' }), { retratosPlegados: false });
  assert.deepEqual(sanearPreferencias(null), {});
});

test('cada persona con lo suyo, y lo que deja se queda', async () => {
  const jose = `jose-${Date.now()}`;
  const ramiro = `ramiro-${Date.now()}`;
  await guardarPreferencias(jose, { retratosPlegados: false });
  assert.equal((await preferenciasDe(jose)).retratosPlegados, false);
  assert.equal((await preferenciasDe(jose)).retratosPlegadosRecorrido, true, 'lo del recorrido es aparte');
  assert.equal((await preferenciasDe(ramiro)).retratosPlegados, true, 'lo de José no le cambia la pantalla a Ramiro');
});
