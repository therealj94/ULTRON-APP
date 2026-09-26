/**
 * LO QUE ENCONTRÓ LA AUDITORÍA DE PUNTA A PUNTA DE DR ELECTRUM (sin base de datos).
 *
 * Cada prueba fija un fallo que se vio corriendo la plataforma entera —servidor compilado, PostGIS,
 * navegador— y que ninguna prueba anterior cazaba:
 *
 *  · El datum NAD27 entraba sin corrimiento: ~107 m al sur en Honduras.
 *  · Un GeoJSON en NAD27/NAD83 declarado por EPSG no se reproyectaba y entraba en metros.
 *  · Lo que no está en grados se guardaba igual (y un polígono en metros tumbaba la carga).
 *  · «Es lo normal por la cuadrícula UTM» se decía de CUALQUIER diferencia de área, también de un 7 %.
 *  · La voz leía «250.000 toneladas» como «doscientos cincuenta punto cero cero cero».
 *  · Las fórmulas mezclaban punto y coma decimal: «3.400 g/t» por 3,4 g/t.
 *  · El aviso de una foto leída llevaba la URL interna del nodo de visión.
 *  · Dos concesiones con el mismo nombre daban «coincide con varias: X, X».
 *  · El PDF que armaba un turno de Telegram nunca se mandaba a quien lo pidió.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import proj4 from 'proj4';
import { conCorrimientoNad27, ingerir, resumenCapa, type Capa } from '../server/electrum/gis';
import { cifrasAVoz } from '../server/habla';
import { expresar } from '../server/voz';
import { resolverCalculoMina } from '../lib/minas/calculos';
import { ojoQueLeyo } from '../server/electrum/aprender';
import { distinguir, unicaExacta, type FilaConcesion } from '../server/electrum/db';

const cerca = (a: number, b: number, tol: number, que = '') => assert.ok(Math.abs(a - b) <= tol, `${que} ${a} no está cerca de ${b} (±${tol})`);
const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'gis');

const NAD27_ESRI =
  'PROJCS["NAD_1927_UTM_Zone_16N",GEOGCS["GCS_North_American_1927",DATUM["D_North_American_1927",SPHEROID["Clarke_1866",6378206.4,294.9786982]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],' +
  'PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-87.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';
const NAD27_OGC =
  'PROJCS["NAD27 / UTM zone 16N",GEOGCS["NAD27",DATUM["North_American_Datum_1927",SPHEROID["Clarke 1866",6378206.4,294.978698213898,AUTHORITY["EPSG","7008"]],' +
  'AUTHORITY["EPSG","6267"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4267"]],' +
  'PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-87],PARAMETER["scale_factor",0.9996],' +
  'PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AUTHORITY["EPSG","26716"]]';

/*
 * La referencia: lo que da PROJ 9 con la base de EPSG para el punto (545000, 1551000) de NAD27 / UTM
 * 16N — `SELECT ST_Transform(ST_SetSRID(ST_MakePoint(545000,1551000),26716),4326)` en PostGIS 3.4.
 */
const PROJ_REFERENCIA: [number, number] = [-86.58318318127765, 14.031073253727769];

