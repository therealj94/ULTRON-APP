/**
 * SEC-01 · el residual del chat ESCRITO: un «sí» escrito no aprueba una versión que nunca se presentó.
 *
 * Reproducción de la auditoría sobre 5754c78 (§4, SEC-01, «Estado candidato»): el «sí» hablado ya estaba atado a la
 * huella que muestra el aparato (server/decision-hablada.ts), pero el chat escrito seguía el camino de antes. Ocho
 * negativos —correo y WhatsApp × (A-v2 tras editar con el registro viejo de la ventana | con la ventana oculta | A
 * aparcado a la vista con el registro vencido | con el registro perdido, renovación `registrada:false`)— DESPACHABAN con
 * un «sí» escrito. Contrato: la aprobación se ata a la presentación concreta (server/presentacion-decision.ts): su texto
 * en el chat (con la tarjeta y su huella) o la ventana mientras su registro vive; sin prueba de presentación no se busca
 * otro candidato: se vuelve a presentar ESA versión y se pregunta. Controles positivos: lo presentado sale una vez; la
 * ventana vigente manda lo que muestra; el teléfono que escribe con la ventana a la vista manda su `decisionVista`; el
 * toque en la ventana no cambia.
 *
 * Caminos REALES (borradores de server/correo.ts y server/whatsapp.ts, rutas de server/trabajos.ts, la regla única) con
 * los envíos simulados y contados. Datos sintéticos.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-escrita-'));
process.env.CORREO_CLAVE_CIFRADO ||= 'llave-de-prueba';
Object.assign(process.env, {
  ULTRON_CORREO_DIR: DIR,
  ULTRON_TAREA_CURSO_DIR: path.join(DIR, 'tarea-en-curso'),
  ULTRON_ABIERTOS_DIR: path.join(DIR, 'abiertos'),
  ULTRON_DURABLE_DIR: path.join(DIR, 'durable'),
  ULTRON_VOCES_DIR: path.join(DIR, 'voces'),
  ULTRON_MEMORIA_BUCKET: '',
});
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const D = await import('../lib/durable');
const C = await import('../server/correo');
const W = await import('../server/whatsapp');
const T = await import('../server/decision-turno');
const TR = await import('../server/trabajos');
const DP = await import('../server/decision-en-pantalla');
const COLA = await import('../server/borradores-cola');
const { agregarCuenta, cuentasDe, quitarCuenta, _olvidarCuentas } = await import('../lib/correo/cuentas');
type Envio = import('../lib/correo/buzon').Envio;

const JOSE = 'jose-escrita@example.test';
const APARATO = 'telefono-de-jose-1';
const CLAVE_PUENTE = 'clave-del-puente-de-prueba-123';
const PROV = { nombre: 'Prueba', imap: { host: '127.0.0.1', puerto: 993, seguro: true }, smtp: { host: '127.0.0.1', puerto: 465, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: false } as any;
const sinT = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const chat = (jid: string, nombre: string, numero: string) => ({ jid, nombre, grupo: false, noLeidos: 0, hora: Date.now(), ultimo: '', ultimoMio: false, numero });
const BRUNO = chat('50477773333@s.whatsapp.net', 'Bruno', '+50477773333');
const TIGO = chat('50477770001@s.whatsapp.net', 'Tigo', '+50477770001');
const CHATS = [BRUNO, TIGO];

type Entorno = { mandados: Envio[]; enviados: Array<{ chat: string; texto: string }>; pedir: (ruta: string, cuerpo?: unknown, cab?: Record<string, string>) => Promise<{ status: number; json: any }> };

async function conEntorno<R>(fn: (e: Entorno) => Promise<R>): Promise<R> {
  const enviados: Array<{ chat: string; texto: string }> = [];
  const puente = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      const json = (code: number, j: unknown) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(j)));
      if (req.headers.authorization !== `Bearer ${CLAVE_PUENTE}`) return json(401, { error: 'clave' });
      const u = new URL(req.url!, 'http://x');
      if (u.pathname === '/estado') return json(200, { vinculado: true, conectado: true, numero: '+50499998888', vinculando: false });
      if (u.pathname === '/chats') {
        const b = sinT(u.searchParams.get('buscar') || '');
        return json(200, { chats: CHATS.filter((c) => !b || sinT(c.nombre).includes(b)) });
      }
      if (u.pathname === '/contactos') return json(200, { contactos: [] });
      if (u.pathname === '/mensajes') return json(200, { chat: CHATS.find((c) => c.jid === u.searchParams.get('chat')) || BRUNO, mensajes: [] });
      if (u.pathname === '/mensaje') return json(404, { error: 'no está' });
      if (u.pathname === '/enviar') {
        const c = JSON.parse(datos);
        enviados.push({ chat: c.chat, texto: c.texto });
        return json(200, { mensaje: { id: c.id || 'E1', chat: c.chat, mio: true, texto: c.texto, tipo: 'texto', hora: Date.now() } });
      }
      return json(404, { error: 'no' });
    });
  });
  await new Promise<void>((r) => puente.listen(0, '127.0.0.1', r));
  const mandados: Envio[] = [];
  const buzon = {
    listar: async () => [],
    mandar: async (_q: string, _c: unknown, e: Envio) => (mandados.push(e), { messageId: e.messageId || '<x@example.test>', guardadoEnEnviados: false, aceptados: [...e.para], rechazados: [] }),
    buscarEnviado: async () => 'no-encontrado' as const,
  };
  // Las rutas de las tareas como en server.ts (los borradores de verdad).
  const app = express();
  app.use(express.json());
  const pasa: express.RequestHandler = (_q, _r, n) => n();
  TR.montarRutasTrabajos(app, {
    exigirMesa: pasa,
    limitar: () => pasa,
    sesionDe: (req) => ({ correo: String(req.headers['x-quien'] || '') }),
    borradores: {
      vigente: (correo, canal, ambito, intento) => {
        const b = intento ? (canal === 'correo' ? C.borradorCorreoPorIntento(correo, ambito, intento) : W.borradorWhatsappPorIntento(correo, ambito, intento)) : canal === 'correo' ? C.borradorDe(correo, ambito) : W.borradorWhatsappDe(correo, ambito);
        return b ? { intento: b.intento, huella: b.huella } : null;
      },
      enviar: (correo, canal, ambito, intento, huella) => T.resolverBorradorDesdePanel(correo, canal, ambito, intento, 'sí', huella),
      descartar: (correo, canal, ambito, intento) => T.resolverBorradorDesdePanel(correo, canal, ambito, intento, 'no'),
      editar: (correo, canal, ambito, intento, huella, cambios) => {
        if (canal === 'correo') {
          const r = C.editarBorradorCorreo(correo, ambito, intento, huella, cambios);
          return r.ok === false ? r : { ok: true, borrador: { canal, intento: r.borrador.intento, para: r.borrador.para, desde: r.borrador.desde, asunto: r.borrador.asunto, texto: r.borrador.texto, vence: r.borrador.vence, huella: r.borrador.huella } };
        }
        const r = W.editarBorradorWhatsapp(correo, ambito, intento, huella, cambios);
        return r.ok === false ? r : { ok: true, borrador: { canal, intento: r.borrador.intento, para: W.destinoWhatsapp(r.borrador), texto: r.borrador.texto, vence: r.borrador.vence, huella: r.borrador.huella } };
      },
    },
  } as any);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const pedir = async (ruta: string, cuerpo?: unknown, cab: Record<string, string> = {}) => {
    const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}${ruta}`, { method: cuerpo ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-quien': JOSE, 'x-aura-aparato': APARATO, ...cab }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    return { status: r.status, json: (await r.json()) as any };
  };
  const antes = { u: process.env.WHATSAPP_PUENTE_URL, c: process.env.WHATSAPP_PUENTE_CLAVE, d: process.env.WHATSAPP_DUENOS };
  Object.assign(process.env, { WHATSAPP_PUENTE_URL: `http://127.0.0.1:${(puente.address() as AddressInfo).port}`, WHATSAPP_PUENTE_CLAVE: CLAVE_PUENTE, WHATSAPP_DUENOS: JOSE });
  D._usarAlmacenDurable(D.almacenEnMemoria());
  C._buzonDePrueba(buzon as any);
  C._olvidarCorreo();
  W._olvidarWhatsapp();
  DP._olvidarEnPantalla();
  T._olvidarMencionados?.();
  COLA._olvidarVencidos?.();
  _olvidarCuentas();
  for (const c of await cuentasDe(JOSE)) await quitarCuenta(JOSE, c.id);
  await agregarCuenta(JOSE, 'jose-escrita@prueba.example.test', PROV, 'clave');
  try {
    return await fn({ mandados, enviados, pedir });
  } finally {
    for (const [k, v] of [['WHATSAPP_PUENTE_URL', antes.u], ['WHATSAPP_PUENTE_CLAVE', antes.c], ['WHATSAPP_DUENOS', antes.d]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    for (const c of await cuentasDe(JOSE)) await quitarCuenta(JOSE, c.id);
    C._buzonDePrueba(null);
    C._olvidarCorreo();
    W._olvidarWhatsapp();
    DP._olvidarEnPantalla();
    D._usarAlmacenDurable(null);
    await new Promise<void>((r) => srv.close(() => r()));
    await new Promise<void>((r) => puente.close(() => r()));
  }
}

/** Un turno del chat ESCRITO (como lo arma server.ts para lo tecleado: sin `hablado`). */
const escrito = (mensaje: string, o: Record<string, unknown> = {}) => T.resolverDecisionesDelTurno({ dueno: JOSE, ambito: 'tel', mensaje, whatsapp: true, registrarEfecto: async () => true, ...o } as any);
const tareaDe = async (e: Entorno, id: string) => (await e.pedir(`/api/trabajos/${id}`)).json.tarea;
const campoDe = (t: any) => ({ tareaId: t.id, decisionId: t.decisionId, huella: t.decision?.fingerprint });

