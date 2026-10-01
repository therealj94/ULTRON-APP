/**
 * La barrera de lib/base-de-pruebas.ts: bajo el corredor de pruebas solo se abren bases de pruebas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { exigirBaseDePrueba } from '../lib/base-de-pruebas';

test('bajo el corredor de pruebas, una base de producción no se abre', () => {
  const antes = process.env.BASE_DE_PRUEBAS;
  delete process.env.BASE_DE_PRUEBAS;
  try {
    assert.ok(process.env.NODE_TEST_CONTEXT, 'esta prueba debe correr con --test');
    assert.throws(() => exigirBaseDePrueba('postgres://u:c@db.ejemplo.com:5432/electrum'), /no dice que sea de pruebas/);
    assert.throws(() => exigirBaseDePrueba('no es una url'), /no dice que sea de pruebas/);
    assert.doesNotThrow(() => exigirBaseDePrueba('postgres://electrum:electrum-ci@127.0.0.1:5432/electrum_pruebas'));
    assert.doesNotThrow(() => exigirBaseDePrueba('postgres://u@localhost/catastro_test?sslmode=disable'));
  } finally {
    if (antes === undefined) delete process.env.BASE_DE_PRUEBAS; else process.env.BASE_DE_PRUEBAS = antes;
  }
});

test('BASE_DE_PRUEBAS=si deja usar otra base a propósito', () => {
  const antes = process.env.BASE_DE_PRUEBAS;
  process.env.BASE_DE_PRUEBAS = 'si';
  try {
    assert.doesNotThrow(() => exigirBaseDePrueba('postgres://u:c@db.ejemplo.com:5432/electrum'));
  } finally {
    if (antes === undefined) delete process.env.BASE_DE_PRUEBAS; else process.env.BASE_DE_PRUEBAS = antes;
  }
});
