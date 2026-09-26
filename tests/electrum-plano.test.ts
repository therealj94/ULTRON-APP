/**
 * El plano de situación, sin base: lo que tiene que llevar un plano técnico para servir de algo.
 *
 * Una captura bonita sin escala, sin norte y sin coordenadas no ubica nada en el terreno; y un
 * JPEG que no es JPEG hace que el escritor de PDF incruste basura con membrete. Las dos cosas se
 * comprueban acá con datos de mentira en metros UTM, sin PostGIS ni navegador.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import { ALTO, ANCHO, intervaloCuadricula, jpegDeSvg, miles, svgPlano, type DatosPlano } from '../server/electrum/plano';
import { rolDeCapa } from '../server/electrum/db';
import { medirJpeg } from '../lib/pdf';

const cuadrado = (x: number, y: number, lado: number) => ({
  type: 'Polygon' as const,
  coordinates: [[[x, y], [x + lado, y], [x + lado, y + lado], [x, y + lado], [x, y]]],
});

/** Una concesión de 2 × 2 km en UTM 16N cerca de Danlí, con un poco de todo alrededor. */
export const DATOS: DatosPlano = {
  titulo: 'Plano de situación — Cerro de Prueba',
  subtitulo: 'Expediente EXP-0001 · Minera de Prueba S.A.',
  vista: [510_000, 1_546_000, 516_000, 1_552_400],
  convergencia: 0.03,
  concesion: { nombre: 'Cerro de Prueba', geom: cuadrado(512_000, 1_548_000, 2000), etiqueta: [513_000, 1_549_000] },
  vecinas: [{ nombre: 'La Vecina', geom: cuadrado(513_500, 1_549_500, 1500), etiqueta: [514_300, 1_550_300] }],
  traslapes: [cuadrado(513_500, 1_549_500, 500)],
  rios: [{ nombre: 'Río Chiquito', geom: { type: 'LineString', coordinates: [[510_000, 1_549_100], [512_500, 1_549_300], [516_000, 1_549_000]] } }],
  areasProtegidas: [{ nombre: 'Reserva El Chile', geom: cuadrado(513_400, 1_547_000, 3000) }],
  microcuencas: [{ nombre: 'Microcuenca Chiquito', geom: cuadrado(510_500, 1_546_200, 3000) }],
  forestal: [],
  carretera: [{ nombre: 'CA-6', geom: { type: 'LineString', coordinates: [[510_000, 1_551_800], [516_000, 1_551_600]] } }],
  municipios: [{ nombre: 'Danlí', geom: cuadrado(505_000, 1_540_000, 9000) }],
  zonasInformales: [{ nombre: 'Guiriseros', geom: { type: 'Point', coordinates: [515_200, 1_547_400] } }],
  ocurrencias: [{ nombre: 'Veta Vieja', geom: { type: 'Point', coordinates: [512_600, 1_548_700] } }],
  poblados: [
    { nombre: 'El Naranjal', tipo: 'caserío', geom: { type: 'Point', coordinates: [512_800, 1_551_000] } },
    { nombre: 'San Antonio', tipo: 'aldea', geom: { type: 'Point', coordinates: [511_000, 1_547_500] } },
  ],
  faltan: ['patrimonio forestal'],
  pie: 'Dr Electrum FP · prueba',
};

