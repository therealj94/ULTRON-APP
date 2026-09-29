/**
 * El guion del recorrido sale de los datos: la zona con más mapas escaneados, su mejor concesión,
 * el foco de oro de las muestras y las frases de la ficha, con renglones como los de producción.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { analisisDeFicha, concesionesEn, focoDeOro, nombreDePila, saludoHonduras, vencimientos, zonaMasRica, type Encuadre } from '../src-electrum/demo/guion';

const OLANCHO: Encuadre = [-87, 14.6079, -86.4999, 15.3967];
const HN: Encuadre = [-89.4, 12.9, -83.1, 16.6];
const caja = (x: number, y: number) => ({ type: 'Polygon', coordinates: [[[x, y], [x + 0.02, y], [x + 0.02, y + 0.02], [x, y + 0.02], [x, y]]] });

test('la zona con más información es la que junta más mapas escaneados, y los nacionales no cuentan', () => {
  const z = zonaMasRica([
    { clave: 's2-veg', nombre: 'Caída de vegetación', encuadre: HN },
    { clave: 's2-arc', nombre: 'Arcillas', encuadre: HN },
    { clave: 'jica-olancho-anomalias-cu', nombre: 'Anomalías geoquímicas de Cu en Olancho (JICA)', encuadre: OLANCHO },
    { clave: 'jica-olancho-estructural', nombre: 'Mapa estructural de Olancho (JICA)', encuadre: OLANCHO },
    { clave: 'jica-olancho-geologico', nombre: 'Mapa geológico de Olancho (JICA)', encuadre: OLANCHO },
    { clave: 'otro', nombre: 'Mapa de Yoro', encuadre: [-87.5, 15, -87, 15.5] },
  ]);
  assert.equal(z?.nombre, 'Olancho');
  assert.deepEqual(z?.mapas.map((m) => m.clave), ['jica-olancho-geologico', 'jica-olancho-estructural', 'jica-olancho-anomalias-cu'], 'geología, estructura, anomalías');
  assert.equal(zonaMasRica([{ clave: 's2-veg', nombre: 'x', encuadre: HN }]), null);
});

test('las concesiones de la zona, de mayor a menor prospectividad', () => {
  const lista = concesionesEn(
    {
      features: [
        { geometry: caja(-86.65, 14.63), properties: { id: 1080, nombre: 'Concordia VI', hectareas: 1000, prosp: 56 } },
        { geometry: caja(-86.64, 14.71), properties: { id: 193, nombre: 'Midas I', hectareas: 1000, prosp: 51 } },
        { geometry: caja(-88.1, 14.8), properties: { id: 149, nombre: 'El Mochito', hectareas: 8200, prosp: 27 } },
      ],
    },
    OLANCHO
  );
  assert.deepEqual(lista.map((x) => x.id), [1080, 193]);
});

test('el foco de oro: la muestra más alta en g/t y el racimo alrededor', () => {
  const p = (x: number, y: number, au: number) => ({ geometry: { type: 'Point', coordinates: [x, y] }, properties: { au } });
  const f = focoDeOro({ features: [p(-87.73, 14.28, 16650), p(-87.75, 14.3, 1200), p(-86.58, 14.1, 10000), p(-86, 14, 5)] });
  assert.equal(f?.total, 4);
  assert.equal(f?.maxGt, 16.65);
  assert.equal(f?.sobreUnGramo, 3);
  assert.ok(Math.abs(f!.centro[0] + 87.74) < 0.02, 'el centro es el racimo del más alto, no el promedio del país');
  assert.equal(focoDeOro({ features: [] }), null);
});

test('las frases de la ficha, como se dicen en voz alta', () => {
  const frases = analisisDeFicha({
    id: 1080,
    nombre: 'Concordia VI',
    datos: [
      ['Titular', 'BRAEVAL Minera Honduras S.A.'],
      ['Área medida', '1000,81 ha'],
    ],
    entorno: {
      estado: 'ok',
      renglones: [
        '4 aldeas dentro (El Portillo, Villa Vieja, El Tigre, Concordia).',
        'Población declarada dentro: 965 personas, según la capa.',
        'Dentro de 20 zonas de minería informal (sin nombre en la capa, y 17 más).',
        'Se pisa con 8 otros derechos: Nayla I (131 ha), Nayla I (123 ha) y 6 más.',
      ],
    },
    geologia: {
      estado: 'ok',
      renglones: [
        'Tracto permisivo: Tracto Chortis (pórfido de cobre) (100 %).',
        '4 yacimiento(s) u ocurrencia(s) en 10 km: Concordia (oro, plata, plomo, zinc, cobre) a 10 m; Concordia (cobre) a 6,2 km.',
        'Indicios: alto — pórfido de cobre (y oro), skarn de cobre, zinc u oro, vetas relacionadas con intrusivos.',
      ],
    },
    satelite: { estado: 'ok', renglones: ['Suelo expuesto: 26 ha de 1,032. Anomalía de arcillas (alteración argílica/sericítica): 6.6 ha, 2.4 alta o muy alta.'] },
    prospectividad: { estado: 'ok', renglones: [], puntaje: 56, nivel: 'alta' },
  });
  assert.deepEqual(frases, [
    'Esta es Concordia VI, de BRAEVAL Minera Honduras S.A., con 1001 hectáreas.',
    'Su prospectividad es de 56 sobre 100, alta.',
    'Los indicios geológicos son de nivel alto: pórfido de cobre, skarn de cobre, zinc u oro, vetas relacionadas con intrusivos.',
    'Hay 4 yacimientos u ocurrencias registrados a menos de 10 kilómetros; el más cercano, Concordia, de oro, plata, plomo, zinc y cobre, está a 10 metros.',
    'Está dentro de un tracto permisivo para pórfido de cobre del Servicio Geológico de Estados Unidos.',
    'Dentro hay 4 aldeas y viven 965 personas: la parte social se mira desde el primer día.',
    'Se cruza con 20 zonas de minería informal.',
    'Y se traslapa con otros 8 derechos mineros.',
    'Desde el satélite veo alteración por arcillas en 6,6 hectáreas: una guía para ir a campo.',
  ]);
  // Una ficha sin nada más que el nombre no inventa frases.
  assert.deepEqual(analisisDeFicha({ id: 1, nombre: 'Sola' }), ['Esta es Sola.']);
});

test('el saludo va con la hora de Honduras (UTC−6), no la del navegador', () => {
  // 13:30 UTC = 7:30 en Tegucigalpa; 19:00 UTC = 13:00; 01:00 UTC = 19:00 del día anterior.
  assert.equal(saludoHonduras(new Date('2026-09-28T13:30:00Z')), 'Buenos días');
  assert.equal(saludoHonduras(new Date('2026-09-28T19:00:00Z')), 'Buenas tardes');
  assert.equal(saludoHonduras(new Date('2026-09-29T01:00:00Z')), 'Buenas noches');
  assert.equal(saludoHonduras(new Date('2026-09-28T10:59:00Z')), 'Buenas noches', '4:59 todavía es de noche');
  assert.equal(saludoHonduras(new Date('2026-09-28T11:00:00Z')), 'Buenos días', '5:00 ya es de día');
  assert.equal(saludoHonduras(new Date('2026-09-29T00:00:00Z')), 'Buenas noches', '18:00 ya es de noche');
});

test('se saluda por el nombre de pila, sin tratamientos ni nombres genéricos', () => {
  assert.equal(nombreDePila('José Ordóñez'), 'José');
  assert.equal(nombreDePila('Medardo Ordóñez'), 'Medardo');
  assert.equal(nombreDePila('keidy'), 'Keidy');
  assert.equal(nombreDePila('Ing. María López'), 'María');
  assert.equal(nombreDePila('Lic Carlos'), 'Carlos');
  assert.equal(nombreDePila('Invitado'), null);
  assert.equal(nombreDePila(''), null);
  assert.equal(nombreDePila('a@b.com'), null);
});

test('vencimientos: en 90 días, en el año y vencidas; las fechas imposibles no cuentan', () => {
  const f = (vence: string | null) => ({ type: 'Feature', geometry: caja(-86.5, 14.8), properties: vence ? { vence } : {} });
  const catastro = { features: [f('2026-10-15'), f('2027-03-01'), f('2028-01-01'), f('2025-01-01'), f('1899-11-30'), f(null)] } as any;
  assert.deepEqual(vencimientos(catastro, new Date('2026-09-28T12:00:00Z')), { noventa: 1, anio: 2, vencidas: 1 });
  assert.deepEqual(vencimientos(null), { noventa: 0, anio: 0, vencidas: 0 });
});
