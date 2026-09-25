/**
 * Fase 1 de la capa cognitiva: la traza de cada turno y la cadena de auditoría.
 *
 * Se prueban los dos almacenes: archivos (sin base) y Postgres (la base de pruebas, si está). Lo
 * que importa comprobar no es que «se guarda», sino tres cosas que fallan en silencio:
 *  1. que una clave pegada en el chat NO queda escrita en la traza,
 *  2. que lo anotado desde el fondo del turno (sin recibir la traza) llega a la traza correcta,
 *  3. que cambiar un registro de auditoría se detecta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redactar } from '../lib/cognitivo/base';
import { cerrar, sql } from '../lib/cognitivo/base';
import { enTurno, iniciarTraza, listarTrazas, darFeedback, trazaActual, trazaPorId, resumenTrazas } from '../lib/cognitivo/traza';
import { auditar, verificarCadena, leerAuditoria } from '../lib/cognitivo/auditoria';

// Claves con forma real pero inventadas: nunca una de verdad en el repositorio.
const FALSA_AWS = 'AKIA' + 'ABCDEFGHIJKLMNOP';
const FALSO_SECRETO = 'abcdEFGHijklMNOPqrstUVWXyz0123456789ABCD';
const FALSA_RENDER = 'rnd_' + 'abcdefghijklmnopqrstu';

test('las claves pegadas en el chat se tapan antes de guardar', () => {
  const t = redactar(`usa ${FALSA_AWS} con ${FALSO_SECRETO} y ${FALSA_RENDER}; password: hunter2hunter2`);
  assert.doesNotMatch(t, new RegExp(FALSA_AWS));
  assert.doesNotMatch(t, /abcdEFGHijkl/);
  assert.doesNotMatch(t, /rnd_abcdef/);
  assert.doesNotMatch(t, /hunter2/);
  assert.match(t, /SECRETO TAPADO/);
});

test('también las formas que se escapaban: JSON, «la clave es», Stripe, JWT, Bearer, Google', () => {
  const stripe = 'sk_' + 'live_' + 'abcdefghijklmnop1234';
  const jwt = 'eyJ' + 'hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghijklmnop';
  const google = 'AIza' + 'SyA1234567890abcdefghijklmnopqrstuv';
  const casos = [
    [`{"password":"Tr0pic4l!x"}`, /Tr0pic4l/],
    [`la clave es Ornitorrinco77`, /Ornitorrinco77/],
    [`mi contraseña es Pajaro-Azul-9`, /Pajaro-Azul/],
    [`cobra con ${stripe}`, /live_abcdef/],
    [`Authorization: Bearer abcdefghijklmnopqrstuvwx`, /abcdefghijklmnopqrstuvwx/],
    [`token ${jwt}`, /hbGciOiJ/],
    [`maps ${google}`, /SyA1234567890/],
  ] as const;
  for (const [entrada, prohibido] of casos) assert.doesNotMatch(redactar(entrada), prohibido, entrada);
  assert.equal(redactar('el precio del oro subió'), 'el precio del oro subió');
});

test('un hash de commit no es un secreto: no se tapa', () => {
  const sha = 'a1464e8dc46b36b08cf2005a5d5a9add0ed5cbf0';
  assert.equal(redactar(`commit ${sha}`), `commit ${sha}`);
});

function conArchivos<T>(fn: () => Promise<T>): Promise<T> {
  const antes = { e: process.env.ELECTRUM_DB_URL, c: process.env.COGNITIVO_DB_URL, d: process.env.COGNITIVO_DIR };
  delete process.env.ELECTRUM_DB_URL;
  delete process.env.COGNITIVO_DB_URL;
  process.env.COGNITIVO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cognitivo-'));
  return fn().finally(() => {
    if (antes.e) process.env.ELECTRUM_DB_URL = antes.e;
    if (antes.c) process.env.COGNITIVO_DB_URL = antes.c;
    if (antes.d) process.env.COGNITIVO_DIR = antes.d;
    else delete process.env.COGNITIVO_DIR;
  });
}

/** Algo profundo del turno que no recibe la traza: la tiene que encontrar sola. */
async function herramientaProfunda() {
  await new Promise((r) => setTimeout(r, 5));
  trazaActual()?.paso({ herramienta: 'web', ok: true, ms: 5, resumen: 'encontré algo', args: { q: 'oro', clave: 'no-se-guarda' } });
  trazaActual()?.tokens(120, 40);
  trazaActual()?.tokens(80, 10);
}

