/**
 * LA OTA PUBLICADA CONTRA LA QUE CORRE CADA TELÉFONO (GET /api/build → clientes). El flujo .github/workflows/ota.yml
 * sube, tras publicar, la ficha `ota-aura.json` al Release «aura-ota» (scripts/qa/manifiesto-ota.mjs); el servidor la
 * lee (lib/ota-publicada.ts) y compara (lib/recepcion-clientes.ts):
 *  · la ficha se valida campo por campo; lo roto se descarta, nunca da un «sí»;
 *  · la matriz: mismo runtime y updateId → sí; OTA anterior → no; JS de fábrica sin la OTA → no (embebido-sin-ota);
 *    otro runtime → no (otro-runtime); marcha atrás → sí con el JS de fábrica; sin ficha → desconocido;
 *  · la descarga sigue redirecciones, corta a los 4 s, se guarda 10 min; si falla, la última buena y
 *    `fuente: 'no-disponible'`; /api/build nunca la espera de más;
 *  · el script del flujo arma entradas que el servidor acepta, y fusiona sin perder la otra app;
 *  · el flujo tiene el paso que sube la ficha, en un trabajo aparte con `contents: write`.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-ota-publicada';
// Este despliegue es AU-RA (lib/plataforma.ts): la ruta solo compara con las publicaciones de `ultron`.
process.env.PLATAFORMA = 'ultron';
process.env.ULTRON_MESA_CLAVE = 'clave-de-mesa-de-prueba-ota-publicada';
const O = await import('../lib/ota-publicada');
const R = await import('../lib/recepcion-clientes');
const { almacenEnMemoria } = await import('../lib/durable');
const { montarRecepcion, montarRutaBuild, esperadoDe } = await import('../server/build-rutas');
const { exigirMesa, sesionDe, emitirSesion } = await import('../server/seguridad');
const S = await import('../scripts/qa/manifiesto-ota.mjs');

const RT = 'f3a1c09e5b7d2468ace013579bdf2468ace01357';
const RT_VIEJO = '0a1b2c3d4e5f60718293a4b5c6d7e8f901234567';
const RT_ELECTRUM = 'e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1';
const OTA = '0b9f3c2e-1a2b-4c3d-8e9f-0123456789ab';
const OTA_VIEJA = '1b9f3c2e-1a2b-4c3d-8e9f-0123456789ab';
const OTA_ELECTRUM = '2b9f3c2e-1a2b-4c3d-8e9f-0123456789ab';
const EMBEBIDA = '3b9f3c2e-1a2b-4c3d-8e9f-0123456789ab';
const GRUPO = '9c9f3c2e-1a2b-4c3d-8e9f-0123456789ab';
const COMMIT = 'c0ffee0123456789abcdef0123456789abcdef01';

const pub = (x: Record<string, unknown> = {}) => ({
  plataforma: 'ultron',
  canal: 'production',
  runtimeVersion: RT,
  tipo: 'ota',
  androidUpdateId: OTA,
  iosUpdateId: null,
  grupo: GRUPO,
  commit: COMMIT,
  publicado: '2026-10-05T12:00:00.000Z',
  ...x,
});
const FICHA = {
  v: 1,
  actualizado: '2026-10-05T12:00:05.000Z',
  publicaciones: [pub(), pub({ plataforma: 'electrum', runtimeVersion: RT_ELECTRUM, androidUpdateId: OTA_ELECTRUM, publicado: '2026-10-05T11:00:00.000Z' })],
};

/* ------------------------------------------------------------------ la ficha */

test('ficha: se valida campo por campo; lo roto se descarta; la más reciente primero', () => {
  const m = O.validarManifiestoOta(FICHA)!;
  assert.equal(m.publicaciones.length, 2);
  assert.equal(m.publicaciones[0].plataforma, 'ultron', 'la más reciente primero');
  assert.equal(m.publicaciones[0].androidUpdateId, OTA);
  for (const roto of [null, 'x', 42, {}, { v: 2, publicaciones: [] }, { v: 1 }, { v: 1, publicaciones: 'no' }]) assert.equal(O.validarManifiestoOta(roto), null, JSON.stringify(roto));
  const sucia = O.validarManifiestoOta({
    v: 1,
    publicaciones: [
      pub({ androidUpdateId: 'no-es-un-uuid' }),
      pub({ plataforma: 'otra-app' }),
      pub({ runtimeVersion: '../../etc' }),
      pub({ canal: 'prod uction' }),
      pub({ publicado: 'ayer' }),
      pub({ tipo: 'raro' }),
      pub({ androidUpdateId: OTA.toUpperCase(), commit: 'zzz', grupo: 'x' }),
      pub({ tipo: 'embebido', androidUpdateId: OTA }),
      null,
    ],
  })!;
  assert.equal(sucia.publicaciones.length, 2, 'solo las dos con forma');
  assert.equal(sucia.publicaciones[0].androidUpdateId, OTA, 'en minúsculas');
  assert.equal(sucia.publicaciones[0].commit, null);
  assert.equal(sucia.publicaciones[0].grupo, null);
  assert.equal(sucia.publicaciones[1].tipo, 'embebido');
  assert.equal(sucia.publicaciones[1].androidUpdateId, null, 'una marcha atrás no lleva updateId que esperar');
  assert.deepEqual(O.validarManifiestoOta({ v: 1, publicaciones: [] })!.publicaciones, [], 'vacía es válida (aún no hay OTA)');
});

