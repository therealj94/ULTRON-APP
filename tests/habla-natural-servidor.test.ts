/**
 * HABLA NATURAL EN EL SERVIDOR DE VERDAD (lib/habla-natural.ts conectado en server.ts `soltar` y el `done`).
 *
 * El server.ts entero (tsx, carpeta temporal, sin llaves) contra un Bedrock FALSO que contesta lo que cada prueba
 * quiere, como tests/voz-presupuesto.test.ts. Se mira lo que de verdad sale por el stream (`delta` → la voz) y el
 * `done` (`voz` para quien no oyó el stream, `reply` para la pantalla):
 *  · un turno hablado sin fórmulas de asistente y con UNA etiqueta de voz;
 *  · nunca «soy una persona»: se dice la verdad en el personaje;
 *  · la segunda respuesta no abre con la misma muletilla que la primera;
 *  · un turno escrito (no hablado) sale tal cual, como siempre.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import http2 from 'node:http2';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { EventStreamCodec } from '@smithy/core/event-streams';
import { lineaHonesta } from '../lib/habla-natural';

const RAIZ = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-habla-natural-'));
const SECRETO = 'secreto-de-prueba-largo-para-el-servidor-habla-natural';
process.env.ULTRON_SESION_SECRETO = SECRETO;
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(tmp, 'cerradas-prueba.json');
process.env.ULTRON_MEMORIA_BUCKET = '';
const { emitirSesion } = await import('../server/seguridad');

const utf8 = { a: (b: Uint8Array) => Buffer.from(b).toString('utf8'), de: (s: string) => new Uint8Array(Buffer.from(s, 'utf8')) };
const codec = new EventStreamCodec(utf8.a, utf8.de);
const evento = (tipo: string, cuerpo: unknown) =>
  Buffer.from(
    codec.encode({
      headers: { ':message-type': { type: 'string', value: 'event' }, ':event-type': { type: 'string', value: tipo }, ':content-type': { type: 'string', value: 'application/json' } },
      body: utf8.de(JSON.stringify(cuerpo)),
    })
  );
let contestar: (ultimo: string) => string = () => '[EMO: neutral] Aquí estoy.';
const bedrock = http2.createServer((req, res) => {
  let c = '';
  req.on('data', (d) => (c += d));
  req.on('end', () => {
    const body = JSON.parse(c || '{}');
    const ultimo = String(body.messages?.at(-1)?.content?.[0]?.text || '');
    res.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream' });
    res.write(evento('messageStart', { role: 'assistant' }));
    for (const t of contestar(ultimo).match(/.{1,12}/gs) || []) res.write(evento('contentBlockDelta', { contentBlockIndex: 0, delta: { text: t } }));
    res.write(evento('contentBlockStop', { contentBlockIndex: 0 }));
    res.write(evento('messageStop', { stopReason: 'end_turn' }));
    res.end(evento('metadata', { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, metrics: { latencyMs: 1 } }));
  });
});
const nodo = http.createServer((req, res) => {
  let c = '';
  req.on('data', (d) => (c += d));
  req.on('end', () => {
    if (req.url === '/api/precalentar') return res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    if (!JSON.parse(c || '{}').stream) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ message: { content: '{}' } }));
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.end(JSON.stringify({ message: { content: '[EMO: neutral] Hola.' }, done: true }) + '\n');
  });
});
const laya = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => res.writeHead(503).end());
});
for (const s of [bedrock, nodo, laya] as Array<http.Server | http2.Http2Server>) await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
const puerto = (s: http.Server | http2.Http2Server) => (s.address() as AddressInfo).port;

const PORT = 8100 + Math.floor(Math.random() * 250);
const BASE = `http://127.0.0.1:${PORT}`;
const CORREO = 'jose.habla@ordenglobal.org';
let errores = '';
const proc: ChildProcess = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), '--import', path.join(RAIZ, 'tests', 'red-lenta.ts'), path.join(RAIZ, 'server.ts')], {
  cwd: tmp,
  env: {
    PATH: process.env.PATH || '',
    HOME: tmp,
    NODE_ENV: 'production',
    PORT: String(PORT),
    PLATAFORMA: 'ultron',
    ULTRON_SESION_SECRETO: SECRETO,
    ULTRON_SESIONES_CERRADAS_ARCHIVO: path.join(tmp, 'cerradas.json'),
    ULTRON_PERFILES_DIR: path.join(tmp, 'perfiles'),
    ULTRON_NODO_URL: `http://127.0.0.1:${puerto(nodo)}`,
    ULTRON_NODO_SECRETO: 'prueba',
    ULTRON_LAYA_URL: `http://127.0.0.1:${puerto(laya)}`,
    ULTRON_LAYA_CLAVE: 'laya-falsa',
    MODELO_CHICO_MODO: 'apagado',
    TSX_TSCONFIG_PATH: path.join(RAIZ, 'tsconfig.json'),
    RED_LENTA_MS: '50',
    CEREBRO_VOZ: 'nova',
    AWS_ACCESS_KEY_ID: 'AKIAPRUEBA',
    AWS_SECRET_ACCESS_KEY: 'prueba',
    AWS_REGION: 'us-west-2',
    AWS_ENDPOINT_URL_BEDROCK_RUNTIME: `http://127.0.0.1:${puerto(bedrock)}`,
    COMPUTADORA_URL: 'http://127.0.0.1:9',
    COMPUTADORA_CLAVE: 'x',
    ULTRON_PADRON: `jose | José | ${CORREO} | | ultron=lee`,
  },
  stdio: ['ignore', 'ignore', 'pipe'],
  detached: true,
});
proc.stderr?.on('data', (d) => (errores = (errores + d).slice(-4000)));
after(() => {
  try {
    process.kill(-proc.pid!);
  } catch {
    /* ya se fue */
  }
  for (const s of [nodo, laya]) {
    s.closeAllConnections?.();
    s.close();
  }
  bedrock.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
