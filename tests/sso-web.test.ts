/**
 * IOS01 (auditoría del 3-oct): entrar con Genesis ID desde la WEB (Safari, el icono del iPhone, escritorio).
 *
 * El /sso de antes solo sabía devolver a la app Android (`intent://`). Para la web:
 *   · la web registra su intento ANTES de ir a la wallet (`POST /api/genesis/web/intento {estado, reto}`):
 *     estado al azar (state) y la huella del verificador (PKCE), que nunca sale del navegador;
 *   · la wallet vuelve a /sso con pase+estado: si el estado es de un intento web, el servidor lo DEPOSITA
 *     (la página no lo muestra, no hay token en la URL de vuelta) y ofrece volver a AURA;
 *   · la web lo recoge con su verificador (`POST /api/genesis/web/recoger`): un solo canje, con plazo,
 *     atado al reto del intento; otro verificador no lo gasta; un estado desconocido o vencido, tampoco;
 *   · lo de Android queda igual: un estado que no es de un intento web sigue con su `intent://`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { montarEnlacesApp } from '../server/enlaces-app';
import { montarRutasGenesis } from '../server/genesis';
import { _olvidarIntentosWeb, depositarVuelta, esIntentoWeb, recogerVuelta, registrarIntentoWeb, retoDe, VIDA_INTENTO_MS, VIDA_VUELTA_MS } from '../server/sso-web';

const b64 = (b: Buffer) => b.toString('base64url');
const nuevo = () => {
  const verificador = b64(randomBytes(32));
  return { verificador, reto: b64(createHash('sha256').update(verificador).digest()), estado: b64(randomBytes(18)) };
};

test('el depósito: solo para intentos web registrados, un canje, atado al reto y con plazo', () => {
  _olvidarIntentosWeb();
  const t0 = 1_000_000;
  const a = nuevo();
  assert.equal(retoDe(a.verificador), a.reto, 'la huella es la misma que calcula el teléfono (SHA-256, base64url)');
  assert.equal(registrarIntentoWeb('corto', a.reto, t0), false, 'un estado con poca entropía no se acepta');
  assert.equal(registrarIntentoWeb(a.estado, 'no-es-un-reto', t0), false);
  assert.equal(registrarIntentoWeb(a.estado, a.reto, t0), true);
  assert.equal(registrarIntentoWeb(a.estado, a.reto, t0), false, 'el mismo estado no se registra dos veces');
  assert.equal(esIntentoWeb(a.estado, t0), true);
  assert.equal(esIntentoWeb(nuevo().estado, t0), false);

  assert.deepEqual(recogerVuelta(a.estado, a.verificador, t0 + 1000), { estado: 'pendiente' }, 'todavía no volvió la wallet');
  assert.equal(depositarVuelta({ estado: a.estado, pase: 'PASE-A' }, t0 + 2000), true);
  assert.equal(depositarVuelta({ estado: a.estado, pase: 'OTRO' }, t0 + 2100), false, 'la primera vuelta gana; no se pisa');
  assert.equal(depositarVuelta({ estado: nuevo().estado, pase: 'X' }, t0), false, 'sin intento registrado no se guarda nada');
  assert.deepEqual(recogerVuelta(a.estado, nuevo().verificador, t0 + 3000), { estado: 'reto' }, 'otro verificador no lo gasta');
  assert.deepEqual(recogerVuelta(a.estado, a.verificador, t0 + 3000), { estado: 'listo', pase: 'PASE-A' });
  assert.deepEqual(recogerVuelta(a.estado, a.verificador, t0 + 3001), { estado: 'desconocido' }, 'un solo canje');

  const b = nuevo();
  registrarIntentoWeb(b.estado, b.reto, t0);
  depositarVuelta({ estado: b.estado, error: 'cancelado' }, t0 + 10);
  assert.deepEqual(recogerVuelta(b.estado, b.verificador, t0 + 20), { estado: 'error', error: 'cancelado' });

  const c = nuevo();
  registrarIntentoWeb(c.estado, c.reto, t0);
  assert.equal(esIntentoWeb(c.estado, t0 + VIDA_INTENTO_MS + 1), false, 'el intento vence');
  assert.deepEqual(recogerVuelta(c.estado, c.verificador, t0 + VIDA_INTENTO_MS + 1), { estado: 'desconocido' });

  const d = nuevo();
  registrarIntentoWeb(d.estado, d.reto, t0);
  depositarVuelta({ estado: d.estado, pase: 'PASE-D' }, t0 + 5);
  assert.deepEqual(recogerVuelta(d.estado, d.verificador, t0 + 5 + VIDA_VUELTA_MS + 1), { estado: 'desconocido' }, 'un pase depositado no espera para siempre');
});

async function servidor() {
  const pedidas: any[] = [];
  const app = express();
  app.use(express.json());
  const pasa: express.RequestHandler = (_q, _s, n) => n();
  montarEnlacesApp(app);
  montarRutasGenesis(app, {
    limitar: () => pasa,
    normalizarCorreo: (c) => String(c || '').trim().toLowerCase(),
    tieneAcceso: () => true,
    nombreYRol: (correo, nombre) => ({ nombre: nombre || correo, rol: 'AU-RA FP' }),
    emitirSesion: (u) => ({ token: 'sesion-' + u.correo }),
    pedirAcceso: async () => true,
    fetch: (async (url: any, init: any) => {
      pedidas.push(JSON.parse(init?.body || '{}'));
      return new Response(JSON.stringify({ valido: true, gid: 'GEN-ANA1-ANA2-A', correo: 'ana@prueba.local', aud: ['aura'], perfil: { verificada: true, nombre: 'ANA' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any,
  });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const post = async (ruta: string, cuerpo: unknown) => {
    const r = await fetch(base + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    return { status: r.status, body: (await r.json().catch(() => null)) as any, cache: r.headers.get('cache-control') };
  };
  return { base, post, pedidas, cerrar: () => new Promise((r) => srv.close(r)) };
}

test('de punta a punta: intento → wallet → /sso deposita (sin intent ni pase en la página) → la web recoge y entra', async () => {
  process.env.GENESIS_API_KEY_AURA = 'clave-aura';
  _olvidarIntentosWeb();
  const s = await servidor();
  try {
    const a = nuevo();
    assert.equal((await s.post('/api/genesis/web/intento', { estado: 'x', reto: a.reto })).status, 400);
    const i = await s.post('/api/genesis/web/intento', { estado: a.estado, reto: a.reto });
    assert.equal(i.status, 200, JSON.stringify(i.body));
    assert.equal(i.cache, 'no-store');
    assert.equal((await s.post('/api/genesis/web/recoger', { estado: a.estado, verificador: a.verificador })).status, 202, 'todavía pendiente');

    const r = await fetch(`${s.base}/sso?pase=PASE.web_1&estado=${a.estado}`, { redirect: 'manual' });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control') || '', /no-store/);
    assert.match(r.headers.get('content-security-policy') || '', /default-src 'none'/);
    const html = await r.text();
    assert.doesNotMatch(html, /intent:\/\//, 'a la web no se le ofrece el intent de Android');
    assert.doesNotMatch(html, /PASE\.web_1/, 'el pase no aparece en la página');
    assert.doesNotMatch(html, /<script/i);
    assert.match(html, /Volver a AU-RA/);
    assert.match(html, /href="\/"/, 'vuelve a la raíz, sin nada en la URL');

    assert.equal((await s.post('/api/genesis/web/recoger', { estado: a.estado, verificador: nuevo().verificador })).status, 403, 'otro verificador: no');
    const ok = await s.post('/api/genesis/web/recoger', { estado: a.estado, verificador: a.verificador });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.token, 'sesion-ana@prueba.local');
    assert.equal(ok.cache, 'no-store');
    assert.deepEqual(s.pedidas.at(-1), { token: 'PASE.web_1', verificador: a.verificador }, 'a Genesis va el pase con el verificador (PKCE)');
    assert.equal((await s.post('/api/genesis/web/recoger', { estado: a.estado, verificador: a.verificador })).status, 410, 'un solo canje');

    // La wallet canceló: se recoge el código para que la web lo explique.
    const b = nuevo();
    await s.post('/api/genesis/web/intento', { estado: b.estado, reto: b.reto });
    await fetch(`${s.base}/sso?error=cancelado&estado=${b.estado}`);
    const e = await s.post('/api/genesis/web/recoger', { estado: b.estado, verificador: b.verificador });
    assert.equal(e.status, 400);
    assert.equal(e.body.codigo, 'cancelado');
  } finally {
    await s.cerrar();
  }
});

test('Android intacto: un estado que no es de un intento web sigue con su intent:// atado al paquete', async () => {
  _olvidarIntentosWeb();
  const s = await servidor();
  try {
    const html = await (await fetch(`${s.base}/sso?pase=PASE.abc_123&estado=EST0abcd1234`)).text();
    assert.ok(html.includes('href="intent://sso?pase=PASE.abc_123&amp;estado=EST0abcd1234#Intent;scheme=ultronfp;package=link.ordenglobal.ultronfp;end"'));
  } finally {
    await s.cerrar();
  }
});
