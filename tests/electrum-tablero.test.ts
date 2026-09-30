/**
 * El tablero nacional contra PostGIS (ELECTRUM_DB_URL; VACÍA el catastro). Paisaje conocido:
 * dos concesiones metálicas y una artesanal; un área protegida y una microcuenca que pisan a una;
 * caseríos como puntos y, como en el padrón real, un polígono en la capa de caseríos que lo cubre
 * todo (no debe contar); y departamentos para repartir por ubicación.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Feature, Geometry } from 'geojson';
import { consulta, guardarCapa, hayBase, recalcularTraslapes } from '../server/electrum/db';
import { claseDeCapa, normalizarClase, olvidarTablero, tablero } from '../server/electrum/tablero';
import { nombreParaDecir } from '../src-electrum/demo/Recorrido';
import { partirNombre } from '../src-electrum/mapa/Tablero';
import type { Capa } from '../server/electrum/gis';

const caja = (o: number, s: number, e: number, n: number): Geometry => ({ type: 'Polygon', coordinates: [[[o, s], [e, s], [e, n], [o, n], [o, s]]] });
const punto = (lon: number, lat: number): Geometry => ({ type: 'Point', coordinates: [lon, lat] });
function capa(nombre: string, rasgos: Array<[Record<string, unknown>, Geometry]>): Capa {
  const features: Feature[] = rasgos.map(([properties, geometry]) => ({ type: 'Feature', properties, geometry }));
  return { nombre, formato: 'geojson', origenCrs: 'EPSG:4326', entidades: features.length, descartadas: 0, geojson: { type: 'FeatureCollection', features } };
}

test('la clase sale del nombre de la capa', () => {
  assert.equal(claseDeCapa('CONCESIÓN METÁLICA OTORGADA PARA EXPLOTAR'), 'Metálica');
  assert.equal(claseDeCapa('CONCESIÓN NO METÁLICA EN SOLICITUD DE EXPLORAR'), 'No metálica');
  assert.equal(claseDeCapa('ARTESANAL METALICA DELIMITADA'), 'Minería artesanal');
  assert.equal(claseDeCapa(null), 'Sin clase en la capa');
});

test('la clase del padrón, con las tildes que perdió el .dbf', () => {
  assert.equal(normalizarClase('Peque?a Min. No Met?lica'), 'Pequeña Minería No Metálica');
  assert.equal(normalizarClase('Peque?a Miner?a Met?lica'), 'Pequeña Minería Metálica');
  assert.equal(normalizarClase('Banco de Pr?stamo'), 'Banco de Préstamo');
  assert.equal(normalizarClase('Artesanal No Metálica'), 'Artesanal No Metálica');
  assert.equal(normalizarClase(''), null);
});

test('el nombre para decir en voz alta, sin notas del padrón', () => {
  assert.equal(nombreParaDecir('El Mochito. (GRAVADO CON PRIMERA HIPOTECA)'), 'El Mochito');
  assert.equal(nombreParaDecir('Macuelizo'), 'Macuelizo');
});

test('en las listas del tablero, la nota del padrón va aparte del nombre', () => {
  assert.deepEqual(partirNombre('El Mochito. (GRAVADO CON PRIMERA HIPOTECA)'), { nombre: 'El Mochito', nota: 'gravado con primera hipoteca' });
  assert.deepEqual(partirNombre('Monte Redondo (Embargo)'), { nombre: 'Monte Redondo', nota: 'embargo' });
  assert.deepEqual(partirNombre('Macuelizo'), { nombre: 'Macuelizo', nota: null });
  assert.deepEqual(partirNombre('(sin nombre)'), { nombre: '(sin nombre)', nota: null });
});

test('tablero nacional, contra PostGIS', { skip: hayBase() ? false : 'sin ELECTRUM_DB_URL' }, async () => {
  await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
  await guardarCapa(
    capa('CONCESION METALICA OTORGADA PARA EXPLOTAR', [
      [{ NOMBRE: 'Cerro Azul', ESTADO: 'Otorgada', TITULAR: 'Minera Azul' }, caja(-87.2, 14.8, -87.18, 14.82)],
      [{ NOMBRE: 'La Vecina', ESTADO: 'Explotar', TITULAR: 'Minera Vecina' }, caja(-87.19, 14.8, -87.17, 14.82)],
    ]),
    { comoConcesiones: true }
  );
  await guardarCapa(capa('ARTESANAL METALICA DELIMITADA', [[{ NOMBRE: 'El Guirisero', ESTADO: 'Delimitada' }, caja(-86.5, 14.2, -86.49, 14.21)]]), { comoConcesiones: true });
  await recalcularTraslapes();
  for (const c of [
    capa('Areas Protegidas', [[{ NOMBRE: 'Reserva Azul' }, caja(-87.19, 14.79, -87.1, 14.83)]]),
    capa('Microcuencas declaradas', [[{ NOMBRE: 'Microcuenca El Oro' }, caja(-87.3, 14.79, -87.195, 14.805)]]),
    capa('CASERIOS', [
      [{ NOMBRE: 'Todo el país' }, caja(-90, 12, -83, 17)],
      [{ NOMBRE: 'Las Minitas' }, punto(-87.195, 14.81)],
      [{ NOMBRE: 'El Pino' }, punto(-87.185, 14.815)],
    ]),
    capa('DEPARTAMENTOS', [
      [{ NOMBRE: 'Santa Bárbara' }, caja(-88, 14.5, -87, 15.5)],
      [{ NOMBRE: 'Olancho' }, caja(-87, 14, -85, 15.5)],
    ]),
  ]) {
    await guardarCapa(c, { comoConcesiones: false });
  }
  olvidarTablero();
  const t = await tablero();
  assert.equal(t.total.concesiones, 3);
  assert.deepEqual(
    t.porClase.map((c) => [c.nombre, c.n]),
    [['Metálica', 2], ['Minería artesanal', 1]]
  );
  assert.deepEqual(
    t.porDepartamento.map((d) => [d.nombre, d.n]),
    [['Santa Bárbara', 2], ['Olancho', 1]]
  );
  assert.equal(t.traslapes.total, 1);
  assert.equal(t.traslapes.mayores[0].ha > 0, true);
  assert.deepEqual(t.traslapes.mismoNombre, { total: 0, hectareas: 0 });
  // Un duplicado del padrón (misma concesión, mismo nombre, cargada dos veces) no va a la lista.
  await consulta(`INSERT INTO concesion (nombre, estado, geom) SELECT nombre, estado, geom FROM concesion WHERE nombre = 'El Guirisero'`);
  await recalcularTraslapes();
  olvidarTablero();
  const conDuplicado = await tablero();
  assert.equal(conDuplicado.traslapes.mismoNombre.total, 1);
  assert.ok(conDuplicado.traslapes.mayores.every((m) => m.a !== m.b));
  await consulta(`DELETE FROM concesion WHERE id = (SELECT max(id) FROM concesion WHERE nombre = 'El Guirisero')`);
  await recalcularTraslapes();
  olvidarTablero();
  // La columna CLASIFICAC del padrón manda sobre el nombre de la capa, venga la llave en mayúsculas o no.
  await consulta(`UPDATE concesion SET atributos = jsonb_build_object('CLASIFICAC', 'Peque?a Miner?a Met?lica') WHERE nombre = 'Cerro Azul'`);
  await consulta(`UPDATE concesion SET atributos = jsonb_build_object('clasificac', 'Banco de Pr?stamo') WHERE nombre = 'La Vecina'`);
  olvidarTablero();
  const conClase = await tablero();
  const clases = new Map(conClase.porClase.map((c) => [c.nombre, c.n]));
  assert.equal(clases.get('Pequeña Minería Metálica'), 1);
  assert.equal(clases.get('Banco de Préstamo'), 1);
  await consulta(`UPDATE concesion SET atributos = '{}'::jsonb WHERE nombre IN ('Cerro Azul', 'La Vecina')`);
  olvidarTablero();
  // Reserva Azul pisa la mitad este de Cerro Azul (0,01°) y toda La Vecina.
  assert.equal(t.areasProtegidas!.concesiones, 2);
  const vecina = t.areasProtegidas!.lista.find((c) => c.concesion === 'La Vecina')!;
  assert.ok(vecina.pct > 99, `pct ${vecina.pct}`);
  assert.equal(t.areasProtegidas!.lista[0].con, 'Reserva Azul');
  assert.equal(t.microcuencas!.concesiones, 1);
  assert.equal(t.microcuencas!.lista[0].concesion, 'Cerro Azul');
  assert.deepEqual(t.incompletas, [], 'todo llegó a tiempo');
  // El polígono que cubre todo no cuenta: solo los dos caseríos (puntos) dentro de las concesiones.
  assert.equal(t.poblados!.caserios, 3, JSON.stringify(t.poblados)); // El Pino cae en las dos que se traslapan
  assert.ok(t.poblados!.lista.every((p) => !p.nombres.includes('Todo el país')));
  // Caché: el segundo pedido no recalcula.
  const t2 = await tablero();
  const t3 = await tablero();
  assert.equal(t3.generado, t2.generado);
});
