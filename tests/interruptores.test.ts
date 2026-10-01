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

test('con S3, guardar uno recién arrancado no borra los demás ya guardados (Codex, PR #102)', async () => {
  const guardado: Record<string, unknown> = { modeloChico: false, graciaReintentoMs: 1_200 };
  let puesto: Record<string, unknown> | null = null;
  _reiniciarInterruptores({
    listo: () => true,
    leer: async () => ({ ok: true, json: { ...guardado }, detalle: '' }),
    guardar: async (_k: string, j: unknown) => {
      puesto = j as Record<string, unknown>;
      return { ok: true, detalle: '' };
    },
  });
  // El proceso todavía tiene solo los valores por omisión (no leyó S3).
  assert.equal(interruptor('modeloChico'), true);
  const r = await fijarInterruptores({ puenteVozMs: 0 });
  assert.equal(r.ok, true);
  assert.deepEqual(puesto, { modeloChico: false, graciaReintentoMs: 1_200, puenteVozMs: 0 }, 'lo guardado sigue, más el cambio');
  assert.equal(interruptor('modeloChico'), false);
  assert.equal(interruptor('puenteVozMs'), 0);
  _reiniciarInterruptores();
});

test('con S3, si no se puede leer lo guardado no se escribe nada', async () => {
  let escrito = false;
  _reiniciarInterruptores({
    listo: () => true,
    leer: async () => ({ ok: false, json: null, detalle: 'red' }),
    guardar: async () => {
      escrito = true;
      return { ok: true, detalle: '' };
    },
  });
  const r = await fijarInterruptores({ puenteVozMs: 0 });
  assert.equal(r.ok, false);
  assert.equal(escrito, false);
  assert.equal(interruptor('puenteVozMs'), POR_OMISION.puenteVozMs);
  _reiniciarInterruptores();
});

test('el interruptor de confirmar acciones de la voz: 1 s por omisión, entre 0 y 5 s', () => {
  assert.equal(POR_OMISION.confirmarAccionVozMs, 1_000);
  assert.deepEqual(validar({ confirmarAccionVozMs: 6_000 }), {});
  assert.deepEqual(validar({ confirmarAccionVozMs: 0 }), { confirmarAccionVozMs: 0 });
});
