import './datos-prueba'; // la junta inventada de las pruebas (lo real vive en Render)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { quienEs, nombreDe, puedeCambiarSistema } from '../lib/junta';
import { mensajeBienvenidaUltron } from '../lib/bienvenida';
import { contienePalabraProhibida } from '../lib/prompts/honestidad';

describe('Junta: José, Ramiro, Carlos y Brenda', () => {
  it('separa por nombre y correo', () => {
    assert.equal(quienEs({ nombre: 'José' }), 'jose');
    assert.equal(quienEs({ nombre: 'Jose' }), 'jose');
    assert.equal(quienEs({ nombre: 'Ramiro' }), 'ramiro');
    assert.equal(quienEs({ nombre: 'Carlos Sagastume' }), 'carlos');
    assert.equal(quienEs({ nombre: 'Brenda Villeda' }), 'brenda');
    assert.equal(quienEs({ nombre: 'Brenda' }), 'brenda');
    assert.equal(quienEs({ nombre: 'Leo' }), null);
    assert.equal(quienEs({ correo: 'j.herrera@ordenglobal.org' }), 'jose');
    assert.equal(quienEs({ correo: 'r.herrera@ordenglobal.org' }), 'ramiro');
    assert.equal(quienEs({ nombre: 'Fabiola' }), null);
    assert.equal(nombreDe('jose'), 'José');
    assert.equal(nombreDe('ramiro'), 'Ramiro');
    assert.equal(nombreDe('carlos'), 'Carlos');
    assert.equal(nombreDe('brenda'), 'Brenda');
  });

  it('solo José y Ramiro cambian el sistema', () => {
    assert.equal(puedeCambiarSistema('jose'), true);
    assert.equal(puedeCambiarSistema('ramiro'), true);
    assert.equal(puedeCambiarSistema('carlos'), false);
    assert.equal(puedeCambiarSistema('brenda'), false);
    assert.equal(puedeCambiarSistema(null), false); // anónimo = consulta, nunca mando
  });

  it('usa ids de Telegram si están en env', () => {
    const prevJ = process.env.TELEGRAM_JOSE_USER_ID;
    const prevM = process.env.TELEGRAM_RAMIRO_USER_ID;
    const prevC = process.env.TELEGRAM_CARLOS_USER_ID;
    const prevY = process.env.TELEGRAM_BRENDA_USER_ID;
    process.env.TELEGRAM_JOSE_USER_ID = '111';
    process.env.TELEGRAM_RAMIRO_USER_ID = '222';
    process.env.TELEGRAM_CARLOS_USER_ID = '444555666';
    process.env.TELEGRAM_BRENDA_USER_ID = '777888999';
    assert.equal(quienEs({ telegramUserId: '111' }), 'jose');
    assert.equal(quienEs({ telegramUserId: '222' }), 'ramiro');
    assert.equal(quienEs({ telegramUserId: '444555666', nombre: 'Leo' }), 'carlos');
    assert.equal(quienEs({ telegramUserId: '777888999', nombre: 'Brenda' }), 'brenda');
    assert.equal(quienEs({ telegramUserId: '999' }), null);
    if (prevJ !== undefined) process.env.TELEGRAM_JOSE_USER_ID = prevJ;
    else delete process.env.TELEGRAM_JOSE_USER_ID;
    if (prevM !== undefined) process.env.TELEGRAM_RAMIRO_USER_ID = prevM;
    else delete process.env.TELEGRAM_RAMIRO_USER_ID;
    if (prevC !== undefined) process.env.TELEGRAM_CARLOS_USER_ID = prevC;
    else delete process.env.TELEGRAM_CARLOS_USER_ID;
    if (prevY !== undefined) process.env.TELEGRAM_BRENDA_USER_ID = prevY;
    else delete process.env.TELEGRAM_BRENDA_USER_ID;
  });

  it('la bienvenida vende AU-RA FP sin palabras prohibidas', () => {
    const m = mensajeBienvenidaUltron({ nombre: 'Brenda', quien: 'brenda' });
    assert.match(m, /AU-RA FP/);
    assert.match(m, /Brenda/);
    assert.match(m, /no cambian el sistema/);
    assert.match(m, /Qwen/);
    assert.equal(contienePalabraProhibida(m).length, 0);
    const c = mensajeBienvenidaUltron({ nombre: 'Carlos', quien: 'carlos' });
    assert.match(c, /Carlos/);
    assert.match(c, /no cambian el sistema/);
    assert.equal(contienePalabraProhibida(c).length, 0);
  });
});
