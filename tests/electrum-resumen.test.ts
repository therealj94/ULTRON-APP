/**
 * «¿Cuántas concesiones hay?» tiene que tener una cifra: la del tablero, la misma que ve la pantalla.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { MANOS, manosDe } = await import('../server/electrum/manos');
const { ESPECIALISTAS, convocar, herramientasDe } = await import('../server/electrum/especialistas');
const { consulta, hayBase } = await import('../server/electrum/db');

test('catastro_resumen: está registrada y sin base lo dice', async () => {
  assert.ok(MANOS.catastro_resumen);
  assert.equal(manosDe(['catastro_resumen']).length, 1);
  if (!hayBase()) {
    const r = await MANOS.catastro_resumen.ejecutar({}, {} as never);
    assert.equal(r.ok, false);
  }
  const conResumen = ESPECIALISTAS.filter((p) => p.herramientas.includes('catastro_resumen')).map((p) => p.id);
  assert.ok(conResumen.length >= 3, conResumen.join(','));
  // La pregunta de la presentación llega a un panel que la tiene.
  assert.ok(herramientasDe(convocar('¿Cuántas concesiones hay en el catastro?')).includes('catastro_resumen'));
});

test('catastro_resumen: la cifra es la del catastro', { skip: hayBase() ? false : 'sin ELECTRUM_DB_URL' }, async () => {
  const [{ n }] = await consulta<{ n: number }>(`SELECT count(*)::int AS n FROM concesion`);
  const r = await MANOS.catastro_resumen.ejecutar({}, {} as never);
  assert.equal(r.ok, true);
  const cifra = Number(String(r.texto).match(/El catastro tiene ([\d.\s ]+) concesiones/)?.[1].replace(/\D/g, ''));
  assert.equal(cifra, n, r.texto);
  assert.match(r.texto, /Traslapes: /);
  assert.match(r.texto, /Prospectividad|prospectividad/);
});
