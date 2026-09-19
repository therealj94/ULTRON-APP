import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { quienEs, nombreDe, puedeCambiarSistema } from '../lib/junta';
import { mensajeBienvenidaUltron } from '../lib/bienvenida';
import { contienePalabraProhibida } from '../lib/prompts/honestidad';

describe('Junta: José, Medardo, Carlos y Mayra', () => {
  it('separa por nombre y correo', () => {
    assert.equal(quienEs({ nombre: 'José' }), 'jose');
    assert.equal(quienEs({ nombre: 'Jose' }), 'jose');
    assert.equal(quienEs({ nombre: 'Medardo' }), 'medardo');
    assert.equal(quienEs({ nombre: 'Carlos Paguada' }), 'carlos');
    assert.equal(quienEs({ nombre: 'Mayra Enamorado' }), 'mayra');
    assert.equal(quienEs({ nombre: 'Mayra' }), 'mayra');
    assert.equal(quienEs({ nombre: 'Leo' }), null);
    assert.equal(quienEs({ correo: 'j.ordonez@ordenglobal.org' }), 'jose');
    assert.equal(quienEs({ correo: 'm.ordonez@ordenglobal.org' }), 'medardo');
    assert.equal(quienEs({ nombre: 'Melany' }), null);
    assert.equal(nombreDe('jose'), 'José');
    assert.equal(nombreDe('medardo'), 'Medardo');
    assert.equal(nombreDe('carlos'), 'Carlos');
    assert.equal(nombreDe('mayra'), 'Mayra');
  });

  it('solo José y Medardo cambian el sistema', () => {
    assert.equal(puedeCambiarSistema('jose'), true);
    assert.equal(puedeCambiarSistema('medardo'), true);
    assert.equal(puedeCambiarSistema('carlos'), false);
    assert.equal(puedeCambiarSistema('mayra'), false);
    assert.equal(puedeCambiarSistema(null), true);
  });

  it('usa ids de Telegram si están en env', () => {
    const prevJ = process.env.TELEGRAM_JOSE_USER_ID;
    const prevM = process.env.TELEGRAM_MEDARDO_USER_ID;
    const prevC = process.env.TELEGRAM_CARLOS_USER_ID;
    const prevY = process.env.TELEGRAM_MAYRA_USER_ID;
    process.env.TELEGRAM_JOSE_USER_ID = '111';
    process.env.TELEGRAM_MEDARDO_USER_ID = '222';
    process.env.TELEGRAM_CARLOS_USER_ID = '1017697215';
    process.env.TELEGRAM_MAYRA_USER_ID = '1997178235';
    assert.equal(quienEs({ telegramUserId: '111' }), 'jose');
    assert.equal(quienEs({ telegramUserId: '222' }), 'medardo');
    assert.equal(quienEs({ telegramUserId: '1017697215', nombre: 'Leo' }), 'carlos');
    assert.equal(quienEs({ telegramUserId: '1997178235', nombre: 'Mayra' }), 'mayra');
    assert.equal(quienEs({ telegramUserId: '999' }), null);
    if (prevJ !== undefined) process.env.TELEGRAM_JOSE_USER_ID = prevJ;
    else delete process.env.TELEGRAM_JOSE_USER_ID;
    if (prevM !== undefined) process.env.TELEGRAM_MEDARDO_USER_ID = prevM;
    else delete process.env.TELEGRAM_MEDARDO_USER_ID;
    if (prevC !== undefined) process.env.TELEGRAM_CARLOS_USER_ID = prevC;
    else delete process.env.TELEGRAM_CARLOS_USER_ID;
    if (prevY !== undefined) process.env.TELEGRAM_MAYRA_USER_ID = prevY;
    else delete process.env.TELEGRAM_MAYRA_USER_ID;
  });

  it('la bienvenida vende ULTRON FP sin palabras prohibidas', () => {
    const m = mensajeBienvenidaUltron({ nombre: 'Mayra', quien: 'mayra' });
    assert.match(m, /ULTRON FP/);
    assert.match(m, /Mayra/);
    assert.match(m, /no cambian el sistema/);
    assert.match(m, /Qwen/);
    assert.equal(contienePalabraProhibida(m).length, 0);
    const c = mensajeBienvenidaUltron({ nombre: 'Carlos', quien: 'carlos' });
    assert.match(c, /Carlos/);
    assert.match(c, /no cambian el sistema/);
    assert.equal(contienePalabraProhibida(c).length, 0);
  });
});
