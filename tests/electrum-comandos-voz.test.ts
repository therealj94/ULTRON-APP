/**
 * Lo que se dice en voz alta para manejar la pantalla, y lo que Dr Electrum dice mientras trabaja.
 * Un comando tiene que ser casi toda la frase: «¿qué concesiones siguientes vencen?» es una
 * pregunta, no la orden «siguiente».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { comandoDe, esAfirmativa, esNegativa, recorridoPedido } from '../src-electrum/panel/comandos';
import { FRASES_GENERALES, fraseDeEspera, fraseDeTrabajo } from '../src-electrum/panel/trabajando';

test('comandos: las órdenes cortas se reconocen, con cortesía o sin ella', () => {
  assert.deepEqual(comandoDe('Siguiente'), { accion: 'siguiente' });
  assert.deepEqual(comandoDe('Doctor, por favor, siguiente.'), { accion: 'siguiente' });
  assert.deepEqual(comandoDe('continúa'), { accion: 'siguiente' });
  assert.deepEqual(comandoDe('Acércate'), { accion: 'zoom', dir: 1 });
  assert.deepEqual(comandoDe('zoom in'), { accion: 'zoom', dir: 1 });
  assert.deepEqual(comandoDe('Aléjate un poco'.replace(' un poco', '')), { accion: 'zoom', dir: -1 });
  assert.deepEqual(comandoDe('zoom out'), { accion: 'zoom', dir: -1 });
  assert.deepEqual(comandoDe('Cierra la ventana'), { accion: 'cerrar' });
  assert.deepEqual(comandoDe('cierra el mapa geológico'), { accion: 'cerrar' });
  assert.deepEqual(comandoDe('Abre más el mapa'), { accion: 'reparto', alto: 'mapa' });
  assert.deepEqual(comandoDe('más chat'), { accion: 'reparto', alto: 'chat' });
  assert.deepEqual(comandoDe('mitad y mitad'), { accion: 'reparto', alto: 'mitad' });
  assert.deepEqual(comandoDe('Pantalla completa'), { accion: 'pantalla', entrar: true });
  assert.deepEqual(comandoDe('sal de pantalla completa'), { accion: 'pantalla', entrar: false });
  assert.deepEqual(comandoDe('Abre las capas'), { accion: 'abrir', que: 'capas' });
  assert.deepEqual(comandoDe('muéstrame el tablero'), { accion: 'abrir', que: 'tablero' });
  assert.deepEqual(comandoDe('abre el chat'), { accion: 'abrir', que: 'consulta' });
  assert.deepEqual(comandoDe('pon el 3D'), { accion: 'tresD', activar: true });
  assert.deepEqual(comandoDe('¿Dónde estoy?'), { accion: 'ubicacion' });
  assert.deepEqual(comandoDe('Cállate'), { accion: 'callar' });
  assert.deepEqual(comandoDe('Termina el recorrido'), { accion: 'detener' });
});

test('comandos: las preguntas NO son órdenes', () => {
  assert.equal(comandoDe('¿Qué concesiones siguientes vencen este año en Olancho?'), null);
  assert.equal(comandoDe('Cierra la concesión de Los Almendros o sigue vigente'), null);
  assert.equal(comandoDe('¿Cuántas hectáreas tiene la concesión más grande?'), null);
  assert.equal(comandoDe(''), null);
});

test('respuestas a «¿tiene alguna pregunta?»', () => {
  assert.ok(esNegativa('No, gracias'));
  assert.ok(esNegativa('nada, todo claro'.replace(', todo claro', '')));
  assert.ok(esNegativa('Ninguna pregunta.'));
  assert.ok(!esNegativa('No entiendo por qué vence en diciembre'));
  assert.ok(esAfirmativa('Sí, tengo una pregunta'.replace(',', '')));
  assert.ok(esAfirmativa('Claro'));
  assert.equal(recorridoPedido('Muéstrame el recorrido legal'), 'legal');
  assert.equal(recorridoPedido('quiero ver las herramientas'), 'herramientas');
  assert.equal(recorridoPedido('el geológico'), 'geologico');
  assert.equal(recorridoPedido('¿Cuántas concesiones hay en el departamento de Olancho y quién es el titular?'), null);
});

test('frases de trabajo: según lo pedido, y nunca vacías', () => {
  const siempreTema = () => 0.9;
  assert.match(fraseDeTrabajo('Hazme el mapa geológico de Los Almendros', siempreTema), /mapa geol|unidades geol/i);
  assert.match(fraseDeTrabajo('Arma el informe en PDF para el banco', siempreTema), /informe|documento/i);
  assert.match(fraseDeTrabajo('Busca en los expedientes el contrato', siempreTema), /expediente|document/i);
  assert.match(fraseDeTrabajo('¿Qué concesiones vencen este año?', siempreTema), /vencimiento|fechas/i);
  assert.match(fraseDeTrabajo('Muéstrame el timelapse satelital', siempreTema), /sat[ée]lit/i);
  // Sin tema reconocible: una general.
  assert.ok(FRASES_GENERALES.includes(fraseDeTrabajo('¿Y eso qué significa?', () => 0.5)));
  assert.ok(FRASES_GENERALES.length >= 15);
  // Rotan: dos seguidas del mismo tema no son la misma frase.
  const a = fraseDeTrabajo('mapa geológico', siempreTema);
  const b = fraseDeTrabajo('mapa geológico', siempreTema);
  assert.notEqual(a, b);
});

test('frases de espera: la de la herramienta, o una de «sigo en eso»', () => {
  assert.match(fraseDeEspera('catastro_buscar', 0), /catastro/);
  assert.match(fraseDeEspera('herramienta_desconocida', 0), /ya casi|poquito|redactar/i);
  assert.match(fraseDeEspera(null, 1), /\S/);
});

test('comandos: mover, rotar, enderezar, inclinar y la ficha abierta', async () => {
  const { comandoDe: c, comandoDeLaya, nombreDeComando } = await import('../src-electrum/panel/comandos');
  assert.deepEqual(c('muévete al norte'), { accion: 'mover', dir: 'arriba' });
  assert.deepEqual(c('a la derecha'), { accion: 'mover', dir: 'derecha' });
  assert.deepEqual(c('un poco más a la izquierda'), { accion: 'mover', dir: 'izquierda' });
  assert.deepEqual(c('ve hacia el sur'), { accion: 'mover', dir: 'abajo' });
  assert.deepEqual(c('baja el mapa'), { accion: 'mover', dir: 'abajo' });
  assert.deepEqual(c('gira a la derecha'), { accion: 'rotar', dir: 1 });
  assert.deepEqual(c('rota el mapa'), { accion: 'rotar', dir: 1 });
  assert.deepEqual(c('gira un poco a la izquierda'), { accion: 'rotar', dir: -1 });
  assert.deepEqual(c('pon el norte arriba'), { accion: 'norte' });
  assert.deepEqual(c('inclínalo'), { accion: 'inclinar' });
  assert.deepEqual(c('vista de arriba'), { accion: 'cenital' });
  assert.deepEqual(c('dale la vuelta completa'), { accion: 'orbitar' });
  assert.deepEqual(c('pon el satélite'), { accion: 'fondo', cual: 'satelite' });
  assert.deepEqual(c('muéstrame todo el país'), { accion: 'pais' });
  assert.deepEqual(c('hazme la ficha en pdf'), { accion: 'ficha', que: 'pdf' });
  assert.deepEqual(c('mapa geológico de esta'), { accion: 'ficha', que: 'geologico' });
  assert.deepEqual(c('ponme el timelapse'), { accion: 'ficha', que: 'timelapse' });
  assert.deepEqual(c('analiza esta concesión'), { accion: 'ficha', que: 'analizar' });
  // Lo que no es orden sigue sin serlo.
  assert.equal(c('¿qué hay al norte de Juticalpa?'), null);
  assert.equal(c('¿cuál es la siguiente concesión que vence al sur?'), null);
  assert.equal(c('hazme el mapa geológico de la concesión el tule'), null);
  // Las etiquetas de Laya.
  assert.deepEqual(comandoDeLaya('rotar_izquierda'), { accion: 'rotar', dir: -1 });
  assert.deepEqual(comandoDeLaya('abrir_infra'), { accion: 'abrir', que: 'infraestructura' });
  assert.equal(comandoDeLaya('ninguna'), null);
  assert.equal(comandoDeLaya('algo_raro'), null);
  assert.equal(nombreDeComando({ accion: 'rotar', dir: 1 }), 'Girando a la derecha');
});

test('comandos: cada etiqueta del modelo «comando» de Laya tiene su orden', async () => {
  const fs = await import('node:fs');
  const { comandoDeLaya } = await import('../src-electrum/panel/comandos');
  const m = JSON.parse(fs.readFileSync(new URL('../scripts/nodo-t4/laya/modelos/comando/modelo.json', import.meta.url), 'utf8'));
  // El modelo es compartido: Electrum lee el grupo `accion`; el grupo `app` es de AU-RA y aquí no manda nada.
  for (const id of m.grupos.accion as string[]) {
    if (id === 'ninguna') assert.equal(comandoDeLaya(id), null);
    else assert.ok(comandoDeLaya(id), `sin orden para ${id}`);
  }
  for (const id of (m.grupos.app || []) as string[]) assert.equal(comandoDeLaya(id), null, `${id} es de AU-RA`);
});
