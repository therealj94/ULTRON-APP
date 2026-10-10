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
const AA = await import('../lib/acciones-app');

const app = express();
app.use(express.json());
const pasa = () => ((_q: express.Request, _s: express.Response, n: express.NextFunction) => n()) as express.RequestHandler;
montarRutasApp(app, { exigirMesa, limitar: pasa, sesionDe, tokenDe, perfilPlataforma: () => ({ id: 'ultron', acento: '#fff' }), latidoMs: 60 });
const srv = app.listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
after(() => srv.close());

const yo = emitirSesion({ correo: 'Maria@Ordenglobal.org', nombre: 'María José', rol: 'Junta' }, { comunidad: true });
const h = (token?: string) => ({ 'content-type': 'application/json', ...(token ? { 'x-ultron-sesion': token } : {}) });

test('GET /api/perfil: sin token la ficha pública; con token malo 401; con sesión y sin perfil, perfil: null', async () => {
  const pub: any = await (await fetch(`${base}/api/perfil`)).json();
  assert.equal(pub.id, 'ultron', 'la web sigue leyendo la ficha de la plataforma');
  assert.equal(pub.perfil, null);
  assert.equal((await fetch(`${base}/api/perfil`, { headers: h('u1.basura.firma') })).status, 401);
  const r = await fetch(`${base}/api/perfil`, { headers: h(yo.token) });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const j: any = await r.json();
  assert.equal(j.perfil, null);
  // A05: con sesión dice si pudo leer lo guardado y si este servicio guarda de verdad (sin S3: no).
  assert.equal(j.disponible, true);
  assert.equal(j.durable, false);
  assert.equal(pub.disponible, undefined, 'la ficha pública no lleva nada de la persona');
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
  const otra = emitirSesion({ correo: 'otra@x.com', nombre: 'Otra', rol: 'Junta' }, { comunidad: true });
  assert.equal(((await (await fetch(`${base}/api/perfil`, { headers: h(otra.token) })).json()) as any).perfil, null);
  // Un segundo PUT parcial solo cambia lo que trae.
  const p2: any = await (await fetch(`${base}/api/perfil`, { method: 'PUT', headers: h(yo.token), body: JSON.stringify({ encuesta: { familia: 'dos gatos' } }) })).json();
  assert.deepEqual(p2.perfil.encuesta, { vive: 'Comayagua', gustos: 'leer', familia: 'dos gatos' });
  assert.equal(p2.perfil.apodo, 'Majo');
});

