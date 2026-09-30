/**
 * Las rutas de la app 5.0 (server/app-rutas.ts) con las sesiones de verdad (server/seguridad.ts):
 *
 *  · GET/PUT /api/perfil: el perfil es del correo de la SESIÓN, nunca del cuerpo; lo malo es un 400
 *    con la frase; sin token, la ficha pública de siempre; con un token que no vale, 401;
 *  · GET /api/app/acciones: SSE por persona, varios teléfonos a la vez, latido, y un tope por cuenta;
 *  · POST /api/app/contexto: validado y guardado por persona.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-rutas-'));
process.env.ULTRON_PERFILES_DIR = path.join(dir, 'perfiles');
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(dir, 'cerradas.json');
process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-las-sesiones-app';
process.env.ULTRON_MEMORIA_BUCKET = '';
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const { montarRutasApp, MAX_CANALES_POR_CUENTA } = await import('../server/app-rutas');
const { emitirSesion, sesionDe, tokenDe, exigirMesa, borrarSesion } = await import('../server/seguridad');
const { empujarAccion, contextoDe, oyentesDe, _reiniciarAccionesApp } = await import('../lib/acciones-app');

const app = express();
app.use(express.json());
const pasa = () => ((_q: express.Request, _s: express.Response, n: express.NextFunction) => n()) as express.RequestHandler;
montarRutasApp(app, { exigirMesa, limitar: pasa, sesionDe, tokenDe, perfilPlataforma: () => ({ id: 'ultron', acento: '#fff' }), latidoMs: 60 });
const srv = app.listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
after(() => srv.close());

const yo = emitirSesion({ correo: 'Maria@Ordenglobal.org', nombre: 'María José', rol: 'Junta' });
const h = (token?: string) => ({ 'content-type': 'application/json', ...(token ? { 'x-ultron-sesion': token } : {}) });

test('GET /api/perfil: sin token la ficha pública; con token malo 401; con sesión y sin perfil, perfil: null', async () => {
  const pub: any = await (await fetch(`${base}/api/perfil`)).json();
  assert.equal(pub.id, 'ultron', 'la web sigue leyendo la ficha de la plataforma');
  assert.equal(pub.perfil, null);
  assert.equal((await fetch(`${base}/api/perfil`, { headers: h('u1.basura.firma') })).status, 401);
  const r = await fetch(`${base}/api/perfil`, { headers: h(yo.token) });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(((await r.json()) as any).perfil, null);
});

test('PUT /api/perfil: valida, guarda por el correo de la sesión y se lee de vuelta', async () => {
  assert.equal((await fetch(`${base}/api/perfil`, { method: 'PUT', headers: h(), body: '{"apodo":"X"}' })).status, 401, 'sin sesión no');
  const malo = await fetch(`${base}/api/perfil`, { method: 'PUT', headers: h(yo.token), body: JSON.stringify({ avatar: 'hal' }) });
  assert.equal(malo.status, 400);
  assert.match(((await malo.json()) as any).error, /avatar/);
  const ok = await fetch(`${base}/api/perfil`, {
    method: 'PUT',
    headers: h(yo.token),
    body: JSON.stringify({ apodo: 'Majo', tema: 'oscuro', cumple: '12-08', encuesta: { vive: 'Comayagua', gustos: 'leer' }, correo: 'otra@x.com' }),
  });
  assert.equal(ok.status, 200);
  const j: any = await ok.json();
  assert.equal(j.perfil.apodo, 'Majo');
  assert.equal(j.perfil.avatar, 'aura', 'lo que no mandó queda en lo de siempre');
  assert.equal(j.durable, false, 'sin S3, dicho');
  const leido: any = await (await fetch(`${base}/api/perfil`, { headers: h(yo.token) })).json();
  assert.equal(leido.perfil.encuesta.vive, 'Comayagua');
  assert.equal(leido.perfil.cumple, '12-08');
  // El cuerpo no elige de quién es el perfil.
  const otra = emitirSesion({ correo: 'otra@x.com', nombre: 'Otra', rol: 'Junta' });
  assert.equal(((await (await fetch(`${base}/api/perfil`, { headers: h(otra.token) })).json()) as any).perfil, null);
  // Un segundo PUT parcial solo cambia lo que trae.
  const p2: any = await (await fetch(`${base}/api/perfil`, { method: 'PUT', headers: h(yo.token), body: JSON.stringify({ encuesta: { familia: 'dos gatos' } }) })).json();
  assert.deepEqual(p2.perfil.encuesta, { vive: 'Comayagua', gustos: 'leer', familia: 'dos gatos' });
  assert.equal(p2.perfil.apodo, 'Majo');
});

/** Abre el canal y junta lo que llega, trozo a trozo. */
async function abrirCanal(token: string) {
  const ctrl = new AbortController();
  const r = await fetch(`${base}/api/app/acciones`, { headers: h(token), signal: ctrl.signal });
  let texto = '';
  const listo = (async () => {
    if (!r.body) return;
    const dec = new TextDecoder();
    try {
      for await (const trozo of r.body as any) texto += dec.decode(trozo, { stream: true });
    } catch {
      /* se cerró a propósito */
    }
  })();
  return {
    r,
    texto: () => texto,
    cerrar: async () => {
      ctrl.abort();
      await listo;
    },
  };
}
const espera = async (cond: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10));
  return cond();
};

