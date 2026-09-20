/**
 * Motor GIS de Electrum.
 *
 * Los fixtures (tests/fixtures/gis) son cuadrados EXACTOS en UTM 16N, generados por
 * scripts/gis/fixture-concesiones.py. Eso da verdades conocidas contra las que medir:
 *
 *  - 2.000 x 2.000 m en la cuadrícula UTM = 400,00 ha planares. Pero el factor de escala de UTM a
 *    45 km del meridiano central es ~0,99962, así que sobre el terreno son ~400,3 ha. Si el motor
 *    devolviera 400,00 exactas estaría midiendo sobre la cuadrícula, que es el error clásico.
 *  - El traslape entre las dos concesiones es 500 x 2.000 m = 100,00 ha planares, ~100,08 reales.
 *  - Danlí está en 14,03 N y 86,58 O. Si el .prj se ignora, las coordenadas salen en cientos de
 *    miles y la concesión aterriza en el Atlántico.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  areaHectareas,
  centro,
  distanciaKm,
  encuadre,
  ingerir,
  leerPrj,
  puntoDentro,
  resumenCapa,
  resumenTraslapes,
  traslapeHectareas,
  traslapesEnCapa,
} from '../server/electrum/gis';

const FIX = path.join(process.cwd(), 'tests', 'fixtures', 'gis');
const leer = (f: string) => fs.readFileSync(path.join(FIX, f));
const cerca = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} no está cerca de ${b} (±${tol})`);

test('shapefile del catastro: se lee, se reproyecta y se mide', async (t) => {
  const { capa, avisos } = await ingerir('catastro.zip', leer('catastro.zip'));
  assert.ok(capa, 'debería haber capa');

  await t.test('entran las dos concesiones con sus atributos', () => {
    assert.equal(capa!.entidades, 2);
    assert.equal(capa!.descartadas, 0);
    const props = capa!.geojson.features.map((f) => (f.properties as any).EXPEDIENTE);
    assert.deepEqual(props, ['EXP-2021-0442', 'EXP-2019-0118']);
  });

  await t.test('se reproyecta a WGS84: la concesión cae en Danlí, no en el Atlántico', () => {
    const [lon, lat] = centro(capa!.geojson.features[0]);
    cerca(lat, 14.03, 0.05);
    cerca(lon, -86.58, 0.05);
    assert.ok(Math.abs(lon) <= 180 && Math.abs(lat) <= 90, 'las coordenadas deben ser grados');
  });

  await t.test('declara de dónde vino', () => {
    assert.match(capa!.origenCrs, /UTM Zone 16N/i);
    assert.ok(avisos.some((a) => /Reproyectado desde/.test(a.texto)));
  });

  await t.test('el área es la geodésica, no la de la cuadrícula', () => {
    const ha = areaHectareas(capa!.geojson.features[0]);
    cerca(ha, 400.3, 0.4);
    assert.ok(ha > 400.05, `un área de ${ha} ha significa que se midió sobre la cuadrícula UTM, no sobre el terreno`);
  });

  await t.test('encuentra el traslape entre las dos concesiones', () => {
    const ha = traslapeHectareas(capa!.geojson.features[0], capa!.geojson.features[1]);
    cerca(ha, 100.08, 0.2);
  });

  await t.test('el barrido de traslapes las nombra por su nombre', () => {
    const t2 = traslapesEnCapa(capa!);
    assert.equal(t2.length, 1);
    assert.equal(t2[0].nombreA, 'Quebrada Seca');
    assert.equal(t2[0].nombreB, 'Cerro Partido');
    cerca(t2[0].hectareas, 100.08, 0.2);
  });

  await t.test('el encuadre cubre las dos', () => {
    const [o, s, e, n] = encuadre(capa!.geojson);
    assert.ok(o < e && s < n);
    cerca(s, 14.02, 0.05);
    cerca(n, 14.05, 0.05);
  });

  await t.test('punto dentro y punto fuera', () => {
    const c = centro(capa!.geojson.features[0]);
    assert.equal(puntoDentro(c, capa!.geojson.features[0]), true);
    assert.equal(puntoDentro([-87.5, 14.1], capa!.geojson.features[0]), false);
  });

  await t.test('el resumen avisa de la diferencia entre el área declarada y la medida', () => {
    const r = resumenCapa(capa!, avisos);
    assert.match(r, /2 entidades/);
    assert.match(r, /hect[áa]reas/);
    // El .dbf declara 400,00 por concesión (800 en total) y lo medido es ~800,6.
    assert.match(r, /declara 800,00 hectáreas/);
    assert.match(r, /cuadrícula UTM/);
  });

  await t.test('el resumen de traslapes explica qué significa, no solo el número', () => {
    const r = resumenTraslapes(capa!);
    assert.match(r, /Quebrada Seca con Cerro Partido/);
    assert.match(r, /prelación/);
  });
});

test('shapefile sin .prj: avisa en vez de adivinar', async () => {
  // El .shp suelto no lleva el .dbf, así que shpjs puede quejarse; lo que importa es que no mienta.
  const { capa, avisos } = await ingerir('sin-prj.shp', leer('sin-prj.shp'));
  const dijoAlgo = avisos.some((a) => /sin \.prj|no son grados|proyecci[oó]n|no pude leer/i.test(a.texto));
  assert.ok(dijoAlgo, `debería avisar; avisos: ${JSON.stringify(avisos)}`);
  if (capa && capa.entidades) {
    // Si logró leerlo, las coordenadas siguen en metros: eso tiene que quedar dicho como error.
    assert.ok(avisos.some((a) => a.nivel === 'error' || a.nivel === 'ojo'));
  }
});

test('KML: entra y se mide igual', async () => {
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>Las Lajas</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
-86.60,14.00,0 -86.60,14.01,0 -86.59,14.01,0 -86.59,14.00,0 -86.60,14.00,0
</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;
  const { capa } = await ingerir('lajas.kml', Buffer.from(kml, 'utf8'));
  assert.ok(capa);
  assert.equal(capa!.entidades, 1);
  // 0,01° de lado: ~1,111 km en latitud y ~1,078 km en longitud a 14° → ~119,8 ha.
  cerca(areaHectareas(capa!.geojson.features[0]), 119.8, 1.5);
  assert.match(capa!.origenCrs, /WGS84/);
});

test('GeoJSON proyectado: lo reproyecta si declara su EPSG', async () => {
  const gj = {
    type: 'FeatureCollection',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::32616' } },
    features: [
      {
        type: 'Feature',
        properties: { NOMBRE: 'Bloque UTM' },
        geometry: {
          type: 'Polygon',
          coordinates: [[[545000, 1551000], [545000, 1553000], [547000, 1553000], [547000, 1551000], [545000, 1551000]]],
        },
      },
    ],
  };
  const { capa, avisos } = await ingerir('bloque.geojson', Buffer.from(JSON.stringify(gj), 'utf8'));
  assert.ok(capa);
  const [lon, lat] = centro(capa!.geojson.features[0]);
  cerca(lat, 14.03, 0.05);
  cerca(lon, -86.58, 0.05);
  assert.ok(avisos.some((a) => /reproyect/i.test(a.texto)));
  cerca(areaHectareas(capa!.geojson.features[0]), 400.3, 0.4);
});

test('CSV de puntos', async () => {
  const csv = 'nombre,lon,lat,tipo\nBocamina 1,-86.58,14.03,socavón\nCampamento,-86.57,14.04,obra\n';
  const { capa } = await ingerir('puntos.csv', Buffer.from(csv, 'utf8'));
  assert.ok(capa);
  assert.equal(capa!.entidades, 2);
  assert.equal((capa!.geojson.features[0].properties as any).tipo, 'socavón');
  // Un kilómetro y pico entre los dos puntos.
  const p1 = (capa!.geojson.features[0].geometry as any).coordinates;
  const p2 = (capa!.geojson.features[1].geometry as any).coordinates;
  cerca(distanciaKm(p1, p2), 1.52, 0.1);
});

test('formatos que todavía no entran lo dicen claro, no fallan en silencio', async (t) => {
  await t.test('gpkg', async () => {
    const { capa, avisos } = await ingerir('catastro.gpkg', Buffer.from('x'));
    assert.equal(capa, null);
    assert.match(avisos[0].texto, /GeoPackage/);
    assert.match(avisos[0].texto, /shapefile o GeoJSON/);
  });
  await t.test('dxf', async () => {
    const { avisos } = await ingerir('planta.dxf', Buffer.from('x'));
    assert.match(avisos[0].texto, /DXF/);
  });
  await t.test('un formato cualquiera', async () => {
    const { avisos } = await ingerir('cosa.xyz', Buffer.from('x'));
    assert.match(avisos[0].texto, /No conozco el formato/);
  });
  await t.test('un archivo roto no tumba nada', async () => {
    const { capa, avisos } = await ingerir('roto.zip', Buffer.from('no soy un zip'));
    assert.equal(capa, null);
    assert.ok(avisos.length);
  });
});

test('lectura del .prj', async (t) => {
  await t.test('saca el nombre de la proyección', () => {
    const r = leerPrj('PROJCS["WGS_1984_UTM_Zone_16N",GEOGCS["GCS_WGS_1984"]]');
    assert.match(r.nombre, /WGS 1984 UTM Zone 16N/);
  });
  await t.test('sin .prj lo dice', () => {
    assert.equal(leerPrj('').nombre, 'sin declarar');
  });
});
