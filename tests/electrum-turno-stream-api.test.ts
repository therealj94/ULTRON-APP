/**
 * EL TURNO EN VIVO DE DR ELECTRUM CONTRA EL SERVIDOR COMPILADO (hace falta `npm run build`), con un nodo de mentira:
 *
 *  · /api/electrum/turno/stream suelta la respuesta como eventos `frase` {i, texto, voz} y el `fin` dice cuántas
 *    salieron (`frases`), con el texto de autoridad;
 *  · un reintento con el mismo `idTurno` (por el stream o por el JSON) recibe la misma respuesta sin volver a pensar;
 *  · /api/electrum/voz/pcm existe, con la puerta de Electrum.
 */
import './datos-prueba'; // la junta inventada de las pruebas (lo real vive en Render)
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';

const SERVIDOR = path.join(process.cwd(), 'build-server', 'server.cjs');
// Con lo que el pulidor de la voz quita («¡Excelente pregunta!», los números de la lista, «En resumen,»): el final no
// puede volver a decir lo que ya sonó (antes se terminaba con la voz pulida y la cuenta no calzaba).
const RESPUESTA = '¡Excelente pregunta! Clavo Rico tiene 120 ha [D99-p1]. Está vigente hasta 2027:\n1. No tiene traslapes.\n2. Paga su canon al día.\nEn resumen, está en regla.';
let llamadasAlNodo = 0;
const nodo = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/salud') return res.end(JSON.stringify({ ok: true }));
    llamadasAlNodo++;
    res.end(JSON.stringify({ message: { role: 'assistant', content: RESPUESTA } }));
  });
});
await new Promise<void>((r) => nodo.listen(0, '127.0.0.1', r));
const dirDurable = fs.mkdtempSync(path.join(os.tmpdir(), 'electrum-stream-'));
after(() => {
  nodo.close();
  fs.rmSync(dirDurable, { recursive: true, force: true });
});

type Evento = { evento: string; datos: any };
function leerSse(cuerpo: string): Evento[] {
  return cuerpo
    .split('\n\n')
    .filter((b) => b.trim())
    .map((b) => {
      const evento = /^event: (.+)$/m.exec(b)?.[1] || '';
      const datos = /^data: (.+)$/m.exec(b)?.[1] || 'null';
      return { evento, datos: JSON.parse(datos) };
    });
}

