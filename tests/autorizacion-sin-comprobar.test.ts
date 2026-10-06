/**
 * Revisión del 6-oct (bloqueante 3, «ningún acceso si no puede comprobarse la autorización»):
 *
 *  · Veta (server/veta-entrar.ts): si la consulta de suspensión (por la identidad `veta:` o por el correo de la wallet)
 *    falla o tarda, la entrada se NIEGA con 503 «No pude comprobar tu cuenta» y no se emite sesión. Antes un error
 *    contaba como «no suspendida» (`.catch(() => false)`).
 *  · WhatsApp (server/whatsapp.ts): si la consulta falla o tarda, los que no son dueños no pasan en ESE pedido, aunque
 *    antes se supiera «no suspendida» (antes se devolvía lo de antes); lo sabido no se usa pasado el TTL ni después de
 *    un fallo, tampoco en la versión sin esperar (`whatsappPermitidoSabido`, la del círculo). Los dueños de
 *    WHATSAPP_DUENOS siguen: eso sale de la configuración y del padrón en memoria, no de la base que falló; si la base
 *    contesta «suspendida», tampoco ellos.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autorizacion-'));
process.env.ULTRON_TAREA_CURSO_DIR = path.join(DIR, 'tarea-en-curso');
process.env.ULTRON_ABIERTOS_DIR = path.join(DIR, 'abiertos');
process.env.ULTRON_DURABLE_DIR = path.join(DIR, 'durable');
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const V = await import('../server/veta-entrar');
const W = await import('../server/whatsapp');

/* ─────────────────────────────── Veta ─────────────────────────────── */

const DIRECCION = '0x1111111111111111111111111111111111111111';
const ID = 'veta:0x1111111111111111111111111111111111111111';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenNuevo = () => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ address: DIRECCION, verify: true, exp: Math.floor(Date.now() / 1000) + 600 })}.firma-${Math.random().toString(36).slice(2, 12)}`;

async function montarVeta(suspendida: (id: string) => Promise<boolean>, topeSuspensionMs?: number) {
  const app = express();
  app.use(express.json());
  const sesiones: unknown[] = [];
  V.montarRutasVeta(app, {
    limitar: () => (_q, _r, n) => n(),
    cupo: () => true,
    emitirSesion: (u) => (sesiones.push(u), { token: 'sesion-' + sesiones.length }),
    suspendida,
    fetch: (async () => new Response(JSON.stringify({ email: 'ana@prueba.test', name: 'Ana' }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch,
    esperaSembrarMs: 10,
    ...(topeSuspensionMs ? { topeSuspensionMs } : {}),
  } as any);
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const entrar = async () => {
    const r = await fetch(`${base}/api/veta/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tokenNuevo() }), signal: AbortSignal.timeout(4000) });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { entrar, sesiones, cerrar: () => new Promise((r) => srv.close(r)) };
}

const silencio = async <T>(f: () => Promise<T>): Promise<T> => {
  const e = console.error;
  console.error = () => {};
  try {
    return await f();
  } finally {
    console.error = e;
  }
};

test('Veta: la consulta de suspensión FALLA → 503 «no pude comprobar tu cuenta» y ninguna sesión', async () => {
  V._reiniciarVeta();
  const m = await montarVeta(async () => {
    throw new Error('la base no contesta');
  });
  try {
    const r = await silencio(m.entrar);
    assert.equal(r.status, 503, JSON.stringify(r.body));
    assert.equal(r.body.codigo, 'CUENTA_SIN_COMPROBAR');
    assert.match(r.body.error, /No pude comprobar tu cuenta/);
    assert.equal(r.body.token, undefined);
    assert.equal(m.sesiones.length, 0, 'sin sesión');
  } finally {
    await m.cerrar();
  }
});

test('Veta: falla SOLO la consulta por el correo de la wallet → tampoco entra', async () => {
  V._reiniciarVeta();
  const m = await montarVeta(async (id) => {
    if (id.includes('@')) throw new Error('timeout');
    return false;
  });
  try {
    const r = await silencio(m.entrar);
    assert.equal(r.status, 503);
    assert.equal(m.sesiones.length, 0);
  } finally {
    await m.cerrar();
  }
});

test('Veta: la consulta de suspensión TARDA más que el tope → 503 y ninguna sesión', async () => {
  V._reiniciarVeta();
  const m = await montarVeta(() => new Promise<boolean>(() => {}), 60);
  try {
    const r = await silencio(m.entrar);
    assert.equal(r.status, 503);
    assert.equal(r.body.codigo, 'CUENTA_SIN_COMPROBAR');
    assert.equal(m.sesiones.length, 0);
  } finally {
    await m.cerrar();
  }
});

test('Veta: con la consulta sana nada cambia (libre entra; suspendida, 403)', async () => {
  V._reiniciarVeta();
  let suspendidas: string[] = [];
  const m = await montarVeta(async (id) => suspendidas.includes(id));
  try {
    assert.equal((await m.entrar()).status, 200);
    suspendidas = [ID];
    const r = await m.entrar();
    assert.equal(r.status, 403);
    assert.equal(r.body.codigo, 'SUSPENDIDA');
    assert.equal(m.sesiones.length, 1);
  } finally {
    await m.cerrar();
  }
});

