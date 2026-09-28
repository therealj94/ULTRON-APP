/**
 * Pedir un área nueva: el polígono se valida antes de tocar la base, y el cruce dice qué
 * concesiones pisa y cuánto queda libre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { poligonoValido, analizarArea, informeArea } = await import('../server/electrum/area');
const { consulta, hayBase } = await import('../server/electrum/db');

const cuadro = (x0: number, y0: number, x1: number, y1: number) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });

test('validación: tipo, cierre, coordenadas en Honduras y tope de vértices', () => {
  assert.equal(poligonoValido(cuadro(-87, 14, -86.9, 14.1)).ok, true);
  assert.equal(poligonoValido({ type: 'Point', coordinates: [-87, 14] }).ok, false);
  assert.equal(poligonoValido(null).ok, false);
  const abierto = { type: 'Polygon', coordinates: [[[-87, 14], [-86.9, 14], [-86.9, 14.1], [-87, 14.1]]] };
  assert.match((poligonoValido(abierto) as any).motivo, /no cierra/);
  assert.match((poligonoValido(cuadro(2, 41, 2.1, 41.1)) as any).motivo, /Honduras/);
  const texto = { type: 'Polygon', coordinates: [[['-87', 14], [-86.9, 14], [-86.9, 14.1], ['-87', 14]]] };
  assert.equal(poligonoValido(texto).ok, false);
  const muchos = Array.from({ length: 2100 }, (_, i) => [-87 + 0.1 * Math.cos((i / 2100) * 2 * Math.PI), 14 + 0.1 * Math.sin((i / 2100) * 2 * Math.PI)]);
  muchos.push(muchos[0]);
  assert.match((poligonoValido({ type: 'Polygon', coordinates: [muchos] }) as any).motivo, /Demasiados vértices/);
});

test('cruce: la mitad pisa una concesión; libre la otra mitad; PDF con plano', { skip: hayBase() ? false : 'sin ELECTRUM_DB_URL' }, async (t) => {
  // En el Caribe, donde no hay nada más del catastro de pruebas.
  await consulta(`DELETE FROM concesion WHERE nombre = 'prueba-area'`);
  await consulta(`INSERT INTO concesion (nombre, geom) VALUES ('prueba-area', ST_Multi(ST_GeomFromText('POLYGON((-83.50 17.00, -83.48 17.00, -83.48 17.02, -83.50 17.02, -83.50 17.00))', 4326)))`);
  t.after(() => consulta(`DELETE FROM concesion WHERE nombre = 'prueba-area'`));
  const r = await analizarArea(cuadro(-83.49, 17.0, -83.47, 17.02) as any, 'Área de prueba');
  assert.ok(!('error' in r), JSON.stringify(r));
  if ('error' in r) return;
  assert.equal(r.traslapes.length, 1);
  assert.equal(r.traslapes[0].con, 'prueba-area');
  assert.ok(Math.abs(r.traslapes[0].pct - 50) < 0.5, `pct ${r.traslapes[0].pct}`);
  assert.ok(Math.abs(r.libreHa - r.ha / 2) < 1, `libre ${r.libreHa} de ${r.ha}`);
  const cruzado = await analizarArea({ type: 'Polygon', coordinates: [[[-83.49, 17.0], [-83.47, 17.02], [-83.47, 17.0], [-83.49, 17.02], [-83.49, 17.0]]] } as any);
  assert.match((cruzado as any).error, /se cruza consigo mismo/);
  const pdf = await informeArea(cuadro(-83.49, 17.0, -83.47, 17.02) as any, 'Área de prueba', 'QA');
  assert.ok(!('error' in pdf));
  if (!('error' in pdf)) {
    assert.equal(pdf.pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal(pdf.nombre, 'area-area-de-prueba.pdf');
  }
});
