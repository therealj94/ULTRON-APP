/**
 * Memoria estructurada: fichas, relaciones y eventos, separadas por plataforma, y escritas solo por
 * quien tiene nivel para escribir (el motor de reglas, a través del bucle del agente).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buscarEntidades, ficha, fichaEnTexto, fichasMencionadas, registrarEntidad, registrarEvento, relacionar, claveDe } from '../lib/cognitivo/entidades';
import { MEMORIA_ESTRUCTURADA } from '../lib/manos/memoria';
import { correrAgente, type Pensar } from '../lib/agente/bucle';
import type { Contexto } from '../lib/agente/tipos';
import { cerrar, sql } from '../lib/cognitivo/base';

function conArchivos<T>(fn: () => Promise<T>): Promise<T> {
  const antes = { e: process.env.ELECTRUM_DB_URL, c: process.env.COGNITIVO_DB_URL, d: process.env.COGNITIVO_DIR };
  delete process.env.ELECTRUM_DB_URL;
  delete process.env.COGNITIVO_DB_URL;
  process.env.COGNITIVO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'entidades-'));
  return fn().finally(() => {
    if (antes.e) process.env.ELECTRUM_DB_URL = antes.e;
    if (antes.c) process.env.COGNITIVO_DB_URL = antes.c;
    if (antes.d) process.env.COGNITIVO_DIR = antes.d;
    else delete process.env.COGNITIVO_DIR;
  });
}

test('la clave natural ignora acentos, mayúsculas y signos', () => {
  assert.equal(claveDe('Minera del Sur, S.A.'), claveDe('MINERA DEL SUR S A'));
  assert.equal(claveDe('Danlí'), 'danli');
  assert.equal(claveDe('Kiri Holdings Inc.'), 'kiri-holdings');
  assert.equal(claveDe('Orden Global Corp'), 'orden-global');
});

async function ciclo() {
  const empresa = await registrarEntidad({ plataforma: 'ultron', tipo: 'Empresa', nombre: 'Minera del Sur S.A.', atributos: { sector: 'minería', jurisdiccion: 'Honduras' }, estado: 'revisión documental', riesgo: 'medio', quien: 'jose' });
  // Actualizar funde atributos, no los reemplaza.
  const otra = await registrarEntidad({ plataforma: 'ultron', tipo: 'empresa', nombre: 'MINERA DEL SUR S.A.', atributos: { documentos: ['NI 43-101', 'KYC'] }, quien: 'jose' });
  assert.equal(otra.id, empresa.id);
  assert.deepEqual(otra.atributos, { sector: 'minería', jurisdiccion: 'Honduras', documentos: ['NI 43-101', 'KYC'] });
  assert.equal(otra.estado, 'revisión documental', 'lo que no vino se conserva');

  const conc = await registrarEntidad({ plataforma: 'ultron', tipo: 'concesion', nombre: 'El Porvenir', atributos: { departamento: 'El Paraíso' } });
  await relacionar({ plataforma: 'ultron', desde: empresa.id, hasta: conc.id, tipo: 'titular de', quien: 'jose' });
  await registrarEvento({ plataforma: 'ultron', entidad: empresa.id, tipo: 'documento', detalle: 'Llegó el NI 43-101 firmado.', fuente: 'correo de Pedro', quien: 'jose' });

  const f = (await ficha('ultron', empresa.id))!;
  assert.equal(f.relaciones[0].tipo, 'titular_de');
  assert.equal(f.relaciones[0].con.nombre, 'El Porvenir');
  assert.equal(f.eventos[0].tipo, 'documento');
  const texto = fichaEnTexto(f);
  assert.match(texto, /Minera del Sur/);
  assert.match(texto, /titular de El Porvenir/);
  assert.match(texto, /NI 43-101/);

  // Otra plataforma no la ve.
  assert.equal((await buscarEntidades('electrum', 'minera del sur')).length, 0);
  assert.equal((await ficha('electrum', empresa.id)), null);
  await assert.rejects(relacionar({ plataforma: 'electrum', desde: empresa.id, hasta: conc.id, tipo: 'x' }));

  // Nombrarla en una pregunta trae la ficha.
  const m = await fichasMencionadas('ultron', '¿Cómo va lo de Minera del Sur? ¿Ya mandaron el KYC?');
  assert.equal(m[0]?.id, empresa.id);
  assert.equal((await fichasMencionadas('ultron', 'hola, ¿cómo estás?')).length, 0);
  assert.equal((await buscarEntidades('ultron', 'porvenir', { tipo: 'concesion' }))[0].id, conc.id);
}

test('fichas en archivos: crear, fundir, relacionar, eventos, separadas por plataforma', () => conArchivos(ciclo));

test('el agente: consulta no escribe fichas, trabajo sí', () =>
  conArchivos(async () => {
    const modelo = (...rs: string[]): Pensar => async () => ({ texto: rs.shift() || 'Listo.' });
    const pedido = '<tool_call>{"name":"entidad_registrar","arguments":{"tipo":"empresa","nombre":"Kiri Holdings"}}</tool_call>';
    const lee: Contexto = { quien: 'carlos', nivel: 'lee', plataforma: 'ultron', canal: 'mesa', mensaje: 'x', prueba: 'sesion' };
    const r1 = await correrAgente({ mensajes: [{ role: 'user', content: 'x' }], herramientas: MEMORIA_ESTRUCTURADA, ctx: lee, pensar: modelo(pedido, 'No puedo.') });
    assert.equal(r1.traza[0].ok, false);
    assert.equal((await buscarEntidades('ultron', 'kiri')).length, 0);
    const escribe: Contexto = { ...lee, quien: 'jose', nivel: 'escribe' };
    const r2 = await correrAgente({ mensajes: [{ role: 'user', content: 'x' }], herramientas: MEMORIA_ESTRUCTURADA, ctx: escribe, pensar: modelo(pedido, 'Registrada.') });
    assert.equal(r2.traza[0].ok, true);
    assert.equal((await buscarEntidades('ultron', 'kiri'))[0].nombre, 'Kiri Holdings');
  }));

const conBase = /pruebas/.test(process.env.ELECTRUM_DB_URL || '');

test('fichas en Postgres', { skip: !conBase && 'sin base de pruebas' }, async () => {
  await sql('TRUNCATE cognitivo.entidad, cognitivo.relacion, cognitivo.evento, cognitivo.auditoria RESTART IDENTITY CASCADE');
  await ciclo();
  await sql('TRUNCATE cognitivo.entidad, cognitivo.relacion, cognitivo.evento, cognitivo.auditoria RESTART IDENTITY CASCADE');
  await cerrar();
});
