/**
 * Los avisos al teléfono con la app cerrada (lib/push.ts + server/push.ts), sin red de verdad:
 *
 *  · el JWT de la cuenta de servicio se firma con RS256 y verifica con la llave pública (una llave
 *    desechable generada aquí);
 *  · el token de acceso se pide una vez y se reutiliza hasta ~5 min antes de vencer;
 *  · el aviso es SOLO DATOS y todos los valores van como texto; la llamada vive 60 s en FCM;
 *  · un token muerto (UNREGISTERED) se borra solo; un INVALID_ARGUMENT que no señala al token, no;
 *  · si S3 no se pudo leer, no se escribe nada encima;
 *  · las rutas: todo por la sesión, nadie ve ni toca los teléfonos de otro, la prueba es de la junta;
 *  · el seudónimo `para` es el mismo que calcula el teléfono (mobile/src/lib/cuenta.ts).
 */
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-'));
process.env.ULTRON_PUSH_DIR = path.join(dir, 'push');
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(dir, 'cerradas.json');
process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-los-avisos-de-aura';
process.env.ULTRON_MEMORIA_BUCKET = '';
// De quién es cada token (AUR13) va al registro durable (lib/durable.ts sin S3): también en el temporal.
process.env.ULTRON_DURABLE_DIR = path.join(dir, 'durable');
delete process.env.FIREBASE_SERVICE_ACCOUNT;
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const P = await import('../lib/push');
const { montarRutasPush } = await import('../server/push');
const { emitirSesion, sesionDe, exigirMesa } = await import('../server/seguridad');

/* ── una cuenta de servicio desechable ─────────────────────────────────────────────────── */

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const CUENTA = {
  type: 'service_account',
  project_id: 'aura-fp',
  private_key_id: 'abc',
  // Como queda pegada en un panel: con «\n» escritos.
  private_key: privateKey.replace(/\n/g, '\\n'),
  client_email: 'firebase-adminsdk@aura-fp.iam.gserviceaccount.com',
  token_uri: 'https://oauth2.googleapis.com/token',
};
const conCuenta = () => {
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify(CUENTA);
  P._olvidarPush();
};

const b64urlJson = (s: string) => JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
function verificarJwt(jwt: string) {
  const [h, c, f] = jwt.split('.');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(f.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  return { ok, cabecera: b64urlJson(h), cuerpo: b64urlJson(c) };
}

/* ── un Google falso (OAuth + FCM) que deja pasar lo demás (las rutas locales) ─────────── */

type Envio = { token: string; data: Record<string, unknown>; android: any; auth: string };
const original = globalThis.fetch;
let canjes: string[] = [];
let envios: Envio[] = [];
let respuestaFcm: (token: string) => { status: number; json: unknown } = () => ({ status: 200, json: { name: 'projects/aura-fp/messages/1' } });
let s3Caido = false;
let putsS3 = 0;

globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = new URL(String(url));
  if (u.hostname === 'oauth2.googleapis.com') {
    const form = new URLSearchParams(String(init.body));
    canjes.push(String(form.get('assertion')));
    assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    return new Response(JSON.stringify({ access_token: `ya29.prueba-${canjes.length}`, expires_in: 3600, token_type: 'Bearer' }), { status: 200 });
  }
  if (u.hostname === 'fcm.googleapis.com') {
    assert.equal(u.pathname, '/v1/projects/aura-fp/messages:send');
    const m = JSON.parse(String(init.body)).message;
    envios.push({ token: m.token, data: m.data, android: m.android, auth: String(init.headers?.Authorization || '') });
    const r = respuestaFcm(m.token);
    return new Response(JSON.stringify(r.json), { status: r.status });
  }
  if (u.hostname.endsWith('.amazonaws.com')) {
    if (init.method === 'PUT') putsS3++;
    return s3Caido ? new Response('fuera', { status: 503 }) : new Response('', { status: 404 });
  }
  return original(url, init);
}) as typeof fetch;
after(() => {
  globalThis.fetch = original;
});

/* ── el servidor de las rutas (arriba: con `await` de nivel superior en medio, node:test cierra antes) ── */

const app = express();
app.use(express.json());
const pasa = () => ((_q: express.Request, _s: express.Response, n: express.NextFunction) => n()) as express.RequestHandler;
montarRutasPush(app, { exigirMesa, limitar: pasa, sesionDe, nivelDe: (c) => (c.startsWith('jose.push') ? 'junta' : 'miembro') });
const srv = app.listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
after(() => srv.close());