/* ------------------------------------------------------------------ la matriz */

const t = '2026-10-05T13:00:00.000Z';
const tel = (x: Partial<import('../lib/recepcion-clientes').RegistroCliente> = {}): import('../lib/recepcion-clientes').RegistroCliente => ({
  instalacion: 'a'.repeat(16),
  primero: t,
  visto: t,
  plataforma: 'android',
  version: '5.3.0',
  build: null,
  buildConfig: '53',
  runtime: RT,
  updateId: OTA,
  canal: 'production',
  embebido: false,
  creada: '2026-10-05T12:00:00.000Z',
  webSha: null,
  os: '14',
  ...x,
});
const pubs = O.validarManifiestoOta(FICHA)!.publicaciones;
const comparar = (c: ReturnType<typeof tel>, ota: typeof pubs | null = pubs, producto: 'ultron' | 'electrum' = 'ultron') => R.compararCliente(c, { webSha: 'desconocido', producto, ota });

test('matriz: mismo runtime y misma OTA → sí', () => {
  const r = comparar(tel());
  assert.deepEqual([r.esperado, r.recibido, r.motivo], [OTA, 'sí', 'ota-recibida']);
  assert.match(r.explicacion!, /c0ffee0/);
  assert.equal(comparar(tel({ updateId: OTA.toUpperCase() })).recibido, 'sí', 'sin importar mayúsculas');
  const e = comparar(tel({ runtime: RT_ELECTRUM, updateId: OTA_ELECTRUM }), pubs, 'electrum');
  assert.deepEqual([e.esperado, e.recibido], [OTA_ELECTRUM, 'sí'], 'en su despliegue, Dr Electrum se encuentra por su runtime');
});

test('matriz: mismo runtime y una OTA anterior → no (ota-anterior); una distinta → no (otra-ota)', () => {
  const r = comparar(tel({ updateId: OTA_VIEJA, creada: '2026-10-04T20:00:00.000Z' }));
  assert.deepEqual([r.esperado, r.recibido, r.motivo], [OTA, 'no', 'ota-anterior']);
  const d = comparar(tel({ updateId: OTA_VIEJA, creada: null }));
  assert.deepEqual([d.recibido, d.motivo], ['no', 'otra-ota']);
});

test('matriz: JS de fábrica con la OTA de su runtime publicada → no, con el porqué', () => {
  const r = comparar(tel({ updateId: EMBEBIDA, embebido: true, creada: null }));
  assert.deepEqual([r.esperado, r.recibido, r.motivo], [OTA, 'no', 'embebido-sin-ota']);
  assert.match(r.explicacion!, /fábrica/);
});

test('matriz: otro runtime → no (otro-runtime): la OTA no es para esa APK', () => {
  const r = comparar(tel({ runtime: RT_VIEJO, updateId: EMBEBIDA, embebido: true }));
  assert.deepEqual([r.esperado, r.recibido, r.motivo], ['otro-runtime', 'no', 'otro-runtime']);
  assert.match(r.explicacion!, /otra APK/);
});

test('matriz: sin ficha → desconocido; sin runtime, otro canal, iOS sin OTA, sin updateId → desconocido con motivo', () => {
  const sin = comparar(tel(), null);
  assert.deepEqual([sin.esperado, sin.recibido, sin.motivo], ['desconocido', 'desconocido', 'ficha-no-disponible']);
  assert.equal(comparar(tel({ runtime: null })).motivo, 'sin-runtime');
  const canal = comparar(tel({ canal: 'pruebas' }));
  assert.deepEqual([canal.recibido, canal.motivo], ['desconocido', 'otro-canal']);
  const ios = comparar(tel({ plataforma: 'ios' }));
  assert.deepEqual([ios.recibido, ios.motivo], ['desconocido', 'sin-ota-ios']);
  const sinId = comparar(tel({ updateId: null, embebido: null }));
  assert.deepEqual([sinId.esperado, sinId.recibido, sinId.motivo], [OTA, 'desconocido', 'sin-updateid']);
  const vacia = comparar(tel(), []);
  assert.deepEqual([vacia.esperado, vacia.recibido, vacia.motivo], ['desconocido', 'desconocido', 'sin-publicacion'], 'ficha vacía: nada publicado que comparar');
});

test('matriz: tras la marcha atrás (tipo embebido) se espera el JS de fábrica', () => {
  const atras = O.validarManifiestoOta({ v: 1, publicaciones: [pub({ tipo: 'embebido', androidUpdateId: null, publicado: '2026-10-05T14:00:00.000Z' })] })!.publicaciones;
  const si = comparar(tel({ updateId: EMBEBIDA, embebido: true }), atras);
  assert.deepEqual([si.esperado, si.recibido, si.motivo], ['embebido', 'sí', 'fabrica-esperada']);
  const no = comparar(tel(), atras);
  assert.deepEqual([no.recibido, no.motivo], ['no', 'ota-en-vez-de-fabrica']);
});

