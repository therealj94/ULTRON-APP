/**
 * UN EFECTO, UNA VEZ (revisión externa, 4-oct): «al fallar el almacenamiento o interrumpirse una tarea, puede
 * autorizarse repetir una ejecución». Lo que deja algo afuera (un envío, una tarea de la computadora, una
 * herramienta con efecto) nunca corre una segunda vez porque el almacén falló, venció un lease, se reinició el
 * proceso o el cliente reintentó. Si no se sabe cómo terminó, queda `desconocido` y se reconcilia: no se repite.
 *
 * Cada prueba cuenta las veces que se hizo el efecto (un transporte o un nodo de mentira).
 */
import './datos-prueba'; // la junta inventada de las pruebas (lo real vive en Render)
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { RequestHandler } from 'express';
import { claveTurno, crearTurnosUnicos, efectoDelTurno, enTurnoUnico, turnoSinEfectos, VIDA_DURABLE_MS, type TurnoGuardado } from '../server/turno-unico';
import { accionesQueSalen, type AccionApp } from '../lib/acciones-app';
import { despacharTaller } from '../lib/taller';
import { almacenEnMemoria, claveOperacion, _usarAlmacenDurable, type AlmacenDurable } from '../lib/durable';
import { correrBucleHarness, type ResultadoHerramienta } from '../lib/harness';
import { enviarUnaVez, vezDelEvento, type SalidaEnvio } from '../lib/envios';

// El correo (prueba de la repetición incierta) guarda cuentas y borradores en una carpeta de prueba.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'efecto-una-vez-'));
process.env.CORREO_CLAVE_CIFRADO ||= 'llave-de-prueba';
process.env.ULTRON_CORREO_DIR = DIR;
process.env.ULTRON_TAREA_CURSO_DIR = path.join(DIR, 'tarea-en-curso');
process.env.ULTRON_ABIERTOS_DIR = path.join(DIR, 'abiertos');
after(() => {
  _usarAlmacenDurable(null);
  fs.rmSync(DIR, { recursive: true, force: true });
});

const respuesta = (reply = 'Listo.'): TurnoGuardado => ({ reply, voz: reply, emocion: 'neutral', via: 'qwen', herramientas: [], acciones: [] });

/** Un almacén en memoria al que se le puede hacer fallar la lectura o la escritura de ciertas claves (S3 503). */
function almacenFalible() {
  const base = almacenEnMemoria();
  const falla = { leer: (_k: string) => false, escribir: (_k: string, _v: any) => false };
  const a: AlmacenDurable = {
    tipo: 'memoria',
    multiReplica: false,
    leer: (k) => (falla.leer(k) ? Promise.resolve({ ok: false as const, detalle: 'S3 503' }) : base.leer(k)),
    crear: (k, v) => (falla.escribir(k, v) ? Promise.resolve({ ok: false as const, conflicto: false as const, detalle: 'S3 503' }) : base.crear(k, v)),
    cas: (k, v, e) => (falla.escribir(k, v) ? Promise.resolve({ ok: false as const, conflicto: false as const, detalle: 'S3 503' }) : base.cas(k, v, e)),
  };
  return { a, base, falla };
}

/** Dos «procesos» sobre el mismo almacén, con un reloj que se puede adelantar. */
function replicas(a: AlmacenDurable) {
  const reloj = { t: 0 };
  const cfg = { almacen: () => a, leaseMs: 1_000, renovarMs: 60_000, sondeoMs: 5, ahora: () => Date.now() + reloj.t };
  return { reloj, A: crearTurnosUnicos({ ...cfg, proceso: 'efecto-A' }), B: crearTurnosUnicos({ ...cfg, proceso: 'efecto-B' }) };
}

/* ------------------------------------------------------------------ el turno único */

