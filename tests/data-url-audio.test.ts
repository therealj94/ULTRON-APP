/**
 * El dictado de la web manda «data:audio/webm;codecs=opus;base64,…» (Chrome). El parámetro del
 * tipo rompía el corte y el oído contestaba «No me llegó audio» a TODO dictado desde Chrome.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bufferDeCualquier } from '../lib/leer-pdf';
import { decodeDataUrl } from '../server/desk';

const audio = Buffer.alloc(2000, 7);
const b64 = audio.toString('base64');

test('el audio de Chrome, con codecs en el tipo, llega entero', () => {
  for (const url of [`data:audio/webm;codecs=opus;base64,${b64}`, `data:audio/webm;base64,${b64}`, `data:audio/mp4;base64,${b64}`]) {
    const b = bufferDeCualquier(url);
    assert.ok(b && b.equals(audio), url.slice(0, 40));
  }
  // Base64 pelado también.
  assert.ok(bufferDeCualquier(b64)!.equals(audio));
});

test('decodeDataUrl separa el tipo sin sus parámetros', () => {
  const r = decodeDataUrl(`data:audio/webm;codecs=opus;base64,${b64}`, 'audio/wav');
  assert.equal(r.mime, 'audio/webm');
  assert.ok(r.buffer.equals(audio));
  assert.equal(decodeDataUrl(b64, 'audio/wav').mime, 'audio/wav');
});
