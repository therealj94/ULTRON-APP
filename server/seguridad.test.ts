import { test } from 'node:test';
import assert from 'node:assert/strict';
import { devolverCupo, gastarCupo, urlPublica, mesaAutorizada, mesaDeskAutorizada, emitirSesion, sesionDe, _olvidarCacheSesiones } from './seguridad';
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

test('oír, ver y la voz abiertos con rate limit; ni turnos ni nada que cambie estado pasan sin sesión', () => {
  const prevN = process.env.NODE_ENV;
  const prevK = process.env.ULTRON_MESA_CLAVE;
  process.env.NODE_ENV = 'production';
  delete process.env.ULTRON_MESA_CLAVE;
  // El nombre en el body no es credencial.
  assert.equal(mesaAutorizada({ headers: { 'x-ultron-sesion': 'muerto' }, body: { usuario: 'José' }, path: '/api/turno' } as any), false);
  // Oír, ver, la voz y cantar: pasan (decisión de la junta, la APK no se queda muda). Ninguna piensa.
  assert.equal(mesaDeskAutorizada({ headers: {}, body: {}, path: '/api/tts', query: {} } as any), true);
  assert.equal(mesaDeskAutorizada({ headers: {}, body: {}, path: '/api/tts/stream', query: {} } as any), true);
  assert.equal(mesaDeskAutorizada({ headers: {}, body: {}, path: '/api/vision/analyze' } as any), true);
  // Un turno despierta al 27B: sin sesión ni clave de mesa, no (Fase 0.3).
  assert.equal(mesaDeskAutorizada({ headers: {}, body: {}, path: '/api/turno' } as any), false);
  assert.equal(mesaDeskAutorizada({ headers: {}, body: {}, path: '/api/turno/stream' } as any), false);
  // Abrir una conversación de ElevenLabs también piensa con el 27B: ya no entra por ser «de voz».
  assert.equal(mesaDeskAutorizada({ headers: {}, body: {}, path: '/api/voz/agente' } as any), false);
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

test('devolverCupo quita la entrada de ESE turno, no la última (Codex en #124)', () => {
  const k = `prueba-cupo-${Math.random()}`;
  const t0 = 1_000_000;
  assert.equal(gastarCupo(k, 2, 60_000, t0), true); // la frase a medias, al principio de la ventana
  assert.equal(gastarCupo(k, 2, 60_000, t0 + 50_000), true); // un turno de verdad, al final
  devolverCupo(k, t0); // se descarta la frase a medias
  // Pasado el minuto de la primera, el turno de verdad SIGUE contando: queda un solo lugar.
  assert.equal(gastarCupo(k, 2, 60_000, t0 + 61_000), true);
  assert.equal(gastarCupo(k, 2, 60_000, t0 + 61_001), false, 'con pop() se quitaba el de verdad y aquí había lugar de más');
});