type B = { intento: string; huella: string; texto: string; vence: number; creado: number };
/** Lo que cambia entre correo y WhatsApp; el resto de cada prueba es igual para los dos canales. */
type Canal = {
  nombre: 'correo' | 'whatsapp';
  crearA: (texto?: string) => Promise<unknown>;
  crearB: () => Promise<unknown>;
  principal: () => B | null;
  apartados: () => B[];
  tarjeta: (b: B) => Promise<{ id: string }>;
  salidos: (e: Entorno) => string[];
};
const CANALES: Canal[] = [
  {
    nombre: 'correo',
    crearA: (texto = 'Va el informe de octubre.') => C.correrCorreo(JOSE, `escribir ana@example.test | Informe | ${texto}`, 'tel'),
    crearB: () => C.correrCorreo(JOSE, 'escribir bruno@example.test | Otro | Esto es para Bruno.', 'tel'),
    principal: () => C.borradorDe(JOSE, 'tel') as any,
    apartados: () => C.apartadosCorreoDe(JOSE, 'tel') as any,
    tarjeta: async (b: any) => (await TR.abrirDecisionDeBorrador(JOSE, 'tel', { canal: 'correo', intento: b.intento, para: b.para, desde: b.desde, asunto: b.asunto, texto: b.texto, vence: b.vence, huella: b.huella }))!,
    salidos: (e) => e.mandados.map((m) => m.texto.split('\n')[0]),
  },
  {
    nombre: 'whatsapp',
    crearA: (texto = 'Llego a las 5.') => W.correrWhatsapp(JOSE, `responder Bruno | ${texto}`, 'tel'),
    crearB: () => W.correrWhatsapp(JOSE, 'responder Tigo | Mañana pago la factura.', 'tel'),
    principal: () => W.borradorWhatsappDe(JOSE, 'tel') as any,
    apartados: () => W.apartadosWhatsappDe(JOSE, 'tel') as any,
    tarjeta: async (b: any) => (await TR.abrirDecisionDeBorrador(JOSE, 'tel', { canal: 'whatsapp', intento: b.intento, para: W.destinoWhatsapp(b), texto: b.texto, vence: b.vence, huella: b.huella }))!,
    salidos: (e) => e.enviados.map((x) => x.texto),
  },
];

