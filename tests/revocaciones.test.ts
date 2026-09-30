/**
 * Las sesiones cerradas no resucitan (server/seguridad.ts; auditoría A08).
 *
 * Antes, pasadas 5.000 revocaciones, se tiraban las que vencían antes AUNQUE no hubieran vencido: esos
 * tokens firmados volvían a valer. Ahora solo se podan las vencidas, y el cierre dice si quedó durable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revocaciones-'));
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(dir, 'cerradas.json');
process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-las-revocaciones';
process.env.ULTRON_MEMORIA_BUCKET = '';

const { emitirSesion, sesionDe, borrarSesion, cerrarSesion } = await import('../server/seguridad');

const pedido = (token: string) => ({ headers: { 'x-ultron-sesion': token }, query: {}, body: {} }) as any;

test('5.001 revocaciones: ninguna de las vigentes vuelve a valer', { timeout: 120_000 }, async () => {
  const tokens: string[] = [];
  for (let i = 0; i < 5001; i++) tokens.push(emitirSesion({ correo: `p${i}@prueba.local`, nombre: `P${i}`, rol: 'miembro' }).token);
  for (const t of tokens) assert.equal(await borrarSesion(t), true);
  const vivos = tokens.filter((t) => sesionDe(pedido(t)));
  assert.equal(vivos.length, 0, `${vivos.length} tokens cerrados volvieron a valer`);
  // Y lo guardado en disco las tiene todas (un reinicio no las olvida).
  const enDisco = JSON.parse(fs.readFileSync(process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO!, 'utf8'));
  assert.ok(Object.keys(enDisco).length >= 5001, String(Object.keys(enDisco).length));
});

test('el cierre dice si quedó durable (sin S3: el disco)', async () => {
  const s = emitirSesion({ correo: 'q@prueba.local', nombre: 'Q', rol: 'miembro' });
  assert.deepEqual(await cerrarSesion(s.token), { cerrada: true, durable: true });
  assert.equal(sesionDe(pedido(s.token)), null);
  // Sin poder escribir (la ruta es una carpeta), se cierra aquí igual pero se dice que no es durable.
  process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = dir;
  const s2 = emitirSesion({ correo: 'r@prueba.local', nombre: 'R', rol: 'miembro' });
  assert.deepEqual(await cerrarSesion(s2.token), { cerrada: true, durable: false });
  assert.equal(sesionDe(pedido(s2.token)), null);
  assert.deepEqual(await cerrarSesion('basura.sin.firma'), { cerrada: false, durable: false });
});
