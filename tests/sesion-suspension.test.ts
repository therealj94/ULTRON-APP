/**
 * SEC-04 · Una suspensión posterior le quita la autoridad a las sesiones YA emitidas.
 *
 * Reproducción sobre 5754c78: server/seguridad.ts acepta un token de comunidad de hasta 14 días (al día 13 también, tras
 * vaciar el caché) aunque la cuenta se haya suspendido después: solo miraba firma, vencimiento, cierre y cambio de
 * clave. Y sin URL de cuentas, «no configurado» equivalía a «no suspendida» para todos.
 *
 * Contrato (server/autoridad-cuenta.ts, exigirAutoridadVigente):
 *  · permiso `permitida | suspendida | desconocida`, con origen; permiso corto en caché (30 s; AURA_AUTORIDAD_VIVE_MS);
 *  · suspendida → 403 `cuenta_suspendida` en lecturas privadas y efectos, y ESE token queda cerrado de forma durable;
 *  · desconocida (el registro falla o tarda) → 503 `autoridad_desconocida`, salvo la identidad configurada en el
 *    despliegue (ULTRON_PADRON), como los dueños de WhatsApp; un fallo nunca extiende un permiso viejo;
 *  · lo público inocuo (oír, la voz, cerrar sesión) sigue;
 *  · sin registro: AURA_SUSPENSIONES=ninguna lo declara; en producción sin declararlo, falla cerrado (no «nadie
 *    suspendido»); en desarrollo, ninguna, con aviso.
 *
 * Parte A: el middleware real sobre un Express real, con el registro inyectado (sin base). Parte B: el server.ts de
 * verdad, con el registro de verdad (Postgres; `CUENTAS_DB_URL` de pruebas — se salta sin ella) y sin registro.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sesion-suspension-'));
const SECRETO = 'secreto-de-prueba-largo-para-suspensiones-sec04';
process.env.ULTRON_SESION_SECRETO = SECRETO;
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(tmp, 'cerradas.json');
process.env.ULTRON_MEMORIA_BUCKET = '';
process.env.ULTRON_PADRON = 'junta | Junta Prueba | junta.prueba@ordenglobal.org | | ultron=mando';
// La mesa cerrada como en producción: con NODE_ENV=test (el CI) y sin clave, mesaAutorizada abre el hueco de desarrollo
// a quien no trae sesión, y «el token quedó cerrado» se veía como un 200 anónimo (no es lo que se prueba aquí).
process.env.ULTRON_MESA_CLAVE = 'clave-de-mesa-de-prueba-sec04-larga';
const NODE_ENV_ANTES = process.env.NODE_ENV;
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const S = await import('../server/seguridad');
const A: Record<string, any> = await import('../server/autoridad-cuenta');
const { reiniciarPadron } = await import('../lib/acceso');
reiniciarPadron();

const DIA = 24 * 3600_000;
const COMUNIDAD = 'comunidad.prueba@gmail.com';
const JUNTA = 'junta.prueba@ordenglobal.org';

/* ─────────────────────────── Parte A: middleware real, registro inyectado ─────────────────────────── */

let suspendidas = new Set<string>();
let registroFalla = false;
let registroCuelga = false;
let consultas = 0;
const registro = async (c: string) => {
  consultas++;
  if (registroCuelga) return new Promise<boolean>(() => {});
  if (registroFalla) throw new Error('la base no contesta');
  return suspendidas.has(c);
};

const efectos: string[] = [];
const app = express();
app.use(express.json());
// En 5754c78 no existía esta puerta: sin ella, cada ruta solo mira su exigirMesa (y la prueba muestra el hueco).
const puerta = (S as Record<string, any>).exigirAutoridadVigente as undefined | ((q: any, r: any, n: any) => Promise<void>);
app.use('/api', (req, res, next) => {
  if (!puerta) return next();
  puerta(req, res, next).catch(next);
});
app.get('/api/memoria', S.exigirMesa, (req, res) => res.json({ privado: `memoria de ${S.sesionDe(req)?.correo}` }));
app.post('/api/app/contexto', S.exigirMesa, (req, res) => {
  efectos.push(String(S.sesionDe(req)?.correo));
  res.json({ ok: true });
});
app.post('/api/turno', S.exigirMesa, (req, res) => res.json({ reply: 'turno con contexto privado' }));
app.post('/api/tts', (_req, res) => res.json({ ok: true, publico: true }));
app.post('/api/ultron/salir', async (req, res) => res.json(await S.cerrarSesion(S.tokenDe(req))));
const srv = app.listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
after(() => srv.close());
const BASE_A = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;

