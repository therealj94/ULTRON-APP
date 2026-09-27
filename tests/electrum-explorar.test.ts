/**
 * Tocar el mapa (server/electrum/explorar.ts): la ficha de una concesión, «¿qué hay aquí?», las
 * capas que se pueden encender y los atributos de un rasgo. Contra PostGIS de verdad (hace falta
 * ELECTRUM_DB_URL; VACÍA la base, como tests/electrum-db.test.ts). `datosDe` va sin base.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Feature, Geometry } from 'geojson';
import { consulta, guardarCapa, hayBase } from '../server/electrum/db';
import { capaParaMapa, capasVisibles, datosDe, fichaParaMapa, queHayAqui, rasgoParaMapa, renglonesEntorno } from '../server/electrum/explorar';
import type { Capa } from '../server/electrum/gis';

const HAY = hayBase();

test('los datos del catastro, en el orden en que se leen y sin huecos', () => {
  const d = datosDe(
    {
      id: 1,
      expediente: '1276',
      nombre: 'Los Chaguites',
      titular: 'Minera Uno',
      departamento: 'Francisco MorazÃ¡n',
      municipio: null,
      tipo: 'Metálica',
      mineral: 'Oro',
      estado: 'Otorgada',
      otorgada: '2020-01-01',
      vence: '2026-12-01',
      hectareas: 478.123,
      hectareas_dec: null,
    },
    new Date('2026-09-27T12:00:00-06:00')
  );
  assert.deepEqual(
    d.map(([k]) => k),
    ['Expediente', 'Titular', 'Tipo', 'Mineral', 'Estado', 'Otorgada', 'Vence', 'Área medida', 'Departamento']
  );
  assert.equal(Object.fromEntries(d).Vence, '2026-12-01 (faltan 65 días)');
  assert.equal(Object.fromEntries(d)['Área medida'], '478,12 ha');
  // El mojibake de los .dbf se repara también aquí.
  assert.equal(Object.fromEntries(d).Departamento, 'Francisco Morazán');
});

test('una revisión ambiental que falló no se presenta como limpia', () => {
  const e: any = {
    concesion: { id: 1, nombre: 'X', hectareas: 10 },
    capas: {},
    municipios: { estado: 'ok', lista: [] },
    departamentos: { estado: 'ok', lista: [] },
    areasProtegidas: { estado: 'error', motivo: 'timeout' },
    microcuencas: { estado: 'ok', pisa: [] },
    forestal: { estado: 'no-cargada' },
    rios: { estado: 'ok', kmDentro: 0, tramos: [], masCercano: null },
    poblados: { estado: 'ok', dentro: 0, cerca: 0, lista: [], porTipo: [], poblacionDentro: null },
    carretera: { estado: 'ok', km: null, franja: false },
    zonasInformales: { estado: 'ok', lista: [] },
    ocurrencias: { estado: 'ok', lista: [] },
    traslapes: [],
    faltan: ['forestal'],
    alertas: [],
    ms: 1,
  };
  const r = renglonesEntorno(e);
  assert.match(r[0], /No se pudo revisar .*áreas protegidas/);
  assert.ok(!r.some((x) => /^Sin áreas protegidas/.test(x)), r.join(' | '));
  // Con todo bien y nada alrededor, sí se dice que está limpio.
  const limpio = renglonesEntorno({ ...e, areasProtegidas: { estado: 'ok', pisa: [], cerca: [] } });
  assert.ok(limpio.some((x) => /^Sin áreas protegidas/.test(x)), limpio.join(' | '));
});

const caja = (o: number, s: number, e: number, n: number): Geometry => ({
  type: 'Polygon',
  coordinates: [[[o, s], [e, s], [e, n], [o, n], [o, s]]],
});
function capa(nombre: string, rasgos: Array<[Record<string, unknown>, Geometry]>): Capa {
  const features: Feature[] = rasgos.map(([properties, geometry]) => ({ type: 'Feature', properties, geometry }));
  return { nombre, formato: 'geojson', origenCrs: 'EPSG:4326', entidades: features.length, descartadas: 0, geojson: { type: 'FeatureCollection', features } };
}

test('tocar el mapa, contra PostGIS', { skip: HAY ? false : 'sin ELECTRUM_DB_URL' }, async (t) => {
  await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
  await guardarCapa(
    capa('Catastro de prueba', [
      [{ NOMBRE: 'Los Chaguites', TITULAR: 'Minera Uno', EXPEDIENTE: '1276', MINERAL: 'Oro' }, caja(-87.2, 14.8, -87.18, 14.82)],
      [{ NOMBRE: 'La Vecina', TITULAR: 'Minera Dos' }, caja(-87.17, 14.8, -87.15, 14.82)],
    ])
  );
  for (const c of [
    capa('Geologia de Olancho 1:100000', [
      [{ UNIDAD: 'Kvm', DESCRIPCION: 'Granodiorita, intrusivo del Cretácico' }, caja(-87.3, 14.7, -87.1, 14.9)],
    ]),
    capa('Estructuras geologicas', [[{ NOMBRE: 'Falla Guayape', TIPO: 'normal' }, { type: 'LineString', coordinates: [[-87.25, 14.81], [-87.1, 14.81]] }]]),
    capa('Yacimientos y ocurrencias mineras DEFOMIN', [[{ NOMBRE: 'Veta Vieja', MINERAL: 'Oro' }, { type: 'Point', coordinates: [-87.19, 14.81] }]]),
    capa('Areas Protegidas', [[{ NOMBRE: 'Reserva de Prueba' }, caja(-87.185, 14.79, -87.16, 14.83)]]),
  ]) {
    await guardarCapa(c, { comoConcesiones: false });
  }
  const [{ id }] = await consulta<{ id: number }>(`SELECT id::int FROM concesion WHERE nombre = 'Los Chaguites'`);

  await t.test('la ficha de la concesión tocada trae catastro, entorno, geología y documentos', async () => {
    const f = await fichaParaMapa(id);
    assert.ok(f);
    assert.equal(f!.nombre, 'Los Chaguites');
    assert.equal(Object.fromEntries(f!.datos).Expediente, '1276');
    assert.ok(f!.geojson && f!.encuadre, 'trae con qué volar');
    assert.equal(f!.entorno.estado, 'ok');
    if (f!.entorno.estado === 'ok') assert.ok(f!.entorno.renglones.some((r) => /Reserva de Prueba/.test(r)), f!.entorno.renglones.join(' | '));
    assert.equal(f!.geologia.estado, 'ok');
    if (f!.geologia.estado === 'ok') {
      const g = f!.geologia.renglones.join(' | ');
      assert.match(g, /Kvm/);
      assert.match(g, /Fallas: .* dentro/);
      assert.match(g, /Veta Vieja/);
      assert.match(g, /Indicios: /);
    }
    assert.equal(f!.documentos.estado, 'ok');
  });

  await t.test('una concesión que no existe no tiene ficha', async () => {
    assert.equal(await fichaParaMapa(999999), null);
  });

  await t.test('«¿qué hay aquí?» dice quién tiene el punto y qué hay cerca', async () => {
    const a = await queHayAqui(-87.19, 14.81);
    assert.equal(a.concesiones.estado, 'ok');
    assert.equal(a.cerca.estado, 'ok');
    if (a.concesiones.estado !== 'ok' || a.cerca.estado !== 'ok') return;
    assert.deepEqual(a.concesiones.lista.map((c) => c.nombre), ['Los Chaguites']);
    assert.ok(a.cerca.lista.some((c) => c.nombre === 'La Vecina'));
    assert.ok(!a.cerca.lista.some((c) => c.nombre === 'Los Chaguites'), 'la que lo cubre no se repite como cercana');
    assert.equal(a.geologia.estado, 'ok');
    const vacio = await queHayAqui(-86.0, 15.5);
    assert.deepEqual(vacio.concesiones, { estado: 'ok', lista: [] });
  });

  await t.test('las capas que se pueden encender, y cada una pintable', async () => {
    const capas = await capasVisibles();
    assert.deepEqual(
      capas.map((c) => c.rol),
      ['litologia', 'falla', 'ocurrencia', 'area_protegida']
    );
    const roca = await capaParaMapa(capas[0].id);
    const unidad = await rasgoParaMapa(Number(roca!.geojson.features[0].properties!.eid));
    assert.equal(unidad!.nombre, 'Kvm', 'sin columna de nombre, el título sale de la unidad y no de «entidad N»');
    assert.equal(roca!.rol, 'litologia');
    assert.equal(roca!.geojson.features.length, 1);
    assert.equal(roca!.geojson.features[0].properties!.clase, 'intrusiva');
    const falla = await capaParaMapa(capas[1].id);
    assert.equal(falla!.geojson.features[0].geometry.type, 'LineString');
    // El catastro no es una capa para encender: ya está pintado.
    const [{ id: idCatastro }] = await consulta<{ id: number }>(`SELECT id::int FROM capa WHERE nombre = 'Catastro de prueba'`);
    assert.equal(await capaParaMapa(idCatastro), null);
  });

  await t.test('tocar un rasgo enseña sus atributos', async () => {
    const capas = await capasVisibles();
    const falla = await capaParaMapa(capas[1].id);
    const eid = Number(falla!.geojson.features[0].properties!.eid);
    const r = await rasgoParaMapa(eid);
    assert.equal(r!.capa, 'Estructuras geologicas');
    assert.equal(r!.rol, 'falla');
    assert.equal(r!.nombre, 'Falla Guayape');
    assert.deepEqual(Object.fromEntries(r!.atributos), { NOMBRE: 'Falla Guayape', TIPO: 'normal' });
    assert.equal(await rasgoParaMapa(99999999), null);
  });
});
