/**
 * Fase 2: el motor de reglas y la cola de aprobación humana.
 *
 * Lo que se fija aquí es lo que no puede fallar nunca, se lo pida quien se lo pida:
 *  · lo crítico no corre sin dos firmas, y quien lo pidió no firma lo suyo;
 *  · sin KYC aprobado no se mueve valor, ni con toda la junta firmando;
 *  · lo que se ejecuta después de aprobar es exactamente lo que se aprobó;
 *  · una regla que se rompe cierra la puerta, no la abre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluar, autorizar, resetRitmoTest, TOPE_EXTERNOS_HORA, type Accion, type Regla } from '../lib/cognitivo/politica';
import { comandoDeAprobacion, firmar, listarAprobaciones, registrarEjecutor, aprobacionPorId } from '../lib/cognitivo/aprobaciones';
import { verificarCadena } from '../lib/cognitivo/auditoria';
import { cerrar, sql } from '../lib/cognitivo/base';
import { correrAgente, type Pensar } from '../lib/agente/bucle';
import type { Contexto, Herramienta } from '../lib/agente/tipos';

const base: Accion = { herramienta: 'x', efecto: 'lectura', plataforma: 'electrum', args: {}, quien: 'jose', nivel: 'mando', prueba: 'sesion' };
const con = (o: Partial<Accion>): Accion => ({ ...base, ...o });

test('leer siempre se puede, sin sesión y con riesgo alto', () => {
  assert.equal(evaluar(con({ quien: null, nivel: null, prueba: null, riesgo: 99 })).veredicto, 'permitir');
});

test('sin identidad verificada no se escribe; un nombre escrito no prueba nada', () => {
  assert.equal(evaluar(con({ efecto: 'escritura', quien: null, nivel: null })).veredicto, 'bloquear');
  const d = evaluar(con({ efecto: 'escritura', prueba: 'nombre' }));
  assert.equal(d.veredicto, 'bloquear');
  assert.equal(d.regla, 'sin-identidad-no-cambia');
});

test('consulta no escribe, trabajo sí', () => {
  const d = evaluar(con({ efecto: 'escritura', nivel: 'lee' }));
  assert.equal(d.veredicto, 'bloquear');
  assert.match(d.motivo, /consulta/);
  assert.equal(evaluar(con({ efecto: 'escritura', nivel: 'escribe' })).veredicto, 'permitir');
});

test('cambiar el sistema exige mando con prueba', () => {
  assert.equal(evaluar(con({ efecto: 'sistema', nivel: 'escribe' })).veredicto, 'bloquear');
  assert.equal(evaluar(con({ efecto: 'sistema', prueba: 'nombre' })).veredicto, 'bloquear');
  assert.equal(evaluar(con({ efecto: 'sistema' })).veredicto, 'permitir');
});

test('lo crítico va a dos firmas; con dos firmas ya no vuelve a la cola', () => {
  const d = evaluar(con({ efecto: 'critico', herramienta: 'transferir_tokens' }));
  assert.equal(d.veredicto, 'revision');
  assert.equal(d.necesarias, 2);
  assert.equal(evaluar(con({ efecto: 'critico', herramienta: 'transferir_tokens', aprobada: { id: 'a', firmas: ['medardo'] } })).veredicto, 'revision');
  assert.equal(evaluar(con({ efecto: 'critico', herramienta: 'transferir_tokens', aprobada: { id: 'a', firmas: ['medardo', 'carlos'] } })).veredicto, 'permitir');
});

test('sin KYC aprobado no se mueve valor, ni con la junta entera firmando', () => {
  const d = evaluar(con({ efecto: 'critico', herramienta: 'transferir_tokens', hechos: { kyc: 'pendiente' }, aprobada: { id: 'a', firmas: ['medardo', 'carlos'] } }));
  assert.equal(d.veredicto, 'bloquear');
  assert.equal(d.regla, 'kyc-antes-de-mover-valor');
});

test('emitir un activo exige las firmas de la junta en el expediente', () => {
  assert.equal(evaluar(con({ efecto: 'critico', herramienta: 'emitir_activo', hechos: { kyc: 'aprobado' } })).regla, 'emision-exige-firmas-de-junta');
  assert.equal(evaluar(con({ efecto: 'critico', herramienta: 'emitir_activo', hechos: { kyc: 'aprobado', firmasJunta: 'completas' } })).veredicto, 'revision');
});

test('riesgo alto y envíos a terceros pasan por una persona', () => {
  assert.equal(evaluar(con({ efecto: 'externo', riesgo: 85, destino: 'junta' })).regla, 'riesgo-alto-a-revision');
  assert.equal(evaluar(con({ efecto: 'externo', riesgo: 10, destino: 'tercero' })).regla, 'externo-a-terceros-a-revision');
  assert.equal(evaluar(con({ efecto: 'externo', riesgo: 10, destino: 'junta' })).veredicto, 'permitir');
});

test('gana la regla más restrictiva, y una regla rota cierra la puerta', () => {
  const rota: Regla = { id: 'rota', descripcion: '', decidir: () => { throw new Error('boom'); } };
  const abre: Regla = { id: 'abre', descripcion: '', decidir: () => ({ veredicto: 'permitir', regla: 'abre', motivo: '' }) };
  const d = evaluar(con({}), [abre, rota]);
  assert.equal(d.veredicto, 'bloquear');
  assert.equal(d.regla, 'rota');
});

function conArchivos<T>(fn: () => Promise<T>): Promise<T> {
  const antes = { e: process.env.ELECTRUM_DB_URL, c: process.env.COGNITIVO_DB_URL, d: process.env.COGNITIVO_DIR };
  delete process.env.ELECTRUM_DB_URL;
  delete process.env.COGNITIVO_DB_URL;
  process.env.COGNITIVO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'politica-'));
  return fn().finally(() => {
    if (antes.e) process.env.ELECTRUM_DB_URL = antes.e;
    if (antes.c) process.env.COGNITIVO_DB_URL = antes.c;
    if (antes.d) process.env.COGNITIVO_DIR = antes.d;
    else delete process.env.COGNITIVO_DIR;
  });
}

test('el tope de envíos por hora corta a un agente desbocado', () =>
  conArchivos(async () => {
    resetRitmoTest();
    const envio = con({ efecto: 'externo', destino: 'junta', quien: null, nivel: null, prueba: null, plataforma: 'ultron' });
    for (let i = 0; i < TOPE_EXTERNOS_HORA.anonimo; i++) assert.equal((await autorizar(envio)).veredicto, 'permitir', `envío ${i + 1}`);
    const d = await autorizar(envio);
    assert.equal(d.veredicto, 'bloquear');
    assert.equal(d.regla, 'ritmo-de-envios');
    resetRitmoTest();
  }));

/** El ciclo completo: pedir, esperar, firmar dos veces, ejecutar lo congelado. */
async function cicloDeAprobacion() {
  const hechas: Array<Record<string, unknown>> = [];
  registrarEjecutor('transferir_tokens', async (args) => {
    hechas.push(args);
    return { ok: true, texto: `transferidos ${args.monto} a ${args.a}` };
  });
  const pedido = con({ efecto: 'critico', herramienta: 'transferir_tokens', args: { a: 'wallet-1', monto: 50 }, quien: 'jose', hechos: { kyc: 'aprobado' } });
  const d = await autorizar(pedido);
  assert.equal(d.veredicto, 'revision');
  assert.ok(d.aprobacionId);
  assert.equal(hechas.length, 0, 'pedir no ejecuta');

  // Pedir lo mismo otra vez no abre otra solicitud.
  assert.equal((await autorizar(pedido)).aprobacionId, d.aprobacionId);

  const id = d.aprobacionId!;
  assert.equal((await firmar({ id, quien: 'jose', nivel: 'mando', plataforma: 'electrum', decision: 'aprobar' })).ok, false, 'no se firma lo propio');
  assert.equal((await firmar({ id, quien: 'carlos', nivel: 'lee', plataforma: 'electrum', decision: 'aprobar' })).ok, false, 'consulta no firma');
  assert.equal((await firmar({ id, quien: 'medardo', nivel: 'mando', plataforma: 'ultron', decision: 'aprobar' })).ok, false, 'de otra plataforma no se ve');

  const r1 = await firmar({ id: id.slice(0, 8), quien: 'medardo', nivel: 'mando', plataforma: 'electrum', decision: 'aprobar' });
  assert.equal(r1.ok, true);
  assert.equal(r1.aprobacion?.estado, 'pendiente');
  assert.match(r1.motivo, /Falta 1 firma/);
  assert.equal((await firmar({ id, quien: 'medardo', nivel: 'mando', plataforma: 'electrum', decision: 'aprobar' })).ok, false, 'no firma dos veces');

  const r2 = await firmar({ id, quien: 'melany', nivel: 'mando', plataforma: 'electrum', decision: 'aprobar' });
  assert.equal(r2.aprobacion?.estado, 'ejecutada', r2.motivo);
  assert.deepEqual(hechas, [{ a: 'wallet-1', monto: 50 }], 'se ejecutó exactamente lo aprobado');
  assert.equal((await firmar({ id, quien: 'leonardo', nivel: 'mando', plataforma: 'electrum', decision: 'aprobar' })).ok, false, 'ya ejecutada');

  // Rechazar: una negativa basta.
  const otra = await autorizar(con({ efecto: 'critico', herramienta: 'transferir_tokens', args: { a: 'wallet-2', monto: 9 }, quien: 'jose', hechos: { kyc: 'aprobado' } }));
  const rr = await firmar({ id: otra.aprobacionId!, quien: 'medardo', nivel: 'mando', plataforma: 'electrum', decision: 'rechazar', nota: 'no conozco esa wallet' });
  assert.equal(rr.aprobacion?.estado, 'rechazada');
  assert.equal(hechas.length, 1);

  const pend = await listarAprobaciones({ plataforma: 'electrum', estado: 'pendiente' });
  assert.equal(pend.length, 0);
  const cadena = await verificarCadena();
  assert.equal(cadena.ok, true, JSON.stringify(cadena));
  return id;
}

