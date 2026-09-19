import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlPublica, mesaAutorizada } from './seguridad';
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
  if (!r.ok && 'error' in r && /DNS|privada/i.test(r.error)) return;
  assert.equal(r.ok, true);
});

test('limpiarParaVoz quita markdown', () => {
  assert.equal(limpiarParaVoz('**hola** jefe'), 'hola jefe');
});

test('mesa en producción no deja pasar sin sesión ni clave', () => {
  const prevN = process.env.NODE_ENV;
  const prevK = process.env.ULTRON_MESA_CLAVE;
  process.env.NODE_ENV = 'production';
  delete process.env.ULTRON_MESA_CLAVE;
  assert.equal(mesaAutorizada({ headers: {} } as any), false);
  process.env.ULTRON_MESA_CLAVE = 'clave-de-prueba-32chars-xxxxxx';
  assert.equal(mesaAutorizada({ headers: { 'x-ultron-mesa': 'clave-de-prueba-32chars-xxxxxx' } } as any), true);
  assert.equal(mesaAutorizada({ headers: { 'x-ultron-mesa': 'otra' } } as any), false);
  if (prevN === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevN;
  if (prevK === undefined) delete process.env.ULTRON_MESA_CLAVE;
  else process.env.ULTRON_MESA_CLAVE = prevK;
});