test('matriz: una APK vieja con otro runtime encuentra SU OTA (la ficha guarda varios runtimes)', () => {
  const dos = O.validarManifiestoOta({ v: 1, publicaciones: [pub(), pub({ runtimeVersion: RT_VIEJO, androidUpdateId: OTA_VIEJA, publicado: '2026-09-30T12:00:00.000Z' })] })!.publicaciones;
  assert.deepEqual([comparar(tel({ runtime: RT_VIEJO, updateId: OTA_VIEJA }), dos).recibido, comparar(tel({ runtime: RT_VIEJO, updateId: OTA_VIEJA }), dos).esperado], ['sí', OTA_VIEJA]);
});

/* ------------------------------------------------------------------ el producto (revisión del 5-oct) */
// La ficha trae a propósito las dos apps (ultron y electrum). AU-RA nunca se compara con Dr Electrum, ni al revés,
// aunque coincidan sus runtimes: se filtra por producto ANTES de mirar canal, runtime y updateId.

const ficha = (...ps: Record<string, unknown>[]) => O.validarManifiestoOta({ v: 1, publicaciones: ps })!.publicaciones;
const corto8 = (s: string) => s.slice(0, 8);

test('producto: un teléfono de AU-RA cuyo runtime solo está en Dr Electrum nunca se compara ni se explica con Electrum', () => {
  // La ficha de siempre: AU-RA en RT, Dr Electrum en RT_ELECTRUM.
  const r = comparar(tel({ runtime: RT_ELECTRUM, updateId: OTA_ELECTRUM }));
  assert.notEqual(r.esperado, OTA_ELECTRUM, 'nunca se espera la OTA de Dr Electrum');
  assert.notEqual(r.recibido, 'sí');
  assert.deepEqual([r.esperado, r.recibido, r.motivo], ['otro-runtime', 'no', 'otro-runtime'], 'contra lo publicado de AU-RA: es otra APK');
  assert.ok(!r.explicacion!.includes(corto8(OTA_ELECTRUM)), 'la explicación no nombra la OTA de Dr Electrum');
  assert.ok(r.explicacion!.includes(corto8(OTA)), 'nombra la última de AU-RA');
  // Dr Electrum publicó DESPUÉS y el runtime del teléfono no está en ninguna: se explica con la última de AU-RA.
  const electrumMasNueva = ficha(pub(), pub({ plataforma: 'electrum', runtimeVersion: RT_ELECTRUM, androidUpdateId: OTA_ELECTRUM, publicado: '2026-10-05T13:00:00.000Z' }));
  assert.equal(electrumMasNueva[0].plataforma, 'electrum', 'la más reciente de la ficha es la de Dr Electrum');
  const v = comparar(tel({ runtime: RT_VIEJO, updateId: EMBEBIDA, embebido: true }), electrumMasNueva);
  assert.equal(v.motivo, 'otro-runtime');
  assert.ok(!v.explicacion!.includes(corto8(OTA_ELECTRUM)) && !v.explicacion!.includes(corto8(RT_ELECTRUM)), `no se explica con Dr Electrum: ${v.explicacion}`);
  assert.ok(v.explicacion!.includes(corto8(OTA)), 'se explica con la de AU-RA');
  // Sin ninguna publicación de AU-RA: no hay con qué comparar (desconocido), aunque el runtime coincida con Electrum.
  const soloElectrum = ficha(pub({ plataforma: 'electrum', runtimeVersion: RT_ELECTRUM, androidUpdateId: OTA_ELECTRUM }));
  for (const c of [tel({ runtime: RT_ELECTRUM, updateId: OTA_ELECTRUM }), tel({ runtime: RT_VIEJO }), tel()]) {
    const x = comparar(c, soloElectrum);
    assert.deepEqual([x.esperado, x.recibido, x.motivo], ['desconocido', 'desconocido', 'sin-publicacion'], JSON.stringify(c.runtime));
    assert.ok(!x.explicacion!.includes(corto8(OTA_ELECTRUM)));
  }
});

test('producto: runtime coincidente entre AU-RA y Dr Electrum → AU-RA compara solo con el updateId de AU-RA', () => {
  // Mismo runtime en las dos apps; la de Dr Electrum es más reciente (va primero en la ficha).
  const comun = ficha(pub(), pub({ plataforma: 'electrum', androidUpdateId: OTA_ELECTRUM, publicado: '2026-10-05T13:00:00.000Z' }));
  assert.equal(comun[0].plataforma, 'electrum');
  const si = comparar(tel());
  const siComun = comparar(tel(), comun);
  assert.deepEqual([siComun.esperado, siComun.recibido, siComun.motivo], [OTA, 'sí', 'ota-recibida'], 'corre la de AU-RA: sí');
  assert.equal(siComun.explicacion, si.explicacion);
  const conLaDeElectrum = comparar(tel({ updateId: OTA_ELECTRUM, creada: null }), comun);
  assert.deepEqual([conLaDeElectrum.esperado, conLaDeElectrum.recibido], [OTA, 'no'], 'la de Dr Electrum no cuenta como la publicada de AU-RA');
  // Una entrada sin producto conocido (una ficha manipulada que se saltara la validación) no es de AU-RA.
  const rara = [{ ...comun[1], plataforma: 'otra-app' as any, androidUpdateId: OTA_VIEJA }, ...comun];
  assert.equal(comparar(tel({ updateId: OTA_VIEJA }), rara).esperado, OTA, 'lo de otra app no se compara');
  assert.deepEqual(R.publicacionesDe(rara, 'ultron').map((p) => p.plataforma), ['ultron']);
});

