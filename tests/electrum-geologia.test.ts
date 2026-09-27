/**
 * La geología de Dr Electrum: el paquete abierto (data/geologia), el análisis de una zona
 * (geologia.ts), los tres mapas (mapa-geologico.ts), las herramientas y el informe en PDF.
 *
 * Lo puro se prueba sin base. Lo demás contra PostGIS de verdad (ELECTRUM_DB_URL; sin ella, se
 * salta), cargando el paquete real: el caso de prueba es Minas de Oro, Comayagua, un distrito de
 * cobre y oro conocido, y el análisis tiene que encontrar lo que se sabe de él.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { claseDeRoca, geologiaDe, geologiaEnTexto, indiciosDe, roseta, rumboTexto, type Geologia } from '../server/electrum/geologia';
import { cargarGeologia, paisesRegion, paqueteGeologia } from '../server/electrum/geologia-datos';
import { mapaGeologico, svgMapaGeologico, type DatosMapaGeo } from '../server/electrum/mapa-geologico';
import { informeGeologico } from '../server/electrum/informe-geologico';
import { manosDe } from '../server/electrum/manos';
import { tomarInforme } from '../server/electrum/informe';
import { cerrarBase, consulta, hayBase, rolDeCapa } from '../server/electrum/db';
import { convocar } from '../server/electrum/especialistas';

const MINAS_DE_ORO = { lon: -87.35, lat: 14.78, radioKm: 10 };

/* ------------------------------------------------------------------ sin base */

test('rumbos como se escriben en geología', () => {
  assert.equal(rumboTexto(45), 'N45°E');
  assert.equal(rumboTexto(135), 'N45°W');
  assert.equal(rumboTexto(225), 'N45°E', 'un rumbo es un eje: 225° es el mismo que 45°');
  assert.equal(rumboTexto(0), 'N–S');
  assert.equal(rumboTexto(90), 'E–W');
});

test('la roseta: la dirección media de ejes por ángulo doble, y las familias', () => {
  // Dos fallas NE casi paralelas y una corta NW.
  const r = roseta([
    { type: 'LineString', coordinates: [[-87.4, 14.7], [-87.3, 14.8]] },
    { type: 'LineString', coordinates: [[-87.42, 14.72], [-87.32, 14.82]] },
    { type: 'LineString', coordinates: [[-87.35, 14.75], [-87.36, 14.76]] },
  ]);
  assert.match(r.dominante!, /^N4\d°E$/);
  assert.ok(r.concentracion > 0.8, `concentración ${r.concentracion}`);
  assert.equal(r.familias[0].desde, 40);
  assert.ok(r.kmMedidos > 25 && r.kmMedidos < 35, `${r.kmMedidos} km`);
  // 10° y 170° son casi la misma dirección: su media es N–S, no E–W.
  const casiNS = roseta([
    { type: 'LineString', coordinates: [[0, 0], [Math.sin(0.1745) * 0.1, Math.cos(0.1745) * 0.1]] },
    { type: 'LineString', coordinates: [[0, 0], [-Math.sin(0.1745) * 0.1, Math.cos(0.1745) * 0.1]] },
  ]);
  assert.equal(casiNS.dominante, 'N–S');
  assert.deepEqual(roseta([]).familias, []);
});

test('la clase de una roca por su descripción, para capas que no la traen', () => {
  assert.equal(claseDeRoca('Granodiorita del batolito de Minas de Oro'), 'intrusiva');
  assert.equal(claseDeRoca('Tobas e ignimbritas del Grupo Padre Miguel'), 'volcanica');
  assert.equal(claseDeRoca('Calizas del Grupo Yojoa'), 'sedimentaria');
  assert.equal(claseDeRoca('Esquistos y filitas de Cacaguapa'), 'metamorfica');
  assert.equal(claseDeRoca('Serpentinita'), 'ultramafica');
  assert.equal(claseDeRoca('Aluvión reciente'), 'aluvial');
});

