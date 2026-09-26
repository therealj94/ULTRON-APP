/**
 * Un nodo que contesta 502 NO contestó.
 *
 * `pensarConQwen` leía el cuerpo del error como si fuera una respuesta: salía `{}`, el bucle lo
 * tomaba por un modelo que no dijo nada y el turno terminaba «contestó» con el texto EN BLANCO. La
 * pantalla ponía «No pude contestar» sin decir por qué, y por Telegram salía un mensaje vacío.
 * Visto de punta a punta contra el servidor compilado con un nodo de mentira que devolvía 502.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

let modo: 'caido' | 'mudo' = 'caido';
const srv = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    if (modo === 'caido') {
      res.writeHead(502, { 'Content-Type': 'text/html' });
      return res.end('<html><body>Bad gateway</body></html>');
    }
    // 200 con el mensaje vacío: el nodo vivo pero sin una palabra.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: { role: 'assistant', content: '' } }));
  });
});
await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
process.env.ULTRON_NODO_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
process.env.ULTRON_NODO_SECRETO = 'prueba';
after(() => srv.close());

const ctx = { quien: null, nivel: 'lee' as const, plataforma: 'electrum' as const, canal: 'mesa' as const, mensaje: 'hola' };

test('con el nodo en 502, el turno dice que no alcanzó el cerebro', async () => {
  const { turnoElectrum } = await import('../server/electrum/turno');
  modo = 'caido';
  const r = await turnoElectrum('hola, ¿estás?', ctx);
  assert.ok(r.texto.trim(), 'un turno no termina en blanco');
  assert.match(r.texto, /cerebro/i);
  assert.equal(r.fin, 'cerebro caído');
});

test('con el nodo vivo pero mudo, tampoco sale un globo vacío', async () => {
  const { turnoElectrum } = await import('../server/electrum/turno');
  modo = 'mudo';
  const r = await turnoElectrum('hola, ¿estás?', ctx);
  assert.ok(r.texto.trim(), 'un turno no termina en blanco');
  assert.match(r.texto, /No me salió ninguna respuesta/);
});
