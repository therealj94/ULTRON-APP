/**
 * LOS RECORDATORIOS EN EL SERVIDOR (auditoría del 7-oct, A-3; lib/recurrencia.ts, lib/recordatorios-servidor.ts,
 * server/recordatorios-rutas.ts):
 *
 *  · la cuenta de cada repetición: diario, de lunes a viernes, cada semana el día X, cada mes el día N con los fines de
 *    mes (31 → 30, 28 o 29), en hora de Honduras (UTC−6 todo el año: el cambio de hora de EE. UU. no la mueve);
 *  · crear, listar, cambiar, borrar y marcar hecho, por cuenta: una cuenta no ve, no cambia ni borra lo de otra (también
 *    por las rutas, con la sesión);
 *  · el reloj: entrega una vez a su hora, y tras un reinicio NO la vuelve a entregar (reclama antes de mandar y lo marca
 *    una sola vez); lo que se pasó con el servidor caído no se manda tarde; la vez siguiente se calcula del cajón;
 *  · la acción de la voz: el recordatorio que sale al teléfono lleva su id del servidor y queda guardado con su
 *    repetición; el contexto del turno ve los del servidor (y no repite las alarmas del teléfono de cada vez).
 */
import './datos-prueba';
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recordatorios-'));
process.env.ULTRON_RECORDATORIOS_DIR = path.join(dir, 'rec');
process.env.ULTRON_SESIONES_CERRADAS_ARCHIVO = path.join(dir, 'cerradas.json');
process.env.ULTRON_SESION_SECRETO = 'secreto-de-prueba-largo-para-los-recordatorios';
process.env.ULTRON_MEMORIA_BUCKET = '';
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const Rc = await import('../lib/recurrencia');
const R = await import('../lib/recordatorios-servidor');
const { montarRutasRecordatorios } = await import('../server/recordatorios-rutas');
const { emitirSesion, sesionDe, exigirMesa } = await import('../server/seguridad');
const { MANOS, validarMano, msDeHN } = await import('../lib/manos-app');
const { lineaDeHerramienta } = await import('../lib/cerebro-manos');
const { extraerAcciones, ordenPorReglas, prepararAcciones } = await import('../lib/acciones-app');

/** Un instante de reloj de pared en Honduras. */
const hn = (anio: number, mes: number, dia: number, hora: number, min = 0) => msDeHN(anio, mes, dia, hora, min);
const H = 3600_000;

/* ── la cuenta de cada repetición ────────────────────────────────────────────────────────── */

test('diario: a la misma hora de Honduras cada día; UTC−6 exacto, sin horario de verano (EE. UU. cambia el 1-nov y el 14-mar)', () => {
  const primera = hn(2026, 10, 30, 7);
  assert.equal(primera, Date.UTC(2026, 9, 30, 13, 0), '7:00 en Honduras son las 13:00 UTC');
  const veces = Rc.proximasVeces({ primera, hora: '07:00', repetir: { tipo: 'diario' } }, primera - 1, 5);
  assert.deepEqual(
    veces.map((t) => new Date(t).toISOString()),
    ['2026-10-30T13:00:00.000Z', '2026-10-31T13:00:00.000Z', '2026-11-01T13:00:00.000Z', '2026-11-02T13:00:00.000Z', '2026-11-03T13:00:00.000Z']
  );
  const marzo = Rc.proximasVeces({ primera: hn(2027, 3, 13, 7), hora: '07:00', repetir: { tipo: 'diario' } }, hn(2027, 3, 13, 7) - 1, 3);
  assert.deepEqual(marzo.map((t, i) => (i ? t - marzo[i - 1] : 0)), [0, 24 * H, 24 * H], 'cada 24 h justas aunque EE. UU. cambie la hora');
  // La de la noche no se corre de día: 23:30 de Honduras es 05:30 UTC del día siguiente.
  assert.equal(new Date(Rc.siguienteVez({ primera: hn(2026, 10, 7, 23, 30), hora: '23:30', repetir: { tipo: 'diario' } }, hn(2026, 10, 7, 23, 30))!).toISOString(), '2026-10-09T05:30:00.000Z');
});

