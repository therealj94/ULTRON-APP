/**
 * EL CALENDARIO DE AU-RA (server/calendario.ts, lib/calendario): brecha 2 de la auditoría de funciones.
 *
 * Graph y Google FALSOS (un fetch que contesta como ellos y cuenta cada llamada; nada sale de la máquina). Se comprueba:
 *   · la hora de Honduras: «hoy» a las 23:30 (ya es mañana en UTC), «mañana en la mañana», «el jueves» un jueves, la
 *     semana, los eventos de todo el día (Graph y Google) y los que cruzan la medianoche, los ratos libres;
 *   · sin calendario: «falta configurar» o «no conectado», sin inventar eventos;
 *   · leer el día de los dos calendarios, y lo honesto cuando uno falla (incompleto, «reconectar»);
 *   · renovar el permiso (por vencido y por un 401), con el token rotado guardado cifrado;
 *   · agendar SOLO propone: nada llega a la API hasta su «sí», que resuelve el servidor (decisión del turno) con el
 *     recibo de la API (id y enlace); «no» y otra cosa no crean nada; en la voz, al confirmarse el turno;
 *   · la honestidad del recibo: sin recibo, «ya quedó agendado» se reescribe; un corte al crear es «no sé si quedó»;
 *   · Google: un «sí» repetido no duplica (409 → el mismo evento); las rutas dicen «falta configurar» con los nombres.
 */
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RequestHandler } from 'express';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'calendario-'));
Object.assign(process.env, {
  CORREO_CLAVE_CIFRADO: 'llave-de-prueba-del-calendario-0123456789',
  ULTRON_CALENDARIO_DIR: path.join(DIR, 'cal'),
  ULTRON_CORREO_DIR: path.join(DIR, 'correo'),
  ULTRON_TAREA_CURSO_DIR: path.join(DIR, 'tarea-en-curso'),
  ULTRON_ABIERTOS_DIR: path.join(DIR, 'abiertos'),
  ULTRON_DURABLE_DIR: path.join(DIR, 'durable'),
  ULTRON_VOCES_DIR: path.join(DIR, 'voces'),
  ULTRON_MEMORIA_BUCKET: '',
  MS_CLIENT_ID: '',
  MICROSOFT_CLIENT_ID: '',
  GOOGLE_WEB_CLIENT_ID: '',
  GOOGLE_WEB_CLIENT_SECRET: '',
});
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const TI = await import('../lib/calendario/tiempo');
const PV = await import('../lib/calendario/proveedores');
const CX = await import('../lib/calendario/conexiones');
const CAL = await import('../server/calendario');
const T = await import('../server/decision-turno');
const H = await import('../lib/honestidad');
const { descifrar } = await import('../lib/correo/cuentas');
const MANOS = await import('../lib/cerebro-manos');
const TURNO_H = await import('../lib/herramientas-turno');
const HARNESS = await import('../lib/harness');

const JOSE = 'jose-cal@example.test';
/** Jueves 8 de octubre de 2026, 10:00 en Honduras (16:00 UTC). */
const AHORA = Date.parse('2026-10-08T16:00:00Z');
const HN = (s: string) => Date.parse(`${s}:00-06:00`);

/* ------------------------------------------------------------------ Graph y Google de mentira */

type Llamada = { metodo: string; url: string; auth: string; cuerpo: any };
type Red = {
  llamadas: Llamada[];
  msEventos: any[];
  gEventos: any[];
  /** Token que Graph acepta (otro → 401). */
  msValido: string;
  gValido: string;
  /** El token de renovación que acepta Microsoft (otro → invalid_grant). */
  msRenovacion: string;
  crearMs: 'ok' | 'corte' | '503';
  crearG: 'ok' | '409';
};