test('producto: el despliegue de Dr Electrum solo considera las publicaciones de electrum', () => {
  const r = comparar(tel({ runtime: RT_ELECTRUM, updateId: OTA_ELECTRUM }), pubs, 'electrum');
  assert.deepEqual([r.esperado, r.recibido, r.motivo], [OTA_ELECTRUM, 'sí', 'ota-recibida']);
  // Un teléfono con el runtime de AU-RA: para Electrum es otra APK, explicada con la última de Electrum.
  const a = comparar(tel(), pubs, 'electrum');
  assert.notEqual(a.esperado, OTA);
  assert.deepEqual([a.esperado, a.recibido, a.motivo], ['otro-runtime', 'no', 'otro-runtime']);
  assert.ok(a.explicacion!.includes(corto8(OTA_ELECTRUM)) && !a.explicacion!.includes(corto8(OTA)));
  // Runtime coincidente: Electrum espera SU updateId.
  const comun = ficha(pub({ publicado: '2026-10-05T13:00:00.000Z' }), pub({ plataforma: 'electrum', androidUpdateId: OTA_ELECTRUM }));
  assert.deepEqual([comparar(tel({ updateId: OTA_ELECTRUM }), comun, 'electrum').esperado, comparar(tel({ updateId: OTA_ELECTRUM }), comun, 'electrum').recibido], [OTA_ELECTRUM, 'sí']);
  assert.deepEqual([comparar(tel(), comun, 'electrum').esperado, comparar(tel(), comun, 'electrum').recibido], [OTA_ELECTRUM, 'no']);
  // Sin publicaciones de Electrum: desconocido.
  assert.equal(comparar(tel(), ficha(pub()), 'electrum').motivo, 'sin-publicacion');
});

test('producto: lo esperado de la ruta (esperadoDe) solo trae las publicaciones del despliegue', () => {
  const m = { commit: 'x', web: { sha: 'desconocido', hora: null } } as any;
  const estado = { fuente: 'release', manifiesto: O.validarManifiestoOta(FICHA), leido: t } as any;
  const aura = esperadoDe(m, estado, 'ultron');
  assert.equal(aura.producto, 'ultron');
  assert.deepEqual(aura.ota!.map((p) => p.plataforma), ['ultron']);
  const electrum = esperadoDe(m, estado, 'electrum');
  assert.deepEqual(electrum.ota!.map((p) => p.androidUpdateId), [OTA_ELECTRUM]);
  assert.equal(esperadoDe(m, { fuente: 'no-disponible', manifiesto: null, leido: null } as any, 'ultron').ota, null, 'sin ficha, sigue «desconocido»');
});

/* ------------------------------------------------------------------ la descarga */

type Respuesta = { status?: number; cuerpo?: string; lento?: number; redirige?: string; sinFin?: boolean };
let respuesta: Respuesta = { cuerpo: JSON.stringify(FICHA) };
let pedidas = 0;
const fichaSrv = http.createServer((req, res) => {
  pedidas++;
  if (req.url === '/releases/download/aura-ota/ota-aura.json') {
    // Como GitHub: la descarga del Release redirige a su CDN.
    res.writeHead(302, { location: '/cdn/ota-aura.json' });
    return res.end();
  }
  const r = respuesta;
  if (r.sinFin) {
    // Un cuerpo que no termina nunca: trozos de 16 KB hasta que el cliente cuelgue.
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    const trozo = Buffer.alloc(16 * 1024, 0x20);
    const reloj = setInterval(() => res.write(trozo), 5);
    res.on('close', () => clearInterval(reloj));
    return;
  }
  setTimeout(() => {
    res.writeHead(r.status ?? 200, { 'content-type': 'application/octet-stream' });
    res.end(r.cuerpo ?? '');
  }, r.lento ?? 0);
});
fichaSrv.listen(0, '127.0.0.1');
await new Promise((r) => fichaSrv.once('listening', r));
const fichaBase = `http://127.0.0.1:${(fichaSrv.address() as AddressInfo).port}`;
const URL_FICHA = `${fichaBase}/releases/download/aura-ota/ota-aura.json`;
after(() => fichaSrv.close());