test('de lunes a viernes, y cada semana el día X', () => {
  // 9-oct-2026 es viernes.
  assert.equal(new Date(Date.UTC(2026, 9, 9)).getUTCDay(), 5);
  const viernes = hn(2026, 10, 9, 8);
  assert.equal(Rc.siguienteVez({ primera: viernes, hora: '08:00', repetir: { tipo: 'laborables' } }, viernes), hn(2026, 10, 12, 8), 'del viernes, al lunes');
  const lunes = Rc.validarRepeticion('semanal', hn(2026, 10, 12, 8));
  assert.deepEqual(lunes, { tipo: 'semanal', dia: 1 }, 'sin día, el de la primera vez');
  assert.deepEqual(Rc.validarRepeticion({ tipo: 'semanal', dia: 'miércoles' }), { tipo: 'semanal', dia: 3 });
  const juntas = Rc.proximasVeces({ primera: hn(2026, 10, 12, 8), hora: '08:00', repetir: { tipo: 'semanal', dia: 1 } }, hn(2026, 10, 7, 0), 3);
  assert.deepEqual(juntas, [hn(2026, 10, 12, 8), hn(2026, 10, 19, 8), hn(2026, 10, 26, 8)]);
});

test('cada mes el día N, con los fines de mes: el 31 cae el 30, el 28 y en bisiesto el 29', () => {
  const primera = hn(2026, 10, 31, 9);
  const veces = Rc.proximasVeces({ primera, hora: '09:00', repetir: { tipo: 'mensual', dia: 31 } }, primera - 1, 6);
  assert.deepEqual(veces, [hn(2026, 10, 31, 9), hn(2026, 11, 30, 9), hn(2026, 12, 31, 9), hn(2027, 1, 31, 9), hn(2027, 2, 28, 9), hn(2027, 3, 31, 9)]);
  const bisiesto = Rc.proximasVeces({ primera: hn(2028, 1, 31, 9), hora: '09:00', repetir: { tipo: 'mensual', dia: 31 } }, hn(2028, 1, 31, 9), 1);
  assert.deepEqual(bisiesto, [hn(2028, 2, 29, 9)], '2028 es bisiesto');
  const el30 = Rc.proximasVeces({ primera: hn(2027, 1, 30, 9), hora: '09:00', repetir: { tipo: 'mensual', dia: 30 } }, hn(2027, 1, 30, 9), 2);
  assert.deepEqual(el30, [hn(2027, 2, 28, 9), hn(2027, 3, 30, 9)], 'el 30 en febrero es el 28 y en marzo vuelve al 30');
  assert.deepEqual(Rc.validarRepeticion('mensual', hn(2026, 10, 15, 9)), { tipo: 'mensual', dia: 15 });
  assert.equal(Rc.validarRepeticion({ tipo: 'mensual', dia: 32 }), null);
  assert.equal(Rc.validarRepeticion('cada rato'), null);
  assert.equal(Rc.siguienteVez({ primera: hn(2026, 10, 7, 9), hora: '09:00', repetir: { tipo: 'nunca' } }, hn(2026, 10, 7, 10)), null, 'una de una vez que ya pasó: ninguna');
  assert.equal(Rc.describirRepeticion({ tipo: 'semanal', dia: 1 }), 'cada lunes');
  assert.equal(Rc.describirRepeticion({ tipo: 'mensual', dia: 31 }, 'en'), 'every month on day 31');
});

/* ── el cajón por cuenta ─────────────────────────────────────────────────────────────────── */

const AHORA = hn(2026, 10, 7, 12);
let n = 0;
const cuenta = () => `rec-${Date.now()}-${n++}@ejemplo.com`;

beforeEach(() => R._olvidarRecordatoriosServidor());

