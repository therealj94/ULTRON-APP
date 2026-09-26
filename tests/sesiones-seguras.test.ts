/**
 * Las cuatro cerraduras del servidor que faltaban (server/seguridad.ts, server.ts, lib/vision.ts):
 *
 *  1. La sesión se firma SOLO con `ULTRON_SESION_SECRETO`. Antes caía en la clave de mesa o en el
 *     secreto del nodo, y con cualquiera de las dos se fabricaba una sesión de José.
 *  2. «Cerrar sesión» mata el token en el servidor, y sigue muerto tras reiniciarlo.
 *  3. Probar claves de una cuenta se frena por cuenta, no solo por IP.
 *  4. Sin identidad verificada, una URL en el turno no llega al ojo (el navegador del nodo de AWS).
 *
 * Lo de 2, 3 y 4 se comprueba contra el servidor compilado, levantado como en producción, con un
 * cerebro remoto y un ojo de mentira en el mismo proceso de la prueba.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { emitirSesion, sesionDe, borrarSesion, esperaEntrada, anotarFalloEntrada, anotarExitoEntrada, FRENO_ENTRADA, _olvidarCacheSesiones } from '../server/seguridad';
import { destinoPublico } from '../lib/red-publica';

const JOSE = 'j.ordonez@ordenglobal.org';
const req = (token: string) => ({ headers: { 'x-ultron-sesion': token } }) as any;

/** Un token como los de este servidor, firmado con la llave que uno quiera. */
function forjar(llave: string, correo = JOSE) {
  const at = Date.now();
  const body = Buffer.from(JSON.stringify({ correo, nombre: 'José', rol: 'Junta', at, exp: at + 3600_000 })).toString('base64url');
  return `u1.${body}.${crypto.createHmac('sha256', llave).update(body).digest('base64url')}`;
}

function conEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const antes: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    antes[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  const volver = () => {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  const r = fn();
  if (r instanceof Promise) return r.finally(volver);
  volver();
}

test('sin ULTRON_SESION_SECRETO, ni la clave de mesa ni el secreto del nodo firman sesiones', () =>
  conEnv({ ULTRON_SESION_SECRETO: undefined, ULTRON_MESA_CLAVE: 'clave-de-mesa-xxxxxxxxxxxx', ULTRON_NODO_SECRETO: 'secreto-del-nodo-xxxxxxxx' }, () => {
    _olvidarCacheSesiones();
    assert.equal(sesionDe(req(forjar('clave-de-mesa-xxxxxxxxxxxx'))), null, 'con la clave de mesa ya no se fabrica a José');
    assert.equal(sesionDe(req(forjar('secreto-del-nodo-xxxxxxxx'))), null, 'con el secreto del nodo tampoco');
    // Las que emite el propio servidor siguen valiendo (llave de este arranque).
    const s = emitirSesion({ correo: JOSE, nombre: 'José', rol: 'Junta' });
    _olvidarCacheSesiones();
    assert.equal(sesionDe(req(s.token))?.correo, JOSE);
  }));

test('con ULTRON_SESION_SECRETO, vale lo firmado con él y nada más', () =>
  conEnv({ ULTRON_SESION_SECRETO: 'llave-de-sesion-larga-y-al-azar-123456', ULTRON_NODO_SECRETO: 'secreto-del-nodo-xxxxxxxx' }, () => {
    _olvidarCacheSesiones();
    assert.equal(sesionDe(req(forjar('llave-de-sesion-larga-y-al-azar-123456')))?.correo, JOSE);
    assert.equal(sesionDe(req(forjar('secreto-del-nodo-xxxxxxxx'))), null);
  }));

test('cerrar sesión mata el token aunque se borre el caché; la basura no se anota', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cerradas-'));
  const archivo = path.join(dir, 'cerradas.json');
  await conEnv({ ULTRON_SESION_SECRETO: 'llave-de-sesion-larga-y-al-azar-123456', ULTRON_SESIONES_CERRADAS_ARCHIVO: archivo }, async () => {
    const s = emitirSesion({ correo: JOSE, nombre: 'José', rol: 'Junta' });
    assert.ok(sesionDe(req(s.token)));
    assert.equal(await borrarSesion(s.token), true);
    _olvidarCacheSesiones();
    assert.equal(sesionDe(req(s.token)), null, 'el mismo token, ya cerrado, no entra');
    const guardado = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    assert.equal(Object.keys(guardado).length, 1, 'quedó anotado en disco');
    assert.ok(!JSON.stringify(guardado).includes(s.token), 'se guarda la huella, no el token');
    // Un token que este servidor no firmó no se anota.
    assert.equal(await borrarSesion('u1.basura.basura'), false);
    assert.equal(await borrarSesion(forjar('otra-llave')), false);
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(archivo, 'utf8'))).length, 1);
    // Otra sesión del mismo miembro sigue viva: se cierra la de este aparato.
    const otra = emitirSesion({ correo: JOSE, nombre: 'José', rol: 'Junta' });
    assert.ok(sesionDe(req(otra.token)));
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('freno por cuenta: 5 fallos desde una IP, 10 desde cualquiera, y se suelta al pasar la ventana', () => {
  const correo = `prueba-${Date.now()}@ejemplo.org`;
  const t0 = 1_000_000;
  for (let i = 0; i < FRENO_ENTRADA.porIp; i++) {
    assert.equal(esperaEntrada(correo, '1.1.1.1', t0 + i), 0, `el intento ${i + 1} pasa`);
    anotarFalloEntrada(correo, '1.1.1.1', t0 + i);
  }
  assert.ok(esperaEntrada(correo, '1.1.1.1', t0 + 10) > 0, 'el sexto desde la misma IP espera');
  assert.equal(esperaEntrada(correo, '2.2.2.2', t0 + 10), 0, 'otra IP todavía puede');
  // Cambiando de IP a cada intento: la cuenta se frena igual al llegar a 10.
  for (let i = 0; i < FRENO_ENTRADA.porCuenta - FRENO_ENTRADA.porIp; i++) anotarFalloEntrada(correo, `3.3.3.${i}`, t0 + 20 + i);
  const espera = esperaEntrada(correo, '9.9.9.9', t0 + 100);
  assert.ok(espera > 0 && espera <= FRENO_ENTRADA.ventanaMs, `una IP nueva también espera (${espera} ms)`);
  // Otra cuenta no se entera.
  assert.equal(esperaEntrada(`otra-${correo}`, '1.1.1.1', t0 + 100), 0);
  // Pasada la ventana, se puede otra vez.
  assert.equal(esperaEntrada(correo, '1.1.1.1', t0 + FRENO_ENTRADA.ventanaMs + 100), 0);
  // Un acierto limpia los fallos de esa IP.
  const c2 = `acierto-${correo}`;
  for (let i = 0; i < FRENO_ENTRADA.porIp - 1; i++) anotarFalloEntrada(c2, '4.4.4.4', t0 + i);
  anotarExitoEntrada(c2, '4.4.4.4');
  anotarFalloEntrada(c2, '4.4.4.4', t0 + 50);
  assert.equal(esperaEntrada(c2, '4.4.4.4', t0 + 60), 0);
});

test('destinoPublico no deja pasar la red interna', async () => {
  for (const u of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://[::ffff:7f00:1]/', 'http://localhost:8080/', 'file:///etc/passwd']) {
    const r = await destinoPublico(u, 2000);
    assert.equal(r.ok, false, u);
  }
});

/* ---------------------------------------------------- contra el servidor compilado */

const SERVIDOR = path.join(process.cwd(), 'dist', 'server.cjs');
const hay = fs.existsSync(SERVIDOR);
const CLAVE_BUENA = 'la-clave-buena';

function escuchar(fn: http.RequestListener): Promise<{ srv: http.Server; url: string }> {
  const srv = http.createServer(fn);
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` })));
}

function leerCuerpo(r: http.IncomingMessage): Promise<any> {
  return new Promise((ok) => {
    let b = '';
    r.on('data', (c) => (b += c));
    r.on('end', () => {
      try {
        ok(JSON.parse(b || '{}'));
      } catch {
        ok({});
      }
    });
  });
}

test('servidor: el freno, la salida que dura tras reiniciar, y el ojo sin sesión', { skip: hay ? false : 'sin dist/server.cjs: correr `npm run build` antes' }, async (t) => {
  // El cerebro remoto de mentira: la clave buena entra, cualquier otra es 401.
  const remoto = await escuchar(async (rq, rs) => {
    const b = await leerCuerpo(rq);
    rs.setHeader('Content-Type', 'application/json');
    if (rq.url === '/entrar' && b.clave === CLAVE_BUENA) return rs.end(JSON.stringify({ ok: true, miembro: { nombre: 'José' } }));
    rs.statusCode = 401;
    rs.end(JSON.stringify({ error: 'clave incorrecta' }));
  });
  // El ojo de mentira: anota cada vez que alguien le pide abrir algo.
  const pedidosOjo: string[] = [];
  const ojo = await escuchar(async (rq, rs) => {
    const b = await leerCuerpo(rq);
    pedidosOjo.push(`${rq.url} ${b.url}`);
    rs.setHeader('Content-Type', 'application/json');
    rs.end(JSON.stringify({ texto: 'contenido del ojo', titulo: 'x', playwright: true }));
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-cerradas-'));
  let puerto = 7811;
  let proc: ChildProcess | null = null;

  const levantar = async () => {
    puerto += 1;
    proc = spawn('node', [SERVIDOR], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(puerto),
        PLATAFORMA: 'ultron',
        ULTRON_FP_URL: remoto.url,
        ULTRON_OJO_URL: ojo.url,
        ULTRON_OJO_CLAVE: 'clave-ojo',
        ULTRON_SESION_SECRETO: 'llave-de-sesion-de-la-prueba-0123456789',
        ULTRON_SESIONES_CERRADAS_ARCHIVO: path.join(dir, 'cerradas.json'),
        ULTRON_MEMORIA_BUCKET: '',
        AWS_ACCESS_KEY_ID: '',
        AWS_SECRET_ACCESS_KEY: '',
        TELEGRAM_BOT_TOKEN: '',
      },
      stdio: 'ignore',
      detached: true,
    });
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${puerto}/api/ultron/sesion`);
        if (r.ok) return;
      } catch {
        /* todavía no */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('el servidor no levantó');
  };
  const bajar = () => {
    const p = proc as ChildProcess | null;
    if (p?.pid) {
      try {
        process.kill(-p.pid);
      } catch {
        /* ya se fue */
      }
    }
    proc = null;
  };
  t.after(() => {
    bajar();
    remoto.srv.close();
    ojo.srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const base = () => `http://127.0.0.1:${puerto}`;
  const entrar = (clave: string) =>
    fetch(`${base()}/api/ultron/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: JOSE, clave }) });
  const sesion = async (token: string) => (await (await fetch(`${base()}/api/ultron/sesion`, { headers: { 'x-ultron-sesion': token } })).json()) as any;

  await levantar();

  await t.test('la clave buena entra; salir mata el token; tras reiniciar sigue muerto', async () => {
    const r = await entrar(CLAVE_BUENA);
    assert.equal(r.status, 200);
    const { token } = (await r.json()) as any;
    assert.equal((await sesion(token)).authenticated, true);
    const s = (await (await fetch(`${base()}/api/ultron/salir`, { method: 'POST', headers: { 'x-ultron-sesion': token } })).json()) as any;
    assert.equal(s.cerrada, true);
    assert.equal((await sesion(token)).authenticated, false, 'cerrada en el mismo arranque');
    bajar();
    await levantar();
    assert.equal((await sesion(token)).authenticated, false, 'y sigue cerrada tras reiniciar');
    // Una sesión nueva, en cambio, entra.
    const otra = (await (await entrar(CLAVE_BUENA)).json()) as any;
    assert.equal((await sesion(otra.token)).authenticated, true);
  });

  await t.test('cinco claves malas frenan la cuenta, también para la buena', async () => {
    for (let i = 0; i < FRENO_ENTRADA.porIp; i++) assert.equal((await entrar(`mala-${i}`)).status, 401);
    const r = await entrar(CLAVE_BUENA);
    assert.equal(r.status, 429);
    const j = (await r.json()) as any;
    assert.equal(j.code, 'demasiados_intentos');
    assert.match(j.error, /Probá de nuevo en \d+ minutos?/);
    assert.ok(Number(r.headers.get('retry-after')) > 0);
  });

  await t.test('sin sesión, una URL en el turno no llega al ojo', async () => {
    pedidosOjo.length = 0;
    await fetch(`${base()}/api/turno`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'abrí la página http://93.184.216.34/x' }),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => undefined);
    assert.deepEqual(pedidosOjo, [], 'el ojo no recibió nada');
  });
});
