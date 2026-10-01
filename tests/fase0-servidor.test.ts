/**
 * Fase 0 de seguridad, de punta a punta: el servidor de verdad (server.ts) arrancado SIN `NODE_ENV`,
 * como quedaría un despliegue al que se le olvidó la variable. Tiene que portarse como producción.
 *
 *  · 0.2: sin marca de desarrollo no hay Vite sirviendo el repo ni mesa abierta.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fase0-'));
const PORT = 7700 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;

let proc: ChildProcess;
let errores = '';

before(async () => {
  proc = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), path.join(RAIZ, 'server.ts')], {
    cwd: RAIZ,
    env: {
      // Solo lo que hace falta, y a propósito SIN NODE_ENV ni AURA_DEV.
      PATH: process.env.PATH || '',
      HOME: tmp,
      PORT: String(PORT),
      PLATAFORMA: 'ultron',
      ULTRON_SESIONES_CERRADAS_ARCHIVO: path.join(tmp, 'cerradas.json'),
      ULTRON_PERFILES_DIR: path.join(tmp, 'perfiles'),
      TSX_TSCONFIG_PATH: path.join(RAIZ, 'tsconfig.json'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  });
  proc.stderr?.on('data', (d) => (errores = (errores + d).slice(-4000)));
  let listo = false;
  for (let i = 0; i < 240 && !listo; i++) {
    try {
      listo = (await fetch(`${BASE}/api/health`)).ok;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  assert.ok(listo, `el servidor no levantó: ${errores}`);
});

after(() => {
  try {
    process.kill(-proc.pid!);
  } catch {
    /* ya se fue */
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('0.2 sin NODE_ENV: Vite no sirve el árbol del repo', async () => {
  for (const ruta of ['/lib/entorno.ts', '/@vite/client', '/server/seguridad.ts']) {
    const r = await fetch(`${BASE}${ruta}`);
    const cuerpo = await r.text();
    assert.ok(!/modoDesarrollo|import\.meta\.hot|exigirMesa/.test(cuerpo), `${ruta} salió como código (${r.status})`);
  }
});

test('0.2 sin NODE_ENV: la mesa y lo de la junta piden sesión', async () => {
  for (const ruta of ['/api/memoria', '/api/sistema', '/api/taller', '/api/vault/status']) {
    const r = await fetch(`${BASE}${ruta}`);
    assert.equal(r.status, 401, `${ruta} abrió sin sesión`);
  }
  const salud = (await (await fetch(`${BASE}/api/health`)).json()) as any;
  assert.equal(salud.cerebro, undefined, 'sin sesión, la salud no enseña los nodos');
  assert.equal(salud.qwen?.url, undefined);
});
