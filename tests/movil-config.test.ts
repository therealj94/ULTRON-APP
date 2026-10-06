/**
 * El interruptor remoto de la cámara en vivo del teléfono (server/movil-config.ts ↔ mobile/src/lib/camaraNativa.ts).
 *
 *  · AURA_CAMARA_RAPIDA=0 la apaga para todos (la app vuelve a la cámara de fotos sin APK nueva); sin nada, encendida.
 *  · Los números raros no pasan: ni del lado del servidor ni del teléfono.
 *  · La ruta pide sesión de mesa y no se cachea; el teléfono entiende exactamente lo que el servidor manda.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import type { AddressInfo } from 'node:net';

process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-movil-config';
process.env.ULTRON_MESA_CLAVE = 'clave-de-mesa-de-prueba-movil-config';
const { configMovil, montarConfigMovil } = await import('../server/movil-config');
const { exigirMesa, limitar } = await import('../server/seguridad');
const { configCamaraValida, ritmoNativo } = await import('../mobile/src/lib/camaraNativa');
const { asentirRemotoValido } = await import('../mobile/src/lib/asentir');

test('sin variables: la cámara nueva encendida y sin ajustes (los de fábrica del teléfono); las muletillas permitidas', () => {
  assert.deepEqual(configMovil({}), { camaraRapida: { activa: true }, asentir: { activo: true } });
});

test('AURA_ASENTIR=0 apaga las muletillas para todos sin APK, y el teléfono lo entiende (y no toca la cámara)', () => {
  for (const v of ['0', 'no', 'false', 'OFF', ' apagado ']) {
    const r = configMovil({ AURA_ASENTIR: v });
    assert.equal(r.asentir.activo, false, v);
    assert.equal(asentirRemotoValido({ ...r, honesto: true }), false, v);
    assert.equal(r.camaraRapida.activa, true);
  }
  for (const v of ['1', 'si', '', 'true']) assert.equal(asentirRemotoValido(configMovil({ AURA_ASENTIR: v })), true, v);
  assert.equal(asentirRemotoValido(null), true, 'sin dato (servidor viejo, sin red): permitidas');
  assert.equal(asentirRemotoValido({ camaraRapida: { activa: false } }), true, 'un servidor de antes de las muletillas');
  assert.equal(asentirRemotoValido({ asentir: { activo: 'no' } }), true, 'basura: lo de fábrica');
});

test('AURA_CAMARA_RAPIDA=0 (o no/false/off) la apaga; cualquier otra cosa la deja', () => {
  for (const v of ['0', 'no', 'false', 'OFF', ' apagada ']) assert.equal(configMovil({ AURA_CAMARA_RAPIDA: v }).camaraRapida.activa, false, v);
  for (const v of ['1', 'si', '', 'true']) assert.equal(configMovil({ AURA_CAMARA_RAPIDA: v }).camaraRapida.activa, true, v);
});

test('los números: dentro de rango y enteros, o no van', () => {
  assert.deepEqual(configMovil({ AURA_CAMARA_RAPIDA_LADO: '720', AURA_CAMARA_RAPIDA_HZ: '10', AURA_CAMARA_RAPIDA_FPS: '12' }).camaraRapida, { activa: true, ladoCorto: 720, hz: 10, fps: 12 });
  assert.deepEqual(configMovil({ AURA_CAMARA_RAPIDA_LADO: '5000', AURA_CAMARA_RAPIDA_HZ: '0', AURA_CAMARA_RAPIDA_FPS: '7.5' }).camaraRapida, { activa: true });
});

test('el teléfono entiende lo que manda el servidor (y nada más)', () => {
  const r = configMovil({ AURA_CAMARA_RAPIDA: '0', AURA_CAMARA_RAPIDA_LADO: '720' });
  assert.deepEqual(configCamaraValida({ ...r, honesto: true }), { activa: false, ladoCorto: 720 });
  assert.deepEqual(configCamaraValida(null), { activa: true }, 'sin dato (servidor viejo, sin red): encendida');
  assert.deepEqual(configCamaraValida({ camaraRapida: { activa: 'no', ladoCorto: 99999, hz: -1 } }), { activa: true }, 'basura: lo de fábrica');
  assert.deepEqual(ritmoNativo({ activa: true }, false), { hz: 15, fps: 15, ladoCorto: 480 });
  assert.deepEqual(ritmoNativo({ activa: true, ladoCorto: 720, hz: 8 }, false), { hz: 8, fps: 15, ladoCorto: 720 });
  assert.deepEqual(ritmoNativo({ activa: true }, true), { hz: 2, fps: 3, ladoCorto: 480 }, 'dormida: pocos cuadros');
});

const app = express();
montarConfigMovil(app, { exigirMesa, limitar, env: { AURA_CAMARA_RAPIDA: '0' } });
const servidor = app.listen(0);
const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
after(() => servidor.close());

test('GET /api/movil/config: con la clave de mesa contesta, sin caché; sin sesión, 401', async () => {
  const sin = await fetch(`${base}/api/movil/config`);
  assert.equal(sin.status, 401);
  const con = await fetch(`${base}/api/movil/config`, { headers: { 'x-ultron-mesa': process.env.ULTRON_MESA_CLAVE! } });
  assert.equal(con.status, 200);
  assert.equal(con.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await con.json(), { camaraRapida: { activa: false }, asentir: { activo: true }, honesto: true });
});

test('server.ts monta la ruta', () => {
  const src = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(src, /montarConfigMovil\(app, \{ exigirMesa, limitar \}\)/);
});