test('almacén caído al reclamar: el turno contesta, pero la herramienta con efecto NO corre (las de leer sí)', async () => {
  const { a, falla } = almacenFalible();
  falla.escribir = () => true;
  const T = crearTurnosUnicos({ almacen: () => a, proceso: 'sin-almacen' });
  const clave = claveTurno('majo@orden.org', 'sin-almacen-01');
  const r = await T.reclamarTurno(clave);
  assert.ok('terminar' in r && r.terminar.durable === false, 'corre para contestar');
  let corridas = 0;
  const correr = async (): Promise<ResultadoHerramienta> => (corridas++, { texto: 'HARNESS: hecho', estado: 'succeeded' });
  const respaldo = async () => ({ ok: true, reply: 'Te cuento.' });
  const h = await enTurnoUnico(r.terminar, () =>
    correrBucleHarness({ reply: 'PEDIR_HERRAMIENTA: computadora entra a x.hn y paga la factura', hechos: [], tools: [], correr, respaldo, antesDeEfecto: (x) => efectoDelTurno(x) })
  );
  assert.equal(corridas, 0, 'sin registro durable no se despacha nada');
  assert.equal(h.estado, 'error');
  assert.equal(h.pasos[0].recibo?.codigo, 'turno-ajeno');
  // El «sí» a un borrador y las acciones del teléfono tampoco.
  assert.equal(await enTurnoUnico(r.terminar, () => efectoDelTurno('decision')), false);
  const app = await enTurnoUnico(r.terminar, () => accionesQueSalen([{ tipo: 'llamame' }, { tipo: 'abrir', pantalla: 'ajustes' }] as AccionApp[], (x) => efectoDelTurno(x)));
  assert.deepEqual(app.salen.map((x) => x.tipo), ['abrir'], 'lo que solo mueve la pantalla sale');
  assert.deepEqual(app.frenadas.map((x) => x.tipo), ['llamame'], 'que AURA llame, no');
  // Leer sí (no tiene efecto).
  await enTurnoUnico(r.terminar, () => correrBucleHarness({ reply: 'PEDIR_HERRAMIENTA: web precio del oro', hechos: [], tools: [], correr, respaldo, antesDeEfecto: (x) => efectoDelTurno(x) }));
  assert.equal(corridas, 1);
  await r.terminar(respuesta());
});

test('despachó un efecto y terminó SIN respuesta: el reintento NO corre el turno otra vez (ni aquí, ni tras un reinicio)', async () => {
  const almacen = almacenEnMemoria();
  const { A, B } = replicas(almacen);
  const clave = claveTurno('majo@orden.org', 'efecto-sin-resp-01');
  let envios = 0;
  const turno = async (T: ReturnType<typeof crearTurnosUnicos>) => {
    const r = await T.reclamarTurno(clave, 50);
    if (!('terminar' in r)) return r;
    await enTurnoUnico(r.terminar, async () => {
      if (await efectoDelTurno('correo')) envios++;
    });
    // El cerebro se cayó después de mandar: sin respuesta (la app reintenta con el mismo idTurno).
    await r.terminar(null);
    return r;
  };
  await turno(A);
  const reintento = await turno(A);
  assert.equal(envios, 1, 'el reintento no manda otra vez');
  assert.ok('desconocido' in reintento, 'queda incierto');
  A.olvidar(); // reinicio
  const otra = await turno(B);
  assert.equal(envios, 1);
  assert.ok('desconocido' in otra && otra.desconocido.efectos[0] === 'correo');
});

test('lo mismo con una acción del teléfono (mandar el borrador de PULSE2CHAT): queda persistida antes de empujarse', async () => {
  const almacen = almacenEnMemoria();
  const { A, B } = replicas(almacen);
  const clave = claveTurno('majo@orden.org', 'efecto-app-0001');
  let empujadas = 0;
  const turno = async (T: ReturnType<typeof crearTurnosUnicos>) => {
    const r = await T.reclamarTurno(clave, 50);
    if (!('terminar' in r)) return r;
    const { salen } = await enTurnoUnico(r.terminar, () => accionesQueSalen([{ tipo: 'enviar' }] as AccionApp[], (x) => efectoDelTurno(x)));
    empujadas += salen.length;
    await r.terminar(null); // el stream se cortó: la app reintenta
    return r;
  };
  await turno(A);
  assert.ok('desconocido' in (await turno(A)));
  A.olvidar();
  assert.ok('desconocido' in (await turno(B)), 'tras un reinicio tampoco se repite');
  assert.equal(empujadas, 1);
});

