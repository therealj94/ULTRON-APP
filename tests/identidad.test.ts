import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolverQuien, quienVerificado } from '../lib/memoria';
import { puedeCambiarSistema } from '../lib/junta';

test('con sesión, el body no escala: Carlos no se vuelve José por poner un correo', () => {
  const sesionCarlos = { nombre: 'Carlos', correo: '' };
  const body = { usuario: 'José', correo: 'j.ordonez@ordenglobal.org' };
  // La sesión identifica solo por su CORREO (server/nivel.ts): el nombre de una sesión lo elige quien
  // entra, y con Genesis abierto cualquiera podría llamarse «Carlos» o «José». Sin correo del padrón,
  // nadie; y el correo del cuerpo, menos.
  assert.equal(resolverQuien(body, sesionCarlos), null);
  assert.equal(quienVerificado(body, sesionCarlos), null);
  assert.equal(puedeCambiarSistema(quienVerificado(body, sesionCarlos)), false);
  process.env.ULTRON_PADRON = 'carlos | | carlos@ordenglobal.org | |';
  try {
    const conCorreo = { nombre: 'Carlos', correo: 'carlos@ordenglobal.org' };
    assert.equal(resolverQuien(body, conCorreo), 'carlos');
    assert.equal(quienVerificado(body, conCorreo), 'carlos');
    assert.equal(puedeCambiarSistema(quienVerificado(body, conCorreo)), false);
  } finally {
    process.env.ULTRON_PADRON = '';
  }
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