test('aprobaciones en archivos: dos firmas, cuatro ojos, se ejecuta lo congelado', () => conArchivos(async () => void (await cicloDeAprobacion())));

test('si alguien cambia los argumentos en la cola, no se ejecuta', () =>
  conArchivos(async () => {
    let corrio = false;
    registrarEjecutor('mandar_informe', async () => ((corrio = true), { ok: true, texto: 'mandado' }));
    const d = await autorizar(con({ efecto: 'externo', herramienta: 'mandar_informe', destino: 'tercero', args: { a: 'cliente@ejemplo.com' } }));
    const f = path.join(process.env.COGNITIVO_DIR!, 'aprobaciones.jsonl');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('cliente@ejemplo.com', 'otro@ejemplo.com'));
    const r = await firmar({ id: d.aprobacionId!, quien: 'medardo', nivel: 'mando', plataforma: 'electrum', decision: 'aprobar' });
    assert.equal(r.aprobacion?.estado, 'fallida');
    assert.match(r.motivo, /huella/);
    assert.equal(corrio, false);
  }));

test('una solicitud vencida ya no se firma', () =>
  conArchivos(async () => {
    process.env.APROBACION_HORAS = '0.0000001';
    const d = await autorizar(con({ efecto: 'externo', herramienta: 'x_tercero', destino: 'tercero', args: { n: 1 } }));
    delete process.env.APROBACION_HORAS;
    await new Promise((r) => setTimeout(r, 5));
    const ap = await aprobacionPorId(d.aprobacionId!);
    assert.equal(ap?.estado, 'vencida');
    assert.equal((await firmar({ id: d.aprobacionId!, quien: 'medardo', nivel: 'mando', plataforma: 'electrum', decision: 'aprobar' })).ok, false);
  }));

