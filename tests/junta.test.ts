import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { quienEs, nombreDe } from '../lib/junta';

describe('Junta: José y Medardo', () => {
  it('separa por nombre y correo', () => {
    assert.equal(quienEs({ nombre: 'José' }), 'jose');
    assert.equal(quienEs({ nombre: 'Jose' }), 'jose');
    assert.equal(quienEs({ nombre: 'Medardo' }), 'medardo');
    assert.equal(quienEs({ correo: 'j.ordonez@ordenglobal.org' }), 'jose');
    assert.equal(quienEs({ correo: 'm.ordonez@ordenglobal.org' }), 'medardo');
    assert.equal(quienEs({ nombre: 'Melany' }), null);
    assert.equal(nombreDe('jose'), 'José');
    assert.equal(nombreDe('medardo'), 'Medardo');
  });

  it('usa ids de Telegram si están en env', () => {
    const prevJ = process.env.TELEGRAM_JOSE_USER_ID;
    const prevM = process.env.TELEGRAM_MEDARDO_USER_ID;
    process.env.TELEGRAM_JOSE_USER_ID = '111';
    process.env.TELEGRAM_MEDARDO_USER_ID = '222';
    assert.equal(quienEs({ telegramUserId: '111' }), 'jose');
    assert.equal(quienEs({ telegramUserId: '222' }), 'medardo');
    assert.equal(quienEs({ telegramUserId: '999' }), null);
    if (prevJ !== undefined) process.env.TELEGRAM_JOSE_USER_ID = prevJ;
    else delete process.env.TELEGRAM_JOSE_USER_ID;
    if (prevM !== undefined) process.env.TELEGRAM_MEDARDO_USER_ID = prevM;
    else delete process.env.TELEGRAM_MEDARDO_USER_ID;
  });
});
