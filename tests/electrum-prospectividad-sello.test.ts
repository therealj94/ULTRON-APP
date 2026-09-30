/**
 * Auditoría H15: un puntaje guardado no dice con qué algoritmo ni con qué datos se calculó. Si se
 * carga geología o muestras nuevas, lo viejo seguía mandando en el mapa y el ranking. Ahora cada
 * fila lleva el sello de sus insumos; si el sello cambió, queda pendiente y no se muestra.
 *
 * Necesita PostGIS (ELECTRUM_DB_URL); sin base, se salta. Datos sintéticos.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cerrarBase, consulta, hayBase } from '../server/electrum/db';
import { puntajesPorConcesion, rankingProspectividad, selloInsumos, VERSION_PROSPECTIVIDAD } from '../server/electrum/prospectividad';

const HAY = hayBase();

test('prospectividad con sello de insumos', { skip: HAY ? false : 'sin ELECTRUM_DB_URL' }, async (t) => {
  await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
  await consulta(`DELETE FROM muestra_geoquimica`).catch(() => {});
  const [{ id }] = await consulta<{ id: number }>(
    `INSERT INTO concesion (nombre, geom) VALUES ('Cerro Sello', ST_Multi(ST_MakeEnvelope(-87, 14, -86.99, 14.01, 4326))) RETURNING id::int AS id`
  );
  await rankingProspectividad(1); // crea la tabla si falta
  const guardar = async (sello: string) =>
    consulta(
      `INSERT INTO prospectividad_concesion (concesion_id, puntaje, datos) VALUES ($1, 60, $2)
       ON CONFLICT (concesion_id) DO UPDATE SET puntaje = 60, datos = EXCLUDED.datos`,
      [id, JSON.stringify({ puntaje: 60, nivel: 'alta', cobertura: 70, componentes: [], sello })]
    );

  await t.test('el sello nombra la versión del algoritmo', async () => {
    assert.ok((await selloInsumos()).startsWith(`${VERSION_PROSPECTIVIDAD}|`));
  });

  await t.test('con el sello de hoy, cuenta', async () => {
    await guardar(await selloInsumos());
    const r = await rankingProspectividad(5);
    assert.equal(r.ranking.length, 1);
    assert.equal(r.pendientes, 0);
    assert.equal((await puntajesPorConcesion()).get(id), 60);
  });

  await t.test('una fila sin sello (de antes) queda pendiente', async () => {
    await guardar(undefined as unknown as string);
    const r = await rankingProspectividad(5);
    assert.equal(r.ranking.length, 0);
    assert.equal(r.pendientes, 1);
    assert.equal((await puntajesPorConcesion()).has(id), false, 'no se pinta con un puntaje vencido');
  });

  await t.test('cargar una capa geológica vence lo calculado antes', async () => {
    await guardar(await selloInsumos());
    await consulta(`INSERT INTO capa (nombre, formato, origen_crs, rol, entidades) VALUES ('Litología sintética', 'geojson', 'EPSG:4326', 'litologia', 3)`);
    const r = await rankingProspectividad(5);
    assert.equal(r.ranking.length, 0);
    assert.equal(r.pendientes, 1);
  });

  await t.test('cargar muestras también', async () => {
    await guardar(await selloInsumos());
    await consulta(
      `INSERT INTO muestra_geoquimica (codigo, tipo, fuente, utm_e, utm_n, geom, limites) VALUES ('S-1', 'roca', 'sintética', 1, 1, ST_SetSRID(ST_MakePoint(-86.995, 14.005), 4326), '{}'::jsonb)`
    );
    assert.equal((await rankingProspectividad(5)).pendientes, 1);
  });

  await consulta('TRUNCATE concesion, capa RESTART IDENTITY CASCADE');
  await consulta(`DELETE FROM muestra_geoquimica`).catch(() => {});
  await cerrarBase();
});