test('los comandos de Telegram firman solo con mando', () =>
  conArchivos(async () => {
    const d = await autorizar(con({ efecto: 'externo', herramienta: 'x_tel', destino: 'tercero', args: { n: 2 }, plataforma: 'ultron' }));
    const corto = d.aprobacionId!.slice(0, 8);
    assert.equal(await comandoDeAprobacion({ comando: '/hola', texto: '/hola', quien: 'medardo', nivel: 'mando', plataforma: 'ultron' }), null);
    assert.match((await comandoDeAprobacion({ comando: '/aprobar', texto: `/aprobar ${corto}`, quien: 'carlos', nivel: 'lee', plataforma: 'ultron' }))!, /mando/);
    assert.match((await comandoDeAprobacion({ comando: '/solicitudes', texto: '/solicitudes', quien: 'medardo', nivel: 'mando', plataforma: 'ultron' }))!, new RegExp(corto));
    assert.match((await comandoDeAprobacion({ comando: '/rechazar', texto: `/rechazar ${corto} no va`, quien: 'medardo', nivel: 'mando', plataforma: 'ultron' }))!, /Rechazada/);
  }));

test('el bucle del agente no corre una herramienta crítica: la deja en la cola', () =>
  conArchivos(async () => {
    let corrio = false;
    const emitir: Herramienta = {
      nombre: 'emitir_activo',
      descripcion: 'emite',
      esquema: { type: 'object', properties: { cantidad: { type: 'number', description: 'n' } }, required: ['cantidad'] },
      efecto: 'critico',
      plataformas: ['electrum'],
      async ejecutar() {
        corrio = true;
        return { ok: true, texto: 'emitido' };
      },
    };
    const respuestas = ['<tool_call>{"name":"emitir_activo","arguments":{"cantidad":1000}}</tool_call>', 'Listo.'];
    const pensar: Pensar = async () => ({ texto: respuestas.shift() || 'Listo.' });
    const ctx: Contexto = { quien: 'jose', nivel: 'mando', plataforma: 'electrum', canal: 'mesa', mensaje: 'emite mil', prueba: 'sesion' };
    const r = await correrAgente({ mensajes: [{ role: 'user', content: 'emite mil' }], herramientas: [emitir], ctx, pensar });
    assert.equal(corrio, false, 'el modelo pidió y no bastó');
    assert.equal(r.traza[0].ok, false);
    assert.match(r.traza[0].resumen, /NO EJECUTADO|EN ESPERA/);
  }));

const conBase = /pruebas/.test(process.env.ELECTRUM_DB_URL || '');

test('aprobaciones en Postgres', { skip: !conBase && 'sin base de pruebas' }, async () => {
  await sql('TRUNCATE cognitivo.aprobacion, cognitivo.auditoria');
  await cicloDeAprobacion();
  await sql('TRUNCATE cognitivo.aprobacion, cognitivo.auditoria');
  await cerrar();
});
