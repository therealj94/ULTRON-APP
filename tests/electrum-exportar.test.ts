/**
 * La concesión fuera de la aplicación: vértices en WGS84 y NAD27, KML, DXF, CSV, y la ruta que los
 * baja. Y el plano con su relieve, su recuadro de ubicación y su cajetín.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Geometry } from 'geojson';

process.env.ULTRON_SESION_SECRETO = process.env.ULTRON_SESION_SECRETO || 'secreto-de-sesion-para-pruebas-largo-1234';

const { verticesDe, kml, dxf, csvVertices, nombreArchivo, montarRutasExportar } = await import('../server/electrum/exportar');
const { svgPlano, ALTO, CAJETIN } = await import('../server/electrum/plano');
const { consulta, hayBase } = await import('../server/electrum/db');
const { emitirSesion } = await import('../server/seguridad');
const { fijarCuentasAprobadas } = await import('../lib/acceso');

const cuadro: Geometry = { type: 'Polygon', coordinates: [[[-87, 15], [-86.99, 15], [-86.99, 15.01], [-87, 15.01], [-87, 15]]] };

test('vértices: UTM 16N en WGS84 y NAD27, sin repetir el de cierre', () => {
  const v = verticesDe(cuadro);
  assert.equal(v.length, 4);
  // −87° es el meridiano central de la zona 16: el este es exactamente 500 000.
  assert.ok(Math.abs(v[0].e - 500000) < 0.01, `este ${v[0].e}`);
  assert.ok(Math.abs(v[0].nn - 1658325.7) < 1, `norte ${v[0].nn}`);
  // NAD27 (Centroamérica) cae unos 200 m al sur en el norte UTM y casi igual en el este.
  const dN = v[0].nn - v[0].n27;
  assert.ok(dN > 150 && dN < 260, `ΔN WGS84−NAD27 = ${dN}`);
  assert.ok(Math.abs(v[0].e - v[0].e27) < 30, `ΔE = ${v[0].e - v[0].e27}`);
  assert.deepEqual(v.map((x) => x.n), [1, 2, 3, 4]);
});

test('KML, DXF y CSV bien formados', () => {
  const k = kml('Mina «La Esperanza» & Cía', cuadro, [['titular', 'A & B <S.A.>']]);
  assert.match(k, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(k, /<name>Mina «La Esperanza» &amp; Cía<\/name>/);
  assert.match(k, /<value>A &amp; B &lt;S.A.&gt;<\/value>/);
  assert.match(k, /<coordinates>-87.0000000,15.0000000,0 /);
  const d = dxf('La Esperanza', cuadro);
  assert.match(d, /AC1009/);
  assert.equal((d.match(/\r\nVERTEX\r\n/g) || []).length, 4);
  assert.match(d, /\r\nCONCESION\r\n/);
  assert.match(d, /500000\.000/);
  assert.match(d, /EOF\r\n$/);
  const c = csvVertices(verticesDe(cuadro)).split('\r\n');
  assert.equal(c[0], 'vertice,parte,lat_wgs84,lon_wgs84,este_utm16_wgs84,norte_utm16_wgs84,este_utm16_nad27,norte_utm16_nad27');
  assert.match(c[1], /^1,1,15\.0000000,-87\.0000000,500000\.00,/);
  assert.equal(nombreArchivo('Chantón 2 / "Norte"'), 'Chanton-2-Norte');
});

test('plano: relieve debajo, recuadro de ubicación y cajetín', () => {
  const svg = svgPlano({
    titulo: 'Plano de prueba',
    vista: [499000, 1657000, 503000, 1661000],
    concesion: { nombre: 'Prueba', geom: { type: 'Polygon', coordinates: [[[500000, 1658000], [501000, 1658000], [501000, 1659000], [500000, 1659000], [500000, 1658000]]] } },
    vecinas: [], traslapes: [], rios: [], areasProtegidas: [], microcuencas: [], forestal: [], carretera: [], municipios: [], zonasInformales: [], ocurrencias: [], poblados: [],
    relieve: 'data:image/jpeg;base64,AAAA',
    ubicacion: [-87, 15],
    cajetin: [['Titular', 'Minera & Cía'], ['Expediente', 'EXP-1']],
  });
  assert.match(svg, /<image href="data:image\/jpeg;base64,AAAA"/);
  assert.ok(svg.indexOf('<image') < svg.indexOf('stroke="#b9b9b9"'), 'el relieve va debajo de la cuadrícula');
  assert.match(svg, /Ubicación en Honduras/);
  assert.match(svg, /TITULAR/);
  assert.match(svg, /Minera &amp; Cía/);
  assert.ok(CAJETIN.y + CAJETIN.h < ALTO - 40, 'el cajetín cabe antes del pie');
});

test('exportar: con sesión, formatos, 404 y 400', { skip: hayBase() ? false : 'sin ELECTRUM_DB_URL' }, async (t) => {
  const llave = process.env.ELECTRUM_CLAVE;
  process.env.ELECTRUM_CLAVE = 'llave-de-prueba-exportar';
  fijarCuentasAprobadas([{ id: 'lector-exp', nombre: 'Lector', correos: ['lector@mina.hn'], acceso: { electrum: 'lee' } } as any]);
  await consulta(`DELETE FROM concesion WHERE nombre = 'prueba-exportar'`);
  const [{ id }] = await consulta<{ id: string }>(
    `INSERT INTO concesion (nombre, titular, geom) VALUES ('prueba-exportar', 'Minera X', ST_Multi(ST_GeomFromText('POLYGON((-87 15, -86.99 15, -86.99 15.01, -87 15.01, -87 15))', 4326))) RETURNING id::text`
  );
  const app = express();
  montarRutasExportar(app);
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  t.after(async () => {
    srv.close();
    fijarCuentasAprobadas([]);
    if (llave === undefined) delete process.env.ELECTRUM_CLAVE;
    else process.env.ELECTRUM_CLAVE = llave;
    await consulta(`DELETE FROM concesion WHERE nombre = 'prueba-exportar'`);
  });
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/electrum/concesion`;
  const tok = emitirSesion({ correo: 'lector@mina.hn', nombre: 'Lector', rol: 'x' }).token;
  const pedir = (ruta: string, conSesion = true) => fetch(base + ruta, { headers: conSesion ? { 'x-ultron-sesion': tok } : {} });
  assert.equal((await pedir(`/${id}/exportar?formato=kml`, false)).status, 401);
  const k = await pedir(`/${id}/exportar?formato=kml`);
  assert.equal(k.status, 200);
  assert.match(String(k.headers.get('content-disposition')), /filename="prueba-exportar\.kml"/);
  assert.match(await k.text(), /<Data name="titular"><value>Minera X<\/value><\/Data>/);
  const c = await pedir(`/${id}/exportar?formato=csv`);
  assert.match(String(c.headers.get('content-disposition')), /prueba-exportar\.vertices\.csv/);
  assert.equal((await c.text()).trim().split('\r\n').length, 5);
  const g = await (await pedir(`/${id}/exportar?formato=geojson`)).json();
  assert.equal(g.features[0].properties.nombre, 'prueba-exportar');
  assert.equal((await pedir(`/${id}/exportar?formato=shp`)).status, 400);
  assert.equal((await pedir(`/999999999/exportar?formato=kml`)).status, 404);
});
