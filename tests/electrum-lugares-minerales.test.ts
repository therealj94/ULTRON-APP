import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarLugar, separarDepartamento } from '../server/electrum/lugares';
import { mineralDePedido, pedidoDeFiltro, pedidoDeLugar } from '../lib/pedidos-mapa';
import { comoSeSabe, idsQueCumplen, mineralesEnNombre, mineralesEnTexto, type MineralesDeConcesion } from '../server/electrum/minerales';
import { idsEnHerramientas } from '../server/electrum/mapa-garantia';

test('los lugares de Honduras se encuentran por su nombre', () => {
  const j = buscarLugar('Juticalpa')!;
  assert.equal(j.lugar.departamento, 'Olancho');
  assert.ok(Math.abs(j.lugar.centro[0] - -86.22) < 0.05 && Math.abs(j.lugar.centro[1] - 14.66) < 0.05);
  assert.equal(buscarLugar('Choluteca')!.lugar.tipo, 'cabecera departamental'); // la ciudad, no el departamento
  assert.equal(buscarLugar('Olancho')!.lugar.tipo, 'departamento');
  assert.equal(buscarLugar('río Guayape')!.lugar.tipo, 'río');
  assert.equal(buscarLugar('Celaque')!.lugar.tipo, 'cerro');
  assert.equal(buscarLugar('Concepción, Intibucá')!.lugar.departamento, 'Intibucá');
  assert.equal(buscarLugar('xqzwv'), null);
  assert.deepEqual(separarDepartamento('San José en Copán'), { nombre: 'san jose', depto: 'copan' });
});

test('pedir ir a un lugar', () => {
  assert.equal(pedidoDeLugar('llévame a Juticalpa'), 'Juticalpa');
  assert.equal(pedidoDeLugar('¿Dónde queda Trujillo?'), 'Trujillo');
  assert.equal(pedidoDeLugar('vamos al cerro Uyuca'), 'cerro Uyuca');
  assert.equal(pedidoDeLugar('llévame a la concesión Clavo Rico'), null);
  assert.equal(pedidoDeLugar('muéstrame las concesiones de oro'), null);
  assert.equal(pedidoDeLugar('mueve el mapa a la derecha'), null);
  assert.equal(pedidoDeLugar('¿cuántas concesiones hay en Olancho?'), null);
});

test('pedir ver solo las de un mineral', () => {
  assert.equal(pedidoDeFiltro('quiero ver las concesiones que tengan oro'), 'oro');
  assert.equal(pedidoDeFiltro('muéstrame solo las de plata'), 'plata');
  assert.equal(pedidoDeFiltro('marca las concesiones metálicas'), 'metalicas');
  assert.equal(pedidoDeFiltro('muestra las no metálicas'), 'no metalicas');
  assert.equal(pedidoDeFiltro('quita el filtro'), 'quitar');
  assert.equal(pedidoDeFiltro('¿cuánto vale el oro hoy?'), null);
  assert.equal(mineralDePedido('cobre'), 'cobre');
});

test('los minerales salen de las capas y del nombre, y se dice cómo se sabe', () => {
  assert.deepEqual(mineralesEnTexto('Tipo epitermal de baja sulfuración (Au)'), ['oro']);
  assert.deepEqual(mineralesEnTexto('AU oro | oro, cobre'), ['oro', 'cobre']);
  assert.deepEqual(mineralesEnTexto('veta Antimonio'), ['antimonio']);
  assert.deepEqual(mineralesEnNombre('Arenera La Villa'), ['arena']);
  assert.deepEqual(mineralesEnNombre('Clavo Rico'), []);
  const datos = new Map<number, MineralesDeConcesion>([
    [1, { minerales: ['oro'], porOcurrencia: ['oro'], clase: 'Metálica' }],
    [2, { minerales: ['arena'], porOcurrencia: [], clase: 'No Metálica' }],
    [3, { minerales: [], porOcurrencia: [], clase: 'Pequeña Minería Metálica' }],
  ]);
  assert.deepEqual(idsQueCumplen(datos, 'oro'), [1]);
  assert.deepEqual(idsQueCumplen(datos, 'metalicas'), [1, 3]);
  assert.deepEqual(idsQueCumplen(datos, 'no metalicas'), [2]);
  assert.match(comoSeSabe('oro'), /no guarda el mineral/);
});

test('se habla de UNA concesión cuando las herramientas trajeron un solo id', () => {
  assert.deepEqual(idsEnHerramientas('Clavo Rico (id 1397), expediente sin número.'), [1397]);
  assert.deepEqual(idsEnHerramientas('Coinciden 2: A (id 1058); B (id 1059).'), [1058, 1059]);
});