async function cicloDeTraza() {
  const reg = iniciarTraza({ plataforma: 'ultron', canal: 'mesa', quien: 'jose', nivel: 'mando', pregunta: `guarda ${FALSA_AWS}` });
  await enTurno(reg, async () => {
    await herramientaProfunda();
    trazaActual()?.politica({ herramienta: 'enviar', veredicto: 'revision', regla: 'externo-no-miembro', motivo: 'destinatario fuera de la junta' });
  });
  // Fuera del turno no hay traza: nada se anota por accidente en otra.
  assert.equal(trazaActual(), null);
  await reg.cerrar({ respuesta: 'listo', emocion: 'feliz', via: 'prueba', modelo: 'qwen-prueba' });

  const t = await trazaPorId(reg.id);
  assert.ok(t, 'la traza quedó guardada');
  assert.equal(t!.quien, 'jose');
  assert.doesNotMatch(t!.pregunta, /AKIA/);
  assert.equal(t!.pasos.length, 1);
  assert.equal((t!.pasos[0].args as any).clave, '[SECRETO TAPADO]');
  assert.equal(t!.tokens_in, 200);
  assert.equal(t!.tokens_out, 50);
  assert.equal(t!.politica[0].veredicto, 'revision');
  assert.ok((t!.ms ?? -1) >= 0);

  assert.equal(await darFeedback(reg.id, -1, 'se equivocó de cifra', 'jose'), true);
  const [ultima] = await listarTrazas({ plataforma: 'ultron', limite: 1 });
  assert.equal(ultima.id, reg.id);
  assert.equal(ultima.feedback, -1);
  const r = await resumenTrazas('ultron', 1);
  assert.ok(r.turnos >= 1 && r.revisiones >= 1 && r.noUtiles >= 1);
  assert.equal(r.porHerramienta.web.usos >= 1, true);
}

test('traza en archivos: lo anotado en el fondo del turno llega, sin secretos', () => conArchivos(cicloDeTraza));

test('auditoría en archivos: la cadena cuadra y un cambio se detecta', () =>
  conArchivos(async () => {
    for (let i = 0; i < 4; i++) await auditar({ tipo: 'politica.bloqueo', plataforma: 'ultron', quien: 'carlos', datos: { i, herramienta: 'emitir_activo' } });
    assert.deepEqual(await verificarCadena(), { ok: true, revisados: 4 });
    assert.equal((await leerAuditoria({ limite: 2 }))[0].datos.i, 3);

    const f = path.join(process.env.COGNITIVO_DIR!, 'auditoria.jsonl');
    const lineas = fs.readFileSync(f, 'utf8').trim().split('\n');
    const dos = JSON.parse(lineas[1]);
    dos.quien = 'medardo'; // alguien cambia quién lo hizo
    lineas[1] = JSON.stringify(dos);
    fs.writeFileSync(f, lineas.join('\n') + '\n');
    const v = await verificarCadena();
    assert.equal(v.ok, false);
    assert.equal(v.roto?.seq, 2);
  }));

test('auditoría: la cadena sigue verificable después de varias rotaciones del archivo', () =>
  conArchivos(async () => {
    const antes = process.env.COGNITIVO_TOPE_BYTES;
    process.env.COGNITIVO_TOPE_BYTES = '2000';
    try {
      for (let i = 0; i < 60; i++) await auditar({ tipo: 'entidad.cambio', plataforma: 'ultron', quien: 'jose', datos: { i, relleno: 'x'.repeat(40) } });
      const archivos = fs.readdirSync(process.env.COGNITIVO_DIR!).filter((n) => n.startsWith('auditoria.jsonl'));
      assert.ok(archivos.filter((n) => n.includes('.gen-')).length >= 2, `rotó varias veces: ${archivos.join(', ')}`);
      const v = await verificarCadena();
      assert.equal(v.ok, true, JSON.stringify(v));
      assert.equal(v.revisados, 60, 'ningún eslabón se perdió');
    } finally {
      if (antes === undefined) delete process.env.COGNITIVO_TOPE_BYTES;
      else process.env.COGNITIVO_TOPE_BYTES = antes;
    }
  }));

test('auditoría: escrituras simultáneas no rompen la cadena', () =>
  conArchivos(async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => auditar({ tipo: 'sistema.cambio', datos: { i } })));
    const v = await verificarCadena();
    assert.equal(v.ok, true);
    assert.equal(v.revisados, 12);
  }));

const URL_PRUEBAS = process.env.ELECTRUM_DB_URL || '';
const conBase = /pruebas/.test(URL_PRUEBAS);

test('traza y auditoría en Postgres', { skip: !conBase && 'sin base de pruebas' }, async () => {
  await sql('TRUNCATE cognitivo.auditoria, cognitivo.traza_turno');
  await cicloDeTraza();
  await Promise.all(Array.from({ length: 6 }, (_, i) => auditar({ tipo: 'aprobacion.creada', plataforma: 'electrum', quien: 'jose', datos: { i, nested: { b: 2, a: 1 } } })));
  assert.deepEqual(await verificarCadena(), { ok: true, revisados: 6 });
  await sql(`UPDATE cognitivo.auditoria SET datos = jsonb_set(datos, '{i}', '99') WHERE seq = (SELECT min(seq) + 2 FROM cognitivo.auditoria)`);
  const v = await verificarCadena();
  assert.equal(v.ok, false);
  assert.match(v.roto!.motivo, /modific/);
  await sql('TRUNCATE cognitivo.auditoria, cognitivo.traza_turno');
  await cerrar();
});
