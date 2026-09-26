/**
 * Los márgenes que tapa el sistema en la app de Dr Electrum (mobile/src/electrum/bordes.ts).
 *
 * Expo 54 dibuja de borde a borde en Android: sin estos márgenes la marca quedaba bajo la hora y
 * la batería, y la caja de la pregunta y «Ir» bajo los botones de navegación. Las cifras son las
 * que da React Native en un teléfono típico (barra de estado 24 dp, navegación de tres botones
 * 48 dp, gestos ~24 dp).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BARRA_NAVEGACION, calcularBordes } from '../mobile/src/electrum/bordes';

const vertical = { width: 360, height: 760 };
const horizontal = { width: 760, height: 360 };

test('fuera de Android no se inventan márgenes', () => {
  for (const os of ['ios', 'web']) {
    assert.deepEqual(calcularBordes({ os, barraEstado: 24, ventana: vertical, pantalla: vertical }), { arriba: 0, abajo: 0, izquierda: 0, derecha: 0 });
  }
});

test('arriba manda la barra de estado que informa React Native (incluye el recorte de la cámara)', () => {
  assert.equal(calcularBordes({ os: 'android', barraEstado: 36.5, ventana: vertical, pantalla: vertical }).arriba, 37);
  // Sin dato, lo típico: mejor 24 de aire que la hora encima de la marca.
  assert.equal(calcularBordes({ os: 'android', barraEstado: undefined, ventana: vertical, pantalla: vertical }).arriba, 24);
  assert.equal(calcularBordes({ os: 'android', barraEstado: 0, ventana: vertical, pantalla: vertical }).arriba, 24);
});

test('Android ≤14: la ventana excluye la barra de navegación y la diferencia la mide', () => {
  // Tres botones: 48 dp.
  assert.deepEqual(calcularBordes({ os: 'android', barraEstado: 24, ventana: vertical, pantalla: { width: 360, height: 808 } }), {
    arriba: 24,
    abajo: 48,
    izquierda: 0,
    derecha: 0,
  });
  // Gestos: la manija ocupa menos y se reserva solo eso.
  assert.equal(calcularBordes({ os: 'android', barraEstado: 24, ventana: vertical, pantalla: { width: 360, height: 784 } }).abajo, 24);
});

test('Android 15+: ventana y pantalla miden igual, y se reserva la barra de tres botones', () => {
  const b = calcularBordes({ os: 'android', barraEstado: 24, ventana: vertical, pantalla: vertical });
  assert.equal(b.abajo, BARRA_NAVEGACION);
  assert.equal(b.izquierda + b.derecha, 0);
});

test('horizontal: la barra se va a un costado y el recorte al otro, así que se aparta de los dos', () => {
  // ≤14 con tres botones: la ventana es 48 más angosta.
  const medido = calcularBordes({ os: 'android', barraEstado: 24, ventana: { width: 712, height: 360 }, pantalla: horizontal });
  assert.deepEqual(medido, { arriba: 24, abajo: 0, izquierda: 48, derecha: 48 });
  // 15+ sin nada que medir: los dos costados y la manija de abajo.
  const sinMedir = calcularBordes({ os: 'android', barraEstado: 24, ventana: horizontal, pantalla: horizontal });
  assert.deepEqual(sinMedir, { arriba: 24, abajo: 16, izquierda: 48, derecha: 48 });
  // Con gestos en ≤14 la manija queda abajo; a los costados, como mínimo el recorte (lo de arriba).
  const gestos = calcularBordes({ os: 'android', barraEstado: 30, ventana: { width: 760, height: 340 }, pantalla: horizontal });
  assert.deepEqual(gestos, { arriba: 30, abajo: 20, izquierda: 30, derecha: 30 });
});

test('una diferencia absurda (ventana partida, multiventana) no se toma por una barra', () => {
  const b = calcularBordes({ os: 'android', barraEstado: 24, ventana: { width: 360, height: 380 }, pantalla: vertical });
  assert.equal(b.abajo, BARRA_NAVEGACION);
});
