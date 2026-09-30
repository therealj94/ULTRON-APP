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
       ('La Ajena', '300', 'Otra Empresa', ${caja(0.003)})
     RETURNING id::int AS id`
  );
  const [a, b, c, d, e] = ids.map((r) => r.id);
  const par = (x: number, y: number, ha: number) => consulta(`INSERT INTO traslape (a_id, b_id, hectareas) VALUES ($1, $2, $3)`, [x, y, ha]);
  await par(a, b, 4603); // mismo nombre y expediente: repetido
  await par(a, c, 1000); // mismo expediente, otro nombre: repetido
  await par(b, d, 50); // mismo titular, otro expediente
  await par(a, e, 12); // titulares distintos: a verificar

  await t.test('cada traslape cae en su clase', async () => {
    const r = await resumenTraslapes();
    assert.equal(r.total, 4);
    assert.deepEqual(r.repetidos, { total: 2, hectareas: 5603 });
    assert.deepEqual(r.mismoTitular, { total: 1, hectareas: 50 });
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
    assert.equal(tab.traslapes.total, 4);
    assert.deepEqual(tab.traslapes.entreTitulares, { total: 1, hectareas: 12 });
    assert.deepEqual(tab.traslapes.mismoNombre, { total: 2, hectareas: 5603 });
    assert.deepEqual(tab.traslapes.mismoTitular, { total: 1, hectareas: 50 });
    assert.deepEqual(tab.traslapes.mayores.map((m) => m.b), ['La Ajena']);
  });

  await t.test('la frase no lo presenta como pleito', () => {
    return resumenTraslapes().then((r) => {
      const f = fraseTraslapes(r, nf);
      assert.match(f, /^El catastro marca 4 traslapes/);
      assert.match(f, /1 entre titulares distintos \(12 ha\): esos hay que verificarlos/);
      assert.match(f, /2 son el mismo derecho repetido en el padrón/);
      assert.doesNotMatch(f, /disputa|reclaman/);
    });
  });

  await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
  await cerrarBase();
});
