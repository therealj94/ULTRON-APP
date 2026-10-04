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
const { montarRutasWindows, instruccionWindows } = await import('../server/windows-rutas');
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
  entorno: { SPOTIFY_CLIENT_ID: 'abc123spotifyid', GOOGLE_DESKTOP_CLIENT_ID: '123-x.apps.googleusercontent.com', GOOGLE_DESKTOP_CLIENT_SECRET: 'GOCSPX-prueba', MICROSOFT_CLIENT_ID: 'mal id con espacios' },
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

test('conexiones: los Client ID del entorno, solo con sesión y solo si están bien formados', async () => {
  assert.equal((await fetch(`${base}/api/windows/conexiones`)).status, 401);
  const j: any = await (await fetch(`${base}/api/windows/conexiones`, { headers: { 'x-ultron-mesa': 'clave-de-mesa-de-prueba' } })).json();
  assert.deepEqual(j.spotify, { clientId: 'abc123spotifyid' });
  assert.deepEqual(j.google, { clientId: '123-x.apps.googleusercontent.com', clientSecret: 'GOCSPX-prueba' });
  assert.equal(j.microsoft, null);
});

test('el cerebro en Windows sabe que tiene manos y cómo pedirlas', () => {
  const es = instruccionWindows('es');
  assert.match(es, /⟦hacer: cierra chrome⟧/);
  assert.match(es, /Nunca hables de «ejecutor»/);
  assert.match(instruccionWindows('en'), /Never mention an "executor"/);
});

test('salud con ?probar=1 pregunta de verdad al modelo windows (frase fija) y se guarda un minuto', async () => {
  respuesta = { p: { win_abrir_app: 0.97 }, etiquetas: [], grupos: { win: 'win_abrir_app' } };
  const antes = preguntas;
  const j: any = await (await fetch(`${base}/api/windows/salud?probar=1`)).json();
  assert.equal(j.prueba.etiqueta, 'win_abrir_app');
  assert.equal(j.prueba.frase, 'abre la calculadora');
  await fetch(`${base}/api/windows/salud?probar=1`);
  assert.equal(preguntas, antes + 1);
});

test('el cerebro en Windows dice que VA a hacerlo, nunca «listo» antes de que la PC lo haga, y entiende el aviso real de la PC', async () => {
  const { instruccionWindows } = await import('../server/windows-rutas');
  for (const idioma of ['es', 'en'] as const) {
    const p = instruccionWindows(idioma);
    assert.doesNotMatch(p, /«Listo, la cierro\.»|"Done, closing it\."/);
    assert.match(p, idioma === 'es' ? /nunca «listo»/ : /never "done"/);
    assert.match(p, /\[La PC: …\]/);
  }
});
