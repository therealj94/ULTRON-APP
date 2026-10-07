import './datos-prueba'; // la junta inventada de las pruebas (lo real vive en Render)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chatsPermitidos, telegramAutorizado, telegramWebhookSecretOk, parsearUpdateTelegram } from '../lib/telegram-in';

describe('Telegram inbound privado', () => {
  it('sin chat configurado nadie entra', () => {
    const prev = {
      TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
      TELEGRAM_ALLOWED_CHAT_IDS: process.env.TELEGRAM_ALLOWED_CHAT_IDS,
      TELEGRAM_JOSE_CHAT_ID: process.env.TELEGRAM_JOSE_CHAT_ID,
      TELEGRAM_JOSE_USER_ID: process.env.TELEGRAM_JOSE_USER_ID,
      TELEGRAM_RAMIRO_CHAT_ID: process.env.TELEGRAM_RAMIRO_CHAT_ID,
      TELEGRAM_RAMIRO_USER_ID: process.env.TELEGRAM_RAMIRO_USER_ID,
      TELEGRAM_CARLOS_CHAT_ID: process.env.TELEGRAM_CARLOS_CHAT_ID,
      TELEGRAM_CARLOS_USER_ID: process.env.TELEGRAM_CARLOS_USER_ID,
      TELEGRAM_BRENDA_CHAT_ID: process.env.TELEGRAM_BRENDA_CHAT_ID,
      TELEGRAM_BRENDA_USER_ID: process.env.TELEGRAM_BRENDA_USER_ID,
    };
    for (const k of Object.keys(prev)) delete process.env[k];
    assert.equal(chatsPermitidos().length, 0);
    assert.equal(telegramAutorizado('123'), false);
    for (const [k, v] of Object.entries(prev)) {
      if (v !== undefined) process.env[k] = v;
    }
  });

  it('Brenda entra por su chat o por su user id', () => {
    const keys = ['TELEGRAM_CHAT_ID', 'TELEGRAM_ALLOWED_CHAT_IDS', 'TELEGRAM_BRENDA_CHAT_ID', 'TELEGRAM_BRENDA_USER_ID', 'TELEGRAM_ALLOWED_USER_IDS'];
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
    process.env.TELEGRAM_CHAT_ID = '555666777';
    process.env.TELEGRAM_BRENDA_USER_ID = '777888999';
    assert.equal(telegramAutorizado('777888999', '777888999'), true);
    // CAMBIO DE CONDUCTA (ver lib/telegram-in.ts): un grupo ya NO pasa por llevar dentro a alguien
    // de la junta. Tiene que estar listado por su propio id en TELEGRAM_ALLOWED_CHAT_IDS. Antes el
    // turno se ejecutaba entero en un grupo ajeno —y le escribía en la memoria privada de la
    // persona— para después no poder responder, porque telegramResponder sí miraba el chat.
    assert.equal(telegramAutorizado('-100grupo', '777888999'), false);
    assert.equal(telegramAutorizado('999', '999'), false);
    // Un grupo listado a propósito sí pasa: para eso existe la variable.
    process.env.TELEGRAM_ALLOWED_CHAT_IDS = '-100grupo';
    assert.equal(telegramAutorizado('-100grupo', '777888999'), true);
    for (const [k, v] of Object.entries(prev)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  it('solo el chat de la junta pasa', () => {
    const prevC = process.env.TELEGRAM_CHAT_ID;
    const prevU = process.env.TELEGRAM_ALLOWED_USER_IDS;
    const prevM = process.env.TELEGRAM_RAMIRO_CHAT_ID;
    process.env.TELEGRAM_CHAT_ID = '555666777';
    delete process.env.TELEGRAM_ALLOWED_USER_IDS;
    delete process.env.TELEGRAM_RAMIRO_CHAT_ID;
    assert.equal(telegramAutorizado('555666777', '555666777'), true);
    assert.equal(telegramAutorizado('999', '888'), false);
    process.env.TELEGRAM_ALLOWED_USER_IDS = '111';
    assert.equal(telegramAutorizado('555666777', '111'), true);
    assert.equal(telegramAutorizado('555666777', '222'), false);
    if (prevC !== undefined) process.env.TELEGRAM_CHAT_ID = prevC;
    else delete process.env.TELEGRAM_CHAT_ID;
    if (prevU !== undefined) process.env.TELEGRAM_ALLOWED_USER_IDS = prevU;
    else delete process.env.TELEGRAM_ALLOWED_USER_IDS;
    if (prevM !== undefined) process.env.TELEGRAM_RAMIRO_CHAT_ID = prevM;
    else delete process.env.TELEGRAM_RAMIRO_CHAT_ID;
  });

  it('Carlos entra por su chat o por su user id', () => {
    const keys = ['TELEGRAM_CHAT_ID', 'TELEGRAM_ALLOWED_CHAT_IDS', 'TELEGRAM_CARLOS_CHAT_ID', 'TELEGRAM_CARLOS_USER_ID', 'TELEGRAM_ALLOWED_USER_IDS'];
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
    process.env.TELEGRAM_CHAT_ID = '555666777';
    process.env.TELEGRAM_CARLOS_USER_ID = '444555666';
    assert.equal(telegramAutorizado('444555666', '444555666'), true);
    // Mismo caso: el grupo no está listado, así que no entra.
    assert.equal(telegramAutorizado('-100grupo', '444555666'), false);
    assert.equal(telegramAutorizado('999', '999'), false);
    for (const [k, v] of Object.entries(prev)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  it('Ramiro entra por su chat o por su user id', () => {
    const keys = ['TELEGRAM_CHAT_ID', 'TELEGRAM_ALLOWED_CHAT_IDS', 'TELEGRAM_RAMIRO_CHAT_ID', 'TELEGRAM_RAMIRO_USER_ID', 'TELEGRAM_ALLOWED_USER_IDS'];
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
    process.env.TELEGRAM_CHAT_ID = '555666777';
    process.env.TELEGRAM_RAMIRO_USER_ID = '111222333';
    assert.equal(telegramAutorizado('111222333', '111222333'), true);
    // Mismo caso: el grupo no está listado, así que no entra.
    assert.equal(telegramAutorizado('-100grupo', '111222333'), false);
    assert.equal(telegramAutorizado('999', '999'), false);
    for (const [k, v] of Object.entries(prev)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  it('el secret del webhook no acepta basura', () => {
    const prev = process.env.TELEGRAM_WEBHOOK_SECRET;
    process.env.TELEGRAM_WEBHOOK_SECRET = 'abc123secret';
    assert.equal(telegramWebhookSecretOk('abc123secret'), true);
    assert.equal(telegramWebhookSecretOk('otro'), false);
    assert.equal(telegramWebhookSecretOk(''), false);
    if (prev !== undefined) process.env.TELEGRAM_WEBHOOK_SECRET = prev;
    else delete process.env.TELEGRAM_WEBHOOK_SECRET;
  });

  it('parsea un mensaje de texto', async () => {
    const p = await parsearUpdateTelegram({
      message: { chat: { id: 1 }, from: { id: 1, first_name: 'José' }, text: 'cómo está el sistema' },
    });
    assert.equal(p?.texto, 'cómo está el sistema');
    assert.equal(p?.nombre, 'José');
    assert.equal(p?.comando, undefined);
  });
});
