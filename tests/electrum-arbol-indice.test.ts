/**
 * EL PANEL CONTRA EL ÍNDICE (instrucciones de corrección v1.0, secciones 1, 2, 3 y 5).
 *
 * El árbol que dibuja la pestaña sale de `arbolDe(manifest.json)`; aquí se compara entrada por
 * entrada con el Índice Maestro v1.4 (tests/fixtures/indice-v1.4.json, copiado del documento). Falla si
 * falta algo, si sobra algo que el documento no prevé, si cambia el orden, si una capa con categorías
 * queda de un solo color o si un ID retirado vuelve a aparecer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { arbolDe, encendible, type EntradaIndice, type Nodo } from '../src-electrum/mapa/indice';
import { leyendaDe, valoresConColor, type EntradaCatalogo } from '../src-electrum/mapa/catalogo';
import { validarManifiesto } from '../server/electrum/indice-capas';

const M = JSON.parse(fs.readFileSync('scripts/indice-capas/manifest.json', 'utf8'));
const INDICE = JSON.parse(fs.readFileSync('tests/fixtures/indice-v1.4.json', 'utf8')) as {
  entradas: Array<{ id: number; nombre: string; padre: number | null; orden: number; grupo: boolean }>;
  variables: Array<[number, number]>;
};
const CAPAS: EntradaIndice[] = M.capas;
const POR = new Map(CAPAS.map((c) => [c.id, c]));

/** El árbol del panel, aplanado: cada nodo con su padre y su posición entre hermanos. */
function aplanar(xs: Nodo[], padre: number | null = null, out = new Map<number, { padre: number | null; pos: number; nodo: Nodo }>()) {
  xs.forEach((n, pos) => {
    out.set(n.id, { padre, pos, nodo: n });
    aplanar(n.hijos, n.id, out);
  });
  return out;
}
const PANEL = aplanar(arbolDe(CAPAS));

test('el manifiesto del repositorio es válido y es el v1.5', () => {
  const m = validarManifiesto(M);
  assert.ok(m);
  assert.equal(m!.capas.length, CAPAS.length, 'el validador no tira ninguna entrada');
  assert.equal(M.version, '1.5');
});

test('panel = índice: toda entrada del documento está, con su padre y en su orden', () => {
  const faltan: string[] = [];
  for (const x of INDICE.entradas) {
    if (x.id === 1) {
      assert.ok(POR.get(1), 'el perímetro está en el manifiesto (no se apaga: no va en el árbol)');
      continue;
    }
    const p = PANEL.get(x.id);
    if (!p) {
      faltan.push(`${x.id} ${x.nombre}`);
      continue;
    }
    assert.equal(p.padre, x.padre, `${x.id} ${x.nombre}: padre`);
    assert.equal(p.nodo.nombre, x.nombre, `${x.id}: nombre`);
    assert.equal(p.nodo.tipo === 'grupo', x.grupo, `${x.id} ${x.nombre}: grupo o capa`);
  }
  assert.deepEqual(faltan, [], 'faltan en el panel');
  // El orden entre hermanos es el del documento.
  const porPadre = new Map<number | null, number[]>();
  for (const x of INDICE.entradas.filter((y) => y.id !== 1)) porPadre.set(x.padre, [...(porPadre.get(x.padre) || []), x.id]);
  for (const [padre, ids] of porPadre) {
    const enPanel = [...PANEL.entries()].filter(([, v]) => v.padre === padre).sort((a, b) => a[1].pos - b[1].pos).map(([id]) => id).filter((id) => ids.includes(id));
    assert.deepEqual(enPanel, [...ids].sort((a, b) => INDICE.entradas.find((y) => y.id === a)!.orden - INDICE.entradas.find((y) => y.id === b)!.orden), `orden bajo ${padre}`);
  }
});

