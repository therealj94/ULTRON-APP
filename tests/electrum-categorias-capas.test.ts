/**
 * Las capas del mapa por categorías, y lo que se dice para encenderlas o apagarlas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { categoriaDeRaster, categoriaDeRol, esPedidoDeCapa, nombreDePedido, resolverPedido, type ItemCapa } from '../src-electrum/mapa/categorias';
import { comandoDe } from '../src-electrum/panel/comandos';

const ITEMS: ItemCapa[] = [
  { tipo: 'capa', id: 43, nombre: 'DEPARTAMENTOS', rol: 'departamento' },
  { tipo: 'capa', id: 78, nombre: 'MUNICIPIOS', rol: 'municipio' },
  { tipo: 'capa', id: 1, nombre: 'Geología 1:250 000', rol: 'litologia' },
  { tipo: 'capa', id: 2, nombre: 'Fallas geológicas', rol: 'falla' },
  { tipo: 'capa', id: 3, nombre: 'SINAPH', rol: 'area_protegida' },
  { tipo: 'capa', id: 4, nombre: 'Minas de Oro I', rol: 'proyecto' },
  { tipo: 'raster', clave: 'referencia-rios-hn', nombre: 'Ríos y quebradas', grupo: 'Referencia' },
  { tipo: 'raster', clave: 'referencia-fallas-1-50000', nombre: 'Fallas 1:50 000', grupo: 'Referencia' },
  { tipo: 'raster', clave: 'referencia-caserios-hn', nombre: 'Caseríos', grupo: 'Referencia' },
  { tipo: 'raster', clave: 'lote-1-hojas-cartograficas', nombre: 'HOJAS CARTOGRAFICAS (37 hojas, lote-1)', grupo: 'Mapas del lote-1' },
  { tipo: 'raster', clave: 's2-fe', nombre: 'Óxidos de hierro (B04/B02)', grupo: 'Satélite · Sentinel-2' },
  { tipo: 'raster', clave: 'jica-olancho-anomalias-cu', nombre: 'Anomalías geoquímicas de Cu en Olancho (JICA)' },
  { tipo: 'raster', clave: 'jica-olancho-geologico', nombre: 'Mapa geológico de Olancho (JICA)' },
  { tipo: 'muestras' },
  { tipo: 'curvas' },
];

test('categorías: cada cosa en su lugar', () => {
  assert.equal(categoriaDeRol('departamento'), 'politico');
  assert.equal(categoriaDeRol('municipio'), 'politico');
  assert.equal(categoriaDeRol('falla'), 'geologia');
  assert.equal(categoriaDeRol('area_protegida'), 'ambiente');
  assert.equal(categoriaDeRol('raro'), 'otros');
  assert.equal(categoriaDeRaster({ clave: 'referencia-rios-hn', nombre: 'Ríos', grupo: 'Referencia' }), 'hidrografia');
  assert.equal(categoriaDeRaster({ clave: 'referencia-caserios-hn', nombre: 'Caseríos', grupo: 'Referencia' }), 'hidrografia');
  assert.equal(categoriaDeRaster({ clave: 'referencia-fallas-1-50000', nombre: 'Fallas 1:50 000', grupo: 'Referencia' }), 'geologia');
  assert.equal(categoriaDeRaster({ clave: 'lote-1-curvas-de-nivel-20m-hn', nombre: 'Curvas de nivel cada 20 m', grupo: 'Relieve' }), 'relieve');
  assert.equal(categoriaDeRaster({ clave: 'lote-1-1620c-wgs84', nombre: '1620C', grupo: 'Mapas del lote-1' }), 'topografia');
  assert.equal(categoriaDeRaster({ clave: 's2-arc', nombre: 'Arcillas', grupo: 'Satélite · Sentinel-2' }), 'satelite');
  assert.equal(categoriaDeRaster({ clave: 'jica-olancho-anomalias-zn', nombre: 'Anomalías de Zn (JICA)' }), 'recursos');
  assert.equal(categoriaDeRaster({ clave: 'jica-olancho-estructural', nombre: 'Mapa estructural de Olancho (JICA)' }), 'geologia');
});

test('pedido: lo concreto antes que la categoría', () => {
  const fallas = resolverPedido('las fallas', ITEMS);
  assert.deepEqual(fallas.items.map((i) => (i.tipo === 'capa' ? i.id : i.tipo === 'raster' ? i.clave : i.tipo)), [2, 'referencia-fallas-1-50000']);
  assert.deepEqual(resolverPedido('los ríos', ITEMS).items.map((i) => (i.tipo === 'raster' ? i.clave : '')), ['referencia-rios-hn']);
  assert.deepEqual(resolverPedido('municipios', ITEMS).items.map((i) => (i.tipo === 'capa' ? i.id : 0)), [78]);
  assert.equal(resolverPedido('las muestras', ITEMS).items[0].tipo, 'muestras');
});

test('pedido: la categoría entera', () => {
  const pol = resolverPedido('el mapa político', ITEMS);
  assert.equal(pol.categoria, 'politico');
  assert.deepEqual(pol.items.map((i) => (i.tipo === 'capa' ? i.id : 0)), [43, 78]);
  assert.equal(nombreDePedido(pol), 'mapa político');
  const geo = resolverPedido('la geología', ITEMS);
  assert.equal(geo.categoria, 'geologia');
  assert.equal(geo.items.length, 4); // litología, fallas de la base, fallas 1:50 000 y el geológico de JICA
  assert.equal(resolverPedido('las restricciones', ITEMS).categoria, 'ambiente');
  assert.equal(resolverPedido('mapas topográficos', ITEMS).items.length, 1);
});

test('pedido: por el nombre, y lo que no hay', () => {
  assert.deepEqual(resolverPedido('hojas cartográficas', ITEMS).items.map((i) => (i.tipo === 'raster' ? i.clave : '')), ['lote-1-hojas-cartograficas']);
  assert.deepEqual(resolverPedido('minas de oro', ITEMS).items.map((i) => (i.tipo === 'capa' ? i.id : 0)), [4]);
  assert.equal(resolverPedido('las concesiones de plata', ITEMS).items.length, 0);
  assert.equal(resolverPedido('todo', ITEMS).todo, true);
});

test('voz: encender, apagar y dejar solo', () => {
  assert.deepEqual(comandoDe('Muéstrame los ríos'), { accion: 'capas', mostrar: true, que: 'los rios' });
  assert.deepEqual(comandoDe('Doctor, esconde la geología'), { accion: 'capas', mostrar: false, que: 'la geologia' });
  assert.deepEqual(comandoDe('pon el mapa político'), { accion: 'capas', mostrar: true, que: 'el mapa politico' });
  assert.deepEqual(comandoDe('quita las áreas protegidas'), { accion: 'capas', mostrar: false, que: 'las areas protegidas' });
  assert.deepEqual(comandoDe('deja solo el mapa político'), { accion: 'capas', mostrar: true, que: 'mapa politico', solo: true });
  assert.deepEqual(comandoDe('limpia el mapa'), { accion: 'capas', mostrar: false, que: 'todo' });
  assert.deepEqual(comandoDe('enciende las curvas de nivel'), { accion: 'capas', mostrar: true, que: 'las curvas de nivel' });
});

test('voz: lo que ya era otra orden sigue siendo esa orden', () => {
  assert.deepEqual(comandoDe('muestra las capas'), { accion: 'abrir', que: 'capas' });
  assert.deepEqual(comandoDe('pon satélite'), { accion: 'fondo', cual: 'satelite' });
  assert.deepEqual(comandoDe('muestra el relieve'), { accion: 'tresD', activar: true });
  assert.deepEqual(comandoDe('cierra el mapa geológico'), { accion: 'cerrar' });
  assert.deepEqual(comandoDe('solo el mapa'), { accion: 'reparto', alto: 'mapa' });
  // Una pregunta no es una capa.
  assert.equal(comandoDe('muéstrame las concesiones de oro'), null);
  assert.equal(esPedidoDeCapa('donde estoy'), false);
});
