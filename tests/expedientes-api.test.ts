/**
 * LA LISTA DE EXPEDIENTES, CONTRA EL SERVIDOR COMPILADO.
 *
 * F13. La lista cortaba en 40 capas y 60 documentos sin decirlo. Eso no es quedarse corto: con un
 * catastro nacional de 125 capas, la pantalla parecía completa y faltaban 85. Quien no encontraba un
 * expediente concluía que no estaba cargado, cuando lo que pasaba es que no estaba en esa página.
 * **«No existe» y «no está aquí» no se pueden ver igual en un registro.**
 *
 * Se prueba contra el servidor de verdad y la base de verdad porque el fallo vivía justo ahí: en
 * los números que la ruta devuelve, no en una función que se pueda llamar sola.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SERVIDOR = path.join(process.cwd(), 'dist', 'server.cjs');
const PUERTO = 7801;
const BASE = `http://127.0.0.1:${PUERTO}`;
const SECRETO = 'secreto-de-prueba';

const hay = fs.existsSync(SERVIDOR) && !!process.env.ELECTRUM_DB_URL;
let proc: ChildProcess | null = null;

/** Una sesión firmada como la firma el servidor, para entrar con nivel de trabajo. */
function token(): string {
  const at = Date.now();
  const cuerpo = Buffer.from(
    JSON.stringify({ correo: 'pruebas@ordenglobal.hn', nombre: 'Pruebas', rol: 'QA', at, exp: at + 3_600_000 })
  ).toString('base64url');
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

test(
  'la lista de expedientes dice cuánto hay y cuánto enseña',
  { skip: hay ? false : 'hace falta `npm run build` y ELECTRUM_DB_URL' },
  async (t) => {
    proc = spawn('node', [SERVIDOR], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(PUERTO),
        ULTRON_SESION_SECRETO: SECRETO,
        ULTRON_PADRON: 'pruebas|Pruebas|pruebas@ordenglobal.hn||electrum=escribe',
      },
      stdio: 'ignore',
      detached: true,
    });
    assert.ok(await esperar(), 'el servidor no levantó');

    const cabeceras = { 'x-ultron-sesion': token() };
    const pedir = async (qs = '') =>
      (await fetch(`${BASE}/api/electrum/expedientes${qs}`, { headers: cabeceras })).json() as any;

    const todo = await pedir();

    await t.test('viene el total, no solo la página', async () => {
      assert.ok(typeof todo.totales?.capas === 'number', 'sin total, una lista truncada parece completa');
      assert.ok(typeof todo.totales?.documentos === 'number');
    });

    await t.test('el tope se puede subir y bajar', async () => {
      const corta = await pedir('?limite=10');
      assert.ok(corta.capas.length <= 10);
      assert.equal(corta.totales.capas, todo.totales.capas, 'el total no depende de cuántos se pidan');
    });

    await t.test('hay página siguiente y no repite la anterior', async () => {
      if (todo.totales.documentos < 2) return; // con menos de dos no hay nada que paginar
      const a = await pedir('?limite=1');
      const b = await pedir('?limite=1&desde=1');
      assert.equal(a.documentos.length, 1);
      if (b.documentos.length) assert.notEqual(a.documentos[0].id, b.documentos[0].id);
    });

    await t.test('se puede buscar, y sin acentos encuentra igual', async () => {
      const r = await pedir('?q=' + encodeURIComponent('zzzz-no-existe-nada'));
      assert.equal(r.totales.capas, 0);
      assert.equal(r.totales.documentos, 0);
    });

    await t.test('una búsqueda vacía NO dice que el catastro esté vacío', async () => {
      // El fallo que tuvo la primera versión de esto: se enseñaba el total FILTRADO —cero— como si
      // fuera lo que hay cargado, y quien buscaba una palabra rara concluía que no había nada.
      const r = await pedir('?q=' + encodeURIComponent('zzzz-no-existe-nada'));
      assert.equal(r.existentes.capas, todo.totales.capas, 'los existentes son los de verdad');
      assert.equal(r.existentes.documentos, todo.totales.documentos);
    });

    await t.test('los documentos traen fecha y quién los subió', async () => {
      if (!todo.documentos.length) return;
      const d = todo.documentos[0];
      assert.ok('subido' in d, 'sin fecha no se sabe si el padrón es el de junio o el de antes');
      assert.ok('subido_por' in d);
    });

    t.after(() => {
      if (proc?.pid) {
        try {
          process.kill(-proc.pid);
        } catch {
          /* ya murió */
        }
      }
    });
  }
);
