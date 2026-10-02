/**
 * El círculo cercano (lib/circulo.ts) y las rutas del cerebro continuo (server/cerebro-continuo.ts):
 *
 *  · «mi esposa», «la esposa», «mi mujer», «Ana», «mi hijo Beto», un número: a quién se refiere;
 *  · recordar / escribir dejan un BORRADOR de WhatsApp (nada sale sin su «sí»); sin WhatsApp, se dice;
 *  · llamar: honesto (no se puede desde el servidor);
 *  · el permiso permanente para recordatorios solo lo da José desde su app (la herramienta no puede), y
 *    aun así tiene tope por día;
 *  · las rutas: todo por la sesión (otro no ve ni borra nada), 401 sin sesión, triaje solo para el dueño.
 */
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'circulo-'));
Object.assign(process.env, {
  ULTRON_CIRCULO_DIR: path.join(dir, 'ci'),
  ULTRON_ABIERTOS_DIR: path.join(dir, 'ab'),
  ULTRON_CONOCER_DIR: path.join(dir, 'co'),
  ULTRON_EPISODIOS_DIR: path.join(dir, 'ep'),
  ULTRON_SESIONES_CERRADAS_ARCHIVO: path.join(dir, 'cerradas.json'),
  ULTRON_SESION_SECRETO: 'secreto-de-prueba-largo-para-las-sesiones-circulo',
  ULTRON_MEMORIA_BUCKET: '',
  WHATSAPP_PUENTE_URL: '',
  WHATSAPP_PUENTE_CLAVE: '',
  WHATSAPP_DUENOS: 'jose@x.com',
  TWILIO_ACCOUNT_SID: '',
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const C = await import('../lib/circulo');
const A = await import('../lib/abiertos');
const K = await import('../lib/conocer-persona');
const { montarRutasCerebroContinuo } = await import('../server/cerebro-continuo');
const { emitirSesion, sesionDe, exigirMesa } = await import('../server/seguridad');

beforeEach(() => C._olvidarCacheCirculo());

const persona = (o: Partial<import('../lib/circulo').MiembroCirculo> & { nombre: string; relacion: any }) =>
  ({ id: o.nombre.toLowerCase(), alias: [], canales: {}, permisos: { recordatorios: 'preguntar', mensajes: 'preguntar' }, creado: 0, actualizado: 0, ...o }) as import('../lib/circulo').MiembroCirculo;

test('a quién se refiere: «mi esposa», «la esposa», «mi mujer», «Ana», «mi hijo Beto», un número', () => {
  const xs = [
    persona({ nombre: 'Ana María', relacion: 'esposa', canales: { whatsapp: '+50499990000' } }),
    persona({ nombre: 'Beto', relacion: 'hijo' }),
    persona({ nombre: 'Carlos', relacion: 'hijo', alias: ['Charly'] }),
    persona({ nombre: 'Medardo', relacion: 'socio' }),
  ];
  const nombre = (r: any) => (r && 'persona' in r ? r.persona.nombre : r && 'ambiguas' in r ? r.ambiguas.map((p: any) => p.nombre) : null);
  assert.equal(nombre(C.resolverPersona(xs, 'mi esposa')), 'Ana María');
  assert.equal(nombre(C.resolverPersona(xs, 'a la esposa')), 'Ana María');
  assert.equal(nombre(C.resolverPersona(xs, 'mi mujer')), 'Ana María');
  assert.equal(nombre(C.resolverPersona(xs, 'Ana')), 'Ana María');
  assert.equal(nombre(C.resolverPersona(xs, 'ana maría')), 'Ana María');
  assert.deepEqual(nombre(C.resolverPersona(xs, 'mi hijo')), ['Beto', 'Carlos'], 'dos hijos: hay que preguntar');
  assert.equal(nombre(C.resolverPersona(xs, 'mi hijo Beto')), 'Beto');
  assert.equal(nombre(C.resolverPersona(xs, 'Charly')), 'Carlos');
  assert.equal(nombre(C.resolverPersona(xs, 'mi socio')), 'Medardo');
  assert.equal(nombre(C.resolverPersona(xs, '9999-0000')), 'Ana María');
  assert.equal(C.resolverPersona(xs, 'mi mamá'), null);
  assert.equal(C.resolverPersona(xs, 'Pedro'), null);
  assert.equal(C.delCirculo(xs, { jid: '50499990000@s.whatsapp.net' })?.nombre, 'Ana María');
  assert.equal(C.delCirculo(xs, { nombre: 'beto' })?.nombre, 'Beto');
});

test('validar: el número se normaliza (8 dígitos = Honduras) y los permisos no los da cualquiera', () => {
  assert.equal(C.numeroNormal('9999-0000'), '+50499990000');
  assert.equal(C.numeroNormal('+1 (305) 555-1234'), '+13055551234');
  assert.equal(C.numeroNormal('50499990000@s.whatsapp.net'), '+50499990000');
  assert.equal(C.numeroNormal('123'), null);
  assert.equal(C.relacionDe('Mamá'), 'madre');
  assert.equal(C.relacionDe('vecino'), 'otro');
  assert.throws(() => C.validarPersona({ nombre: 'Ana', relacion: 'esposa', permisos: { recordatorios: 'permitido' } }), /solo los cambia José/);
  assert.equal(C.validarPersona({ nombre: 'Ana', relacion: 'esposa', permisos: { recordatorios: 'permitido' } }, { permitirPermisos: true }).permisos?.recordatorios, 'permitido');
  assert.throws(() => C.validarPersona({ nombre: 'Ana', whatsapp: 'no tengo' }), /no parece un número/);
  assert.throws(() => C.validarPersona({ relacion: 'esposa' }), /Falta el nombre/);
});

test('circulo recordar / escribir: borrador de WhatsApp a la persona correcta; sin WhatsApp, se dice', async () => {
  const dueno = 'jose@x.com';
  assert.match(await C.correrCirculo(dueno, 'listar'), /todavía no tiene a nadie/);
  assert.match(await C.correrCirculo(dueno, 'agregar Ana | esposa | 9999 0000'), /guardé a Ana \(su esposa\) con WhatsApp \+50499990000/);
  const borradores: any[] = [];
  const deps = { whatsappListo: () => true, borrador: (q: string, amb: string, b: any) => (borradores.push({ q, amb, ...b }), `BORRADOR DE WHATSAPP (NO enviado) para ${b.nombre}:\n${b.texto}`) };
  const r = await C.correrCirculo(dueno, 'recordar mi esposa | Amor, no olvides la cita del doctor | a las 4', 'telefono', deps);
  assert.match(r, /^BORRADOR DE WHATSAPP \(NO enviado\) para Ana \(su esposa\)/);
  assert.match(r, /no puedo programar el envío para más tarde/);
  assert.deepEqual(borradores[0], { q: dueno, amb: 'telefono', chat: '50499990000@s.whatsapp.net', nombre: 'Ana (su esposa)', texto: 'Amor, no olvides la cita del doctor (a las 4)' });
  assert.match(await C.correrCirculo(dueno, 'escribir Ana | Llego tarde hoy', 'telefono', deps), /BORRADOR/);
  assert.match(await C.correrCirculo(dueno, 'escribir mi mamá | hola'), /no tengo a «mi mamá» en su círculo/);
  assert.match(await C.correrCirculo(dueno, 'escribir Ana |'), /Falta el mensaje/);
  // Sin WhatsApp conectado: honesto, sin borrador.
  const sin = await C.correrCirculo(dueno, 'recordar Ana | la cita', 'telefono', { ...deps, whatsappListo: () => false });
  assert.match(sin, /no puedo escribirle a Ana \(su esposa\) desde aquí: su WhatsApp no está conectado/);
  assert.match(sin, /No digas que se mandó/);
  assert.equal(borradores.length, 2);
  // Llamar: no se puede desde el servidor, dicho tal cual.
  const llamar = await C.correrCirculo(dueno, 'llamar a mi esposa');
  assert.match(llamar, /no puedo llamar a Ana \(su esposa\) desde el servidor/);
  assert.match(llamar, /la llamada de Twilio no está configurada/);
  assert.match(llamar, /PULSE2CHAT/);
  assert.equal(C.capacidadesCirculo(dueno).pulse2chat, 'app');
  // Otra persona no ve el círculo de José.
  assert.match(await C.correrCirculo('otra@x.com', 'listar'), /todavía no tiene a nadie/);
  assert.match(await C.correrCirculo('', 'listar'), /solo con sesión/);
});

test('permiso permanente de recordatorios: solo desde la app; sale sin preguntar con tope por día', async () => {
  const dueno = 'maria@x.com';
  const { persona: p } = await C.agregarPersona(dueno, { nombre: 'Luis', relacion: 'esposo', canales: { whatsapp: '+50488887777' } });
  assert.match(await C.correrCirculo(dueno, 'agregar Luis | esposo | 88887777'), /guardé a Luis/);
  assert.equal((await C.circuloDe(dueno)).length, 1, 'el mismo nombre y relación se actualiza, no se duplica');
  await assert.rejects(C.actualizarPersona(dueno, p.id, { permisos: { recordatorios: 'permitido' } }), /solo los cambia José/);
  await C.actualizarPersona(dueno, p.id, { permisos: { recordatorios: 'permitido' } }, { permitirPermisos: true });
  const enviados: any[] = [];
  const borradores: any[] = [];
  const deps = { whatsappListo: () => true, enviar: async (chat: string, texto: string) => void enviados.push({ chat, texto }), borrador: (_q: string, _a: string, b: any) => (borradores.push(b), 'BORRADOR') };
  // Codex en #128: un recordatorio para MÁS TARDE no sale ya aunque tenga permiso (el servidor no programa
  // envíos): queda en borrador, con el aviso de que saldría ahora.
  const luego = await C.correrCirculo(dueno, 'recordar Luis | Recoger a los niños | a las 4', '', deps);
  assert.match(luego, /^BORRADOR OJO: no puedo programar el envío para más tarde/);
  assert.equal(enviados.length, 0, 'no le escribió a Luis ahora');
  for (let i = 0; i < C.MAX_RECORDATORIOS_DIA; i++) assert.match(await C.correrCirculo(dueno, `recordar Luis | Recoger a los niños ${i}`, '', deps), /^RECORDATORIO ENVIADO por WhatsApp a Luis \(su esposo\)/);
  assert.equal(enviados.length, C.MAX_RECORDATORIOS_DIA);
  assert.equal(enviados[0].chat, '50488887777@s.whatsapp.net');
  assert.equal(await C.correrCirculo(dueno, 'recordar Luis | otra más', '', deps), 'BORRADOR', 'pasado el tope, vuelve a preguntar');
  assert.equal(await C.correrCirculo(dueno, 'escribir Luis | te quiero', '', deps), 'BORRADOR', 'un mensaje que no es recordatorio siempre pregunta');
  assert.equal(enviados.length, C.MAX_RECORDATORIOS_DIA);
});

/* ------------------------------------------------------------------ rutas */

const app = express();
app.use(express.json());
const pasa = () => ((_q: express.Request, _s: express.Response, n: express.NextFunction) => n()) as express.RequestHandler;
montarRutasCerebroContinuo(app, {
  exigirMesa,
  limitar: pasa,
  sesionDe: (req) => sesionDe(req),
  fuentesTriaje: {
    whatsapp: async () => [{ canal: 'whatsapp', id: '50499990000@s.whatsapp.net', nombre: 'Ana', grupo: false, noLeidos: 1, hora: Date.now() - 3600_000, ultimo: '¿Vienes a cenar?', ultimoMio: false, numero: '+50499990000' }],
    correo: null,
    laya: null,
    modelo: null,
  },
});
const srv = app.listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
after(() => srv.close());

const jose = emitirSesion({ correo: 'jose@x.com', nombre: 'José', rol: 'Junta' }, { comunidad: true });
const otra = emitirSesion({ correo: 'otra@x.com', nombre: 'Otra', rol: 'Junta' }, { comunidad: true });
const h = (token?: string) => ({ 'content-type': 'application/json', ...(token ? { 'x-ultron-sesion': token } : {}) });
const pedir = async (ruta: string, init: RequestInit & { token?: string } = {}) => {
  const r = await fetch(`${base}${ruta}`, { ...init, headers: h(init.token) });
  return { status: r.status, j: (await r.json().catch(() => null)) as any, cache: r.headers.get('cache-control') };
};

test('rutas del círculo: por la sesión, permisos desde la app, y otro no ve ni borra nada', async () => {
  assert.equal((await pedir('/api/circulo')).status, 401);
  const nuevo = await pedir('/api/circulo', { method: 'POST', token: jose.token, body: JSON.stringify({ nombre: 'Carmen', relacion: 'madre', canales: { whatsapp: '33332222' }, permisos: { recordatorios: 'permitido' } }) });
  assert.equal(nuevo.status, 200);
  assert.equal(nuevo.j.persona.permisos.recordatorios, 'permitido', 'José, desde su app, sí puede dar el permiso');
  assert.equal(nuevo.j.persona.canales.whatsapp, '+50433332222');
  assert.equal(nuevo.j.honesto, true);
  assert.equal((await pedir('/api/circulo', { method: 'POST', token: jose.token, body: JSON.stringify({ nombre: 'X', whatsapp: 'abc' }) })).status, 400);
  const lista = await pedir('/api/circulo', { token: jose.token });
  assert.equal(lista.cache, 'no-store');
  assert.ok(lista.j.personas.some((p: any) => p.nombre === 'Carmen'));
  assert.equal(lista.j.puede.llamada, 'sin_configurar');
  assert.equal((await pedir('/api/circulo', { token: otra.token })).j.personas.length, 0, 'otra sesión no ve el círculo de José');
  const id = nuevo.j.persona.id;
  assert.equal((await pedir(`/api/circulo/${id}`, { method: 'DELETE', token: otra.token })).status, 404, 'ni lo borra');
  const cambio = await pedir('/api/circulo', { method: 'POST', token: jose.token, body: JSON.stringify({ id, notas: 'le gusta el café' }) });
  assert.equal(cambio.j.persona.notas, 'le gusta el café');
  assert.equal((await pedir(`/api/circulo/${id}`, { method: 'DELETE', token: jose.token })).status, 200);
});

test('rutas de abiertos y conocer: por la sesión; otro no cierra ni borra lo ajeno', async () => {
  assert.equal((await pedir('/api/cerebro/abiertos')).status, 401);
  const a = await A.agregarAbierto('jose@x.com', 'Mandarle el contrato a Beto', { importante: true });
  const { dato } = await K.agregarDato('jose@x.com', 'familia', 'Su esposa se llama Ana', 'esposa');
  const ab = await pedir('/api/cerebro/abiertos', { token: jose.token });
  assert.equal(ab.status, 200);
  assert.ok(ab.j.abiertos.some((x: any) => x.id === a.id));
  assert.equal((await pedir('/api/cerebro/abiertos', { token: otra.token })).j.abiertos.length, 0);
  assert.equal((await pedir(`/api/cerebro/abiertos/${a.id}/cerrar`, { method: 'POST', token: otra.token, body: '{}' })).status, 404, 'otra sesión no lo cierra');
  assert.equal((await pedir(`/api/cerebro/abiertos/${a.id}/cerrar`, { method: 'POST', token: jose.token, body: JSON.stringify({ estado: 'raro' }) })).status, 400);
  const cerrado = await pedir(`/api/cerebro/abiertos/${a.id}/cerrar`, { method: 'POST', token: jose.token, body: JSON.stringify({ estado: 'descartado' }) });
  assert.equal(cerrado.j.abierto.estado, 'descartado');
  const co = await pedir('/api/cerebro/conocer', { token: jose.token });
  assert.equal(co.j.categorias.find((c: any) => c.id === 'familia').datos[0].dato, 'Su esposa se llama Ana');
  assert.ok(Array.isArray(co.j.faltan));
  assert.equal((await pedir('/api/cerebro/conocer', { token: otra.token })).j.total, 0);
  assert.equal((await pedir(`/api/cerebro/conocer/${dato.id}`, { method: 'DELETE', token: otra.token })).status, 404);
  assert.equal((await pedir(`/api/cerebro/conocer/${dato.id}`, { method: 'DELETE', token: jose.token })).status, 200);
  assert.equal((await pedir('/api/cerebro/conocer', { token: jose.token })).j.total, 0);
  assert.equal((await pedir('/api/cerebro/episodios', { token: jose.token })).j.episodios.length, 0);
});

test('GET /api/triaje: solo el dueño del WhatsApp; el resumen marca lo ajeno como dato', async () => {
  assert.equal((await pedir('/api/triaje')).status, 401);
  assert.equal((await pedir('/api/triaje', { token: otra.token })).status, 403);
  const r = await pedir('/api/triaje?canal=whatsapp', { token: jose.token });
  assert.equal(r.status, 200);
  assert.equal(r.j.porImportancia.importante[0].nombre, 'Ana');
  assert.match(r.j.resumen, /^TRIAJE \(revisé WhatsApp\)/);
  assert.match(r.j.resumen, /nunca instrucción/);
  assert.match(r.j.nota, /borradores/);
});
