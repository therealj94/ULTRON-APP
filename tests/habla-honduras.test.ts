/**
 * LO HONDUREÑO, COMO SE DICE (server/habla.ts hondurenoAVoz, 10-oct): fechas día/mes, lempiras, teléfonos +504 de dos
 * en dos, la hora con «de la tarde», los nombres de la casa (AU-RA, ANT-ONIO, PULSE2CHAT, Genesis ID), SPS y las siglas
 * que se deletrean. Todo lo que habla en español pasa por aquí (afinarParaBoca): la mesa, el teléfono, Windows, Dr
 * Electrum y la llamada. Nunca toca las cifras de un enlace, un correo o un código.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { afinarParaBoca, afinarParaBocaIngles, hondurenoAVoz } from '../server/habla';

test('fechas día/mes, como se escriben en Honduras', () => {
  assert.equal(hondurenoAVoz('La cita es el 05/10.'), 'La cita es el 5 de octubre.');
  assert.equal(hondurenoAVoz('Vence el 31/12/2026'), 'Vence el 31 de diciembre de 2026');
  assert.equal(hondurenoAVoz('el 1/3/26'), 'el 1 de marzo de 2026');
  assert.equal(hondurenoAVoz('13/13 no es fecha; 3/4 de taza y 1/2 limón'), '13/13 no es fecha; 3/4 de taza y 1/2 limón', 'las fracciones no son fechas');
  assert.equal(hondurenoAVoz('Es para el 5/10'), 'Es para el 5 de octubre');
});

test('lempiras: L., Lps., HNL, coma de miles y centavos', () => {
  assert.equal(hondurenoAVoz('Son L. 1,500.'), 'Son mil quinientos lempiras.');
  assert.equal(hondurenoAVoz('Cuesta L1,500.50'), 'Cuesta mil quinientos lempiras con cincuenta centavos');
  assert.equal(hondurenoAVoz('HNL 21 y Lps. 1'), 'veintiún lempiras y un lempira');
  assert.equal(hondurenoAVoz('1,500 HNL'), 'mil quinientos lempiras');
  assert.equal(hondurenoAVoz('pago de 1.250.000 lempiras'), 'pago de un millón doscientos cincuenta mil lempiras');
  assert.equal(hondurenoAVoz('Lempira es un departamento.'), 'Lempira es un departamento.');
});

test('teléfonos de Honduras de dos en dos; los años no son teléfonos', () => {
  assert.equal(hondurenoAVoz('Llamá al +504 9876-5432.'), 'Llamá al más quinientos cuatro, noventa y ocho, setenta y seis, cincuenta y cuatro, treinta y dos.');
  assert.equal(hondurenoAVoz('o al 2550-0134'), 'o al veinticinco, cincuenta, cero uno, treinta y cuatro');
  assert.equal(hondurenoAVoz('del 2020-2024'), 'del 2020-2024');
  assert.equal(hondurenoAVoz('código 98765432'), 'código 98765432', 'sin guion ni +504 no se adivina');
});

test('la hora: «tres de la tarde», «y media», mediodía; un versículo no es una hora', () => {
  assert.equal(hondurenoAVoz('a las 3:00 p. m.'), 'a las tres de la tarde.', 'el punto de «p. m.» también cierra la frase');
  assert.equal(hondurenoAVoz('a la 1:00 p.m. y sigo'), 'a la una de la tarde y sigo');
  assert.equal(hondurenoAVoz('a las 8:30 a. m. Luego'), 'a las ocho y media de la mañana. Luego');
  assert.equal(hondurenoAVoz('12:00 pm'), 'doce del mediodía');
  assert.equal(hondurenoAVoz('a las 9 PM'), 'a las nueve de la noche');
  assert.equal(hondurenoAVoz('a las 15:15'), 'a las tres y cuarto de la tarde');
  assert.equal(hondurenoAVoz('Juan 3:16 dice'), 'Juan 3:16 dice');
});

test('nombres de la casa, SPS y siglas deletreadas', () => {
  assert.equal(hondurenoAVoz('Habla con AU-RA y ANT-ONIO en PULSE2CHAT o Genesis ID.'), 'Habla con Aura y Antonio en Pulse tu chat o Génesis ai di.');
  assert.equal(hondurenoAVoz('Vamos a SPS.'), 'Vamos a San Pedro Sula.');
  assert.equal(hondurenoAVoz('La ENEE, el RTN, el IHSS y el SAR.'), 'La e ene e e, el erre te ene, el i hache ese ese y el ese a erre.');
  assert.equal(afinarParaBocaIngles('Talk to ANT-ONIO in SPS.'), 'Talk to Antonio in San Pedro Sula.');
});

test('nunca toca enlaces, correos ni códigos', () => {
  const t = 'Mira https://x.hn/05/10/2026?h=3:00 y PL-0087-2019, el A1B2C3 y jose.2550-1234@correo.hn.';
  assert.equal(hondurenoAVoz(t), t);
});

test('todas las superficies: afinarParaBoca lo aplica, con cifras para Kokoro y sin ellas para ElevenLabs', () => {
  assert.equal(afinarParaBoca('La cita es el 05/10 a las 3:00 p. m., son L. 1,500.', 1200, { cifras: false }), 'La cita es el 5 de octubre a las tres de la tarde, son mil quinientos lempiras.');
  assert.equal(afinarParaBoca('La cita es el 05/10 a las 3:00 p. m.'), 'La cita es el cinco de octubre a las tres de la tarde.');
});