const pedir = async (ruta: string, token: string, metodo = 'GET') => {
  const r = await fetch(`${BASE_A}${ruta}`, { method: metodo, headers: { 'content-type': 'application/json', 'x-ultron-sesion': token }, ...(metodo === 'POST' ? { body: '{}' } : {}) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};

function preparar(o: { registro?: boolean } = {}) {
  suspendidas = new Set();
  registroFalla = false;
  registroCuelga = false;
  consultas = 0;
  efectos.length = 0;
  A._autoridadDePrueba?.({ consulta: registro, registro: o.registro ?? true, topeMs: 150 });
  process.env.NODE_ENV = NODE_ENV_ANTES ?? '';
  if (NODE_ENV_ANTES === undefined) delete process.env.NODE_ENV;
  delete process.env.AURA_SUSPENSIONES;
  delete process.env.AURA_AUTORIDAD_VIVE_MS;
}

/** Una sesión de comunidad emitida hace `dias` días (el reloj se corre solo al emitirla). */
function sesionDeHace(dias: number, correo = COMUNIDAD, comunidad = true) {
  const real = Date.now;
  Date.now = () => real() - dias * DIA;
  try {
    return S.emitirSesion({ correo, nombre: 'Prueba', rol: comunidad ? 'Miembro · Genesis ID' : 'Junta' }, comunidad ? { comunidad: true } : {});
  } finally {
    Date.now = real;
  }
}

test('SEC-04: sesión emitida → cuenta suspendida → /api/turno, lecturas privadas y efectos DENEGADOS (y el token queda cerrado)', async () => {
  preparar();
  const s = sesionDeHace(0);
  assert.equal((await pedir('/api/memoria', s.token)).status, 200, 'activa: lee lo suyo');
  assert.equal((await pedir('/api/turno', s.token, 'POST')).status, 200);
  // La suspenden. Pasado el permiso corto (30 s), ninguna lectura ni efecto.
  suspendidas.add(COMUNIDAD);
  A._envejecerAutoridad(31_000);
  const turno = await pedir('/api/turno', s.token, 'POST');
  assert.equal(turno.status, 403, JSON.stringify(turno.body));
  assert.equal(turno.body.code, 'cuenta_suspendida');
  assert.equal(turno.body.reply, undefined, 'sin turno ni contexto privado');
  // Ese token ya quedó cerrado: lo que sigue es 401 (sin sesión) o 403; nunca los datos ni el efecto.
  const mem = await pedir('/api/memoria', s.token);
  assert.ok([401, 403].includes(mem.status), String(mem.status));
  assert.equal(mem.body.privado, undefined);
  assert.ok([401, 403].includes((await pedir('/api/app/contexto', s.token, 'POST')).status));
  assert.deepEqual(efectos, [], 'ningún efecto');
  // El token quedó cerrado de forma durable: aunque la reactiven, ESA sesión no vuelve (hay que entrar otra vez).
  assert.equal(S._cerradasParaPruebas().anotada(s.token), true);
  suspendidas.delete(COMUNIDAD);
  A._envejecerAutoridad(31_000);
  assert.notEqual((await pedir('/api/memoria', s.token)).status, 200);
  assert.equal(S.sesionDe({ headers: { 'x-ultron-sesion': s.token } } as any), null);
});

test('SEC-04: el token de comunidad del DÍA 13, tras vaciar el caché, también pierde la autoridad al suspender', async () => {
  preparar();
  const s = sesionDeHace(13);
  S._olvidarCacheSesiones();
  assert.equal(S.sesionDe({ headers: { 'x-ultron-sesion': s.token } } as any)?.correo, COMUNIDAD, 'firmado y vigente (día 13)');
  suspendidas.add(COMUNIDAD);
  const r = await pedir('/api/memoria', s.token);
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.code, 'cuenta_suspendida');
  // Y una vez sabida, los caminos síncronos (sesionDe, el pase de voz) tampoco la aceptan.
  const otra = sesionDeHace(13);
  S._olvidarCacheSesiones();
  assert.equal(S.sesionDe({ headers: { 'x-ultron-sesion': otra.token } } as any), null);
  assert.equal(S.sesionSigueViva({ huella: S.huellaSesion(otra.token), correo: COMUNIDAD, at: otra.at, exp: otra.exp }), false, 'el pase de voz tampoco');
});

test('SEC-04: permiso corto en caché — dentro de 30 s no se pregunta en cada pedido; pasado, sí (presupuesto de revocación)', async () => {
  preparar();
  const s = sesionDeHace(0);
  await pedir('/api/memoria', s.token);
  await pedir('/api/memoria', s.token);
  assert.equal(consultas, 1, 'el segundo pedido usó el permiso en caché');
  suspendidas.add(COMUNIDAD);
  A._envejecerAutoridad(29_000);
  assert.equal((await pedir('/api/memoria', s.token)).status, 200, 'dentro del presupuesto (30 s)');
  A._envejecerAutoridad(2_000);
  assert.equal((await pedir('/api/memoria', s.token)).status, 403, 'pasado el presupuesto, ya no');
});

test('SEC-04: el registro FALLA o TARDA → la comunidad no lee ni actúa (503); la junta del entorno sigue; un fallo no extiende el permiso viejo', async () => {
  preparar();
  const s = sesionDeHace(2);
  const j = sesionDeHace(2, JUNTA, false);
  assert.equal((await pedir('/api/memoria', s.token)).status, 200);
  registroFalla = true;
  A._envejecerAutoridad(31_000);
  const r = await pedir('/api/memoria', s.token);
  assert.equal(r.status, 503, JSON.stringify(r.body));
  assert.equal(r.body.code, 'autoridad_desconocida');
  assert.equal((await pedir('/api/app/contexto', s.token, 'POST')).status, 503);
  assert.deepEqual(efectos, []);
  assert.equal((await pedir('/api/memoria', j.token)).status, 200, 'la identidad configurada en el despliegue sigue');
  // Se recupera la base: vuelve a valer (no quedó cerrada por un fallo).
  registroFalla = false;
  assert.equal((await pedir('/api/memoria', s.token)).status, 200);
  // Base colgada: no se espera más del tope.
  registroCuelga = true;
  A._envejecerAutoridad(31_000);
  const t0 = Date.now();
  assert.equal((await pedir('/api/turno', s.token, 'POST')).status, 503);
  assert.ok(Date.now() - t0 < 2000, 'soltó al tope');
  // Si el registro dice «suspendida», tampoco la junta del entorno.
  registroCuelga = false;
  suspendidas.add(JUNTA);
  A._envejecerAutoridad(31_000);
  assert.equal((await pedir('/api/memoria', j.token)).status, 403);
});

test('SEC-04: lo público inocuo sigue con una sesión suspendida (la voz, cerrar sesión)', async () => {
  preparar();
  const s = sesionDeHace(1);
  suspendidas.add(COMUNIDAD);
  assert.equal((await pedir('/api/tts', s.token, 'POST')).status, 200);
  assert.equal((await pedir('/api/ultron/salir', s.token, 'POST')).status, 200);
});

test('SEC-04: la recarga de cuentas que ve la suspensión corta la sesión al instante, sin esperar al permiso corto', async () => {
  preparar();
  const s = sesionDeHace(0);
  assert.equal((await pedir('/api/memoria', s.token)).status, 200);
  A.anotarEstadosDeCuentas([{ correo: COMUNIDAD, estado: 'suspendida' }]);
  assert.equal((await pedir('/api/memoria', s.token)).status, 403);
});

test('SEC-04: SIN registro de cuentas — «no configurado» no es «no suspendido»: política explícita', async () => {
  // Producción sin AURA_SUSPENSIONES: la comunidad falla cerrado; la junta del entorno sigue.
  preparar({ registro: false });
  process.env.NODE_ENV = 'production';
  assert.equal(A.politicaSinRegistro(), 'cerrada');
  const s = sesionDeHace(1);
  const j = sesionDeHace(1, JUNTA, false);
  const r = await pedir('/api/turno', s.token, 'POST');
  assert.equal(r.status, 503, JSON.stringify(r.body));
  assert.equal(r.body.code, 'autoridad_desconocida');
  assert.equal((await pedir('/api/memoria', j.token)).status, 200);
  assert.match(A.describirPoliticaAutoridad(), /falla cerrado/);
  // Declarado: este despliegue no tiene suspensiones.
  process.env.AURA_SUSPENSIONES = 'ninguna';
  assert.equal(A.politicaSinRegistro(), 'ninguna');
  assert.equal((await pedir('/api/turno', s.token, 'POST')).status, 200);
  // En desarrollo, ninguna; salvo que se exija el registro.
  delete process.env.AURA_SUSPENSIONES;
  process.env.NODE_ENV = 'test';
  assert.equal(A.politicaSinRegistro(), 'ninguna');
  process.env.AURA_SUSPENSIONES = 'registro';
  assert.equal(A.politicaSinRegistro(), 'cerrada');
  assert.equal((await pedir('/api/turno', s.token, 'POST')).status, 503);
  preparar();
});

/* ─────────────────────────── Parte B: el server.ts de verdad ─────────────────────────── */

const RAIZ = process.cwd();
const URL_PRUEBAS = String(process.env.CUENTAS_DB_URL || process.env.ELECTRUM_DB_URL || '').trim();

const alNodo: string[] = [];
const nodo = http.createServer((req, res) => {
  let c = '';
  req.on('data', (d) => (c += d));
  req.on('end', () => {
    const j = JSON.parse(c || '{}');
    if (req.url === '/api/precalentar') return res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    alNodo.push(String(j.messages?.at(-1)?.content || ''));
    if (!j.stream) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ message: { content: '[EMO: neutral] Hola.' } }));
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.write(JSON.stringify({ message: { content: '[EMO: neutral] Hola.' }, done: false }) + '\n');
    res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n');
  });
});
await new Promise<void>((r) => nodo.listen(0, '127.0.0.1', r));
after(() => {
  nodo.closeAllConnections?.();
  nodo.close();
});

