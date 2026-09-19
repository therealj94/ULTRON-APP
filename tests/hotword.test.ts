import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { esBasuraStt, hayHotword, quitarHotword, SKIP_HOTWORD_MS } from '../src/03-voz/hotword';

describe('Loop Jarvis / hotword', () => {
  it('reconoce oye/hey/ok ultron', () => {
    assert.equal(hayHotword('oye Ultron'), true);
    assert.equal(hayHotword('hey ultron precio del oro'), true);
    assert.equal(hayHotword('ok ultron'), true);
    assert.equal(hayHotword('precio del oro'), false);
  });

  it('no corta Orden Global ni «qué hora es»', () => {
    assert.equal(esBasuraStt('Orden Global'), false);
    assert.equal(esBasuraStt('qué hora es'), false);
    assert.equal(esBasuraStt('la hora'), true);
    assert.equal(esBasuraStt('eh'), true);
  });

  it('quita la hotword y deja el comando', () => {
    assert.equal(quitarHotword('oye Ultron, qué hora es'), 'qué hora es');
    assert.equal(SKIP_HOTWORD_MS, 20_000);
  });
});