test('el canal de acciones: SSE, varios teléfonos de la misma cuenta, eventos {id, accion} y latido', async () => {
  _reiniciarAccionesApp();
  assert.equal((await fetch(`${base}/api/app/acciones`)).status, 401, 'sin sesión no');
  const tel1 = await abrirCanal(yo.token);
  const tel2 = await abrirCanal(yo.token);
  const ajeno = await abrirCanal(emitirSesion({ correo: 'ajeno@x.com', nombre: 'Ajeno', rol: 'Junta' }).token);
  try {
    assert.equal(tel1.r.status, 200);
    assert.match(String(tel1.r.headers.get('content-type')), /text\/event-stream/);
    assert.ok(await espera(() => oyentesDe('maria@ordenglobal.org') === 2));
    const { evento, entregada } = empujarAccion('maria@ordenglobal.org', { tipo: 'abrir', pantalla: 'ajustes' });
    assert.equal(entregada, 2);
    const linea = `data: ${JSON.stringify({ id: evento.id, accion: { tipo: 'abrir', pantalla: 'ajustes' } })}`;
    assert.ok(await espera(() => tel1.texto().includes(linea) && tel2.texto().includes(linea)), tel1.texto());
    assert.ok(!ajeno.texto().includes('ajustes'), 'otra cuenta no la recibe');
    assert.ok(await espera(() => tel1.texto().includes(': latido')), 'latido como comentario SSE');
    assert.match(tel1.texto(), /^retry: 3000\n/);
  } finally {
    await tel1.cerrar();
    await tel2.cerrar();
    await ajeno.cerrar();
  }
  assert.ok(await espera(() => oyentesDe('maria@ordenglobal.org') === 0), 'al cerrarse, se suelta');
});

test('el canal tiene tope por cuenta, y una sesión cerrada ya no abre', async () => {
  _reiniciarAccionesApp();
  const s = emitirSesion({ correo: 'muchos@x.com', nombre: 'Muchos', rol: 'Junta' });
  const abiertos = [];
  for (let i = 0; i < MAX_CANALES_POR_CUENTA; i++) abiertos.push(await abrirCanal(s.token));
  try {
    assert.ok(await espera(() => oyentesDe('muchos@x.com') === MAX_CANALES_POR_CUENTA));
    assert.equal((await fetch(`${base}/api/app/acciones`, { headers: h(s.token) })).status, 429);
  } finally {
    for (const a of abiertos) await a.cerrar();
  }
  await borrarSesion(s.token);
  assert.equal((await fetch(`${base}/api/app/acciones`, { headers: h(s.token) })).status, 401);
});

test('POST /api/app/contexto: validado, por persona, y el cerebro lo encuentra', async () => {
  _reiniciarAccionesApp();
  assert.equal((await fetch(`${base}/api/app/contexto`, { method: 'POST', headers: h(), body: '{"pantalla":"mesa","contactos":[]}' })).status, 401);
  const malo = await fetch(`${base}/api/app/contexto`, { method: 'POST', headers: h(yo.token), body: JSON.stringify({ pantalla: 'banco' }) });
  assert.equal(malo.status, 400);
  const ok = await fetch(`${base}/api/app/contexto`, {
    method: 'POST',
    headers: h(yo.token),
    body: JSON.stringify({ pantalla: 'chats', chatAbierto: { correo: 'beto@x.com', nombre: 'Beto' }, contactos: [{ correo: 'beto@x.com', nombre: 'Beto' }, { correo: 'mal', nombre: 'Mal' }] }),
  });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as any).contactos, 1);
  assert.equal(contextoDe('maria@ordenglobal.org')?.chatAbierto?.nombre, 'Beto');
});