const jose = emitirSesion({ correo: 'Jose.Push@OrdenGlobal.org', nombre: 'José', rol: 'Junta' }, { comunidad: true });
const ana = emitirSesion({ correo: 'ana.push@gmail.com', nombre: 'Ana', rol: 'Miembro · Genesis ID' }, { comunidad: true });
const h = (token?: string, extra: Record<string, string> = {}) => ({ 'content-type': 'application/json', ...(token ? { 'x-ultron-sesion': token } : {}), ...extra });
const post = (ruta: string, token: string | undefined, body: unknown, extra?: Record<string, string>) => fetch(`${base}${ruta}`, { method: 'POST', headers: h(token, extra), body: JSON.stringify(body) });
const estado = async (token: string) => (await (await fetch(`${base}/api/push/estado`, { headers: h(token) })).json()) as any;

beforeEach(() => {
  canjes = [];
  envios = [];
  respuestaFcm = () => ({ status: 200, json: { name: 'projects/aura-fp/messages/1' } });
});

let n = 0;
const correo = () => `push-${Date.now()}-${n++}@ejemplo.com`;
const tok = (s: string) => `tok_${s}_${'x'.repeat(40)}`;

/* ── el JWT y el token de acceso ───────────────────────────────────────────────────────── */

test('JWT RS256: cabecera, reclamos (iss, scope, aud, iat, exp) y firma que verifica con la llave pública', () => {
  conCuenta();
  const c = P.cuentaServicio();
  assert.ok(c, 'la cuenta se entiende aunque la llave venga con «\\n» escritos');
  const t0 = Date.parse('2026-10-02T15:00:00Z');
  const v = verificarJwt(P.construirJwt(c!, t0));
  assert.equal(v.ok, true, 'la firma verifica');
  assert.deepEqual(v.cabecera, { alg: 'RS256', typ: 'JWT' });
  assert.equal(v.cuerpo.iss, CUENTA.client_email);
  assert.equal(v.cuerpo.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  assert.equal(v.cuerpo.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(v.cuerpo.iat, t0 / 1000);
  assert.equal(v.cuerpo.exp, t0 / 1000 + 3600);
  // Otra llave no la verifica.
  const otra = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
  const [h, cu, f] = P.construirJwt(c!, t0).split('.');
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${cu}`), otra, Buffer.from(f.replace(/-/g, '+').replace(/_/g, '/'), 'base64')), false);
});

test('la cuenta: en base64 también vale; un JSON roto o sin llave = sin configurar (y nunca lanza)', () => {
  // El formato de Render: JSON compacto en una línea, con los saltos de la llave escapados (JSON normal).
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ ...CUENTA, private_key: privateKey });
  P._olvidarPush();
  assert.equal(process.env.FIREBASE_SERVICE_ACCOUNT.includes('\n'), false, 'una sola línea');
  assert.equal(verificarJwt(P.construirJwt(P.cuentaServicio()!, Date.now())).ok, true);
  process.env.FIREBASE_SERVICE_ACCOUNT = Buffer.from(JSON.stringify(CUENTA)).toString('base64');
  P._olvidarPush();
  assert.equal(P.pushConfigurado(), true);
  process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"aura-fp"';
  P._olvidarPush();
  assert.equal(P.pushConfigurado(), false);
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ ...CUENTA, private_key: '' });
  P._olvidarPush();
  assert.equal(P.pushConfigurado(), false);
  // Un token_uri ajeno no se usa: la firma solo va a Google.
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ ...CUENTA, token_uri: 'https://malo.example.com/token' });
  P._olvidarPush();
  assert.equal(P.cuentaServicio()?.token_uri, 'https://oauth2.googleapis.com/token');
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  P._olvidarPush();
  assert.equal(P.pushConfigurado(), false);
});

test('sin credencial no se manda nada ni se toca la red', async () => {
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  P._olvidarPush();
  const c = correo();
  await P.registrarToken(c, { token: tok('a'), aparato: 'tel-1' });
  const r = await P.enviarPush(c, { tipo: 'mensaje', texto: 'hola' });
  assert.deepEqual([r.enviados, r.fallidos, r.configurado], [0, 0, false]);
  assert.equal(canjes.length + envios.length, 0);
});

test('token de acceso: se canjea UNA vez, se reutiliza y se renueva a 5 min de vencer', async () => {
  conCuenta();
  let ahora = Date.parse('2026-10-02T15:00:00Z');
  const reloj = () => ahora;
  const c = correo();
  await P.registrarToken(c, { token: tok('b'), aparato: 'tel-1' });
  await P.enviarPush(c, { tipo: 'mensaje', texto: 'uno' }, { ahora: reloj });
  await P.enviarPush(c, { tipo: 'mensaje', texto: 'dos' }, { ahora: reloj });
  assert.equal(canjes.length, 1, 'un solo canje para dos avisos');
  const v = verificarJwt(canjes[0]);
  assert.equal(v.ok, true, 'lo que se canjea es el JWT firmado');
  assert.equal(envios[0].auth, 'Bearer ya29.prueba-1');
  ahora += 54 * 60_000; // le quedan 6 min: sirve
  await P.enviarPush(c, { tipo: 'mensaje', texto: 'tres' }, { ahora: reloj });
  assert.equal(canjes.length, 1);
  ahora += 2 * 60_000; // le quedan 4 min: se renueva
  await P.enviarPush(c, { tipo: 'mensaje', texto: 'cuatro' }, { ahora: reloj });
  assert.equal(canjes.length, 2);
  assert.equal(envios.at(-1)!.auth, 'Bearer ya29.prueba-2');
});

/* ── el aviso ──────────────────────────────────────────────────────────────────────────── */

test('solo datos, todo texto: la llamada con prioridad alta y 60 s de vida; `para` es el seudónimo del teléfono', async () => {
  conCuenta();
  const c = 'Jose@OrdenGlobal.org';
  await P.registrarToken(c, { token: tok('jose'), aparato: 'tel-jose' });
  const r = await P.llamarConAura(c, 'Llegó el correo del banco que esperabas', 'llam-1');
  assert.equal(r.enviados, 1);
  const e = envios.at(-1)!;
  assert.equal(e.token, tok('jose'));
  assert.deepEqual(e.android, { priority: 'HIGH', ttl: '60s' });
  for (const [k, v] of Object.entries(e.data)) assert.equal(typeof v, 'string', `data.${k} es texto`);
  assert.equal(e.data.tipo, 'llamada');
  assert.equal(e.data.de, 'AURA');
  assert.equal(e.data.id, 'llam-1');
  assert.equal(e.data.aura, 'push');
  // El mismo valor que da mobile/src/lib/cuenta.ts seudonimoDe('Jose@OrdenGlobal.org ') (calculado allá).
  assert.equal(e.data.para, 'u590213d687c8aef4');
  assert.equal(P.seudonimoDe('maría@ejemplo.com'), 'u4ac3c79e3ae85c4f');
  // Un mensaje normal vive más.
  await P.avisarConAura(c, 'AURA', 'Hola');
  assert.equal(envios.at(-1)!.android.ttl, `${P.TTL_NORMAL_S}s`);
});

test('datosParaFcm: números, booleanos y objetos pasan a texto; claves reservadas fuera; tipo desconocido se rechaza', () => {
  const d = P.datosParaFcm('a@b.com', { tipo: 'propuesta', id: 'p1', texto: 'x', n: 3, si: true, obj: { a: 1 }, from: 'x', 'google.x': 'y', gcm_algo: 'z', nada: undefined } as any, 1000);
  for (const v of Object.values(d)) assert.equal(typeof v, 'string');
  assert.equal(d.n, '3');
  assert.equal(d.si, 'true');
  assert.equal(d.obj, '{"a":1}');
  assert.equal(d.enviado, '1000');
  assert.ok(!('from' in d) && !('google.x' in d) && !('gcm_algo' in d) && !('nada' in d));
  assert.throws(() => P.datosParaFcm('a@b.com', { tipo: 'otro' } as any));
  // Sin id (o con uno raro), uno nuevo.
  assert.match(P.datosParaFcm('a@b.com', { tipo: 'mensaje', id: '../../x y' }).id, /^p[a-z0-9]+$/);
});

test('UNREGISTERED: el token muerto se borra solo; los demás siguen. INVALID_ARGUMENT del cuerpo NO borra', async () => {
  conCuenta();
  const c = correo();
  await P.registrarToken(c, { token: tok('vivo'), aparato: 'tel-1' });
  await P.registrarToken(c, { token: tok('muerto'), aparato: 'tel-2' });
  respuestaFcm = (t) =>
    t === tok('muerto')
      ? { status: 404, json: { error: { code: 404, status: 'NOT_FOUND', message: 'Requested entity was not found.', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } } }
      : { status: 200, json: { name: 'ok' } };
  const r = await P.enviarPush(c, { tipo: 'recordatorio', texto: 'La pastilla' });
  assert.deepEqual([r.enviados, r.fallidos, r.quitados], [1, 1, 1]);
  let quedan = await P.dispositivosDe(c);
  assert.ok(quedan.ok);
  assert.deepEqual(quedan.ok && quedan.dispositivos.map((d) => d.token), [tok('vivo')]);

  // INVALID_ARGUMENT que señala al token: se borra.
  await P.registrarToken(c, { token: tok('raro'), aparato: 'tel-3' });
  respuestaFcm = (t) =>
    t === tok('raro')
      ? { status: 400, json: { error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token', details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'message.token' }] }] } } }
      : { status: 200, json: {} };
  assert.equal((await P.enviarPush(c, { tipo: 'mensaje', texto: 'x' })).quitados, 1);
  // INVALID_ARGUMENT del cuerpo (no del token): NO se borra, y un 503 tampoco.
  respuestaFcm = () => ({ status: 400, json: { error: { status: 'INVALID_ARGUMENT', message: 'Invalid value at message.android.ttl', details: [{ fieldViolations: [{ field: 'message.android.ttl' }] }] } } });
  assert.equal((await P.enviarPush(c, { tipo: 'mensaje', texto: 'x' })).quitados, 0);
  respuestaFcm = () => ({ status: 503, json: { error: { status: 'UNAVAILABLE' } } });
  const r503 = await P.enviarPush(c, { tipo: 'mensaje', texto: 'x' });
  assert.deepEqual([r503.enviados, r503.fallidos, r503.quitados], [0, 1, 0]);
  quedan = await P.dispositivosDe(c);
  assert.deepEqual(quedan.ok && quedan.dispositivos.map((d) => d.token), [tok('vivo')]);
});

test('un 401 de FCM: token de acceso nuevo y una vez más', async () => {
  conCuenta();
  const c = correo();
  await P.registrarToken(c, { token: tok('r401'), aparato: 'tel-1' });
  let primera = true;
  respuestaFcm = () => {
    if (primera) {
      primera = false;
      return { status: 401, json: { error: { status: 'UNAUTHENTICATED' } } };
    }
    return { status: 200, json: {} };
  };
  const r = await P.enviarPush(c, { tipo: 'mensaje', texto: 'x' });
  assert.equal(r.enviados, 1);
  assert.equal(canjes.length, 2);
});

/* ── los teléfonos guardados ───────────────────────────────────────────────────────────── */

test('hasta 5 teléfonos (se va el más viejo); el mismo aparato con token nuevo reemplaza al suyo', async () => {
  const c = correo();
  for (let i = 1; i <= 6; i++) await P.registrarToken(c, { token: tok(`t${i}`), aparato: `tel-${i}` }, 1000 + i);
  let r = await P.dispositivosDe(c);
  assert.ok(r.ok);
  assert.equal(r.ok && r.dispositivos.length, P.MAX_DISPOSITIVOS);
  assert.ok(r.ok && !r.dispositivos.some((d) => d.token === tok('t1')), 'el más viejo se fue');
  await P.registrarToken(c, { token: tok('t6-nuevo'), aparato: 'tel-6' }, 2000);
  r = await P.dispositivosDe(c);
  assert.ok(r.ok && !r.dispositivos.some((d) => d.token === tok('t6')), 'el token viejo de ese aparato se fue');
  assert.equal(r.ok && r.dispositivos[0].token, tok('t6-nuevo'));
  assert.equal(r.ok && r.dispositivos.length, 5);
  // Sobrevive a olvidar la caché (disco).
  P._olvidarPush();
  r = await P.dispositivosDe(c);
  assert.equal(r.ok && r.dispositivos.length, 5);
  // Quitar por aparato y por token.
  assert.equal((await P.quitarToken(c, { aparato: 'tel-6' })).quitados, 1);
  assert.equal((await P.quitarToken(c, { token: tok('t5') })).quitados, 1);
  await assert.rejects(() => P.registrarToken(c, { token: 'corto' }), /forma de token/);
});

test('S3 caído al leer: no se registra ni se quita nada, y no se sube nada encima', async () => {
  const antes = { b: process.env.ULTRON_MEMORIA_BUCKET, a: process.env.AWS_ACCESS_KEY_ID, s: process.env.AWS_SECRET_ACCESS_KEY };
  Object.assign(process.env, { ULTRON_MEMORIA_BUCKET: 'cubo-prueba', AWS_ACCESS_KEY_ID: 'AKIAPRUEBA', AWS_SECRET_ACCESS_KEY: 'secreto-prueba' });
  s3Caido = true;
  putsS3 = 0;
  try {
    conCuenta();
    const c = correo(); // nuevo: no está en caché ni en disco, hay que preguntarle a S3
    await assert.rejects(() => P.registrarToken(c, { token: tok('s3'), aparato: 'tel-1' }), (e: unknown) => e instanceof P.PushNoDisponible);
    await assert.rejects(() => P.quitarToken(c, { aparato: 'tel-1' }), (e: unknown) => e instanceof P.PushNoDisponible);
    assert.equal((await P.dispositivosDe(c)).ok, false);
    const r = await P.enviarPush(c, { tipo: 'mensaje', texto: 'x' });
    assert.deepEqual([r.enviados, r.fallidos], [0, 0]);
    assert.match(String(r.detalle), /no pude leer/);
    assert.equal(putsS3, 0, 'nada se escribió en S3');
    assert.equal(envios.length, 0);
  } finally {
    s3Caido = false;
    Object.assign(process.env, { ULTRON_MEMORIA_BUCKET: antes.b || '', AWS_ACCESS_KEY_ID: antes.a || '', AWS_SECRET_ACCESS_KEY: antes.s || '' });
  }
});

/* ── las rutas ─────────────────────────────────────────────────────────────────────────── */


test('rutas: sin sesión, 401 en todas', async () => {
  for (const r of ['/api/push/registrar', '/api/push/quitar', '/api/push/probar']) assert.equal((await post(r, undefined, { token: tok('z') })).status, 401, r);
  assert.equal((await fetch(`${base}/api/push/estado`)).status, 401);
  assert.equal((await post('/api/push/registrar', 'u1.basura.firma', { token: tok('z') })).status, 401);
});

test('rutas: cada quien registra, cuenta y quita SOLO sus teléfonos; los tokens no vuelven en ninguna respuesta', async () => {
  conCuenta();
  let r = await post('/api/push/registrar', jose.token, { token: tok('jose-tel'), aparato: 'tel-jose', plataforma: 'android', app: 'aura', correo: 'ana.push@gmail.com' });
  assert.equal(r.status, 200);
  const cuerpo = await r.text();
  assert.ok(!cuerpo.includes(tok('jose-tel')), 'el token no vuelve');
  assert.equal(JSON.parse(cuerpo).dispositivos, 1);
  assert.equal(JSON.parse(cuerpo).configurado, true);
  // El aparato también puede venir en la cabecera.
  r = await post('/api/push/registrar', ana.token, { token: tok('ana-tel'), plataforma: 'android', app: 'aura' }, { 'x-aura-aparato': 'tel-ana' });
  assert.equal(r.status, 200);
  assert.equal((await post('/api/push/registrar', ana.token, { token: 'x' })).status, 400);
  // El correo del cuerpo no cuenta: José registró en SU cuenta, no en la de Ana.
  assert.equal((await estado(jose.token)).dispositivos, 1);
  assert.equal((await estado(ana.token)).dispositivos, 1);
  const dJose = await P.dispositivosDe('jose.push@ordenglobal.org');
  assert.deepEqual(dJose.ok && dJose.dispositivos.map((d) => [d.token, d.aparato, d.plataforma, d.app]), [[tok('jose-tel'), 'tel-jose', 'android', 'aura']]);
  // Ana no puede quitar el teléfono de José (ni por token ni por aparato): en su cuenta no está.
  r = await post('/api/push/quitar', ana.token, { token: tok('jose-tel') });
  assert.equal(((await r.json()) as any).quitados, 0);
  r = await post('/api/push/quitar', ana.token, { aparato: 'tel-jose' });
  assert.equal(((await r.json()) as any).quitados, 0);
  assert.equal((await estado(jose.token)).dispositivos, 1);
  // Ana quita el suyo.
  r = await post('/api/push/quitar', ana.token, { aparato: 'tel-ana' });
  assert.equal(((await r.json()) as any).quitados, 1);
  assert.equal((await estado(ana.token)).dispositivos, 0);
  assert.equal((await post('/api/push/quitar', ana.token, {})).status, 400);
});

test('rutas: «probar» es de la junta y solo llega a los teléfonos de la propia sesión', async () => {
  conCuenta();
  await post('/api/push/registrar', ana.token, { token: tok('ana-2'), aparato: 'tel-ana-2' });
  let r = await post('/api/push/probar', ana.token, {});
  assert.equal(r.status, 403);
  assert.equal(envios.length, 0);
  r = await post('/api/push/probar', jose.token, {});
  assert.equal(r.status, 200);
  const j = (await r.json()) as any;
  assert.deepEqual([j.ok, j.enviados, j.fallidos], [true, 1, 0]);
  assert.deepEqual(envios.map((e) => e.token), [tok('jose-tel')], 'solo el teléfono de José');
  assert.equal(envios[0].data.tipo, 'mensaje');
  for (const v of Object.values(envios[0].data)) assert.equal(typeof v, 'string');
  // Sin credencial: 503 que lo dice, y nada sale.
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  P._olvidarPush();
  r = await post('/api/push/probar', jose.token, {});
  assert.equal(r.status, 503);
  assert.equal((await estado(jose.token)).configurado, false);
});

/* ── AUR13: aceptado no es entregado; la cuenta cambiada no recibe avisos ajenos ──────── */

test('AUR13: un push aceptado por Firebase se cuenta como «aceptado», nunca como «entregado» (resultado y ruta de prueba)', async () => {
  conCuenta();
  const c = correo();
  await P.registrarToken(c, { token: tok('acept'), aparato: 'tel-acept' });
  const r = await P.enviarPush(c, { tipo: 'mensaje', texto: 'hola' });
  assert.equal(r.aceptados, 1);
  assert.equal(r.entrega, 'aceptado');
  assert.doesNotMatch(JSON.stringify(r), /entregad/i);
  respuestaFcm = () => ({ status: 503, json: { error: { status: 'UNAVAILABLE' } } });
  const f = await P.enviarPush(c, { tipo: 'mensaje', texto: 'hola' });
  assert.deepEqual([f.aceptados, f.entrega], [0, 'fallido']);
  respuestaFcm = () => ({ status: 200, json: { name: 'projects/aura-fp/messages/1' } });
  const sin = await P.enviarPush(correo(), { tipo: 'mensaje', texto: 'hola' });
  assert.equal(sin.entrega, 'sin-destino');
  // La ruta de prueba de la junta lo dice igual.
  await P.registrarToken('jose.push@ordenglobal.org', { token: tok('jose-tel'), aparato: 'tel-jose' });
  const pr = await post('/api/push/probar', jose.token, {});
  const j = (await pr.json()) as any;
  assert.equal(j.aceptados, 1);
  assert.equal(j.entrega, 'aceptado');
  assert.match(j.nota, /no confirma que el teléfono lo mostró/);
  assert.doesNotMatch(JSON.stringify(j), /entregad/i);
});

test('AUR13: el teléfono que pasa de una cuenta a otra deja de recibir los avisos de la primera (Firebase)', async () => {
  conCuenta();
  const ana = correo();
  const beto = correo();
  const T = tok('compartido');
  await P.registrarToken(ana, { token: T, aparato: 'tel-compartido' });
  // En el mismo teléfono entra Beto (Ana no alcanzó a quitar su token al salir).
  await P.registrarToken(beto, { token: T, aparato: 'tel-compartido' });
  envios = [];
  const r = await P.enviarPush(ana, { tipo: 'mensaje', texto: 'Lo privado de Ana' });
  assert.equal(envios.filter((e) => e.token === T).length, 0, 'lo de Ana no llega al teléfono que ahora es de Beto');
  assert.equal(r.aceptados, 0);
  // La marca guarda solo hashes (ni token ni correo): la cuenta vieja se poda al primer aviso que intenta.
  const dAna = await P.dispositivosDe(ana);
  assert.ok(dAna.ok && !dAna.dispositivos.some((d) => d.token === T), 'el token ya no está en la cuenta de Ana');
  await P.enviarPush(beto, { tipo: 'mensaje', texto: 'Lo de Beto' });
  assert.deepEqual(envios.map((e) => e.token), [T]);
  // Y aunque la cuenta vieja todavía lo tuviera guardado (no se pudo quitar), al mandar se mira de quién es ahora.
  await P._meterSinDueno(ana, { token: T, aparato: 'tel-compartido' });
  envios = [];
  await P.enviarPush(ana, { tipo: 'mensaje', texto: 'Lo privado de Ana' });
  assert.equal(envios.length, 0, 'el guardado viejo no gana al dueño actual del token');
  const dAna2 = await P.dispositivosDe(ana);
  assert.ok(dAna2.ok && !dAna2.dispositivos.some((d) => d.token === T), 'y se poda de la cuenta vieja');
  // Si Ana vuelve a entrar en ese teléfono, vuelve a ser suyo (y Beto deja de recibir ahí).
  await P.registrarToken(ana, { token: T, aparato: 'tel-compartido' });
  envios = [];
  await P.enviarPush(beto, { tipo: 'mensaje', texto: 'Lo de Beto' });
  assert.equal(envios.length, 0);
});

/* ── el teléfono: qué hace con cada aviso (mobile/src/push/logica.ts, puro) ────────────── */

const L = await import('../mobile/src/push/logica');
const K = {
  TriggerType: { TIMESTAMP: 0 },
  AlarmType: { SET_AND_ALLOW_WHILE_IDLE: 2, SET_EXACT_AND_ALLOW_WHILE_IDLE: 3 },
  AuthorizationStatus: { DENIED: 0, AUTHORIZED: 1 },
  AndroidImportance: { HIGH: 4 },
  AndroidCategory: { CALL: 'call' },
  AndroidVisibility: { PUBLIC: 1, PRIVATE: 0 },
  EventType: { DISMISSED: 0, PRESS: 1, ACTION_PRESS: 2, DELIVERED: 3 },
  AndroidStyle: { BIGTEXT: 1 },
};
const YO = P.seudonimoDe('jose@ordenglobal.org');
const llega = (datos: any, ahora = 1_000_000) => L.leerDatos(P.datosParaFcm('jose@ordenglobal.org', datos, ahora));

test('teléfono: lo que manda el servidor se lee tal cual; lo que no es de AURA o viene roto, no', () => {
  const p = llega({ tipo: 'mensaje', id: 'm1', titulo: 'AURA', texto: 'Hola', abrir: 'computadora' });
  assert.deepEqual([p?.tipo, p?.id, p?.para, p?.texto, p?.abrir], ['mensaje', 'm1', YO, 'Hola', 'computadora']);
  assert.equal(L.leerDatos({ tipo: 'mensaje', id: 'x', para: YO }), null, 'sin aura: push');
  assert.equal(L.leerDatos({ aura: 'push', tipo: 'otro', id: 'x', para: YO }), null);
  assert.equal(L.leerDatos({ aura: 'push', tipo: 'mensaje', id: 'x', para: 'jose@ordenglobal.org' }), null, '`para` es un seudónimo, nunca un correo');
  assert.equal(llega({ tipo: 'mensaje', id: 'm2', texto: 'x', abrir: 'https://malo' })?.abrir, '', 'abrir solo lo conocido');
  // «Terminé de investigar» (server/investigar.ts) abre sus Tareas.
  assert.equal(llega({ tipo: 'mensaje', id: 'inv-tk_1', titulo: 'Terminé de investigar', texto: '«Copán»: listo.', abrir: 'tareas' })?.abrir, 'tareas');
});

test('teléfono: solo se enseña a su dueño, una vez; la llamada es la de un recordatorio con el motivo', () => {
  const ahora = 2_000_000;
  const p = llega({ tipo: 'llamada', de: 'AURA', motivo: 'Llegó el correo del banco', id: 'L1' }, ahora)!;
  assert.deepEqual(L.planear(p, { dueno: '', ahora, k: K }), { que: 'ignorar', porque: 'sin_dueno' });
  assert.deepEqual(L.planear(p, { dueno: P.seudonimoDe('ana@ejemplo.com'), ahora, k: K }), { que: 'ignorar', porque: 'ajeno' });
  assert.deepEqual(L.planear(p, { dueno: YO, ahora, k: K, visto: true }), { que: 'ignorar', porque: 'repetido' });
  const plan = L.planear(p, { dueno: YO, ahora: ahora + 5_000, k: K });
  assert.equal(plan.que, 'mostrar');
  if (plan.que !== 'mostrar') return;
  const a = plan.aviso as any;
  assert.equal(a.body, 'Llegó el correo del banco');
  // Los datos de la llamada de un recordatorio: los atiende compa/recordatoriosNativo.ts (Contestar → llamada con AURA).
  assert.deepEqual([a.data.aura, a.data.paso, a.data.texto, a.data.dueno, a.data.llamada], ['recordatorio', 'l1', 'Llegó el correo del banco', YO, '1']);
  assert.equal(a.android.category, 'call');
  assert.equal(a.android.fullScreenAction.id, 'aura-rec-pantalla');
  assert.equal(a.android.ongoing, true);
  assert.equal(a.android.loopSound, true);
  assert.equal(a.android.channelId, 'aura-recordatorio-llamada');
  assert.deepEqual(a.android.actions.map((x: any) => x.pressAction.id), ['aura-rec-contestar', 'aura-rec-rechazar']);
  // Si no contesta, «AURA te llamó» (lo quita contestar o rechazar: es `<base>-final`).
  assert.equal((plan.despues!.aviso as any).id, `${a.data.base}-final`);
  assert.ok(plan.despues!.cuando > ahora + 60_000);
  // Una llamada que llegó tarde ya no suena.
  const vieja = L.planear(p, { dueno: YO, ahora: ahora + L.LLAMADA_VIEJA_MS + 1, k: K });
  assert.equal(vieja.que === 'mostrar' && (vieja.aviso as any).android.fullScreenAction, undefined);
  assert.equal(vieja.que === 'mostrar' && vieja.despues, undefined);
});

test('teléfono: propuesta con «Sí» (abre la app) y «Luego» (sin abrir); los toques se entienden', () => {
  const p = llega({ tipo: 'propuesta', id: 'prop-1', texto: '¿Te ayudo a publicar el carro?', pedido: 'Ayúdame a publicar el carro' })!;
  const plan = L.planear(p, { dueno: YO, ahora: 1, k: K });
  assert.equal(plan.que, 'mostrar');
  if (plan.que !== 'mostrar') return;
  const a = plan.aviso as any;
  assert.deepEqual(a.android.actions.map((x: any) => [x.pressAction.id, x.pressAction.launchActivity]), [['aura-push-si', 'default'], ['aura-push-luego', undefined]]);
  for (const v of Object.values(a.data)) assert.equal(typeof v, 'string', 'notifee solo acepta texto en data');
  const ev = (type: number, id?: string) => ({ type, detail: { notification: { id: a.id, data: a.data }, pressAction: { id } } });
  assert.equal(L.interpretarToque(ev(2, 'aura-push-si'), K)?.accion, 'si');
  assert.equal(L.interpretarToque(ev(2, 'aura-push-luego'), K)?.accion, 'luego');
  assert.equal(L.interpretarToque(ev(1, 'aura-push-abrir'), K)?.accion, 'abrir');
  assert.equal(L.interpretarToque(ev(2, 'aura-push-si'), K)?.datos.pedido, 'Ayúdame a publicar el carro');
  assert.equal(L.interpretarToque(ev(0), K), null, 'descartar no hace nada');
  assert.equal(L.interpretarAperturaPush({ notification: { id: a.id, data: a.data }, pressAction: { id: 'aura-push-si' } }, K)?.accion, 'si');
  // La computadora: «Terminé en mi computadora» y al tocar se abre su vista.
  const c = L.planear(llega({ tipo: 'computadora', id: 'tarea-9', texto: 'El tipo de cambio es 24.7' })!, { dueno: YO, ahora: 1, k: K });
  assert.match(String(c.que === 'mostrar' && (c.aviso as any).title), /computadora|computer/);
  assert.match(String(L.textoAlAbrir(llega({ tipo: 'recordatorio', id: 'r1', texto: 'La pastilla' })!)), /La pastilla/);
});

test('teléfono: los vistos se recuerdan unas horas y con tope', () => {
  let v: Record<string, number> = {};
  for (let i = 0; i < L.MAX_VISTOS + 10; i++) v = L.anotarVisto(v, `mensaje:${i}`, 1000 + i);
  assert.equal(Object.keys(v).length, L.MAX_VISTOS);
  assert.equal(L.yaVisto(v, `mensaje:${L.MAX_VISTOS + 9}`, 2000), true);
  assert.equal(L.yaVisto(v, 'mensaje:0', 2000), false, 'el más viejo se fue');
  assert.equal(L.yaVisto(v, `mensaje:${L.MAX_VISTOS + 9}`, 1000 + L.VENTANA_VISTOS_MS + 100), false, 'pasada la ventana, no');
});
