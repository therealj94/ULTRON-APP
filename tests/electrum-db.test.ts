/**
 * Catastro en PostGIS, contra una base de verdad.
 *
 * Estas pruebas necesitan un PostgreSQL con PostGIS. Sin ELECTRUM_DB_URL se saltan, porque no vale
 * la pena tumbar el CI por una dependencia de infraestructura; lo que NO se hace es fingir que
 * pasaron. Para correrlas:
 *
 *   ELECTRUM_DB_URL=postgres://usuario@host:5432/electrum npx tsx --test tests/electrum-db.test.ts
 *
 * Lo que de verdad comprueban: que PostGIS y el motor GIS de TypeScript dan el MISMO número. Son
 * dos implementaciones independientes del área geodésica —ST_Area sobre geography por un lado, la
 * esfera autálica de Snyder por el otro—; si coinciden hasta el centésimo de hectárea, las dos están
 * bien. Si un día alguien rompe una, la otra lo delata.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { areaHectareas, ingerir, traslapesEnCapa } from '../server/electrum/gis';
import {
  buscarConcesiones,
  capaGeojson,
  cerrarBase,
  cercaDe,
  concesionEnPunto,
  consulta,
  geometriaDe,
  guardarCapa,
  hayBase,
  recalcularTraslapes,
  saludBase,
  traslapes,
} from '../server/electrum/db';

const HAY = hayBase();
const cerca = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} no está cerca de ${b} (±${tol})`);

test('catastro en PostGIS', { skip: HAY ? false : 'sin ELECTRUM_DB_URL: no hay base contra la que probar' }, async (t) => {
  const zip = fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'gis', 'catastro.zip'));
  const { capa, avisos } = await ingerir('catastro.zip', zip);
  assert.ok(capa);

  // Base limpia: estas pruebas mandan sobre su propio contenido.
  await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
  const carga = await guardarCapa(capa!, { avisos, subidoPor: 'pruebas' });

  await t.test('la base está viva y con PostGIS', async () => {
    const s = await saludBase();
    assert.equal(s.viva, true, s.motivo);
    assert.match(String(s.postgis), /^3\./);
    assert.equal(s.concesiones, 2);
  });

  await t.test('entran las dos concesiones con sus campos del .dbf', async () => {
    assert.equal(carga.concesiones, 2);
    const filas = await consulta<{ nombre: string; expediente: string; titular: string }>(
      'SELECT nombre, expediente, titular FROM concesion ORDER BY id'
    );
    assert.deepEqual(filas.map((f) => f.expediente), ['EXP-2021-0442', 'EXP-2019-0118']);
    assert.equal(filas[0].nombre, 'Quebrada Seca');
    assert.match(filas[1].titular, /Andina/);
  });

  await t.test('PostGIS y el motor de TypeScript miden lo mismo', async () => {
    const [fila] = await consulta<{ guardada: number; postgis: number }>(
      `SELECT hectareas::float8 AS guardada, ha_elipsoide(geom)::float8 AS postgis
       FROM concesion ORDER BY id LIMIT 1`
    );
    const enTs = areaHectareas(capa!.geojson.features[0]);
    // Dos implementaciones independientes del área geodésica: tienen que coincidir.
    cerca(fila.postgis, enTs, 0.01);
    cerca(fila.guardada, enTs, 0.0001);
    cerca(fila.postgis, 400.3, 0.4);
  });

  await t.test('guarda el área declarada aparte, para poder contrastarla', async () => {
    const [f] = await consulta<{ dec: number; med: number }>(
      'SELECT hectareas_dec::float8 AS dec, hectareas::float8 AS med FROM concesion ORDER BY id LIMIT 1'
    );
    assert.equal(f.dec, 400);
    assert.ok(f.med > f.dec, 'la medida sobre el elipsoide debe ser mayor que la declarada en la cuadrícula');
  });

  await t.test('guarda los atributos originales completos', async () => {
    const [f] = await consulta<{ a: any }>('SELECT atributos AS a FROM concesion ORDER BY id LIMIT 1');
    assert.equal(f.a.EXPEDIENTE, 'EXP-2021-0442');
    assert.equal(f.a.HECTAREAS, 400);
  });

  await t.test('el traslape que calcula la base coincide con el del motor', async () => {
    const n = await recalcularTraslapes();
    assert.equal(n, 1);
    const [t1] = await traslapes();
    assert.equal(t1.a, 'Quebrada Seca');
    assert.equal(t1.b, 'Cerro Partido');
    cerca(t1.hectareas, traslapesEnCapa(capa!)[0].hectareas, 0.01);
    cerca(t1.hectareas, 100.07, 0.2);
  });

  await t.test('búsqueda tolerante: encuentra aunque esté mal escrito', async () => {
    const r = await buscarConcesiones('Quebrda Seca');
    assert.ok(r.length, 'debería encontrar Quebrada Seca con un error de tecleo');
    assert.equal(r[0].nombre, 'Quebrada Seca');
  });

  await t.test('búsqueda por titular y por expediente exacto', async () => {
    assert.ok((await buscarConcesiones('Andina')).some((c) => c.nombre === 'Cerro Partido'));
    const porExp = await buscarConcesiones('EXP-2019-0118');
    assert.equal(porExp[0].nombre, 'Cerro Partido');
  });

  await t.test('qué concesión cubre este punto', async () => {
    const g = await geometriaDe(1);
    assert.ok(g);
    const [lon, lat] = g!.centro;
    const aqui = await concesionEnPunto(lon, lat);
    assert.ok(aqui.some((c) => c.nombre === 'Quebrada Seca'));
    assert.equal((await concesionEnPunto(-87.9, 14.9)).length, 0);
  });

  await t.test('qué hay cerca, medido sobre el elipsoide', async () => {
    const g = await geometriaDe(1);
    const [lon, lat] = g!.centro;
    const cercanas = await cercaDe(lon, lat, 5);
    assert.equal(cercanas.length, 2, 'las dos están a menos de cinco kilómetros');
    assert.ok(cercanas[0].km < cercanas[1].km, 'deben venir ordenadas por distancia');
    assert.equal(cercanas[0].km, 0, 'la que contiene al punto está a cero');
  });

  await t.test('la capa sale como GeoJSON lista para el mapa', async () => {
    const fc = await capaGeojson(carga.capaId);
    assert.equal(fc.type, 'FeatureCollection');
    assert.equal(fc.features.length, 2);
    assert.equal((fc.features[0].properties as any).nombre, 'Quebrada Seca');
    assert.ok((fc.features[0].geometry as any).coordinates.length);
  });

  await t.test('el encuadre sirve para volar el mapa', async () => {
    const g = await geometriaDe(1);
    const [o, s, e, n] = g!.encuadre;
    assert.ok(o < e && s < n);
    cerca(s, 14.02, 0.05);
  });

  t.after(async () => {
    await cerrarBase();
  });
});
