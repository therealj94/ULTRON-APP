/**
 * Una consulta lenta la corta la BASE, no solo Node, y la conexión vuelve al pool (revisión de
 * Codex en #38). Contra PostGIS de verdad; sin ELECTRUM_DB_URL se salta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cerrarBase, consulta, consultaConTope, hayBase } from '../server/electrum/db';

test('consultaConTope: la base cancela lo que tarda y el pool queda libre', { skip: hayBase() ? false : 'sin ELECTRUM_DB_URL' }, async () => {
  try {
    const t0 = Date.now();
    await assert.rejects(consultaConTope('SELECT pg_sleep(5)', [], 300), /statement timeout|cancel/i);
    assert.ok(Date.now() - t0 < 2000, 'se cortó en la base, no esperó los 5 s');
    // Más cortes que conexiones tiene el pool (8): si se quedaran tomadas, esto se colgaría.
    await Promise.all(Array.from({ length: 12 }, () => consultaConTope('SELECT pg_sleep(5)', [], 200).catch(() => null)));
    const [f] = await consultaConTope<{ uno: number }>('SELECT 1 AS uno', [], 1000);
    assert.equal(f.uno, 1);
    // Y el tope es de esa transacción: la consulta normal siguiente no lo hereda.
    const [g] = await consulta<{ statement_timeout: string }>('SHOW statement_timeout');
    assert.equal(g.statement_timeout, '0');
  } finally {
    await cerrarBase();
  }
});