let listo = false;
for (let i = 0; i < 240 && !listo; i++) {
  try {
    listo = (await fetch(`${BASE}/api/health`)).ok;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}
const yo = emitirSesion({ correo: CORREO, nombre: 'José', rol: 'Junta' });
const h = { 'content-type': 'application/json', 'x-ultron-sesion': yo.token, 'x-aura-origen': 'app', 'x-aura-aparato': 'aparato-habla' };

async function turno(message: string, extra: Record<string, unknown> = {}) {
  const r = await fetch(`${BASE}/api/turno/stream`, { method: 'POST', headers: h, body: JSON.stringify({ message, hablado: true, idioma: 'es', avatar: 'aura', ...extra }) });
  const txt = await r.text();
  let dicho = '';
  let done: any = null;
  for (const b of txt.split('\n\n')) {
    const ev = /^event: (\w+)/m.exec(b)?.[1];
    const data = /^data: (.*)$/m.exec(b)?.[1];
    if (!ev || data === undefined) continue;
    const d = JSON.parse(data);
    if (ev === 'delta') dicho += String(d.voz ?? d.text ?? '');
    if (ev === 'replace') dicho = String(d.voz ?? d.text ?? '');
    if (ev === 'done') done = d;
  }
  return { dicho: dicho.trim(), done };
}

test('el servidor levanta', () => {
  assert.ok(listo, `no levantó: ${errores}`);
});

test('turno hablado: sin fórmulas de asistente, una sola etiqueta de voz; el done dice lo mismo', { skip: !listo }, async () => {
  contestar = () => '[EMO: feliz] ¡Excelente pregunta! La reunión con Beto quedó para las tres de la tarde. [risa] [suspiro] ¿En qué más te puedo ayudar?';
  const { dicho, done } = await turno('¿A qué hora quedó lo de Beto?');
  assert.equal(dicho, 'La reunión con Beto quedó para las tres de la tarde. [risa]');
  assert.equal(String(done?.voz || ''), dicho);
  assert.equal(String(done?.reply || ''), 'La reunión con Beto quedó para las tres de la tarde.');
});

test('nunca «soy una persona»: se dice la verdad, en el personaje', { skip: !listo }, async () => {
  contestar = () => '[EMO: feliz] Jaja, sí, soy una persona de verdad. ¿Por qué lo preguntas?';
  const { dicho, done } = await turno('¿Vos sos una persona de verdad?');
  assert.equal(dicho, `${lineaHonesta('aura', 'es')} ¿Por qué lo preguntas?`);
  assert.doesNotMatch(String(done?.reply || ''), /soy una persona/);
});

test('la siguiente respuesta no abre con la misma muletilla', { skip: !listo }, async () => {
  contestar = () => '[EMO: neutral] Mira, lo de la mina va avanzando con los permisos.';
  const uno = await turno('¿Cómo va lo de la mina?');
  assert.equal(uno.dicho, 'Mira, lo de la mina va avanzando con los permisos.');
  contestar = () => '[EMO: neutral] Mira, la junta lo revisa el jueves por la tarde.';
  const dos = await turno('¿Y cuándo lo revisan?');
  assert.equal(dos.dicho, 'La junta lo revisa el jueves por la tarde.');
});

test('un turno escrito sale tal cual (el pulidor es solo de la voz)', { skip: !listo }, async () => {
  contestar = () => '[EMO: neutral] La junta es el jueves. ¿En qué más te puedo ayudar?';
  const { done } = await turno('¿Cuándo es la junta?', { hablado: false });
  assert.equal(String(done?.reply || ''), 'La junta es el jueves. ¿En qué más te puedo ayudar?');
});