test('el plano lleva lo que hace de él un plano', async (t) => {
  const svg = svgPlano(DATOS);

  await t.test('título, leyenda, escala y norte', () => {
    assert.match(svg, /Plano de situación — Cerro de Prueba/);
    assert.match(svg, />Leyenda</);
    assert.match(svg, /Escala 1:\d[\d ]*/);
    assert.match(svg, />N</, 'la flecha de norte lleva su N');
    assert.match(svg, /norte de cuadrícula/);
    // La barra: cuatro tramos alternos, blanco y negro.
    assert.equal((svg.match(/height="12" fill="#(111111|ffffff)"/g) || []).length, 4);
  });

  await t.test('la leyenda solo nombra lo que se dibujó, y empieza por la concesión', () => {
    const leyenda = [...svg.matchAll(/<text x="1280" y="\d+"[^>]*>([^<]+)<\/text>/g)].map((m) => m[1]);
    assert.equal(leyenda[0], 'Concesión');
    for (const e of ['Otras concesiones', 'Traslape con otro derecho', 'Área protegida', 'Microcuenca declarada', 'Río o quebrada', 'Carretera', 'Caserío', 'Aldea', 'Yacimiento u ocurrencia']) {
      assert.ok(leyenda.includes(e), `falta «${e}» en ${leyenda.join(', ')}`);
    }
    assert.ok(!leyenda.includes('Patrimonio forestal'), 'no hay forestal en la vista: no va en la leyenda');
    // La nota se parte en renglones: se mira que diga las dos cosas, no que caigan en el mismo.
    assert.match(svg, /Capas no cargadas \(no se dibujan\):/);
    assert.match(svg, />[^<]*patrimonio forestal\.<\/text>/);
  });

  await t.test('cuadrícula UTM rotulada en metros, cada tanto redondo', () => {
    assert.equal(intervaloCuadricula(6000), 1000);
    assert.equal(miles(1548000), '1 548 000');
    assert.match(svg, />512 000 E</);
    assert.match(svg, />1 548 000 N</);
    assert.match(svg, /EPSG:32616/);
  });

  await t.test('los rótulos llevan halo y no se escapan del SVG', () => {
    const raro = svgPlano({ ...DATOS, concesion: { ...DATOS.concesion, nombre: 'Rosa & <Hijos>' } });
    assert.match(raro, /Rosa &amp; &lt;Hijos&gt;/);
    assert.doesNotMatch(raro, /Rosa & </);
  });

  await t.test('el JPEG es un JPEG, del tamaño del lienzo, y el texto se dibuja', async () => {
    const j = await jpegDeSvg(svg);
    assert.equal(j[0], 0xff);
    assert.equal(j[1], 0xd8);
    assert.deepEqual(medirJpeg(j), { ancho: ANCHO, alto: ALTO, componentes: 3 });
    /*
     * Que haya texto de verdad y no cajas vacías: un SVG con SOLO una palabra, rasterizado con la
     * tipografía del repositorio, tiene que dejar píxeles oscuros. Sin fuente cargada, resvg no
     * dibuja nada y esto da cero.
     */
    const solo = await jpegDeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><text x="10" y="44" font-family="Liberation Sans" font-size="40">Norte</text></svg>');
    const px = jpeg.decode(solo, { useTArray: true });
    let oscuros = 0;
    for (let i = 0; i < px.data.length; i += 4) if (px.data[i] < 100) oscuros += 1;
    assert.ok(oscuros > 200, `solo ${oscuros} píxeles oscuros: el texto no se dibujó`);
  });
});

test('el rol de una capa sale de su nombre', () => {
  const casos: Array<[string, string | null]> = [
    ['RED HIDRICA HN', 'rio'],
    ['RED_HIDRICA_HN', 'rio'],
    ['CASERIOS', 'poblado'],
    ['ALDEAS', 'poblado'],
    ['Microcuencas declaradas', 'microcuenca'],
    ['Buffer Carretera HN', 'carretera'],
    ['Áreas Protegidas', 'area_protegida'],
    ['MUNICIPIOS', 'municipio'],
    ['DEPARTAMENTOS', 'departamento'],
    ['Zonas informales oro HN', 'zona_informal'],
    ['Catalogo Patrimonio Publico Forestal', 'forestal'],
    ['Yacimientos y ocurrencias mineras DEFOMIN', 'ocurrencia'],
    // Los que NO tienen que casar: una palabra corta dentro de otra no es la palabra.
    ['Depositos aluviales', null],
    ['Estructuras geologicas', null],
    ['Concesiones Otorgadas', null],
    // El orden importa: un parque con bosque es área protegida, unas aldeas del municipio son aldeas.
    ['Parque Nacional Bosque Nublado', 'area_protegida'],
    ['Aldeas del municipio', 'poblado'],
  ];
  for (const [nombre, rol] of casos) assert.equal(rolDeCapa(nombre), rol, nombre);
});