test('los indicios se explican uno por uno, y sin capas no inventan nada', () => {
  const base: Geologia = {
    zona: { nombre: 'Prueba', tipo: 'punto', ha: 1000, lon: -87, lat: 14.5, geojson: { type: 'Point', coordinates: [-87, 14.5] } },
    radioKm: 10,
    fuentes: {},
    faltan: [],
    escala: null,
    litologia: { dentro: [], cerca: [], coberturaPct: 0 },
    intrusivos: { dentro: [], cerca: [], kmContactoDentro: 0, kmAlContacto: null, kmContactoCarbonato: 0 },
    fallas: { dentro: [], cerca: [], kmDentro: 0, densidad: null, rumbos: roseta([]), intersecciones: [], activaMasCercana: null },
    tectonica: { placas: [], provincias: [] },
    recursos: { tractos: [], yacimientos: [], porMineral: [], porTipo: [] },
    indicios: { nivel: 'sin indicios', puntos: 0, criterios: [], modelos: [] },
    ms: 0,
  };
  const vacio = indiciosDe(base);
  assert.equal(vacio.nivel, 'sin indicios');
  assert.deepEqual(vacio.criterios, [], 'sin capas no hay criterios que evaluar');

  const conPluton = indiciosDe({
    ...base,
    fuentes: { litologia: ['mapa'], falla: ['fallas'] },
    intrusivos: { ...base.intrusivos, dentro: [{ unidad: 'Ti', descripcion: 'Plutones terciarios', edad: 'Terciario', clase: 'intrusiva', ha: 50, pct: 5, km: 0, capa: 'mapa' }], kmContactoCarbonato: 3 },
    fallas: { ...base.fallas, dentro: [{ nombre: 'Falla X', tipo: 'normal', activa: false, certeza: '', capa: 'fallas', kmDentro: 4, km: 0 }], kmDentro: 4 },
  });
  assert.equal(conPluton.nivel, 'medio');
  assert.ok(conPluton.modelos.includes('skarn de cobre, zinc u oro'));
  const skarn = conPluton.criterios.find((c) => c.clave === 'skarn')!;
  assert.equal(skarn.cumple, true);
  assert.match(skarn.evidencia, /3 km/);
});

test('el paquete de geología: ocho capas con su rol, y los países aparte', () => {
  const p = paqueteGeologia();
  assert.equal(p.length, 8);
  const roles = Object.fromEntries(p.map((x) => [x.capa.nombre, rolDeCapa(x.capa.nombre)]));
  assert.equal(roles['Geología superficial USGS Caribe 1:2.5M'], 'litologia');
  assert.equal(roles['Fallas geológicas USGS Caribe 1:2.5M'], 'falla');
  assert.equal(roles['Fallas activas GEM Centroamérica'], 'falla');
  assert.equal(roles['Límites de placas tectónicas PB2002'], 'placa');
  assert.equal(roles['Provincias geológicas USGS Caribe'], 'provincia_geologica');
  assert.equal(roles['Tractos permisivos pórfido de cobre USGS'], 'tracto_permisivo');
  assert.equal(roles['Yacimientos MRDS USGS'], 'ocurrencia');
  const lito = p.find((x) => x.capa.nombre.startsWith('Geología'))!;
  assert.ok(lito.capa.geojson.features.some((f) => f.properties?.CLASE_ROCA === 'intrusiva'));
  assert.ok(paisesRegion().features.some((f) => f.properties?.NOMBRE === 'Honduras'));
});

test('el SVG del mapa: la leyenda dice lo que se dibujó, y el pie la escala de la fuente', () => {
  const d: DatosMapaGeo = {
    tipo: 'estructural',
    titulo: 'Mapa estructural — Prueba',
    proyeccion: 'utm16',
    vista: [0, 0, 10000, 10660],
    zona: { nombre: 'Prueba', geom: { type: 'Polygon', coordinates: [[[4000, 4000], [6000, 4000], [6000, 6000], [4000, 6000], [4000, 4000]]] }, etiqueta: [5000, 5000] },
    unidades: [{ unidad: 'Ti', descripcion: 'Plutones terciarios', clase: 'intrusiva', geom: { type: 'Polygon', coordinates: [[[0, 0], [5000, 0], [5000, 5000], [0, 5000], [0, 0]]] }, etiqueta: [2500, 2500], areaM2: 25e6 }],
    fallas: [
      { nombre: 'Falla Guayape', tipo: 'de rumbo sinestral', activa: true, certeza: '', geom: { type: 'LineString', coordinates: [[0, 0], [10000, 10000]] } },
      { nombre: 'Falla sin nombre en el mapa', tipo: 'normal o de bloque hundido', activa: false, certeza: 'aproximada', geom: { type: 'LineString', coordinates: [[0, 10000], [10000, 0]] } },
    ],
    yacimientos: [{ nombre: 'Veta Vieja', mineral: 'oro', geom: { type: 'Point', coordinates: [5000, 5000] } }],
    cruces: [[5000, 5000]],
    tractos: [], placas: [], provincias: [], paises: [],
    rumbos: roseta([{ type: 'LineString', coordinates: [[-87.4, 14.7], [-87.3, 14.8]] }]),
    escalaFuente: '1:2 500 000',
  };
  const svg = svgMapaGeologico(d);
  assert.match(svg, /^<svg /);
  for (const t of ['Falla activa \\(GEM\\)', 'Falla normal o de bloque hundido', 'Traza aproximada o inferida', 'Cruce de fallas', 'Yacimiento: oro', 'Roseta de rumbos de falla', 'Rumbo dominante N4\\d°E', '1:2 500 000']) {
    assert.match(svg, new RegExp(t), `falta «${t}»`);
  }
  assert.doesNotMatch(svg, /Falla de rumbo</, 'la activa se dibuja como activa, no por su cinemática');
});

