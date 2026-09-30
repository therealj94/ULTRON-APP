/**
 * La vuelta de la wallet por https (server/enlaces-app.ts).
 *
 * Lo que tiene que ser verdad:
 *   · /.well-known/assetlinks.json declara SOLO el paquete de AU-RA con las huellas de
 *     ANDROID_CERT_SHA256; sin la variable (o con basura) es 404, nunca una huella inventada;
 *   · se sirve como JSON, en 200 directo (Android no sigue redirecciones) y con caché pública;
 *   · /sso reenvía a la app solo la vuelta del contrato (pase o error, y estado), atada al paquete;
 *   · nada de la query se refleja fuera del `intent://` validado: ni HTML, ni comillas, ni otro destino;
 *   · /sso no se guarda en caché, no manda Referer y tiene una CSP sin scripts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { huellasCertificado, montarEnlacesApp, vueltaValida, intentDeVuelta, PAQUETE_AURA } from '../server/enlaces-app';

const H1 = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';
const H2_CRUDA = 'fa'.repeat(32);
const H2 = Array(32).fill('FA').join(':');

async function montar() {
  const app = express();
  montarEnlacesApp(app);
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const pedir = (ruta: string) => fetch(base + ruta, { redirect: 'manual' });
  return { pedir, cerrar: () => new Promise((r) => srv.close(r)) };
}

const antes = process.env.ANDROID_CERT_SHA256;
test.afterEach(() => {
  if (antes === undefined) delete process.env.ANDROID_CERT_SHA256;
  else process.env.ANDROID_CERT_SHA256 = antes;
});

test('huellas: con o sin dos puntos, en mayúsculas, sin repetir; lo que no mide 32 bytes se descarta', () => {
  assert.deepEqual(huellasCertificado(`${H1}, ${H2_CRUDA} ,${H1.toLowerCase()}`), [H1, H2]);
  assert.deepEqual(huellasCertificado('AB:CD, xyz, ' + 'A'.repeat(63)), []);
  assert.deepEqual(huellasCertificado(''), []);
  assert.deepEqual(huellasCertificado(undefined), []);
});

test('assetlinks sin ANDROID_CERT_SHA256: 404, sin huellas inventadas y sin caché', async () => {
  delete process.env.ANDROID_CERT_SHA256;
  const m = await montar();
  try {
    const r = await m.pedir('/.well-known/assetlinks.json');
    assert.equal(r.status, 404);
    assert.match(r.headers.get('content-type') || '', /^application\/json/);
    assert.match(r.headers.get('cache-control') || '', /no-store/);
    assert.doesNotMatch(await r.text(), /sha256_cert_fingerprints/);
    // Una variable con basura es lo mismo que no tenerla.
    process.env.ANDROID_CERT_SHA256 = 'no-es-una-huella';
    assert.equal((await m.pedir('/.well-known/assetlinks.json')).status, 404);
  } finally {
    await m.cerrar();
  }
});

test('assetlinks con ANDROID_CERT_SHA256: 200 directo, JSON, cacheable, solo el paquete de AU-RA', async () => {
  process.env.ANDROID_CERT_SHA256 = `${H1},${H2_CRUDA}`;
  const m = await montar();
  try {
    const r = await m.pedir('/.well-known/assetlinks.json');
    assert.equal(r.status, 200, 'sin redirecciones: Android no las sigue');
    assert.match(r.headers.get('content-type') || '', /^application\/json/);
    assert.match(r.headers.get('cache-control') || '', /public, max-age=\d+/);
    const j = await r.json();
    assert.deepEqual(j, [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: 'link.ordenglobal.ultronfp', sha256_cert_fingerprints: [H1, H2] },
      },
    ]);
    // La variable se lee en cada petición: quitarla apaga la declaración sin reiniciar.
    delete process.env.ANDROID_CERT_SHA256;
    assert.equal((await m.pedir('/.well-known/assetlinks.json')).status, 404);
  } finally {
    await m.cerrar();
  }
});

test('vueltaValida: solo pase|error + estado, cada uno una vez y con su forma', () => {
  assert.deepEqual(vueltaValida('/sso?pase=abc.DEF_1-2&estado=EST0abcd1234'), { pase: 'abc.DEF_1-2', estado: 'EST0abcd1234' });
  assert.deepEqual(vueltaValida('/sso?error=gid-pendiente&estado=EST0abcd1234'), { error: 'gid-pendiente', estado: 'EST0abcd1234' });
  assert.deepEqual(vueltaValida('/sso?pase=a%2Bb%3D&estado=EST0abcd1234'), { pase: 'a+b=', estado: 'EST0abcd1234' });
  for (const malo of [
    '/sso',
    '/sso?',
    '/sso?pase=abc',
    '/sso?estado=EST0abcd1234',
    '/sso?pase=a&error=cancelado&estado=EST0abcd1234',
    '/sso?pase=a&estado=EST0abcd1234&destino=https://malo.test',
    '/sso?pase=a&pase=b&estado=EST0abcd1234',
    '/sso?pase=<script>&estado=EST0abcd1234',
    '/sso?pase=a"b&estado=EST0abcd1234',
    '/sso?pase=a;S.browser_fallback_url=https://malo.test;end&estado=EST0abcd1234',
    '/sso?pase=a&estado=corto',
    '/sso?error=Cancelado&estado=EST0abcd1234',
    '/sso?pase[x]=a&estado=EST0abcd1234',
    '/sso?pase=' + 'a'.repeat(4097) + '&estado=EST0abcd1234',
  ]) {
    assert.equal(vueltaValida(malo), null, malo);
  }
});

test('intentDeVuelta: esquema ultronfp atado al paquete de AU-RA', () => {
  assert.equal(
    intentDeVuelta({ pase: 'a+b=', estado: 'EST0abcd1234' }),
    `intent://sso?pase=a%2Bb%3D&estado=EST0abcd1234#Intent;scheme=ultronfp;package=${PAQUETE_AURA};end`
  );
});

test('/sso con una vuelta válida: botón intent:// con la misma query, y las cabeceras que protegen el pase', async () => {
  const m = await montar();
  try {
    const r = await m.pedir('/sso?pase=PASE.abc_123&estado=EST0abcd1234');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /^text\/html/);
    assert.match(r.headers.get('cache-control') || '', /no-store/);
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    const csp = r.headers.get('content-security-policy') || '';
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /style-src 'sha256-[A-Za-z0-9+/=]+'/);
    assert.doesNotMatch(csp, /script-src|unsafe-inline/);
    const html = await r.text();
    assert.match(html, /Abrí AU-RA para terminar de entrar/);
    assert.ok(
      html.includes('href="intent://sso?pase=PASE.abc_123&amp;estado=EST0abcd1234#Intent;scheme=ultronfp;package=link.ordenglobal.ultronfp;end"'),
      html
    );
    assert.doesNotMatch(html, /<script/i, 'la página no tiene scripts');
    // La huella de la CSP es la del estilo que va en la página (si no, el navegador lo bloquea).
    const estilo = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] || '';
    assert.ok(csp.includes(`'sha256-${createHash('sha256').update(estilo).digest('base64')}'`), 'la CSP permite el estilo de la página');
    // El pase aparece UNA vez: dentro del intent, no en el texto.
    assert.equal(html.split('PASE.abc_123').length - 1, 1);
  } finally {
    await m.cerrar();
  }
});

test('/sso con un error de la wallet también vuelve a la app (que muestra el mensaje)', async () => {
  const m = await montar();
  try {
    const html = await (await m.pedir('/sso?error=sin-gid&estado=EST0abcd1234')).text();
    assert.ok(html.includes('intent://sso?error=sin-gid&amp;estado=EST0abcd1234#Intent;scheme=ultronfp;package=link.ordenglobal.ultronfp;end'));
  } finally {
    await m.cerrar();
  }
});

test('/sso con cualquier otra cosa: sin botón y sin reflejar nada (XSS, parámetros ajenos, otro destino)', async () => {
  const m = await montar();
  try {
    for (const ruta of [
      '/sso?pase=%3Cscript%3Ealert(1)%3C%2Fscript%3E&estado=EST0abcd1234',
      '/sso?pase=a%22%3E%3Cimg%20src%3Dx%3E&estado=EST0abcd1234',
      '/sso?pase=a&estado=EST0abcd1234&vuelta=https%3A%2F%2Fmalo.test',
      '/sso?estado=%22%3E%3Csvg%20onload%3Dalert(1)%3E',
      '/sso?pase=javascript:alert(1)&estado=EST0abcd1234',
      '/sso',
    ]) {
      const r = await m.pedir(ruta);
      assert.equal(r.status, 400, ruta);
      assert.match(r.headers.get('cache-control') || '', /no-store/, ruta);
      assert.equal(r.headers.get('referrer-policy'), 'no-referrer', ruta);
      assert.ok(r.headers.get('content-security-policy'), ruta);
      const html = await r.text();
      assert.doesNotMatch(html, /intent:\/\//, ruta);
      assert.doesNotMatch(html, /<script|<img|<svg|onload|alert|malo\.test|javascript:/i, ruta);
      assert.match(html, /Abrí AU-RA para terminar de entrar/);
    }
  } finally {
    await m.cerrar();
  }
});