test('el almacén falla justo al marcar «despachado»: el efecto no se hace', async () => {
  const { a, falla } = almacenFalible();
  const { A } = replicas(a);
  const r = await A.reclamarTurno(claveTurno('majo@orden.org', 'falla-despacho1'));
  assert.ok('terminar' in r && r.terminar.durable);
  falla.escribir = () => true;
  let envios = 0;
  await enTurnoUnico(r.terminar, async () => {
    if (await efectoDelTurno('whatsapp')) envios++;
  });
  assert.equal(envios, 0);
  const app = await enTurnoUnico(r.terminar, () => accionesQueSalen([{ tipo: 'enviar' }] as AccionApp[], (x) => efectoDelTurno(x)));
  assert.equal(app.salen.length, 0, 'tampoco sale la acción del teléfono');
  await r.terminar(null);
});

test('el almacén falla al guardar el final (hecho): al vencer el lease queda «desconocido», no se re-ejecuta', async () => {
  const { a, falla } = almacenFalible();
  const { A, B, reloj } = replicas(a);
  const clave = claveTurno('majo@orden.org', 'falla-final-001');
  const r = await A.reclamarTurno(clave);
  assert.ok('terminar' in r);
  let envios = 0;
  if (await enTurnoUnico(r.terminar, () => efectoDelTurno('computadora'))) envios++;
  falla.escribir = () => true;
  await r.terminar(respuesta('Ya la encargué.'));
  A.olvidar();
  falla.escribir = () => false;
  reloj.t += 1_500;
  const b = await B.reclamarTurno(clave, 50);
  assert.ok('desconocido' in b, 'no se corre a ciegas');
  assert.equal(envios, 1);
});

test('un turno hecho que despachó algo repite su respuesta aunque pase su vida: el mismo id no corre otra vez', async () => {
  const almacen = almacenEnMemoria();
  const { A, B, reloj } = replicas(almacen);
  const clave = claveTurno('majo@orden.org', 'viejo-con-efecto');
  const r = await A.reclamarTurno(clave);
  assert.ok('terminar' in r);
  assert.equal(await enTurnoUnico(r.terminar, () => efectoDelTurno('correo')), true);
  await r.terminar(respuesta('Le mandé el correo a Beto.'));
  A.olvidar();
  reloj.t += VIDA_DURABLE_MS + 60_000;
  const b = await B.reclamarTurno(clave, 50);
  assert.ok('previo' in b, 'se repite, no se corre');
  assert.equal(b.previo.reply, 'Le mandé el correo a Beto.');
});

test('sin efectos, terminar sin respuesta sigue liberando el turno (el reintento es para probar otra vez)', async () => {
  const { A, B } = replicas(almacenEnMemoria());
  const clave = claveTurno('majo@orden.org', 'libre-sin-efecto');
  const r = await A.reclamarTurno(clave);
  assert.ok('terminar' in r);
  await r.terminar(null);
  assert.ok('terminar' in (await A.reclamarTurno(clave, 50)));
  assert.ok('terminar' in (await B.reclamarTurno(claveTurno('majo@orden.org', 'libre-sin-efect2'), 50)));
});

test('turnoSinEfectos (reconexión de la voz, webhook sin poder deduplicar): contesta, pero nada con efecto', async () => {
  const t = turnoSinEfectos('prueba');
  let corridas = 0;
  const h = await enTurnoUnico(t, () =>
    correrBucleHarness({
      reply: 'PEDIR_HERRAMIENTA: correo manda a beto@x.hn que llego tarde',
      hechos: [],
      tools: [],
      correr: async () => (corridas++, { texto: 'ok', estado: 'succeeded' }),
      respaldo: async () => ({ ok: true, reply: 'Te cuento.' }),
      antesDeEfecto: (x) => efectoDelTurno(x),
    })
  );
  assert.equal(corridas, 0);
  assert.equal(h.estado, 'error');
});

