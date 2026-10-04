/**
 * Los avisos de PULSE2CHAT (server/push.ts /api/push/relevo/ref y /api/push/relevo):
 * - La referencia que la app apunta en el relevo la firma AU-RA y solo vale tal cual (ni otra persona ni
 *   una firma tocada).
 * - El relevo entra solo con la clave compartida; una referencia mala es 404 y una persona sin teléfonos
 *   registrados es 410 (el relevo poda la suscripción).
 * - Una ráfaga de mensajes no son veinte avisos: uno cada 8 s por persona.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-relevo-'));
process.env.ULTRON_PUSH_DIR = path.join(dir, 'push');
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(dir, 'cerradas.json');
process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-los-avisos-del-chat';
process.env.ULTRON_MEMORIA_BUCKET = '';
process.env.ULTRON_DURABLE_DIR = path.join(dir, 'durable');
process.env.PUSH_RELEVO_CLAVE = 'clave-compartida-de-prueba-con-el-relevo';
delete process.env.FIREBASE_SERVICE_ACCOUNT;

const P = await import('../lib/push');
const { montarRutasPush } = await import('../server/push');
const { emitirSesion, sesionDe, exigirMesa } = await import('../server/seguridad');

const app = express();
app.use(express.json());
montarRutasPush(app, { exigirMesa, sesionDe, limitar: () => (_q, _r, n) => n(), nivelDe: () => 'miembro' });
const srv = app.listen(0);
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
after(() => {
  srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const relevo = (cuerpo: unknown, clave = process.env.PUSH_RELEVO_CLAVE) =>
  fetch(`${base}/api/push/relevo`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(clave ? { Authorization: `Bearer ${clave}` } : {}) }, body: JSON.stringify(cuerpo) });

test('la referencia: firmada por AU-RA, de una sola persona, y no se puede tocar', () => {
  const ref = P.refRelevo('Ana@Ejemplo.com')!;
  assert.ok(ref);
  assert.equal(P.correoDeRef(ref), 'ana@ejemplo.com');
  assert.equal(P.correoDeRef(ref.slice(0, -1) + (ref.endsWith('A') ? 'B' : 'A')), null, 'firma tocada');
  const otra = P.refRelevo('beto@ejemplo.com')!;
  assert.equal(P.correoDeRef(`${otra.split('.')[0]}.${ref.split('.')[1]}`), null, 'la firma de Ana no vale para Beto');
  assert.equal(P.correoDeRef('basura'), null);
});

test('la app pide su referencia con su sesión; sin sesión, 401', async () => {
  const tok = emitirSesion({ correo: 'ana@ejemplo.com', nombre: 'Ana', rol: 'Miembro · Genesis ID' }, { comunidad: true });
  const r = await fetch(`${base}/api/push/relevo/ref`, { headers: { 'x-ultron-sesion': tok.token } });
  assert.equal(r.status, 200);
  assert.equal(P.correoDeRef((await r.json()).ref), 'ana@ejemplo.com');
  assert.equal((await fetch(`${base}/api/push/relevo/ref`)).status, 401);
});

test('el relevo: sin la clave 401, referencia mala 404, persona sin teléfonos 410, con teléfono avisa (agrupado en ráfagas)', async () => {
  const ref = P.refRelevo('ana@ejemplo.com');
  assert.equal((await relevo({ ref }, 'otra-clave')).status, 401);
  assert.equal((await relevo({ ref }, '')).status, 401);
  assert.equal((await relevo({ ref: 'xx.yy' })).status, 404);
  assert.equal((await relevo({ ref })).status, 410, 'sin teléfonos registrados: el relevo poda');
  await P.registrarToken('beto@ejemplo.com', { token: 'token-fcm-de-prueba-0123456789-abcdef', aparato: 'tel-1', plataforma: 'android', app: 'aura' });
  const refB = P.refRelevo('beto@ejemplo.com');
  const r1 = await relevo({ ref: refB, tipo: 'mensaje' });
  assert.equal(r1.status, 200, 'con teléfono: se intenta avisar (sin Firebase configurado no sale, pero no se poda)');
  const r2 = await relevo({ ref: refB, tipo: 'mensaje' });
  assert.equal((await r2.json()).agrupado, true, 'el segundo mensaje en 8 s no es otro aviso');
  const r3 = await relevo({ ref: refB, tipo: 'llamada' });
  assert.notEqual((await r3.json()).agrupado, true, 'una llamada siempre avisa');
});

test('AUR13: el relevo que repite el mismo evento (mismo id) no manda otro aviso; sin id, como siempre', async () => {
  const refC = P.refRelevo('carla@ejemplo.com');
  await P.registrarToken('carla@ejemplo.com', { token: 'token-fcm-de-prueba-carla-0123456789', aparato: 'tel-c', plataforma: 'android', app: 'aura' });
  const r1 = await relevo({ ref: refC, tipo: 'llamada', id: 'evento-77' });
  assert.equal(r1.status, 200);
  assert.notEqual((await r1.json()).repetido, true);
  const r2 = await relevo({ ref: refC, tipo: 'llamada', id: 'evento-77' });
  assert.equal(r2.status, 200);
  assert.equal((await r2.json()).repetido, true, 'el mismo evento entregado dos veces es un solo aviso');
  const r3 = await relevo({ ref: refC, tipo: 'llamada', id: 'evento-78' });
  assert.notEqual((await r3.json()).repetido, true, 'otro evento sí avisa');
});

test('AUR13: primeraVezEvento deduplica por fuente + dueño + id (no entre personas ni por texto)', async () => {
  const { primeraVezEvento } = await import('../lib/envios');
  assert.equal(await primeraVezEvento('telegram', 'bot', '1001'), true);
  assert.equal(await primeraVezEvento('telegram', 'bot', '1001'), false, 'la misma entrega repetida');
  assert.equal(await primeraVezEvento('telegram', 'otro-bot', '1001'), true, 'otro dueño, otro evento');
  assert.equal(await primeraVezEvento('relevo', 'bot', '1001'), true, 'otra fuente, otro evento');
  assert.equal(await primeraVezEvento('telegram', 'bot', ''), true, 'sin id no se deduplica (no se pierde nada)');
});
