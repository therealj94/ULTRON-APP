/**
 * «Este año» y «el año que viene» son años calendario de Honduras, con principio y fin: el año que
 * viene no trae lo ya vencido ni lo de este año. Contra PostGIS (ELECTRUM_DB_URL; VACÍA el catastro).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { consulta, hayBase, vencenEnAnio } from '../server/electrum/db';
import { MANOS } from '../server/electrum/manos';

test('vencimientos por año calendario', { skip: hayBase() ? false : 'sin ELECTRUM_DB_URL' }, async () => {
  await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
  const hoy = `(now() AT TIME ZONE 'America/Tegucigalpa')::date`;
  const anio = `extract(year FROM ${hoy})::int`;
  await consulta(`INSERT INTO concesion (nombre, vence, geom) SELECT n, v, ST_Multi(ST_MakeEnvelope(-87, 14, -86.99, 14.01, 4326)) FROM (VALUES
    ('Ya vencida', ${hoy} - 30),
    ('Vence hoy', ${hoy}),
    ('Fin de año', make_date(${anio}, 12, 31)),
    ('Enero próximo', make_date(${anio} + 1, 1, 1)),
    ('Diciembre próximo', make_date(${anio} + 1, 12, 31)),
    ('Dentro de dos años', make_date(${anio} + 2, 1, 1))) AS t(n, v)`);
  const este = await vencenEnAnio('este_anio');
  assert.deepEqual(este.filas.map((f) => f.nombre), ['Vence hoy', 'Fin de año']);
  assert.equal(este.total, 2);
  const proximo = await vencenEnAnio('proximo_anio');
  assert.deepEqual(proximo.filas.map((f) => f.nombre), ['Enero próximo', 'Diciembre próximo']);
  // La herramienta lo dice en esas palabras y cuenta aparte lo ya vencido.
  const r = await MANOS.catastro_vencimientos.ejecutar({ periodo: 'proximo_anio' }, {} as never);
  assert.match(r.texto, /^2 vencen el año que viene: Enero próximo/);
  assert.match(r.texto, /1 ya está vencida/);
});
