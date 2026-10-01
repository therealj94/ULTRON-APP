/** Los interruptores de la voz (lib/interruptores.ts): sin tocar nada, nada cambia; solo valores válidos. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { POR_OMISION, _reiniciarInterruptores, fijarInterruptores, interruptor, todosLosInterruptores, validar } from '../lib/interruptores';
import { GRACIA_REINTENTO_MS, PUENTE_VOZ_MS } from '../server/voz-agente';

test('por omisión, los valores de siempre (los mismos que las constantes de la voz)', () => {
  _reiniciarInterruptores();
  assert.equal(interruptor('graciaReintentoMs'), GRACIA_REINTENTO_MS);
  assert.equal(interruptor('puenteVozMs'), PUENTE_VOZ_MS);
  assert.equal(interruptor('modeloChico'), true);
  assert.equal(interruptor('vozCompacta'), true);
});

test('solo claves conocidas, del tipo correcto y en su rango', () => {
  assert.deepEqual(validar({ modeloChico: false, vozCompacta: 'no', inventado: 1, graciaReintentoMs: 99_999, puenteVozMs: 2000.4 }), { modeloChico: false, puenteVozMs: 2000 });
  assert.deepEqual(validar(null), {});
  // El puente nunca pasa del corte de ElevenLabs (4 s) menos un margen.
  assert.deepEqual(validar({ puenteVozMs: 3_900 }), {});
});

test('sin S3 se cambian en el proceso y dicen qué se descartó', async () => {
  _reiniciarInterruptores();
  const r = await fijarInterruptores({ modeloChico: false, graciaReintentoMs: -5 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.descartados, ['graciaReintentoMs']);
  assert.equal(interruptor('modeloChico'), false);
  assert.deepEqual(todosLosInterruptores(), { ...POR_OMISION, modeloChico: false });
  _reiniciarInterruptores();
});