test('los pedidos de geología convocan al geólogo, y el geólogo tiene las herramientas nuevas', () => {
  for (const m of ['hazme un mapa estructural de Minas de Oro', 'qué intrusivos hay cerca de Tule', 'el marco geotectónico de Olancho', 'rumbo de las fallas en la concesión', 'potencial minero de esta zona']) {
    const panel = convocar(m);
    const geo = panel.find((e) => e.id === 'geologo');
    assert.ok(geo, `«${m}» no convocó al geólogo: ${panel.map((e) => e.id).join(', ')}`);
    assert.ok(geo!.herramientas.includes('geologia_zona') && geo!.herramientas.includes('mapa_geologico'));
  }
});

test('geomática, que es a quien se convoca por «mapa», también dibuja los mapas geológicos', async () => {
  const { ESPECIALISTAS } = await import('../server/electrum/especialistas');
  const geomatica = ESPECIALISTAS.find((e) => e.id === 'geomatica')!;
  assert.ok(geomatica.herramientas.includes('mapa_geologico'));
  assert.ok(geomatica.herramientas.includes('geologia_zona'));
});

/* ------------------------------------------------------------------ con PostGIS */

test('geología contra PostGIS, con el paquete real', { skip: hayBase() ? false : 'sin ELECTRUM_DB_URL' }, async (t) => {
  const nombres = paqueteGeologia().map((x) => x.capa.nombre);
  try {
    await t.test('se carga con su rol, y cargar dos veces no duplica', async () => {
      const r = await cargarGeologia({ reemplazar: true });
      assert.equal(r.length, 8);
      assert.ok(r.every((x) => x.estado !== 'ya estaba'));
      const otra = await cargarGeologia();
      assert.ok(otra.every((x) => x.estado === 'ya estaba'));
      const filas = await consulta<{ nombre: string; rol: string; n: number }>(
        `SELECT k.nombre, k.rol, count(e.id)::int n FROM capa k JOIN entidad_geo e ON e.capa_id = k.id WHERE k.nombre = ANY($1) GROUP BY k.id`,
        [nombres]
      );
      assert.equal(filas.length, 8);
      assert.equal(filas.find((f) => f.nombre.startsWith('Geología'))!.rol, 'litologia');
      assert.ok(filas.find((f) => f.nombre.startsWith('Geología'))!.n > 800);
    });

    let g: Awaited<ReturnType<typeof geologiaDe>>;
    await t.test('Minas de Oro: el plutón, el skarn, el tracto Chortís y sus minas', async () => {
      g = await geologiaDe(MINAS_DE_ORO);
      assert.ok(!('error' in g), JSON.stringify(g));
      if ('error' in g) return;
      assert.ok(g.intrusivos.dentro.some((u) => u.unidad === 'TKi'), 'el plutón TKi está dentro');
      assert.ok(g.intrusivos.kmContactoCarbonato > 1, `contacto con calizas: ${g.intrusivos.kmContactoCarbonato} km`);
      assert.ok(g.litologia.dentro.some((u) => u.unidad === 'K'), 'las calizas cretácicas');
      assert.ok(g.recursos.tractos.some((x) => /Chortis/.test(x.nombre)));
      assert.ok(g.recursos.yacimientos.some((y) => /minas de oro/i.test(y.nombre) && y.dentro));
      assert.ok(g.fallas.dentro.length >= 1);
      assert.ok(g.fallas.rumbos.dominante);
      assert.ok(g.tectonica.placas[0].nombre.includes('Caribe–Norteamérica'));
      assert.ok(g.tectonica.provincias.some((p) => /Chortís/.test(p.nombre)));
      assert.equal(g.indicios.nivel, 'alto');
      assert.ok(g.indicios.modelos.includes('pórfido de cobre (y oro)'));
      assert.ok(g.ms < 5000, `${g.ms} ms`);
      const texto = geologiaEnTexto(g);
      assert.match(texto, /1:2 500 000/);
      assert.match(texto, /un indicio no es un recurso/);
      assert.match(texto, /Fuentes: /);
    });

    await t.test('un punto con radio es ESE círculo: no se le suma otro entorno encima', async () => {
      const g5 = await geologiaDe({ lon: -87.35, lat: 14.78, radioKm: 5 });
      assert.ok(!('error' in g5));
      if ('error' in g5) return;
      // Todo lo que se reporta está dentro de los 5 km del punto; nada «cerca» fuera del círculo.
      assert.ok(g5.recursos.yacimientos.every((y) => y.dentro), JSON.stringify(g5.recursos.yacimientos));
      assert.deepEqual(g5.fallas.cerca, []);
      assert.deepEqual(g5.litologia.cerca, []);
      assert.ok(Math.abs(g5.zona.ha - Math.PI * 25 * 100) / (Math.PI * 2500) < 0.02, `el círculo mide ${g5.zona.ha} ha`);
    });

    await t.test('reemplazar el paquete deja una capa por nombre, no dos', async () => {
      await cargarGeologia({ reemplazar: true });
      const filas = await consulta<{ nombre: string; n: number }>(`SELECT nombre, count(*)::int n FROM capa WHERE nombre = ANY($1) GROUP BY nombre`, [nombres]);
      assert.equal(filas.length, 8);
      assert.ok(filas.every((f) => f.n === 1), JSON.stringify(filas));
    });

    await t.test('una zona que no existe se dice, no se inventa', async () => {
      const r = await geologiaDe({ capa: 'Capa que no existe en ningún lado' });
      assert.ok('error' in r);
      const r2 = await geologiaDe({});
      assert.ok('error' in r2);
    });

    await t.test('los tres mapas, en JPEG', async () => {
      for (const tipo of ['litologico', 'estructural', 'geotectonico'] as const) {
        const m = await mapaGeologico(tipo, MINAS_DE_ORO);
        assert.ok(!('error' in m), `${tipo}: ${JSON.stringify(m)}`);
        if ('error' in m) continue;
        assert.equal(m.jpeg.subarray(0, 2).toString('hex'), 'ffd8', `${tipo} es un JPEG`);
        assert.ok(m.jpeg.length > 50_000, `${tipo}: ${m.jpeg.length} bytes`);
      }
      const lito = await mapaGeologico('litologico', MINAS_DE_ORO);
      if (!('error' in lito)) {
        assert.match(lito.svg, /TKi · Plutones terciarios/);
        assert.match(lito.svg, /Minas De Oro/);
      }
      const geo = await mapaGeologico('geotectonico', MINAS_DE_ORO);
      if (!('error' in geo)) {
        assert.match(geo.svg, /Placa de Caribe/);
        assert.match(geo.svg, /Subducción/);
      }
    });

    await t.test('las herramientas: el texto para el doctor y los mapas como imagen con dueño', async () => {
      const [gz, mg] = manosDe(['geologia_zona', 'mapa_geologico']);
      const ctx = { quien: 'jose', nivel: 'lee', plataforma: 'electrum', canal: 'telegram', mensaje: 'geología de Minas de Oro' } as any;
      const r1 = await gz.ejecutar({ lon: -87.35, lat: 14.78, radio_km: 10 }, ctx);
      assert.equal(r1.ok, true, r1.texto);
      assert.match(r1.texto, /INDICIOS: ALTO/);
      const r2 = await mg.ejecutar({ tipo: 'todos', lon: -87.35, lat: 14.78 }, ctx);
      assert.equal(r2.ok, true, r2.texto);
      const informes = (r2.ui as any).informes as Array<{ id: string; tipo: string }>;
      assert.equal(informes.length, 3);
      assert.ok(informes.every((x) => x.tipo === 'image/jpeg'));
      const toma = tomarInforme(informes[0].id, 'jose');
      assert.equal(toma.estado, 'ok');
      if (toma.estado === 'ok') assert.equal(toma.informe.tipo, 'image/jpeg');
      assert.equal(tomarInforme(informes[0].id, 'otra-persona').estado, 'ajeno', 'el mapa es de quien lo pidió');
    });

    await t.test('el informe geológico en PDF, con sus tres mapas', async () => {
      const r = await informeGeologico(MINAS_DE_ORO, { quien: 'José' });
      assert.ok(!('error' in r), JSON.stringify(r));
      if ('error' in r) return;
      assert.equal(r.pdf.subarray(0, 5).toString(), '%PDF-');
      assert.equal((r.pdf.toString('latin1').match(/\/DCTDecode/g) || []).length, 3);
      assert.match(r.dicho, /indicios alto/);
      assert.match(r.dicho, /3 de 3 mapas/);
      const [ip] = manosDe(['informe_pdf']);
      const r2 = await ip.ejecutar({ tipo: 'geologico', lon: -87.35, lat: 14.78 }, { quien: 'jose', nivel: 'lee', plataforma: 'electrum', canal: 'telegram', mensaje: 'informe geológico' } as any);
      assert.equal(r2.ok, true, r2.texto);
    });
  } finally {
    // Las capas del paquete no se quedan en la base de pruebas: otras pruebas cuentan capas.
    await consulta(`DELETE FROM capa WHERE nombre = ANY($1)`, [nombres]).catch(() => {});
    await cerrarBase();
  }
});
