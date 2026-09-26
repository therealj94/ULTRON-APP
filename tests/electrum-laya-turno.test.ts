/**
 * Laya en el turno y en la salud de Dr Electrum.
 *
 *  · El panel (Laya, `/decidir`) y la clasificación (`/v1/systemone`) son dos consultas que no
 *    dependen una de la otra, y el turno las hacía en serie: el tiempo de una se sumaba al de la
 *    otra antes de pensar nada. Ahora el panel se pide antes de esperar a la clasificación.
 *  · `/api/electrum/salud` dice si Laya está y si contesta; el detalle —tiempos, fallos, la sonda—
 *    solo a quien manda.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';

const llegadas: Record<string, number[]> = { decidir: [], systemone: [] };
const RETRASO_CLASIFICACION_MS = 500;

const laya = http.createServer((req, res) => {
  const ruta = String(req.url);
  req.resume();
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (ruta === '/salud') return res.end(JSON.stringify({ ok: true, umbral: 0.42, entrenado: '2026-09-20' }));
    if (ruta === '/decidir') {
      llegadas.decidir.push(Date.now());
      return res.end(JSON.stringify({ panel: ['geologo'], p: { geologo: 0.9 }, umbral: 0.42, ms: 4 }));
    }
    if (ruta === '/v1/systemone') {
      llegadas.systemone.push(Date.now());
      // La clasificación tarda: si el panel espera a que termine, llega medio segundo tarde.
      return setTimeout(() => res.end(JSON.stringify({})), RETRASO_CLASIFICACION_MS);
    }
    res.statusCode = 404;
    res.end('{}');
  });
});
const nodo = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/salud') return res.end(JSON.stringify({ ok: true }));
    res.end(JSON.stringify({ message: { role: 'assistant', content: 'La ley media no está en el catastro.' } }));
  });
});
await new Promise<void>((r) => laya.listen(0, '127.0.0.1', r));
await new Promise<void>((r) => nodo.listen(0, '127.0.0.1', r));
const URL_LAYA = `http://127.0.0.1:${(laya.address() as AddressInfo).port}`;
const URL_NODO = `http://127.0.0.1:${(nodo.address() as AddressInfo).port}`;
Object.assign(process.env, {
  ULTRON_LAYA_URL: URL_LAYA,
  ULTRON_LAYA_TIMEOUT_MS: '3000',
  LAYA_URL: URL_LAYA,
  LAYA_TIMEOUT_MS: '3000',
  CLASIFICADOR_MODO: 'laya',
  ULTRON_NODO_URL: URL_NODO,
  ULTRON_NODO_SECRETO: 'prueba',
});
after(() => {
  laya.close();
  nodo.close();
});

test('el panel se pide a Laya sin esperar a que termine la clasificación', async () => {
  const { turnoElectrum } = await import('../server/electrum/turno');
  llegadas.decidir.length = 0;
  llegadas.systemone.length = 0;
  const r = await turnoElectrum('¿qué ley media tiene la veta?', {
    quien: null,
    nivel: 'lee',
    plataforma: 'electrum',
    canal: 'mesa',
    mensaje: '¿qué ley media tiene la veta?',
  });
  assert.ok(r.texto, 'el turno contesta');
  assert.equal(llegadas.decidir.length, 1, 'se consultó el panel');
  assert.equal(llegadas.systemone.length, 1, 'se consultó la clasificación');
  const desfase = llegadas.decidir[0] - llegadas.systemone[0];
  assert.ok(
    desfase < RETRASO_CLASIFICACION_MS - 100,
    `el panel llegó ${desfase} ms después de empezar la clasificación: en serie serían más de ${RETRASO_CLASIFICACION_MS}`
  );
});

const SERVIDOR = path.join(process.cwd(), 'dist', 'server.cjs');

test('salud: Laya a todos por encima, el detalle solo a quien manda', { skip: fs.existsSync(SERVIDOR) ? false : 'sin dist/server.cjs' }, async (t) => {
  const puerto = 7860 + Math.floor(Math.random() * 30);
  const base = `http://127.0.0.1:${puerto}`;
  const secreto = 'secreto-salud-laya';
  const proc: ChildProcess = spawn('node', [SERVIDOR], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(puerto),
      PLATAFORMA: '',
      ELECTRUM_DB_URL: '',
      ELECTRUM_CLAVE: 'llave-de-la-demo',
      ULTRON_SESION_SECRETO: secreto,
      ULTRON_MEMORIA_BUCKET: '',
      AWS_ACCESS_KEY_ID: '',
      AWS_SECRET_ACCESS_KEY: '',
      VOICEBOX_URL: '',
    },
    stdio: 'ignore',
    detached: true,
  });
  t.after(() => {
    try {
      process.kill(-proc.pid!);
    } catch {
      /* ya se fue */
    }
  });
  let listo = false;
  for (let i = 0; i < 60 && !listo; i++) {
    listo = await fetch(`${base}/electrum.html`).then((r) => r.ok).catch(() => false);
    if (!listo) await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(listo, 'el servidor no levantó');

  const demo: any = await (await fetch(`${base}/api/electrum/salud`, { headers: { 'x-electrum-llave': 'llave-de-la-demo' } })).json();
  assert.deepEqual(demo.laya, { configurado: true, vivo: true }, 'a la llave de la demo, solo si está y si contesta');

  // José manda en Electrum en el padrón de arranque: una sesión firmada con el secreto del servidor.
  const at = Date.now();
  const cuerpo = Buffer.from(JSON.stringify({ correo: 'j.ordonez@ordenglobal.org', nombre: 'José', rol: 'Junta', at, exp: at + 3_600_000 })).toString('base64url');
  const sesion = `u1.${cuerpo}.${crypto.createHmac('sha256', secreto).update(cuerpo).digest('base64url')}`;
  const mando: any = await (await fetch(`${base}/api/electrum/salud`, { headers: { 'x-ultron-sesion': sesion } })).json();
  assert.equal(mando.nivel, 'mando');
  assert.equal(mando.laya.configurado, true);
  assert.equal(mando.laya.vivo, true);
  assert.equal(mando.laya.sonda?.ok, true);
  assert.equal(mando.laya.sonda?.umbral, 0.42);
  assert.ok('decisiones' in mando.laya && 'msMediana' in mando.laya, 'quien manda ve el detalle');
  assert.doesNotMatch(JSON.stringify(demo), new RegExp(URL_LAYA.replace(/[.:/]/g, '\\$&')), 'la dirección de Laya no sale');
});