test('NAD27: se pasa a WGS84 con el corrimiento de Centroamérica, igual que PROJ', async (t) => {
  await t.test('en los dos dialectos de .prj (ESRI y OGC con AUTHORITY dentro del esferoide)', () => {
    for (const wkt of [NAD27_ESRI, NAD27_OGC]) {
      const corregido = conCorrimientoNad27(wkt);
      assert.match(corregido, /TOWGS84\[0,125,194/);
      const [lon, lat] = proj4(corregido, 'EPSG:4326', [545000, 1551000]);
      cerca(lon, PROJ_REFERENCIA[0], 1e-6, 'lon');
      cerca(lat, PROJ_REFERENCIA[1], 1e-6, 'lat');
    }
  });

  await t.test('un .prj que ya trae su TOWGS84, o que no es NAD27, no se toca', () => {
    const conPropio = NAD27_ESRI.replace('294.9786982]]', '294.9786982],TOWGS84[-3,142,183,0,0,0,0]]');
    assert.equal(conCorrimientoNad27(conPropio), conPropio);
    const wgs = 'PROJCS["WGS_1984_UTM_Zone_16N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]]]]';
    assert.equal(conCorrimientoNad27(wgs), wgs);
  });

  await t.test('un shapefile en NAD27 cae donde lo pone PROJ, no ~107 m al sur', async () => {
    // El mismo catastro de prueba, con el .prj cambiado a NAD27: mismas coordenadas, otro datum.
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(FIXTURES, 'catastro.zip')));
    const nombrePrj = Object.keys(zip.files).find((f) => /\.prj$/i.test(f))!;
    zip.file(nombrePrj, NAD27_ESRI);
    const nad = await ingerir('viejo.zip', await zip.generateAsync({ type: 'nodebuffer' }));
    assert.ok(nad.capa, JSON.stringify(nad.avisos));
    assert.ok(nad.avisos.some((a) => /NAD27/.test(a.texto) && a.nivel === 'ojo'), 'el supuesto se le dice a quien sube el archivo');
    // El primer vértice del fixture es (545000, 1551000): tiene que caer exactamente donde lo pone PROJ.
    const [lon, lat] = (nad.capa!.geojson.features[0].geometry as any).coordinates[0][0];
    cerca(lon, PROJ_REFERENCIA[0], 1e-6, 'lon');
    cerca(lat, PROJ_REFERENCIA[1], 1e-6, 'lat');
    // Sin el corrimiento quedaba en 14,030107: unos 107 m al sur.
    const [, latSin] = proj4(NAD27_ESRI, 'EPSG:4326', [545000, 1551000]);
    cerca((lat - latSin) * 110_600, 107, 3, 'metros de corrimiento');
  });

  await t.test('un GeoJSON que declara EPSG:26716 se reproyecta en vez de entrar en metros', async () => {
    const gj = {
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::26716' } },
      features: [{ type: 'Feature', properties: { NOMBRE: 'Bloque' }, geometry: { type: 'Point', coordinates: [545000, 1551000] } }],
    };
    const { capa, avisos } = await ingerir('b.geojson', Buffer.from(JSON.stringify(gj)));
    assert.ok(capa, JSON.stringify(avisos));
    const [lon, lat] = (capa!.geojson.features[0].geometry as any).coordinates;
    cerca(lon, PROJ_REFERENCIA[0], 1e-6, 'lon');
    cerca(lat, PROJ_REFERENCIA[1], 1e-6, 'lat');
  });

  await t.test('y uno en NAD83 / UTM 17N (EPSG:26917), el oriente de Honduras', async () => {
    const gj = {
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'EPSG:26917' } },
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [200000, 1650000] } }],
    };
    const { capa } = await ingerir('mosquitia.geojson', Buffer.from(JSON.stringify(gj)));
    assert.ok(capa);
    const [lon, lat] = (capa!.geojson.features[0].geometry as any).coordinates;
    assert.ok(lon > -85 && lon < -83 && lat > 14 && lat < 16, `${lon}, ${lat} tiene que caer en la Mosquitia`);
  });
});

test('lo que no está en grados no se guarda', async (t) => {
  await t.test('un CSV de bocaminas en UTM', async () => {
    const { capa, avisos } = await ingerir('bocaminas.csv', Buffer.from('nombre,x,y\nB1,545200,1551300\nB2,545900,1551800\n'));
    assert.equal(capa, null, 'metros en una columna de grados dejan el punto a medio mundo de Honduras');
    assert.ok(avisos.some((a) => a.nivel === 'error' && /No lo guardé/.test(a.texto)));
  });

  await t.test('un shapefile sin .prj en metros', async () => {
    const { capa, avisos } = await ingerir('sin-prj.shp', fs.readFileSync(path.join(FIXTURES, 'sin-prj.shp')));
    assert.equal(capa, null);
    assert.ok(avisos.some((a) => /no son grados|No lo guardé|no pude leer/i.test(a.texto)), JSON.stringify(avisos));
  });

  await t.test('un CSV en grados sigue entrando', async () => {
    const { capa } = await ingerir('ok.csv', Buffer.from('nombre,lon,lat\nB1,-86.58,14.03\n'));
    assert.equal(capa?.entidades, 1);
  });
});

test('la diferencia de área solo se atribuye a la cuadrícula UTM cuando es de décimas de por ciento', () => {
  const cuadro = (lado: number, declaradas: number): Capa => ({
    nombre: 'prueba',
    formato: 'geojson',
    origenCrs: 'WGS84',
    entidades: 1,
    descartadas: 0,
    geojson: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { HECTAREAS: declaradas },
          geometry: { type: 'Polygon', coordinates: [[[-86.6, 14], [-86.6, 14 + lado], [-86.6 + lado, 14 + lado], [-86.6 + lado, 14], [-86.6, 14]]] },
        },
      ],
    },
  });
  // 0,01° de lado a 14° N: ~119,8 ha medidas.
  const casi = resumenCapa(cuadro(0.01, 119.7));
  assert.match(casi, /cuadrícula UTM y no sobre el terreno/);
  const lejos = resumenCapa(cuadro(0.01, 112));
  assert.doesNotMatch(lejos, /Es lo normal/, 'un 7 % no es la cuadrícula: es un lindero que no cuadra');
  assert.match(lejos, /no lo explica la cuadrícula UTM/);
});

