import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolverQuien, quienVerificado } from '../lib/memoria';
import { puedeCambiarSistema } from '../lib/junta';

test('con sesión, el body no escala: Carlos no se vuelve José por poner un correo', () => {
  const sesionCarlos = { nombre: 'Carlos', correo: '' };
  const body = { usuario: 'José', correo: 'j.ordonez@ordenglobal.org' };
  assert.equal(resolverQuien(body, sesionCarlos), 'carlos');
  assert.equal(quienVerificado(body, sesionCarlos), 'carlos');
  assert.equal(puedeCambiarSistema(quienVerificado(body, sesionCarlos)), false);
});

test('sin sesión, el nombre del body solo sirve para atribuir memoria, nunca para mando', () => {
  const body = { usuario: 'José' };
  assert.equal(resolverQuien(body, null), 'jose');
  assert.equal(quienVerificado(body, null), null);
  assert.equal(puedeCambiarSistema(quienVerificado(body, null)), false);
});

test('Telegram verificado sí identifica y da mando a José', () => {
  const prev = process.env.TELEGRAM_JOSE_USER_ID;
  process.env.TELEGRAM_JOSE_USER_ID = '111';
  const body = { telegramUserId: '111' };
  assert.equal(quienVerificado(body, null), 'jose');
  assert.equal(puedeCambiarSistema(quienVerificado(body, null)), true);
  if (prev === undefined) delete process.env.TELEGRAM_JOSE_USER_ID;
  else process.env.TELEGRAM_JOSE_USER_ID = prev;
});

test('sesión de José da mando', () => {
  assert.equal(puedeCambiarSistema(quienVerificado({}, { nombre: 'José', correo: 'j.ordonez@ordenglobal.org' })), true);
});
