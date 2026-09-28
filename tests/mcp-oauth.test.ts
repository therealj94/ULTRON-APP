/**
 * Conectar Claude con la cuenta propia: el cliente OFICIAL de MCP hace todo el baile de OAuth
 * (descubre la puerta, se registra, PKCE, cambia el código, renueva) contra nuestro servidor. Lo
 * único simulado es el navegador de la persona que aprieta «Permitir».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { montarMcp, resetTopeMcpTest } from '../server/mcp';
import { redireccionPermitida } from '../server/mcp-oauth';
import { emitirSesion, emitirTokenMcp, sesionDe } from '../server/seguridad';
import { reiniciarPadron } from '../lib/acceso';
import { listarTrazas } from '../lib/cognitivo/traza';

const JOSE = { correo: 'j.ordonez@ordenglobal.org', nombre: 'José', rol: 'Junta' };

async function conEntorno<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const antes: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    antes[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  reiniciarPadron();
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    reiniciarPadron();
  }
}

const entorno = (extra: Record<string, string | undefined> = {}) => ({
  ELECTRUM_DB_URL: undefined,
  COGNITIVO_DB_URL: undefined,
  COGNITIVO_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-oauth-')),
  ULTRON_SESIONES_CERRADAS_ARCHIVO: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cerradas-')), 'c.json'),
  MCP_TOKEN: undefined,
  MCP_OAUTH: undefined,
  MCP_ORIGENES: undefined,
  ULTRON_PADRON: undefined,
  ...extra,
});

async function levantar(opciones?: { oauth?: boolean }) {
  const app = express();
  app.use(express.json());
  const montado = montarMcp(app, 'electrum', opciones);
  const s = await new Promise<import('node:http').Server>((ok) => {
    const x = app.listen(0, '127.0.0.1', () => ok(x));
  });
  const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  return { base, url: `${base}/mcp`, montado, cerrar: () => new Promise((ok) => s.close(ok)) };
}

/** Un proveedor OAuth en memoria, como el que usa cualquier cliente MCP. */
function proveedor(redirect = 'http://localhost:33418/callback') {
  const estado: { cliente?: any; tokens?: any; verificador?: string; irA?: URL } = {};
  const p: OAuthClientProvider = {
    get redirectUrl() {
      return redirect;
    },
    get clientMetadata() {
      return { client_name: 'Claude (prueba)', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
    },
    clientInformation: () => estado.cliente,
    saveClientInformation: (c) => void (estado.cliente = c),
    tokens: () => estado.tokens,
    saveTokens: (t) => void (estado.tokens = t),
    redirectToAuthorization: (u) => void (estado.irA = u),
    saveCodeVerifier: (v) => void (estado.verificador = v),
    codeVerifier: () => estado.verificador!,
  };
  return { p, estado };
}

/** Lo que hace el navegador: abre la pantalla y, con la sesión de la app, aprieta «Permitir». */
async function navegador(base: string, irA: URL, sesion: string | null, decision = 'permitir') {
  const pantalla = await fetch(irA);
  assert.equal(pantalla.status, 200);
  const html = await pantalla.text();
  assert.match(html, /Solo lectura/);
  assert.equal(pantalla.headers.get('x-frame-options'), 'DENY');
  const r = await fetch(`${base}/oauth/authorize${irA.search}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(sesion ? { 'x-ultron-sesion': sesion } : {}) },
    body: JSON.stringify({ decision }),
  });
  return { status: r.status, cuerpo: (await r.json()) as any };
}

async function conectarConCuenta(s: { base: string; url: string }, sesion: string) {
  const { p, estado } = proveedor();
  const primero = new StreamableHTTPClientTransport(new URL(s.url), { authProvider: p });
  await assert.rejects(new Client({ name: 'prueba', version: '1' }).connect(primero), UnauthorizedError);
  assert.ok(estado.cliente?.client_id, 'se registró solo');
  assert.ok(estado.irA, 'mandó a entrar');
  const b = await navegador(s.base, estado.irA!, sesion);
  assert.equal(b.status, 200, JSON.stringify(b.cuerpo));
  const vuelta = new URL(b.cuerpo.volver);
  assert.equal(vuelta.searchParams.get('state'), estado.irA!.searchParams.get('state'));
  await primero.finishAuth(vuelta.searchParams.get('code')!);
  assert.ok(estado.tokens?.access_token && estado.tokens?.refresh_token);
  const cliente = new Client({ name: 'prueba', version: '1' });
  await cliente.connect(new StreamableHTTPClientTransport(new URL(s.url), { authProvider: p }));
  return { cliente, estado, p };
}

test('solo vuelve a Claude o a un cliente local', () => {
  assert.ok(redireccionPermitida('https://claude.ai/api/mcp/auth_callback'));
  assert.ok(redireccionPermitida('https://claude.com/api/mcp/auth_callback'));
  assert.ok(redireccionPermitida('http://localhost:6274/oauth/callback'));
  assert.ok(redireccionPermitida('http://127.0.0.1:33418/callback'));
  assert.ok(!redireccionPermitida('https://claude.ai.malo.example/api/mcp/auth_callback'));
  assert.ok(!redireccionPermitida('https://malo.example/api/mcp/auth_callback'));
  assert.ok(!redireccionPermitida('https://claude.ai/otra/cosa'));
  assert.ok(!redireccionPermitida('http://claude.ai/api/mcp/auth_callback'), 'sin TLS no');
  assert.ok(!redireccionPermitida('javascript:alert(1)'));
});

test('el cliente oficial entra con la cuenta de José, lista y llama; la traza queda a su nombre', () =>
  conEntorno(entorno(), async () => {
    resetTopeMcpTest();
    const s = await levantar();
    assert.equal(s.montado, true);
    const { cliente } = await conectarConCuenta(s, emitirSesion(JOSE).token);
    try {
      assert.equal(cliente.getServerVersion()?.name, 'dr-electrum');
      const { tools } = await cliente.listTools();
      assert.ok(tools.some((t) => t.name === 'catastro_buscar'));
      assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true), 'todo de lectura');
      // Argumentos incompletos a propósito: no hace falta la base para ver que la llamada pasa y queda anotada.
      const r: any = await cliente.callTool({ name: 'gis_medir', arguments: {} });
      assert.equal(r.isError, true);
      assert.ok(r.content[0].text.length > 0);
      await cliente.ping();
      const trazas = (await listarTrazas({ plataforma: 'electrum', limite: 10 } as any)) as any[];
      assert.ok(trazas.some((t) => t.canal === 'mcp' && t.quien === 'jose'), 'la llamada quedó a nombre de José');
    } finally {
      await cliente.close();
      await s.cerrar();
    }
  }));

test('el token de MCP no abre la app, y una sesión de la app no abre /mcp', () =>
  conEntorno(entorno(), async () => {
    const s = await levantar();
    try {
      const mcp = emitirTokenMcp(JOSE, 'acceso', 'c1.x.y', 60_000).token;
      assert.equal(sesionDe({ headers: { 'x-ultron-sesion': mcp } } as any), null);
      const app = emitirSesion(JOSE).token;
      const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } });
      const r = await fetch(s.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${app}` }, body: init });
      assert.equal(r.status, 401);
      assert.match(String(r.headers.get('www-authenticate')), /resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource\/mcp"/);
      const bien = await fetch(s.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${mcp}` }, body: init });
      assert.equal(bien.status, 200);
    } finally {
      await s.cerrar();
    }
  }));

test('la puerta se defiende: dirección ajena, sin PKCE, código repetido, verificador falso', () =>
  conEntorno(entorno(), async () => {
    const s = await levantar();
    try {
      const reg = (r: string[]) => fetch(`${s.base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: r, client_name: 'X' }) });
      assert.equal((await reg(['https://malo.example/cb'])).status, 400);
      const cliente: any = await (await reg(['http://localhost:9999/cb'])).json();
      const verificador = crypto.randomBytes(32).toString('base64url');
      const reto = crypto.createHash('sha256').update(verificador).digest('base64url');
      const q = (extra: Record<string, string>) =>
        new URLSearchParams({ response_type: 'code', client_id: cliente.client_id, redirect_uri: 'http://localhost:9999/cb', code_challenge: reto, code_challenge_method: 'S256', state: 'e1', ...extra }).toString();

      // Dirección distinta a la registrada: NO se redirige a ella, se avisa en pantalla.
      const otra = await fetch(`${s.base}/oauth/authorize?${q({ redirect_uri: 'http://localhost:9999/otra' })}`, { redirect: 'manual' });
      assert.equal(otra.status, 400);
      // Cliente inventado.
      assert.equal((await fetch(`${s.base}/oauth/authorize?${q({ client_id: 'c1.falso.falso' })}`, { redirect: 'manual' })).status, 400);
      // Sin PKCE: vuelve con el error.
      const sin = await fetch(`${s.base}/oauth/authorize?${q({ code_challenge_method: 'plain' })}`, { redirect: 'manual' });
      assert.equal(sin.status, 302);
      assert.match(String(sin.headers.get('location')), /error=invalid_request.*state=e1/);

      // Sin sesión no hay código; «Cancelar» vuelve con access_denied.
      const sinSesion = await fetch(`${s.base}/oauth/authorize?${q({})}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'permitir' }) });
      assert.equal(sinSesion.status, 401);
      const no: any = await (await fetch(`${s.base}/oauth/authorize?${q({})}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'negar' }) })).json();
      assert.match(no.volver, /error=access_denied/);

      const ok: any = await (
        await fetch(`${s.base}/oauth/authorize?${q({})}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ultron-sesion': emitirSesion(JOSE).token }, body: JSON.stringify({ decision: 'permitir' }) })
      ).json();
      const code = new URL(ok.volver).searchParams.get('code')!;
      const cambiar = (v: string) =>
        fetch(`${s.base}/oauth/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:9999/cb', client_id: cliente.client_id, code_verifier: v }).toString(),
        });
      assert.equal((await cambiar(crypto.randomBytes(32).toString('base64url'))).status, 400, 'verificador falso');
      const t1 = await cambiar(verificador);
      assert.equal(t1.status, 200);
      const tokens: any = await t1.json();
      assert.equal(tokens.token_type, 'Bearer');
      assert.equal((await cambiar(verificador)).status, 400, 'el código se usa una sola vez');
      const conRelleno = (c: string) =>
        fetch(`${s.base}/oauth/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code: c, redirect_uri: 'http://localhost:9999/cb', client_id: cliente.client_id, code_verifier: verificador }).toString(),
        });
      assert.equal((await conRelleno(code + '=')).status, 400, 'ni con la firma rellenada');

      // Renovar rota el refresco: el viejo deja de valer.
      const renovar = (rt: string) =>
        fetch(`${s.base}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: cliente.client_id }).toString() });
      const r2 = await renovar(tokens.refresh_token);
      assert.equal(r2.status, 200);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal((await renovar(tokens.refresh_token)).status, 400, 'refresco viejo cerrado');
      assert.equal((await renovar(tokens.refresh_token + '=')).status, 400, 'ni con la firma rellenada');
      // Revocar el acceso lo corta en /mcp, también disfrazado.
      await fetch(`${s.base}/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tokens.access_token }).toString() });
      const ping = (t: string) => fetch(s.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
      assert.equal((await ping(tokens.access_token)).status, 401, 'revocado');
      assert.equal((await ping(tokens.access_token + '=')).status, 401, 'revocado, con relleno');
    } finally {
      await s.cerrar();
    }
  }));

test('quien no tiene Electrum no saca código, y a quien sacan del padrón se le corta al instante', () =>
  conEntorno(entorno({ ULTRON_PADRON: 'ana | Ana | ana@mina.example | | electrum=lee\nbeto | Beto | beto@mina.example | | ultron=lee' }), async () => {
    const s = await levantar();
    try {
      const { p, estado } = proveedor();
      await assert.rejects(new Client({ name: 'x', version: '1' }).connect(new StreamableHTTPClientTransport(new URL(s.url), { authProvider: p })), UnauthorizedError);
      const beto = await navegador(s.base, estado.irA!, emitirSesion({ correo: 'beto@mina.example', nombre: 'Beto', rol: 'x' }).token);
      assert.equal(beto.status, 403);

      const { cliente } = await conectarConCuenta(s, emitirSesion({ correo: 'ana@mina.example', nombre: 'Ana', rol: 'x' }).token);
      await cliente.ping();
      process.env.ULTRON_PADRON = 'beto | Beto | beto@mina.example | | ultron=lee';
      reiniciarPadron();
      await assert.rejects(cliente.listTools(), /401|Unauthorized|invalid/i);
      await cliente.close().catch(() => undefined);
    } finally {
      await s.cerrar();
    }
  }));

test('los metadatos que lee Claude', () =>
  conEntorno(entorno(), async () => {
    const s = await levantar();
    try {
      const pr: any = await (await fetch(`${s.base}/.well-known/oauth-protected-resource/mcp`)).json();
      assert.equal(pr.resource, s.url);
      assert.deepEqual(pr.authorization_servers, [s.base]);
      const as: any = await (await fetch(`${s.base}/.well-known/oauth-authorization-server`)).json();
      assert.equal(as.issuer, s.base);
      assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
      assert.ok(as.registration_endpoint.endsWith('/oauth/register'));
    } finally {
      await s.cerrar();
    }
  }));

test('con MCP_OAUTH=0 y sin token fijo, /mcp no existe', () =>
  conEntorno(entorno({ MCP_OAUTH: '0' }), async () => {
    const s = await levantar();
    try {
      assert.equal(s.montado, false);
      assert.equal((await fetch(s.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
      assert.equal((await fetch(`${s.base}/.well-known/oauth-authorization-server`)).status, 404);
    } finally {
      await s.cerrar();
    }
  }));
