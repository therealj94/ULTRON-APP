/**
 * SEC-04 en las tres puertas: una cuenta suspendida no entra por /api, ni por /mcp (OAuth o el token fijo de
 * MCP_QUIEN), ni renueva su conector por /oauth/token.
 *
 * Reproducción sobre 01a1359: exigirAutoridadVigente solo corría en /api. leerTokenMcp (server/seguridad.ts) nunca
 * miraba la suspensión y personaConAcceso (server/mcp-oauth.ts) solo el padrón: un Claude conectado seguía leyendo
 * con un token de una hora y renovándolo 30 días; el token fijo se validaba una sola vez, al arrancar.
 */
import './datos-prueba';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-suspension-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
process.env.AURA_DEV = '1';
process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-mcp-suspension';
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(tmp, 'cerradas.json');
process.env.COGNITIVO_DIR = path.join(tmp, 'cognitivo');
process.env.ULTRON_MEMORIA_BUCKET = '';
delete process.env.ELECTRUM_DB_URL;
delete process.env.COGNITIVO_DB_URL;
delete process.env.MCP_OAUTH;
delete process.env.MCP_ORIGENES;
const TOKEN_FIJO = 'token-fijo-de-prueba-mcp-suspension-0123456789';
process.env.MCP_TOKEN = TOKEN_FIJO;
process.env.MCP_QUIEN = 'jose';

const S = await import('../server/seguridad');
const A = await import('../server/autoridad-cuenta');
const { montarMcp, resetTopeMcpTest } = await import('../server/mcp');
const { reiniciarPadron } = await import('../lib/acceso');
reiniciarPadron();

const JOSE = { correo: 'j.herrera@ordenglobal.org', nombre: 'José', rol: 'Junta' };
const suspendidas = new Set<string>();
A._autoridadDePrueba({ consulta: async (c) => suspendidas.has(c), registro: true, topeMs: 200 });
after(() => A._autoridadDePrueba(null));

const app = express();
app.use(express.json());
app.use('/api', (req, res, next) => {
  S.exigirAutoridadVigente(req, res, next).catch(next);
});
app.get('/api/memoria', (req, res) => res.json({ privado: `memoria de ${S.sesionDe(req)?.correo}` }));
montarMcp(app, 'electrum');
const srv = app.listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
after(() => srv.close());
const BASE = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;

const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } });
const mcp = (token: string) => fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: init });

async function clienteRegistrado(): Promise<string> {
  const r = await fetch(`${BASE}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://localhost:9999/cb'], client_name: 'X' }) });
  return ((await r.json()) as any).client_id;
}
const refrescar = (clientId: string, refresh: string) =>
  fetch(`${BASE}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refresh }).toString() });

/** Lo que contesta cada puerta con credenciales vigentes de la misma cuenta. */
async function lasTresPuertas() {
  resetTopeMcpTest();
  const cid = await clienteRegistrado();
  const api = await fetch(`${BASE}/api/memoria`, { headers: { 'x-ultron-sesion': S.emitirSesion(JOSE).token } });
  const oauth = await mcp(S.emitirTokenMcp(JOSE, 'acceso', cid, 60_000).token);
  const fijo = await mcp(TOKEN_FIJO);
  const refresco = await refrescar(cid, S.emitirTokenMcp(JOSE, 'refresco', cid, 60_000).token);
  return { api: api.status, mcpOauth: oauth.status, mcpFijo: fijo.status, oauthRefresco: refresco.status, cuerpoRefresco: (await refresco.json().catch(() => ({}))) as any };
}

test('SEC-04 en las tres puertas: activa → todas abren; suspendida → API, MCP (OAuth y fijo) y el refresco OAuth NIEGAN', async () => {
  suspendidas.clear();
  const activa = await lasTresPuertas();
  assert.deepEqual({ api: activa.api, mcpOauth: activa.mcpOauth, mcpFijo: activa.mcpFijo, oauthRefresco: activa.oauthRefresco }, { api: 200, mcpOauth: 200, mcpFijo: 200, oauthRefresco: 200 });
  assert.ok(activa.cuerpoRefresco.access_token, 'renovó');

  suspendidas.add(JOSE.correo);
  A._envejecerAutoridad(31_000); // pasado el permiso corto en caché
  const suspendida = await lasTresPuertas();
  assert.equal(suspendida.api, 403, 'API');
  assert.equal(suspendida.mcpOauth, 403, 'MCP con token de OAuth');
  assert.equal(suspendida.mcpFijo, 403, 'MCP con el token fijo de MCP_QUIEN: se re-comprueba en cada petición');
  assert.equal(suspendida.oauthRefresco, 400, 'el refresco no emite tokens');
  assert.equal(suspendida.cuerpoRefresco.error, 'invalid_grant');
  assert.equal(suspendida.cuerpoRefresco.access_token, undefined);
});

test('SEC-04: el refresco de una cuenta suspendida queda cerrado (reactivarla no lo resucita)', async () => {
  suspendidas.clear();
  A._autoridadDePrueba({ consulta: async (c) => suspendidas.has(c), registro: true, topeMs: 200 });
  const cid = await clienteRegistrado();
  const r = S.emitirTokenMcp(JOSE, 'refresco', cid, 60_000).token;
  suspendidas.add(JOSE.correo);
  assert.equal((await refrescar(cid, r)).status, 400);
  suspendidas.clear();
  A._envejecerAutoridad(31_000);
  assert.equal((await refrescar(cid, r)).status, 400, 'ese refresco ya no vale');
});