test('la voz dice las cifras como están escritas en esta plataforma', async (t) => {
  await t.test('el punto es de miles, la coma de decimales', () => {
    assert.equal(cifrasAVoz('250.000 toneladas'), 'doscientos cincuenta mil toneladas');
    assert.equal(cifrasAVoz('1.200.000'), 'un millón doscientos mil');
    assert.equal(cifrasAVoz('331.497,51'), 'trescientos treinta y un mil cuatrocientos noventa y siete punto cinco uno');
    assert.equal(cifrasAVoz('3,4'), 'tres punto cuatro');
    assert.equal(cifrasAVoz('21.000'), 'veintiún mil');
  });
  await t.test('un decimal escrito con punto, sin grupos de tres, sigue siendo decimal', () => {
    assert.equal(cifrasAVoz('3.4'), 'tres punto cuatro');
  });
  await t.test('las unidades se dicen enteras', () => {
    const t1 = expresar('Hay un traslape de 100,07 ha y la ley es 3,4 g/t en 4,2 m, a 5 km, 91 %.');
    assert.match(t1, /cien punto cero siete hectáreas/);
    assert.match(t1, /tres punto cuatro gramos por tonelada/);
    assert.match(t1, /cuatro punto dos metros/);
    assert.match(t1, /cinco kilómetros/);
    assert.match(t1, /noventa y uno por ciento/);
    assert.doesNotMatch(t1, /\bha\b|g\/t|\bkm\b/);
  });
  await t.test('un código con cero delante se dice cifra por cifra', () => {
    assert.match(cifrasAVoz('EXP-2021-0442'), /cero cuatro cuatro dos/);
  });
});

test('las fórmulas usan una sola notación: miles con punto, decimales con coma', () => {
  const c = resolverCalculoMina('250.000 toneladas a 3,4 g/t, ¿cuántas onzas?')!;
  assert.equal(c.formula, '250.000 t x 3,400 g/t / 31,1035 = 27.328,1 oz');
  assert.doesNotMatch(c.formula, /3\.400/, '«3.400 g/t» se lee tres mil cuatrocientos gramos');
  const corte = resolverCalculoMina('ley de corte con costo de 45 dólares por tonelada, oro a 2000 la onza y 90% de recuperación')!;
  assert.match(corte.formula, /= 0,778 g\/t$/);
  // La recuperación con decimales se escribe entera: con «0,93» la fórmula ya no da su resultado.
  const fina = resolverCalculoMina('ley de corte con costo de 45 dólares por tonelada, oro a 2000 la onza y 92,5% de recuperación')!;
  assert.match(fina.formula, /x 0,925\) = 0,757 g\/t$/, fina.formula);
});

test('el aviso de una foto leída no lleva la dirección del nodo de visión', () => {
  assert.equal(ojoQueLeyo('http://10.0.3.7:7860/ver'), 'el ojo del nodo de visión');
  assert.match(ojoQueLeyo('gemini:gemini-2.0-flash'), /Gemini/);
  assert.doesNotMatch(ojoQueLeyo('https://ojo.interno.example/ver'), /https?:|interno/);
});

test('dos concesiones con el mismo nombre se distinguen por expediente, titular e id', () => {
  const fila = (id: number, extra: Partial<FilaConcesion>): FilaConcesion => ({
    id,
    expediente: null,
    nombre: 'Cerro Partido',
    titular: null,
    departamento: null,
    municipio: null,
    tipo: null,
    mineral: null,
    estado: null,
    otorgada: null,
    vence: null,
    hectareas: null,
    hectareas_dec: null,
    ...extra,
  });
  const a = fila(2, { expediente: 'EXP-2019-0118', titular: 'Compañía Demo Andina Ltda.', municipio: 'El Corpus' });
  const b = fila(9, { expediente: 'EXP-2023-0100', titular: 'Otra S.A.' });
  assert.equal(distinguir(a), 'Cerro Partido (EXP-2019-0118, Compañía Demo Andina Ltda., El Corpus; id 2)');
  assert.equal(unicaExacta([a, b], 'Cerro Partido'), null, 'dos con el mismo nombre: hay que preguntar');
  assert.equal(unicaExacta([a, b], 'exp-2019-0118')?.id, 2, 'el expediente exacto decide');
  assert.equal(unicaExacta([a, fila(3, { nombre: 'Cerro Partido Norte' })], 'cerro partido')?.id, 2, 'la parecida no vuelve ambigua a la exacta');
});

test('Telegram: el informe que armó un turno se le manda a quien lo pidió', async () => {
  const { guardarInforme, olvidarInformes } = await import('../server/electrum/informe');
  const { enviarInformeElectrum } = await import('../server/electrum/telegram');
  const antes = { token: process.env.ELECTRUM_BOT_TOKEN, fetch: globalThis.fetch };
  process.env.ELECTRUM_BOT_TOKEN = 'token-de-prueba';
  const enviados: string[] = [];
  globalThis.fetch = (async (url: any) => {
    enviados.push(String(url));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    // Como lo guarda `informe_pdf` en un turno de Telegram: a nombre del id del padrón.
    const id = guardarInforme({ pdf: Buffer.from('%PDF-1.4 prueba'), nombre: 'ficha.pdf', dicho: 'x' }, 'jose');
    assert.equal(await enviarInformeElectrum('123', id, 'ficha', 'jose'), true, 'a su dueño se le manda');
    assert.equal(enviados.filter((u) => /sendDocument/.test(u)).length, 1);
    assert.equal(await enviarInformeElectrum('123', id, 'ficha', 'otro'), false, 'a otro, no');
  } finally {
    globalThis.fetch = antes.fetch;
    if (antes.token === undefined) delete process.env.ELECTRUM_BOT_TOKEN;
    else process.env.ELECTRUM_BOT_TOKEN = antes.token;
    olvidarInformes();
  }
});
