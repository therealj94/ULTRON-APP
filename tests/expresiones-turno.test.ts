/**
 * Las expresiones de voz de punta a punta: un nodo de mentira contesta como el 27B, con [risa] y
 * [suspiro] en medio, y se mira lo que sale del servidor. Lo que se LEE (`reply`, `text`) no las lleva
 * nunca; lo que se DICE (`voz`) sí, en su sitio. Dr Electrum no las enseña aunque su modelo las escriba.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const RESPUESTA = '[EMO:risa] Ay, José, no me digas. [risa] Esa no me la sabía. ¿Y ahora qué hacemos? [suspiro] Bueno, vamos por partes.';
const DICHO = 'Ay, José, no me digas. [risa] Esa no me la sabía. ¿Y ahora qué hacemos? [suspiro] Bueno, vamos por partes.';
const LEIDO = 'Ay, José, no me digas. Esa no me la sabía. ¿Y ahora qué hacemos? Bueno, vamos por partes.';

/** Contesta como Ollama: NDJSON a trozos de nueve letras si piden stream (parte las etiquetas), JSON si no. */
const srv = http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (c) => (cuerpo += c));
  req.on('end', () => {
    const j = JSON.parse(cuerpo || '{}');
    if (j.stream) {
      res.setHeader('Content-Type', 'application/x-ndjson');
      for (const t of RESPUESTA.match(/.{1,9}/gs) || []) res.write(JSON.stringify({ message: { content: t }, done: false }) + '\n');
      return res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n');
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: { content: RESPUESTA } }));
  });
});
await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
process.env.ULTRON_NODO_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
process.env.ULTRON_NODO_SECRETO = 'prueba';
after(() => srv.close());

test('Dr Electrum: si su modelo escribe una expresión, no llega a la pantalla', async () => {
  const { turnoElectrum } = await import('../server/electrum/turno');
  const salida = await turnoElectrum('¿cuándo vence Cerro Partido?', {
    quien: null,
    nivel: 'lee',
    plataforma: 'electrum',
    canal: 'mesa',
    mensaje: '¿cuándo vence Cerro Partido?',
  });
  assert.ok(!/\[/.test(salida.texto), salida.texto);
  assert.match(salida.texto, /Esa no me la sabía\. ¿Y ahora qué hacemos\? Bueno, vamos por partes\./);
});

const SERVIDOR = path.join(process.cwd(), 'dist', 'server.cjs');

test('servidor de AU-RA: se lee sin etiquetas y se dice con ellas', { skip: fs.existsSync(SERVIDOR) ? false : 'sin dist/server.cjs: correr `npm run build` antes' }, async (t) => {
  const puerto = 7900 + Math.floor(Math.random() * 60);
  const base = `http://127.0.0.1:${puerto}`;
  const proc: ChildProcess = spawn('node', [SERVIDOR], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(puerto),
      PLATAFORMA: 'ultron',
      ULTRON_NODO_URL: process.env.ULTRON_NODO_URL,
      ULTRON_NODO_SECRETO: 'prueba',
      MODELO_CHICO_URL: '',
      TELEGRAM_BOT_TOKEN: '',
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
    try {
      listo = (await fetch(`${base}/api/health`)).ok;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  assert.ok(listo, 'el servidor no levantó');
  const pedir = (ruta: string) =>
    fetch(`${base}${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'contame qué pasó con la reunión de ayer en la oficina' }) });

  await t.test('/api/turno: `reply` para leer, `voz` para decir', async () => {
    const r = await pedir('/api/turno');
    assert.equal(r.status, 200);
    const j: any = await r.json();
    assert.equal(j.reply, LEIDO);
    assert.equal(j.voz, DICHO);
    assert.equal(j.emocion, 'risa');
  });

  await t.test('/api/turno/stream: cada trozo sale limpio en `text` y con su expresión en `voz`', async () => {
    const r = await pedir('/api/turno/stream');
    assert.equal(r.status, 200);
    const eventos = (await r.text())
      .split('\n\n')
      .map((b) => ({ ev: /^event: (\w+)/m.exec(b)?.[1], data: /^data: (.*)$/m.exec(b)?.[1] }))
      .filter((e) => e.ev && e.data)
      .map((e) => ({ ev: e.ev!, data: JSON.parse(e.data!) }));
    const deltas = eventos.filter((e) => e.ev === 'delta').map((e) => e.data);
    assert.ok(deltas.length >= 2);
    for (const d of deltas) assert.ok(!/\[/.test(d.text), `se vería: ${d.text}`);
    assert.equal(deltas.map((d) => d.text).join('').trim(), LEIDO, 'una APK vieja que solo lee `text` no ve etiquetas');
    assert.equal(deltas.map((d) => d.voz).join('').trim(), DICHO, 'la voz recibe las expresiones en su sitio');
    const fin = eventos.find((e) => e.ev === 'done')!.data;
    assert.equal(fin.reply, LEIDO);
    assert.equal(fin.voz, DICHO);
  });
});
