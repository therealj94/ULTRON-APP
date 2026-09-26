/**
 * Geometrías de verdad contra PostGIS de verdad (hace falta ELECTRUM_DB_URL; VACÍA la base, como
 * tests/electrum-db.test.ts: apuntala a una base de pruebas).
 *
 * Tres fallos que solo se ven con la base delante:
 *
 *  · TODO KML real traía altura en cada vértice («-86.2,14.6,0») y la columna es 2D: la carga se
 *    caía con «Geometry has Z dimension but column does not» y un 500.
 *  · Un lindero cruzado sobre sí mismo entraba tal cual, y el cruce de traslapes del padrón ENTERO
 *    reventaba con «TopologyException» en esa carga y en todas las siguientes, de cualquiera.
 *  · Al subir una concesión se contaban solo los traslapes DENTRO del archivo: una que se come media
 *    de la vecina ya cargada salía con «no se pisa ninguno».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { aprender } from '../server/electrum/aprender';
import { ingerir } from '../server/electrum/gis';
import { manosDe } from '../server/electrum/manos';
import { cerrarBase, consulta, guardarCapa, hayBase, porVencer, recalcularTraslapes, traslapesDeCapa } from '../server/electrum/db';

const HAY = hayBase();

const kml = (nombre: string, titular: string, coords: string) => `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>${nombre}</name>
<ExtendedData><Data name="TITULAR"><value>${titular}</value></Data></ExtendedData>
<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>
</Placemark></Document></kml>`;

const monio = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { NOMBRE: 'Lindero Cruzado', TITULAR: 'Digitalizadora Apurada S.A.' },
      // Un «moño»: los vértices 2 y 3 al revés. Válido para el .shp, no para ST_Intersection.
      geometry: { type: 'Polygon', coordinates: [[[-87.6, 14.5], [-87.58, 14.52], [-87.58, 14.5], [-87.6, 14.52], [-87.6, 14.5]]] },
    },
  ],
};

test('geometrías de verdad en PostGIS', { skip: HAY ? false : 'sin ELECTRUM_DB_URL' }, async (t) => {
  await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');

  await t.test('un KML de Google Earth, con altura en cada vértice, entra', async () => {
    const r = await aprender(
      'lajas.kml',
      Buffer.from(kml('Las Lajas KML', 'Exploraciones Demo', '-86.60,14.00,0 -86.60,14.01,0 -86.59,14.01,0 -86.59,14.00,0 -86.60,14.00,0'))
    );
    assert.equal(r.clase, 'catastro', r.dicho);
    const [f] = await consulta<{ dims: number; ha: number }>(`SELECT ST_NDims(geom) AS dims, hectareas::float8 AS ha FROM concesion WHERE nombre = 'Las Lajas KML'`);
    assert.equal(f.dims, 2);
    assert.ok(Math.abs(f.ha - 119.8) < 1.5, `área ${f.ha}`);
  });

  await t.test('un lindero cruzado se repara al guardar y se avisa', async () => {
    const r = await aprender('monio.geojson', Buffer.from(JSON.stringify(monio)));
    assert.equal(r.clase, 'catastro', r.dicho);
    assert.match(r.dicho, /lindero cruzado sobre sí mismo/);
    const [f] = await consulta<{ valida: boolean; ha: number; postgis: number }>(
      `SELECT ST_IsValid(geom) AS valida, hectareas::float8 AS ha, ha_elipsoide(geom)::float8 AS postgis FROM concesion WHERE nombre = 'Lindero Cruzado'`
    );
    assert.equal(f.valida, true);
    // Dos triángulos de medio cuadrado de 0,02°: la mitad de ~477 ha. El área de un moño sin reparar
    // se anula a sí misma y da cero.
    assert.ok(Math.abs(f.ha - f.postgis) < 0.001, `${f.ha} vs ${f.postgis}`);
    assert.ok(f.ha > 230 && f.ha < 245, `área reparada ${f.ha}`);
  });

  await t.test('el mismo moño otra vez no se duplica: la huella es la de lo reparado', async () => {
    const r = await aprender('monio-otra-vez.geojson', Buffer.from(JSON.stringify(monio)));
    assert.match(r.dicho, /ya estaba cargado/);
    const [{ n }] = await consulta<{ n: number }>(`SELECT count(*)::int AS n FROM concesion WHERE nombre = 'Lindero Cruzado'`);
    assert.equal(n, 1);
  });

  await t.test('con un polígono roto en el padrón, el cruce de traslapes sigue funcionando', async () => {
    // Uno que entró por otro camino (una carga vieja) y que el cruce tiene que tolerar.
    await consulta(
      `INSERT INTO concesion (nombre, titular, geom)
       VALUES ('Roto Viejo', 'X', ST_Multi(ST_GeomFromText('POLYGON((-87.61 14.49,-87.57 14.53,-87.57 14.49,-87.61 14.53,-87.61 14.49))', 4326)))`
    );
    const n = await recalcularTraslapes();
    assert.ok(n >= 1, 'el roto se pisa con el moño reparado y tiene que contarse');
  });

  await t.test('al subir una concesión se cuentan sus traslapes con lo que ya estaba', async () => {
    const r = await aprender(
      'vecina.kml',
      Buffer.from(kml('Vecina Nueva', 'Otra Minera', '-86.595,14.005,0 -86.595,14.015,0 -86.585,14.015,0 -86.585,14.005,0 -86.595,14.005,0'))
    );
    assert.match(r.dicho, /Encontré 1 traslape contando el resto del padrón: Las Lajas KML con Vecina Nueva/);
    const capaId = Number((r.ui as any).capa_id);
    const suyos = await traslapesDeCapa(capaId);
    assert.equal(suyos.length, 1);
    assert.ok(suyos[0].hectareas > 25 && suyos[0].hectareas < 35, `${suyos[0].hectareas} ha`);
  });

  await t.test('guardarCapa informa cuántos reparó', async () => {
    const { capa } = await ingerir('otro-monio.geojson', Buffer.from(JSON.stringify({
      ...monio,
      features: [{ ...monio.features[0], geometry: { type: 'Polygon', coordinates: [[[-85.6, 15.5], [-85.58, 15.52], [-85.58, 15.5], [-85.6, 15.52], [-85.6, 15.5]]] } }],
    })));
    const g = await guardarCapa(capa!, {});
    assert.equal(g.reparadas, 1);
    assert.equal(g.concesiones, 1);
  });

  await t.test('los vencimientos se cuentan en días de Honduras y se dicen en su tiempo', async () => {
    const [{ hoy }] = await consulta<{ hoy: string }>(`SELECT to_char((now() AT TIME ZONE 'America/Tegucigalpa')::date, 'YYYY-MM-DD') AS hoy`);
    await consulta(`UPDATE concesion SET vence = NULL`);
    await consulta(`UPDATE concesion SET vence = $1::date - 10 WHERE nombre = 'Las Lajas KML'`, [hoy]);
    await consulta(`UPDATE concesion SET vence = $1::date WHERE nombre = 'Vecina Nueva'`, [hoy]);
    try {
      const filas = await porVencer(365);
      assert.deepEqual(filas.map((f) => Number(f.dias)), [-10, 0]);
      const r = await manosDe(['catastro_vencimientos'])[0].ejecutar({ dias: 365 }, {} as never);
      assert.match(r.texto, /Las Lajas KML venció hace 10 días/, r.texto);
      assert.match(r.texto, /Vecina Nueva vence hoy/, r.texto);
      assert.doesNotMatch(r.texto, /en -\d+ días/);
    } finally {
      await consulta(`UPDATE concesion SET vence = NULL`);
    }
  });

  t.after(async () => {
    await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
    await cerrarBase();
  });
});
