/**
 * Entrar a AU-RA solo con Veta Wallet, sin Genesis ID (server/veta-entrar.ts), contra la ruta de verdad y
 * una wallet falsa (un servidor HTTP en un puerto libre, con AURA_WALLET_API apuntando a él).
 *
 * Lo que tiene que ser verdad:
 *   · token auténtico (la wallet contesta 200 con correo en /users/userDate) → sesión de MIEMBRO con
 *     identidad `veta:<dirección>`, comunidad, rol «Miembro · Veta Wallet»;
 *   · la wallet dice 401 → 401 y ninguna sesión;
 *   · un correo del padrón por aquí sigue siendo miembro: la identidad es la dirección, nunca el correo;
 *   · el token no aparece en ningún registro (consola capturada) ni en nada guardado;
 *   · AURA_VETA_ABIERTO=0 → 403; suspendida → 403; topes por conexión y por dirección.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { cargaJwt, esIdVeta, idVeta, montarRutasVeta, ROL_MIEMBRO_VETA, walletApi } from '../server/veta-entrar';
import { nivelDeCorreo, rolVisible } from '../server/nivel';

const DIRECCION = '0xAbCdEf0123456789abcdef0123456789ABCDEF01';
const ID = 'veta:0xabcdef0123456789abcdef0123456789abcdef01';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** Un token con la forma de los de la wallet (la firma da igual: la comprueba la wallet). */
const tokenDe = (carga: Record<string, unknown>) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(carga)}.firma-de-la-wallet-${Math.random().toString(36).slice(2)}`;
const TOKEN = tokenDe({ userId: 'u1', address: DIRECCION, role: 'user', verify: false, tv: 0, exp: Math.floor(Date.now() / 1000) + 2400 });

type RespWallet = { status: number; body: unknown };
let respWallet: RespWallet = { status: 200, body: {} };
const pedidasALaWallet: { url: string; auth: string }[] = [];
let walletSrv: http.Server;

test.before(async () => {
  walletSrv = http.createServer((q, s) => {
    pedidasALaWallet.push({ url: String(q.url), auth: String(q.headers.authorization || '') });
    s.writeHead(respWallet.status, { 'Content-Type': 'application/json' });
    s.end(JSON.stringify(respWallet.body));
  });
  await new Promise<void>((r) => walletSrv.listen(0, '127.0.0.1', () => r()));
  process.env.AURA_WALLET_API = `http://127.0.0.1:${(walletSrv.address() as AddressInfo).port}/`;
});
test.after(() => new Promise<void>((r) => walletSrv.close(() => r())));

test.beforeEach(() => {
  delete process.env.AURA_VETA_ABIERTO;
  pedidasALaWallet.length = 0;
  respWallet = { status: 200, body: { username: 'ana@prueba.local', email: 'ana@prueba.local', phone: '', country: 'HN', name: 'ana maría lópez' } };
});

type Opciones = { suspendidas?: string[]; maxIp?: number };

