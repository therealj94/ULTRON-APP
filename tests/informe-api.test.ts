/**
 * El informe por HTTP: quien lo pide lo puede bajar, otro no, y compartirlo abre la puerta.
 *
 * Las pruebas de `informe.test.ts` llaman a `guardarInforme` y `tomarInforme` directamente con la
 * misma cadena, así que no podían ver que la RUTA guardaba el dueño por nombre («Ing. Ana Pérez»)
 * y lo comparaba por id («ana»). Resultado: nadie podía bajar su propio informe desde la pantalla.
 * Esto pasa por el servidor compilado, que es por donde pasa la gente.
 *
 *   npm run build && ELECTRUM_DB_URL=postgres://… npx tsx --test tests/informe-api.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { cerrarBase, consulta } from '../server/electrum/db';

const SERVIDOR = path.join(process.cwd(), 'dist', 'server.cjs');
const PUERTO = 7802;
const BASE = `http://127.0.0.1:${PUERTO}`;
const SECRETO = 'secreto-de-prueba';

const hay = fs.existsSync(SERVIDOR) && !!process.env.ELECTRUM_DB_URL;
let proc: ChildProcess | null = null;

/** Una sesión firmada como la firma el servidor. El nombre NO coincide con el id, a propósito. */
function sesion(correo: string, nombre: string): string {
  const at = Date.now();
  const cuerpo = Buffer.from(JSON.stringify({ correo, nombre, rol: 'QA', at, exp: at + 3_600_000 })).toString('base64url');
  const firma = crypto.createHmac('sha256', SECRETO).update(cuerpo).digest('base64url');
  return `u1.${cuerpo}.${firma}`;
}

async function esperar(intentos = 40) {
  for (let i = 0; i < intentos; i++) {
    try {
      if ((await fetch(`${BASE}/electrum.html`)).ok) return true;
    } catch {
      /* todavía no */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

test('el informe es de quien lo pidió', { skip: hay ? false : 'hace falta `npm run build` y ELECTRUM_DB_URL' }, async (t) => {
  // Una concesión propia de esta prueba, para que haya cartera que informar en cualquier base.
  const [{ id: propia }] = await consulta<{ id: number }>(
    `INSERT INTO concesion (nombre, titular, geom)
     VALUES ('Prueba de informe', 'Titular de prueba', ST_Multi(ST_MakeEnvelope(-87.2, 14.1, -87.19, 14.11, 4326)))
     RETURNING id::int AS id`
  );

  proc = spawn('node', [SERVIDOR], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PUERTO),
      ULTRON_SESION_SECRETO: SECRETO,
      ULTRON_PADRON: 'ana|Ing. Ana Pérez|ana@ordenglobal.hn||electrum=escribe\nbeto|Beto Ruiz|beto@ordenglobal.hn||electrum=lee',
    },
    stdio: 'ignore',
    detached: true,
  });

  t.after(async () => {
    if (proc?.pid) {
      try {
        process.kill(-proc.pid);
      } catch {
        /* ya no estaba */
      }
    }
    await consulta(`DELETE FROM concesion WHERE id = $1`, [propia]);
    await cerrarBase();
  });

  assert.ok(await esperar(), 'el servidor no levantó');

  const ana = { 'x-ultron-sesion': sesion('ana@ordenglobal.hn', 'Ing. Ana Pérez') };
  const beto = { 'x-ultron-sesion': sesion('beto@ordenglobal.hn', 'Beto Ruiz') };

  const pedido = await fetch(`${BASE}/api/electrum/informe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...ana },
    body: JSON.stringify({ tipo: 'concesion', concesion_id: propia }),
  });
  assert.equal(pedido.status, 200, await pedido.clone().text());
  const { url, id } = (await pedido.json()) as { url: string; id: string };

  await t.test('quien lo pidió lo baja', async () => {
    const r = await fetch(`${BASE}${url}`, { headers: ana });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  });

  await t.test('otra persona no, mientras no se comparta', async () => {
    assert.equal((await fetch(`${BASE}${url}`, { headers: beto })).status, 403);
  });

  await t.test('otra persona tampoco lo puede compartir', async () => {
    assert.equal((await fetch(`${BASE}/api/electrum/informe/${id}/compartir`, { method: 'POST', headers: beto })).status, 403);
  });

  await t.test('compartido por su dueño, ya lo baja cualquiera con sesión', async () => {
    const c = await fetch(`${BASE}/api/electrum/informe/${id}/compartir`, { method: 'POST', headers: ana });
    assert.equal(c.status, 200, await c.clone().text());
    assert.equal((await fetch(`${BASE}${url}`, { headers: beto })).status, 200);
  });
});
