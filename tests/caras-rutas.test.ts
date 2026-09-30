/**
 * Las caras conocidas (server/caras-rutas.ts + lib/caras-miembro.ts) con las sesiones de verdad:
 *
 *  · sin sesión, nada (401); las caras son del correo de la SESIÓN, nunca del cuerpo;
 *  · solo números: lo que no sea un vector de 128 números (una foto en base64, un vector corto, un
 *    NaN) es un 400, y en el disco no queda nada que parezca una imagen;
 *  · el permiso: la cara propia solo con `como: 'dueño'`; la de otra persona solo con su «sí» dicho
 *    (`como: 'voz'` y la frase), que queda como constancia;
 *  · cada quien ve solo las suyas (la junta y un miembro de la comunidad por igual);
 *  · borrar de verdad: una por id, y todas; después GET no las trae y el archivo tampoco las tiene;
 *  · si S3 no guarda, borrar NO se confirma (503) y reintentar con S3 sano borra de verdad;
 *  · la dueña es una sola ('yo' suma muestras, hasta 5) y un conocido con el mismo nombre también.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caras-rutas-'));
process.env.ULTRON_CARAS_DIR = path.join(dir, 'caras');
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(dir, 'cerradas.json');
process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-las-caras-de-aura';
process.env.ULTRON_MEMORIA_BUCKET = '';
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const { montarRutasCaras } = await import('../server/caras-rutas');
const { emitirSesion, sesionDe, exigirMesa } = await import('../server/seguridad');
const { huellaCaras, _olvidarCacheCaras, _s3DePrueba, MAX_MUESTRAS } = await import('../lib/caras-miembro');

const app = express();
app.use(express.json({ limit: '2mb' }));
const pasa = () => ((_q: express.Request, _s: express.Response, n: express.NextFunction) => n()) as express.RequestHandler;
montarRutasCaras(app, { exigirMesa, limitar: pasa, sesionDe });
const srv = app.listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
after(() => srv.close());

const junta = emitirSesion({ correo: 'Maria@Ordenglobal.org', nombre: 'María José', rol: 'Junta' });
const miembro = emitirSesion({ correo: 'comunidad@gmail.com', nombre: 'José', rol: 'Miembro · Genesis ID' });
const h = (token?: string) => ({ 'content-type': 'application/json', ...(token ? { 'x-ultron-sesion': token } : {}) });
const vec = (semilla: number) => Array.from({ length: 128 }, (_, i) => Math.round(Math.sin(semilla * 7.3 + i) * 0.3 * 1e4) / 1e4);
const post = (token: string, body: unknown) => fetch(`${base}/api/caras`, { method: 'POST', headers: h(token), body: JSON.stringify(body) });
const listar = async (token: string) => ((await (await fetch(`${base}/api/caras`, { headers: h(token) })).json()) as any).personas as any[];
const archivo = (correo: string) => path.join(process.env.ULTRON_CARAS_DIR!, `${huellaCaras(correo)}.json`);

test('sin sesión no hay caras: GET, POST y DELETE son 401', async () => {
  assert.equal((await fetch(`${base}/api/caras`)).status, 401);
  assert.equal((await fetch(`${base}/api/caras`, { method: 'POST', headers: h(), body: '{}' })).status, 401);
  assert.equal((await fetch(`${base}/api/caras`, { method: 'DELETE' })).status, 401);
  assert.equal((await fetch(`${base}/api/caras`, { headers: h('u1.basura.firma') })).status, 401);
});

test('solo números: una foto, un vector corto o con NaN es 400 y no se guarda nada', async () => {
  const foto = 'data:image/jpeg;base64,' + Buffer.alloc(3000, 7).toString('base64');
  for (const vectores of [[foto], [vec(1).slice(0, 64)], [[...vec(1).slice(0, 127), Number.NaN]], [vec(1).map(() => 5)], []]) {
    const r = await post(junta.token, { relacion: 'yo', vectores, consentimiento: { como: 'dueño' } });
    assert.equal(r.status, 400, JSON.stringify(vectores).slice(0, 40));
    assert.match(((await r.json()) as any).error, /números|nunca fotos/);
  }
  assert.deepEqual(await listar(junta.token), []);
});

test('el permiso: la cara propia la pide la dueña; la de otra persona solo con su «sí» dicho', async () => {
  // Otra persona sin su «sí»: no.
  let r = await post(junta.token, { nombre: 'Ana', relacion: 'conocido', vectores: [vec(2)], consentimiento: { como: 'dueño' } });
  assert.equal(r.status, 400);
  assert.match(((await r.json()) as any).error, /tiene que decir que sí/);
  r = await post(junta.token, { nombre: 'Ana', relacion: 'conocido', vectores: [vec(2)], consentimiento: { como: 'voz', frase: '' } });
  assert.equal(r.status, 400);
  // La propia con un «como» que no es de ella: no.
  r = await post(junta.token, { relacion: 'yo', vectores: [vec(1)], consentimiento: { como: 'voz', frase: 'sí' } });
  assert.equal(r.status, 400);
  // Bien: la propia (el nombre sale de la SESIÓN, no del cuerpo) y Ana con su «sí».
  r = await post(junta.token, { nombre: 'Otro Nombre', relacion: 'yo', vectores: [vec(1)], consentimiento: { como: 'dueño' } });
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as any).persona.nombre, 'María José');
  r = await post(junta.token, { nombre: 'Ana', relacion: 'conocido', vectores: [vec(2)], consentimiento: { como: 'voz', frase: 'Sí, claro, recuérdame' } });
  assert.equal(r.status, 200);
  const l = await listar(junta.token);
  assert.deepEqual(l.map((p) => [p.nombre, p.relacion]).sort(), [['Ana', 'conocido'], ['María José', 'yo']]);
  assert.equal(l[0].vectores[0].length, 128);
  // En el disco: la constancia del «sí» y ni rastro de una imagen.
  const crudo = fs.readFileSync(archivo('maria@ordenglobal.org'), 'utf8');
  assert.match(crudo, /Sí, claro, recuérdame/);
  assert.doesNotMatch(crudo, /base64|data:image|jpeg/i);
  // El nombre del archivo no enseña el correo.
  assert.doesNotMatch(archivo('maria@ordenglobal.org'), /maria|ordenglobal/i);
});

test('cada quien ve solo las suyas (la junta y un miembro de la comunidad)', async () => {
  assert.deepEqual(await listar(miembro.token), []);
  assert.equal((await post(miembro.token, { relacion: 'yo', vectores: [vec(9)], consentimiento: { como: 'dueño' } })).status, 200);
  const suyas = await listar(miembro.token);
  assert.deepEqual(suyas.map((p) => p.nombre), ['José']);
  assert.ok(!(await listar(junta.token)).some((p) => p.nombre === 'José'));
  // Un miembro no borra lo de otro aunque sepa el id.
  const idAna = (await listar(junta.token)).find((p) => p.nombre === 'Ana').id;
  assert.equal((await fetch(`${base}/api/caras/${idAna}`, { method: 'DELETE', headers: h(miembro.token) })).status, 404);
  assert.ok((await listar(junta.token)).some((p) => p.nombre === 'Ana'));
});

test('la dueña es una sola y suma muestras (hasta 5); un conocido con el mismo nombre también', async () => {
  for (let i = 0; i < 7; i++) await post(junta.token, { relacion: 'yo', vectores: [vec(100 + i)], consentimiento: { como: 'dueño' } });
  await post(junta.token, { nombre: 'ána', relacion: 'conocido', vectores: [vec(3)], consentimiento: { como: 'voz', frase: 'sí' } });
  const l = await listar(junta.token);
  const yo = l.filter((p) => p.relacion === 'yo');
  assert.equal(yo.length, 1);
  assert.equal(yo[0].vectores.length, MAX_MUESTRAS);
  assert.equal(l.filter((p) => p.relacion === 'conocido').length, 1, '«ána» es la misma Ana');
});

test('olvidar de verdad: una por id y después todas; el archivo tampoco las tiene', async () => {
  const ana = (await listar(junta.token)).find((p) => p.relacion === 'conocido');
  const r = await fetch(`${base}/api/caras/${ana.id}`, { method: 'DELETE', headers: h(junta.token) });
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as any).nombre, 'ána');
  assert.equal((await fetch(`${base}/api/caras/${ana.id}`, { method: 'DELETE', headers: h(junta.token) })).status, 404);
  assert.ok(!(await listar(junta.token)).some((p) => p.relacion === 'conocido'));
  const todas = await fetch(`${base}/api/caras`, { method: 'DELETE', headers: h(junta.token) });
  assert.deepEqual(await todas.json(), { ok: true, borradas: 1, honesto: true });
  assert.deepEqual(await listar(junta.token), []);
  // Sin la caché del proceso (un redespliegue): del disco tampoco vuelven.
  _olvidarCacheCaras();
  assert.deepEqual(await listar(junta.token), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(archivo('maria@ordenglobal.org'), 'utf8')).personas, []);
  // Las del miembro siguen ahí.
  assert.deepEqual((await listar(miembro.token)).map((p) => p.nombre), ['José']);
});

test('si S3 no guarda, borrar no se confirma (503) y al reintentar con S3 sano se borra de verdad', async () => {
  const quien = emitirSesion({ correo: 's3-cae@ordenglobal.org', nombre: 'Prueba S3', rol: 'Junta' });
  const guardado: Record<string, unknown> = {};
  let s3Sano = true;
  _s3DePrueba({ listo: () => true, put: async (k: string, j: unknown) => (s3Sano ? ((guardado[k] = j), { ok: true, detalle: '' }) : { ok: false, detalle: 'S3 503' }) });
  try {
    let r = await post(quien.token, { nombre: 'Beto', relacion: 'conocido', vectores: [vec(9)], consentimiento: { como: 'voz', frase: 'sí, recuérdame' } });
    assert.equal(r.status, 200);
    const id = (await listar(quien.token))[0].id;
    // S3 se cae: el borrado responde 503 y la cara sigue (ni caché ni disco quedan «adelantados»).
    s3Sano = false;
    r = await fetch(`${base}/api/caras/${id}`, { method: 'DELETE', headers: h(quien.token) });
    assert.equal(r.status, 503);
    assert.equal(((await r.json()) as any).code, 'caras_no_guardadas');
    _olvidarCacheCaras();
    assert.equal((await listar(quien.token)).length, 1, 'la cara no se da por borrada sin recibo durable');
    r = await fetch(`${base}/api/caras`, { method: 'DELETE', headers: h(quien.token) });
    assert.equal(r.status, 503);
    // S3 vuelve: el reintento encuentra la cara y la borra, en S3 y en disco.
    s3Sano = true;
    r = await fetch(`${base}/api/caras/${id}`, { method: 'DELETE', headers: h(quien.token) });
    assert.equal(r.status, 200);
    const enS3 = Object.values(guardado).at(-1) as any;
    assert.deepEqual(enS3.personas, []);
    _olvidarCacheCaras();
    assert.deepEqual(await listar(quien.token), []);
  } finally {
    _s3DePrueba(null);
  }
});