test('descarga: sigue la redirección, valida y guarda 10 min (una sola descarga a la vez)', async () => {
  respuesta = { cuerpo: JSON.stringify(FICHA) };
  let reloj = 1_000_000;
  const f = new O.FuenteOta({ url: URL_FICHA, ahora: () => reloj });
  assert.equal(f.estado().fuente, 'no-disponible', 'antes de leerla');
  pedidas = 0;
  const [a, b] = await Promise.all([f.refrescar(), f.refrescar()]);
  assert.equal(a, b);
  assert.equal(pedidas, 2, 'una descarga (302 + CDN), no dos');
  assert.equal(a.fuente, 'release');
  assert.equal(a.manifiesto!.publicaciones[0].androidUpdateId, OTA);
  pedidas = 0;
  reloj += O.CACHE_OTA_MS - 1;
  assert.equal((await f.obtener()).fuente, 'release');
  assert.equal(pedidas, 0, 'dentro de los 10 min no se descarga');
  // Caducó: contesta en el acto con lo guardado y refresca aparte.
  respuesta = { cuerpo: JSON.stringify({ ...FICHA, publicaciones: [pub({ androidUpdateId: OTA_VIEJA })] }) };
  reloj += 1;
  const caducada = await f.obtener();
  assert.equal(caducada.manifiesto!.publicaciones[0].androidUpdateId, OTA, 'lo guardado, sin esperar');
  await f.refrescar();
  assert.equal(f.estado().manifiesto!.publicaciones[0].androidUpdateId, OTA_VIEJA, 'y se refrescó aparte');
});

test('descarga: si falla, se queda con la última buena y lo dice (no-disponible); reintenta al minuto, no en cada petición', async () => {
  let reloj = 2_000_000;
  const f = new O.FuenteOta({ url: URL_FICHA, ahora: () => reloj });
  respuesta = { cuerpo: JSON.stringify(FICHA) };
  await f.refrescar();
  reloj += O.CACHE_OTA_MS;
  for (const r of [{ status: 404, cuerpo: 'Not Found' }, { cuerpo: '{roto' }, { cuerpo: JSON.stringify({ v: 9 }) }] as Respuesta[]) {
    respuesta = r;
    const e = await f.refrescar();
    assert.equal(e.fuente, 'no-disponible', JSON.stringify(r));
    assert.equal(e.manifiesto!.publicaciones[0].androidUpdateId, OTA, 'la última buena sigue');
    assert.equal(e.leido, new Date(2_000_000).toISOString(), 'y dice de cuándo es');
    assert.ok(e.detalle && !e.detalle.includes('127.0.0.1'), 'sin direcciones');
  }
  pedidas = 0;
  reloj += O.REINTENTO_OTA_MS - 1;
  await f.obtener();
  assert.equal(pedidas, 0, 'tras un fallo no se martilla');
  respuesta = { cuerpo: JSON.stringify(FICHA) };
  reloj += 1;
  await f.obtener();
  await f.refrescar();
  assert.equal(f.estado().fuente, 'release', 'al minuto se reintenta y vuelve');
});

test('descarga: sin respuesta en el tope → no-disponible; /api/build espera como mucho lo suyo la primera vez', async () => {
  respuesta = { cuerpo: JSON.stringify(FICHA), lento: 1500 };
  const f = new O.FuenteOta({ url: URL_FICHA, timeoutMs: 100 });
  const e = await f.refrescar();
  assert.equal(e.fuente, 'no-disponible');
  assert.match(e.detalle!, /sin respuesta/);
  assert.equal(e.manifiesto, null, 'sin ninguna buena: el teléfono quedará «desconocido»');
  const g = new O.FuenteOta({ url: URL_FICHA });
  const t0 = Date.now();
  const r = await g.obtener(50);
  assert.ok(Date.now() - t0 < 1000, `no esperó la descarga lenta (${Date.now() - t0} ms)`);
  assert.equal(r.fuente, 'no-disponible');
  await g.refrescar();
  assert.equal(g.estado().fuente, 'release', 'la descarga siguió aparte y quedó guardada');
  const apagada = new O.FuenteOta({ url: 'off' });
  assert.equal((await apagada.obtener()).fuente, 'no-disponible');
  assert.equal(new O.FuenteOta({ url: 'https://x.invalid/f.json' }).estado().fuente, 'no-disponible');
});

test('descarga: una ficha demasiado grande no se acepta', async () => {
  respuesta = { cuerpo: JSON.stringify({ ...FICHA, relleno: 'x'.repeat(O.TOPE_FICHA_BYTES) }) };
  const e = await new O.FuenteOta({ url: URL_FICHA }).refrescar();
  assert.equal(e.fuente, 'no-disponible');
  assert.equal(e.manifiesto, null);
});

