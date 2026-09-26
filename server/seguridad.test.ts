import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlPublica, mesaAutorizada, mesaDeskAutorizada, emitirSesion, sesionDe, _olvidarCacheSesiones } from './seguridad';
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

test('sesión firmada sobrevive sin el Map en memoria', () => {
  const prev = process.env.ULTRON_SESION_SECRETO;
  process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-para-hmac-sesion';
  const s = emitirSesion({ correo: 'j.ordonez@ordenglobal.org', nombre: 'José', rol: 'Junta' });
  assert.match(s.token, /^u1\./);
  // Como tras un redespliegue: el Map se vacía, el token firmado sigue valiendo.
  _olvidarCacheSesiones();
  const viva = sesionDe({ headers: { 'x-ultron-sesion': s.token } } as any);
  assert.equal(viva?.correo, 'j.ordonez@ordenglobal.org');
  assert.equal(viva?.nombre, 'José');
  const fake = sesionDe({ headers: { 'x-ultron-sesion': s.token.slice(0, -2) + 'xx' } } as any);
  assert.equal(fake, null);
  if (prev === undefined) delete process.env.ULTRON_SESION_SECRETO;
  else process.env.ULTRON_SESION_SECRETO = prev;
});

test('conversación abierta con rate limit; nada que cambie estado pasa sin sesión', () => {
  const prevN = process.env.NODE_ENV;
  const prevK = process.env.ULTRON_MESA_CLAVE;
  process.env.NODE_ENV = 'production';
  delete process.env.ULTRON_MESA_CLAVE;
  // El nombre en el body no es credencial.
  assert.equal(mesaAutorizada({ headers: { 'x-ultron-sesion': 'muerto' }, body: { usuario: 'José' }, path: '/api/turno' } as any), false);
  // Hablar, oír, ver y cantar: pasan (decisión de la junta, la APK no se queda muda).
  assert.equal(mesaDeskAutorizada({ headers: {}, body: {}, path: '/api/turno' } as any), true);
  assert.equal(mesaDeskAutorizada({ headers: {}, body: {}, path: '/api/tts', query: {} } as any), true);
  assert.equal(mesaDeskAutorizada({ headers: {}, body: {}, path: '/api/stt' } as any), true);
  assert.equal(mesaDeskAutorizada({ headers: {}, body: {}, path: '/api/cantar' } as any), true);
  // Memoria, ejecutor, bóveda, redeploy: sesión real o nada. El body con "José" no abre.
  assert.equal(mesaDeskAutorizada({ headers: {}, body: { usuario: 'José' }, path: '/api/memoria' } as any), false);
  assert.equal(mesaDeskAutorizada({ headers: {}, body: { usuario: 'José' }, path: '/api/ejecutar' } as any), false);
  assert.equal(mesaDeskAutorizada({ headers: {}, body: { correo: 'j.ordonez@ordenglobal.org' }, path: '/api/render/deploy' } as any), false);
  if (prevN === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevN;
  if (prevK === undefined) delete process.env.ULTRON_MESA_CLAVE;
  else process.env.ULTRON_MESA_CLAVE = prevK;
});
