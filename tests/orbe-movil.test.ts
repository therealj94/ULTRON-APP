/**
 * El orbe que va dentro de la app es el mismo de src/14-orbe (el que aprobó José), trae su puente con
 * la app y no depende de la red.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DESTINO, generar } from '../scripts/orbe-movil.mjs';

test('el orbe del teléfono está al día con src/14-orbe', () => {
  assert.ok(fs.readFileSync(DESTINO, 'utf8') === generar(), 'mobile/src/orbe/orbeHtml.ts desactualizado: corre `node scripts/orbe-movil.mjs`');
});

test('el orbe trae su puente, sus sonidos y no carga nada de fuera', () => {
  const html = fs.readFileSync(DESTINO, 'utf8');
  assert.match(html, /window.__aura = handle/);
  assert.match(html, /ReactNativeWebView/);
  assert.match(html, /__orbeOpciones/);
  assert.match(html, /case 'sonido'/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.doesNotMatch(html, /<link[^>]+href=["']https?:/);
});