/** Abre el canal y junta lo que llega, trozo a trozo. */
async function abrirCanal(token: string, aparato?: string, donde = base) {
  const ctrl = new AbortController();
  const r = await fetch(`${donde}/api/app/acciones`, { headers: { ...h(token), ...(aparato ? { 'x-aura-aparato': aparato } : {}) }, signal: ctrl.signal });
  let texto = '';
  let terminado = false;
  const listo = (async () => {
    if (!r.body) return;
    const dec = new TextDecoder();
    try {
      for await (const trozo of r.body as any) texto += dec.decode(trozo, { stream: true });
    } catch {
      /* se cerró a propósito */
    }
    terminado = true;
  })();
  return {
    r,
    texto: () => texto,
    /** El servidor cerró el canal (o lo cerramos nosotros). */
    terminado: () => terminado,
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
  const ajeno = await abrirCanal(emitirSesion({ correo: 'ajeno@x.com', nombre: 'Ajeno', rol: 'Junta' }, { comunidad: true }).token);
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

test('el canal tiene tope por cuenta (al pasarlo se desaloja el más viejo), y una sesión cerrada ya no abre', async () => {
  _reiniciarAccionesApp();
  const s = emitirSesion({ correo: 'muchos@x.com', nombre: 'Muchos', rol: 'Junta' }, { comunidad: true });
  const abiertos = [];
  for (let i = 0; i < MAX_CANALES_POR_CUENTA; i++) {
    abiertos.push(await abrirCanal(s.token));
    // En orden: el primero es de verdad el más viejo.
    assert.ok(await espera(() => oyentesDe('muchos@x.com') === i + 1));
  }
  try {
    const nuevo = await abrirCanal(s.token);
    abiertos.push(nuevo);
    assert.equal(nuevo.r.status, 200, 'el teléfono nuevo entra (antes: 429)');
    assert.ok(await espera(() => abiertos[0].terminado()), 'el canal más viejo se cerró');
    assert.equal(oyentesDe('muchos@x.com'), MAX_CANALES_POR_CUENTA);
    assert.ok(!abiertos[1].terminado(), 'solo el más viejo');
  } finally {
    for (const a of abiertos) await a.cerrar();
  }
  await borrarSesion(s.token);
  assert.equal((await fetch(`${base}/api/app/acciones`, { headers: h(s.token) })).status, 401);
});

test('el canal se corta en el latido siguiente si la sesión se cierra, y nunca pasa de su vida máxima', async () => {
  _reiniciarAccionesApp();
  const s = emitirSesion({ correo: 'sale@x.com', nombre: 'Sale', rol: 'Junta' }, { comunidad: true });
  const tel = await abrirCanal(s.token);
  try {
    assert.ok(await espera(() => oyentesDe('sale@x.com') === 1));
    await borrarSesion(s.token);
    assert.ok(await espera(() => tel.terminado()), 'cerrar sesión corta el canal abierto');
    assert.match(tel.texto(), /: fin sesion\n/);
    assert.equal(oyentesDe('sale@x.com'), 0, 'y ya no recibe acciones');
    assert.equal(empujarAccion('sale@x.com', { tipo: 'atras' }).entregada, 0);
  } finally {
    await tel.cerrar();
  }

  // Vida máxima (corta, en un servidor aparte): el canal se cierra solo y la app vuelve a entrar.
  const app2 = express();
  app2.use(express.json());
  montarRutasApp(app2, { exigirMesa, limitar: pasa, sesionDe, tokenDe, perfilPlataforma: () => ({}), latidoMs: 60, vidaMs: 200 });
  const srv2 = app2.listen(0, '127.0.0.1');
  await new Promise((r) => srv2.once('listening', r));
  const base2 = `http://127.0.0.1:${(srv2.address() as AddressInfo).port}`;
  const s2 = emitirSesion({ correo: 'vida@x.com', nombre: 'Vida', rol: 'Junta' }, { comunidad: true });
  const tel2 = await abrirCanal(s2.token, undefined, base2);
  try {
    assert.ok(await espera(() => tel2.terminado(), 2000), 'se cerró al cumplir su vida');
    assert.match(tel2.texto(), /: fin renovar\n/);
  } finally {
    await tel2.cerrar();
    await new Promise((r) => srv2.close(r));
  }
});

test('el canal por aparato: la acción va al teléfono del turno; el mismo aparato reemplaza su canal viejo', async () => {
  _reiniciarAccionesApp();
  const s = emitirSesion({ correo: 'dos@x.com', nombre: 'Dos', rol: 'Junta' }, { comunidad: true });
  const a = await abrirCanal(s.token, 'tel-A');
  const b = await abrirCanal(s.token, 'tel-B');
  try {
    assert.ok(await espera(() => oyentesDe('dos@x.com') === 2));
    const { evento, entregada } = empujarAccion('dos@x.com', { tipo: 'abrir', pantalla: 'chats' }, { aparato: 'tel-B' });
    assert.equal(entregada, 1);
    assert.ok(await espera(() => b.texto().includes(evento.id)));
    assert.ok(!a.texto().includes(evento.id), 'el teléfono A no la recibe');
    // A se reconecta (su canal viejo quedó colgado): el nuevo reemplaza al viejo, no se suman.
    const a2 = await abrirCanal(s.token, 'tel-A');
    try {
      assert.ok(await espera(() => a.terminado()), 'el canal viejo de A se cerró');
      assert.match(a.texto(), /: fin reemplazado\n/);
      assert.equal(oyentesDe('dos@x.com'), 2);
    } finally {
      await a2.cerrar();
    }
  } finally {
    await a.cerrar();
    await b.cerrar();
  }
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

test('A20: el contexto es del aparato que lo manda: dos teléfonos de la misma cuenta no se pisan', async () => {
  _reiniciarAccionesApp();
  const mandar = (aparato: string, nombre: string) =>
    fetch(`${base}/api/app/contexto`, {
      method: 'POST',
      headers: { ...h(yo.token), 'x-aura-aparato': aparato },
      body: JSON.stringify({ pantalla: 'chats', chatAbierto: { correo: `${nombre.toLowerCase()}@x.com`, nombre }, contactos: [] }),
    });
  assert.equal((await mandar('tel-A', 'Beto')).status, 200);
  assert.equal((await mandar('tel-B', 'Carla')).status, 200);
  assert.equal(contextoDe(AA.ambitoApp('maria@ordenglobal.org', 'tel-A'))?.chatAbierto?.nombre, 'Beto');
  assert.equal(contextoDe(AA.ambitoApp('maria@ordenglobal.org', 'tel-B'))?.chatAbierto?.nombre, 'Carla');
  assert.equal(contextoDe('maria@ordenglobal.org'), null, 'lo de un aparato no es de la cuenta entera');
});

test('A20: A propone llamar a X, B propone recordar Y, A confirma: solo la propuesta de A se cumple en A', () => {
  _reiniciarAccionesApp();
  const A = AA.ambitoApp('dos@x.com', 'tel-A');
  const B = AA.ambitoApp('dos@x.com', 'tel-B');
  AA.abrirTurnoApp(A);
  AA.anotarPropuesta(A, { tipo: 'llamar', con: 'x@x.com', nombre: 'Xavi', video: false });
  AA.abrirTurnoApp(B);
  AA.anotarPropuesta(B, { tipo: 'recordatorio', texto: 'comprar pan', cuando: Date.now() + 3600_000 });
  // El «sí» llega en el turno siguiente de A.
  AA.abrirTurnoApp(A);
  assert.equal(AA.propuestaAnterior(A)?.tipo, 'llamar', 'en A se cumple lo que oyó A');
  // Cumplir la de A no suelta la de B.
  empujarAccion('dos@x.com', { tipo: 'llamar', con: 'x@x.com', video: false } as any, { aparato: 'tel-A' });
  assert.equal(AA.propuestaAnterior(A), null);
  AA.abrirTurnoApp(B);
  assert.equal(AA.propuestaAnterior(B)?.tipo, 'recordatorio', 'la de B sigue esperando su «sí» en B');
});

test('A21: el canal que vuelve con Last-Event-ID recibe lo que se perdió (reciente), y nada si no se conoce el id', async () => {
  _reiniciarAccionesApp();
  const s = emitirSesion({ correo: 'tres@x.com', nombre: 'Tres', rol: 'Junta' }, { comunidad: true });
  const c1 = await abrirCanal(s.token, 'tel-C');
  let e1 = '';
  try {
    assert.ok(await espera(() => oyentesDe('tres@x.com') === 1));
    e1 = empujarAccion('tres@x.com', { tipo: 'abrir', pantalla: 'chats' }, { aparato: 'tel-C' }).evento.id;
    assert.ok(await espera(() => c1.texto().includes(e1)));
  } finally {
    await c1.cerrar();
  }
  await espera(() => oyentesDe('tres@x.com') === 0);
  // Mientras estaba cortado: dos acciones que no le llegan a nadie.
  const e2 = empujarAccion('tres@x.com', { tipo: 'redactar', para: 'beto@x.com', texto: 'llego tarde' } as any, { aparato: 'tel-C' });
  const e3 = empujarAccion('tres@x.com', { tipo: 'abrir', pantalla: 'mesa' }, { aparato: 'tel-C' });
  assert.equal(e2.entregada + e3.entregada, 0);
  // Vuelve diciendo que lo último que recibió fue e1.
  const ctrl = new AbortController();
  const r = await fetch(`${base}/api/app/acciones`, { headers: { ...h(s.token), 'x-aura-aparato': 'tel-C', 'last-event-id': e1 }, signal: ctrl.signal });
  let texto = '';
  const dec = new TextDecoder();
  const leer = (async () => {
    try {
      for await (const t of r.body as any) texto += dec.decode(t, { stream: true });
    } catch {
      /* cerrado */
    }
  })();
  assert.ok(await espera(() => texto.includes(e2.evento.id) && texto.includes(e3.evento.id)), texto);
  assert.ok(!texto.includes(`id: ${e1}\n`), 'lo que ya recibió no se repite');
  assert.ok(texto.indexOf(e2.evento.id) < texto.indexOf(e3.evento.id), 'en orden');
  // Una acción nueva que llega ya con el canal abierto va DESPUÉS de lo atrasado (nunca intercalada).
  assert.ok(await espera(() => oyentesDe('tres@x.com') === 1));
  const e4 = empujarAccion('tres@x.com', { tipo: 'abrir', pantalla: 'chats' }, { aparato: 'tel-C' });
  assert.equal(e4.entregada, 1);
  assert.ok(await espera(() => texto.includes(e4.evento.id)), texto);
  assert.ok(texto.indexOf(e3.evento.id) < texto.indexOf(e4.evento.id), 'lo nuevo después de lo repetido');
  assert.equal(texto.split(`id: ${e4.evento.id}\n`).length - 1, 1, 'lo nuevo llega una sola vez');
  ctrl.abort();
  await leer;
  // Un id que no se conoce (otro servidor, o de hace rato): no se adivina.
  assert.deepEqual(AA.accionesDesde('tres@x.com', 'tel-C', 'no-existe'), []);
  // Pasado el plazo, nada se repite solo.
  assert.deepEqual(AA.accionesDesde('tres@x.com', 'tel-C', e1, Date.now() + AA.ACCION_REPETIBLE_MS + 1), []);
});

test('PUT /api/perfil con S3 caído y sin copia local: 503 y no se sube nada encima', async () => {
  const fetchOriginal = globalThis.fetch;
  let puts = 0;
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const u = new URL(String(url));
    if (!u.hostname.endsWith('.amazonaws.com')) return fetchOriginal(url, init);
    if (init.method === 'PUT') puts++;
    return new Response('fuera', { status: 503 });
  }) as typeof fetch;
  Object.assign(process.env, { ULTRON_MEMORIA_BUCKET: 'cubo-prueba', AWS_ACCESS_KEY_ID: 'AKIAPRUEBA', AWS_SECRET_ACCESS_KEY: 'secreto-prueba' });
  try {
    const s = emitirSesion({ correo: 'sin-s3@x.com', nombre: 'Sin Ese', rol: 'Junta' }, { comunidad: true });
    const r = await fetch(`${base}/api/perfil`, { method: 'PUT', headers: h(s.token), body: JSON.stringify({ apodo: 'Nuevo' }) });
    assert.equal(r.status, 503);
    assert.equal(((await r.json()) as any).code, 'perfil_no_disponible');
    assert.equal(puts, 0, 'no se pisó el perfil que no se pudo leer');
  } finally {
    globalThis.fetch = fetchOriginal;
    Object.assign(process.env, { ULTRON_MEMORIA_BUCKET: '', AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '' });
  }
});

test('POST /api/app/recibo (F02): con la sesión y el aparato al que salió la acción; idempotente; un id ajeno no confirma nada', async () => {
  const { efectosRecientes, _olvidarEfectos } = await import('../lib/honestidad');
  _olvidarEfectos();
  const ha = (token: string, aparato: string) => ({ ...h(token), 'x-aura-aparato': aparato });
  const salio = empujarAccion(yo.correo, { tipo: 'abrir_app', app: 'Spotify' }, { aparato: 'tel-recibo-1' }).evento;
  assert.equal((await fetch(`${base}/api/app/recibo`, { method: 'POST', headers: h(), body: JSON.stringify({ id: salio.id, ok: true }) })).status, 401, 'sin sesión no');
  const otra = emitirSesion({ correo: 'ajena@x.com', nombre: 'Ajena', rol: 'Junta' }, { comunidad: true });
  assert.equal((await fetch(`${base}/api/app/recibo`, { method: 'POST', headers: ha(otra.token, 'tel-recibo-1'), body: JSON.stringify({ id: salio.id, ok: true }) })).status, 409, 'de otra cuenta no');
  assert.equal((await fetch(`${base}/api/app/recibo`, { method: 'POST', headers: ha(yo.token, 'tel-otro-9'), body: JSON.stringify({ id: salio.id, ok: true }) })).status, 409, 'de otro aparato no');
  assert.deepEqual(efectosRecientes(yo.correo), []);
  const r: any = await (await fetch(`${base}/api/app/recibo`, { method: 'POST', headers: ha(yo.token, 'tel-recibo-1'), body: JSON.stringify({ id: salio.id, ok: true }) })).json();
  assert.equal(r.estado, 'aceptado');
  assert.deepEqual(
    efectosRecientes(yo.correo).map((e) => [e.canal, e.estado, e.destino]),
    [['app', 'confirmado', 'Spotify']]
  );
  const otraVez: any = await (await fetch(`${base}/api/app/recibo`, { method: 'POST', headers: ha(yo.token, 'tel-recibo-1'), body: JSON.stringify({ id: salio.id, ok: false }) })).json();
  assert.equal(otraVez.estado, 'repetido', 'el primero manda');
  assert.equal(efectosRecientes(yo.correo).length, 1);
  assert.equal((await fetch(`${base}/api/app/recibo`, { method: 'POST', headers: ha(yo.token, 'tel-recibo-1'), body: JSON.stringify({ id: 'inventado', ok: true }) })).status, 409);
});

test('POST /api/app/aparato: el latido del aparato (tipo, versión, habilidades, permisos) con su id; sin id o mal formado, 400', async () => {
  const ha = (aparato?: string) => ({ ...h(yo.token), ...(aparato ? { 'x-aura-aparato': aparato } : {}) });
  assert.equal((await fetch(`${base}/api/app/aparato`, { method: 'POST', headers: ha(), body: JSON.stringify({ tipo: 'android' }) })).status, 400, 'sin aparato');
  assert.equal((await fetch(`${base}/api/app/aparato`, { method: 'POST', headers: ha('tel-latido-1'), body: JSON.stringify({ tipo: 'tostadora' }) })).status, 400);
  const r = await fetch(`${base}/api/app/aparato`, { method: 'POST', headers: ha('tel-latido-1'), body: JSON.stringify({ tipo: 'android', version: '5.7.1', habilidades: ['abrir_apps'], permisos: { notificaciones: 'si' } }) });
  assert.equal(r.status, 200);
  const { aparatosDe } = await import('../lib/aparatos');
  const xs = await aparatosDe(yo.correo);
  assert.deepEqual(
    xs.map((a) => [a.id, a.version, a.habilidades]),
    [['tel-latido-1', '5.7.1', ['abrir_apps']]]
  );
});