test('el turno en vivo de Electrum: frases, fin.frases e idTurno', { skip: fs.existsSync(SERVIDOR) ? false : 'sin build-server/server.cjs' }, async (t) => {
  const puerto = 7900 + Math.floor(Math.random() * 40);
  const base = `http://127.0.0.1:${puerto}`;
  const secreto = 'secreto-electrum-stream';
  const proc: ChildProcess = spawn('node', [SERVIDOR], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(puerto),
      PLATAFORMA: '',
      ELECTRUM_DB_URL: '',
      ELECTRUM_CEREBRO: 'qwen',
      ULTRON_NODO_URL: `http://127.0.0.1:${(nodo.address() as AddressInfo).port}`,
      ULTRON_NODO_SECRETO: 'prueba',
      ULTRON_SESION_SECRETO: secreto,
      ULTRON_MEMORIA_BUCKET: '',
      ULTRON_DURABLE_DIR: dirDurable,
      AWS_ACCESS_KEY_ID: '',
      AWS_SECRET_ACCESS_KEY: '',
      VOICEBOX_URL: '',
      ELEVENLABS_API_KEY: '',
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
  for (let i = 0; i < 80 && !listo; i++) {
    listo = await fetch(`${base}/electrum.html`).then((r) => r.ok).catch(() => false);
    if (!listo) await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(listo, 'el servidor no levantó');

  const at = Date.now();
  const cuerpo = Buffer.from(JSON.stringify({ correo: 'j.herrera@ordenglobal.org', nombre: 'José', rol: 'Junta', at, exp: at + 3_600_000 })).toString('base64url');
  const sesion = `u1.${cuerpo}.${crypto.createHmac('sha256', secreto).update(cuerpo).digest('base64url')}`;
  const h = { 'x-ultron-sesion': sesion, 'Content-Type': 'application/json' };
  const pedido = { mensaje: '¿Cuántas hectáreas tiene Clavo Rico?', idTurno: `e2e-${crypto.randomBytes(6).toString('hex')}` };

  const r1 = await fetch(`${base}/api/electrum/turno/stream`, { method: 'POST', headers: h, body: JSON.stringify(pedido) });
  assert.equal(r1.status, 200);
  const ev1 = leerSse(await r1.text());
  const frases = ev1.filter((e) => e.evento === 'frase').map((e) => e.datos);
  const fin = ev1.find((e) => e.evento === 'fin')?.datos;
  assert.ok(fin, JSON.stringify(ev1));
  assert.ok(frases.length >= 2, JSON.stringify(ev1));
  assert.deepEqual(
    frases.map((f) => f.i),
    frases.map((_, i) => i)
  );
  assert.equal(fin.frases, frases.length, 'el fin dice cuántas frases salieron');
  assert.ok(ev1.findIndex((e) => e.evento === 'fin') > ev1.findIndex((e) => e.evento === 'frase'), 'las frases antes del fin');
  for (const f of frases) {
    assert.doesNotMatch(f.texto, /\[D\d+/, 'sin códigos de cita sin verificar');
    assert.doesNotMatch(f.voz, /\[|\]/);
  }
  const dicho = frases.map((f) => f.voz).join(' ');
  assert.match(dicho, /Clavo Rico tiene 120 ha\. Está vigente hasta 2027:/);
  assert.equal(dicho.split('Clavo Rico').length - 1, 1, `nada se dice dos veces: ${dicho}`);
  assert.equal(dicho.split('canon').length - 1, 1, `nada se dice dos veces: ${dicho}`);
  assert.doesNotMatch(dicho, /Excelente pregunta/);
  assert.ok(!frases.some((f) => /^\s*\d+[.)]\s*$/.test(f.texto)), 'el número de la lista va con su frase');
  assert.ok(frases.some((f) => f.texto === '1. No tiene traslapes.' && f.voz === 'No tiene traslapes.'), JSON.stringify(frases));
  assert.match(fin.texto, /vigente hasta 2027/, 'el texto de autoridad');
  const llamadas = llamadasAlNodo;
  assert.ok(llamadas >= 1);

  // El reintento con el mismo idTurno: la misma respuesta, sin pensar otra vez.
  const r2 = await fetch(`${base}/api/electrum/turno/stream`, { method: 'POST', headers: h, body: JSON.stringify(pedido) });
  const ev2 = leerSse(await r2.text());
  const fin2 = ev2.find((e) => e.evento === 'fin')?.datos;
  assert.equal(fin2.repetido, true);
  assert.equal(fin2.texto, fin.texto);
  assert.equal(fin2.frases, ev2.filter((e) => e.evento === 'frase').length);
  // Las MISMAS frases que salieron en vivo (número y texto): quien ya oyó las primeras no oye otras partidas de otro modo.
  assert.deepEqual(
    ev2.filter((e) => e.evento === 'frase').map((e) => e.datos),
    frases
  );
  assert.equal(llamadasAlNodo, llamadas, 'no se corrió el agente dos veces');

  // Y por el JSON (el respaldo de la app cuando el stream se cae), igual.
  const r3: any = await (await fetch(`${base}/api/electrum/turno`, { method: 'POST', headers: h, body: JSON.stringify(pedido) })).json();
  assert.equal(r3.repetido, true);
  assert.equal(r3.texto, fin.texto);
  assert.equal(r3.frasesDichas, undefined, 'las frases guardadas no van en el JSON');
  assert.equal(llamadasAlNodo, llamadas);

  // Otro id: otro turno.
  await (await fetch(`${base}/api/electrum/turno`, { method: 'POST', headers: h, body: JSON.stringify({ ...pedido, idTurno: `${pedido.idTurno}-b` }) })).json();
  assert.ok(llamadasAlNodo > llamadas);

  // La voz PCM de Electrum: con su puerta, y sin voz en este servidor, un 503 honesto (no un 404).
  const sinPuerta = await fetch(`${base}/api/electrum/voz/pcm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: 'Hola.' }) });
  assert.equal(sinPuerta.status, 401);
  const vacio = await fetch(`${base}/api/electrum/voz/pcm`, { method: 'POST', headers: h, body: JSON.stringify({ texto: '[risa]' }) });
  assert.equal(vacio.status, 400);
  const pcm = await fetch(`${base}/api/electrum/voz/pcm`, { method: 'POST', headers: h, body: JSON.stringify({ texto: 'Clavo Rico está vigente.', personaje: 'chema', primera: true }) });
  assert.equal(pcm.status, 503);
  assert.equal(((await pcm.json()) as any).honesto, true);
  // Por GET, con la query (el reproductor nativo de la APK), con la misma puerta.
  const q = `texto=${encodeURIComponent('Clavo Rico está vigente.')}&idioma=es&personaje=tatiana&primera=1&emocion=neutral`;
  assert.equal((await fetch(`${base}/api/electrum/voz/pcm?${q}`)).status, 401);
  assert.equal((await fetch(`${base}/api/electrum/voz/pcm?texto=`, { headers: { 'x-ultron-sesion': sesion } })).status, 400);
  assert.equal((await fetch(`${base}/api/electrum/voz/pcm?${q}`, { headers: { 'x-ultron-sesion': sesion } })).status, 503);
});
