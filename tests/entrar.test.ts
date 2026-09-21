/**
 * La puerta de casa: `/api/ultron/entrar`.
 *
 * Esta prueba existe por un fallo que estuvo publicado y nadie vio: el servidor leía `clave` del
 * cuerpo y la app de Dr Electrum mandaba `password`, así que su pantalla de entrada contestaba
 * siempre «Correo y clave requeridos» con las credenciales correctas. Nunca llegó a funcionar.
 *
 * No se veía leyendo ninguno de los dos archivos por separado —los dos son razonables— y no había
 * prueba que los juntara. Se cayó al llenar el formulario en un navegador de verdad.
 *
 * Se comprueba contra el servidor compilado, levantado como en producción, porque el fallo estaba
 * exactamente en la costura entre el cliente y el servidor.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SERVIDOR = path.join(process.cwd(), 'dist', 'server.cjs');
const PUERTO = 7799;
const BASE = `http://127.0.0.1:${PUERTO}`;

const hay = fs.existsSync(SERVIDOR);
let proc: ChildProcess | null = null;

async function esperar(intentos = 40) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(`${BASE}/electrum.html`);
      if (r.ok) return true;
    } catch {
      /* todavía no levanta */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

test(
  'la puerta acepta lo que mandan los dos clientes',
  { skip: hay ? false : 'sin dist/server.cjs: correr `npm run build` antes' },
  async (t) => {
    proc = spawn('node', [SERVIDOR], {
      env: { ...process.env, NODE_ENV: 'production', PORT: String(PUERTO) },
      stdio: 'ignore',
      detached: true,
    });
    assert.ok(await esperar(), 'el servidor no levantó');

    const entrar = (cuerpo: unknown) =>
      fetch(`${BASE}/api/ultron/entrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });

    await t.test('con `clave`, como manda la web, no se rechaza por campo ausente', async () => {
      const r = await entrar({ correo: 'j.ordonez@ordenglobal.org', clave: 'lo-que-sea' });
      assert.notEqual(r.status, 400, 'un 400 aquí significa que no vio la clave');
    });

    await t.test('con `password`, como manda la app, tampoco', async () => {
      // Este es el caso que estaba roto. La APK publicada manda este nombre.
      const r = await entrar({ correo: 'j.ordonez@ordenglobal.org', password: 'lo-que-sea' });
      assert.notEqual(r.status, 400, 'la pantalla de entrada de la APK vuelve a estar rota');
    });

    await t.test('sin clave sí se rechaza, que para eso está la comprobación', async () => {
      const r = await entrar({ correo: 'j.ordonez@ordenglobal.org' });
      assert.equal(r.status, 400);
    });

    await t.test('sin correo también', async () => {
      const r = await entrar({ clave: 'lo-que-sea' });
      assert.equal(r.status, 400);
    });

    t.after(() => {
      if (proc?.pid) {
        try {
          process.kill(-proc.pid);
        } catch {
          /* ya se fue */
        }
      }
    });
  }
);