async function montar(o: Opciones = {}) {
  const app = express();
  app.use(express.json());
  const sesiones: any[] = [];
  const cuentas: any[] = [];
  const perfiles: any[] = [];
  const cupos = new Map<string, number>();
  const porIp = new Map<string, number>();
  montarRutasVeta(app, {
    // Un tope por conexión de verdad, pero chico, para probarlo.
    limitar: (n, _v, grupo) => (req, res, next) => {
      const k = `${req.ip}:${grupo}`;
      const v = (porIp.get(k) || 0) + 1;
      porIp.set(k, v);
      if (v > (o.maxIp ?? n)) return res.status(429).json({ error: 'demasiadas peticiones' });
      next();
    },
    cupo: (clave, max) => {
      const v = (cupos.get(clave) || 0) + 1;
      cupos.set(clave, v);
      return v <= max;
    },
    emitirSesion: (u, op) => {
      sesiones.push({ ...u, comunidad: !!op?.comunidad });
      return { token: 'sesion-aura-' + sesiones.length };
    },
    suspendida: async (id) => (o.suspendidas || []).includes(id),
    registrarMiembro: async (m) => void cuentas.push(m),
    sembrarPerfil: async (id, g) => void perfiles.push({ id, ...g }),
  });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const entrar = async (cuerpo: unknown) => {
    const r = await fetch(`${base}/api/veta/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    return { status: r.status, body: (await r.json()) as any, cache: r.headers.get('cache-control') };
  };
  return { entrar, sesiones, cuentas, perfiles, cerrar: () => new Promise((r) => srv.close(r)) };
}

/** Corre `f` capturando todo lo que sale por consola. */
async function conConsola<T>(f: () => Promise<T>): Promise<{ r: T; salida: string }> {
  const lineas: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  for (const k of Object.keys(orig) as (keyof typeof orig)[]) (console as any)[k] = (...a: unknown[]) => lineas.push(a.map(String).join(' '));
  try {
    const r = await f();
    return { r, salida: lineas.join('\n') };
  } finally {
    Object.assign(console, orig);
  }
}

test('token auténtico: sesión de miembro con identidad veta:<dirección>, rol «Miembro · Veta Wallet»', async () => {
  const m = await montar();
  try {
    const r = await m.entrar({ token: TOKEN });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.cache, 'no-store');
    assert.equal(r.body.token, 'sesion-aura-1');
    assert.deepEqual(r.body.miembro, { nombre: 'Ana', correo: ID, rol: ROL_MIEMBRO_VETA, gid: '' });
    assert.equal(r.body.nivel, 'miembro');
    assert.equal(r.body.por, 'veta');
    assert.deepEqual(m.sesiones, [{ correo: ID, nombre: 'Ana', rol: 'Miembro · Veta Wallet', comunidad: true }]);
    // La wallet recibió el token una vez, en /users/userDate, como Bearer.
    assert.equal(pedidasALaWallet.length, 1);
    assert.equal(pedidasALaWallet[0].url, '/users/userDate');
    assert.equal(pedidasALaWallet[0].auth, `Bearer ${TOKEN}`);
    // La cuenta de miembro y el perfil, por la dirección (nunca el correo), sin nombre «de Genesis».
    assert.deepEqual(m.cuentas, [{ id: ID, nombre: 'ana maría lópez' }]);
    assert.deepEqual(m.perfiles, [{ id: ID, apodo: 'Ana' }]);
    assert.ok(!JSON.stringify(r.body).includes('ana@prueba.local'), 'el correo de la wallet no es la identidad');
  } finally {
    await m.cerrar();
  }
});

test('la wallet dice 401 (token falso, revocado o vencido): 401 y ninguna sesión', async () => {
  const m = await montar();
  try {
    respWallet = { status: 401, body: { message: 'invalid token' } };
    const r = await m.entrar({ token: TOKEN });
    assert.equal(r.status, 401);
    assert.equal(r.body.codigo, 'TOKEN_INVALIDO');
    assert.equal(m.sesiones.length, 0);
    assert.equal(m.cuentas.length, 0);
    // 200 sin correo tampoco vale.
    respWallet = { status: 200, body: { name: 'x' } };
    assert.equal((await m.entrar({ token: TOKEN })).status, 401);
    // 400 (la cuenta no existe) tampoco.
    respWallet = { status: 400, body: { message: 'User does not exist' } };
    assert.equal((await m.entrar({ token: TOKEN })).status, 401);
    assert.equal(m.sesiones.length, 0);
  } finally {
    await m.cerrar();
  }
});

test('un correo del padrón (o de la junta) por este camino sigue siendo miembro, nunca junta', async () => {
  const m = await montar();
  try {
    respWallet = { status: 200, body: { email: 'j.ordonez@ordenglobal.org', name: 'José' } };
    const r = await m.entrar({ token: TOKEN });
    assert.equal(r.status, 200);
    assert.equal(r.body.miembro.correo, ID, 'la sesión es de la dirección, no del correo de la junta');
    assert.equal(r.body.nivel, 'miembro');
    assert.equal(m.sesiones[0].correo, ID);
    assert.equal(m.sesiones[0].comunidad, true);
    // Y el servidor, en cada petición, la sigue viendo como miembro con su rol propio.
    assert.equal(nivelDeCorreo(ID), 'miembro');
    assert.equal(rolVisible(ID), ROL_MIEMBRO_VETA);
    assert.equal(nivelDeCorreo('j.ordonez@ordenglobal.org'), 'junta', 'la junta sigue siendo junta por su propio camino');
  } finally {
    await m.cerrar();
  }
});

test('el token no sale en ningún registro ni en nada guardado', async () => {
  const m = await montar();
  try {
    const { salida } = await conConsola(async () => {
      await m.entrar({ token: TOKEN });
      respWallet = { status: 500, body: { message: 'boom' } };
      await m.entrar({ token: TOKEN });
      respWallet = { status: 401, body: {} };
      await m.entrar({ token: TOKEN });
    });
    const firma = TOKEN.split('.')[2];
    const carga = TOKEN.split('.')[1];
    assert.ok(!salida.includes(firma) && !salida.includes(carga) && !salida.includes(TOKEN.slice(0, 20)), `la consola no tiene el token:\n${salida}`);
    const guardado = JSON.stringify([m.sesiones, m.cuentas, m.perfiles]);
    assert.ok(!guardado.includes(firma) && !guardado.includes(carga), 'ni lo guardado');
    assert.ok(!pedidasALaWallet.some((p) => /logout|cerrar-sesion/.test(p.url)), 'sin /auth/logout');
  } finally {
    await m.cerrar();
  }
});

test('AURA_VETA_ABIERTO=0: 403 y ni se le pregunta a la wallet', async () => {
  process.env.AURA_VETA_ABIERTO = '0';
  const m = await montar();
  try {
    const r = await m.entrar({ token: TOKEN });
    assert.equal(r.status, 403);
    assert.equal(r.body.codigo, 'VETA_CERRADO');
    assert.equal(pedidasALaWallet.length, 0);
    assert.equal(m.sesiones.length, 0);
  } finally {
    await m.cerrar();
  }
});

test('suspendida: 403; bloqueada en la wallet: 403; wallet caída: 503', async () => {
  const m = await montar({ suspendidas: [ID] });
  try {
    assert.equal((await m.entrar({ token: TOKEN })).body.codigo, 'SUSPENDIDA');
    respWallet = { status: 403, body: { codigo: 'BLOQUEADA' } };
    assert.equal((await m.entrar({ token: TOKEN })).body.codigo, 'BLOQUEADA');
    respWallet = { status: 502, body: {} };
    const r = await m.entrar({ token: TOKEN });
    assert.deepEqual([r.status, r.body.codigo], [503, 'WALLET_CAIDA']);
    assert.equal(m.sesiones.length, 0);
  } finally {
    await m.cerrar();
  }
});

test('sin token, token sin forma o sin dirección: no se le pregunta a la wallet', async () => {
  const m = await montar();
  try {
    assert.equal((await m.entrar({})).status, 400);
    assert.equal((await m.entrar({ token: 'no-es-un-jwt' })).status, 400);
    assert.equal((await m.entrar({ token: tokenDe({ userId: 'u1' }) })).status, 401);
    assert.equal((await m.entrar({ token: tokenDe({ address: DIRECCION, exp: 1000 }) })).status, 401, 'vencido');
    assert.equal(pedidasALaWallet.length, 0);
  } finally {
    await m.cerrar();
  }
});

test('topes: por conexión y por dirección (contado solo con el token ya confirmado)', async () => {
  const m = await montar({ maxIp: 100 });
  try {
    for (let i = 0; i < 10; i++) assert.equal((await m.entrar({ token: TOKEN })).status, 200);
    const r = await m.entrar({ token: TOKEN });
    assert.deepEqual([r.status, r.body.codigo], [429, 'LIMITE'], 'la undécima de la misma dirección');
    // Un token que la wallet rechaza no gasta el cupo de nadie.
    respWallet = { status: 401, body: {} };
    const otra = tokenDe({ address: '0x' + '1'.repeat(40) });
    for (let i = 0; i < 12; i++) assert.equal((await m.entrar({ token: otra })).status, 401);
    respWallet = { status: 200, body: { email: 'b@prueba.local', name: 'Beto' } };
    assert.equal((await m.entrar({ token: otra })).status, 200, 'la otra dirección sigue con su cupo entero');
  } finally {
    await m.cerrar();
  }
  const m2 = await montar({ maxIp: 3 });
  try {
    for (let i = 0; i < 3; i++) await m2.entrar({ token: TOKEN });
    assert.equal((await m2.entrar({ token: TOKEN })).status, 429, 'por conexión');
  } finally {
    await m2.cerrar();
  }
});

test('identidades y carga: la dirección EVM en minúsculas; nada más es una identidad', () => {
  assert.equal(idVeta(DIRECCION), ID);
  assert.equal(idVeta('ana@prueba.local'), null);
  assert.equal(idVeta(''), null);
  assert.ok(esIdVeta(ID));
  assert.ok(!esIdVeta('veta:ana@prueba.local'));
  assert.ok(!esIdVeta('veta:0xABCDEF0123456789abcdef0123456789abcdef01'), 'solo la forma normal');
  assert.equal(cargaJwt(TOKEN)?.address, DIRECCION);
  assert.equal(cargaJwt('a.%%%.c'), null);
  assert.match(walletApi(), /^http:\/\/127\.0\.0\.1:\d+$/, 'sin barra final');
});