test('panel = índice: no sobra nada que el documento no prevea', () => {
  const oficiales = new Set(INDICE.entradas.map((x) => x.id));
  // Categorías con subcapas fijas en el documento: lo demás bajo ellas sobra (salvo lo marcado y explicado).
  const fijas = new Set(INDICE.entradas.filter((x) => x.padre != null && !x.grupo).map((x) => x.padre!));
  const sobran: string[] = [];
  for (const [id, { nodo }] of PANEL) {
    if (oficiales.has(id)) continue;
    if (id === 900000) continue;
    const variable = INDICE.variables.some(([a, b]) => id >= a && id <= b);
    const deCategoriaDeUnArchivo = id % 1000 !== 0 && oficiales.has(Math.floor(id / 1000) * 1000) && !fijas.has(Math.floor(id / 1000) * 1000);
    const marcada = (nodo as any).fuera_de_indice === true && !!nodo.notas;
    if (!variable && !deCategoriaDeUnArchivo && !marcada) sobran.push(`${id} ${nodo.nombre}`);
  }
  assert.deepEqual(sobran, [], 'sobran en el panel');
  // Las agregadas con el siguiente ID libre están marcadas y explicadas.
  for (const id of [107008, 110003, 110004]) assert.equal((POR.get(id) as any).fuera_de_indice, true, `${id}`);
});

test('panel: lo verificado a mano en la sección 1', () => {
  const hijos = (id: number) => PANEL.get(id)!.nodo.hijos.map((h) => h.nombre);
  assert.deepEqual(hijos(105000), ['Departamentos', 'Municipios', 'Caseríos', 'Aldeas', 'Red hídrica']);
  assert.deepEqual(hijos(107000).slice(0, 7), ['Buenavista', 'Chaparro', 'La Campana', 'Escalera', 'Pantaleona', 'El Tajo', 'Targets (blancos)']);
  assert.deepEqual(hijos(110000).slice(0, 2), ['Depósitos minerales', 'Fichas seleccionadas (ocurrencia minera)']);
  assert.equal(PANEL.get(200000)!.nodo.hijos.length, 10, 'las 10 capas de geología');
  assert.equal(PANEL.get(210000)!.nodo.nombre, 'Suelos Simmons');
  assert.deepEqual(hijos(300000), ['Pantaleona', 'Buenavista Monarca', 'Cimarrón', 'Minas de Oro']);
  for (const p of [301000, 302000, 303000, 304000]) assert.ok(PANEL.get(p)!.nodo.hijos.length > 0, `${p} con sus subcarpetas`);
  assert.ok(PANEL.get(800000), 'Otros');
});

test('panel: lo que no tiene archivo va en gris como «Sin datos» (y no se enciende)', () => {
  for (const c of CAPAS.filter((x) => x.sin_datos)) assert.equal(encendible(c), false, `${c.id}`);
  for (const c of CAPAS) {
    if (c.tipo === 'grupo' || c.tipo === 'documento') continue;
    if (!c.fuentes?.length) assert.equal(c.sin_datos, true, `${c.id} ${c.nombre} sin fuente debe decir «Sin datos»`);
  }
});

