/**
 * IOS02 (auditoría del 3-oct): avisos a la AU-RA instalada desde la web (lib/push-web.ts), sin red real.
 *
 * Lo que tiene que ser verdad:
 *   · el cuerpo cifrado (RFC 8291, aes128gcm) lo abre el navegador con SU llave privada y su secreto auth;
 *     nadie más (otra llave no lo abre);
 *   · el JWT de VAPID (RFC 8292) es ES256 válido con la llave pública que se anuncia, aud = origen del servicio;
 *   · solo se guardan suscripciones de servicios de avisos conocidos (nunca un POST a una dirección cualquiera);
 *   · enviarPush (lib/push.ts) también le manda a los navegadores suscritos; 404/410 borra la suscripción;
 *   · sin navegadores suscritos (o sin VAPID), el resultado es el de Firebase tal cual (nada cambia).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-web-'));
process.env.ULTRON_PUSH_WEB_DIR = dir;
process.env.ULTRON_PUSH_DIR = path.join(dir, 'fcm');
// De quién es cada suscripción (AUR13) va al registro durable (lib/durable.ts sin S3): también en el temporal.
process.env.ULTRON_DURABLE_DIR = path.join(dir, 'durable');
after(() => fs.rmSync(dir, { recursive: true, force: true }));
for (const k of ['ULTRON_MEMORIA_BUCKET', 'FIREBASE_SERVICE_ACCOUNT']) delete process.env[k];

const W = await import('../lib/push-web');
const P = await import('../lib/push');

const b64url = (b: Buffer) => b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const deB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hmac = (k: Buffer, d: Buffer) => crypto.createHmac('sha256', k).update(d).digest();

/** Un navegador de mentira: su par P-256 y su secreto auth, y su suscripción como la da PushSubscription.toJSON(). */
function navegador(endpoint = 'https://web.push.apple.com/QGuQyavXutnMH9bHkf7') {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ua, auth, sus: { endpoint, keys: { p256dh: b64url(ua.getPublicKey()), auth: b64url(auth) } } };
}

/** Lo que hace el navegador al recibir (RFC 8291 §3.4, del lado del agente de usuario). */
function descifrar(cuerpo: Buffer, ua: crypto.ECDH, auth: Buffer): Buffer {
  const salt = cuerpo.subarray(0, 16);
  const rs = cuerpo.readUInt32BE(16);
  const idlen = cuerpo[20];
  const asPublica = cuerpo.subarray(21, 21 + idlen);
  const registro = cuerpo.subarray(21 + idlen);
  assert.equal(rs, 4096);
  const ecdh = ua.computeSecret(asPublica);
  const ikm = hmac(hmac(auth, ecdh), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublica, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(registro.subarray(registro.length - 16));
  const claro = Buffer.concat([d.update(registro.subarray(0, registro.length - 16)), d.final()]);
  assert.equal(claro[claro.length - 1], 2, 'termina con el delimitador del último registro');
  return claro.subarray(0, claro.length - 1);
}

function conVapid<T>(f: (par: { publica: string; privada: string }) => T): T {
  const par = W.crearParVapid();
  process.env.WEB_PUSH_VAPID_PUBLICA = par.publica;
  process.env.WEB_PUSH_VAPID_PRIVADA = par.privada;
  process.env.WEB_PUSH_CONTACTO = 'mailto:soporte@ordenglobal.org';
  const limpiar = () => {
    delete process.env.WEB_PUSH_VAPID_PUBLICA;
    delete process.env.WEB_PUSH_VAPID_PRIVADA;
    delete process.env.WEB_PUSH_CONTACTO;
  };
  let r: T;
  try {
    r = f(par);
  } catch (e) {
    limpiar();
    throw e;
  }
  if (r instanceof Promise) return r.finally(limpiar) as T;
  limpiar();
  return r;
}

test('cifrar: el navegador lo abre con su llave; otra llave no', () => {
  const n = navegador();
  const msg = Buffer.from(JSON.stringify({ titulo: 'AURA', texto: 'Tu computadora terminó: ñandú ✓' }));
  const cuerpo = W.cifrar(msg, n.sus.keys.p256dh, n.sus.keys.auth);
  assert.deepEqual(descifrar(cuerpo, n.ua, n.auth), msg);
  const otro = navegador();
  assert.throws(() => descifrar(cuerpo, otro.ua, otro.auth), 'otra llave no lo abre');
  assert.throws(() => descifrar(cuerpo, n.ua, crypto.randomBytes(16)), 'sin el secreto auth tampoco');
  assert.throws(() => W.cifrar(Buffer.alloc(W.MAX_CONTENIDO + 1), n.sus.keys.p256dh, n.sus.keys.auth), /largo/);
});

test('VAPID: ES256 que verifica con la llave pública anunciada, aud = origen del servicio', () =>
  conVapid((par) => {
    const v = W.vapid()!;
    assert.ok(v, 'el par se lee');
    const jwt = W.jwtVapid('https://web.push.apple.com/abc/def', v, 1_700_000_000_000);
    const [cab, cuerpo, firma] = jwt.split('.');
    assert.deepEqual(JSON.parse(deB64url(cab).toString()), { typ: 'JWT', alg: 'ES256' });
    const c = JSON.parse(deB64url(cuerpo).toString());
    assert.equal(c.aud, 'https://web.push.apple.com');
    assert.equal(c.sub, 'mailto:soporte@ordenglobal.org');
    assert.equal(c.exp, 1_700_000_000 + 12 * 3600);
    const pub = deB64url(par.publica);
    const llave = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33)) }, format: 'jwk' });
    assert.ok(crypto.verify('sha256', Buffer.from(`${cab}.${cuerpo}`), { key: llave, dsaEncoding: 'ieee-p1363' }, deB64url(firma)));
  }));

