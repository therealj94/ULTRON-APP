/**
 * La app de AU-RA tiene tres avatares y cada uno suena distinto (server/eleven.ts): AU-RA sigue con
 * Voicebox, los dos Claudio con su voz de ElevenLabs. Un avatar desconocido nunca cambia la voz.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lineaAvatar, normalizarAvatar, vozEleven, VOZ_CLAUDIO_ELEVEN, VOZ_CLAUDIO_PIE_ELEVEN, VOZ_ELECTRUM_ELEVEN } from '../server/eleven';

test('avatar: solo los tres conocidos; cualquier otra cosa es AU-RA', () => {
  assert.equal(normalizarAvatar('claudio'), 'claudio');
  assert.equal(normalizarAvatar(' CLAUDIO-PIE '), 'claudio-pie');
  assert.equal(normalizarAvatar(undefined), 'aura');
  assert.equal(normalizarAvatar('electrum'), 'aura');
  assert.equal(normalizarAvatar(['claudio']), 'aura');
});

test('voz por avatar: tres voces distintas y Dr Electrum no cambia', () => {
  const claves = ['ELEVENLABS_VOZ_AURA', 'ELEVENLABS_VOZ_CLAUDIO', 'ELEVENLABS_VOZ_CLAUDIO_PIE', 'ELEVENLABS_VOZ_ELECTRUM'] as const;
  const antes = Object.fromEntries(claves.map((k) => [k, process.env[k]]));
  for (const k of claves) delete process.env[k];
  try {
    assert.equal(vozEleven('ultron', 'aura'), null);
    assert.equal(vozEleven('ultron', 'claudio'), VOZ_CLAUDIO_ELEVEN);
    assert.equal(vozEleven('ultron', 'claudio-pie'), VOZ_CLAUDIO_PIE_ELEVEN);
    assert.notEqual(VOZ_CLAUDIO_ELEVEN, VOZ_CLAUDIO_PIE_ELEVEN);
    // El avatar es cosa de la app de AU-RA: al doctor no le cambia la voz.
    assert.equal(vozEleven('electrum', 'claudio'), VOZ_ELECTRUM_ELEVEN);
    process.env.ELEVENLABS_VOZ_CLAUDIO = 'otra';
    assert.equal(vozEleven('ultron', 'claudio'), 'otra');
  } finally {
    for (const k of claves) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
  }
});

test('el cerebro sabe que habla como Claudio; con AU-RA el prompt no cambia', () => {
  assert.equal(lineaAvatar('aura'), '');
  assert.match(lineaAvatar('claudio'), /Te llamas Claudio, no AU-RA/);
  assert.match(lineaAvatar('claudio-pie'), /cuerpo entero/);
  assert.ok(lineaAvatar('claudio').length < 400);
});
