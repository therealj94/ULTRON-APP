/**
 * Revisión 7 (G3, «ningún acceso si no puede comprobarse la autorización»): las entradas que abrían la puerta cuando la
 * consulta de la cuenta fallaba.
 *
 *  · Genesis (server/genesis.ts): `d.suspendida(correo).catch(() => false)` dejaba entrar a una cuenta suspendida si la
 *    base fallaba. Ahora, como Veta: falla o tarda → 503 CUENTA_SIN_COMPROBAR y ninguna sesión.
 *  · La clave (server.ts, `/api/ultron/entrar`): si la base de cuentas lanzaba, se seguía por el cerebro remoto, que no
 *    mira la suspensión. Ahora server/entrar-clave.ts devuelve 'sin_comprobar' y la puerta contesta 503 sin sesión.
 *  · Restablecer la clave (server/cuentas-rutas.ts): una cuenta suspendida del padrón recuperaba la clave y recibía
 *    sesión; ahora la sesión no se emite si la cuenta está suspendida.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { montarRutasGenesis } from '../server/genesis';

const VERIF = 'v'.repeat(43);
const genesisValido: typeof fetch = (async () =>
  new Response(JSON.stringify({ valido: true, gid: 'GEN-ANA1-ANA2-A', correo: 'ana@prueba.local', aud: ['aura'], perfil: { verificada: true, nombre: 'ANA' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })) as any;

async function montarGenesis(suspendida: (c: string) => Promise<boolean>, topeSuspensionMs?: number) {
  process.env.GENESIS_API_KEY_AURA = 'clave-aura';
  delete process.env.AURA_GENESIS_ABIERTO;
  const app = express();
  app.use(express.json());
  const sesiones: unknown[] = [];
  const pasa: express.RequestHandler = (_q, _s, n) => n();
  montarRutasGenesis(app, {
    limitar: () => pasa,
    normalizarCorreo: (c) => String(c || '').trim().toLowerCase(),
    tieneAcceso: () => true,
    deComunidad: () => false,
    suspendida,
    nombreYRol: (c) => ({ nombre: c, rol: 'AU-RA FP' }),
    emitirSesion: (u) => (sesiones.push(u), { token: 't-' + u.correo }),
    pedirAcceso: async () => true,
    fetch: genesisValido,
    esperaSembrarMs: 10,
    ...(topeSuspensionMs ? { topeSuspensionMs } : {}),
  } as any);
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const entrar = async () => {
    const r = await fetch(`${base}/api/genesis/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pase: 'PASE', verificador: VERIF }) });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { entrar, sesiones, cerrar: () => new Promise((r) => srv.close(r)) };
}

const callado = async <T>(f: () => Promise<T>): Promise<T> => {
  const e = console.error;
  const w = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    return await f();
  } finally {
    console.error = e;
    console.warn = w;
  }
};

test('Genesis: la consulta de suspensión FALLA → 503 CUENTA_SIN_COMPROBAR y ninguna sesión', async () => {
  const m = await montarGenesis(async () => {
    throw new Error('ECONNREFUSED postgres');
  });
  try {
    const r = await callado(m.entrar);
    assert.equal(r.status, 503, JSON.stringify(r.body));
    assert.equal(r.body.codigo, 'CUENTA_SIN_COMPROBAR');
    assert.equal(r.body.token, undefined);
    assert.equal(m.sesiones.length, 0);
  } finally {
    await m.cerrar();
  }
});

test('Genesis: la consulta de suspensión TARDA más del tope → 503 y ninguna sesión', async () => {
  const m = await montarGenesis(() => new Promise((r) => setTimeout(() => r(false), 400)), 60);
  try {
    const r = await callado(m.entrar);
    assert.equal(r.status, 503, JSON.stringify(r.body));
    assert.equal(r.body.codigo, 'CUENTA_SIN_COMPROBAR');
    assert.equal(m.sesiones.length, 0);
  } finally {
    await m.cerrar();
  }
});

test('Genesis: suspendida → 403; libre → entra (el camino normal no cambia)', async () => {
  const s = await montarGenesis(async () => true);
  try {
    const r = await s.entrar();
    assert.equal(r.status, 403);
    assert.equal(r.body.codigo, 'SUSPENDIDA');
    assert.equal(s.sesiones.length, 0);
  } finally {
    await s.cerrar();
  }
  const l = await montarGenesis(async () => false);
  try {
    const r = await l.entrar();
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(l.sesiones.length, 1);
  } finally {
    await l.cerrar();
  }
});

test('Clave propia: la base de cuentas LANZA o TARDA → sin_comprobar (nunca «sin_clave», que seguía al remoto)', async () => {
  const E = await import('../server/entrar-clave');
  const lanza = await callado(() =>
    E.comprobarClavePropia(async () => {
      throw new Error('ECONNREFUSED postgres');
    }, 'ana@prueba.local', 'x')
  );
  assert.equal(lanza, 'sin_comprobar');
  const tarda = await E.comprobarClavePropia(() => new Promise((r) => setTimeout(() => r('sin_clave'), 400)), 'ana@prueba.local', 'x', 50);
  assert.equal(tarda, 'sin_comprobar');
  for (const v of ['ok', 'mal', 'suspendida', 'sin_clave'] as const) assert.equal(await E.comprobarClavePropia(async () => v, 'a@b.c', 'x'), v);
  assert.equal(E.SIN_COMPROBAR.codigo, 'CUENTA_SIN_COMPROBAR');
});

test('Clave propia en server.ts: un fallo de la base contesta 503 y NO cae al cerebro remoto', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
  const i = src.indexOf("app.post(['/api/electrum/entrar', '/api/ultron/entrar']");
  assert.ok(i > 0);
  const ruta = src.slice(i, src.indexOf('ULTRON_REMOTE_URL}/entrar', i));
  assert.doesNotMatch(ruta, /entrarConCuenta\([^)]*\)\.catch/, 'la entrada propia no puede tragarse el error de la base');
  assert.doesNotMatch(ruta, /return 'sin_clave' as const/, 'un fallo de la base no es «sin clave»');
  assert.match(ruta, /comprobarClavePropia\(/);
  assert.match(ruta, /=== 'sin_comprobar'\) return res\.status\(503\)/);
});

test('Restablecer la clave: una cuenta suspendida no recibe sesión', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'server/cuentas-rutas.ts'), 'utf8');
  const i = src.indexOf("'/api/ultron/clave/restablecer'");
  const ruta = src.slice(i, src.indexOf("'/api/ultron/clave/cambiar'", i));
  assert.match(ruta, /estado !== 'suspendida' && puedeEntrar\(/);
});