async function levantarServidor(env: Record<string, string>) {
  const PORT = 8100 + Math.floor(Math.random() * 400);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sesion-suspension-srv-'));
  const proc: ChildProcess = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), path.join(RAIZ, 'server.ts')], {
    cwd: dir,
    env: {
      PATH: process.env.PATH || '',
      HOME: dir,
      NODE_ENV: 'production',
      PORT: String(PORT),
      PLATAFORMA: 'ultron',
      ULTRON_SESION_SECRETO: SECRETO,
      ULTRON_SESIONES_CERRADAS_ARCHIVO: path.join(dir, 'cerradas.json'),
      ULTRON_PERFILES_DIR: path.join(dir, 'perfiles'),
      ULTRON_NODO_URL: `http://127.0.0.1:${(nodo.address() as AddressInfo).port}`,
      ULTRON_NODO_SECRETO: 'prueba',
      ULTRON_PADRON: process.env.ULTRON_PADRON!,
      TSX_TSCONFIG_PATH: path.join(RAIZ, 'tsconfig.json'),
      ...env,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  });
  let errores = '';
  proc.stderr?.on('data', (d) => (errores = (errores + d).slice(-3000)));
  const base = `http://127.0.0.1:${PORT}`;
  let listo = false;
  for (let i = 0; i < 240 && !listo; i++) {
    try {
      listo = (await fetch(`${base}/api/health`)).ok;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const cerrar = () => {
    try {
      process.kill(-proc.pid!);
    } catch {
      /* ya se fue */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  if (!listo) {
    cerrar();
    throw new Error(`el servidor no arrancó: ${errores}`);
  }
  const pedirB = async (ruta: string, token: string, metodo = 'GET', cuerpo: unknown = {}) => {
    const r = await fetch(`${base}${ruta}`, { method: metodo, headers: { 'content-type': 'application/json', 'x-ultron-sesion': token }, ...(metodo === 'POST' ? { body: JSON.stringify(cuerpo) } : {}) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  return { pedir: pedirB, cerrar };
}

test('SEC-04 (server.ts + Postgres): emitir sesión → suspender en cuentas.cuenta → /api/turno, /api/memoria y /api/app/contexto denegados', { skip: !URL_PRUEBAS && 'sin CUENTAS_DB_URL/ELECTRUM_DB_URL de pruebas' }, async () => {
  process.env.CUENTAS_DB_URL = URL_PRUEBAS;
  const cuentas = await import('../server/cuentas');
  const { exigirBaseDePrueba } = await import('../lib/base-de-pruebas');
  exigirBaseDePrueba(URL_PRUEBAS);
  const pg = new (await import('pg')).Pool({ connectionString: URL_PRUEBAS });
  try {
    await cuentas.asegurarCuentaMiembro(COMUNIDAD, 'Comunidad Prueba', 'gid-prueba');
    await pg.query(`UPDATE cuentas.cuenta SET estado = 'activa' WHERE correo = $1`, [COMUNIDAD]);
    const srv = await levantarServidor({ CUENTAS_DB_URL: URL_PRUEBAS, AURA_AUTORIDAD_VIVE_MS: '200' });
    try {
      const s = S.emitirSesion({ correo: COMUNIDAD, nombre: 'Comunidad Prueba', rol: 'Miembro · Genesis ID' }, { comunidad: true });
      alNodo.length = 0;
      const antes = await srv.pedir('/api/turno', s.token, 'POST', { message: 'hola, ¿qué recuerdas de mí?' });
      assert.equal(antes.status, 200, JSON.stringify(antes.body));
      assert.equal(antes.body.reply, 'Hola.');
      assert.equal((await srv.pedir('/api/memoria', s.token)).status, 200);
      // La suspenden en el registro.
      await pg.query(`UPDATE cuentas.cuenta SET estado = 'suspendida' WHERE correo = $1`, [COMUNIDAD]);
      await new Promise((r) => setTimeout(r, 400));
      alNodo.length = 0;
      const turno = await srv.pedir('/api/turno', s.token, 'POST', { message: 'léeme mi memoria' });
      assert.equal(turno.status, 403, JSON.stringify(turno.body));
      assert.equal(turno.body.code, 'cuenta_suspendida');
      assert.deepEqual(alNodo, [], 'al cerebro no le llegó nada (ni contexto privado)');
      assert.notEqual((await srv.pedir('/api/memoria', s.token)).status, 200, 'lectura privada');
      assert.notEqual((await srv.pedir('/api/app/contexto', s.token, 'POST', { pantalla: 'chats', contactos: [] })).status, 200, 'efecto');
      // Reactivada: ESA sesión ya no vuelve (quedó cerrada); hay que entrar otra vez.
      await pg.query(`UPDATE cuentas.cuenta SET estado = 'activa' WHERE correo = $1`, [COMUNIDAD]);
      await new Promise((r) => setTimeout(r, 400));
      assert.notEqual((await srv.pedir('/api/turno', s.token, 'POST', { message: 'hola' })).status, 200);
      const nueva = S.emitirSesion({ correo: COMUNIDAD, nombre: 'Comunidad Prueba', rol: 'Miembro · Genesis ID' }, { comunidad: true });
      assert.equal((await srv.pedir('/api/memoria', nueva.token)).status, 200, 'una sesión nueva, con la cuenta activa, sí');
    } finally {
      srv.cerrar();
    }
  } finally {
    await pg.query(`DELETE FROM cuentas.cuenta WHERE correo = $1`, [COMUNIDAD]).catch(() => {});
    await pg.end();
  }
});

test('SEC-04 (server.ts sin registro): en producción sin AURA_SUSPENSIONES la comunidad no recibe turno privado; declarado «ninguna», sí', async () => {
  const cerrado = await levantarServidor({});
  try {
    const s = S.emitirSesion({ correo: COMUNIDAD, nombre: 'Comunidad Prueba', rol: 'Miembro · Genesis ID' }, { comunidad: true });
    const j = S.emitirSesion({ correo: JUNTA, nombre: 'Junta Prueba', rol: 'Junta' });
    alNodo.length = 0;
    const r = await cerrado.pedir('/api/turno', s.token, 'POST', { message: 'hola' });
    assert.equal(r.status, 503, JSON.stringify(r.body));
    assert.equal(r.body.code, 'autoridad_desconocida');
    assert.equal((await cerrado.pedir('/api/memoria', s.token)).status, 503);
    assert.deepEqual(alNodo, [], 'al cerebro no le llegó nada');
    const rj = await cerrado.pedir('/api/turno', j.token, 'POST', { message: 'hola' });
    assert.equal(rj.status, 200, `la junta del entorno sigue: ${JSON.stringify(rj.body)}`);
  } finally {
    cerrado.cerrar();
  }
  const declarado = await levantarServidor({ AURA_SUSPENSIONES: 'ninguna' });
  try {
    const s = S.emitirSesion({ correo: COMUNIDAD, nombre: 'Comunidad Prueba', rol: 'Miembro · Genesis ID' }, { comunidad: true });
    const r = await declarado.pedir('/api/turno', s.token, 'POST', { message: 'hola' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  } finally {
    declarado.cerrar();
  }
});