test('crear, listar, cambiar, marcar hecho y borrar (con lo borrado para que el teléfono quite su alarma)', async () => {
  const a = cuenta();
  const c = await R.crearRecordatorioServidor(a, { texto: 'La pastilla', cuando: '2026-10-08T07:00', repetir: 'diario' }, AHORA);
  assert.equal(c.nuevo, true);
  assert.match(c.recordatorio.id, R.RE_ID_SERVIDOR);
  assert.equal(c.recordatorio.proxima, hn(2026, 10, 8, 7));
  assert.equal(c.recordatorio.repeticion, 'todos los días');
  // El mismo id otra vez (la acción que llega dos veces): no se duplica.
  assert.equal((await R.crearRecordatorioServidor(a, { id: c.recordatorio.id, texto: 'La pastilla', cuando: '2026-10-08T07:00' }, AHORA)).nuevo, false);
  const una = await R.crearRecordatorioServidor(a, { texto: 'Llamar al banco', cuando: hn(2026, 10, 7, 15) }, AHORA);
  let l = await R.listarRecordatoriosServidor(a, AHORA);
  assert.deepEqual(l.recordatorios.map((r) => r.texto), ['Llamar al banco', 'La pastilla'], 'por la próxima vez');
  const e = await R.editarRecordatorioServidor(a, c.recordatorio.id, { cuando: '2026-10-08T06:30' }, AHORA);
  assert.equal(e.recordatorio.proxima, hn(2026, 10, 8, 6, 30));
  assert.equal(e.recordatorio.hora, '06:30');
  // Hecho: el de una vez sale de la lista; el diario salta a la siguiente vez.
  await R.marcarHechoServidor(a, una.recordatorio.id, AHORA);
  const h = await R.marcarHechoServidor(a, c.recordatorio.id, AHORA);
  assert.equal(h.recordatorio.proxima, hn(2026, 10, 9, 6, 30));
  l = await R.listarRecordatoriosServidor(a, AHORA);
  assert.deepEqual(l.recordatorios.map((r) => r.texto), ['La pastilla']);
  assert.deepEqual((await R.borrarRecordatorioServidor(a, `${c.recordatorio.id}-abc`, AHORA)).borrado, true, 'también por la base de su alarma');
  l = await R.listarRecordatoriosServidor(a, AHORA);
  assert.deepEqual(l.recordatorios, []);
  assert.deepEqual(l.borrados, [c.recordatorio.id]);
  await assert.rejects(R.crearRecordatorioServidor(a, { id: c.recordatorio.id, texto: 'La pastilla', cuando: '2026-10-08T07:00' }, AHORA), /ya se borró/, 'lo borrado no vuelve por una adopción tardía');
  await assert.rejects(R.crearRecordatorioServidor(a, { texto: 'Ayer', cuando: hn(2026, 10, 6, 12) }, AHORA), /no vale/);
  await assert.rejects(R.crearRecordatorioServidor(a, { texto: 'x', cuando: hn(2026, 10, 8, 12), repetir: 'a ratos' }, AHORA), /cada cuánto/);
});

test('cada cuenta, lo suyo: B no ve, no cambia, no marca ni borra lo de A', async () => {
  const a = cuenta();
  const b = cuenta();
  const r = (await R.crearRecordatorioServidor(a, { texto: 'Privado de A', cuando: hn(2026, 10, 8, 9) }, AHORA)).recordatorio;
  assert.deepEqual((await R.listarRecordatoriosServidor(b, AHORA)).recordatorios, []);
  await assert.rejects(R.editarRecordatorioServidor(b, r.id, { texto: 'pisado' }, AHORA), /No encuentro/);
  await assert.rejects(R.marcarHechoServidor(b, r.id, AHORA), /No encuentro/);
  assert.equal((await R.borrarRecordatorioServidor(b, r.id, AHORA)).borrado, false);
  // B «adopta» el id de A: es OTRO recordatorio en el cajón de B; el de A queda igual.
  await R.crearRecordatorioServidor(b, { id: r.id, texto: 'De B', cuando: hn(2026, 10, 9, 9) }, AHORA);
  assert.deepEqual((await R.listarRecordatoriosServidor(a, AHORA)).recordatorios.map((x) => x.texto), ['Privado de A']);
});

/* ── las rutas ───────────────────────────────────────────────────────────────────────────── */

