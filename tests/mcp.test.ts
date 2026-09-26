/**
 * El servidor MCP habla con el cliente OFICIAL del protocolo (no con uno hecho a medida que podría
 * equivocarse igual que el servidor), expone solo lectura, y cada llamada queda en la traza.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { configMcp, herramientasMcp, montarMcp, resetTopeMcpTest } from '../server/mcp';
import { listarTrazas } from '../lib/cognitivo/traza';
import { registrarEntidad } from '../lib/cognitivo/entidades';

const TOKEN = 'prueba-mcp-0123456789abcdefghij';

async function conEntorno<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const antes: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    antes[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function levantar(plataforma: 'ultron' | 'electrum') {
  const app = express();
  app.use(express.json());
  const montado = montarMcp(app, plataforma);
  const s = await new Promise<import('node:http').Server>((ok) => {
    const x = app.listen(0, '127.0.0.1', () => ok(x));
  });
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}/mcp`, montado, cerrar: () => new Promise((ok) => s.close(ok)) };
}

const archivos = () => ({ ELECTRUM_DB_URL: undefined, COGNITIVO_DB_URL: undefined, COGNITIVO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-')) });

test('sin token, con token corto, sin persona o con una persona sin acceso, no se monta', () => {
  const casos: Array<[Record<string, string | undefined>, RegExp]> = [
    [{ MCP_TOKEN: undefined, MCP_QUIEN: 'jose' }, /sin MCP_TOKEN/],
    [{ MCP_TOKEN: 'corto', MCP_QUIEN: 'jose' }, /corto/],
    [{ MCP_TOKEN: TOKEN, MCP_QUIEN: undefined }, /MCP_QUIEN/],
    [{ MCP_TOKEN: TOKEN, MCP_QUIEN: 'carlos' }, /no tiene acceso a electrum/],
  ];
  return (async () => {
    for (const [vars, motivo] of casos) {
      await conEntorno(vars, async () => {
        const c = configMcp('electrum');
        assert.equal(c.ok, false);
        assert.match((c as any).motivo, motivo);
      });
    }
  })();
});

test('solo lectura, sin herramientas de pantalla, cada plataforma las suyas', () => {
  const e = herramientasMcp('electrum').map((h) => h.nombre);
  const u = herramientasMcp('ultron').map((h) => h.nombre);
  assert.ok(e.includes('catastro_buscar') && e.includes('entidad_ficha'));
  for (const n of ['mapa_volar', 'mapa_capa', 'informe_pdf', 'entidad_registrar', 'entidad_relacionar', 'entidad_evento']) assert.ok(!e.includes(n), n);
  assert.ok(!u.some((n) => /^(catastro|gis|expediente)_/.test(n)), 'el catastro no se presta a AU-RA');
  assert.ok(u.includes('entidad_buscar') && u.includes('metales_spot'));
  assert.equal(new Set(e).size, e.length, 'sin repetidas');
});

test('el cliente oficial de MCP se conecta, lista y llama; la llamada queda en la traza a nombre de quien', () =>
  conEntorno({ ...archivos(), MCP_TOKEN: TOKEN, MCP_QUIEN: 'jose', MCP_ORIGENES: undefined }, async () => {
    resetTopeMcpTest();
    const f = await registrarEntidad({ plataforma: 'ultron', tipo: 'empresa', nombre: 'Kiri Holdings', atributos: { jurisdiccion: 'Panamá' }, quien: 'jose' });
    const s = await levantar('ultron');
    assert.equal(s.montado, true);
    const cliente = new Client({ name: 'prueba', version: '1.0.0' });
    const transporte = new StreamableHTTPClientTransport(new URL(s.url), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } });
    try {
      await cliente.connect(transporte);
      assert.equal(cliente.getServerVersion()?.name, 'au-ra');
      const { tools } = await cliente.listTools();
      const nombres = tools.map((t) => t.name);
      assert.ok(nombres.includes('entidad_ficha'));
      assert.ok(!nombres.includes('entidad_registrar'));
      assert.equal(tools.find((t) => t.name === 'entidad_ficha')?.annotations?.readOnlyHint, true);

      const r: any = await cliente.callTool({ name: 'entidad_ficha', arguments: { id: f.id } });
      assert.equal(r.isError, false);
      assert.match(r.content[0].text, /Kiri Holdings[\s\S]*Panamá/);

      const mal: any = await cliente.callTool({ name: 'entidad_ficha', arguments: {} });
      assert.equal(mal.isError, true, 'los argumentos se validan con el mismo esquema que usa el agente');

      await assert.rejects(cliente.callTool({ name: 'entidad_registrar', arguments: { tipo: 'empresa', nombre: 'X' } }), /No existe la herramienta/);

      await cliente.ping();
      const trazas = (await listarTrazas({ plataforma: 'ultron', limite: 10 } as any)) as any[];
      const t = trazas.find((x) => x.canal === 'mcp' && /entidad_ficha/.test(x.pregunta) && !x.error);
      assert.ok(t, 'la llamada quedó en la traza');
      assert.equal(t.quien, 'jose');
      assert.equal(t.via, 'mcp');
      assert.equal(t.pasos[0].herramienta, 'entidad_ficha');
    } finally {
      await cliente.close();
      await s.cerrar();
    }
  }));

test('la puerta: sin token 401, token ajeno 401, origen extraño 403, GET 405, versión rara 400', () =>
  conEntorno({ ...archivos(), MCP_TOKEN: TOKEN, MCP_QUIEN: 'jose', MCP_ORIGENES: 'https://permitido.example' }, async () => {
    const s = await levantar('electrum');
    const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } });
    const h = (extra: Record<string, string> = {}) => ({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...extra });
    try {
      assert.equal((await fetch(s.url, { method: 'POST', headers: h(), body: init })).status, 401);
      assert.equal((await fetch(s.url, { method: 'POST', headers: h({ Authorization: `Bearer ${TOKEN}x` }), body: init })).status, 401);
      assert.equal((await fetch(s.url, { method: 'POST', headers: h({ Authorization: `Bearer ${TOKEN}`, Origin: 'https://malo.example' }), body: init })).status, 403);
      const ok = await fetch(s.url, { method: 'POST', headers: h({ Authorization: `Bearer ${TOKEN}`, Origin: 'https://permitido.example' }), body: init });
      assert.equal(ok.status, 200);
      assert.equal(((await ok.json()) as any).result.serverInfo.name, 'dr-electrum');
      assert.equal((await fetch(s.url, { headers: h({ Authorization: `Bearer ${TOKEN}` }) })).status, 405);
      assert.equal((await fetch(s.url, { method: 'POST', headers: h({ Authorization: `Bearer ${TOKEN}`, 'MCP-Protocol-Version': '1999-01-01' }), body: init })).status, 400);
      const noti = await fetch(s.url, { method: 'POST', headers: h({ Authorization: `Bearer ${TOKEN}` }), body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
      assert.equal(noti.status, 202);
    } finally {
      await s.cerrar();
    }
  }));

test('sin configurar, /mcp no existe', () =>
  conEntorno({ MCP_TOKEN: undefined }, async () => {
    const s = await levantar('electrum');
    try {
      assert.equal(s.montado, false);
      assert.equal((await fetch(s.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
    } finally {
      await s.cerrar();
    }
  }));

test('un lote malformado no tumba el servidor, y un lote enorme se rechaza', () =>
  conEntorno({ ...archivos(), MCP_TOKEN: TOKEN, MCP_QUIEN: 'jose', MCP_ORIGENES: undefined }, async () => {
    const s = await levantar('electrum');
    const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };
    let rechazo: unknown = null;
    const escucha = (e: unknown) => (rechazo = e);
    process.on('unhandledRejection', escucha);
    try {
      const r = await fetch(s.url, { method: 'POST', headers: h, body: JSON.stringify([1, 'x', null, [], { jsonrpc: '2.0', id: 7, method: 'ping' }]) });
      assert.equal(r.status, 200);
      const j = (await r.json()) as any[];
      assert.equal(j.filter((x) => x.error?.code === -32600).length, 4);
      assert.deepEqual(j.find((x) => x.id === 7)?.result, {});
      const grande = Array.from({ length: 21 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' }));
      assert.equal((await fetch(s.url, { method: 'POST', headers: h, body: JSON.stringify(grande) })).status, 413);
      assert.equal((await fetch(s.url, { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) })).status, 200, 'sigue vivo');
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(rechazo, null, 'ningún rechazo sin atrapar');
    } finally {
      process.off('unhandledRejection', escucha);
      await s.cerrar();
    }
  }));
