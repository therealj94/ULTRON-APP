/**
 * Precalentar lo fijo en el nodo (lib/nodo.ts precalentarSistema): manda SOLO el system a /api/precalentar,
 * con el secreto, y nunca lanza aunque el nodo falle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

let recibido: any = null;
let responder = 200;
const srv = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    recibido = { ruta: req.url, secreto: req.headers['x-ultron-secreto'], cuerpo: JSON.parse(b || '{}') };
    res.writeHead(responder, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: responder === 200, leidas: 4, reusadas: 6000, ms: 210 }));
  });
});
await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
process.env.ULTRON_NODO_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
process.env.ULTRON_NODO_SECRETO = 'secreto-de-prueba';
const { precalentarSistema } = await import('../lib/nodo');

test.after(() => srv.close());

test('manda solo el system, con el secreto, a /api/precalentar', async () => {
  const r = await precalentarSistema('Eres AU-RA. Lo fijo.');
  assert.equal(recibido.ruta, '/api/precalentar');
  assert.equal(recibido.secreto, 'secreto-de-prueba');
  assert.deepEqual(recibido.cuerpo, { system: 'Eres AU-RA. Lo fijo.' });
  assert.equal(r?.reusadas, 6000);
});

test('con un mínimo, el mismo system no se repite; si el nodo falla, no lanza', async () => {
  recibido = null;
  await precalentarSistema('Otro system', 60_000);
  assert.ok(recibido);
  recibido = null;
  assert.equal(await precalentarSistema('Otro system', 60_000), null);
  assert.equal(recibido, null);
  responder = 500;
  assert.deepEqual(await precalentarSistema('Tercero'), { ok: false });
});