function redFalsa(r: Red): typeof fetch {
  return (async (url: any, init: any = {}) => {
    const u = new URL(String(url));
    const metodo = String(init.method || 'GET').toUpperCase();
    const auth = String(init.headers?.authorization || '');
    let cuerpo: any = null;
    if (typeof init.body === 'string') {
      try {
        cuerpo = JSON.parse(init.body);
      } catch {
        cuerpo = Object.fromEntries(new URLSearchParams(init.body));
      }
    }
    r.llamadas.push({ metodo, url: u.toString(), auth, cuerpo });
    const json = (j: any, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
    if (u.hostname === 'login.microsoftonline.com' && u.pathname.endsWith('/token')) {
      if (cuerpo.refresh_token !== r.msRenovacion) return json({ error: 'invalid_grant', error_description: 'AADSTS70008: expired' }, 400);
      r.msRenovacion = 'ms-ren-2';
      r.msValido = 'ms-acceso-2';
      return json({ access_token: 'ms-acceso-2', refresh_token: 'ms-ren-2', expires_in: 3600 });
    }
    if (u.hostname === 'oauth2.googleapis.com') {
      if (cuerpo.grant_type === 'refresh_token') {
        r.gValido = 'g-acceso-2';
        return json({ access_token: 'g-acceso-2', expires_in: 3600 });
      }
      return json({ access_token: 'g-acceso-1', refresh_token: 'g-ren-1', expires_in: 3600 });
    }
    if (u.hostname === 'graph.microsoft.com') {
      if (auth !== `Bearer ${r.msValido}`) return json({ error: { code: 'InvalidAuthenticationToken', message: 'expired' } }, 401);
      if (u.pathname === '/v1.0/me') return json({ mail: 'jose@outlook.test' });
      if (u.pathname === '/v1.0/me/calendarView') {
        const desde = Date.parse(u.searchParams.get('startDateTime')!);
        const hasta = Date.parse(u.searchParams.get('endDateTime')!);
        return json({ value: r.msEventos.filter((e) => e._i < hasta && e._f > desde) });
      }
      if (u.pathname === '/v1.0/me/events' && metodo === 'POST') {
        if (r.crearMs === 'corte') throw new TypeError('fetch failed: socket hang up');
        if (r.crearMs === '503') return json({ error: { message: 'Service unavailable' } }, 503);
        // Graph guarda en la zona pedida y contesta en UTC (Prefer outlook.timezone="UTC").
        assert.equal(cuerpo.start.timeZone, 'Central America Standard Time');
        const utc = (pared: string) => new Date(Date.parse(`${pared}-06:00`)).toISOString().replace('Z', '0000');
        return json({ id: 'AAMkEvento1', webLink: 'https://outlook.live.com/calendar/item/AAMkEvento1', subject: cuerpo.subject, start: { dateTime: utc(cuerpo.start.dateTime), timeZone: 'UTC' }, end: { dateTime: utc(cuerpo.end.dateTime), timeZone: 'UTC' }, location: cuerpo.location }, 201);
      }
    }
    if (u.hostname === 'www.googleapis.com') {
      if (auth !== `Bearer ${r.gValido}`) return json({ error: { code: 401, message: 'Invalid Credentials' } }, 401);
      if (u.pathname.endsWith('/events') && metodo === 'GET') return json({ items: r.gEventos });
      if (u.pathname.endsWith('/events') && metodo === 'POST') {
        if (r.crearG === '409') return json({ error: { code: 409, message: 'The requested identifier already exists.' } }, 409);
        return json({ id: cuerpo.id, htmlLink: `https://calendar.google.com/event?eid=${cuerpo.id}`, summary: cuerpo.summary, start: cuerpo.start, end: cuerpo.end });
      }
      const m = /\/events\/([^/]+)$/.exec(u.pathname);
      if (m && metodo === 'GET') return json({ id: m[1], htmlLink: `https://calendar.google.com/event?eid=${m[1]}`, summary: 'Ya creado', start: { dateTime: '2026-10-09T15:00:00-06:00' }, end: { dateTime: '2026-10-09T16:00:00-06:00' } });
    }
    return json({ error: 'no esperado' }, 599);
  }) as typeof fetch;
}

let red: Red;
const nuevaRed = (): Red => ({ llamadas: [], msEventos: [], gEventos: [], msValido: 'ms-acceso-1', gValido: 'g-acceso-1', msRenovacion: 'ms-ren-1', crearMs: 'ok', crearG: 'ok' });
const evMs = (id: string, titulo: string, ini: string, fin: string, extra: any = {}) => ({ id, subject: titulo, start: { dateTime: new Date(HN(ini)).toISOString().replace('Z', '0000'), timeZone: 'UTC' }, end: { dateTime: new Date(HN(fin)).toISOString().replace('Z', '0000'), timeZone: 'UTC' }, _i: HN(ini), _f: HN(fin), ...extra });

async function conectar(p: 'microsoft' | 'google', venceEl = AHORA + 3600_000) {
  await CX.conectarCalendario(JOSE, p, p === 'microsoft' ? 'jose@outlook.test' : 'jose@gmail.test', p === 'microsoft' ? { acceso: 'ms-acceso-1', renovacion: 'ms-ren-1', venceEl } : { acceso: 'g-acceso-1', renovacion: 'g-ren-1', venceEl });
}

beforeEach(() => {
  fs.rmSync(path.join(DIR, 'cal'), { recursive: true, force: true });
  CX._olvidarCalendarios();
  CAL._olvidarCalendario();
  H._olvidarEfectos();
  red = nuevaRed();
  CAL._redCalendario(redFalsa(red));
  CAL._relojCalendario(() => AHORA);
  Object.assign(process.env, { MS_CLIENT_ID: 'id-de-la-app-de-microsoft', GOOGLE_WEB_CLIENT_ID: '', GOOGLE_WEB_CLIENT_SECRET: '' });
});

const turno = (mensaje: string, o: Record<string, unknown> = {}) => T.resolverDecisionesDelTurno({ dueno: JOSE, ambito: 'tel', mensaje, whatsapp: false, registrarEfecto: async () => true, ...o } as any);
const crearon = () => red.llamadas.filter((l) => l.metodo === 'POST' && /\/events$/.test(new URL(l.url).pathname));

/* ------------------------------------------------------------------ la hora de Honduras */

test('hora de Honduras: «hoy» a las 23:30 sigue siendo hoy aunque en UTC ya sea mañana', () => {
  const noche = Date.parse('2026-10-09T05:30:00Z'); // jueves 8, 23:30 en Honduras
  const r = TI.rangoDe('hoy', noche)!;
  assert.deepEqual(r.fechas, ['2026-10-08']);
  assert.equal(r.desde, Date.parse('2026-10-08T06:00:00Z'));
  assert.equal(r.hasta, Date.parse('2026-10-09T06:00:00Z'));
  assert.deepEqual(TI.rangoDe('mañana', noche)!.fechas, ['2026-10-09']);
});

test('hora de Honduras: mañana en la mañana, el jueves (hoy) y el próximo, la semana y las fechas imposibles', () => {
  assert.deepEqual(TI.rangoDe('mañana en la mañana', AHORA)!.fechas, ['2026-10-09']);
  assert.deepEqual(TI.rangoDe('esta mañana', AHORA)!.fechas, ['2026-10-08']);
  assert.deepEqual(TI.rangoDe('el jueves', AHORA)!.fechas, ['2026-10-08'], 'dicho un jueves, es hoy');
  assert.deepEqual(TI.rangoDe('el próximo jueves', AHORA)!.fechas, ['2026-10-15']);
  assert.deepEqual(TI.rangoDe('el lunes', AHORA)!.fechas, ['2026-10-12']);
  assert.deepEqual(TI.rangoDe('pasado mañana', AHORA)!.fechas, ['2026-10-10']);
  assert.deepEqual(TI.rangoDe('esta semana', AHORA)!.fechas, ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'], 'hasta el domingo');
  assert.equal(TI.rangoDe('la próxima semana', AHORA)!.fechas[0], '2026-10-12');
  assert.equal(TI.rangoDe('cuando se pueda', AHORA), null);
  // Lo que manda la vista «Hoy» del teléfono (sin tildes ni espacios).
  assert.deepEqual(TI.rangoDe('manana', AHORA)!.fechas, ['2026-10-09']);
  assert.equal(TI.rangoDe('semana', AHORA)!.etiqueta, 'esta semana');
  assert.equal(TI.inicioDe('2026-10-09T15:00'), Date.parse('2026-10-09T21:00:00Z'));
  assert.equal(TI.inicioDe('2026-10-09T15:00:00Z'), Date.parse('2026-10-09T15:00:00Z'));
  assert.equal(TI.inicioDe('2026-02-30T10:00'), null, 'el 30 de febrero no existe');
  assert.equal(TI.inicioDe('2026-10-09T25:00'), null);
  assert.equal(TI.isoHN(Date.parse('2026-10-09T21:00:00Z')), '2026-10-09T15:00:00-06:00');
  assert.equal(TI.paredHN(Date.parse('2026-10-10T03:30:00Z')), '2026-10-09T21:30:00', 'las 03:30 UTC del 10 son las 21:30 del 9 en Honduras');
});

test('hora de Honduras: todo el día (Graph y Google), lo que cruza la medianoche y los ratos libres', async () => {
  // Graph con Prefer UTC: un evento de todo el día del 9 llega como «2026-10-09T00:00 UTC» = 18:00 del 8 en Honduras.
  red.msEventos = [{ id: 'todo', subject: 'Feriado', isAllDay: true, start: { dateTime: '2026-10-09T00:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-10T00:00:00.0000000', timeZone: 'UTC' }, _i: HN('2026-10-08T18:00'), _f: HN('2026-10-09T18:00') }];
  const ms = await PV.listarEventos('microsoft', 'ms-acceso-1', HN('2026-10-08T00:00'), HN('2026-10-11T00:00'), redFalsa(red));
  assert.equal(ms[0].todoElDia, true);
  assert.equal(ms[0].inicio, HN('2026-10-09T00:00'), 'es el día 9 de Honduras, no las 18:00 del 8');
  assert.equal(ms[0].fin, HN('2026-10-10T00:00'));
  red.gEventos = [
    { id: 'g1', summary: 'Viaje', start: { date: '2026-10-09' }, end: { date: '2026-10-10' } },
    { id: 'g2', summary: 'Turno de noche', start: { dateTime: '2026-10-08T22:00:00-06:00' }, end: { dateTime: '2026-10-09T02:00:00-06:00' } },
  ];
  const g = await PV.listarEventos('google', 'g-acceso-1', HN('2026-10-08T00:00'), HN('2026-10-11T00:00'), redFalsa(red));
  assert.equal(g[0].inicio, HN('2026-10-09T00:00'));
  const r = TI.rangoDe('esta semana', AHORA)!;
  const dias = TI.porDia(g, r);
  assert.deepEqual(dias[0].eventos.map((e) => e.id), ['g2'], 'el turno de noche sale el 8…');
  assert.deepEqual(dias[1].eventos.map((e) => e.id).sort(), ['g1', 'g2'], '…y el 9 (cruza la medianoche)');
  assert.equal(TI.decirCuando(g[1].inicio, g[1].fin), 'jueves 8 de octubre 22:00 al viernes 9 de octubre 02:00');
  // Libres el 9 entre 08:00 y 18:00 con una reunión de 10 a 11: lo de todo el día no bloquea, la noche tampoco.
  const ocupado = [...g, { id: 'x', proveedor: 'google' as const, titulo: 'Reunión', inicio: HN('2026-10-09T10:00'), fin: HN('2026-10-09T11:00'), todoElDia: false }];
  const libres = TI.huecosLibres(ocupado, '2026-10-09', 60).map((h) => `${TI.horaHN(h.inicio)}-${TI.horaHN(h.fin)}`);
  assert.deepEqual(libres, ['08:00-10:00', '11:00-18:00']);
  // Hoy a las 10:00: nada antes de ahora.
  assert.deepEqual(TI.huecosLibres([], '2026-10-08', 30, { ahora: AHORA }).map((h) => TI.horaHN(h.inicio)), ['10:00']);
});

/* ------------------------------------------------------------------ sin calendario */

test('sin calendario: «falta configurar» o «no conectado», nunca eventos inventados', async () => {
  process.env.MS_CLIENT_ID = '';
  const a = await CAL.correrCalendarioConEstado(JOSE, 'agenda hoy', 'tel');
  assert.equal(a.estado, 'failed');
  assert.equal(a.recibo?.codigo, 'no-disponible');
  assert.match(a.texto, /no inventes eventos/);
  process.env.MS_CLIENT_ID = 'id-de-la-app-de-microsoft';
  const b = await CAL.correrCalendarioConEstado(JOSE, 'agendar Reunión | 2026-10-09T15:00 | 60', 'tel');
  assert.equal(b.recibo?.codigo, 'sin-conexion');
  assert.match(b.texto, /Ajustes → Calendario \(Outlook \/ Microsoft 365\)/);
  assert.equal(CAL.propuestaEventoDe(JOSE, 'tel'), null, 'sin calendario no queda ninguna propuesta');
  assert.equal(red.llamadas.length, 0);
  const sinSesion = await CAL.correrCalendarioConEstado('', 'agenda hoy', 'tel');
  assert.equal(sinSesion.recibo?.codigo, 'sin-sesion');
  // Google sin su app web: dice exactamente qué falta (nombres de variables, no valores).
  assert.deepEqual(PV.faltaConfigurar('google'), ['GOOGLE_WEB_CLIENT_ID', 'GOOGLE_WEB_CLIENT_SECRET']);
  assert.deepEqual(PV.faltaConfigurar('microsoft'), []);
});

/* ------------------------------------------------------------------ leer */

test('leer el día: los dos calendarios en hora de Honduras; si uno falla, se dice (incompleto, reconectar)', async () => {
  await conectar('microsoft');
  await conectar('google');
  red.msEventos = [evMs('m1', 'Reunión con Ana', '2026-10-08T15:00', '2026-10-08T16:00', { location: { displayName: 'Oficina' } })];
  red.gEventos = [{ id: 'g1', summary: 'Dentista', start: { dateTime: '2026-10-08T17:30:00-06:00' }, end: { dateTime: '2026-10-08T18:00:00-06:00' } }];
  const r = await CAL.correrCalendarioConEstado(JOSE, 'agenda hoy', 'tel');
  assert.equal(r.estado, 'succeeded');
  assert.match(r.texto, /jueves 8 de octubre/);
  assert.match(r.texto, /15:00–16:00 Reunión con Ana \(Oficina\) \[Outlook \/ Microsoft 365\]/);
  assert.match(r.texto, /17:30–18:00 Dentista \[Google Calendar\]/);
  assert.ok(r.texto.indexOf('Reunión con Ana') < r.texto.indexOf('Dentista'), 'en orden');
  assert.equal(r.recibo?.incompleto, undefined);
  // Google ya no deja renovar (y su token venció): lo de Microsoft sale, y se dice que falta Google.
  CX._olvidarCalendarios();
  await conectar('google', AHORA - 1000);
  red.gValido = 'otro';
  const orig = red;
  CAL._redCalendario((async (url: any, init: any) => (String(url).includes('oauth2.googleapis.com') ? new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }) : redFalsa(orig)(url, init))) as typeof fetch);
  const p = await CAL.correrCalendarioConEstado(JOSE, 'agenda hoy', 'tel');
  assert.equal(p.estado, 'succeeded');
  assert.equal(p.recibo?.incompleto, true);
  assert.match(p.texto, /Reunión con Ana/);
  assert.match(p.texto, /no pude leer Google Calendar \(hay que volver a conectarlo/);
  assert.deepEqual(p.recibo?.cuentas?.find((c) => c.cuenta === 'google'), { cuenta: 'google', estado: 'fallo', fallo: 'auth', siguiente: 'reconectar' });
  // La conexión queda marcada para reconectar (la app no dirá «conectado»).
  assert.equal((await CX.conexionesDe(JOSE)).conexiones.find((c) => c.proveedor === 'google')?.reconectar, true);
  // Día vacío: lo dice, sin inventar.
  const v = await CAL.correrCalendarioConEstado(JOSE, 'agenda 2026-10-20', 'tel');
  assert.match(v.texto, /No tiene nada en el calendario el martes 20 de octubre/);
});

test('ratos libres del día con lo ocupado de su calendario', async () => {
  await conectar('microsoft');
  red.msEventos = [evMs('m1', 'Junta', '2026-10-09T09:00', '2026-10-09T12:00')];
  const r = await CAL.correrCalendarioConEstado(JOSE, 'libres mañana | 60', 'tel');
  assert.match(r.texto, /viernes 9 de octubre: 08:00–09:00, 12:00–18:00/);
});

/* ------------------------------------------------------------------ renovar */

test('renovar: un token vencido se renueva antes (con el permiso del calendario) y el rotado queda guardado cifrado', async () => {
  await conectar('microsoft', AHORA - 60_000);
  red.msValido = 'ms-acceso-2';
  red.msEventos = [evMs('m1', 'Reunión', '2026-10-08T15:00', '2026-10-08T16:00')];
  const r = await CAL.correrCalendarioConEstado(JOSE, 'agenda hoy', 'tel');
  assert.equal(r.estado, 'succeeded');
  const ren = red.llamadas.find((l) => l.url.includes('login.microsoftonline.com'))!;
  assert.equal(ren.cuerpo.grant_type, 'refresh_token');
  assert.equal(ren.cuerpo.refresh_token, 'ms-ren-1');
  assert.match(ren.cuerpo.scope, /Calendars\.ReadWrite/, 'incremental: el permiso del calendario, con la misma app');
  assert.equal(ren.cuerpo.client_id, 'id-de-la-app-de-microsoft');
  assert.equal(red.llamadas.find((l) => l.url.includes('graph.microsoft.com'))!.auth, 'Bearer ms-acceso-2');
  // Tras «reiniciar» (sin caché), lo guardado en disco es el token ROTADO, y cifrado.
  CX._olvidarCalendarios();
  const guardado = (await CX.conexionesDe(JOSE)).conexiones[0];
  assert.doesNotMatch(guardado.secreto, /ms-ren-2/, 'cifrado en disco');
  assert.equal(JSON.parse(descifrar(guardado.secreto)).renovacion, 'ms-ren-2');
});

test('renovar: un 401 de Graph con un token «vigente» renueva y reintenta una vez', async () => {
  await conectar('microsoft');
  red.msValido = 'ms-acceso-2'; // el guardado (ms-acceso-1) ya no sirve aunque diga que vence en una hora
  red.msEventos = [evMs('m1', 'Reunión', '2026-10-08T15:00', '2026-10-08T16:00')];
  const r = await CAL.correrCalendarioConEstado(JOSE, 'agenda hoy', 'tel');
  assert.equal(r.estado, 'succeeded');
  const graph = red.llamadas.filter((l) => l.url.includes('graph.microsoft.com'));
  assert.deepEqual(graph.map((l) => l.auth), ['Bearer ms-acceso-1', 'Bearer ms-acceso-2']);
});

/* ------------------------------------------------------------------ agendar con aprobación */

test('agendar: solo PROPONE con los datos exactos; nada llega a la API hasta su «sí»', async () => {
  await conectar('microsoft');
  red.msEventos = [evMs('m0', 'Llamada con el banco', '2026-10-09T15:30', '2026-10-09T16:00')];
  const r = await CAL.correrCalendarioConEstado(JOSE, 'agendar Reunión con Ana | 2026-10-09T15:00 | 60 | Oficina | | ana@example.test', 'tel');
  assert.equal(r.estado, 'succeeded');
  assert.equal(r.recibo?.efecto, 'borrador');
  assert.match(r.texto, /PROPUESTA DE EVENTO \(todavía NO está en su calendario\)/);
  assert.match(r.texto, /«Reunión con Ana» — viernes 9 de octubre, 15:00 a 16:00 \(hora de Honduras\), en Oficina, invitando a ana@example\.test, en Outlook \/ Microsoft 365 \(jose@outlook\.test\)/);
  assert.match(r.texto, /OJO: a esa hora ya tiene «Llamada con el banco» \(15:30–16:00\)/);
  assert.equal(crearon().length, 0, 'proponer no crea');
  const p = CAL.propuestaEventoDe(JOSE, 'tel')!;
  assert.equal(p.inicio, Date.parse('2026-10-09T21:00:00Z'));
  // El turno siguiente es «sí»: lo crea el SERVIDOR, con el recibo de la API.
  const d = await turno('sí');
  assert.equal(crearon().length, 1);
  const post = crearon()[0];
  assert.equal(post.cuerpo.subject, 'Reunión con Ana');
  assert.deepEqual(post.cuerpo.start, { dateTime: '2026-10-09T15:00:00', timeZone: 'Central America Standard Time' });
  assert.equal(post.cuerpo.transactionId, p.intento, 'idempotente por el intento aprobado');
  assert.equal(post.cuerpo.attendees[0].emailAddress.address, 'ana@example.test');
  assert.match(d.delCalendario || '', /EVENTO AGENDADO en Outlook \/ Microsoft 365: «Reunión con Ana» — viernes 9 de octubre, 15:00 a 16:00/);
  assert.match(d.delCalendario || '', /Id del evento: AAMkEvento1\. Enlace: https:\/\/outlook\.live\.com\/calendar\/item\/AAMkEvento1/);
  assert.deepEqual(d.recibos, [{ canal: 'calendario', estado: 'confirmado', destino: 'Reunión con Ana' }]);
  assert.equal(CAL.propuestaEventoDe(JOSE, 'tel'), null);
  // Un segundo «sí» no crea otro.
  await turno('sí');
  assert.equal(crearon().length, 1);
});

test('agendar: «no» lo descarta y otra cosa lo deja sin valor; en ninguno se crea nada', async () => {
  await conectar('microsoft');
  await CAL.correrCalendarioConEstado(JOSE, 'agendar Dentista | 2026-10-09T08:00 | 30', 'tel');
  const no = await turno('no');
  assert.match(no.delCalendario || '', /no se agendó; la propuesta «Dentista» quedó descartada/);
  await CAL.correrCalendarioConEstado(JOSE, 'agendar Dentista | 2026-10-09T08:00 | 30', 'tel');
  const otra = await turno('¿cómo está el clima en Tegucigalpa?');
  assert.match(otra.delCalendario || '', /siguió con otra cosa: NO se agendó y ya no vale/);
  assert.equal(CAL.propuestaEventoDe(JOSE, 'tel'), null);
  // «sí» después ya no tiene a qué contestar.
  await turno('sí');
  assert.equal(crearon().length, 0);
  // Una hora que ya pasó, o sin hora, no se propone.
  assert.equal((await CAL.correrCalendarioConEstado(JOSE, 'agendar Dentista | 2026-10-07T08:00 | 30', 'tel')).recibo?.codigo, 'falta-dato');
  assert.equal((await CAL.correrCalendarioConEstado(JOSE, 'agendar Dentista | el viernes', 'tel')).recibo?.codigo, 'falta-dato');
});

test('agendar en la voz: el evento se crea al confirmarse el turno y el resultado llega en el siguiente', async () => {
  await conectar('microsoft');
  await CAL.correrCalendarioConEstado(JOSE, 'agendar Reunión | 2026-10-09T15:00 | 60', 'tel');
  const hacer: Array<() => void> = [];
  const retener = { hacer: (f: () => void) => hacer.push(f), alDescartar: () => undefined, recordar: () => undefined, esperarConfirmacion: () => undefined };
  const d = await turno('sí', { retener, hablado: true });
  assert.match(d.delCalendario || '', /se crea en cuanto termine este turno/);
  assert.deepEqual(d.recibos, [{ canal: 'calendario', estado: 'en-curso', destino: 'Reunión' }]);
  assert.equal(crearon().length, 0, 'todavía no');
  // La honestidad: «ya quedó agendado» con el recibo en curso se cambia por «lo estoy agendando».
  const g = H.guardaDeHonestidad('Listo, ya quedó agendado en tu calendario.', { recibos: d.recibos || [], mensaje: 'sí' });
  assert.equal(g.texto, 'Lo estoy agendando ahora; te confirmo en cuanto quede en tu calendario.');
  for (const f of hacer) f();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(crearon().length, 1);
  const avisos = CAL.avisosCalendario(JOSE, 'tel');
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /EVENTO AGENDADO.*Id del evento: AAMkEvento1/);
  assert.deepEqual(CAL.avisosCalendario(JOSE, 'tel'), [], 'una vez');
});

