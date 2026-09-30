/**
 * El cuerpo 3D de AURA que va dentro de la APK es el de src/12-avatar3d.
 *
 * mobile/src/avatar3d/escenaHtml.ts se genera con scripts/avatar3d-movil.mjs; si alguien toca la
 * escena (o el mapeo que comparte con el teléfono) y no lo regenera, el teléfono se queda con la
 * versión vieja sin que nada lo avise. Esto la vuelve a empaquetar y compara.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DESTINO, generar } from '../scripts/avatar3d-movil.mjs';

test('la escena 3D del teléfono está al día con src/12-avatar3d y mobile/src/avatar3d', async () => {
  const actual = fs.readFileSync(DESTINO, 'utf8');
  assert.ok(actual === (await generar()), 'mobile/src/avatar3d/escenaHtml.ts desactualizado: corre `node scripts/avatar3d-movil.mjs`');
});

test('la escena 3D trae su puente, su decodificador y no depende de la red', () => {
  const actual = fs.readFileSync(DESTINO, 'utf8');
  assert.match(actual, /__avatar/);
  assert.match(actual, /ReactNativeWebView/);
  // El decodificador meshopt va adentro (WebAssembly en base64), no se baja de ningún lado.
  assert.match(actual, /EXT_meshopt_compression/);
  assert.doesNotMatch(actual, /<script[^>]+src=/);
  assert.doesNotMatch(actual, /<link[^>]+href=/);
});
