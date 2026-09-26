/**
 * EL TOPE DEL CANTO GENERADO (server/voz.ts).
 *
 * `orar` con tema y `cantar` con letra libre dejaban un mp3 por cada texto distinto en data/canto y
 * no se borraba nunca nada. La poda se queda con los más recientes y no toca lo que no generó ella:
 * un clip del repertorio o cualquier otro archivo de la carpeta sigue ahí.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { podarCanto, MAX_CANTO_GENERADO } from '../server/voz';

function hash(i: number) {
  return i.toString(16).padStart(16, '0');
}

test('se quedan los más recientes y el repertorio no se toca', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canto-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const base = Date.now() / 1000 - 10_000;
  const generados: string[] = [];
  for (let i = 0; i < 12; i++) {
    const n = i % 2 ? `oracion-${hash(i)}.mp3` : `${hash(i)}.mp3`;
    fs.writeFileSync(path.join(dir, n), 'mp3');
    // Fecha creciente: el 0 es el más viejo.
    fs.utimesSync(path.join(dir, n), base + i, base + i);
    generados.push(n);
  }
  // Lo que no es del generador, aunque sea más viejo que todo.
  const ajenos = ['jesus.mp3', 'waymaker.mp3', 'oracion.mp3', '.gitkeep', 'LEEME.txt'];
  for (const n of ajenos) {
    fs.writeFileSync(path.join(dir, n), 'x');
    fs.utimesSync(path.join(dir, n), base - 5_000, base - 5_000);
  }

  const borrados = podarCanto(dir, 5);
  assert.deepEqual(borrados.sort(), generados.slice(0, 7).sort(), 'se fueron los siete más viejos');
  const quedan = fs.readdirSync(dir).sort();
  assert.deepEqual(quedan, [...ajenos, ...generados.slice(7)].sort());
});

test('por debajo del tope no se borra nada, y una carpeta que no existe no rompe', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canto-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(dir, `${hash(i)}.mp3`), 'mp3');
  assert.deepEqual(podarCanto(dir, 5), []);
  assert.equal(fs.readdirSync(dir).length, 3);
  assert.deepEqual(podarCanto(path.join(dir, 'no-existe')), []);
});

test('el tope por omisión es razonable', () => {
  assert.equal(MAX_CANTO_GENERADO, 80);
});