/* ------------------------------------------------------------------ honestidad del recibo */

test('honestidad: sin recibo de la API, «ya quedó agendado en tu calendario» se reescribe; con recibo, no', () => {
  const sin = H.guardaDeHonestidad('¡Listo! Ya quedó en tu calendario la reunión con Ana.', { recibos: [], mensaje: 'agéndame una reunión con Ana mañana a las 3' });
  assert.equal(sin.cambiada, true);
  assert.match(sin.texto, /Todavía no quedó en tu calendario/);
  const espera = H.guardaDeHonestidad('Listo, agendado: «Reunión con Ana» el viernes a las 3.', { recibos: [], mensaje: 'agéndame una reunión con Ana', evento: { titulo: 'Reunión con Ana' } });
  assert.match(espera.texto, /Todavía no está en tu calendario: «Reunión con Ana» espera tu «sí»/);
  // Un recordatorio del teléfono NO respalda «quedó en tu calendario».
  const otro = H.guardaDeHonestidad('Listo, quedó en tu calendario.', { recibos: [{ canal: 'recordatorio', estado: 'confirmado' }], mensaje: 'ponlo' });
  assert.equal(otro.cambiada, true);
  const con = H.guardaDeHonestidad('Listo, quedó en tu calendario: «Reunión con Ana», viernes 9 a las 15:00.', { recibos: [{ canal: 'calendario', estado: 'confirmado', destino: 'Reunión con Ana' }], mensaje: 'sí' });
  assert.equal(con.cambiada, false);
  // Leer la agenda no es afirmar que agendó: «Tu reunión con Pedro está agendada para el lunes» se deja.
  assert.equal(H.guardaDeHonestidad('Tu reunión con Pedro está agendada para el lunes a las 9.', { recibos: [], mensaje: '¿qué tengo el lunes?' }).cambiada, false);
});

