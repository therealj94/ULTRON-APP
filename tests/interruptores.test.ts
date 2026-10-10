/** Los interruptores de la voz (lib/interruptores.ts): sin tocar nada, nada cambia; solo valores válidos. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

/*
 * TRAS UN REINICIO (fase 05): antes se leían de forma perezosa y el primer turno corría con los valores por omisión; si S3
 * fallaba, seguían así (un interruptor apagado por la junta volvía a encenderse con cada despliegue). Ahora se precargan
 * al arrancar, con tope; si S3 falla, valen los últimos conocidos de la copia en disco; sin copia, lo peligroso apagado.
 */
const I: Record<string, any> = await import('../lib/interruptores');
const copia = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'interruptores-')), 'interruptores.json');
const conCopia = async (fn: () => Promise<void>) => {
  const antes = process.env.ULTRON_INTERRUPTORES_ARCHIVO;
  process.env.ULTRON_INTERRUPTORES_ARCHIVO = copia;
  try {
    await fn();
  } finally {
    if (antes === undefined) delete process.env.ULTRON_INTERRUPTORES_ARCHIVO;
    else process.env.ULTRON_INTERRUPTORES_ARCHIVO = antes;
    _reiniciarInterruptores();
  }
};
const s3Que = (leer: () => Promise<any>) => ({ listo: () => true, leer, guardar: async () => ({ ok: true, detalle: '' }) });
const arrancar = (o: ReturnType<typeof s3Que>) => (_reiniciarInterruptores as (a: unknown, b?: unknown) => void)(o, { arranque: true });

test('reinicio con S3: la precarga deja lo guardado ANTES del primer turno (no los por omisión)', () =>
  conCopia(async () => {
    fs.rmSync(copia, { force: true });
    arrancar(s3Que(async () => ({ ok: true, json: { modeloChico: false, motorVozCuentas: ['prueba@ejemplo.org'] }, detalle: '' })));
    assert.equal(typeof I.precargarInterruptores, 'function', 'existe la precarga del arranque');
    assert.equal(await I.precargarInterruptores(500), 's3');
    assert.equal(interruptor('modeloChico'), false, 'el primer turno ya lo ve apagado');
    assert.deepEqual(interruptor('motorVozCuentas'), ['prueba@ejemplo.org']);
    assert.ok(fs.existsSync(copia), 'y queda la copia local de los últimos conocidos');
  }));

test('reinicio con S3 caído: valen los últimos conocidos de la copia en disco, no los por omisión', () =>
  conCopia(async () => {
    fs.writeFileSync(copia, JSON.stringify({ ...POR_OMISION, modeloChico: false, puenteVozMs: 0 }));
    arrancar(s3Que(async () => ({ ok: false, json: null, detalle: 'S3 503' })));
    assert.equal(interruptor('modeloChico'), false, 'ya al cargar, antes de la precarga');
    assert.equal(typeof I.precargarInterruptores, 'function');
    assert.equal(await I.precargarInterruptores(500), 'copia');
    assert.equal(interruptor('modeloChico'), false);
    assert.equal(interruptor('puenteVozMs'), 0);
  }));

test('reinicio con S3 colgado: la precarga no espera más que su tope', () =>
  conCopia(async () => {
    fs.writeFileSync(copia, JSON.stringify({ vozCompacta: false }));
    arrancar(s3Que(() => new Promise(() => {})));
    assert.equal(typeof I.precargarInterruptores, 'function');
    const t0 = Date.now();
    assert.equal(await I.precargarInterruptores(60), 'copia');
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(interruptor('vozCompacta'), false);
  }));

test('reinicio con S3 caído y sin copia: lo peligroso encendido por error arranca APAGADO', () =>
  conCopia(async () => {
    fs.rmSync(copia, { force: true });
    arrancar(s3Que(async () => ({ ok: false, json: null, detalle: 'S3 503' })));
    assert.equal(typeof I.precargarInterruptores, 'function');
    assert.equal(await I.precargarInterruptores(500), 'seguro');
    assert.equal(interruptor('modeloChico'), false);
    assert.equal(interruptor('etiquetasVoz'), false);
    assert.deepEqual(interruptor('motorVozCuentas'), []);
    // Lo demás, los de siempre.
    assert.equal(interruptor('graciaReintentoMs'), POR_OMISION.graciaReintentoMs);
  }));