test('colores: toda capa que se enciende tiene estilo; ninguna categorizada de un solo color', () => {
  for (const c of CAPAS.filter(encendible)) {
    assert.ok(c.estilo, `${c.id} ${c.nombre} sin estilo`);
    if (c.estilo!.tipo === 'categorizado' && (c.estilo!.categorias?.length || 0) > 1) {
      const colores = new Set(c.estilo!.categorias!.map((x) => x.color));
      assert.ok(colores.size > 1, `${c.id} ${c.nombre}: categorizada de un solo color`);
    }
    for (const x of c.estilo!.categorias || []) assert.match(x.color, /^#[0-9A-F]{6}$/i, `${c.id} ${x.valor}`);
  }
});

test('colores: el oro es amarillo y cada mineral tiene el suyo; los filtros y la leyenda llevan color', () => {
  for (const id of [110001, 110002, 110003]) {
    const e = POR.get(id) as EntradaCatalogo;
    const cats = e.estilo!.categorias!;
    assert.equal(cats.find((c) => c.valor === 'Oro')?.color, '#FFD700', `${id}: oro amarillo`);
    const porMineral = new Map(cats.map((c) => [c.grupo, c.color]));
    assert.equal(new Set(porMineral.values()).size, porMineral.size, `${id}: un color distinto por mineral`);
    const f = valoresConColor(e).find((x) => x.campo === 'mineral')!;
    assert.ok(f.valores.every((v) => v.color), `${id}: cada valor del filtro con su cuadrito de color`);
    assert.ok(leyendaDe(e).length > 1, `${id}: la leyenda muestra cada categoría`);
  }
  assert.equal((POR.get(110002) as any).estilo.categorias.find((c: any) => c.valor === 'Plata').color, '#C0C0C0');
  // En «Oro/Plata» manda el oro.
  const yac = (POR.get(110004) as any).estilo.categorias;
  assert.equal(yac.find((c: any) => c.valor === 'Oro/Plata').color, '#FFD700');
});

test('colores: los KML conservan su estilo original', () => {
  const geo = POR.get(304002)!;
  assert.equal(geo.estilo!.fuente, 'kml');
  assert.equal(geo.estilo!.tipo, 'original');
  // Unidades del KMZ «Geologia Minas de Oro», con sus colores de Google Earth.
  const ky = geo.estilo!.categorias!.find((c) => c.valor === 'Ky');
  assert.equal(ky?.color, '#D7C29E');
  // El SHP del mismo mapa toma los colores del KMZ (gana el estilo original).
  const shp = POR.get(304003)!;
  assert.equal(shp.estilo!.fuente, 'kml');
  assert.equal(shp.estilo!.categorias!.find((c) => c.valor === 'Ky')?.color, '#D7C29E');
  const kml = CAPAS.filter((c) => c.estilo?.fuente === 'kml');
  assert.ok(kml.length >= 40, `${kml.length} capas con el estilo de su KML`);
});

test('proyectos: lo de Pantaleona, Buenavista, Cimarrón y Minas de Oro está en su proyecto; los IDs viejos, retirados', () => {
  const ret: Array<{ id: number; ahora: number }> = M.retirados;
  assert.ok(ret.length >= 20);
  for (const r of ret) {
    assert.equal(POR.has(r.id), false, `${r.id} retirado: no se reutiliza`);
    const e = POR.get(r.ahora)!;
    assert.equal(e.id_anterior, r.id);
    assert.ok([301000, 302000, 303000, 304000].includes(e.padre!), `${r.ahora} en un proyecto`);
  }
  // Ningún archivo con el nombre de un proyecto quedó en Otros.
  const enOtros = CAPAS.filter((c) => c.padre === 800000 && /pantaleona|buena ?vista|monar[ck]a|cimarr[oó]n|chaparro|minas de oro|montecielo/i.test(c.nombre));
  assert.deepEqual(enOtros.map((c) => `${c.id} ${c.nombre}`), []);
  // Las concesiones del bloque 1 se quedan donde están.
  for (const id of [107001, 107002, 107003, 107004, 107005, 107006, 107007]) assert.equal(POR.get(id)!.padre, 107000);
});

test('alias: todas las capas tienen; los del documento están', () => {
  for (const c of CAPAS) assert.ok(c.alias?.length, `${c.id} ${c.nombre} sin alias`);
  const tiene = (id: number, a: string) => assert.ok(POR.get(id)!.alias!.includes(a), `${id}: «${a}»`);
  for (const a of ['fichas de ocurrencia', 'fichas de ocurrencia minera', 'ocurrencias', 'fichas']) tiene(110002, a);
  for (const a of ['depósitos', 'yacimientos']) tiene(110001, a);
  for (const a of ['zonas protegidas', 'reservas', 'zonas de reserva', 'parques']) tiene(101000, a);
  for (const a of ['reservas forestales', 'patrimonio forestal', 'bosque nacional']) tiene(109000, a);
  for (const a of ['microcuencas', 'zonas de recarga']) tiene(108000, a);
  for (const a of ['concesiones mineras', 'derechos', 'títulos mineros']) tiene(104000, a);
});

test('el frontal no tiene listas de capas escritas a mano', () => {
  const src = fs.readFileSync('src-electrum/mapa/indice.ts', 'utf8') + fs.readFileSync('src-electrum/mapa/IndiceCapas.tsx', 'utf8');
  // Ni IDs de capas del índice para resolver pedidos, ni tablas de alias.
  assert.doesNotMatch(src, /const ALIAS\b/);
  assert.doesNotMatch(src, /\[\/\\b\(.*\), \[1\d{5}/);
});
