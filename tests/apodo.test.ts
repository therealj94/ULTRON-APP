/**
 * Cómo quiere que le llamen (lib/apodo.ts) y lo que cuenta en las preguntas de la primera vez
 * (POST /api/cerebro/conocer): sin apodo elegido AURA lo pregunta; lo que contesta se reconoce sin
 * modelo, se guarda en el perfil (`apodoElegido`) y ese mismo turno ya lo usa.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apodo-'));
Object.assign(process.env, {
  ULTRON_PERFILES_DIR: path.join(dir, 'pe'),
  ULTRON_CONOCER_DIR: path.join(dir, 'co'),
  ULTRON_CIRCULO_DIR: path.join(dir, 'ci'),
  ULTRON_ABIERTOS_DIR: path.join(dir, 'ab'),
  ULTRON_EPISODIOS_DIR: path.join(dir, 'ep'),
  ULTRON_SESIONES_CERRADAS_ARCHIVO: path.join(dir, 'cerradas.json'),
  ULTRON_SESION_SECRETO: 'secreto-de-prueba-largo-para-las-sesiones-apodo',
  ULTRON_MEMORIA_BUCKET: '',
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const A = await import('../lib/apodo');
const P = await import('../lib/perfil-persona');
const K = await import('../lib/conocer-persona');
const { montarRutasCerebroContinuo } = await import('../server/cerebro-continuo');
const { emitirSesion, sesionDe, exigirMesa } = await import('../server/seguridad');

test('apodoPendiente: sin perfil, o con el de relleno; no si lo eligió o terminó la primera vez', () => {
  assert.equal(A.apodoPendiente(null), true);
  const base = P.perfilInicial({ apodo: 'José' });
  assert.equal(A.apodoPendiente(base), true, 'el primer nombre puesto por el servidor es de relleno');
  assert.equal(A.apodoPendiente({ ...base, completado: true }), false, 'terminó la primera vez: lo eligió ahí');
  assert.equal(A.apodoPendiente({ ...base, apodoElegido: true }), false);
});

test('preguntoApodo: reconoce cuando AURA lo preguntó', () => {
  assert.ok(A.preguntoApodo('¡Hola! Antes de seguir, ¿cómo quieres que te llame?'));
  assert.ok(A.preguntoApodo('Oye, ¿cómo prefieres que te diga?'));
  assert.ok(A.preguntoApodo('What would you like me to call you?'));
  assert.ok(!A.preguntoApodo('¿Cómo estás hoy?'));
});

test('detectarApodo: órdenes claras en cualquier momento', () => {
  assert.equal(A.detectarApodo('Llámame Chepe'), 'Chepe');
  assert.equal(A.detectarApodo('llámame chepe'), 'Chepe');
  assert.equal(A.detectarApodo('Mi apodo es Pepe'), 'Pepe');
  assert.equal(A.detectarApodo('de ahora en adelante dime jefe'), 'Jefe');
  assert.equal(A.detectarApodo('Dime Don José'), 'Don José');
  assert.equal(A.detectarApodo('call me Joe'), 'Joe');
  assert.equal(A.detectarApodo('dime algo'), null, '«dime» sin mayúscula es «cuéntame»');
  assert.equal(A.detectarApodo('dime la hora'), null);
  assert.equal(A.detectarApodo('José'), null, 'un nombre suelto sin haberlo preguntado no se toma');
  assert.equal(A.detectarApodo('Llámame mañana a las seis para recordarme la cita'), null, 'eso es un recordatorio');
});

test('detectarApodo: la respuesta corta justo después de preguntarlo', () => {
  const p = { preguntado: true };
  assert.equal(A.detectarApodo('Chepe', p), 'Chepe');
  assert.equal(A.detectarApodo('José está bien', p), 'José');
  assert.equal(A.detectarApodo('Pepe, por favor', p), 'Pepe');
  assert.equal(A.detectarApodo('pues dime jefe', p), 'Jefe');
  assert.equal(A.detectarApodo('Me dicen Toño', p), 'Toño');
  assert.equal(A.detectarApodo('María José', p), 'María José');
  assert.equal(A.detectarApodo('como quieras', p), null);
  assert.equal(A.detectarApodo('no sé', p), null);
  assert.equal(A.detectarApodo('sí', p), null);
  assert.equal(A.detectarApodo('¿qué tiempo hace hoy en Tegucigalpa?', p), null, 'otra pregunta no es un nombre');
});

test('lineaApodoPendiente: le pide a AURA preguntar una vez; vacía si ya lo sabe', () => {
  const l = A.lineaApodoPendiente(null, 'es', { nombre: 'José Enamorado' });
  assert.match(l, /^AÚN NO SABES CÓMO QUIERE QUE LE LLAMES/);
  assert.match(l, /«¿Cómo quieres que te llame\?»/);
  assert.match(l, /«José»/);
  assert.match(l, /no insistas/);
  assert.match(A.lineaApodoPendiente(null, 'en'), /What would you like me to call you/);
  assert.equal(A.lineaApodoPendiente({ ...P.perfilInicial({ apodo: 'Chepe' }), apodoElegido: true }), '');
  // El perfil no dice «así pidió que le llamaras» de un apodo de relleno.
  assert.match(P.lineaPerfil(P.perfilInicial({ apodo: 'José' })), /Le dices «José» por ahora \(es de relleno/);
  assert.match(P.lineaPerfil({ ...P.perfilInicial({ apodo: 'Chepe' }), apodoElegido: true }), /Le dices «Chepe» \(así pidió/);
});

test('conApodoDelTurno: guarda lo que dijo y el turno ya lo usa; si no dijo nada, el perfil tal cual', async () => {
  const guardados: [string, string][] = [];
  const guardar = async (c: string, a: string) => void guardados.push([c, a]);
  const hilo = [{ role: 'assistant' as const, content: '¡Bienvenido! ¿Cómo quieres que te llame?' }];
  const p0 = P.perfilInicial({ apodo: 'José' });
  const p1 = await A.conApodoDelTurno('jose@x.com', 'Dime Pepe', hilo, p0, guardar);
  assert.equal(p1?.apodo, 'Pepe');
  assert.equal(p1?.apodoElegido, true);
  assert.deepEqual(guardados, [['jose@x.com', 'Pepe']]);
  // «José está bien»: el mismo nombre de relleno, pero ahora elegido (se guarda para no volver a preguntar).
  const p2 = await A.conApodoDelTurno('jose@x.com', 'José está bien', hilo, p0, guardar);
  assert.equal(p2?.apodoElegido, true);
  assert.equal(guardados.length, 2);
  // Ya elegido: una respuesta suelta no cambia nada; sin correo, tampoco.
  assert.equal(await A.conApodoDelTurno('jose@x.com', 'Toño', hilo, p1, guardar), p1);
  assert.equal(await A.conApodoDelTurno('', 'Llámame Toño', hilo, p1, guardar), p1);
  assert.equal(await A.conApodoDelTurno('jose@x.com', '¿qué hora es?', [], p0, guardar), p0);
  assert.equal(guardados.length, 2);
});

test('de verdad en el perfil: actualizarPerfil marca el apodo elegido y sobrevive a leerlo de disco', async () => {
  await A.conApodoDelTurno('ana@x.com', 'Llámame Anita', [], null);
  await new Promise((r) => setTimeout(r, 50));
  P._olvidarCachePerfiles();
  const p = await P.leerPerfil('ana@x.com');
  assert.equal(p?.apodo, 'Anita');
  assert.equal(p?.apodoElegido, true);
  assert.equal(A.apodoPendiente(p), false);
  // Un PUT con otra cosa (el tema) no lo marca; el de relleno sigue pendiente.
  const { perfil } = await P.actualizarPerfil('beto@x.com', { tema: 'claro' }, { apodo: 'Beto' });
  assert.equal(perfil.apodoElegido, undefined);
  assert.equal(A.apodoPendiente(perfil), true);
});

test('la encuesta trae «lo que quiere que hagas por ella» y el prompt lo dice', () => {
  const v = P.validarCambios({ encuesta: { ayuda: 'Recordarme mis citas y ayudarme con correos' } });
  assert.ok(v.ok);
  const p = P.aplicarCambios(P.perfilInicial({ apodo: 'José' }), v.ok ? v.cambios : {});
  assert.match(P.lineaPerfil(p), /Lo que quiere que hagas por ella: Recordarme mis citas/);
});

test('el turno pregunta el apodo y lo guarda (server.ts)', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '../server.ts'), 'utf8');
  assert.match(src, /const perfilPersona = await conApodoDelTurno\(correoApp, message, hilo, await perfilPedido\)/);
  assert.match(src, /lineaApodoPendiente\(perfilPersona/);
});

/* ------------------------------------------------------------------ POST /api/cerebro/conocer */

