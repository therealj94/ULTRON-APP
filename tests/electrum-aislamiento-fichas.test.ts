/**
 * DR ELECTRUM: LAS FICHAS (memoria estructurada) SON DE UNA ORGANIZACIÓN, y sus turnos durables van bajo su prefijo.
 *
 * Reproducción sobre 01a1359: lib/cognitivo/entidades.ts (y las manos de lib/manos/memoria.ts) solo filtraban por
 * plataforma. Un cliente de Electrum (mina.hn) encontraba, leía, relacionaba y anotaba en las fichas de la casa o de otro
 * cliente, también por MCP. Y los registros de turno de Electrum vivían bajo `ultron/durable/`, el prefijo de AU-RA.
 *
 * Contrato: cada ficha lleva su organización (la de la petición, server/electrum/organizacion.ts); toda lectura y
 * escritura filtra por ella; lo que no tiene organización (todo lo de antes) es de la casa. Los turnos de Electrum van a
 * su propio almacén (`electrum/durable/` en S3; en disco, la carpeta `-electrum`) y los del prefijo viejo se siguen leyendo.
 */
import './datos-prueba';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'electrum-fichas-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
delete process.env.ELECTRUM_DB_URL;
delete process.env.COGNITIVO_DB_URL;
process.env.COGNITIVO_DIR = path.join(tmp, 'cognitivo');
process.env.AURA_DEV = '1';
process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-aislar-fichas';
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(tmp, 'cerradas.json');
process.env.ULTRON_MEMORIA_BUCKET = '';
delete process.env.MCP_TOKEN;
delete process.env.MCP_OAUTH;
// Pérez es de un cliente (mina.hn), con acceso de consulta a Electrum (sexta columna: la organización).
process.env.ULTRON_PADRON = 'perez | Pérez | perez@mina.hn | | electrum=lee | mina.hn';

const E = await import('../lib/cognitivo/entidades');
const { MEMORIA_ESTRUCTURADA } = await import('../lib/manos/memoria');
const { CASA, conOrganizacion } = await import('../server/electrum/organizacion');
const { reiniciarPadron } = await import('../lib/acceso');
reiniciarPadron();

const CLIENTE = 'mina.hn';
const OTRO = 'otra-empresa.hn';
const mano = (n: string) => MEMORIA_ESTRUCTURADA.find((h) => h.nombre === n)!;
const ctx = (quien: string) => ({ quien, nivel: 'mando' as const, plataforma: 'electrum' as const, canal: 'mesa' as const, mensaje: '', prueba: null, riesgo: null });

