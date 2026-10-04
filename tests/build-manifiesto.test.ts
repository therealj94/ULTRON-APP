/**
 * AUR16 / G0 (documento maestro del 3-oct): el manifiesto dice qué build corre sin soltar nada secreto.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRATOS, manifiestoBuild } from '../lib/build';

test('manifiesto: commit completo, servicio, contratos y banderas; ningún secreto', () => {
  const env = { RENDER_GIT_COMMIT: 'f85ef2456e0e1be7a11043f2fb65c17a82bfce19', RENDER_SERVICE_NAME: 'aura-fp', AURA_SW: '0', WEB_PUSH_VAPID_PRIVADA: 'no-debe-salir', ELECTRUM_CLAVE: 'tampoco' } as NodeJS.ProcessEnv;
  const m = manifiestoBuild({ plataforma: 'aura', banderas: { computadora: true } }, env);
  assert.equal(m.commit, 'f85ef2456e0e1be7a11043f2fb65c17a82bfce19');
  assert.equal(m.servicio, 'aura-fp');
  assert.equal(m.plataforma, 'aura');
  assert.deepEqual(m.contratos, CONTRATOS);
  assert.equal(m.banderas.serviceWorker, false);
  assert.equal(m.banderas.computadora, true);
  assert.equal(m.durable.tipo, 'memoria', 'bajo las pruebas, lo durable es memoria');
  const todo = JSON.stringify(m);
  assert.ok(!todo.includes('no-debe-salir') && !todo.includes('tampoco'), 'nada de llaves');
  assert.equal(manifiestoBuild({ plataforma: 'electrum' }, {} as NodeJS.ProcessEnv).commit, null);
});