const app = express();
app.use(express.json());
const pasa = () => ((_q: express.Request, _s: express.Response, n: express.NextFunction) => n()) as express.RequestHandler;
montarRutasCerebroContinuo(app, { exigirMesa, limitar: pasa, sesionDe: (req) => sesionDe(req) });
const srv = app.listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
after(() => srv.close());
const jose = emitirSesion({ correo: 'jose@x.com', nombre: 'José', rol: 'Junta' }, { comunidad: true });
const otra = emitirSesion({ correo: 'otra@x.com', nombre: 'Otra', rol: 'Junta' }, { comunidad: true });
const pedir = async (ruta: string, init: RequestInit & { token?: string } = {}) => {
  const r = await fetch(`${base}${ruta}`, { ...init, headers: { 'content-type': 'application/json', ...(init.token ? { 'x-ultron-sesion': init.token } : {}) } });
  return { status: r.status, j: (await r.json().catch(() => null)) as any };
};

test('POST /api/cerebro/conocer: lo de la primera vez queda en «lo que sé de ti», por la sesión', async () => {
  const cuerpo = (o: object) => ({ method: 'POST', body: JSON.stringify(o) });
  assert.equal((await pedir('/api/cerebro/conocer', cuerpo({ categoria: 'trabajo', dato: 'Se dedica a la minería' }))).status, 401, 'sin sesión no');
  const r = await pedir('/api/cerebro/conocer', { ...cuerpo({ categoria: 'trabajo', dato: 'Se dedica a la minería', clave: 'oficio' }), token: jose.token });
  assert.equal(r.status, 200);
  assert.equal(r.j.dato.fuente, 'manual');
  assert.equal(r.j.dato.confianza, 1);
  // Otra respuesta a la misma pregunta reemplaza a la anterior (misma clave), no la duplica.
  await pedir('/api/cerebro/conocer', { ...cuerpo({ categoria: 'trabajo', dato: 'Se dedica a la minería y al comercio', clave: 'oficio' }), token: jose.token });
  const s = await K.queSeDe('jose@x.com');
  assert.equal(s.porCategoria.trabajo.length, 1);
  assert.equal(s.porCategoria.trabajo[0].dato, 'Se dedica a la minería y al comercio');
  assert.equal((await K.queSeDe('otra@x.com')).total, 0, 'no cae en otra persona');
  assert.equal((await pedir('/api/cerebro/conocer', { ...cuerpo({ categoria: 'banco', dato: 'Algo que no' }), token: otra.token })).status, 400);
  assert.equal((await pedir('/api/cerebro/conocer', { ...cuerpo({ categoria: 'otros', dato: 'no' }), token: otra.token })).status, 400, 'muy corto');
  const secreto = await pedir('/api/cerebro/conocer', { ...cuerpo({ categoria: 'otros', dato: 'Mi contraseña del banco es 1234' }), token: otra.token });
  assert.equal(secreto.status, 400, 'un secreto no se guarda');
  assert.equal((await K.queSeDe('otra@x.com')).total, 0);
});
