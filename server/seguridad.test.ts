import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlPublica } from './seguridad';
import { limpiarParaVoz } from './desk';

test('bloquea metadata AWS y localhost', async () => {
  const a = await urlPublica('http://169.254.169.254/latest/meta-data');
  assert.equal(a.ok, false);
  const b = await urlPublica('http://127.0.0.1:8790');
  assert.equal(b.ok, false);
  const c = await urlPublica('http://localhost/admin');
  assert.equal(c.ok, false);
});

test('acepta https público', async () => {
  const r = await urlPublica('https://example.com/x');
  assert.equal(r.ok, true);
});

test('limpiarParaVoz quita markdown', () => {
  assert.equal(limpiarParaVoz('**hola** jefe'), 'hola jefe');
});
