/**
 * Auditoría H03 y H12: un documento entra entero o no entra, y repetir la carga no borra los avisos.
 * Se fuerza el fallo del segundo lote de fragmentos con un trigger de PostgreSQL. Necesita PostGIS
 * (ELECTRUM_DB_URL); sin base, se salta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { aprender } from '../server/electrum/aprender';
import { cerrarBase, consulta, hayBase } from '../server/electrum/db';

const HAY = hayBase();

/** Un texto largo: más de 200 fragmentos, para que haya segundo lote. */
function textoLargo(): Buffer {
  const parrafos = Array.from({ length: 900 }, (_, i) => `Párrafo ${i}: la concesión Quebrada Seca reporta leyes de oro en la veta principal, con muestreo de canal y control de calidad. `.repeat(3));
  return Buffer.from(parrafos.join('\n\n'), 'utf8');
}

test('ingesta atómica', { skip: HAY ? false : 'sin ELECTRUM_DB_URL: no hay base contra la que probar' }, async (t) => {
  await consulta('TRUNCATE fragmento, documento RESTART IDENTITY CASCADE');
  const datos = textoLargo();
  const nombre = 'informe-largo.txt';

  await t.test('si falla el segundo lote, no queda ningún documento a medias', async () => {
    await consulta(`CREATE OR REPLACE FUNCTION romper_segundo_lote() RETURNS trigger AS $$
      BEGIN IF NEW.orden >= 200 THEN RAISE EXCEPTION 'fallo inyectado en el segundo lote'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await consulta(`CREATE TRIGGER romper_segundo_lote BEFORE INSERT ON fragmento FOR EACH ROW EXECUTE FUNCTION romper_segundo_lote()`);
    try {
      await assert.rejects(() => aprender(nombre, datos, { subidoPor: 'pruebas' }), /fallo inyectado/);
      const [{ d }] = await consulta<{ d: number }>(`SELECT count(*)::int AS d FROM documento`);
      const [{ f }] = await consulta<{ f: number }>(`SELECT count(*)::int AS f FROM fragmento`);
      assert.equal(d, 0, 'ni el documento');
      assert.equal(f, 0, 'ni el primer lote');
    } finally {
      await consulta(`DROP TRIGGER IF EXISTS romper_segundo_lote ON fragmento`);
    }
  });

  let total = 0;
  await t.test('al reintentar entra entero, con el último fragmento buscable', async () => {
    const r = await aprender(nombre, datos, { subidoPor: 'pruebas' });
    assert.equal(r.clase, 'documento');
    const [{ n, m }] = await consulta<{ n: number; m: number }>(
      `SELECT count(*)::int AS n, (SELECT (meta->>'fragmentos')::int FROM documento LIMIT 1) AS m FROM fragmento`
    );
    assert.ok(n > 200, `hacen falta más de 200 fragmentos, hay ${n}`);
    assert.equal(n, m, 'los fragmentos guardados son los esperados');
    total = n;
    const [ultimo] = await consulta<{ texto: string }>(`SELECT texto FROM fragmento ORDER BY orden DESC LIMIT 1`);
    assert.match(ultimo.texto, /Párrafo 899/);
  });

  await t.test('uno que quedó a medias antes de esto se recarga en vez de darse por cargado', async () => {
    // Simula una carga vieja cortada: se borra la mitad de los fragmentos.
    await consulta(`DELETE FROM fragmento WHERE orden >= 100`);
    const r = await aprender(nombre, datos, { subidoPor: 'pruebas' });
    assert.equal(r.clase, 'documento');
    assert.doesNotMatch(r.dicho, /ya estaba/);
    const [{ n }] = await consulta<{ n: number }>(`SELECT count(*)::int AS n FROM fragmento`);
    assert.equal(n, total);
    const [{ d }] = await consulta<{ d: number }>(`SELECT count(*)::int AS d FROM documento`);
    assert.equal(d, 1, 'sin duplicar el documento');
  });

  await t.test('repetir la carga dice «ya estaba» y conserva los avisos de la lectura', async () => {
    await consulta(`UPDATE documento SET meta = jsonb_set(meta, '{avisos}', '[{"nivel":"ojo","texto":"páginas aproximadas"}]'::jsonb)`);
    const r = await aprender(nombre, datos, { subidoPor: 'pruebas' });
    assert.match(r.dicho, /ya estaba/);
    assert.deepEqual(r.avisos, [{ nivel: 'ojo', texto: 'páginas aproximadas' }]);
  });

  await consulta('TRUNCATE fragmento, documento RESTART IDENTITY CASCADE');
  await cerrarBase();
});
