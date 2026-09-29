/**
 * NAD27 ↔ WGS84: INHGEOMIN recibe los planos en NAD27 con cuadrícula en múltiplos de 100; ICF y
 * SERNA, en WGS84. El mismo punto se corre unos 200 m entre uno y otro.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { convertir, leerSistema, mapearGeometria, sistemaPara, utmWgsANad27, zonaDe } from '../server/electrum/datum';
import { aNad27, intervaloCuadricula, svgPlano, type DatosPlano } from '../server/electrum/plano';
import { MANOS } from '../server/electrum/manos';
import { convocar, herramientasDe } from '../server/electrum/especialistas';

const W = { datum: 'WGS84', forma: 'utm', zona: 16 } as const;
const N = { datum: 'NAD27', forma: 'utm', zona: 16 } as const;
const G = { datum: 'WGS84', forma: 'geo' } as const;

test('datum: el corrimiento NAD27–WGS84 en Honduras es de unos 200 m al norte', () => {
  const w = convertir([-86.2, 14.1], G, W);
  const n = convertir(w, W, N);
  assert.ok(Math.abs(n[0] - w[0]) < 20, `este: ${n[0] - w[0]}`);
  assert.ok(n[1] - w[1] < -180 && n[1] - w[1] > -230, `norte: ${n[1] - w[1]}`);
  const vuelta = convertir(n, N, W);
  assert.ok(Math.hypot(vuelta[0] - w[0], vuelta[1] - w[1]) < 0.01);
});

test('datum: cada institución con su sistema, y se entiende cómo se escribe', () => {
  assert.equal(sistemaPara('INHGEOMIN').datum, 'NAD27');
  assert.equal(sistemaPara('ICF').datum, 'WGS84');
  assert.equal(sistemaPara('SERNA').datum, 'WGS84');
  assert.deepEqual(leerSistema('NAD 27 UTM'), { datum: 'NAD27', forma: 'utm', zona: 16 });
  assert.deepEqual(leerSistema('WGS84 geográficas'), { datum: 'WGS84', forma: 'geo', zona: 16 });
  assert.deepEqual(leerSistema('wgs84 utm zona 17'), { datum: 'WGS84', forma: 'utm', zona: 17 });
  assert.equal(leerSistema('coordenadas'), null);
  assert.equal(zonaDe(-86), 16);
  assert.equal(zonaDe(-83.5), 17);
  const g = mapearGeometria({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, ([x, y]) => [x + 1, y]);
  assert.deepEqual((g as any).coordinates[0][1], [2, 0]);
});

test('plano: la cuadrícula siempre cae en múltiplos de 100 m', () => {
  for (const ancho of [300, 800, 1500, 2600, 6000, 14000, 33000]) {
    const p = intervaloCuadricula(ancho);
    assert.equal(p % 100, 0, `${ancho} → ${p}`);
    assert.ok(p >= 100);
  }
});

const poli = (x: number, y: number, l: number) => ({ type: 'Polygon' as const, coordinates: [[[x, y], [x + l, y], [x + l, y + l], [x, y + l], [x, y]]] });
const BASE: DatosPlano = {
  titulo: 'La Prueba',
  vista: [585000, 1557500, 588000, 1560700],
  concesion: { nombre: 'La Prueba', geom: poli(586000, 1558500, 1000) },
  vecinas: [],
  traslapes: [],
  rios: [],
  areasProtegidas: [],
  microcuencas: [],
  forestal: [],
  carretera: [],
  municipios: [],
  zonasInformales: [],
  ocurrencias: [],
  poblados: [],
  cajetin: [['Titular', 'Minera Prueba'], ['Expediente', '123']],
};

test('plano: en NAD27 se corre todo, se rotula el datum y lleva la casilla de firma y sello', () => {
  const d = aNad27({ ...BASE, firma: true, presentadoA: 'INHGEOMIN' });
  assert.equal(d.datum, 'NAD27');
  const esperado = utmWgsANad27([586000, 1558500]);
  assert.deepEqual((d.concesion.geom as any).coordinates[0][0], esperado);
  assert.ok(d.vista[1] < BASE.vista[1] - 150);
  const svg = svgPlano(d);
  assert.match(svg, /NAD27 \/ UTM zona 16N \(EPSG:26716\)/);
  assert.match(svg, /FIRMA Y SELLO DEL INGENIERO RESPONSABLE/);
  assert.match(svg, /Para INHGEOMIN/);
  // Los rótulos de la cuadrícula terminan en 00.
  const rotulos = [...svg.matchAll(/>(\d{3}) (\d{3}) E</g)].map((m) => Number(m[1] + m[2]));
  assert.ok(rotulos.length >= 2);
  for (const r of rotulos) assert.equal(r % 100, 0);
  // Sin «presentar a», ficha de consulta: WGS84 y sin casilla.
  const consulta = svgPlano(BASE);
  assert.match(consulta, /EPSG:32616/);
  assert.doesNotMatch(consulta, /FIRMA Y SELLO/);
});

test('coordenadas_convertir: convierte y dice cuánto se corre', async () => {
  const r = await MANOS.coordenadas_convertir.ejecutar({ puntos: [[586358, 1558933]], desde: 'WGS84 UTM', presentar_a: 'INHGEOMIN' }, {} as never);
  assert.equal(r.ok, true);
  assert.match(r.texto, /NAD27 \/ UTM zona 16N/);
  assert.match(r.texto, /se corre 20\d m/);
  const mal = await MANOS.coordenadas_convertir.ejecutar({ puntos: [[-86.2, 14.1]], desde: 'NAD27 UTM', hacia: 'WGS84 UTM' }, {} as never);
  assert.equal(mal.ok, false);
  assert.ok(herramientasDe(convocar('Convertí estas coordenadas de NAD27 a WGS84 para el ICF')).includes('coordenadas_convertir'));
});

test('plano: en NAD27 el cajetín también dice NAD27 (no el WGS 84 de datosPlano)', () => {
  const d = aNad27({ ...BASE, cajetin: [['Titular', 'Minera Prueba'], ['Datum', 'WGS 84 / UTM 16N']] });
  assert.deepEqual(d.cajetin?.find(([k]) => k === 'Datum'), ['Datum', 'NAD27 / UTM 16N']);
  assert.doesNotMatch(svgPlano(d), /WGS 84 \/ UTM 16N/);
});