test('descarga: un cuerpo enorme se corta en los 64 KB, sin leerlo entero (uno que no termina tampoco espera al tope de tiempo)', async () => {
  // Por la red: un cuerpo sin fin se corta al pasar el tope, mucho antes de los 3 s de espera.
  respuesta = { sinFin: true };
  const t0 = Date.now();
  const e = await new O.FuenteOta({ url: URL_FICHA, timeoutMs: 3_000 }).refrescar();
  assert.equal(e.fuente, 'no-disponible');
  assert.match(e.detalle!, /demasiado grande/, e.detalle);
  assert.ok(Date.now() - t0 < 2_500, `cortó sin esperar al tope de tiempo (${Date.now() - t0} ms)`);
  // Con un cuerpo en flujo de 10 MB: se leen como mucho 64 KB más un trozo, se cancela, y text() ni se llama.
  let leidos = 0;
  let cancelado = false;
  let entero = false;
  const TROZO = 16 * 1024;
  const cuerpo = new ReadableStream<Uint8Array>({
    pull(c) {
      if (leidos >= 10 * 1024 * 1024) return c.close();
      leidos += TROZO;
      c.enqueue(new Uint8Array(TROZO).fill(0x20));
    },
    cancel() {
      cancelado = true;
    },
  });
  const grande = new O.FuenteOta({
    url: 'https://ficha.invalid/ota-aura.json',
    fetch: async () => ({ ok: true, status: 200, body: cuerpo, text: async () => ((entero = true), 'x'.repeat(10 * 1024 * 1024)) }),
  });
  const g = await grande.refrescar();
  assert.equal(g.fuente, 'no-disponible');
  assert.match(g.detalle!, /demasiado grande/);
  assert.equal(entero, false, 'no se leyó el cuerpo entero');
  assert.equal(cancelado, true, 'la descarga se canceló');
  assert.ok(leidos <= O.TOPE_FICHA_BYTES + 2 * TROZO, `leídos ${leidos} bytes`);
  // Justo en el tope, sí se acepta.
  const justa = JSON.stringify(FICHA);
  const cabe = JSON.stringify({ ...FICHA, relleno: 'x'.repeat(O.TOPE_FICHA_BYTES - justa.length - 13) });
  assert.equal(Buffer.byteLength(cabe), O.TOPE_FICHA_BYTES);
  respuesta = { cuerpo: cabe };
  assert.equal((await new O.FuenteOta({ url: URL_FICHA }).refrescar()).fuente, 'release');
});

/* ------------------------------------------------------------------ la ruta, con la ficha de mentira (por la variable) */

process.env.AURA_OTA_MANIFIESTO_URL = URL_FICHA;
const almacen = almacenEnMemoria();
const app = express();
const pasa = () => ((_q: express.Request, _s: express.Response, n: express.NextFunction) => n()) as express.RequestHandler;
const cuentaDe = (req: express.Request) => sesionDe(req)?.correo?.toLowerCase() || null;
montarRecepcion(app, { cuentaDe, almacen });
montarRutaBuild(app, {
  exigirMesa,
  limitar: pasa,
  cuentaDe,
  almacen,
  manifiesto: async () => ({ commit: 'c0ffee0', web: { sha: 'desconocido', hora: null } }) as any,
  almacenSalud: async () => ({ ok: true, tipo: 'memoria', multiReplica: false, lectura: true, escritura: true, ms: 1, comprobado: t }),
});
app.get('/api/eco', (_req, res) => res.json({ ok: true }));
const srv = app.listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
after(() => srv.close());

const jose = emitirSesion({ correo: 'jose@x.com', nombre: 'José', rol: 'Junta' }, { comunidad: true }).token;
const cab = (rt: string, u: string, e: 0 | 1, i: string) => `v1;p=android;v=5.3.0;bc=53;rt=${rt};u=${u};c=production;e=${e};os=14;i=${i}`;