test('VAPID: un par cuya llave privada empieza con ceros (≈1 de cada 256) sigue valiendo, venga de crearParVapid o de otra herramienta', () => {
  // Se busca un par así (determinista: se prueban pares hasta dar con uno; en promedio, unos 256).
  let e: crypto.ECDH;
  do {
    e = crypto.createECDH('prime256v1');
    e.generateKeys();
  } while (e.getPrivateKey().length === 32);
  const corta = b64url(e.getPrivateKey());
  process.env.WEB_PUSH_VAPID_PUBLICA = b64url(e.getPublicKey());
  process.env.WEB_PUSH_VAPID_PRIVADA = corta;
  try {
    assert.ok(W.vapid(), 'la llave sin los ceros de la izquierda se completa a 32 bytes');
  } finally {
    delete process.env.WEB_PUSH_VAPID_PUBLICA;
    delete process.env.WEB_PUSH_VAPID_PRIVADA;
  }
  // Y crearParVapid nunca entrega una privada de menos de 32 bytes.
  for (let i = 0; i < 2000; i++) assert.equal(deB64url(W.crearParVapid().privada).length, 32);
});

test('VAPID: sin par, o con un par roto, no hay avisos web (y no se rompe nada)', () => {
  assert.equal(W.vapid(), null);
  process.env.WEB_PUSH_VAPID_PUBLICA = 'no-es-una-llave';
  process.env.WEB_PUSH_VAPID_PRIVADA = 'tampoco';
  try {
    assert.equal(W.pushWebConfigurado(), false);
  } finally {
    delete process.env.WEB_PUSH_VAPID_PUBLICA;
    delete process.env.WEB_PUSH_VAPID_PRIVADA;
  }
});