test('cada organización ve, relaciona y anota SOLO sus fichas; lo de antes (sin organización) es de la casa', async () => {
  // Una ficha de antes del aislamiento: escrita fuera de cualquier ámbito, sin marca → de la casa.
  const vieja = await E.registrarEntidad({ plataforma: 'electrum', tipo: 'empresa', nombre: 'Minera Antigua S.A.', atributos: { nota: 'de antes' } });
  assert.equal(vieja.organizacion ?? null, null, 'la casa guarda sin marca, como siempre');
  const casa = await conOrganizacion(CASA, () => E.registrarEntidad({ plataforma: 'electrum', tipo: 'empresa', nombre: 'Minera del Sur', atributos: { secreto: 'de la casa' } }));
  const cli = await conOrganizacion(CLIENTE, () => E.registrarEntidad({ plataforma: 'electrum', tipo: 'empresa', nombre: 'Minera del Sur', atributos: { secreto: 'del cliente' } }));
  const cliConc = await conOrganizacion(CLIENTE, () => E.registrarEntidad({ plataforma: 'electrum', tipo: 'concesion', nombre: 'Quebrada Seca' }));
  assert.notEqual(cli.id, casa.id, 'el mismo nombre en otra organización es OTRA ficha (no funde atributos con la de la casa)');
  assert.deepEqual(cli.atributos, { secreto: 'del cliente' });

  // El cliente: solo lo suyo.
  await conOrganizacion(CLIENTE, async () => {
    const ids = (await E.buscarEntidades('electrum', 'minera')).map((e) => e.id).sort();
    assert.deepEqual(ids, [cli.id], 'ni la de la casa ni la de antes');
    assert.equal(await E.ficha('electrum', casa.id), null);
    assert.equal(await E.ficha('electrum', vieja.id), null);
    assert.deepEqual((await E.fichasMencionadas('electrum', '¿cómo va Minera Antigua?')).map((f) => f.id), []);
    await assert.rejects(E.relacionar({ plataforma: 'electrum', desde: cliConc.id, hasta: casa.id, tipo: 'titular de' }), /no existe/);
    await assert.rejects(E.registrarEvento({ plataforma: 'electrum', entidad: casa.id, tipo: 'nota', detalle: 'meto algo en la ficha ajena' }), /no existe/);
    await E.relacionar({ plataforma: 'electrum', desde: cli.id, hasta: cliConc.id, tipo: 'titular de' });
  });
  // Otro cliente: nada de nadie.
  await conOrganizacion(OTRO, async () => {
    assert.deepEqual(await E.buscarEntidades('electrum', 'minera'), []);
    assert.equal(await E.ficha('electrum', cli.id), null);
  });
  // La casa: lo suyo y lo de antes; no lo del cliente.
  await conOrganizacion(CASA, async () => {
    const ids = (await E.buscarEntidades('electrum', 'minera')).map((e) => e.id).sort((a, b) => a - b);
    assert.deepEqual(ids, [vieja.id, casa.id].sort((a, b) => a - b));
    assert.equal(await E.ficha('electrum', cli.id), null);
    assert.equal((await E.fichasMencionadas('electrum', '¿cómo va Minera Antigua?'))[0]?.id, vieja.id);
  });

  // Las manos (lo que usa el modelo, en pantalla y por MCP): el mismo filtro.
  await conOrganizacion(CLIENTE, async () => {
    const r = await mano('entidad_buscar').ejecutar({ nombre: 'minera' }, ctx('perez'));
    assert.match(r.texto, new RegExp(`#${cli.id} `));
    assert.doesNotMatch(r.texto, new RegExp(`#${casa.id} `));
    assert.equal((await mano('entidad_ficha').ejecutar({ id: casa.id }, ctx('perez'))).ok, false);
    await assert.rejects(mano('entidad_evento').ejecutar({ id: vieja.id, tipo: 'nota', detalle: 'x' }, ctx('perez')));
  });
  // AU-RA no tiene organizaciones: sus fichas, como siempre.
  const aura = await conOrganizacion(CLIENTE, () => E.registrarEntidad({ plataforma: 'ultron', tipo: 'empresa', nombre: 'Kiri Holdings' }));
  assert.equal((await E.buscarEntidades('ultron', 'kiri'))[0]?.id, aura.id);
});