const app = express();
app.use(express.json());
const pasa = () => ((_q: express.Request, _s: express.Response, nx: express.NextFunction) => nx()) as express.RequestHandler;
let relojRutas = AHORA;
montarRutasRecordatorios(app, { exigirMesa, limitar: pasa, sesionDe, ahora: () => relojRutas });
const srv = app.listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
after(() => srv.close());
const h = (token?: string) => ({ 'content-type': 'application/json', ...(token ? { 'x-ultron-sesion': token } : {}) });
const pedir = async (metodo: string, ruta: string, token?: string, body?: unknown) => {
  const r = await fetch(`${base}${ruta}`, { method: metodo, headers: h(token), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, j: (await r.json()) as any };
};

test('las rutas: todo por la sesión; otra cuenta no ve ni toca nada (404), sin sesión 401', async () => {
  relojRutas = AHORA;
  const ca = cuenta();
  const ta = emitirSesion({ correo: ca, nombre: 'A', rol: 'Miembro' }, { comunidad: true }).token;
  const tb = emitirSesion({ correo: cuenta(), nombre: 'B', rol: 'Miembro' }, { comunidad: true }).token;
  assert.equal((await pedir('GET', '/api/recordatorios')).status, 401);
  const c = await pedir('POST', '/api/recordatorios', ta, { texto: 'Junta', cuando: '2026-10-12T08:00', repetir: { tipo: 'semanal', dia: 'lunes' } });
  assert.equal(c.status, 201);
  const id = c.j.recordatorio.id;
  assert.equal(c.j.recordatorio.repeticion, 'cada lunes');
  assert.equal((await pedir('GET', '/api/recordatorios', ta)).j.recordatorios.length, 1);
  assert.equal((await pedir('GET', '/api/recordatorios', tb)).j.recordatorios.length, 0, 'B no lo ve');
  assert.equal((await pedir('PATCH', `/api/recordatorios/${id}`, tb, { texto: 'pisado' })).status, 404);
  assert.equal((await pedir('DELETE', `/api/recordatorios/${id}`, tb)).status, 404);
  assert.equal((await pedir('POST', `/api/recordatorios/${id}/hecho`, tb)).status, 404);
  const e = await pedir('PATCH', `/api/recordatorios/${id}`, ta, { texto: 'Junta de socios' });
  assert.equal(e.j.recordatorio.texto, 'Junta de socios');
  const hecho = await pedir('POST', `/api/recordatorios/${id}/hecho`, ta);
  assert.equal(hecho.j.recordatorio.proxima, hn(2026, 10, 19, 8), 'cada lunes: salta al siguiente');
  assert.equal((await pedir('POST', '/api/recordatorios', ta, { texto: '', cuando: '2026-10-12T08:00' })).status, 400);
  assert.equal((await pedir('DELETE', `/api/recordatorios/${id}`, ta)).status, 200);
  assert.deepEqual((await pedir('GET', '/api/recordatorios', ta)).j.borrados, [id]);
});

/* ── el reloj ────────────────────────────────────────────────────────────────────────────── */

type Envio = { correo: string; id: string; vez: number };
function reloj(o: { ahora: () => number; envios: Envio[]; unaVez?: Set<string> }) {
  return new R.RelojRecordatorios({
    ahora: o.ahora,
    programar: () => () => {},
    enviar: async (correo, r, vez) => {
      o.envios.push({ correo, id: r.id, vez });
      return true;
    },
    ...(o.unaVez ? { unaVez: async (correo: string, clave: string) => !o.unaVez!.has(`${correo}|${clave}`) && !!o.unaVez!.add(`${correo}|${clave}`) } : {}),
  });
}

test('el reloj entrega UNA vez a su hora, y un reinicio no la repite (calcula la próxima del cajón)', async () => {
  const a = cuenta();
  let t = AHORA;
  const envios: Envio[] = [];
  const r1 = reloj({ ahora: () => t, envios });
  await r1.arrancar();
  const { recordatorio } = await R.crearRecordatorioServidor(a, { texto: 'La pastilla', cuando: hn(2026, 10, 7, 13), repetir: 'diario' }, AHORA);
  assert.equal(await r1.revisar(), 0, 'todavía no');
  t = hn(2026, 10, 7, 13) + 5_000;
  assert.equal(await r1.revisar(), 1);
  assert.deepEqual(envios, [{ correo: a, id: recordatorio.id, vez: hn(2026, 10, 7, 13) }]);
  assert.equal(await r1.revisar(), 0, 'la misma revisión otra vez: nada');
  r1.parar();
  // Reinicio: sin caché ni memoria (lo de disco/S3 queda). El índice dice quién tiene recordatorios.
  R._olvidarRecordatoriosServidor();
  const r2 = reloj({ ahora: () => t, envios });
  await r2.arrancar();
  assert.equal(envios.length, 1, 'tras el reinicio, la de hoy no se vuelve a mandar');
  assert.equal(R._proximaEnMemoria(a), hn(2026, 10, 8, 13), 'la próxima, de lo guardado');
  t = hn(2026, 10, 8, 13) + 1_000;
  assert.equal(await r2.revisar(), 1);
  assert.deepEqual(envios.at(-1), { correo: a, id: recordatorio.id, vez: hn(2026, 10, 8, 13) });
  r2.parar();
});

test('sin doble envío aunque el reclamo se pierda: la marca de una sola vez frena el segundo', async () => {
  const a = cuenta();
  let t = AHORA;
  const envios: Envio[] = [];
  const unaVez = new Set<string>();
  const r1 = reloj({ ahora: () => t, envios, unaVez });
  await r1.arrancar();
  const { recordatorio } = await R.crearRecordatorioServidor(a, { texto: 'Una vez', cuando: hn(2026, 10, 7, 13) }, AHORA);
  t = hn(2026, 10, 7, 13) + 1_000;
  assert.equal(await r1.revisar(), 1);
  r1.parar();
  // Como si el guardado del reclamo no hubiera llegado (otro proceso, o un S3 que perdió la escritura): el cajón vuelve
  // a decir que toca. La marca durable de esa vez lo frena.
  const archivo = fs.readdirSync(process.env.ULTRON_RECORDATORIOS_DIR!).map((f) => path.join(process.env.ULTRON_RECORDATORIOS_DIR!, f)).find((f) => fs.readFileSync(f, 'utf8').includes(recordatorio.id))!;
  const cajon = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  for (const r of cajon.recordatorios) if (r.id === recordatorio.id) Object.assign(r, { proxima: hn(2026, 10, 7, 13), ultimaEntrega: undefined });
  fs.writeFileSync(archivo, JSON.stringify(cajon));
  R._olvidarRecordatoriosServidor();
  const r2 = reloj({ ahora: () => t, envios, unaVez });
  await r2.arrancar();
  assert.equal(envios.length, 1, 'la misma vez no sale dos veces');
  r2.parar();
});

test('con el servidor caído: lo que se pasó no se manda tarde y la repetición sigue desde ahora', async () => {
  const a = cuenta();
  const envios: Envio[] = [];
  await R.crearRecordatorioServidor(a, { texto: 'Diario', cuando: hn(2026, 10, 7, 13), repetir: 'diario' }, AHORA);
  const una = (await R.crearRecordatorioServidor(a, { texto: 'Una vez', cuando: hn(2026, 10, 7, 14) }, AHORA)).recordatorio;
  // Vuelve a las 20:00: las dos se pasaron hace horas.
  R._olvidarRecordatoriosServidor();
  const t = hn(2026, 10, 7, 20);
  const r = reloj({ ahora: () => t, envios });
  await r.arrancar();
  assert.equal(envios.length, 0, 'nada tarde: el teléfono ya sonó con su alarma');
  const l = await R.listarRecordatoriosServidor(a, t);
  assert.equal(l.recordatorios.find((x) => x.texto === 'Diario')?.proxima, hn(2026, 10, 8, 13));
  const sonada = l.recordatorios.find((x) => x.id === una.id);
  assert.equal(sonada?.proxima, null);
  assert.equal(sonada?.sonado, true, 'queda como «ya sonó» hasta que la marque hecha');
  r.parar();
});

test('el aviso va a la cuenta dueña, con lo que el teléfono necesita para no sonar dos veces', async () => {
  const a = cuenta();
  const b = cuenta();
  let t = AHORA;
  const envios: Envio[] = [];
  const r = reloj({ ahora: () => t, envios });
  await r.arrancar();
  const ra = (await R.crearRecordatorioServidor(a, { texto: 'De A', cuando: hn(2026, 10, 7, 13), llamada: true }, AHORA)).recordatorio;
  await R.crearRecordatorioServidor(b, { texto: 'De B', cuando: hn(2026, 10, 7, 18) }, AHORA);
  t = hn(2026, 10, 7, 13) + 1_000;
  await r.revisar();
  assert.deepEqual(envios.map((e) => e.correo), [a], 'solo A (lo de B es más tarde y es de B)');
  r.parar();
  const d = R.datosPushRecordatorio(ra, hn(2026, 10, 7, 13));
  assert.equal(d.tipo, 'llamada', 'el que llama, como llamada de AURA');
  assert.equal(d.rid, ra.id);
  assert.equal(d.cuando, String(hn(2026, 10, 7, 13)));
  assert.match(d.id, /^[A-Za-z0-9_.:-]{1,80}$/);
  assert.equal(R.datosPushRecordatorio({ ...ra, llamada: false }, 1).tipo, 'recordatorio');
});

/* ── la voz ──────────────────────────────────────────────────────────────────────────────── */

const CTX = { pantalla: 'mesa' as const, contactos: [], manos: [...MANOS] };

test('la herramienta con repetición → la acción valida su repetición; solo el servidor pone el `rid`', () => {
  const linea = lineaDeHerramienta('recordatorio', { accion: 'poner', texto: 'Junta', cuando: '2026-10-12T08:00', repetir: 'semanal', dia: 'lunes' })!;
  const { acciones } = extraerAcciones(linea);
  assert.deepEqual(acciones[0], { tipo: 'recordatorio', texto: 'Junta', cuando: hn(2026, 10, 12, 8), llamada: true, repetir: { tipo: 'semanal', dia: 1 } });
  assert.equal(validarMano({ tipo: 'recordatorio', texto: 'x', cuando: hn(2026, 10, 12, 8), rid: 'aura-rec-sabcdef123456' }, AHORA)?.hasOwnProperty('rid'), false, 'el modelo no pone ids');
  assert.equal(lineaDeHerramienta('recordatorio', { accion: 'listar' }), 'ACCION_APP: {"tipo":"abrir","pantalla":"recordatorios"}');
  const sale = prepararAcciones(acciones, { mensaje: 'recuérdame cada lunes a las 8 la junta', contexto: CTX, ahora: AHORA });
  assert.deepEqual(sale, [{ tipo: 'recordatorio', texto: 'Junta', cuando: hn(2026, 10, 12, 8), llamada: true, repetir: { tipo: 'semanal', dia: 1 } }]);
});

test('lo que sale al teléfono lleva su `rid` y queda en el servidor con su repetición; cancelarlo lo borra', async () => {
  const a = cuenta();
  const accion = R.conRidServidor({ tipo: 'recordatorio' as const, texto: 'Junta', cuando: hn(2026, 10, 12, 8), repetir: { tipo: 'semanal' as const, dia: 1 } }, CTX);
  assert.match(accion.rid!, R.RE_ID_SERVIDOR);
  assert.equal(R.conRidServidor({ tipo: 'recordatorio' as const, texto: 'x', cuando: 1 }, { ...CTX, manos: ['recordatorio'] }).rid, undefined, 'un teléfono sin la mano: como antes');
  await R.efectoServidorDeAccion(a, accion, AHORA);
  const l = await R.listarRecordatoriosServidor(a, AHORA);
  assert.equal(l.recordatorios[0].id, accion.rid);
  assert.equal(l.recordatorios[0].repeticion, 'cada lunes');
  await R.efectoServidorDeAccion(a, { tipo: 'cancelar_recordatorio', id: accion.rid! }, AHORA);
  assert.deepEqual((await R.listarRecordatoriosServidor(a, AHORA)).borrados, [accion.rid]);
});

test('el contexto del turno: los del servidor (con su repetición) y sin repetir la alarma de cada vez del teléfono', async () => {
  const a = cuenta();
  const r = (await R.crearRecordatorioServidor(a, { texto: 'La pastilla', cuando: hn(2026, 10, 8, 7), repetir: 'diario' }, AHORA)).recordatorio;
  const ctx = {
    ...CTX,
    recordatorios: [
      { id: `${r.id}-${hn(2026, 10, 8, 7).toString(36)}`, texto: 'La pastilla', cuando: hn(2026, 10, 8, 7), llamada: false },
      { id: 'aura-rec-viejo1-abc', texto: 'Uno viejo del teléfono', cuando: hn(2026, 10, 7, 18), llamada: false },
    ],
  };
  const m = R.contextoConRecordatorios(ctx, a, AHORA)!;
  assert.deepEqual(
    m.recordatorios!.map((x) => [x.id, x.repetir]),
    [
      ['aura-rec-viejo1-abc', undefined],
      [r.id, 'todos los días'],
    ]
  );
  // «¿qué recordatorios tengo?»: se dicen (con la repetición) y se abre la hoja.
  const o = ordenPorReglas('¿qué recordatorios tengo?', { contexto: m, ahora: AHORA });
  assert.deepEqual(o?.accion, { tipo: 'abrir', pantalla: 'recordatorios' });
  assert.match(o!.decir, /«La pastilla» \(todos los días\)/);
  // Un teléfono sin la mano: el contexto queda como estaba.
  assert.equal(R.contextoConRecordatorios({ ...ctx, manos: ['recordatorio'] }, a, AHORA)?.recordatorios?.length, 2);
});