/* ─────────────────────────────── WhatsApp ─────────────────────────────── */

const DUENO = 'dueno.prueba@ejemplo.test';
const ANA = 'ana.comunidad@ejemplo.test';

async function conWhatsapp(fn: () => Promise<void>) {
  const nombres = ['WHATSAPP_PUENTE_URL', 'WHATSAPP_PUENTE_CLAVE', 'WHATSAPP_DUENOS', 'WHATSAPP_ABIERTO', 'WHATSAPP_CUENTA_SECRETO'] as const;
  const antes = Object.fromEntries(nombres.map((k) => [k, process.env[k]]));
  process.env.WHATSAPP_PUENTE_URL = 'http://127.0.0.1:9';
  process.env.WHATSAPP_PUENTE_CLAVE = 'clave-del-puente-de-prueba';
  process.env.WHATSAPP_DUENOS = DUENO;
  process.env.WHATSAPP_ABIERTO = '1';
  process.env.WHATSAPP_CUENTA_SECRETO = 'secreto-de-cuentas-de-prueba-de-24+';
  W._olvidarWhatsapp();
  try {
    await fn();
  } finally {
    for (const k of nombres) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
    W._suspensionWhatsappDePrueba(null);
    W._olvidarWhatsapp();
  }
}

/** Lo que tarde más de 3 s cuenta como colgado (una consulta sin tope dejaría el pedido esperando para siempre). */
const aTiempo = <T>(p: Promise<T>) => Promise.race([p, new Promise<'colgado'>((r) => setTimeout(() => r('colgado'), 3000))]);
const envejecer =(ms: number) => (W as any)._envejecerSuspensionWhatsapp?.(ms);
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('WhatsApp: se supo «no suspendida», luego la consulta FALLA → la comunidad no pasa (no usa el permiso de antes)', async () => {
  await conWhatsapp(async () => {
    let base: 'sana' | 'cae' = 'sana';
    W._suspensionWhatsappDePrueba(async () => {
      if (base === 'cae') throw new Error('sin base');
      return false;
    });
    assert.equal(await W.whatsappPermitido(ANA, { comunidad: true }), true, 'con la base sana, sí');
    base = 'cae';
    envejecer(31_000); // pasó el TTL: hay que volver a preguntar, y la base no contesta
    assert.equal(await W.whatsappPermitido(ANA, { comunidad: true }), false, 'sin poder comprobar: no (antes devolvía lo de antes)');
    assert.equal(W.whatsappPermitidoSabido(ANA), false, 'ni la versión sin esperar (el círculo) después de un fallo');
    // El dueño (WHATSAPP_DUENOS, configuración) sigue: no depende de la base que falló.
    assert.equal(await W.whatsappPermitido(DUENO), true);
    assert.equal(W.whatsappPermitidoSabido(DUENO), true);
    // La base vuelve: vuelve el permiso.
    base = 'sana';
    assert.equal(await W.whatsappPermitido(ANA, { comunidad: true }), true);
    assert.equal(W.whatsappPermitidoSabido(ANA), true);
  });
});

test('WhatsApp: el permiso sin esperar no se usa pasado el TTL ni si nunca se comprobó', async () => {
  await conWhatsapp(async () => {
    let consultas = 0;
    W._suspensionWhatsappDePrueba(async () => (consultas++, false));
    assert.equal(await W.whatsappPermitido(ANA, { comunidad: true }), true);
    assert.equal(W.whatsappPermitidoSabido(ANA), true, 'recién comprobado: sí');
    envejecer(31_000);
    const antes = consultas;
    assert.equal(W.whatsappPermitidoSabido(ANA), false, 'pasado el TTL: no, hasta volver a comprobar');
    await espera(5);
    assert.ok(consultas > antes, 'y se vuelve a preguntar por detrás');
    assert.equal(W.whatsappPermitidoSabido(ANA), true, 'ya comprobado otra vez: sí');
    // Otro correo de la comunidad que nunca se comprobó: no.
    assert.equal(W.whatsappPermitidoSabido('beto.comunidad@ejemplo.test'), false);
  });
});

test('WhatsApp: la consulta TARDA más que el tope → no para la comunidad; sí para el dueño; «suspendida» niega a todos', async () => {
  await conWhatsapp(async () => {
    W._suspensionWhatsappDePrueba(() => new Promise<boolean>(() => {}), { topeMs: 50 } as any);
    assert.equal(await aTiempo(W.whatsappPermitido(ANA, { comunidad: true })), false, 'no, y sin quedarse colgado');
    assert.equal(await aTiempo(W.whatsappPermitido(DUENO)), true);
    W._suspensionWhatsappDePrueba(async () => true);
    assert.equal(await W.whatsappPermitido(DUENO), false, 'si la base contesta «suspendida», tampoco el dueño');
    assert.equal(W.whatsappPermitidoSabido(DUENO), false);
  });
});
