/**
 * El entorno de una concesión contra PostGIS de verdad (hace falta ELECTRUM_DB_URL; VACÍA la base,
 * como tests/electrum-db.test.ts: apuntala a una base de pruebas).
 *
 * Se arma un paisaje con verdades conocidas, en grados y a la latitud de Honduras:
 *
 *   · la concesión, 0,02° × 0,02° (≈ 2,16 × 2,21 km, ≈ 478 ha);
 *   · un área protegida que se come su franja este de 0,005° (≈ 119 ha, 25 %), y otra a ≈ 3,2 km;
 *   · una microcuenca declarada que se come su franja sur de 0,005° (≈ 119 ha, 25 %);
 *   · un río que la cruza de lado a lado (≈ 2,16 km dentro);
 *   · un caserío dentro, con población, y otro a ≈ 1 km del lindero cuyo nombre solo está en la
 *     columna CASERIO (el cargador le puso de nombre su código);
 *   · carretera a ≈ 3,3 km, una zona informal a ≈ 2,2 km, una ocurrencia de oro dentro;
 *   · una concesión vecina que la pisa, y NINGUNA capa forestal: tiene que decir «no cargada».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import type { Feature, Geometry } from 'geojson';
import { cerrarBase, consulta, guardarCapa, hayBase, recalcularTraslapes, rolDeCapa } from '../server/electrum/db';
import { entornoDe, entornoEnTexto } from '../server/electrum/entorno';
import { datosPlano, svgPlano } from '../server/electrum/plano';
import { informeConcesion } from '../server/electrum/informe';
import { MANOS } from '../server/electrum/manos';
import type { Capa } from '../server/electrum/gis';

const HAY = hayBase();

const caja = (o: number, s: number, e: number, n: number): Geometry => ({
  type: 'Polygon',
  coordinates: [[[o, s], [e, s], [e, n], [o, n], [o, s]]],
});
const linea = (...pts: Array<[number, number]>): Geometry => ({ type: 'LineString', coordinates: pts });
const punto = (lon: number, lat: number): Geometry => ({ type: 'Point', coordinates: [lon, lat] });

function capa(nombre: string, rasgos: Array<[Record<string, unknown>, Geometry]>): Capa {
  const features: Feature[] = rasgos.map(([properties, geometry]) => ({ type: 'Feature', properties, geometry }));
  return { nombre, formato: 'geojson', origenCrs: 'EPSG:4326', entidades: features.length, descartadas: 0, geojson: { type: 'FeatureCollection', features } };
}

test('el entorno de una concesión, cruzado en PostGIS', { skip: HAY ? false : 'sin ELECTRUM_DB_URL' }, async (t) => {
  await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');

  // Los derechos mineros: la nuestra y una vecina que la pisa.
  await guardarCapa(
    capa('Catastro de prueba', [
      [{ NOMBRE: 'Cerro del Entorno', TITULAR: 'Minera de Prueba S.A.', MUNICIPIO: 'Danlí', EXPEDIENTE: 'EXP-ENT-1' }, caja(-86.6, 14.0, -86.58, 14.02)],
      [{ NOMBRE: 'La Vecina', TITULAR: 'Otra Minera' }, caja(-86.585, 14.01, -86.57, 14.03)],
    ])
  );
  await recalcularTraslapes();

  // La geografía, con los nombres de capa que tiene el nodo.
  const capas: Capa[] = [
    capa('RED HIDRICA HN', [
      [{ NOMBRE: 'Río Chiquito' }, linea([-86.62, 14.008], [-86.56, 14.008])],
      [{ NOMBRE: 'Quebrada Honda' }, linea([-86.7, 14.2], [-86.6, 14.25])],
    ]),
    capa('CASERIOS', [
      [{ NOMBRE: 'Las Minitas', POB_TOTAL: '120' }, punto(-86.595, 14.015)],
      // Sin columna de nombre: el cargador le pone el CÓDIGO, que no es un nombre.
      [{ CODIGO: '0801', CASERIO: 'El Naranjal' }, punto(-86.59, 14.029)],
    ]),
    capa('ALDEAS', [[{ NOMBRE: 'San Antonio' }, punto(-86.59, 14.07)]]),
    capa('Areas Protegidas', [
      [{ NOMBRE: 'Reserva Biológica El Chile' }, caja(-86.585, 13.99, -86.55, 14.03)],
      [{ NOMBRE: 'Parque Nacional La Tigra' }, caja(-86.66, 14.0, -86.63, 14.02)],
    ]),
    capa('Microcuencas declaradas', [[{ NOMBRE: 'Microcuenca Río Chiquito' }, caja(-86.62, 13.98, -86.56, 14.005)]]),
    capa('Buffer Carretera HN', [[{ NOMBRE: 'CA-6' }, linea([-86.7, 14.05], [-86.5, 14.05])]]),
    capa('MUNICIPIOS', [[{ NOMBRE: 'San Juan de Flores' }, caja(-86.7, 13.9, -86.5, 14.1)]]),
    // Así llegan los .dbf de SINIT con .cpg equivocado: UTF-8 leído como latin1. La ficha lo repara.
    capa('DEPARTAMENTOS', [[{ NOMBRE: 'Francisco Moraz\u00c3\u00a1n' }, caja(-87.0, 13.5, -86.0, 14.5)]]),
    capa('Zonas informales oro HN', [[{ NOMBRE: 'Guiriseros del Chiquito' }, punto(-86.56, 14.01)]]),
    capa('Yacimientos y ocurrencias mineras DEFOMIN', [[{ NOMBRE: 'Veta Vieja', MINERAL: 'Oro' }, punto(-86.59, 14.005)]]),
    // El catálogo general repite el punto de DEFOMIN: es el mismo yacimiento, no otro.
    // Dentro de la concesión también hay otra «Veta Vieja», a más de un kilómetro: esa sí es otra.
    capa('Yacimientos y ocurrencias minera', [
      [{ NOMBRE: 'Veta Vieja', MINERAL: 'Oro' }, punto(-86.59, 14.005)],
      [{ NOMBRE: 'Veta Vieja', MINERAL: 'Plata' }, punto(-86.595, 14.017)],
    ]),
  ];
  for (const c of capas) await guardarCapa(c, { comoConcesiones: false });

  const [{ id }] = await consulta<{ id: number }>(`SELECT id::int FROM concesion WHERE nombre = 'Cerro del Entorno'`);
  const [{ id: idVecina }] = await consulta<{ id: number }>(`SELECT id::int FROM concesion WHERE nombre = 'La Vecina'`);

  await t.test('cada capa guardada lleva su rol, y las de concesiones no', async () => {
    const filas = await consulta<{ nombre: string; rol: string | null }>(`SELECT nombre, rol FROM capa ORDER BY id`);
    const rol = Object.fromEntries(filas.map((f) => [f.nombre, f.rol]));
    assert.equal(rol['Catastro de prueba'], null);
    assert.equal(rol['RED HIDRICA HN'], 'rio');
    assert.equal(rol['CASERIOS'], 'poblado');
    assert.equal(rol['Areas Protegidas'], 'area_protegida');
    assert.equal(rol['Microcuencas declaradas'], 'microcuenca');
    assert.equal(rol['Buffer Carretera HN'], 'carretera');
    assert.equal(rol['Yacimientos y ocurrencias mineras DEFOMIN'], 'ocurrencia');
  });

  await t.test('un depósito de mineral es ocurrencia; uno de sedimento, no', () => {
    assert.equal(rolDeCapa('Depósitos minerales'), 'ocurrencia');
    assert.equal(rolDeCapa('Deposito oro'), 'ocurrencia');
    assert.equal(rolDeCapa('Depósitos'), 'ocurrencia');
    assert.notEqual(rolDeCapa('Depositos aluviales'), 'ocurrencia');
  });

  await t.test('la base y la aplicación deciden el mismo rol (electrum_rol_capa ↔ rolDeCapa)', async () => {
    const nombres = [
      'RED HIDRICA HN', 'RED_HIDRICA_HN', 'Ríos principales', 'CASERIOS', 'ALDEAS', 'Microcuencas declaradas',
      'Buffer Carretera HN', 'Red vial', 'Areas Protegidas', 'Áreas protegidas SINAPH', 'MUNICIPIOS', 'Límite municipal',
      'DEPARTAMENTOS', 'Zonas informales oro HN', 'Catalogo Patrimonio Publico Forestal', 'Yacimientos y ocurrencias mineras DEFOMIN',
      'Depositos aluviales', 'Estructuras geologicas', 'Concesiones Otorgadas', 'Parque Nacional Bosque Nublado', 'Aldeas del municipio', 'Curvas de nivel',
      // Geología (v8): las capas de data/geologia y lo que un geólogo subiría con otro nombre.
      'Geología superficial USGS Caribe 1:2.5M', 'Fallas geológicas USGS Caribe 1:2.5M', 'Fallas activas GEM Centroamérica',
      'Límites de placas tectónicas PB2002', 'Provincias geológicas USGS Caribe', 'Tractos permisivos pórfido de cobre USGS',
      'Yacimientos y prospectos pórfido de cobre USGS', 'Yacimientos MRDS USGS', 'Mapa geologico 1:50000 Minas de Oro',
      'Intrusivos Olancho', 'Lineamientos Landsat', 'Falla de Guayape', 'Plutones terciarios',
      // Referencia (v10): lo de JICA es histórico, salvo que sea un mapa de roca.
      'zonas de JICA', 'zona de estudio 3 fases jica', 'JICA-MMAJ zonas', 'Mapa geológico JICA Olancho', 'Catastro histórico 2015',
      // Depósitos de mineral, no de sedimento.
      'Depósitos minerales', 'Depósitos', 'Deposito oro', 'Deposito Mercurio', 'Depósitos de plata Olancho',
    ];
    const filas = await consulta<{ n: string; rol: string | null }>(`SELECT n, electrum_rol_capa(n) AS rol FROM unnest($1::text[]) AS n`, [nombres]);
    for (const f of filas) assert.equal(f.rol, rolDeCapa(f.n), `«${f.n}»: la base dice ${f.rol}, la aplicación ${rolDeCapa(f.n)}`);
  });

  let e: Awaited<ReturnType<typeof entornoDe>>;
  await t.test('el entorno sale con las cifras que se armaron', async () => {
    e = await entornoDe(id);
    assert.ok(e, 'tiene que haber entorno');
    const x = e!;
    assert.ok(Math.abs(x.concesion.hectareas - 478) < 5, `área ${x.concesion.hectareas}`);

    assert.equal(x.municipios.estado, 'ok');
    if (x.municipios.estado === 'ok') assert.deepEqual(x.municipios.lista.map((m) => m.nombre), ['San Juan de Flores']);
    if (x.departamentos.estado === 'ok') assert.equal(x.departamentos.lista[0]?.nombre, 'Francisco Morazán');

    assert.equal(x.areasProtegidas.estado, 'ok');
    if (x.areasProtegidas.estado === 'ok') {
      const [ap] = x.areasProtegidas.pisa;
      assert.equal(ap.nombre, 'Reserva Biológica El Chile');
      assert.ok(Math.abs(ap.ha - 119.5) < 2, `pisa ${ap.ha} ha`);
      assert.ok(Math.abs(ap.pct - 25) < 0.5, `${ap.pct} %`);
      assert.equal(x.areasProtegidas.cerca.length, 1);
      assert.equal(x.areasProtegidas.cerca[0].nombre, 'Parque Nacional La Tigra');
      assert.ok(Math.abs(x.areasProtegidas.cerca[0].km - 3.24) < 0.1, `a ${x.areasProtegidas.cerca[0].km} km`);
    }
    if (x.microcuencas.estado === 'ok') {
      assert.equal(x.microcuencas.pisa[0]?.nombre, 'Microcuenca Río Chiquito');
      assert.ok(Math.abs(x.microcuencas.pisa[0].ha - 119.5) < 2, `microcuenca ${x.microcuencas.pisa[0].ha}`);
    } else assert.fail(`microcuencas: ${x.microcuencas.estado}`);

    if (x.rios.estado === 'ok') {
      assert.ok(Math.abs(x.rios.kmDentro - 2.16) < 0.05, `cauce dentro ${x.rios.kmDentro} km`);
      assert.deepEqual(x.rios.tramos.map((r) => r.nombre), ['Río Chiquito']);
      assert.equal(x.rios.masCercano, null, 'con un río dentro no se busca el más cercano');
    } else assert.fail(`ríos: ${x.rios.estado}`);

    if (x.poblados.estado === 'ok') {
      assert.equal(x.poblados.dentro, 1);
      assert.equal(x.poblados.cerca, 1, 'San Antonio está a 5 km: fuera del radio');
      const naranjal = x.poblados.lista.find((p) => p.nombre === 'El Naranjal');
      assert.ok(naranjal, `el nombre sale de la columna CASERIO: ${JSON.stringify(x.poblados.lista)}`);
      assert.ok(Math.abs(naranjal!.km - 1.0) < 0.05, `a ${naranjal!.km} km`);
      assert.equal(naranjal!.tipo, 'caserío');
      assert.equal(x.poblados.poblacionDentro, 120);
    } else assert.fail(`poblados: ${x.poblados.estado}`);

    if (x.carretera.estado === 'ok') {
      assert.ok(Math.abs((x.carretera.km ?? 0) - 3.32) < 0.1, `carretera a ${x.carretera.km}`);
      assert.equal(x.carretera.franja, false, 'es una línea, no una franja');
    } else assert.fail(`carretera: ${x.carretera.estado}`);

    if (x.zonasInformales.estado === 'ok') assert.ok(Math.abs(x.zonasInformales.lista[0].km - 2.16) < 0.1);
    if (x.ocurrencias.estado === 'ok') {
      assert.equal(x.ocurrencias.lista[0].dentro, true);
      // Tres filas en las capas: el punto repetido cuenta una vez, la otra veta del mismo nombre, aparte.
      assert.equal(x.ocurrencias.lista.length, 2, `el punto repetido en dos capas cuenta una vez: ${JSON.stringify(x.ocurrencias.lista)}`);
      assert.deepEqual(x.ocurrencias.lista.map((o) => o.detalle).sort(), ['Oro', 'Plata']);
    } else assert.fail(`ocurrencias: ${x.ocurrencias.estado}`);
    assert.equal(x.traslapes.length, 1);
    assert.equal(x.traslapes[0].con, 'La Vecina');

    // La capa que no está se dice, no se da por vacía.
    assert.equal(x.forestal.estado, 'no-cargada');
    assert.deepEqual(x.faltan, ['forestal']);
    assert.ok(x.ms < 2000, `tardó ${x.ms} ms`);
  });

  await t.test('las alertas dicen lo que hay que leer, en texto llano', () => {
    const a = e!.alertas.join('\n');
    // A partir de cien hectáreas se dicen sin decimales: «120 ha», no «119,52».
    assert.match(a, /^Pisa 1(19|20) ha del área protegida Reserva Biológica El Chile \(25 % de la concesión\)\.$/m);
    assert.match(a, /^A 3,2 km del área protegida Parque Nacional La Tigra\.$/m);
    assert.match(a, /^Microcuenca declarada Microcuenca Río Chiquito: pisa 1(19|20) ha \(25 % de la concesión\)\.$/m);
    assert.match(a, /^1 caserío dentro \(Las Minitas\)\.$/m);
    assert.match(a, /^1 caserío a menos de 2 km del lindero\.$/m);
    assert.match(a, /^Tiene 2,2 km de cauces dentro \(Río Chiquito\)\.$/m);
    assert.match(a, /Se pisa con 1 otro derecho: La Vecina/);
    assert.doesNotMatch(a, /forestal/, 'de lo no cargado no se alerta nada');
  });

  await t.test('en texto para el doctor: con fuente y con lo que falta', () => {
    const txt = entornoEnTexto(e!);
    assert.match(txt, /municipio\(s\) San Juan de Flores/);
    assert.match(txt, /Carretera más cercana a 3,3 km/);
    assert.match(txt, /Capas NO cargadas \(no afirmes nada de ellas\): patrimonio forestal/);
  });

  await t.test('sin río dentro, el más cercano', async () => {
    const v = await entornoDe(idVecina);
    assert.equal(v!.rios.estado, 'ok');
    if (v!.rios.estado === 'ok') {
      assert.equal(v!.rios.kmDentro, 0);
      assert.equal(v!.rios.masCercano?.nombre, 'Río Chiquito');
      assert.ok(Math.abs(v!.rios.masCercano!.km - 0.22) < 0.03, `a ${v!.rios.masCercano!.km} km`);
    }
  });

  await t.test('la herramienta concesion_entorno lo cuenta, y la puede usar quien solo consulta', async () => {
    const h = MANOS.concesion_entorno;
    assert.deepEqual(h.plataformas, ['electrum']);
    assert.ok(!h.escribe);
    const r = await h.ejecutar({ nombre: 'Cerro del Entorno' }, {} as never);
    assert.equal(r.ok, true, r.texto);
    assert.match(r.texto, /Pisa 1(19|20) ha del área protegida Reserva Biológica El Chile/);
    assert.match(r.texto, /patrimonio forestal/);
  });

  await t.test('el plano del servidor dibuja lo que hay alrededor', async () => {
    const d = await datosPlano(id);
    assert.ok(d);
    assert.equal(d!.rios.length >= 1, true);
    assert.ok(d!.areasProtegidas.some((a) => a.nombre === 'Reserva Biológica El Chile'));
    // La vista cubre al menos los 2 km en que se cuentan caseríos: El Naranjal, a 1 km, sale.
    assert.ok(d!.poblados.some((p) => p.nombre === 'El Naranjal'), 'El Naranjal está en la vista, con su nombre y no su código');
    assert.equal(d!.vecinas.map((v) => v.nombre).join(), 'La Vecina');
    assert.equal(d!.traslapes.length, 1);
    assert.ok(d!.poblados.some((p) => p.tipo === 'caserío'));
    const svg = svgPlano(d!);
    assert.match(svg, /Río o quebrada/);
    assert.match(svg, /Microcuenca declarada/);
    // La vista está en UTM 16N: metros de seis y siete cifras, no grados.
    assert.ok(d!.vista[0] > 100_000 && d!.vista[1] > 1_000_000, `vista ${d!.vista}`);
  });

  await t.test('la ficha en PDF lleva el entorno y el plano, con o sin la captura del navegador', async () => {
    const r = await informeConcesion({ id }, { quien: 'pruebas' });
    assert.ok(!('error' in r), 'error' in r ? r.error : '');
    if ('error' in r) return;
    const pdf = r.pdf.toString('latin1');
    assert.equal((pdf.match(/\/Subtype \/Image/g) || []).length, 1, 'sin captura: solo el plano');
    assert.match(pdf, /PLANO DE SITUACI/);
    assert.match(pdf, /Entorno:/);
    assert.match(pdf, /Reserva Biol/);
    assert.match(pdf, /RED HIDRICA HN/, 'dice de qué capa sale');
    assert.match(pdf, /patrimonio forestal no cargada|Capa de patrimonio forestal no cargada/);
    // El padrón dice Danlí y la geometría cae en San Juan de Flores: eso va arriba.
    assert.match(pdf, /El padr\\363n la ubica en el municipio de Danl/);
    assert.match(r.dicho, /con el plano de situaci/);
    // La ficha pasa el id tal como lo da pg (texto): «la otra» del traslape no puede ser ella misma.
    assert.match(pdf, /Se pisa con 1 otro derecho: La Vecina/);

    const captura = jpeg.encode({ data: Buffer.alloc(64 * 32 * 4, 200), width: 64, height: 32 }, 80).data;
    const r2 = await informeConcesion({ id }, { mapa: captura });
    assert.ok(!('error' in r2));
    if (!('error' in r2)) assert.equal((r2.pdf.toString('latin1').match(/\/Subtype \/Image/g) || []).length, 2, 'la vista del navegador y el plano');
  });

  await t.test('sin capas de geografía, todo «no cargada» y ninguna alerta inventada', async () => {
    await consulta(`DELETE FROM capa WHERE id IN (SELECT DISTINCT capa_id FROM entidad_geo)`);
    const vacio = await entornoDe(id);
    assert.equal(vacio!.areasProtegidas.estado, 'no-cargada');
    assert.equal(vacio!.rios.estado, 'no-cargada');
    assert.equal(vacio!.faltan.length, 10);
    // Solo queda lo que no depende de capas: el traslape con la vecina.
    assert.deepEqual(vacio!.alertas, ['Se pisa con 1 otro derecho: La Vecina (59,8 ha). Con titulares distintos es algo a verificar con INHGEOMIN, no un pleito dado por hecho.']);
  });

  t.after(async () => {
    await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
    await cerrarBase();
  });
});