test('por MCP, el cliente no ve la ficha de la casa', async () => {
  const casa = await conOrganizacion(CASA, () => E.registrarEntidad({ plataforma: 'electrum', tipo: 'empresa', nombre: 'Aurifera Reservada', atributos: { margen: 'confidencial' } }));
  const { montarMcp, resetTopeMcpTest } = await import('../server/mcp');
  const { emitirTokenMcp } = await import('../server/seguridad');
  resetTopeMcpTest();
  const app = express();
  app.use(express.json());
  montarMcp(app, 'electrum');
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  try {
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/mcp`;
    const token = emitirTokenMcp({ correo: 'perez@mina.hn', nombre: 'Pérez', rol: 'Cliente' }, 'acceso', 'c1.x.y', 60_000).token;
    const llamar = async (name: string, args: object) => {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
      assert.equal(r.status, 200);
      return ((await r.json()) as any).result.content[0].text as string;
    };
    assert.doesNotMatch(await llamar('entidad_buscar', { nombre: 'aurifera' }), new RegExp(`#${casa.id} `));
    assert.doesNotMatch(await llamar('entidad_ficha', { id: casa.id }), /confidencial/);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('turnos durables: Electrum bajo su propio prefijo; lo guardado bajo `ultron/durable/` se sigue leyendo', async () => {
  const D = await import('../lib/durable');
  const T = await import('../server/turno-unico');
  const { claveTurnoElectrum } = await import('../server/electrum/turno-idempotente');
  assert.equal((D as any).PREFIJO_S3_ELECTRUM, 'electrum/durable');
  // El almacén de verdad (disco, sin S3): la carpeta de Electrum no es la de AU-RA.
  const antes = { ctx: process.env.NODE_TEST_CONTEXT, dir: process.env.ULTRON_DURABLE_DIR };
  delete process.env.NODE_TEST_CONTEXT;
  process.env.ULTRON_DURABLE_DIR = path.join(tmp, 'durable');
  try {
    const P = T.crearTurnosUnicos({ proceso: 'prueba-prefijo' });
    const kE = claveTurnoElectrum('perez@mina.hn', 'turnoElectrum01')!;
    const kA = T.claveTurno('jose@ordenglobal.org', 'turnoAura00001')!;
    const rE = await P.reclamarTurno(kE, 50);
    const rA = await P.reclamarTurno(kA, 50);
    assert.ok('terminar' in rE && 'terminar' in rA);
    await (rE as any).terminar({ reply: 'de electrum', voz: 'x', emocion: 'neutral', via: 'electrum:ok', herramientas: [] });
    await (rA as any).terminar({ reply: 'de aura', voz: 'x', emocion: 'neutral', via: 'ok', herramientas: [] });
    await P.alDia();
    const archivos = (d: string) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).map(String).filter((f) => f.endsWith('.json')) : []);
    assert.equal(archivos(path.join(tmp, 'durable-electrum', 'turnos')).length, 1, 'el turno de Electrum va a su carpeta');
    assert.equal(archivos(path.join(tmp, 'durable', 'turnos')).length, 1, 'y el de AU-RA a la de siempre (solo el suyo)');

    // Un turno de Electrum guardado ANTES (bajo el prefijo viejo) se sigue repitiendo.
    const viejo = D.almacenDurable();
    const kViejo = D.claveDe('turnos', 'electrum:perez@mina.hn', 'turnoViejo0001');
    await D.crearUnaVez(kViejo, { v: 1, estado: 'hecho', titular: 'otro', token: 1, vence: 0, efectos: [], t: Date.now(), actualizado: Date.now(), resultado: { reply: 'respuesta de antes', voz: 'x', emocion: 'neutral', via: 'electrum:ok', herramientas: [] } }, viejo);
    const r = await P.reclamarTurno(claveTurnoElectrum('perez@mina.hn', 'turnoViejo0001'), 50);
    assert.equal((r as any).previo?.reply, 'respuesta de antes');
  } finally {
    if (antes.ctx !== undefined) process.env.NODE_TEST_CONTEXT = antes.ctx;
    if (antes.dir === undefined) delete process.env.ULTRON_DURABLE_DIR;
    else process.env.ULTRON_DURABLE_DIR = antes.dir;
  }
});

test('almacenConRespaldo: leer cae al viejo; crear no duplica lo viejo; el CAS sobre lo viejo lo muda al nuevo', async () => {
  const D: any = await import('../lib/durable');
  const nuevo = D.almacenEnMemoria();
  const viejo = D.almacenEnMemoria();
  const a = D.almacenConRespaldo(nuevo, viejo);
  await viejo.crear('turnos/x/1', { n: 1 });
  const l = await a.leer('turnos/x/1');
  assert.deepEqual(l.valor, { n: 1 });
  assert.equal((await a.crear('turnos/x/1', { n: 9 })).conflicto, true, 'ya existía bajo el prefijo viejo');
  assert.equal((await a.cas('turnos/x/1', { n: 2 }, l.etag)).ok, true);
  assert.equal(nuevo.objetos.size, 1, 'mudado al nuevo');
  assert.deepEqual((await a.leer('turnos/x/1')).valor, { n: 2 });
  assert.equal((await a.cas('turnos/x/1', { n: 3 }, l.etag)).ok, false, 'el ETag viejo ya no vale dos veces');
  assert.deepEqual(JSON.parse(viejo.objetos.get('turnos/x/1')), { n: 1 }, 'nunca se escribe en el viejo');
});