test('taller: lo que manda o cambia pasa por antesDeEfecto; si el turno no quedó registrado, no se hace', async () => {
  const pedidas: string[] = [];
  const t = await despacharTaller('anota revisar la bomba del pozo', {
    quien: 'jose',
    nivel: 'mando',
    prueba: 'sesion',
    canal: 'mesa',
    antesDeEfecto: async (h) => (pedidas.push(h), false),
  });
  assert.deepEqual(pedidas, ['taller.tarea_anotar'], 'se preguntó antes de anotar');
  assert.match(t.hechos.join(' '), /No lo hice: no pude dejar registrado este turno/);
  assert.doesNotMatch(t.hechos.join(' '), /TAREA ANOTADA/);
});

/* ------------------------------------------------------------------ los envíos aprobados (lib/envios.ts) */

const ENVIO = { canal: 'correo' as const, dueno: 'majo@orden.org', huella: 'h-aprobada', contenido: 'c-igual' };

test('envíos: si no se puede leer si lo mismo quedó incierto, NO se manda (un error del almacén no es «no había nada»)', async () => {
  const { a, falla } = almacenFalible();
  let salidas = 0;
  const efecto = async (): Promise<SalidaEnvio> => (salidas++, { estado: 'unknown', detalle: 'el SMTP no contestó' });
  const reconciliar = async () => ({ encontrado: false as const });
  const primero = await enviarUnaVez({ ...ENVIO, operacion: 'envio-correo-1', efecto, reconciliar, almacen: a });
  assert.equal(primero.estado, 'unknown');
  assert.equal(salidas, 1);
  // El mismo correo (misma huella de contenido) con otro borrador, y el almacén no deja leer el anotado.
  falla.leer = (k) => k.startsWith('envios/contenido');
  const segundo = await enviarUnaVez({ ...ENVIO, operacion: 'envio-correo-2', efecto, reconciliar, almacen: a });
  assert.equal(salidas, 1, 'no salió otra vez');
  assert.equal(segundo.motivo, 'almacen');
  // Tampoco si lo que no se puede leer es la operación anterior.
  falla.leer = (k) => k === claveOperacion(ENVIO.dueno, 'envio-correo-1');
  const tercero = await enviarUnaVez({ ...ENVIO, operacion: 'envio-correo-3', efecto, reconciliar, almacen: a });
  assert.equal(salidas, 1);
  assert.equal(tercero.motivo, 'almacen');
  // Con el almacén bien: se pide otra decisión (repetición incierta), no sale solo.
  falla.leer = () => false;
  const cuarto = await enviarUnaVez({ ...ENVIO, operacion: 'envio-correo-4', efecto, reconciliar, almacen: a });
  assert.equal(cuarto.motivo, 'repeticion-incierta');
  assert.equal(salidas, 1);
});

test('envíos: si no se puede anotar lo que sale por su contenido, no se manda (después no habría con qué reconciliar)', async () => {
  const { a, falla } = almacenFalible();
  let salidas = 0;
  const efecto = async (): Promise<SalidaEnvio> => (salidas++, { estado: 'unknown', detalle: 'cortado' });
  const reconciliar = async () => ({ encontrado: false as const });
  falla.escribir = (k) => k.startsWith('envios/contenido');
  const r = await enviarUnaVez({ ...ENVIO, operacion: 'envio-correo-a1', efecto, reconciliar, almacen: a });
  assert.equal(r.motivo, 'almacen');
  falla.escribir = () => false;
  await enviarUnaVez({ ...ENVIO, operacion: 'envio-correo-a2', efecto, reconciliar, almacen: a });
  assert.equal(salidas, 1, 'salió una sola vez en total');
});

test('envíos: el almacén falla al guardar «succeeded»: el reintento de la misma operación reconcilia, no reenvía', async () => {
  const { a, falla } = almacenFalible();
  let salidas = 0;
  const efecto = async (): Promise<SalidaEnvio> => (salidas++, { estado: 'succeeded', referencia: 'msg-1' });
  let buscadas = 0;
  const reconciliar = async () => (buscadas++, { encontrado: false as const });
  falla.escribir = (k, v) => k.startsWith('operaciones') && v?.estado === 'succeeded';
  const r = await enviarUnaVez({ ...ENVIO, operacion: 'envio-correo-b1', efecto, reconciliar, almacen: a });
  assert.equal(r.estado, 'succeeded');
  falla.escribir = () => false;
  const otra = await enviarUnaVez({ ...ENVIO, operacion: 'envio-correo-b1', efecto, reconciliar, almacen: a });
  assert.equal(salidas, 1, 'no se mandó dos veces');
  assert.equal(otra.repetido, true);
  assert.equal(otra.estado, 'unknown', 'quedó «dispatched»: se reconcilia y, sin constancia, sigue incierto');
  assert.ok(buscadas >= 1);
});

