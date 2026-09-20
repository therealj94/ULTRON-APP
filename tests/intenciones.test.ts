import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectarIntencion } from '../src/04-cerebro/intenciones';

test('frases normales van al cerebro aunque contengan palabras gatillo', () => {
  for (const f of [
    'para mañana necesito el informe de la mina',
    'me encanta la experiencia del equipo',
    'quiero saber más del oro',
    'dame opciones de inversión',
    'la visión de la empresa es clara',
    'dime ahora el precio del oro',
    'una alerta de precio para la plata',
  ]) {
    assert.equal(detectarIntencion(f).tipo, 'cerebro', f);
  }
});

test('gags cortos sí se resuelven en local', () => {
  assert.equal(detectarIntencion('para').tipo, 'callar');
  assert.equal(detectarIntencion('contame un chiste').tipo, 'chiste');
  assert.equal(detectarIntencion('canta quiero conocer a Jesús').tipo, 'cantar');
  assert.equal(detectarIntencion('cantá way maker').tipo, 'cantar');
  for (const f of ['orá por el día', 'hacé una oración', 'oremos', 'bendice nuestro día', 'una oración por hoy']) assert.equal(detectarIntencion(f).tipo, 'orar', f);
  assert.equal(detectarIntencion('la oración de la escritura dice que…').tipo, 'cerebro');
  assert.equal(detectarIntencion('¿quién sos?').tipo, 'clip');
  assert.equal(detectarIntencion('qué podés hacer').tipo, 'capacidades');
  assert.equal(detectarIntencion('modo oro').tipo, 'modo');
  assert.equal(detectarIntencion('recordá que la villa va al setenta por ciento').tipo, 'recordar');
  assert.equal(detectarIntencion('actualiza el cerebro').tipo, 'genesis');
});
