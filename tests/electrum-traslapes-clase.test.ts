/**
 * No todo traslape es un pleito. El padrón oficial trae el mismo derecho repetido («Monte Redondo
 * (Embargo)» tres veces, expediente 98, mismo titular) y derechos del mismo dueño que se tocan; solo
 * los de titulares distintos son algo a verificar. El tablero, el chat y el recorrido cuentan así.
 *
 * Necesita PostGIS (ELECTRUM_DB_URL); sin base, se salta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cerrarBase, consulta, fraseTraslapes, hayBase, resumenTraslapes, traslapes } from '../server/electrum/db';
import { tablero } from '../server/electrum/tablero';

const HAY = hayBase();
const nf = (n: number) => String(n);

test('traslapes por clase', { skip: HAY ? false : 'sin ELECTRUM_DB_URL: no hay base contra la que probar' }, async (t) => {
  await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
  const caja = (x: number) => `ST_Multi(ST_MakeEnvelope(${-87 + x}, 14, ${-87 + x + 0.01}, 14.01, 4326))`;
  const ids = await consulta<{ id: number }>(
    `INSERT INTO concesion (nombre, expediente, titular, geom) VALUES
       ('Monte Redondo (Embargo)', '98', 'Five Stars Mining', ${caja(0)}),
       ('Monte Redondo (Embargo)', '98', 'Five Stars Mining', ${caja(0.005)}),
       ('Otro nombre, mismo expediente', '98', 'Five Stars Mining', ${caja(0.002)}),
       ('Finca Vecina', '200', 'Five Stars Mining', ${caja(0.007)}),
       ('La Ajena', '300', 'Otra Empresa', ${caja(0.003)}),
       ('Sin Dueño Conocido', '400', NULL, ${caja(0.004)}),
       ('Otra Sin Dueño', '500', '  ', ${caja(0.0045)})
     RETURNING id::int AS id`
  );
  const [a, b, c, d, e, f, g] = ids.map((r) => r.id);
  const par = (x: number, y: number, ha: number) => consulta(`INSERT INTO traslape (a_id, b_id, hectareas) VALUES ($1, $2, $3)`, [x, y, ha]);
  await par(a, b, 4603); // mismo nombre y expediente: repetido
  await par(a, c, 1000); // mismo expediente, otro nombre: repetido
  await par(b, d, 50); // mismo titular, otro expediente
  await par(a, e, 12); // titulares distintos: a verificar
  await par(f, g, 7); // a las dos les falta el titular: no se sabe si son dueños distintos
  await par(e, f, 3); // una sin titular: tampoco

  await t.test('cada traslape cae en su clase', async () => {
    const r = await resumenTraslapes();
    assert.equal(r.total, 6);
    assert.deepEqual(r.repetidos, { total: 2, hectareas: 5603 });
    assert.deepEqual(r.mismoTitular, { total: 1, hectareas: 50 });
    assert.deepEqual(r.sinTitular, { total: 2, hectareas: 10 });
    assert.deepEqual(r.entreTitulares, { total: 1, hectareas: 12 });
    assert.equal(r.ajenos, 1);
  });

  await t.test('la lista pone primero lo que hay que verificar', async () => {
    const lista = await traslapes(10);
    assert.equal(lista[0].clase, 'entre_titulares');
    assert.equal(lista[0].b, 'La Ajena');
  });

  await t.test('el tablero cuenta como a verificar solo los de titulares distintos', async () => {
    const tab = await tablero({ fresco: true });
    assert.equal(tab.traslapes.total, 6);
    assert.deepEqual(tab.traslapes.sinTitular, { total: 2, hectareas: 10 });
    assert.deepEqual(tab.traslapes.entreTitulares, { total: 1, hectareas: 12 });
    assert.deepEqual(tab.traslapes.mismoNombre, { total: 2, hectareas: 5603 });
    assert.deepEqual(tab.traslapes.mismoTitular, { total: 1, hectareas: 50 });
    assert.deepEqual(tab.traslapes.mayores.map((m) => m.b), ['La Ajena']);
  });

  await t.test('la frase no lo presenta como pleito', () => {
    return resumenTraslapes().then((r) => {
      const f = fraseTraslapes(r, nf);
      assert.match(f, /^El catastro marca 6 traslapes/);
      assert.match(f, /2 tienen una parte sin titular/);
      assert.match(f, /1 entre titulares distintos \(12 ha\): esos hay que verificarlos/);
      assert.match(f, /2 son el mismo derecho repetido en el padrón/);
      assert.doesNotMatch(f, /disputa|reclaman/);
    });
  });

  await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
  await cerrarBase();
});

test('semáforo y fuente usan la misma lectura', { skip: HAY ? false : 'sin ELECTRUM_DB_URL: no hay base contra la que probar' }, async (t) => {
  const { restriccionesDe } = await import('../server/electrum/restricciones');
  await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
  const caja = (x: number) => `ST_Multi(ST_MakeEnvelope(${-87 + x}, 14, ${-87 + x + 0.01}, 14.01, 4326))`;
  const [{ id: capaA }, { id: capaB }] = await consulta<{ id: number }>(
    `INSERT INTO capa (nombre, formato, origen_crs) VALUES ('DERECHOS MINEROS A JUNIO 2026', 'shapefile', 'EPSG:4326'), ('Otra capa', 'shapefile', 'EPSG:4326') RETURNING id::int AS id`
  );
  const ids = await consulta<{ id: number }>(
    `INSERT INTO concesion (capa_id, nombre, expediente, titular, geom) VALUES
       ($1, 'El Mismo', '10', 'Empresa A', ${caja(0)}),
       ($1, 'El Mismo', '11', 'Empresa B', ${caja(0.005)}),
       ($1, 'Vecina Real', '12', 'Empresa C', ${caja(0.012)})
     RETURNING id::int AS id`,
    [capaA]
  );

  await t.test('mismo nombre en el padrón no es un tercero en el semáforo; otro titular sí', async () => {
    const terceros = (await restriccionesDe([ids[0].id]))[0].items.filter((i) => i.tipo === 'traslape').map((i) => i.nombre);
    assert.deepEqual(terceros, [], 'El Mismo (otro expediente y titular, mismo nombre) es repetido, no tercero');
    const terceros2 = (await restriccionesDe([ids[1].id]))[0].items.filter((i) => i.tipo === 'traslape').map((i) => i.nombre);
    assert.deepEqual(terceros2, ['Vecina Real']);
  });

  await t.test('con una sola capa se nombra el catastro vigente; con varias, no', async () => {
    let tab = await tablero({ fresco: true });
    assert.equal(tab.fuente?.vigente, 'DERECHOS MINEROS A JUNIO 2026');
    await consulta(`INSERT INTO concesion (capa_id, nombre, titular, geom) VALUES ($1, 'Suelta', 'X', ${caja(1)})`, [capaB]);
    tab = await tablero({ fresco: true });
    assert.equal(tab.fuente?.vigente, null);
    assert.equal(tab.fuente?.capasVigentes, 2);
  });

  await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
  await cerrarBase();
});
