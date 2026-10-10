/**
 * ETAPA 1 — EL RECORRIDO: lo que el documento no deja cambiar (el orden de los 12 pasos y los seis
 * mensajes clave) y que las lecturas del target salgan de los datos, sin inventar (reglas 1–3).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MENSAJES, PASOS, estadoDicho, fichaFactibilidad, leyOroDicha, lecturaCatastro, lecturaHallazgos, lecturaIndicios, lecturaPremisas, lecturaRestricciones, nombreFicha, tipoProbable, type TargetEjemplo } from '../src-electrum/demo/etapa1';
import { cuadrado, estaLibre, rumboDe, utm16 } from '../server/electrum/recorrido-target';
import { recorridoPedido } from '../src-electrum/panel/comandos';

const T: TargetEjemplo = {
  nombre: 'Target Ejemplo',
  ejemplo: true,
  ficha: { nombre: 'D M RIO VERDUGO EL NARANJO FOM 150 2757-IV 2757-II Au Ag VETA', capa: 'ORO' },
  mineral: 'Oro',
  centro: [-87.39498, 13.83714],
  poligono: cuadrado([-87.39498, 13.83714]) as any,
  caja: [-87.406, 13.827, -87.384, 13.847],
  ha: 559,
  perimetroKm: 9.4,
  libreHa: 559,
  departamento: 'Francisco Morazán',
  municipio: 'Reitoca',
  aldeas: ['Sabanetas', 'Azacualpa'],
  caserios: [],
  pobladosCerca: 24,
  poblacionDentro: 181,
  protegida: { nombre: 'Yerba Buena', km: 28.2, rumbo: 'norte' },
  microcuenca: { nombre: '', km: 3.1, rumbo: 'sur' },
  rios: { kmDentro: 8.9, masCercano: null },
  carreteraKm: 27.5,
  ocurrencias: Array.from({ length: 20 }, () => ({ nombre: 'x', km: 2, detalle: null })),
  jica: { muestras: 114, mejorAu: { codigo: 'Z054GO', tipo: 'mineral', ppb: 10000, sobreTope: true, km: 4.2 } },
  geologia: { unidad: 'Grupo Padre Miguel', descripcion: null, edad: 'Terciario', fallasDentro: 8, fallaCercana: { nombre: 'x', km: 0 }, rumbo: 'N42°W', tracto: 'Tracto Cocos', modelos: ['pórfido de cobre (y oro)', 'skarn de cobre, zinc u oro', 'epitermal de oro y plata'], indicios: 'alto', yacimientos: [{ nombre: 'El Naranjo', mineral: 'oro', km: 0.4 }] },
  concesionCercana: { nombre: 'Cantagallo', estado: 'S-Explorar', tipo: 'Metálica', km: 1.5, rumbo: 'norte' },
  fuentes: [],
  alertas: [],
  calculado: '',
};

test('los 12 pasos, en el orden del documento, y los seis mensajes clave', () => {
  assert.deepEqual(
    PASOS.map((p) => p.corto),
    ['Premisas geológicas', 'Indicios', 'Hallazgos', 'Tipo de target', 'Restricciones', 'División política', 'Agua, vías y suelos', 'Catastro minero', 'Marco legal', 'Carpeta y exploración', 'Perforación y recurso', 'Decisión']
  );
  assert.equal(MENSAJES.length, 6);
  // El guion del recorrido recorre los pasos en ese orden.
  const fuente = fs.readFileSync('src-electrum/demo/Recorrido.tsx', 'utf8');
  const orden = fuente.match(/etapa1: \[([^\]]+)\]/)![1];
  const pasos = [...orden.matchAll(/'e1Paso(\d+)'/g)].map((m) => Number(m[1]));
  assert.deepEqual(pasos, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.match(orden, /^'e1Apertura', 'e1Equipo', 'e1Riesgo'/);
  assert.match(orden, /'e1Ficha', 'e1Cierre'$/);
  // El cierre termina con la frase del documento.
  assert.match(fuente, /Vamos con todo, cuente con nosotros\. ¡Bienvenido!/);
});

test('las lecturas salen de los datos y no llaman recurso a un indicio', () => {
  assert.equal(lecturaPremisas(T), 'El target está sobre la unidad Grupo Padre Miguel, del Terciario, con 8 fallas cruzando el área, de rumbo N42°W. Y cae en el tracto permisivo «Tracto Cocos» del USGS.');
  const ind = lecturaIndicios(T);
  assert.match(ind, /20 ocurrencias/);
  assert.match(ind, /114 muestras/);
  assert.match(ind, /más de 10 gramos por tonelada, el tope del laboratorio: es una muestra puntual, no la ley de un depósito/);
  assert.match(lecturaHallazgos(T), /El Naranjo, a 0,4 km/);
  assert.match(lecturaHallazgos({ ...T, geologia: { ...T.geologia!, yacimientos: [] } }), /lo primero que se verifica en campo/);
  assert.match(lecturaRestricciones(T), /no se superpone.*Yerba Buena, está a 28,2 km al norte.*3,1 km al sur/);
  assert.match(lecturaCatastro(T), /libres.*«Cantagallo», en estado solicitud de exploración, a 1,5 km al norte/);
  assert.equal(estadoDicho('Explotar'), 'explotación');
});

test('el tipo probable: para oro, el epitermal antes que el pórfido; sin modelos, nada', () => {
  assert.equal(tipoProbable(T), 'epitermal de oro y plata');
  assert.equal(tipoProbable({ ...T, mineral: 'Cobre' }), 'pórfido de cobre');
  assert.equal(tipoProbable({ ...T, geologia: { ...T.geologia!, modelos: [] } }), null);
});

test('la ficha de factibilidad: con avisos honestos y el dictamen del catastro', () => {
  const f = fichaFactibilidad(T);
  assert.equal(f.dictamen, 'Factible para solicitud');
  const por = Object.fromEntries(f.filas.map((x) => [x.criterio, x]));
  assert.equal(por['Comunidades'].marca, 'aviso', 'gente dentro: licencia social');
  assert.equal(por['Vías'].marca, 'aviso', 'carretera a más de 10 km');
  assert.equal(por['Catastro'].resultado, 'Área libre');
  assert.match(por['Premisas geológicas'].resultado, /8 fallas dentro/);
  const ocupada = fichaFactibilidad({ ...T, libreHa: 100 });
  assert.equal(ocupada.factible, false);
  assert.equal(ocupada.dictamen, 'Reubicar el área');
});

test('nombres y leyes para la voz', () => {
  assert.equal(nombreFicha('D M RIO VERDUGO EL NARANJO FOM 150 2757-IV'), 'Río Verdugo El Naranjo');
  assert.equal(leyOroDicha(1300), '1,3 gramos por tonelada');
  assert.equal(leyOroDicha(530), '530 partes por billón');
});

test('el área del target: ~500 ha, libre solo si nada la pisa; rumbos y UTM 16N', () => {
  const g = cuadrado([-87.4, 13.84], 500);
  const [[o, s], , [e, n]] = g.coordinates[0];
  const ancho = (e - o) * 111.32 * Math.cos((13.84 * Math.PI) / 180);
  const alto = (n - s) * 110.574;
  assert.ok(Math.abs(ancho * alto * 100 - 500) < 5, 'unas 500 ha');
  const ok = { estado: 'ok', pisa: [] };
  assert.ok(estaLibre({ ha: 500, libreHa: 500, entorno: { areasProtegidas: ok, microcuencas: ok, forestal: ok } }));
  assert.ok(!estaLibre({ ha: 500, libreHa: 400, entorno: { areasProtegidas: ok, microcuencas: ok, forestal: ok } }), 'una concesión la pisa');
  assert.ok(!estaLibre({ ha: 500, libreHa: 500, entorno: { areasProtegidas: { estado: 'ok', pisa: [{}] }, microcuencas: ok, forestal: ok } }));
  assert.equal(rumboDe(0), 'norte');
  assert.equal(rumboDe(44), 'noreste');
  assert.equal(rumboDe(181), 'sur');
  assert.equal(rumboDe(350), 'norte');
  assert.equal(rumboDe(null), null);
  const u = utm16([-87.39498, 13.83714]);
  assert.equal(u.zona, '16N');
  assert.ok(u.este > 450_000 && u.este < 470_000 && u.norte > 1_520_000 && u.norte < 1_540_000, JSON.stringify(u));
});

test('«quiero ver la etapa 1» arranca el recorrido nuevo', () => {
  assert.equal(recorridoPedido('quiero ver la etapa 1'), 'etapa1');
  assert.equal(recorridoPedido('muéstrame la presentación'), 'etapa1');
  assert.equal(recorridoPedido('Muéstrame el recorrido legal'), 'legal');
});
