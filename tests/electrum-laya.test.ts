/**
 * Laya decide el panel de Electrum cuando el nodo T4 contesta, y la tabla de siempre cuando no.
 *
 * Aquí no corre el modelo: un servidor falso hace de /decidir para comprobar lo que depende de
 * nosotros. Que un nodo lento o caído no retrasa ni rompe el turno, que los que el usuario nombró
 * van primero y que un id que no existe no se cuela en el panel.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { decidirPanel, convocar } from '../server/electrum/especialistas';
import { _reiniciarLaya, decidirLaya } from '../lib/laya';

type Respuesta = { status?: number; cuerpo?: unknown; demoraMs?: number };
let siguiente: Respuesta = {};
let ultimo: { auth?: string; texto?: string } = {};

const falso: Server = createServer((q, r) => {
  let datos = '';
  q.on('data', (c) => (datos += c));
  q.on('end', () => {
    ultimo = { auth: q.headers.authorization, texto: JSON.parse(datos || '{}').texto };
    setTimeout(() => {
      r.writeHead(siguiente.status || 200, { 'content-type': 'application/json' });
      r.end(JSON.stringify(siguiente.cuerpo ?? {}));
    }, siguiente.demoraMs || 0);
  });
});

const ids = (p: { id: string }[]) => p.map((e) => e.id);

test('panel con Laya', async (t) => {
  await new Promise<void>((ok) => falso.listen(0, '127.0.0.1', ok));
  const { port } = falso.address() as { port: number };
  process.env.ULTRON_LAYA_URL = `http://127.0.0.1:${port}/`;
  process.env.ULTRON_LAYA_CLAVE = 'secreto-de-prueba';
  process.env.ULTRON_LAYA_TIMEOUT_MS = '200';

  t.after(() => {
    falso.close();
    delete process.env.ULTRON_LAYA_URL;
    delete process.env.ULTRON_LAYA_CLAVE;
    delete process.env.ULTRON_LAYA_TIMEOUT_MS;
  });

  await t.test('usa lo que decide Laya y manda la clave', async () => {
    _reiniciarLaya();
    siguiente = { cuerpo: { panel: ['legal'], p: { legal: 0.97 }, umbral: 0.5, ms: 30 } };
    const r = await decidirPanel('¿Cuándo vence la concesión Quebrada Seca?');
    assert.equal(r.fuente, 'laya');
    assert.deepEqual(ids(r.panel), ['legal']);
    assert.equal(ultimo.auth, 'Bearer secreto-de-prueba');
    assert.equal(ultimo.texto, '¿Cuándo vence la concesión Quebrada Seca?');
  });

  await t.test('Laya puede decir que no hace falta nadie', async () => {
    _reiniciarLaya();
    siguiente = { cuerpo: { panel: [], p: {}, umbral: 0.5, ms: 20 } };
    const r = await decidirPanel('hola, ¿cómo va?');
    assert.equal(r.fuente, 'laya');
    assert.deepEqual(r.panel, []);
  });

  await t.test('el que el usuario nombra va primero, aunque Laya no lo ponga', async () => {
    _reiniciarLaya();
    siguiente = { cuerpo: { panel: ['economista', 'minas'], p: {}, umbral: 0.5, ms: 20 } };
    const r = await decidirPanel('pásame al geólogo: ¿cuánto cuesta la tonelada?');
    assert.deepEqual(ids(r.panel), ['geologo', 'economista']);
  });

  await t.test('un id desconocido no entra al panel', async () => {
    _reiniciarLaya();
    siguiente = { cuerpo: { panel: ['astrologo', 'civil'], p: {}, umbral: 0.5, ms: 20 } };
    assert.deepEqual(ids((await decidirPanel('¿aguanta el puente con 30 toneladas?')).panel), ['civil']);
  });

  await t.test('si Laya tarda, la tabla, sin esperar de más', async () => {
    _reiniciarLaya();
    siguiente = { cuerpo: { panel: ['legal'] }, demoraMs: 1000 };
    const t0 = Date.now();
    const r = await decidirPanel('qué tipo de yacimiento es un pórfido');
    assert.equal(r.fuente, 'tabla');
    assert.deepEqual(ids(r.panel), ids(convocar('qué tipo de yacimiento es un pórfido')));
    assert.ok(Date.now() - t0 < 600, `tardó ${Date.now() - t0} ms`);
  });

  await t.test('tras un fallo no vuelve a llamar enseguida', async () => {
    // El caso anterior dejó a Laya en pausa: esta llamada ni siquiera sale.
    siguiente = { cuerpo: { panel: ['legal'] } };
    ultimo = {};
    assert.equal(await decidirLaya('¿cuándo vence la concesión?'), null);
    assert.deepEqual(ultimo, {});
  });

  await t.test('un error del nodo o una respuesta rara también caen a la tabla', async () => {
    _reiniciarLaya();
    siguiente = { status: 500, cuerpo: { error: 'x' } };
    assert.equal((await decidirPanel('cuándo vence la concesión')).fuente, 'tabla');
    _reiniciarLaya();
    siguiente = { cuerpo: { nada: true } };
    assert.equal((await decidirPanel('cuándo vence la concesión')).fuente, 'tabla');
  });

  await t.test('sin URL configurada no se llama a nadie', async () => {
    _reiniciarLaya();
    const antes = process.env.ULTRON_LAYA_URL;
    delete process.env.ULTRON_LAYA_URL;
    ultimo = {};
    assert.equal((await decidirPanel('cuándo vence la concesión')).fuente, 'tabla');
    assert.deepEqual(ultimo, {});
    process.env.ULTRON_LAYA_URL = antes;
  });
});
