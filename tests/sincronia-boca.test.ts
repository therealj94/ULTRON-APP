/**
 * La boca de los avatares a tiempo con la voz (mobile/src/avatar3d/sincronia.ts): la prueba que mide
 * el desfase boca-audio (< 80 ms) y el cierre al cortar (< 100 ms) corre también con `npm test`, y la
 * cabecera de tiempos del servidor (lib/alineacion.ts) se lee igual en el teléfono.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CABECERA_MAX, cabeceraAlineacion, letrasConTiempos } from '../lib/alineacion';
import { leerAlineacion } from '../mobile/src/avatar3d/sincronia';

test('sincronía boca-voz: desfase < 80 ms y cierre < 100 ms (mesa y conversación)', () => {
  const salida = execFileSync(process.execPath, ['--import', 'tsx', path.join('src/avatar3d/pruebas/sincronia.prueba.mjs')], {
    cwd: path.join(process.cwd(), 'mobile'),
    encoding: 'utf8',
  });
  assert.match(salida, /todo bien/);
});

test('cabecera de tiempos: lo que arma el servidor lo lee el teléfono; sin tiempos o demasiado larga, nada', () => {
  const al = { characters: [...'Sí, ANT-ONIO'], character_start_times_seconds: [...'Sí, ANT-ONIO'].map((_, i) => 0.1 + i * 0.08), character_end_times_seconds: [...'Sí, ANT-ONIO'].map((_, i) => 0.17 + i * 0.08) };
  const leida = leerAlineacion(cabeceraAlineacion(al));
  assert.equal(leida?.chars.join(''), 'Sí, ANT-ONIO');
  assert.equal(leida?.desde[0], 100);
  assert.equal(leida?.dura[3], 70);
  assert.equal(cabeceraAlineacion(null), null);
  assert.equal(cabeceraAlineacion({ characters: 'x' }), null);
  assert.equal(letrasConTiempos({ characters: ['a'], character_start_times_seconds: ['x'], character_end_times_seconds: [1] }), null);
  const largo = 'a'.repeat(CABECERA_MAX);
  const enorme = { characters: [...largo], character_start_times_seconds: [...largo].map((_, i) => i * 0.05), character_end_times_seconds: [...largo].map((_, i) => i * 0.05 + 0.04) };
  assert.equal(cabeceraAlineacion(enorme), null, 'una cabecera enorme no se manda');
});