test('honestidad: si la API se corta al crear, es «no sé si quedó» (nunca «agendado»); un 503, igual', async () => {
  await conectar('microsoft');
  red.crearMs = 'corte';
  await CAL.correrCalendarioConEstado(JOSE, 'agendar Reunión | 2026-10-09T15:00 | 60', 'tel');
  const d = await turno('sí');
  assert.match(d.delCalendario || '', /NO sé si quedó/);
  assert.doesNotMatch(d.delCalendario || '', /EVENTO AGENDADO/);
  assert.deepEqual(d.recibos, [], 'sin recibo: la guarda no dejará decir «agendado»');
  assert.equal(H.guardaDeHonestidad('Listo, ya quedó agendado.', { recibos: d.recibos || [], mensaje: 'sí' }).cambiada, true);
  red.crearMs = '503';
  await CAL.correrCalendarioConEstado(JOSE, 'agendar Reunión | 2026-10-09T15:00 | 60', 'tel');
  const e = await turno('sí');
  assert.match(e.delCalendario || '', /NO sé si quedó/);
  // El permiso se quitó entre la propuesta y el «sí»: no se agendó, y se dice por qué.
  red.crearMs = 'ok';
  await CAL.correrCalendarioConEstado(JOSE, 'agendar Reunión | 2026-10-09T15:00 | 60', 'tel');
  red.msValido = 'nadie';
  red.msRenovacion = 'tampoco';
  const f = await turno('sí');
  assert.match(f.delCalendario || '', /NO se agendó «Reunión»: el permiso del calendario venció o se quitó/);
  assert.equal(crearon().filter((l) => l.auth === 'Bearer nadie').length, 0);
  // Y con el permiso ya marcado para reconectar, ni siquiera se propone.
  const g = await CAL.correrCalendarioConEstado(JOSE, 'agendar Reunión | 2026-10-09T15:00 | 60', 'tel');
  assert.equal(g.recibo?.codigo, 'reconectar');
  assert.equal(CAL.propuestaEventoDe(JOSE, 'tel'), null);
});