test('suscripciones: solo de servicios de avisos conocidos, con llaves de verdad', () => {
  const ok = navegador().sus;
  assert.ok(W.suscripcionValida(ok));
  for (const e of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-bl2p.notify.windows.com/w/?token=x', 'https://api.push.apple.com/3/x'])
    assert.ok(W.suscripcionValida({ ...ok, endpoint: e }), e);
  for (const e of ['http://web.push.apple.com/x', 'https://169.254.169.254/latest', 'https://evil.com/web.push.apple.com', 'https://push.apple.com.evil.com/x', 'https://user:pw@web.push.apple.com/x', 'https://web.push.apple.com:8443/x'])
    assert.equal(W.suscripcionValida({ ...ok, endpoint: e }), null, e);
  assert.equal(W.suscripcionValida({ ...ok, keys: { ...ok.keys, p256dh: 'corta' } }), null);
  assert.equal(W.suscripcionValida({ ...ok, keys: { ...ok.keys, auth: b64url(crypto.randomBytes(8)) } }), null);
});

/** Un servicio de avisos de mentira: guarda lo que llega y contesta con `estado(endpoint)`. */
function conServicio(estado: (endpoint: string) => number) {
  const original = globalThis.fetch;
  const llegados: { url: string; headers: Record<string, string>; body: Buffer }[] = [];
  globalThis.fetch = (async (url: any, init: any = {}) => {
    llegados.push({ url: String(url), headers: init.headers || {}, body: Buffer.from(init.body || []) });
    return new Response('', { status: estado(String(url)) });
  }) as typeof fetch;
  return { llegados, soltar: () => (globalThis.fetch = original) };
}

test('enviarPush también llega al iPhone suscrito: cifrado para él, con VAPID; 410 borra la suscripción', async () => {
  await conVapid(async (par) => {
    W._olvidarPushWeb();
    const vivo = navegador('https://web.push.apple.com/vivo');
    const muerto = navegador('https://web.push.apple.com/muerto');
    await W.suscribirWeb('Ana@X.hn', vivo.sus, 'ipad-ana');
    await W.suscribirWeb('ana@x.hn', muerto.sus, 'iphone-ana');
    const s = conServicio((u) => (u.endsWith('/muerto') ? 410 : 201));
    try {
      const r = await P.avisarComputadoraPorPush('ana@x.hn', 'tarea-7', 'Terminé de llenar el formulario.');
      assert.equal(r.enviados, 1);
      assert.equal(r.fallidos, 1);
      assert.equal(r.quitados, 1);
      const alVivo = s.llegados.find((l) => l.url.endsWith('/vivo'))!;
      assert.match(alVivo.headers.Authorization, new RegExp(`^vapid t=[^,]+, k=${par.publica}$`));
      assert.equal(alVivo.headers['Content-Encoding'], 'aes128gcm');
      const aviso = JSON.parse(descifrar(alVivo.body, vivo.ua, vivo.auth).toString());
      assert.equal(aviso.titulo, 'Tu computadora');
      assert.equal(aviso.texto, 'Terminé de llenar el formulario.');
      assert.equal(aviso.abrir, 'computadora');
      assert.equal(aviso.id, 'tarea-7');
      assert.equal(aviso.para, P.seudonimoDe('ana@x.hn'), 'lleva de quién es: en un navegador compartido no se enseña a otro');
      const quedan = await W.suscripcionesDe('ana@x.hn');
      assert.ok(quedan.ok && quedan.suscripciones.length === 1 && quedan.suscripciones[0].endpoint.endsWith('/vivo'), 'la muerta se borró');
    } finally {
      s.soltar();
    }
  });
});

test('una llamada sale urgente y con vida corta; sin navegadores ni VAPID, todo queda como antes', async () => {
  await conVapid(async () => {
    W._olvidarPushWeb();
    const n = navegador('https://fcm.googleapis.com/fcm/send/abc');
    await W.suscribirWeb('beto@x.hn', n.sus);
    const s = conServicio(() => 201);
    try {
      await P.llamarConAura('beto@x.hn', 'Te quiero contar lo del banco');
      assert.equal(s.llegados[0].headers.Urgency, 'high');
      assert.equal(s.llegados[0].headers.TTL, String(P.TTL_LLAMADA_S));
      const aviso = JSON.parse(descifrar(s.llegados[0].body, n.ua, n.auth).toString());
      assert.equal(aviso.titulo, 'AURA te llama');
      assert.equal(aviso.texto, 'Te quiero contar lo del banco');
    } finally {
      s.soltar();
    }
  });
  // Sin VAPID: Firebase tal cual (sin FIREBASE_SERVICE_ACCOUNT, «no configurado»), y ni un POST.
  const s = conServicio(() => 201);
  try {
    const r = await P.avisarPush('beto@x.hn', { texto: 'hola' });
    assert.equal(r.configurado, false);
    assert.equal(s.llegados.length, 0);
  } finally {
    s.soltar();
  }
});

test('rutas: la llave pública sin sesión; suscribir y quitar SOLO con la sesión, y solo servicios conocidos', async () => {
  await conVapid(async (par) => {
    W._olvidarPushWeb();
    const express = (await import('express')).default;
    const { montarRutasPush } = await import('../server/push');
    const app = express();
    app.use(express.json());
    const pasa = (_q: any, _r: any, n: any) => n();
    montarRutasPush(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null), nivelDe: () => 'miembro' });
    const srv = app.listen(0);
    const base = `http://127.0.0.1:${(srv.address() as any).port}`;
    try {
      assert.equal((await (await fetch(`${base}/api/push/web/clave`)).json()).publica, par.publica);
      const n = navegador();
      const post = (ruta: string, body: unknown, quien?: string) =>
        fetch(`${base}${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(quien ? { 'x-quien': quien } : {}) }, body: JSON.stringify(body) });
      assert.equal((await post('/api/push/web/suscribir', { suscripcion: n.sus })).status, 401, 'sin sesión no');
      assert.equal((await post('/api/push/web/suscribir', { suscripcion: { ...n.sus, endpoint: 'https://evil.com/x' } }, 'cami@x.hn')).status, 400);
      const ok = await post('/api/push/web/suscribir', { suscripcion: n.sus }, 'cami@x.hn');
      assert.equal(ok.status, 200);
      assert.equal((await ok.json()).suscripciones, 1);
      const estado = await (await fetch(`${base}/api/push/estado`, { headers: { 'x-quien': 'cami@x.hn' } })).json();
      assert.deepEqual(estado.web, { configurado: true, suscripciones: 1 });
      const q = await post('/api/push/web/quitar', { endpoint: n.sus.endpoint }, 'cami@x.hn');
      assert.equal((await q.json()).quitados, 1);
    } finally {
      srv.close();
    }
  });
});

test('AUR13: el navegador que pasa de una cuenta a otra deja de recibir los avisos de la primera; aceptado no es entregado', async () => {
  await conVapid(async () => {
    W._olvidarPushWeb();
    const n = navegador('https://web.push.apple.com/compartido');
    await W.suscribirWeb('dora@x.hn', n.sus, 'ipad-casa');
    // En el mismo navegador entra Eli (Dora no alcanzó a quitar la suscripción).
    await W.suscribirWeb('eli@x.hn', n.sus, 'ipad-casa');
    const s = conServicio(() => 201);
    try {
      const r = await W.enviarPushWeb('dora@x.hn', { tipo: 'mensaje', titulo: 'AURA', texto: 'Lo privado de Dora', para: P.seudonimoDe('dora@x.hn'), enviado: Date.now() }, { ttlS: 60 });
      assert.equal(s.llegados.length, 0, 'lo de Dora no llega al navegador que ahora es de Eli');
      assert.equal(r.aceptados, 0);
      const d = await W.suscripcionesDe('dora@x.hn');
      assert.ok(d.ok && d.suscripciones.length === 0, 'y la suscripción se podó de la cuenta de Dora');
      // Aunque la cuenta vieja todavía lo tuviera guardado, al mandar se mira de quién es ahora.
      await W._meterSinDueno('dora@x.hn', n.sus, 'ipad-casa');
      await W.enviarPushWeb('dora@x.hn', { tipo: 'mensaje', titulo: 'AURA', texto: 'Lo privado de Dora', para: P.seudonimoDe('dora@x.hn'), enviado: Date.now() }, { ttlS: 60 });
      assert.equal(s.llegados.length, 0);
      const e = await W.enviarPushWeb('eli@x.hn', { tipo: 'mensaje', titulo: 'AURA', texto: 'Lo de Eli', para: P.seudonimoDe('eli@x.hn'), enviado: Date.now() }, { ttlS: 60 });
      assert.equal(s.llegados.length, 1);
      // 201 del servicio = aceptado (no «entregado»: el servicio no avisa si el aparato lo mostró).
      assert.deepEqual([e.aceptados, e.entrega], [1, 'aceptado']);
      assert.doesNotMatch(JSON.stringify(e), /entregad/i);
    } finally {
      s.soltar();
    }
  });
});
