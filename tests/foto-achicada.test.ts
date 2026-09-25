/**
 * «¿Qué ves en esta foto?» manda la foto que se tomó, no un cuadro en vivo. Antes de viajar al
 * cerebro se achica a 640 px por el lado largo: esta es la cuenta (la parte pura de grabFrame.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { medidaAchicada } from '../src/04-cerebro/grabFrame';

test('una foto horizontal grande queda en 640 de ancho, con su proporción', () => {
  assert.deepEqual(medidaAchicada(1920, 1080), { w: 640, h: 360 });
});

test('una vertical queda en 640 de alto', () => {
  assert.deepEqual(medidaAchicada(1080, 1920), { w: 360, h: 640 });
});

test('una foto chica no se agranda', () => {
  assert.deepEqual(medidaAchicada(320, 240), { w: 320, h: 240 });
});

test('medidas raras no dan cero ni NaN', () => {
  assert.deepEqual(medidaAchicada(0, 0), { w: 1, h: 1 });
  assert.deepEqual(medidaAchicada(NaN, 500), { w: 1, h: 500 });
  assert.deepEqual(medidaAchicada(4000, 3), { w: 640, h: 1 });
});