test('Google: un «sí» que se repite no duplica (409 → el evento que ya está); el id sale del intento', async () => {
  Object.assign(process.env, { GOOGLE_WEB_CLIENT_ID: 'gid.apps.googleusercontent.com', GOOGLE_WEB_CLIENT_SECRET: 'GOCSPX-prueba' });
  await conectar('google');
  red.crearG = '409';
  await CAL.correrCalendarioConEstado(JOSE, 'agendar Reunión | 2026-10-09T15:00 | 60 | | google', 'tel');
  const p = CAL.propuestaEventoDe(JOSE, 'tel')!;
  const d = await turno('sí, agéndalo');
  const post = crearon()[0];
  assert.equal(post.cuerpo.id, PV.idGoogleDe(p.intento));
  assert.match(post.cuerpo.id, /^[0-9a-v]{5,1024}$/, 'base32hex');
  assert.deepEqual(post.cuerpo.start, { dateTime: '2026-10-09T15:00:00-06:00', timeZone: 'America/Tegucigalpa' });
  assert.match(d.delCalendario || '', /EVENTO AGENDADO en Google Calendar.*no se duplicó/);
});

test('decisión: con otra cosa esperando (un recordatorio de la app), «sí» a secas pregunta cuál; «sí, la reunión» agenda', async () => {
  await conectar('microsoft');
  await CAL.correrCalendarioConEstado(JOSE, 'agendar Reunión con Ana | 2026-10-09T15:00 | 60', 'tel');
  const pend = T.pendientesDelTurno({ dueno: JOSE, ambito: 'tel', whatsapp: false });
  assert.deepEqual(pend.map((p) => [p.origen, p.tipo]), [['calendario', 'evento']]);
  // Con un recordatorio de la app también esperando, «sí» no basta.
  const app = { que: 'recordatorio', para: 'Tomar la pastilla', cuando: HN('2026-10-08T20:00') };
  const amb = await turno('sí', { app, appEspera: true });
  assert.equal(amb.ambiguo, true);
  assert.equal(crearon().length, 0);
  const el = await turno('sí, la reunión', { app, appEspera: true });
  assert.match(el.delCalendario || '', /EVENTO AGENDADO/);
  assert.equal(crearon().length, 1);
});

