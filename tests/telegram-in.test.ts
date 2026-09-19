import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chatsPermitidos, telegramAutorizado, telegramWebhookSecretOk, parsearUpdateTelegram } from '../lib/telegram-in';

describe('Telegram inbound privado', () => {
  it('sin chat configurado nadie entra', () => {
    const prevC = process.env.TELEGRAM_CHAT_ID;
    const prevA = process.env.TELEGRAM_ALLOWED_CHAT_IDS;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_ALLOWED_CHAT_IDS;
    assert.equal(chatsPermitidos().length, 0);
    assert.equal(telegramAutorizado('123'), false);
    if (prevC !== undefined) process.env.TELEGRAM_CHAT_ID = prevC;
    if (prevA !== undefined) process.env.TELEGRAM_ALLOWED_CHAT_IDS = prevA;
  });

  it('solo el chat de la junta pasa', () => {
    const prevC = process.env.TELEGRAM_CHAT_ID;
    const prevU = process.env.TELEGRAM_ALLOWED_USER_IDS;
    process.env.TELEGRAM_CHAT_ID = '5673842734';
    delete process.env.TELEGRAM_ALLOWED_USER_IDS;
    assert.equal(telegramAutorizado('5673842734', '5673842734'), true);
    assert.equal(telegramAutorizado('999', '5673842734'), false);
    process.env.TELEGRAM_ALLOWED_USER_IDS = '111';
    assert.equal(telegramAutorizado('5673842734', '111'), true);
    assert.equal(telegramAutorizado('5673842734', '222'), false);
    if (prevC !== undefined) process.env.TELEGRAM_CHAT_ID = prevC;
    else delete process.env.TELEGRAM_CHAT_ID;
    if (prevU !== undefined) process.env.TELEGRAM_ALLOWED_USER_IDS = prevU;
    else delete process.env.TELEGRAM_ALLOWED_USER_IDS;
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
