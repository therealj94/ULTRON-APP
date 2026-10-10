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

/**
 * Revisión de fases: con el registro de cuentas caído (`desconocida`), /oauth/token contesta 503 temporarily_unavailable
 * (no 400 invalid_grant, que hace a Claude tirar el conector) y lo mira ANTES de gastar el código: al volver el registro,
 * el mismo código canjea. Suspendida sigue siendo invalid_grant. Con una cuenta aprobada desde la web (no la identidad
 * del despliegue, que sigue aunque el registro no conteste).
 */
test('registro caído: /oauth/token da 503 temporarily_unavailable y NO gasta el código; suspendida sigue invalid_grant', async () => {
  const crypto = await import('node:crypto');
  const { fijarCuentasAprobadas } = await import('../lib/acceso');
  const LECTOR = { correo: 'lector-oauth@mina.hn', nombre: 'Lector', rol: 'lector' };
  fijarCuentasAprobadas([{ id: 'lector-oauth', nombre: 'Lector', correos: [LECTOR.correo], acceso: { electrum: 'lee' } } as any]);
  const cayo = async () => {
    throw new Error('registro caído');
  };
  try {
    suspendidas.clear();
    A._autoridadDePrueba({ consulta: async (c) => suspendidas.has(c), registro: true, topeMs: 200 });
    const cid = await clienteRegistrado();
    const codigo = async () => {
      const verificador = crypto.randomBytes(32).toString('base64url');
      const reto = crypto.createHash('sha256').update(verificador).digest('base64url');
      const q = new URLSearchParams({ response_type: 'code', client_id: cid, redirect_uri: 'http://localhost:9999/cb', code_challenge: reto, code_challenge_method: 'S256', state: 'e' });
      const r = await fetch(`${BASE}/oauth/authorize?${q}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ultron-sesion': S.emitirSesion(LECTOR).token }, body: JSON.stringify({ decision: 'permitir' }) });
      const volver = ((await r.json()) as any).volver as string;
      const code = new URL(volver).searchParams.get('code');
      assert.ok(code, volver);
      return { code: code!, verificador };
    };
    const canjear = (c: { code: string; verificador: string }) =>
      fetch(`${BASE}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: cid, code: c.code, code_verifier: c.verificador, redirect_uri: 'http://localhost:9999/cb' }).toString() });
    const c1 = await codigo();
    A._autoridadDePrueba({ consulta: cayo, registro: true, topeMs: 200 });
    const caido = await canjear(c1);
    assert.equal(caido.status, 503);
    assert.equal(((await caido.json()) as any).error, 'temporarily_unavailable');
    // Vuelve el registro: el MISMO código canjea (no se gastó), y una sola vez.
    A._autoridadDePrueba({ consulta: async (c) => suspendidas.has(c), registro: true, topeMs: 200 });
    const ok = await canjear(c1);
    assert.equal(ok.status, 200);
    const tokens = (await ok.json()) as any;
    assert.ok(tokens.access_token && tokens.refresh_token);
    const otra = await canjear(c1);
    assert.equal(otra.status, 400);
    assert.equal(((await otra.json()) as any).error, 'invalid_grant');
    // El refresco con el registro caído: 503 y NO se rota (al volver, el mismo refresco sirve).
    A._autoridadDePrueba({ consulta: cayo, registro: true, topeMs: 200 });
    const rc = await refrescar(cid, tokens.refresh_token);
    assert.equal(rc.status, 503);
    assert.equal(((await rc.json()) as any).error, 'temporarily_unavailable');
    A._autoridadDePrueba({ consulta: async (c) => suspendidas.has(c), registro: true, topeMs: 200 });
    assert.equal((await refrescar(cid, tokens.refresh_token)).status, 200);
    // Suspendida: invalid_grant (no 503).
    const c2 = await codigo();
    suspendidas.add(LECTOR.correo);
    A._autoridadDePrueba({ consulta: async (c) => suspendidas.has(c), registro: true, topeMs: 200 });
    const sus = await canjear(c2);
    assert.equal(sus.status, 400);
    assert.equal(((await sus.json()) as any).error, 'invalid_grant');
  } finally {
    suspendidas.clear();
    fijarCuentasAprobadas([]);
    A._autoridadDePrueba({ consulta: async (c) => suspendidas.has(c), registro: true, topeMs: 200 });
  }
});
