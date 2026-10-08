/**
 * La voz de la web dice la respuesta ENTERA, en trozos que terminan en fin de frase y con el
 * primero corto para que empiece a sonar enseguida (src-electrum/panel/voz.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { trocearParaVoz } from '../src-electrum/panel/voz';

test('el primer trozo es corto y todos terminan en fin de frase', () => {
  const texto =
    'Los Chaguites tiene 478,12 hectáreas. Vence el 1 de diciembre. ' +
    'Pisa 119 ha del área protegida Reserva de Prueba, el 25 % de la concesión, así que conviene revisar el permiso ambiental antes de cualquier trabajo. ' +
    'La roca es granodiorita del Cretácico, con 2,2 km de fallas dentro. Los indicios son de nivel medio.';
  const t = trocearParaVoz(texto);
  assert.ok(t.length >= 2, JSON.stringify(t));
  assert.ok(t[0].length <= 180, t[0]);
  for (const x of t) assert.match(x, /[.!?;:]$/);
  // No se pierde nada: juntos dicen todo el texto.
  assert.equal(t.join(' ').replace(/\s+/g, ' '), texto.trim());
  // «478,12» y «2,2 km» no se parten.
  assert.ok(t.some((x) => x.includes('478,12 hectáreas')));
});

test('sin marcas de formato ni enlaces, y nada que decir es nada', () => {
  const t = trocearParaVoz('**Resumen**\n- Oro: 4,2 g/t [ver](https://x.y/z).\n- Fuente: https://jica.go.jp/informe');
  assert.equal(t.join(' '), 'Resumen Oro: 4,2 g/t ver. Fuente:');
  assert.deepEqual(trocearParaVoz('   '), []);
});

test('una frase enorme se parte sin pasarse del límite del servidor', () => {
  const larga = Array.from({ length: 120 }, (_, i) => `tramo ${i}`).join(', ') + '.';
  const t = trocearParaVoz(larga);
  assert.ok(t.every((x) => x.length <= 1200), t.map((x) => x.length).join());
  assert.equal(t.join(' ').replace(/\s+/g, ' '), larga);
});

test('con el cortador compartido de AU-RA (src/03-voz/frases.ts): no parte títulos ni cifras', () => {
  const t = trocearParaVoz('El Ing. Pérez midió 1.500 toneladas con 3,4 g/t. El Dr. Gómez lo firmó. Vence el 6 de dic. de 2026.', 30, 30);
  assert.ok(t.some((x) => x.includes('Ing. Pérez midió 1.500 toneladas con 3,4 g/t.')), JSON.stringify(t));
  assert.ok(t.some((x) => x.includes('El Dr. Gómez lo firmó.')), JSON.stringify(t));
  assert.ok(t.some((x) => x.includes('6 de dic. de 2026.')), JSON.stringify(t));
});
