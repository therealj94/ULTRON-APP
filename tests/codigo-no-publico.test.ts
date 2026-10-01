/**
 * El código del servidor no se sirve.
 *
 * 1-oct: https://aura-fp.onrender.com/server.cjs (1,9 MB) y /server.cjs.map (3,8 MB, con el código
 * fuente entero) respondían 200: el build los escribía en dist/ y express.static sirve todo dist/.
 * Ahora el build los deja en build-server/, y el servidor responde 404 a cualquier .cjs o .map.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SERVIDOR = path.join(process.cwd(), 'build-server', 'server.cjs');
const PUERTO = 7811;
const BASE = `http://127.0.0.1:${PUERTO}`;
const hay = fs.existsSync(SERVIDOR);

test('el build no deja el servidor dentro de dist/ (lo que se sirve)', { skip: hay ? false : 'sin build-server/server.cjs: correr `npm run build` antes' }, () => {
  assert.equal(fs.existsSync(path.join(process.cwd(), 'dist', 'server.cjs')), false);
  assert.equal(fs.existsSync(path.join(process.cwd(), 'dist', 'server.cjs.map')), false);
});

test('servidor: /server.cjs, su sourcemap y cualquier .map responden 404', { skip: hay ? false : 'sin build-server/server.cjs: correr `npm run build` antes' }, async () => {
  let proc: ChildProcess | null = null;
  try {
    proc = spawn('node', [SERVIDOR], { env: { ...process.env, NODE_ENV: 'production', PORT: String(PUERTO) }, stdio: 'ignore', detached: true });
    let listo = false;
    for (let i = 0; i < 60 && !listo; i++) {
      try {
        listo = (await fetch(`${BASE}/`)).status < 500;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    assert.ok(listo, 'el servidor no levantó');
    for (const ruta of ['/server.cjs', '/server.cjs.map', '/importar-cubo.cjs', '/importar-cubo.cjs.map', '/assets/index.js.map']) {
      const r = await fetch(`${BASE}${ruta}`);
      assert.equal(r.status, 404, `${ruta} se sirve`);
    }
    // Lo de la web sigue sirviéndose.
    assert.equal((await fetch(`${BASE}/`)).status, 200);
  } finally {
    if (proc?.pid) {
      try {
        process.kill(-proc.pid);
      } catch {
        /* ya terminó */
      }
    }
  }
});
