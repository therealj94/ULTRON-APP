/**
 * El oído Turbo de la web (src/03-voz/oidoTurbo.ts y useOido.ts): de las muestras del micrófono del
 * navegador al trozo PCM que entiende Turbo, y cuándo lo que se entiende cuenta como hablarle encima.
 * El navegador de verdad (Chromium con micrófono simulado y Turbo en vivo) se probó aparte.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { trozoDeMuestras, turboWebPosible } from '../src/03-voz/oidoTurbo';
import { esInterrupcion } from '../src/03-voz/useOido';

describe('Oído Turbo (web)', () => {
  it('las muestras del navegador salen en PCM 16 bits little-endian, con su volumen', () => {
    const f = new Float32Array(1600);
    f[0] = 1;
    f[1] = -1;
    f[2] = 0.5;
    const t = trozoDeMuestras(f);
    const b = Buffer.from(t.audio, 'base64');
    assert.equal(b.length, 3200);
    assert.equal(b.readInt16LE(0), 32767);
    assert.equal(b.readInt16LE(2), -32768);
    assert.equal(b.readInt16LE(4), 16384);
    assert.ok(t.db > -40 && t.db < -10, `volumen razonable (${t.db.toFixed(1)} dBFS)`);
    assert.equal(trozoDeMuestras(new Float32Array(1600)).db, -100, 'silencio');
    const seno = Float32Array.from({ length: 1600 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 16000));
    assert.ok(Math.abs(trozoDeMuestras(seno).db - -9) < 0.5, 'un seno a media escala da ~-9 dBFS');
  });

  it('hablarle encima: hace falta entender dos palabras (un «eh» o el eco de una sílaba no corta su voz)', () => {
    assert.equal(esInterrupcion('eh'), false);
    assert.equal(esInterrupcion('Oye.'), false);
    assert.equal(esInterrupcion('¿Me-'), false);
    assert.equal(esInterrupcion('Oye, Aura'), true);
    assert.equal(esInterrupcion('espera un momento'), true);
  });

  it('en Node no hay micrófono: no se intenta Turbo (la web usaría el respaldo)', () => {
    assert.equal(turboWebPosible(), false);
  });
});
