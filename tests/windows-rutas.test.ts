/**
 * AURA para Windows (server/windows-rutas.ts): la ruta de Laya «windows» para el .exe.
 *  · sin sesión ni clave de mesa: 401 (la GPU del nodo no es pública);
 *  · el ganador del grupo `win` y su P; `seguro` solo por encima del umbral y nunca para win_ninguna;
 *  · sin Laya (null): etiqueta null con el motivo, y el .exe sigue con lo suyo;
 *  · texto vacío o gigante: 400 sin preguntar al nodo.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';

process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-aura-windows-rutas';
process.env.ULTRON_MESA_CLAVE = 'clave-de-mesa-de-prueba';
const { montarRutasWindows } = await import('../server/windows-rutas');
const { exigirMesa } = await import('../server/seguridad');

let respuesta: any = null;
let preguntas = 0;
const app = express();
app.use(express.json());
const pasa = () => ((_q: express.Request, _s: express.Response, n: express.NextFunction) => n()) as express.RequestHandler;
montarRutasWindows(app, {
  exigirMesa,
  limitar: pasa,
  consultar: (async (modelo: string) => {
    preguntas++;
    assert.equal(modelo, 'windows');
    return respuesta ? { resultado: respuesta, motivo: 'ok', ms: 12 } : { resultado: null, motivo: 'sin configurar', ms: 0 };
  }) as any,
});
const srv = app.listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
after(() => srv.close());
const post = (body: unknown, mesa = true) =>
  fetch(`${base}/api/windows/intencion`, { method: 'POST', headers: { 'content-type': 'application/json', ...(mesa ? { 'x-ultron-mesa': 'clave-de-mesa-de-prueba' } : {}) }, body: JSON.stringify(body) });

test('sin sesión ni clave de mesa no se pregunta al nodo', async () => {
  const r = await post({ texto: 'abre excel' }, false);
  assert.equal(r.status, 401);
  assert.equal(preguntas, 0);
});

test('el ganador del grupo win, seguro solo sobre el umbral', async () => {
  respuesta = { p: { win_abrir_app: 0.93, win_ninguna: 0.04 }, etiquetas: [], grupos: { win: 'win_abrir_app' }, umbrales: { win_abrir_app: 0.5 } };
  let j: any = await (await post({ texto: 'abre excel' })).json();
  assert.equal(j.etiqueta, 'win_abrir_app');
  assert.equal(j.seguro, true);
  respuesta = { p: { win_abrir_app: 0.41 }, etiquetas: [], grupos: { win: 'win_abrir_app' } };
  j = await (await post({ texto: 'abre algo' })).json();
  assert.equal(j.seguro, false);
  respuesta = { p: { win_ninguna: 0.99 }, etiquetas: [], grupos: { win: 'win_ninguna' } };
  j = await (await post({ texto: 'hola aura' })).json();
  assert.equal(j.etiqueta, 'win_ninguna');
  assert.equal(j.seguro, false);
});

test('sin Laya: etiqueta null con el motivo', async () => {
  respuesta = null;
  const j: any = await (await post({ texto: 'abre excel' })).json();
  assert.equal(j.etiqueta, null);
  assert.equal(j.motivo, 'sin configurar');
  assert.equal(j.seguro, false);
});

test('texto vacío o gigante: 400 sin preguntar', async () => {
  const antes = preguntas;
  assert.equal((await post({ texto: '  ' })).status, 400);
  assert.equal((await post({ texto: 'x'.repeat(4001) })).status, 400);
  assert.equal(preguntas, antes);
});
