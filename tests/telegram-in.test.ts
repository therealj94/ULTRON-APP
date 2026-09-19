import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chatsPermitidos, telegramAutorizado, telegramWebhookSecretOk, parsearUpdateTelegram, recordarTelegram, hiloTelegram, resetHilosTelegramTest } from '../lib/telegram-in';

describe('Telegram inbound privado', () => {
  it('sin chat configurado nadie entra', () => {
    const prev = {
      TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
      TELEGRAM_ALLOWED_CHAT_IDS: process.env.TELEGRAM_ALLOWED_CHAT_IDS,
      TELEGRAM_JOSE_CHAT_ID: process.env.TELEGRAM_JOSE_CHAT_ID,
      TELEGRAM_JOSE_USER_ID: process.env.TELEGRAM_JOSE_USER_ID,
      TELEGRAM_MEDARDO_CHAT_ID: process.env.TELEGRAM_MEDARDO_CHAT_ID,
      TELEGRAM_MEDARDO_USER_ID: process.env.TELEGRAM_MEDARDO_USER_ID,
      TELEGRAM_CARLOS_CHAT_ID: process.env.TELEGRAM_CARLOS_CHAT_ID,
      TELEGRAM_CARLOS_USER_ID: process.env.TELEGRAM_CARLOS_USER_ID,
      TELEGRAM_MAYRA_CHAT_ID: process.env.TELEGRAM_MAYRA_CHAT_ID,
      TELEGRAM_MAYRA_USER_ID: process.env.TELEGRAM_MAYRA_USER_ID,
    };
    for (const k of Object.keys(prev)) delete process.env[k];
    assert.equal(chatsPermitidos().length, 0);
    assert.equal(telegramAutorizado('123'), false);
    for (const [k, v] of Object.entries(prev)) {
      if (v !== undefined) process.env[k] = v;
    }
  });

  it('Mayra entra por su chat o por su user id', () => {
    const keys = ['TELEGRAM_CHAT_ID', 'TELEGRAM_ALLOWED_CHAT_IDS', 'TELEGRAM_MAYRA_CHAT_ID', 'TELEGRAM_MAYRA_USER_ID', 'TELEGRAM_ALLOWED_USER_IDS'];
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
    process.env.TELEGRAM_CHAT_ID = '5673842734';
    process.env.TELEGRAM_MAYRA_USER_ID = '1997178235';
    assert.equal(telegramAutorizado('1997178235', '1997178235'), true);
    assert.equal(telegramAutorizado('-100grupo', '1997178235'), true);
    assert.equal(telegramAutorizado('999', '999'), false);
    for (const [k, v] of Object.entries(prev)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  it('solo el chat de la junta pasa', () => {
    const prevC = process.env.TELEGRAM_CHAT_ID;
    const prevU = process.env.TELEGRAM_ALLOWED_USER_IDS;
    const prevM = process.env.TELEGRAM_MEDARDO_CHAT_ID;
    process.env.TELEGRAM_CHAT_ID = '5673842734';
    delete process.env.TELEGRAM_ALLOWED_USER_IDS;
    delete process.env.TELEGRAM_MEDARDO_CHAT_ID;
    assert.equal(telegramAutorizado('5673842734', '5673842734'), true);
    assert.equal(telegramAutorizado('999', '888'), false);
    process.env.TELEGRAM_ALLOWED_USER_IDS = '111';
    assert.equal(telegramAutorizado('5673842734', '111'), true);
    assert.equal(telegramAutorizado('5673842734', '222'), false);
    if (prevC !== undefined) process.env.TELEGRAM_CHAT_ID = prevC;
    else delete process.env.TELEGRAM_CHAT_ID;
    if (prevU !== undefined) process.env.TELEGRAM_ALLOWED_USER_IDS = prevU;
    else delete process.env.TELEGRAM_ALLOWED_USER_IDS;
    if (prevM !== undefined) process.env.TELEGRAM_MEDARDO_CHAT_ID = prevM;
    else delete process.env.TELEGRAM_MEDARDO_CHAT_ID;
  });

  it('Carlos entra por su chat o por su user id', () => {
    const keys = ['TELEGRAM_CHAT_ID', 'TELEGRAM_ALLOWED_CHAT_IDS', 'TELEGRAM_CARLOS_CHAT_ID', 'TELEGRAM_CARLOS_USER_ID', 'TELEGRAM_ALLOWED_USER_IDS'];
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
    process.env.TELEGRAM_CHAT_ID = '5673842734';
    process.env.TELEGRAM_CARLOS_USER_ID = '1017697215';
    assert.equal(telegramAutorizado('1017697215', '1017697215'), true);
    assert.equal(telegramAutorizado('-100grupo', '1017697215'), true);
    assert.equal(telegramAutorizado('999', '999'), false);
    for (const [k, v] of Object.entries(prev)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  it('Medardo entra por su chat o por su user id', () => {
    const keys = ['TELEGRAM_CHAT_ID', 'TELEGRAM_ALLOWED_CHAT_IDS', 'TELEGRAM_MEDARDO_CHAT_ID', 'TELEGRAM_MEDARDO_USER_ID', 'TELEGRAM_ALLOWED_USER_IDS'];
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
    process.env.TELEGRAM_CHAT_ID = '5673842734';
    process.env.TELEGRAM_MEDARDO_USER_ID = '5273354540';
    assert.equal(telegramAutorizado('5273354540', '5273354540'), true);
    assert.equal(telegramAutorizado('-100grupo', '5273354540'), true);
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

  it('el hilo de un chat sobrevive en memoria entre turnos', () => {
    resetHilosTelegramTest();
    recordarTelegram('chat-test-hilo', 'busca tipo de cambio BCH', 'El BCH publica el promedio.');
    const h = hiloTelegram('chat-test-hilo');
    assert.equal(h.length, 2);
    assert.equal(h[0].texto, 'busca tipo de cambio BCH');
    recordarTelegram('chat-test-hilo', 'y eso en lempiras?', 'Sigue el promedio del BCH.');
    assert.equal(hiloTelegram('chat-test-hilo').length, 4);
    resetHilosTelegramTest();
  });

  it('toma el reply_to como contexto del hilo', async () => {
    const p = await parsearUpdateTelegram({
      message: {
        chat: { id: 1 },
        from: { id: 1, first_name: 'José' },
        text: 'y eso?',
        reply_to_message: { text: 'El BCH publica el tipo de cambio. Fuente bch.hn' },
      },
    });
    assert.equal(p?.texto, 'y eso?');
    assert.match(String(p?.replyTo), /BCH/);
  });
});