test('repetición incierta: solo la acepta el «sí» del chat a esa pregunta; un «Aprobar» del panel (de antes) no la manda', async () => {
  const C = await import('../server/correo');
  const { agregarCuenta, cuentasDe, quitarCuenta, _olvidarCuentas } = await import('../lib/correo/cuentas');
  const PROV = { nombre: 'Prueba', imap: { host: '127.0.0.1', puerto: 993, seguro: true }, smtp: { host: '127.0.0.1', puerto: 465, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: false } as any;
  const mandados: unknown[] = [];
  const modo = { timeout: true };
  C._buzonDePrueba({
    mandar: async (_q: string, _c: unknown, e: any) => {
      mandados.push(e);
      if (modo.timeout) throw Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT', command: 'DATA' });
      return { messageId: e.messageId, guardadoEnEnviados: false, aceptados: e.para, rechazados: [] };
    },
    buscarEnviado: async () => 'no-encontrado' as const,
  } as any);
  _usarAlmacenDurable(almacenEnMemoria());
  C._olvidarCorreo();
  _olvidarCuentas();
  const quien = 'rita@x.hn';
  await agregarCuenta(quien, 'rita@prueba.hn', PROV, 'clave');
  try {
    // 1) Sale y queda incierto (timeout después de DATA, no está en Enviados).
    await C.correrCorreo(quien, 'escribir ana@example.test | Pago | Ana, ya hice el pago.', 'tel');
    assert.equal((await C.resolverBorradorConEstado(quien, 'tel', 'sí'))!.estado, 'unknown');
    assert.equal(mandados.length, 1);
    // 2) Lo mismo otra vez: no sale; se pregunta si lo manda sabiendo que podría repetirse.
    modo.timeout = false;
    await C.correrCorreo(quien, 'escribir ana@example.test | Pago | Ana, ya hice el pago.', 'tel');
    const intento = C.borradorDe(quien, 'tel')!.intento;
    assert.match((await C.resolverBorradorConEstado(quien, 'tel', 'sí'))!.texto, /«sí» otra vez/);
    assert.equal(mandados.length, 1);
    // 3) El «Aprobar» del panel para ese mismo borrador (la decisión de antes, que no vio la pregunta): no sale.
    assert.equal(C.borradorDe(quien, 'tel')?.intento, intento, 'el borrador espera la respuesta informada');
    // Con la huella exacta del borrador (bloqueo 1): lo que frena aquí es el riesgo de repetir, no otra versión.
    const panel = await C.resolverBorradorConEstado(quien, 'tel', 'sí', undefined, { desdePanel: true, huella: C.borradorDe(quien, 'tel')!.huella });
    assert.equal(mandados.length, 1, 'el panel no acepta el riesgo de repetir por la persona');
    assert.match(panel!.texto, /sin confirmar/);
    // 4) El «sí» del chat a la pregunta informada sí lo manda (una vez).
    assert.match((await C.resolverBorradorConEstado(quien, 'tel', 'sí'))!.texto, /«sí» otra vez/, 'vuelve a preguntar en el chat');
    const r = (await C.resolverBorradorConEstado(quien, 'tel', 'sí'))!;
    assert.equal(r.estado, 'succeeded');
    assert.equal(mandados.length, 2);
  } finally {
    _usarAlmacenDurable(null);
    C._buzonDePrueba(null);
    C._olvidarCorreo();
    for (const c of await cuentasDe(quien)) await quitarCuenta(quien, c.id);
  }
});

test('eventos entrantes: si el almacén no deja saber si ya llegó, es «incierto» (no «primera vez»)', async () => {
  const { a, falla } = almacenFalible();
  assert.equal(await vezDelEvento('telegram', 'bot-1', '77', a), 'primera');
  assert.equal(await vezDelEvento('telegram', 'bot-1', '77', a), 'repetido');
  falla.escribir = () => true;
  assert.equal(await vezDelEvento('telegram', 'bot-1', '78', a), 'incierto');
});

/* ------------------------------------------------------------------ la computadora */

const CLAVE_NODO = 'clave-de-prueba';

/** Un nodo de mentira: cuenta las altas; `olvidar()` es su reinicio (pierde su dedupe por request_id, como agente.py). */
async function nodoFalso(o: { tarea?: (id: string) => Record<string, unknown> } = {}) {
  const porPedido = new Map<string, string>();
  let altas = 0;
  const srv = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      const json = (code: number, j: unknown) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(j)));
      const cuerpo = datos ? JSON.parse(datos) : null;
      if (req.url === '/salud') return json(200, { ok: true, motores: ['holo'], ocupada: false, capacidades: ['pausar', 'confirmar'] });
      if (req.headers.authorization !== `Bearer ${CLAVE_NODO}`) return json(401, { detail: 'clave' });
      if (req.method === 'POST' && req.url === '/tareas') {
        const llave = cuerpo.request_id ? `${cuerpo.dueno}|${cuerpo.request_id}` : '';
        if (llave && porPedido.has(llave)) return json(200, { id: porPedido.get(llave), estado: 'trabajando', repetida: true });
        const id = `n${++altas}`;
        if (llave) porPedido.set(llave, id);
        return json(200, { id, estado: 'en_cola' });
      }
      const m = req.url!.match(/^\/tareas\/(\w+)/);
      if (m) return json(200, { id: m[1], motor: 'holo', instruccion: 'x', estado: 'trabajando', pasos: [], respuesta: null, error: null, segundos: 3, ...(o.tarea?.(m[1]) || {}) });
      return json(404, { detail: 'no existe' });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { url, altas: () => altas, olvidar: () => porPedido.clear(), cerrar: () => new Promise<void>((r) => (srv.closeAllConnections?.(), srv.close(() => r()))) };
}