const visible = (e: Entorno, ref: { id: string }, t: any, seq: number, extra: Record<string, unknown> = {}) => e.pedir(`/api/trabajos/${ref.id}/en-pantalla`, { decisionId: t.decisionId, visible: true, seq, ...extra });

for (const k of CANALES) {
  /* ── los ocho negativos de la auditoría (cuatro por canal): cero despachos ── */

  test(`SEC-01 ${k.nombre} · negativo 1: A-v2 tras editar, con el registro VIEJO de la ventana (v1) → un «sí» escrito no manda nada`, async () => {
    await conEntorno(async (e) => {
      await k.crearA();
      const v1 = k.principal()!;
      const ref = await k.tarjeta(v1);
      const t1 = await tareaDe(e, ref.id);
      assert.equal((await visible(e, ref, t1, 1)).json.registrada, true);
      const ed = await e.pedir(`/api/trabajos/${ref.id}/editar`, { decisionId: t1.decisionId, expectedVersion: t1.version, texto: 'Versión editada que no se mostró.' });
      assert.equal(ed.status, 200, JSON.stringify(ed.json));
      assert.notEqual(k.principal()!.huella, v1.huella);
      // Nombrarlo tampoco basta: esa versión no se vio (y después de esto se le vuelve a presentar).
      const r0 = await escrito(k.nombre === 'correo' ? 'sí, el correo' : 'sí, el whatsapp');
      assert.deepEqual(k.salidos(e), [], `A-v2 nunca se presentó: ${r0.hechos.join(' | ')}`);
      assert.match(r0.hechos.join('\n'), /NO se mandó nada/);
    });
  });

  test(`SEC-01 ${k.nombre} · negativo 2: A-v2 tras editar con la ventana OCULTA → nada`, async () => {
    await conEntorno(async (e) => {
      await k.crearA();
      const v1 = k.principal()!;
      const ref = await k.tarjeta(v1);
      const t1 = await tareaDe(e, ref.id);
      await visible(e, ref, t1, 1);
      // Al editar, la ventana deja de estar «a la vista» (se oculta) y el texto cambia.
      await e.pedir(`/api/trabajos/${ref.id}/en-pantalla`, { decisionId: t1.decisionId, visible: false, seq: 2 });
      const ed = await e.pedir(`/api/trabajos/${ref.id}/editar`, { decisionId: t1.decisionId, expectedVersion: t1.version, texto: 'Otra versión, sin mostrar.' });
      assert.equal(ed.status, 200);
      const r = await escrito('sí, mándalo');
      assert.deepEqual(k.salidos(e), [], r.hechos.join(' | '));
    });
  });

  test(`SEC-01 ${k.nombre} · negativo 3: A aparcado a la vista con el registro VENCIDO y B actual → no cae a B (ni a A)`, async () => {
    await conEntorno(async (e) => {
      await k.crearA();
      await escrito('¿qué hora es?'); // A queda aparcado para el panel
      await k.crearB();
      const a = k.apartados()[0] ?? k.principal()!;
      const ref = await k.tarjeta(a);
      const t = await tareaDe(e, ref.id);
      assert.equal((await visible(e, ref, t, 1)).json.registrada, true);
      // El registro caduca (la ventana dejó de renovar).
      DP.fijarEnPantalla(JOSE, { canal: k.nombre, ambito: 'tel', intento: a.intento, huella: a.huella, tareaId: ref.id, decisionId: t.decisionId, via: 'pantalla', aparato: APARATO } as any, Date.now() - DP.EN_PANTALLA_VIVE_MS - 1000);
      const r = await escrito('sí');
      assert.deepEqual(k.salidos(e), [], `ni B (que no se veía) ni A sin registro: ${r.hechos.join(' | ')}`);
    });
  });

  test(`SEC-01 ${k.nombre} · negativo 4: A aparcado con el registro PERDIDO (renovación «registrada:false») y B actual → nada`, async () => {
    await conEntorno(async (e) => {
      await k.crearA();
      await escrito('¿qué hora es?');
      await k.crearB();
      const a = k.apartados()[0] ?? k.principal()!;
      const ref = await k.tarjeta(a);
      const t = await tareaDe(e, ref.id);
      assert.equal((await visible(e, ref, t, 1)).json.registrada, true);
      DP.soltarEnPantalla(JOSE); // el registro se pierde
      const ren = await visible(e, ref, t, 2, { renovar: true });
      assert.equal(ren.json.registrada, false, 'la renovación lo dice: perdió la autoridad');
      const r = await escrito('sí');
      assert.deepEqual(k.salidos(e), [], r.hechos.join(' | '));
    });
  });

  /* ── controles positivos ── */

  test(`SEC-01 ${k.nombre} · positivo: lo presentado en el chat sale exactamente una vez (y un «sí» repetido no lo repite)`, async () => {
    await conEntorno(async (e) => {
      await k.crearA();
      const a = k.principal()!;
      const r = await escrito('sí');
      assert.equal(r.respondio, true, r.hechos.join(' | '));
      assert.equal(k.salidos(e).length, 1);
      assert.ok(a.texto.startsWith(k.salidos(e)[0]) || k.salidos(e)[0].startsWith(a.texto.split('\n')[0]), `salió lo presentado: ${k.salidos(e)[0]}`);
      await escrito('sí');
      assert.equal(k.salidos(e).length, 1, 'replay: una sola vez');
    });
  });

  test(`SEC-01 ${k.nombre} · positivo: tras el negativo, la versión se vuelve a presentar y el «sí» siguiente manda ESA, una vez`, async () => {
    await conEntorno(async (e) => {
      await k.crearA();
      const v1 = k.principal()!;
      const ref = await k.tarjeta(v1);
      const t1 = await tareaDe(e, ref.id);
      await visible(e, ref, t1, 1);
      await e.pedir(`/api/trabajos/${ref.id}/editar`, { decisionId: t1.decisionId, expectedVersion: t1.version, texto: 'La versión nueva.' });
      const r1 = await escrito('sí');
      assert.deepEqual(k.salidos(e), []);
      assert.match(r1.hechos.join('\n'), /La versión nueva\./, 'se le vuelve a presentar el texto exacto');
      const r2 = await escrito('sí');
      assert.equal(r2.respondio, true, r2.hechos.join(' | '));
      assert.deepEqual(k.salidos(e), ['La versión nueva.']);
    });
  });

  test(`SEC-01 ${k.nombre} · positivo: con el registro VIGENTE de la ventana, el «sí» escrito manda A (la que se ve), no B`, async () => {
    await conEntorno(async (e) => {
      await k.crearA('Esta es la A.');
      await escrito('¿qué hora es?');
      await k.crearB();
      const a = k.apartados()[0] ?? k.principal()!;
      const ref = await k.tarjeta(a);
      const t = await tareaDe(e, ref.id);
      assert.equal((await visible(e, ref, t, 1)).json.registrada, true);
      const r = await escrito('sí');
      assert.equal(r.respondio, true, r.hechos.join(' | '));
      assert.deepEqual(k.salidos(e), ['Esta es la A.']);
    });
  });

  test(`SEC-01 ${k.nombre} · positivo/negativo: el teléfono que ESCRIBE con la ventana a la vista manda su decisionVista — la huella mostrada manda; la vieja no`, async () => {
    await conEntorno(async (e) => {
      await k.crearA();
      const v1 = k.principal()!;
      const ref = await k.tarjeta(v1);
      const t1 = await tareaDe(e, ref.id);
      await visible(e, ref, t1, 1);
      await e.pedir(`/api/trabajos/${ref.id}/editar`, { decisionId: t1.decisionId, expectedVersion: t1.version, texto: 'Editado en la ventana.' });
      const viejo = await escrito('sí', { decisionVista: campoDe(t1), aparato: APARATO });
      assert.deepEqual(k.salidos(e), [], viejo.hechos.join(' | '));
      assert.match(viejo.hechos.join('\n'), /escribió/);
      const t2 = await tareaDe(e, ref.id);
      assert.equal((await visible(e, ref, t2, 2)).json.registrada, true);
      const nuevo = await escrito('sí', { decisionVista: campoDe(t2), aparato: APARATO });
      assert.equal(nuevo.respondio, true, nuevo.hechos.join(' | '));
      assert.deepEqual(k.salidos(e), ['Editado en la ventana.']);
    });
  });

  test(`SEC-01 ${k.nombre} · el toque en la ventana (POST decisiones «aprobar») no cambia`, async () => {
    await conEntorno(async (e) => {
      await k.crearA('Aprobada con el dedo.');
      const ref = await k.tarjeta(k.principal()!);
      const t = await tareaDe(e, ref.id);
      const r = await e.pedir(`/api/trabajos/${ref.id}/decisiones`, { decisionId: t.decisionId, expectedVersion: t.version, opcion: 'aprobar' });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.deepEqual(k.salidos(e), ['Aprobada con el dedo.']);
    });
  });
}

test('SEC-01: tras un reinicio (lo presentado y el registro, en memoria, se pierden) un «sí» escrito no manda: vuelve a presentar', async () => {
  await conEntorno(async (e) => {
    await CANALES[1].crearA();
    DP._olvidarEnPantalla();
    const r = await escrito('sí');
    assert.deepEqual(e.enviados, [], r.hechos.join(' | '));
    assert.match(r.hechos.join('\n'), /Llego a las 5\./);
    await escrito('sí');
    assert.deepEqual(e.enviados.map((x) => x.texto), ['Llego a las 5.']);
  });
});