test('ruta: /api/build compara cada teléfono con la ficha publicada (AURA_OTA_MANIFIESTO_URL, con redirección)', async () => {
  respuesta = { cuerpo: JSON.stringify(FICHA) };
  const telefonos = [cab(RT, OTA, 0, 'tel-al-dia-01'), cab(RT, EMBEBIDA, 1, 'tel-fabrica-01'), cab(RT_VIEJO, EMBEBIDA, 1, 'tel-apk-vieja')];
  for (const [n, h] of telefonos.entries()) {
    await fetch(`${base}/api/eco`, { headers: { 'x-ultron-sesion': jose, 'x-aura-cliente': h } });
    for (let k = 0; k < 50; k++) {
      const l = await R.clientesDe('jose@x.com', almacen);
      if (l.ok && l.clientes.length > n) break;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  const j: any = await (await fetch(`${base}/api/build`, { headers: { 'x-ultron-sesion': jose } })).json();
  assert.equal(j.recepcion.otaFuente, 'release');
  assert.equal(j.recepcion.esperado.ota.length, 1, 'solo lo publicado de AU-RA (la de Dr Electrum no es de este despliegue)');
  assert.equal(j.recepcion.esperado.ota[0].androidUpdateId, OTA);
  assert.ok(j.recepcion.esperado.ota.every((p: any) => p.plataforma === 'ultron'));
  assert.match(j.recepcion.evidencia, /^declarada/);
  const por = (rt: string, e: boolean) => j.clientes.find((c: any) => c.runtime === rt && c.embebido === e);
  assert.deepEqual([por(RT, false).recibido, por(RT, false).motivo, por(RT, false).esperado], ['sí', 'ota-recibida', OTA]);
  assert.deepEqual([por(RT, true).recibido, por(RT, true).motivo], ['no', 'embebido-sin-ota']);
  assert.deepEqual([por(RT_VIEJO, true).recibido, por(RT_VIEJO, true).esperado], ['no', 'otro-runtime']);
  assert.ok(j.clientes.every((c: any) => c.evidencia === 'declarada' && typeof c.explicacion === 'string'));
});

test('ruta: si la ficha deja de responder, /api/build no se frena y sigue con la última buena (no-disponible)', async () => {
  // Que la del proceso caduque: el reloj no se puede mover desde aquí, así que se prueba con una fuente propia.
  let reloj = 5_000_000;
  const fuente = new O.FuenteOta({ url: URL_FICHA, ahora: () => reloj });
  respuesta = { cuerpo: JSON.stringify(FICHA) };
  await fuente.refrescar();
  const app2 = express();
  montarRutaBuild(app2, {
    exigirMesa,
    limitar: pasa,
    cuentaDe,
    almacen,
    ota: fuente,
    manifiesto: async () => ({ commit: 'c0ffee0', web: { sha: 'desconocido', hora: null } }) as any,
    almacenSalud: async () => ({ ok: true, tipo: 'memoria', multiReplica: false, lectura: true, escritura: true, ms: 1, comprobado: t }),
  });
  const s2 = app2.listen(0, '127.0.0.1');
  await new Promise((r) => s2.once('listening', r));
  try {
    const b2 = `http://127.0.0.1:${(s2.address() as AddressInfo).port}`;
    reloj += O.CACHE_OTA_MS;
    respuesta = { status: 500, cuerpo: 'error', lento: 2000 };
    const t0 = Date.now();
    const j: any = await (await fetch(`${b2}/api/build`, { headers: { 'x-ultron-sesion': jose } })).json();
    assert.ok(Date.now() - t0 < 1000, `no esperó la descarga (${Date.now() - t0} ms)`);
    assert.equal(j.recepcion.otaFuente, 'release', 'contestó con lo guardado mientras refresca');
    await fuente.refrescar();
    const j2: any = await (await fetch(`${b2}/api/build`, { headers: { 'x-ultron-sesion': jose } })).json();
    assert.equal(j2.recepcion.otaFuente, 'no-disponible');
    assert.ok(j2.recepcion.otaDetalle);
    assert.equal(j2.clientes.find((c: any) => c.runtime === RT && c.embebido === false).recibido, 'sí', 'con la última buena sigue comparando');
    // Sin ninguna buena: desconocido.
    const nunca = new O.FuenteOta({ url: 'off' });
    const app3 = express();
    montarRutaBuild(app3, { exigirMesa, limitar: pasa, cuentaDe, almacen, ota: nunca, manifiesto: async () => ({ commit: 'x', web: { sha: 'desconocido', hora: null } }) as any, almacenSalud: async () => ({}) as any });
    const s3 = app3.listen(0, '127.0.0.1');
    await new Promise((r) => s3.once('listening', r));
    const j3: any = await (await fetch(`http://127.0.0.1:${(s3.address() as AddressInfo).port}/api/build`, { headers: { 'x-ultron-sesion': jose } })).json();
    s3.close();
    assert.equal(j3.recepcion.esperado.ota, 'desconocido');
    assert.ok(j3.clientes.filter((c: any) => c.plataforma === 'android').every((c: any) => c.recibido === 'desconocido' && c.motivo === 'ficha-no-disponible'));
  } finally {
    s2.close();
  }
});

/* ------------------------------------------------------------------ el script del flujo */

const EAS = [
  { id: OTA.toUpperCase(), createdAt: '2026-10-05T12:00:00.000Z', group: GRUPO, branch: 'production', message: 'x', runtimeVersion: RT, platform: 'android', manifestPermalink: 'https://u.expo.dev/x', isRollBackToEmbedded: false, gitCommitHash: COMMIT },
];

test('script: la entrada sale de `eas update --json` y el servidor la acepta tal cual', () => {
  const { entrada, avisos } = S.entradaDesdeEas(EAS, { variante: 'ultron', canal: 'production', runtime: RT, commit: COMMIT });
  assert.deepEqual(avisos, []);
  assert.deepEqual(entrada, pub());
  assert.deepEqual(O.validarPublicacion(entrada), pub(), 'misma forma que valida el servidor');
  const otroRt = S.entradaDesdeEas(EAS, { variante: 'ultron', canal: 'production', runtime: RT_VIEJO, commit: COMMIT });
  assert.equal(otroRt.entrada.runtimeVersion, RT, 'vale el runtime con que publicó EAS');
  assert.equal(otroRt.avisos.length, 1, 'y avisa de la diferencia');
  assert.throws(() => S.entradaDesdeEas([], { variante: 'ultron', canal: 'production', runtime: RT, commit: COMMIT }), /Android/);
  assert.throws(() => S.entradaDesdeEas([{ ...EAS[0], id: 'x' }], { variante: 'ultron', canal: 'production', runtime: RT, commit: COMMIT }), /updateId/);
  assert.throws(() => S.entradaDesdeEas(EAS, { variante: 'otra', canal: 'production', runtime: RT, commit: COMMIT }), /variante/);
  const sinGrupo = S.entradaDesdeEas([{ ...EAS[0], group: undefined }], { variante: 'ultron', canal: 'production', runtime: RT, commit: COMMIT });
  assert.equal(sinGrupo.entrada.grupo, null, 'el grupo es informativo');
  const atras = S.entradaEmbebida({ variante: 'electrum', canal: 'production', runtime: RT_ELECTRUM, commit: COMMIT, ahora: t });
  assert.equal(O.validarPublicacion(atras)!.tipo, 'embebido');
});

test('script: fusionar reemplaza la misma app+canal+runtime, conserva la otra app y guarda pocos runtimes', () => {
  const previa = FICHA;
  const nueva = pub({ androidUpdateId: OTA_VIEJA, publicado: '2026-10-05T15:00:00.000Z' });
  const f = S.fusionar(previa, [nueva], t);
  assert.equal(f.publicaciones.length, 2, 'la de ultron se reemplazó; electrum sigue');
  assert.equal(f.publicaciones[0].androidUpdateId, OTA_VIEJA);
  assert.equal(f.publicaciones[1].plataforma, 'electrum');
  assert.ok(O.validarManifiestoOta(f), 'el servidor acepta la ficha fusionada');
  let g: any = null;
  for (let n = 0; n < 8; n++) g = S.fusionar(g, [pub({ runtimeVersion: `rt${n}`, publicado: new Date(Date.UTC(2026, 9, 1 + n)).toISOString() })], t);
  assert.equal(g.publicaciones.length, S.MAX_RUNTIMES);
  assert.equal(g.publicaciones[0].runtimeVersion, 'rt7');
  assert.throws(() => S.fusionar(null, [{ plataforma: 'ultron' }]), /inválida/);
  assert.equal(S.fusionar({ publicaciones: [{ roto: true }] }, [nueva], t).publicaciones.length, 1, 'lo roto de antes se descarta');
});

test('script: por línea de órdenes, como lo llama el flujo', () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'ota-ficha-'));
  try {
    fs.writeFileSync(path.join(dir, 'eas.json'), JSON.stringify(EAS));
    const script = path.resolve('scripts/qa/manifiesto-ota.mjs');
    const entrada = execFileSync(process.execPath, [script, 'entrada', '--variante', 'ultron', '--canal', 'production', '--runtime', RT, '--commit', COMMIT, '--eas', path.join(dir, 'eas.json')], { encoding: 'utf8' });
    fs.writeFileSync(path.join(dir, 'ota-ultron.json'), entrada);
    fs.writeFileSync(path.join(dir, 'actual.json'), JSON.stringify(FICHA));
    execFileSync(process.execPath, [script, 'fusionar', '--actual', path.join(dir, 'actual.json'), '--salida', path.join(dir, 'ota-aura.json'), path.join(dir, 'ota-ultron.json')]);
    const m = O.validarManifiestoOta(JSON.parse(fs.readFileSync(path.join(dir, 'ota-aura.json'), 'utf8')))!;
    assert.deepEqual(
      m.publicaciones.map((p) => p.plataforma),
      ['ultron', 'electrum']
    );
    // Una salida de eas sin lo esperado: código 1 (el paso queda en rojo).
    fs.writeFileSync(path.join(dir, 'malo.json'), '[]');
    assert.throws(() => execFileSync(process.execPath, [script, 'entrada', '--variante', 'ultron', '--canal', 'production', '--runtime', RT, '--commit', COMMIT, '--eas', path.join(dir, 'malo.json')], { stdio: 'pipe' }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ el flujo */

/** El YAML del flujo como objeto (PyYAML, que está en los runners de GitHub y aquí). */
function leerFlujo(ruta: string): any | null {
  try {
    return JSON.parse(execFileSync('python3', ['-c', 'import json,sys,yaml;print(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf-8"))))', ruta], { encoding: 'utf8' }));
  } catch {
    return null;
  }
}

test('flujo: ota.yml publica con --json, arma la ficha y la sube a «aura-ota» desde un trabajo aparte con contents: write', (c) => {
  const w = leerFlujo('.github/workflows/ota.yml');
  if (!w) return c.skip('sin python3 + PyYAML');
  assert.deepEqual(w.permissions, { contents: 'read' }, 'por omisión, solo lectura');
  const ota = w.jobs.ota;
  assert.ok(!ota.permissions || ota.permissions.contents !== 'write', 'el trabajo con npm y el token de Expo no escribe en el repo');
  const publicar = ota.steps.find((s: any) => s.name === 'Publicar OTA');
  assert.match(publicar.run, /--json > "\$RUNNER_TEMP\/eas-update\.json"/);
  const fichaPaso = ota.steps.find((s: any) => /Ficha de la OTA/.test(s.name || ''));
  assert.match(fichaPaso.run, /manifiesto-ota\.mjs entrada/);
  assert.ok(ota.steps.some((s: any) => String(s.uses || '').startsWith('actions/upload-artifact') && /ficha-ota-/.test(s.with?.name || '')));
  const ficha = w.jobs.ficha;
  assert.deepEqual(ficha.permissions, { contents: 'write' });
  assert.equal(ficha.needs, 'ota');
  const subir = ficha.steps.find((s: any) => /gh release upload aura-ota ota-aura\.json --clobber/.test(s.run || ''));
  assert.ok(subir, 'el paso que sube la ficha');
  assert.match(subir.run, /set -euo pipefail/, 'si la subida falla, rojo');
  assert.match(subir.run, /--latest=false/, 'el Release de la ficha no le quita «latest» al de las APK');
  assert.equal(subir.env.GH_TOKEN, '${{ github.token }}');
  assert.ok(!JSON.stringify(ficha).includes('EXPO_TOKEN'), 'el trabajo que escribe no ve el token de Expo');
});
