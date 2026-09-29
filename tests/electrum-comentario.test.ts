import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comentarioDeRespaldo, instruccion, QUIENES, TEMAS } from '../server/electrum/comentario';
import { bloqueMesa } from '../server/electrum/personajes';
import { comandoDe } from '../src-electrum/panel/comandos';

test('cada tema lo comenta quien sabe de eso', () => {
  assert.equal(QUIENES.timelapse[0], 'tatiana');
  assert.equal(QUIENES.perfil[0], 'tatiana');
  assert.equal(QUIENES.geologico[0], 'electrum');
  for (const t of TEMAS) assert.ok(QUIENES[t].length >= 1, t);
});

test('la instrucción pide cifras solo del contexto y terminar preguntando', () => {
  const i = instruccion('timelapse', ['tatiana', 'electrum']);
  assert.match(i, /Ing\. Tatiana/);
  assert.match(i, /SOLO del contexto/);
  assert.match(i, /ÚLTIMA línea le pregunta/);
});

test('sin cerebro, un comentario honesto con el contexto y la pregunta', () => {
  const l = comentarioDeRespaldo('perfil', 'Perfil topográfico de 2,4 km. Pendiente máxima 38 %.', ['tatiana', 'chema']);
  assert.equal(l[0].quien, 'tatiana');
  assert.match(l[0].texto, /Perfil topográfico de 2,4 km/);
  assert.match(l[l.length - 1].texto, /\?$/);
  assert.equal(comentarioDeRespaldo('general', '', ['electrum']).length, 1);
});

test('la mesa abierta discute de verdad y cierra preguntando', () => {
  const b = bloqueMesa(['electrum'], true)!;
  assert.match(b, /DISCUSIÓN/);
  assert.match(b, /CIERRA Dr Electrum/);
  assert.match(b, /le pregunta a la persona/);
});

test('comandos de la mesa, el silencio y la interrupción', () => {
  assert.deepEqual(comandoDe('abre la mesa técnica'), { accion: 'mesa', abrir: true });
  assert.deepEqual(comandoDe('cierra la mesa'), { accion: 'mesa', abrir: false });
  assert.deepEqual(comandoDe('modo silencio'), { accion: 'silencio', activar: true });
  assert.deepEqual(comandoDe('activa las voces'), { accion: 'silencio', activar: false });
  assert.deepEqual(comandoDe('no me interrumpas'), { accion: 'interrumpir', activar: false });
  assert.deepEqual(comandoDe('silencio'), { accion: 'callar' });
});