/* ------------------------------------------------------------------ rutas */

test('rutas: estado honesto por proveedor, «falta configurar» con nombres, y confirmar antes de crear desde la app', async () => {
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  const pasa: RequestHandler = (_q, _r, n) => n();
  CAL.montarRutasCalendario(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null) });
  const srv = http.createServer(app).listen(0);
  after(() => srv.close());
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const pedir = (ruta: string, init: RequestInit = {}) => fetch(base + ruta, { ...init, headers: { 'content-type': 'application/json', 'x-quien': JOSE, ...((init.headers as any) || {}) } });
  await conectar('microsoft');
  const e = await (await pedir('/api/calendario/estado')).json();
  assert.deepEqual(
    e.proveedores.map((p: any) => [p.id, p.configurado, p.conectado, p.falta]),
    [
      ['microsoft', true, true, []],
      ['google', false, false, ['GOOGLE_WEB_CLIENT_ID', 'GOOGLE_WEB_CLIENT_SECRET']],
    ]
  );
  const g = await pedir('/api/calendario/google/iniciar', { method: 'POST', body: '{}' });
  assert.equal(g.status, 503);
  assert.equal((await g.json()).code, 'falta_configurar');
  assert.equal((await fetch(base + '/api/calendario/estado')).status, 401, 'sin sesión');
  // Crear desde la app sin confirmar: nada (428).
  const sin = await pedir('/api/calendario/eventos', { method: 'POST', body: JSON.stringify({ titulo: 'X', inicio: '2026-10-09T15:00' }) });
  assert.equal(sin.status, 428);
  assert.equal(crearon().length, 0);
  const con = await pedir('/api/calendario/eventos', { method: 'POST', body: JSON.stringify({ titulo: 'X', inicio: '2026-10-09T15:00', minutos: 30, confirmado: true }) });
  assert.equal(con.status, 200);
  assert.equal((await con.json()).evento.hora, '15:00–15:30');
  red.msEventos = [evMs('m1', 'Reunión con Ana', '2026-10-08T15:00', '2026-10-08T16:00')];
  const hoy = await (await pedir('/api/calendario/eventos?cuando=hoy')).json();
  assert.equal(hoy.dias[0].titulo, 'jueves 8 de octubre');
  assert.deepEqual(hoy.dias[0].eventos.map((x: any) => [x.hora, x.titulo]), [['15:00–16:00', 'Reunión con Ana']]);
  // Google: con su app web, la dirección para entrar lleva PKCE, el permiso del calendario y la vuelta del servidor.
  Object.assign(process.env, { GOOGLE_WEB_CLIENT_ID: 'gid.apps.googleusercontent.com', GOOGLE_WEB_CLIENT_SECRET: 'GOCSPX-prueba', GOOGLE_CALENDARIO_VUELTA: 'https://aura-fp.onrender.com/api/calendario/google/vuelta' });
  const gi = await (await pedir('/api/calendario/google/iniciar', { method: 'POST', body: '{}' })).json();
  const u = new URL(gi.url);
  assert.equal(u.searchParams.get('redirect_uri'), 'https://aura-fp.onrender.com/api/calendario/google/vuelta');
  assert.match(u.searchParams.get('scope')!, /calendar\.events/);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  // La vuelta con un estado que no se pidió no guarda nada; con el bueno, sí (y es de un solo uso).
  assert.equal((await fetch(`${base}/api/calendario/google/vuelta?state=inventado&code=x`)).status, 400);
  const vuelta = await fetch(`${base}/api/calendario/google/vuelta?state=${encodeURIComponent(u.searchParams.get('state')!)}&code=codigo-bueno`);
  assert.equal(vuelta.status, 200);
  assert.match(await vuelta.text(), /Calendario conectado/);
  const canje = red.llamadas.find((l) => l.url.includes('oauth2.googleapis.com'))!;
  assert.equal(canje.cuerpo.grant_type, 'authorization_code');
  assert.ok(canje.cuerpo.code_verifier, 'con el verificador PKCE');
  assert.equal((await fetch(`${base}/api/calendario/google/vuelta?state=${encodeURIComponent(u.searchParams.get('state')!)}&code=codigo-bueno`)).status, 400, 'de un solo uso');
  const e2 = await (await pedir('/api/calendario/estado')).json();
  assert.equal(e2.proveedores.find((p: any) => p.id === 'google').conectado, true);
  delete process.env.GOOGLE_CALENDARIO_VUELTA;
});

