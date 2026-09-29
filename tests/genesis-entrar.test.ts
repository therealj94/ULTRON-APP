/**
 * Entrar a AU-RA con Genesis ID (server/genesis.ts), contra la ruta de verdad y un Genesis falso.
 *
 * Lo que tiene que ser verdad:
 *   · el pase se le da a Genesis CON el verificador del reto, y con la clave de AU-RA;
 *   · un pase sin destino «aura», o que Genesis rechaza, no abre nada;
 *   · pase válido + persona en el padrón → sesión, sin contraseña;
 *   · pase válido + persona fuera del padrón → NO hay sesión: queda la solicitud para José;
 *   · con AURA_GENESIS_ABIERTO=1, cualquier identidad verificada entra;
 *   · Genesis caído o mal configurado se dice como culpa nuestra (503), no como pase malo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { montarRutasGenesis, verificarPase } from '../server/genesis';

const VERIF = 'v'.repeat(43);
const PERFIL = { verificada: true, nombre: 'ANA MARÍA LÓPEZ' };
type Resp = { status: number; body: any };
let respuesta: Resp = { status: 200, body: {} };
const pedidasAGenesis: any[] = [];

const genesisFalso: typeof fetch = (async (url: any, init: any) => {
  pedidasAGenesis.push({ url: String(url), clave: init?.headers?.['X-API-Key'], cuerpo: JSON.parse(init?.body || '{}') });
  return new Response(JSON.stringify(respuesta.body), { status: respuesta.status, headers: { 'Content-Type': 'application/json' } });
}) as any;

const valido = (extra: Record<string, unknown> = {}) => ({
  status: 200,
  body: { valido: true, gid: 'GEN-ANA1-ANA2-A', correo: 'ana@prueba.local', aud: ['aura', 'pulse2chat'], perfil: PERFIL, ...extra },
});

async function montar(padron: string[]) {
  const app = express();
  app.use(express.json());
  const solicitudes: any[] = [];
  const sesiones: any[] = [];
  const pasa: express.RequestHandler = (_q, _s, n) => n();
  montarRutasGenesis(app, {
    limitar: () => pasa,
    normalizarCorreo: (c) => String(c || '').trim().toLowerCase(),
    tieneAcceso: (c) => padron.includes(c),
    nombreYRol: (correo, nombre) => ({ nombre: nombre || correo, rol: 'AU-RA FP' }),
    emitirSesion: (u) => {
      sesiones.push(u);
      return { token: 'sesion-' + u.correo };
    },
    pedirAcceso: async (s) => {
      solicitudes.push(s);
      return true;
    },
    fetch: genesisFalso,
  });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const entrar = async (cuerpo: unknown) => {
    const r = await fetch(`${base}/api/genesis/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { base, entrar, solicitudes, sesiones, cerrar: () => new Promise((r) => srv.close(r)) };
}

test.beforeEach(() => {
  process.env.GENESIS_API_KEY_AURA = 'clave-aura';
  delete process.env.AURA_GENESIS_ABIERTO;
  pedidasAGenesis.length = 0;
});

test('en el padrón: entra sin contraseña, y Genesis recibió pase, verificador y la clave de AU-RA', async () => {
  const m = await montar(['ana@prueba.local']);
  try {
    respuesta = valido();
    const r = await m.entrar({ pase: 'PASE', verificador: VERIF });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.token, 'sesion-ana@prueba.local');
    assert.equal(r.body.miembro.gid, 'GEN-ANA1-ANA2-A');
    assert.equal(r.body.miembro.nombre, 'Ana', 'saluda por el primer nombre, no por el nombre legal entero');
    assert.deepEqual(pedidasAGenesis[0].cuerpo, { token: 'PASE', verificador: VERIF });
    assert.equal(pedidasAGenesis[0].clave, 'clave-aura');
    assert.match(pedidasAGenesis[0].url, /\/api\/v1\/sso\/verificar$/);
    assert.equal(m.solicitudes.length, 0);
  } finally {
    await m.cerrar();
  }
});

test('fuera del padrón: no hay sesión, queda la solicitud con el GID', async () => {
  const m = await montar([]);
  try {
    respuesta = valido();
    const r = await m.entrar({ pase: 'PASE', verificador: VERIF });
    assert.equal(r.status, 403);
    assert.equal(r.body.codigo, 'PENDIENTE');
    assert.equal(r.body.token, undefined);
    assert.equal(m.sesiones.length, 0);
    assert.equal(m.solicitudes.length, 1);
    assert.equal(m.solicitudes[0].correo, 'ana@prueba.local');
    assert.match(m.solicitudes[0].motivo, /GEN-ANA1-ANA2-A/);
  } finally {
    await m.cerrar();
  }
});

test('AURA_GENESIS_ABIERTO=1: cualquier identidad verificada entra', async () => {
  process.env.AURA_GENESIS_ABIERTO = '1';
  const m = await montar([]);
  try {
    respuesta = valido();
    const r = await m.entrar({ pase: 'PASE', verificador: VERIF });
    assert.equal(r.status, 200);
    assert.equal(m.solicitudes.length, 0);
  } finally {
    await m.cerrar();
  }
});

test('lo que no abre nada', async () => {
  const m = await montar(['ana@prueba.local']);
  try {
    respuesta = valido({ aud: undefined });
    assert.equal((await m.entrar({ pase: 'PASE', verificador: VERIF })).body.codigo, 'PASE_INVALIDO', 'pase sin destino');
    respuesta = valido({ aud: ['ordenex'] });
    assert.equal((await m.entrar({ pase: 'PASE', verificador: VERIF })).body.codigo, 'PASE_INVALIDO', 'pase para otra app');
    respuesta = { status: 401, body: { valido: false, codigo: 'USADO' } };
    const usado = await m.entrar({ pase: 'PASE', verificador: VERIF });
    assert.equal(usado.status, 401);
    assert.equal(usado.body.codigo, 'PASE_INVALIDO');
    respuesta = valido({ perfil: { ...PERFIL, verificada: false } });
    assert.equal((await m.entrar({ pase: 'PASE', verificador: VERIF })).body.codigo, 'SIN_VERIFICAR');
    const sinVerif = await m.entrar({ pase: 'PASE', verificador: 'corto' });
    assert.equal(sinVerif.status, 400, 'sin verificador ni se le pregunta a Genesis');
    assert.equal(m.sesiones.length, 0);
  } finally {
    await m.cerrar();
  }
});

test('Genesis caído o la clave mal configurada: 503, culpa nuestra', async () => {
  respuesta = { status: 502, body: {} };
  assert.deepEqual(await verificarPase('P', VERIF, genesisFalso), { estado: 503, codigo: 'GENESIS_CAIDO', detalle: 'HTTP 502' });
  respuesta = valido({ perfil: undefined });
  assert.equal(((await verificarPase('P', VERIF, genesisFalso)) as any).codigo, 'MAL_CONFIGURADO');
  const roto: typeof fetch = (async () => {
    throw new Error('sin red');
  }) as any;
  assert.equal(((await verificarPase('P', VERIF, roto)) as any).codigo, 'GENESIS_CAIDO');
  delete process.env.GENESIS_API_KEY_AURA;
  delete process.env.GENESIS_API_KEY;
  assert.equal(((await verificarPase('P', VERIF, genesisFalso)) as any).codigo, 'SIN_GENESIS');
});

test('la configuración que ve la app no lleva nada secreto', async () => {
  const m = await montar([]);
  try {
    const r = await fetch(`${m.base}/api/genesis/config`);
    const j: any = await r.json();
    assert.deepEqual(Object.keys(j).sort(), ['abierto', 'disponible', 'walletWeb']);
    assert.equal(j.disponible, true);
    assert.match(j.walletWeb, /#sso-aura$/);
    assert.doesNotMatch(JSON.stringify(j), /clave-aura/);
  } finally {
    await m.cerrar();
  }
});
