/**
 * El índice de capas (Índice Maestro v1.4): el manifiesto del cubo, el árbol del frontal, los
 * filtros y lo que se pide de palabra; y, contra PostGIS, la capa que sirve el servidor.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { arbolDe, colorDe, encendible, expresionFiltro, hayFiltro, hojasDe, resolverIndice, rolDe, type EntradaIndice } from '../src-electrum/mapa/indice';
import { validarManifiesto } from '../server/electrum/indice-capas';
import { comandoDe } from '../src-electrum/panel/comandos';

const g = (id: number, nombre: string, padre: number | null, orden: number): EntradaIndice => ({ id, nombre, tipo: 'grupo', padre, orden });
const v = (id: number, nombre: string, padre: number, orden: number, extra: Partial<EntradaIndice> = {}): EntradaIndice => ({
  id, nombre, tipo: 'vector', padre, orden, fuentes: [{ base: true }], ruta_web: `/api/electrum/mapa/indice/capa/${id}`, ...extra,
});
const CAPAS: EntradaIndice[] = [
  { id: 1, nombre: 'Perímetro de Honduras', tipo: 'vector', padre: null, orden: 0, fuentes: [{ perimetro: true }], visible_por_defecto: true },
  g(100000, '1 Información GIS', null, 1),
  g(105000, 'División política de Honduras', 100000, 5),
  v(105002, 'Municipios', 105000, 2),
  v(105001, 'Departamentos', 105000, 1),
  { id: 105005, nombre: 'Red hídrica', tipo: 'vector', padre: 105000, orden: 5, fuentes: [{ tesela: 'referencia-rios-hn' }] },
  g(104000, 'Derechos mineros de Honduras', 100000, 4),
  { id: 104001, nombre: 'Derechos mineros', tipo: 'vector', padre: 104000, orden: 1, fuentes: [{ catastro: true }], filtros: [{ campo: 'estado', valores: ['Otorgada', 'Solicitud'] }] },
  g(110000, 'Recursos mineros de Honduras (WGS 84)', 100000, 10),
  v(110002, 'Fichas seleccionadas (ocurrencia minera)', 110000, 2, { filtros: [{ campo: 'mineral', valores: ['Oro', 'Plata', 'Cobre'] }], geometria: 'Point' }),
  g(200000, '2 Información geológica', null, 2),
  g(203000, 'Fallas geológicas (centroamericanas)', 200000, 3),
  v(203001, 'Fallas geológicas (centroamericanas)', 203000, 1, { geometria: 'LineString' }),
  g(301000, 'Pantaleona', 300000, 1),
  g(300000, '3 Proyectos Indexa (planos)', null, 3),
  { id: 301003, nombre: 'Plano 374-I', tipo: 'documento', padre: 301000, orden: 3, fuentes: [{ plano: 'biblioteca/mapas/planos/301003.pdf' }], ruta_web: '/api/electrum/mapa/plano/301003' },
  v(301001, 'Terreno para planta La Pantaleona', 301000, 1),
  { id: 107004, nombre: 'Escalera', tipo: 'vector', padre: 300000, orden: 9, fuentes: [], ruta_web: null },
  g(900000, '9 Cuarentena', null, 9),
];

test('índice: el árbol sigue el orden del manifiesto y deja fuera el perímetro y la cuarentena', () => {
  const a = arbolDe(CAPAS);
  assert.deepEqual(a.map((n) => n.id), [100000, 200000, 300000]);
  const gis = a[0];
  assert.deepEqual(gis.hijos.map((n) => n.id), [104000, 105000, 110000], 'por orden: 4, 5, 10');
  assert.deepEqual(gis.hijos[1].hijos.map((n) => n.id), [105001, 105002, 105005], 'Departamentos, Municipios, Red hídrica');
  assert.equal(hojasDe(gis).length, 5);
});

test('índice: qué se enciende y con qué estilo', () => {
  const por = new Map(CAPAS.map((c) => [c.id, c]));
  assert.equal(encendible(por.get(105002)!), true);
  assert.equal(encendible(por.get(301003)!), false, 'un plano se abre, no se enciende');
  assert.equal(encendible(por.get(107004)!), false, 'una faltante (sin fuente) va en gris');
  assert.equal(rolDe(por.get(105001)!), 'departamento');
  assert.equal(rolDe(por.get(203001)!), 'falla');
  assert.equal(rolDe(por.get(110002)!), 'ocurrencia');
  assert.match(colorDe(por.get(301001)!), /^#[0-9A-F]{6}$/i);
});

test('índice: el filtro marcado es una expresión de MapLibre; sin marcar, todo', () => {
  assert.equal(expresionFiltro({}), null);
  assert.equal(expresionFiltro({ mineral: [] }), null);
  assert.deepEqual(expresionFiltro({ mineral: ['Oro'] }), ['in', ['to-string', ['get', 'mineral']], ['literal', ['Oro']]]);
  const dos = expresionFiltro({ estado: ['Otorgada'], tipo: ['Metálica'] }) as unknown[];
  assert.equal(dos[0], 'all');
  assert.equal(dos.length, 3);
  assert.equal(hayFiltro({ mineral: ['Oro'] }), true);
  assert.equal(hayFiltro({ mineral: [] }), false);
});

test('índice: lo que se pide de palabra', () => {
  const a = arbolDe(CAPAS);
  assert.deepEqual(resolverIndice('el mapa político', a).ids.sort(), [105001, 105002]);
  assert.deepEqual(resolverIndice('los municipios', a).ids, [105002]);
  assert.deepEqual(resolverIndice('el catastro', a).ids, [104001]);
  assert.deepEqual(resolverIndice('los ríos', a).ids, [105005]);
  assert.deepEqual(resolverIndice('las fichas', a).ids, [110002]);
  assert.deepEqual(resolverIndice('105002', a).ids, [105002], 'por ID');
  assert.deepEqual(resolverIndice('la capa de pantaleona', a).ids, [301001], 'por nombre: el grupo entero, sin el plano');
  assert.equal(resolverIndice('todo', a).todo, true);
  assert.deepEqual(resolverIndice('las concesiones de plata', a).ids, []);
});

test('índice: la voz reconoce lo nuevo sin quitarle preguntas al cerebro', () => {
  assert.deepEqual(comandoDe('muéstrame el catastro'), { accion: 'capas', mostrar: true, que: 'el catastro' });
  assert.deepEqual(comandoDe('esconde las hojas cartográficas'), { accion: 'capas', mostrar: false, que: 'las hojas cartograficas' });
  assert.deepEqual(comandoDe('pon la capa de pantaleona'), { accion: 'capas', mostrar: true, que: 'la capa de pantaleona' });
  assert.deepEqual(comandoDe('deja solo el catastro'), { accion: 'capas', mostrar: true, que: 'catastro', solo: true });
  assert.equal(comandoDe('muéstrame las concesiones de oro'), null);
  assert.equal(comandoDe('muéstrame pantaleona'), null, 'un nombre suelto sigue siendo para volar a la concesión');
});

test('manifiesto: lo que no cumple no entra', () => {
  const m = validarManifiesto({
    version: '1.4',
    capas: [
      { id: 105002, nombre: 'Municipios', tipo: 'vector', padre: 105000, orden: 2, filtros: [{ campo: 'depto', valores: ['Olancho'] }, { campo: 3 }], caja: [-89, 13, -83, 16] },
      { id: 105002, nombre: 'Repetido', tipo: 'vector', padre: 105000, orden: 3 },
      { id: 1234567, nombre: 'ID de siete dígitos', tipo: 'vector', padre: null, orden: 1 },
      { id: 3, nombre: 'Tipo raro', tipo: 'html', padre: null, orden: 1 },
      { id: 4, nombre: 'Caja rota', tipo: 'grupo', padre: null, orden: 1, caja: [1, 2] },
    ],
  });
  assert.ok(m);
  assert.deepEqual(m!.capas.map((c) => c.id), [105002, 4]);
  assert.deepEqual(m!.capas[0].filtros, [{ campo: 'depto', etiqueta: 'depto', valores: ['Olancho'] }]);
  assert.equal(m!.capas[1].caja, null);
  assert.equal(validarManifiesto({ nada: true }), null);
});

const HAY = !!process.env.ELECTRUM_DB_URL;
test('índice contra PostGIS: una capa de varios archivos, con su layer_id, su mineral y sus campos de filtro', { skip: HAY ? false : 'sin ELECTRUM_DB_URL' }, async () => {
  const { consulta, guardarCapa } = await import('../server/electrum/db');
  const { usarManifiesto, capaDelIndice } = await import('../server/electrum/indice-capas');
  await consulta('TRUNCATE traslape, concesion, entidad_geo, capa RESTART IDENTITY CASCADE');
  const punto = (x: number, y: number, p: Record<string, unknown>) => ({ type: 'Feature' as const, properties: p, geometry: { type: 'Point' as const, coordinates: [x, y] } });
  const capa = (nombre: string, fs: any[]) => ({ nombre, formato: 'geojson', origenCrs: 'EPSG:4326', entidades: fs.length, descartadas: 0, geojson: { type: 'FeatureCollection' as const, features: fs } });
  await guardarCapa(capa('ORO', [punto(-86.5, 14.5, { NOMBRE: 'Veta Vieja', ESTADO: 'activa', SECRETO: 'no se manda' }), punto(-86.4, 14.6, { NOMBRE: 'La Nueva', ESTADO: 'abandonada' })]) as any, { comoConcesiones: false });
  await guardarCapa(capa('PLATA', [punto(-87, 15, { NOMBRE: 'Platera', ESTADO: 'activa' })]) as any, { comoConcesiones: false });
  const ids = await consulta<{ id: number; nombre: string }>(`SELECT id::int, nombre FROM capa ORDER BY id`);
  const id = (n: string) => ids.find((x) => x.nombre === n)!.id;
  usarManifiesto({
    version: '1.4',
    crs_salida: 'EPSG:4326',
    capas: [
      {
        id: 110002, nombre: 'Fichas seleccionadas', tipo: 'vector', padre: 110000, orden: 2, num_entidades: 3,
        filtros: [{ campo: 'mineral', valores: ['Oro', 'Plata'] }, { campo: 'ESTADO', valores: ['activa', 'abandonada'] }],
        fuentes: [{ capa: id('ORO'), propiedades: { mineral: 'Oro' } }, { capa: id('PLATA'), propiedades: { mineral: 'Plata' } }],
      },
      { id: 103001, nombre: 'Curvas', tipo: 'vector', padre: 103000, orden: 1, fuentes: [{ tesela: 'curvas' }] },
    ],
  });
  const r = await capaDelIndice(110002);
  assert.ok(!('error' in r), JSON.stringify(r));
  const fs = (r as any).geojson.features;
  assert.equal(fs.length, 3);
  for (const f of fs) assert.equal(f.properties.layer_id, 110002);
  const oro = fs.filter((f: any) => f.properties.mineral === 'Oro');
  assert.equal(oro.length, 2);
  assert.ok(oro.every((f: any) => typeof f.properties.ESTADO === 'string'), 'el campo de filtro viaja');
  assert.ok(fs.every((f: any) => !('SECRETO' in f.properties)), 'lo que no se filtra no viaja');
  assert.equal(fs.find((f: any) => f.properties.mineral === 'Plata').properties.nombre, 'Platera');
  const t = await capaDelIndice(103001);
  assert.equal((t as any).status, 404, 'las teselas no se sirven desde la base');
  assert.equal(((await capaDelIndice(999999)) as any).status, 404);
  usarManifiesto(null);
});