async function conComputadora<T>(url: string, fn: (pc: typeof import('../server/computadora')) => Promise<T>): Promise<T> {
  const pc = await import('../server/computadora');
  const antes = { u: process.env.COMPUTADORA_URL, c: process.env.COMPUTADORA_CLAVE, t: { ...pc.TIEMPOS_SEGUIR } };
  process.env.COMPUTADORA_URL = url;
  process.env.COMPUTADORA_CLAVE = CLAVE_NODO;
  Object.assign(pc.TIEMPOS_SEGUIR, { sondeoMs: 40, silencioTrasTurnoMs: 0, narrarCadaMs: 0, reintentoMs: 20 });
  pc.alAvisarApp(() => 1);
  pc._olvidarEncargos();
  try {
    return await fn(pc);
  } finally {
    pc._olvidarEncargos();
    pc.alAvisarApp(null);
    Object.assign(pc.TIEMPOS_SEGUIR, antes.t);
    for (const [k, v] of [['COMPUTADORA_URL', antes.u], ['COMPUTADORA_CLAVE', antes.c]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Las rutas de la computadora montadas de nuevo (un «proceso» nuevo: su Map de pedidos vacío). */
async function rutas<T>(pc: typeof import('../server/computadora'), fn: (pedir: (cuerpo: unknown) => Promise<{ code: number; j: any }>) => Promise<T>): Promise<T> {
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  const pasa: RequestHandler = (_q, _r, n) => n();
  pc.montarRutasComputadora(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe: () => ({ correo: 'jose@x.hn' }) });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const pedir = (cuerpo: unknown) =>
    fetch(`${base}/api/computadora/tareas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) }).then(async (r) => ({ code: r.status, j: await r.json() }));
  try {
    return await fn(pedir);
  } finally {
    await new Promise<void>((r) => srv.close(() => r()));
  }
}

test('computadora: con requestId y el almacén sin contestar al mirar el pedido, NO se lanza la tarea', async () => {
  const { a, falla } = almacenFalible();
  _usarAlmacenDurable(a);
  const nodo = await nodoFalso();
  try {
    await conComputadora(nodo.url, async (pc) => {
      falla.leer = (k) => k.startsWith('computadora-pedidos');
      falla.escribir = (k) => k.startsWith('computadora-pedidos');
      const r = await rutas(pc, (pedir) => pedir({ instruccion: 'Entra al banco y paga la luz', requestId: 'tel-falla-lect-01' }));
      assert.equal(r.code, 503, 'se dice con honestidad');
      assert.equal(nodo.altas(), 0, 'ninguna tarea lanzada a ciegas');
    });
  } finally {
    _usarAlmacenDurable(null);
    await nodo.cerrar();
  }
});

test('computadora: se lanzó la tarea pero no se pudo anotar; tras un reinicio (el nodo también) el reintento NO lanza otra', async () => {
  const { a, falla } = almacenFalible();
  _usarAlmacenDurable(a);
  const nodo = await nodoFalso();
  try {
    await conComputadora(nodo.url, async (pc) => {
      // Lo que no se puede guardar es justo la anotación con el id de la tarea creada.
      falla.escribir = (k, v) => k.startsWith('computadora-pedidos') && !!v?.id;
      const cuerpo = { instruccion: 'Entra al banco y paga la luz', requestId: 'tel-falla-escr-01' };
      const primera = await rutas(pc, (pedir) => pedir(cuerpo));
      assert.equal(primera.code, 200);
      assert.equal(nodo.altas(), 1);
      // Reinicio del servidor y del nodo (el nodo pierde su dedupe en RAM); el almacén ya contesta.
      falla.escribir = () => false;
      pc._olvidarEncargos();
      nodo.olvidar();
      const otra = await rutas(pc, (pedir) => pedir(cuerpo));
      assert.equal(nodo.altas(), 1, 'no se lanzó una segunda tarea');
      assert.notEqual(otra.code, 200, 'se dice que no se sabe si se creó (revisar), no se crea otra');
      assert.equal(otra.j.code, 'pedido_incierto');
    });
  } finally {
    _usarAlmacenDurable(null);
    await nodo.cerrar();
  }
});

test('computadora: un pedido nuevo con el almacén sano se crea una vez y su reintento devuelve la misma', async () => {
  _usarAlmacenDurable(almacenEnMemoria());
  const nodo = await nodoFalso();
  try {
    await conComputadora(nodo.url, async (pc) => {
      const cuerpo = { instruccion: 'Entra a bch.hn y dime el dólar', requestId: 'tel-sano-000001' };
      const [x, y] = await rutas(pc, (pedir) => Promise.all([pedir(cuerpo), pedir(cuerpo)]));
      assert.equal(x.code, 200);
      assert.equal(y.j.id, x.j.id);
      pc._olvidarEncargos();
      nodo.olvidar();
      const z = await rutas(pc, (pedir) => pedir(cuerpo));
      assert.equal(z.j.id, x.j.id);
      assert.equal(z.j.repetido, true);
      assert.equal(nodo.altas(), 1);
    });
  } finally {
    _usarAlmacenDurable(null);
    await nodo.cerrar();
  }
});

test('computadora: una tarea que no alcanzó y dejó una acción INCIERTA no se sigue sola (no se repite lo que pudo haber salido)', async () => {
  const nodo = await nodoFalso({
    tarea: (id) =>
      id === 'n1'
        ? { estado: 'sin_pasos', error: 'se acabaron los pasos', pasos: [{ n: 1, t: 2, accion: 'click', args: { element: 'Pagar' }, hecho: false, incierto: true }] }
        : { estado: 'trabajando' },
  });
  try {
    await conComputadora(nodo.url, async (pc) => {
      const r = await pc.encargarTarea({ instruccion: 'Paga la luz en el banco', quien: 'jose@x.hn', motor: 'holo', esperaMs: 0 });
      assert.equal(r.id, 'n1');
      await new Promise((ok) => setTimeout(ok, 400));
      assert.equal(nodo.altas(), 1, 'no se lanzó la continuación automática');
      assert.match(pc.instruccionContinuar('Paga la luz', { pasos: [{ n: 1, t: 2, accion: 'click', args: { element: 'Pagar' }, incierto: true }] }), /NO la repitas/);
    });
  } finally {
    await nodo.cerrar();
  }
});