/* ------------------------------------------------------------------ las herramientas del cerebro */

test('cerebro: agenda y agendar van con sesión, se traducen a la línea del harness y caen en su grupo de intención', async () => {
  const base = { app: true, manos: [], sistema: false, computadora: false, correo: true, whatsapp: false, triaje: false } as any;
  const nombres = (d: any) => MANOS.herramientasDelTurno(d).map((t) => t.toolSpec?.name);
  assert.ok(nombres({ ...base, sesion: true, calendario: true }).includes('agendar'));
  assert.ok(!nombres({ ...base, sesion: false, calendario: true }).includes('agenda'), 'sin sesión no hay calendario');
  assert.ok(!nombres({ ...base, sesion: true }).includes('agenda'), 'sin el campo, no va');
  assert.equal(MANOS.lineaDeHerramienta('agenda', { cuando: 'el jueves' }), 'PEDIR_HERRAMIENTA: calendario agenda el jueves');
  assert.equal(MANOS.lineaDeHerramienta('agenda', { cuando: 'mañana', libres_minutos: 60 }), 'PEDIR_HERRAMIENTA: calendario libres mañana | 60');
  assert.equal(
    MANOS.lineaDeHerramienta('agendar', { titulo: 'Reunión con Ana', inicio: '2026-10-09T15:00', minutos: 30, lugar: 'Oficina', invitados: ['ana@example.test'] }),
    'PEDIR_HERRAMIENTA: calendario agendar Reunión con Ana | 2026-10-09T15:00 | 30 | Oficina |  | ana@example.test'
  );
  assert.equal(MANOS.lineaDeHerramienta('agendar', { titulo: 'Sin hora' }), null);
  // El harness lo despacha a su runner (y sin runner lo dice, sin inventar).
  const ped = HARNESS.extraerPedidoHerramienta('PEDIR_HERRAMIENTA: calendario agenda hoy')!;
  assert.deepEqual(ped, { herramienta: 'calendario', arg: 'agenda hoy' });
  const r = await HARNESS.resolverPedidoConEstado(ped, { web: async () => '', sistema: async () => '', leer: async () => '', ejecutor: async () => '', calendario: async (a) => `visto: ${a}` });
  assert.equal(r.texto, 'visto: agenda hoy');
  const sin = await HARNESS.resolverPedidoConEstado(ped, { web: async () => '', sistema: async () => '', leer: async () => '', ejecutor: async () => '' });
  assert.equal(sin.estado, 'failed');
  // Hablando, la frase elige sus herramientas.
  const todas = MANOS.herramientasDelTurno({ ...base, sesion: true, calendario: true, documentos: true });
  const elegir = (mensaje: string, o: any = {}) => TURNO_H.herramientasSegunFrase(todas, { mensaje, ...o }).herramientas.map((t) => t.toolSpec?.name);
  for (const f of ['¿Qué tengo hoy?', '¿qué tengo mañana?', '¿Qué tengo el jueves?', 'agéndame una reunión con Ana el jueves a las 3', '¿Tengo algo libre el viernes en la tarde?', 'cómo está mi semana'])
    assert.ok(elegir(f).includes('agenda') && elegir(f).includes('agendar'), f);
  // Auditoría del 10-oct: agenda y agendar van en el núcleo (siempre); la charla no pide el GRUPO del calendario.
  assert.ok(!TURNO_H.herramientasSegunFrase(todas, { mensaje: '¿Cómo te fue hoy?' }).grupos.includes('calendario'), 'la charla no pide el calendario');
  assert.ok(elegir('sí', { esperaCalendario: true, esperaSi: true }).includes('agendar'), 'un «sí» a la propuesta lleva sus herramientas');
});
