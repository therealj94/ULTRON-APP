/**
 * Hablarle encima a Dr Electrum como a AU-RA (src-electrum/panel/interrumpir.ts): su eco y un «ajá» no lo
 * cortan; un «espera», una orden de pantalla o dos palabras de la persona, sí. Y lo que el transcriptor
 * inventa sobre el silencio no llega a la mesa.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decidirEncima,
  dudaEncima,
  esAsentimiento,
  filtrarAlucinacion,
  textoDeInterrupcion,
  veredictoEncima,
  VigiaTurbo,
  FALLOS_TURBO,
} from '../src-electrum/panel/interrumpir';
import { comandoDe } from '../src-electrum/panel/comandos';

const DICE = ['Los Chaguites tiene 478 hectáreas y vence el primero de diciembre, con traslape en la reserva.'];
const esOrden = (t: string) => !!comandoDe(t);

test('asentir no es interrumpir: ajá, mjm, sí sí, ok', () => {
  for (const t of ['Ajá.', 'mjm', 'Sí, sí.', 'ok', 'Ah, ok', 'uh-huh', 'claro', 'Mmm.']) assert.equal(esAsentimiento(t), true, t);
  for (const t of ['espera', 'sí pero de Olancho', 'ok muéstrame el mapa', '']) assert.equal(esAsentimiento(t), false, t);
});

test('lo que el transcriptor inventa sobre el silencio se tira', () => {
  for (const t of [
    'Subtítulos realizados por la comunidad de Amara.org',
    'Gracias por ver el video.',
    '¡Suscríbete!',
    'Thanks for watching!',
    '[Música]',
    '♪ ♪',
    'Música.',
    'la la la la la la la la',
    '...',
  ]) {
    assert.equal(filtrarAlucinacion(t), '', t);
  }
  // Lo de una persona pasa, sin comillas que lo envuelvan.
  assert.equal(filtrarAlucinacion('«¿Cuándo vence Los Chaguites?»'), '¿Cuándo vence Los Chaguites?');
  assert.equal(filtrarAlucinacion('gracias'), 'gracias');
});

test('su propio eco no lo corta', () => {
  assert.equal(veredictoEncima('478 hectáreas y vence el primero', DICE, esOrden), 'eco');
  assert.equal(veredictoEncima('traslape en la reserva', DICE, esOrden), 'eco');
  // Ni una muletilla, ni la muletilla con su eco.
  assert.equal(veredictoEncima('ajá', DICE, esOrden), 'asentir');
  assert.equal(veredictoEncima('sí sí', DICE, esOrden), 'asentir');
  assert.equal(veredictoEncima('ok diciembre', DICE, esOrden), 'eco');
  assert.equal(veredictoEncima('', DICE, esOrden), 'vacio');
  assert.equal(veredictoEncima('Subtítulos realizados por la comunidad de Amara.org', DICE, esOrden), 'vacio');
});

test('la persona sí lo corta: un freno, una orden de pantalla o dos palabras suyas', () => {
  assert.equal(veredictoEncima('espera', DICE, esOrden), 'real');
  assert.equal(veredictoEncima('para', DICE, esOrden), 'real');
  assert.equal(veredictoEncima('siguiente', DICE, esOrden), 'real');
  assert.equal(veredictoEncima('acércate', DICE, esOrden), 'real');
  assert.equal(veredictoEncima('mejor dime la de Olancho', DICE, esOrden), 'real');
  // Sin la orden de pantalla, «siguiente» sola es una palabra: no alcanza.
  assert.equal(veredictoEncima('siguiente', DICE), 'eco');
  // Una orden que es eco de lo que él dice no lo corta.
  assert.equal(veredictoEncima('siguiente', ['La siguiente parada es Juticalpa.'], esOrden), 'eco');
});

test('bajar la voz mientras se confirma: solo si hay algo que no es eco ni muletilla', () => {
  assert.equal(dudaEncima('mejor', DICE), true);
  assert.equal(dudaEncima('ajá', DICE), false);
  assert.equal(dudaEncima('hectáreas', DICE), false);
  assert.equal(dudaEncima('Gracias por ver', DICE), false);
});

test('la frase de quien interrumpe va sin el eco con que empezó', () => {
  assert.equal(textoDeInterrupcion('vence el primero de diciembre espera mejor dime la de Olancho', DICE), 'Espera mejor dime la de Olancho');
  assert.equal(textoDeInterrupcion('dime la de Olancho', DICE), 'dime la de Olancho');
});

test('decidirEncima avisa a la voz: sigue si era eco, se calla si era la persona', () => {
  const avisos: string[] = [];
  const op = {
    dichos: () => DICE,
    esOrden,
    alSeguir: () => avisos.push('seguir'),
    alInterrumpir: () => avisos.push('callar'),
  };
  assert.equal(decidirEncima('ajá', op, null), '');
  assert.equal(decidirEncima('478 hectáreas', op, null), '');
  assert.deepEqual(avisos, ['seguir', 'seguir']);
  assert.equal(decidirEncima('vence el primero de diciembre espera mejor dime la de Olancho', op, null), 'Espera mejor dime la de Olancho');
  assert.deepEqual(avisos, ['seguir', 'seguir', 'callar']);
  // Ya se calló por un parcial: no avisa otra vez, solo limpia el eco.
  assert.equal(decidirEncima('mejor dime la de Olancho', op, DICE), 'mejor dime la de Olancho');
  assert.equal(avisos.length, 3);
  // Con «Interrumpir» apagado, nada lo corta.
  assert.equal(decidirEncima('espera', { ...op, interrumpible: () => false }, null), '');
  assert.equal(avisos.at(-1), 'seguir');
});

test('el en vivo se rinde a los tres fallos seguidos y vuelve a contar desde cero', () => {
  let rendido = 0;
  const v = new VigiaTurbo(() => rendido++);
  v.fallo();
  v.fallo();
  v.exito();
  v.fallo();
  v.fallo();
  assert.equal(rendido, 0);
  v.fallo();
  assert.equal(rendido, 1);
  assert.equal(v.cuenta, 0);
  for (let i = 0; i < FALLOS_TURBO; i++) v.fallo();
  assert.equal(rendido, 2);
});
