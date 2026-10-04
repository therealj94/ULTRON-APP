/**
 * PERMISOS EXACTOS (revisión externa, 4-oct, bloqueante): ninguna aprobación se reutiliza porque la acción sea de la
 * misma CLASE. Aprobar un mensaje a Ana nunca autoriza otro a Bruno. Cada aprobación queda atada a la cuenta (dueño y
 * cuenta o canal vinculado), a la tarea o el intento, a la acción, al destinatario RESUELTO (correo, jid, número), al
 * contenido (su huella) y a la versión de la propuesta. Si algo cambia, o el contacto es ambiguo, se bloquea y se pide
 * otra decisión. Sin huella o sin versión: se bloquea, nunca se deja pasar.
 *
 * Se maneja el camino real —aprobación → reserva → efecto— con efectos SIMULADOS y contados:
 *   · correo: un buzón de mentira (el SMTP no existe; se cuentan los `mandar`);
 *   · WhatsApp: un puente de mentira por HTTP (se cuentan los `/enviar`);
 *   · computadora: un nodo de mentira por HTTP que contesta como agente.py (se cuentan los «sí» aceptados);
 *   · la app (PULSE2CHAT): las acciones que salen hacia el teléfono (se cuentan los `enviar`);
 *   · el círculo, la cola de aprobaciones y el panel de tareas, con sus ejecutores de mentira.
 * Lo durable, en memoria. Datos sintéticos (example.test, números falsos).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { RequestHandler } from 'express';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'permisos-exactos-'));
process.env.CORREO_CLAVE_CIFRADO ||= 'llave-de-prueba';
Object.assign(process.env, {
  ULTRON_CORREO_DIR: DIR,
  ULTRON_TAREA_CURSO_DIR: path.join(DIR, 'tarea-en-curso'),
  ULTRON_ABIERTOS_DIR: path.join(DIR, 'abiertos'),
  ULTRON_DURABLE_DIR: path.join(DIR, 'durable'),
  ULTRON_CIRCULO_DIR: path.join(DIR, 'circulo'),
  ULTRON_CONOCER_DIR: path.join(DIR, 'conocer'),
  ULTRON_EPISODIOS_DIR: path.join(DIR, 'episodios'),
  ULTRON_MEMORIA_BUCKET: '',
});
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const D = await import('../lib/durable');
const C = await import('../server/correo');
const W = await import('../server/whatsapp');
const T = await import('../server/decision-turno');
const PC = await import('../server/computadora');
const TR = await import('../server/trabajos');
const APP = await import('../lib/acciones-app');
const CI = await import('../lib/circulo');
const { agregarCuenta, cuentasDe, quitarCuenta, _olvidarCuentas } = await import('../lib/correo/cuentas');
const { elegirContacto } = await import('../mobile/src/pulse/elegirContacto');
type Envio = import('../lib/correo/buzon').Envio;
type AvisoApp = import('../server/computadora').AvisoApp;

const esperar = (ms = 60) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond: () => boolean, ms = 8000) {
  const fin = Date.now() + ms;
  while (!cond() && Date.now() < fin) await esperar(25);
  assert.ok(cond(), 'no pasó a tiempo');
}

/* ================================================================== el entorno: buzón, puente y cuenta */

const JOSE = 'jose@example.test';
const CLAVE_PUENTE = 'clave-del-puente-de-prueba-123';
const PROV = { nombre: 'Prueba', imap: { host: '127.0.0.1', puerto: 993, seguro: true }, smtp: { host: '127.0.0.1', puerto: 465, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: false } as any;
const sinT = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

type Chat = { jid: string; nombre: string; grupo: boolean; noLeidos: number; hora: number; ultimo: string; ultimoMio: boolean; numero: string };
const chat = (jid: string, nombre: string, numero: string): Chat => ({ jid, nombre, grupo: false, noLeidos: 0, hora: Date.now(), ultimo: '', ultimoMio: false, numero });
const ANA = chat('50499991111@s.whatsapp.net', 'Ana', '+50499991111');
const BRUNO = chat('50477773333@s.whatsapp.net', 'Bruno', '+50477773333');

/** Un puente de WhatsApp de mentira: lo que lista, el número de la cuenta vinculada y lo que de verdad sale. */
async function puente(chats: Chat[], numero: string | null = '+50499998888') {
  const enviados: Array<{ chat: string; texto: string }> = [];
  const srv = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      const json = (code: number, j: unknown) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(j)));
      if (req.headers.authorization !== `Bearer ${CLAVE_PUENTE}`) return json(401, { error: 'clave' });
      const u = new URL(req.url!, 'http://x');
      if (u.pathname === '/estado') return json(200, { vinculado: true, conectado: true, ...(numero ? { numero } : {}), vinculando: false });
      if (u.pathname === '/chats') {
        const b = sinT(u.searchParams.get('buscar') || '');
        return json(200, { chats: chats.filter((c) => !b || sinT(c.nombre).includes(b) || c.jid.includes(b) || c.numero.replace(/\D/g, '').includes(b)) });
      }
      if (u.pathname === '/contactos') return json(200, { contactos: [] });
      if (u.pathname === '/mensajes') return json(200, { chat: chats[0], mensajes: [] });
      if (u.pathname === '/mensaje') return json(404, { error: 'no está' });
      if (u.pathname === '/enviar') {
        const c = JSON.parse(datos);
        enviados.push({ chat: c.chat, texto: c.texto });
        return json(200, { mensaje: { id: c.id || 'E1', chat: c.chat, mio: true, texto: c.texto, tipo: 'texto', hora: Date.now() } });
      }
      return json(404, { error: 'no' });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, enviados, cerrar: () => new Promise<void>((r) => srv.close(() => r())) };
}

/** Un buzón de mentira: lo que lista (para «el de Ana») y lo que de verdad sale por SMTP. */
function buzonDeEnvio(lista: any[] = []) {
  const mandados: Envio[] = [];
  return {
    mandados,
    buzon: {
      listar: async () => lista,
      mandar: async (_q: string, _c: unknown, e: Envio) => {
        mandados.push(e);
        return { messageId: e.messageId || '<x@example.test>', guardadoEnEnviados: false, aceptados: [...e.para, ...(e.cc || [])], rechazados: [] };
      },
      buscarEnviado: async () => 'no-encontrado' as const,
    },
  };
}

type Entorno = { mandados: Envio[]; enviados: Array<{ chat: string; texto: string }> };

/** Todo junto, para JOSE: su correo (jose@prueba.example.test) y su WhatsApp vinculado. */
async function conEntorno<T>(o: { chats?: Chat[]; numero?: string | null; lista?: any[] }, fn: (e: Entorno) => Promise<T>): Promise<T> {
  const p = await puente(o.chats || [ANA, BRUNO], o.numero === undefined ? '+50499998888' : o.numero);
  const b = buzonDeEnvio(o.lista);
  const antes = { u: process.env.WHATSAPP_PUENTE_URL, c: process.env.WHATSAPP_PUENTE_CLAVE, d: process.env.WHATSAPP_DUENOS };
  Object.assign(process.env, { WHATSAPP_PUENTE_URL: p.url, WHATSAPP_PUENTE_CLAVE: CLAVE_PUENTE, WHATSAPP_DUENOS: JOSE });
  D._usarAlmacenDurable(D.almacenEnMemoria());
  C._buzonDePrueba(b.buzon as any);
  C._olvidarCorreo();
  W._olvidarWhatsapp();
  _olvidarCuentas();
  for (const c of await cuentasDe(JOSE)) await quitarCuenta(JOSE, c.id);
  await agregarCuenta(JOSE, 'jose@prueba.example.test', PROV, 'clave');
  try {
    return await fn({ mandados: b.mandados, enviados: p.enviados });
  } finally {
    for (const [k, v] of [['WHATSAPP_PUENTE_URL', antes.u], ['WHATSAPP_PUENTE_CLAVE', antes.c], ['WHATSAPP_DUENOS', antes.d]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    for (const c of await cuentasDe(JOSE)) await quitarCuenta(JOSE, c.id);
    C._buzonDePrueba(null);
    C._olvidarCorreo();
    W._olvidarWhatsapp();
    D._usarAlmacenDurable(null);
    await p.cerrar();
  }
}

/** El «sí» (o lo que diga) del chat al empezar el turno: el camino de server.ts (prepararTurno). */
const turno = (mensaje: string, o: Partial<Parameters<typeof T.resolverDecisionesDelTurno>[0]> = {}) =>
  T.resolverDecisionesDelTurno({ dueno: JOSE, ambito: 'tel', mensaje, whatsapp: true, registrarEfecto: async () => true, ...o });

/* ================================================================== correo y WhatsApp: el «sí» del chat */

test('chat: un correo para Ana y un WhatsApp para Bruno esperan a la vez → un «sí» suelto NO manda ninguno (pregunta cuál)', async () => {
  await conEntorno({}, async ({ mandados, enviados }) => {
    await C.correrCorreo(JOSE, 'escribir ana@example.test | Informe | Va el informe.', 'tel');
    await W.correrWhatsapp(JOSE, 'responder Bruno | Va el informe.', 'tel');
    const r = await turno('sí');
    assert.equal(mandados.length, 0, 'el «sí» pudo ser para cualquiera de los dos: no sale el correo');
    assert.equal(enviados.length, 0, 'ni el WhatsApp a Bruno');
    assert.match(r.hechos.join('\n'), /cuál/i, 'el modelo sabe que tiene que preguntar cuál');
    assert.ok(C.borradorDe(JOSE, 'tel') && W.borradorWhatsappDe(JOSE, 'tel'), 'los dos siguen esperando su propia decisión');
  });
});

test('chat: con los dos esperando, «sí, el correo» manda SOLO el correo a Ana, una vez; el WhatsApp a Bruno no sale', async () => {
  await conEntorno({}, async ({ mandados, enviados }) => {
    await C.correrCorreo(JOSE, 'escribir ana@example.test | Informe | Va el informe.', 'tel');
    await W.correrWhatsapp(JOSE, 'responder Bruno | Va el informe.', 'tel');
    await turno('sí, el correo');
    assert.deepEqual(mandados.map((m) => m.para), [['ana@example.test']]);
    assert.equal(enviados.length, 0, 'nombrar el correo no aprueba el WhatsApp');
    await turno('sí, el correo');
    assert.equal(mandados.length, 1, 'un segundo «sí» no lo manda otra vez');
  });
});

test('chat: la app tiene un mensaje para Bruno esperando y hay un correo para Ana → el «sí» no manda el correo', async () => {
  await conEntorno({}, async ({ mandados }) => {
    await C.correrCorreo(JOSE, 'escribir ana@example.test | Hola | Hola Ana.', 'tel');
    const r = await turno('sí', { appEspera: true, app: { que: 'mensaje', para: 'bruno@example.test' } } as any);
    assert.equal(mandados.length, 0, 'el «sí» pudo ser para el mensaje de la app');
    assert.equal((r as any).appBloqueada, true, 'y tampoco sale el de la app en este turno');
  });
});

test('chat: el borrador para Ana pasa a Bruno en el mismo turno → el «sí» no manda a Bruno (correo y WhatsApp); informado, sale UNA vez', async () => {
  await conEntorno({}, async ({ mandados, enviados }) => {
    await C.correrCorreo(JOSE, 'escribir ana@example.test | X | Hola.', 'tel');
    await C.correrCorreo(JOSE, 'escribir bruno@example.test | X | Hola.', 'tel');
    await turno('sí');
    assert.equal(mandados.length, 0);
    await turno('sí');
    await turno('sí');
    assert.deepEqual(mandados.map((m) => m.para), [['bruno@example.test']], 'el de Bruno, una sola vez');
    C._olvidarCorreo();
    await W.correrWhatsapp(JOSE, 'responder Ana | Hola.', 'tel');
    await W.correrWhatsapp(JOSE, 'responder Bruno | Hola.', 'tel');
    await turno('sí');
    assert.equal(enviados.length, 0);
    await turno('sí');
    await turno('sí');
    assert.deepEqual(enviados.map((e) => e.chat), [BRUNO.jid]);
  });
});

test('correo: mismo destinatario pero otro contenido después del «sí» (voz) → no sale; vuelve como decisión nueva', async () => {
  await conEntorno({}, async ({ mandados }) => {
    await C.correrCorreo(JOSE, 'escribir ana@example.test | Pago | Ya pagué.', 'tel');
    const r: { hacer: (() => void) | null } = { hacer: null };
    await turno('sí', { retener: { hacer: (f: () => void) => (r.hacer = f), alDescartar: () => {}, recordar: () => {} } as any });
    // Antes del efecto, el borrador para la MISMA Ana cambió de texto.
    const b = C.borradorDe(JOSE, 'tel');
    if (b) b.texto = 'Ya pagué. Deposita L 5,000 en esta otra cuenta.';
    else await C.correrCorreo(JOSE, 'escribir ana@example.test | Pago | Ya pagué. Deposita L 5,000 en esta otra cuenta.', 'tel');
    r.hacer?.();
    await esperar();
    assert.equal(mandados.length, 0, 'el «sí» era para el texto que oyó');
  });
});

test('correo: «escríbele a Ana» con dos Ana distintas en la lista → no arma borrador y pregunta cuál (con sus direcciones)', async () => {
  const lista = [
    { ref: 'x:1', de: 'Ana Paz', deCorreo: 'ana.paz@example.test', asunto: 'Factura', fecha: new Date().toISOString(), noLeido: true, adjuntos: [], extracto: '' },
    { ref: 'x:2', de: 'Ana López', deCorreo: 'ana.lopez@example.test', asunto: 'Cita', fecha: new Date(Date.now() - 1000).toISOString(), noLeido: true, adjuntos: [], extracto: '' },
  ];
  await conEntorno({ lista }, async ({ mandados }) => {
    await C.correrCorreo(JOSE, 'revisar', 'tel');
    const r = await C.correrCorreoConEstado(JOSE, 'escribir Ana | Hola | Hola Ana.', 'tel');
    assert.equal(r.estado, 'failed');
    assert.equal(C.borradorDe(JOSE, 'tel'), null, 'sin borrador: no hay nada que aprobar');
    assert.match(r.texto, /ana\.paz@example\.test/);
    assert.match(r.texto, /ana\.lopez@example\.test/);
    assert.match(r.texto, /cuál/i);
    assert.equal((await turno('sí')).delCorreo, null);
    assert.equal(mandados.length, 0);
  });
});

test('correo: sin huella no sale (ni por el chat ni repitiendo el envío)', async () => {
  await conEntorno({}, async ({ mandados }) => {
    await C.correrCorreo(JOSE, 'escribir ana@example.test | X | Hola.', 'tel');
    const b = C.borradorDe(JOSE, 'tel')!;
    b.huella = '';
    await turno('sí');
    assert.equal(mandados.length, 0);
    assert.equal((await C.enviarBorradorAprobado(JOSE, { ...b, huella: '' })).estado, 'failed');
    assert.equal(mandados.length, 0);
  });
});

/* ================================================================== WhatsApp: cuenta y destinatario */

test('WhatsApp: un borrador sin la cuenta vinculada con la que se armó no sale (sin cuenta = no se sabe desde dónde)', async () => {
  await conEntorno({}, async ({ enviados }) => {
    const r = W.borradorWhatsappParaConEstado(JOSE, 'tel', { chat: ANA.jid, nombre: 'Ana', texto: 'Llego tarde' });
    await turno('sí');
    assert.equal(enviados.length, 0, `sin cuenta no se manda (${r.estado})`);
  });
});

test('WhatsApp: dos chats cuyo número termina igual → pregunta cuál; nunca el primero que encuentre', async () => {
  const otraAna = chat('155599991111@s.whatsapp.net', 'Ana (EE. UU.)', '+155599991111');
  await conEntorno({ chats: [otraAna, ANA] }, async ({ enviados }) => {
    const r = await W.correrWhatsappConEstado(JOSE, 'responder 9999-1111 | Hola', 'tel');
    assert.equal(r.estado, 'failed', r.texto);
    assert.match(r.texto, /cuál/i);
    assert.equal(W.borradorWhatsappDe(JOSE, 'tel'), null);
    await turno('sí');
    assert.equal(enviados.length, 0);
  });
});

test('WhatsApp: la aprobación exacta sale UNA vez (chat, otro «sí» y reintento del mismo borrador)', async () => {
  await conEntorno({}, async ({ enviados }) => {
    await W.correrWhatsapp(JOSE, 'responder Ana | Te veo a las 3', 'tel');
    const b = W.borradorWhatsappDe(JOSE, 'tel')!;
    await turno('sí');
    await turno('sí');
    assert.equal((await W.enviarBorradorWhatsappAprobado(JOSE, b)).estado, 'succeeded', 'el reintento ve la misma operación');
    assert.deepEqual(enviados, [{ chat: ANA.jid, texto: 'Te veo a las 3' }]);
    // Y el mismo intento con otro chat (Bruno) o con otro texto: no sale.
    assert.equal((await W.enviarBorradorWhatsappAprobado(JOSE, { ...b, chat: BRUNO.jid })).estado, 'failed');
    assert.equal((await W.enviarBorradorWhatsappAprobado(JOSE, { ...b, texto: 'Otra cosa' })).estado, 'failed');
    assert.equal(enviados.length, 1);
  });
});

/* ================================================================== el panel de tareas */

function panel(deps: Partial<import('../server/trabajos').DepsTrabajos>) {
  const pasa: RequestHandler = (_q, _r, n) => n();
  const app = express();
  app.use(express.json());
  TR.montarRutasTrabajos(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null), ...deps });
  const srv = app.listen(0, '127.0.0.1');
  const listo = new Promise((r) => srv.once('listening', r));
  const pedir = async (ruta: string, cuerpo?: unknown) => {
    await listo;
    const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}${ruta}`, { method: cuerpo ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-quien': JOSE }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    return { status: r.status, json: (await r.json()) as any };
  };
  return { pedir, cerrar: () => srv.close() };
}

/** Los borradores del panel, como los conecta server.ts (los de verdad). */
const borradoresReales = {
  vigente: (correo: string, canal: 'correo' | 'whatsapp', ambito: string) => {
    const b = canal === 'correo' ? C.borradorDe(correo, ambito) : W.borradorWhatsappDe(correo, ambito);
    return b ? { intento: b.intento, huella: b.huella } : null;
  },
  enviar: (correo: string, canal: 'correo' | 'whatsapp', ambito: string, intento: string, huella: string) => T.resolverBorradorDesdePanel(correo, canal, ambito, intento, 'sí', huella),
  descartar: (correo: string, canal: 'correo' | 'whatsapp', ambito: string, intento: string) => T.resolverBorradorDesdePanel(correo, canal, ambito, intento, 'no'),
};

async function tarjetaDe(dueno: string, ambito: string, canal: 'correo' | 'whatsapp') {
  const b = canal === 'correo' ? C.borradorDe(dueno, ambito)! : W.borradorWhatsappDe(dueno, ambito)!;
  const ref = await TR.abrirDecisionDeBorrador(dueno, ambito, canal === 'correo' ? { canal, intento: b.intento, para: (b as any).para, desde: (b as any).desde, asunto: (b as any).asunto, texto: b.texto, vence: b.vence, huella: b.huella } : { canal, intento: b.intento, para: W.destinoWhatsapp(b as any), texto: b.texto, vence: b.vence, huella: b.huella });
  return ref!;
}

test('panel: «Aprobar» la tarjeta de Ana cuando lo que espera ya es para Bruno → 409, nada sale; la de Bruno sale UNA vez (otro clic, el chat)', async () => {
  await conEntorno({}, async ({ mandados }) => {
    const p = panel({ borradores: borradoresReales });
    try {
      await C.correrCorreo(JOSE, 'escribir ana@example.test | X | Hola.', 'tel');
      const refAna = await tarjetaDe(JOSE, 'tel', 'correo');
      const vistaAna = (await p.pedir(`/api/trabajos/${refAna.id}`)).json.tarea;
      // El plan cambió (mismo turno): ahora espera uno para Bruno.
      await C.correrCorreo(JOSE, 'escribir bruno@example.test | X | Hola.', 'tel');
      const refBruno = await tarjetaDe(JOSE, 'tel', 'correo');
      const r = await p.pedir(`/api/trabajos/${vistaAna.id}/decisiones`, { decisionId: vistaAna.decisionId, expectedVersion: vistaAna.version, opcion: 'aprobar' });
      assert.equal(r.status, 409);
      assert.equal(mandados.length, 0, 'aprobé a Ana en el panel: no sale para Bruno');
      const vb = (await p.pedir(`/api/trabajos/${refBruno.id}`)).json.tarea;
      const cuerpo = { decisionId: vb.decisionId, expectedVersion: vb.version, opcion: 'aprobar' };
      assert.equal((await p.pedir(`/api/trabajos/${vb.id}/decisiones`, cuerpo)).status, 200);
      assert.equal((await p.pedir(`/api/trabajos/${vb.id}/decisiones`, cuerpo)).json.repetida, true, 'el segundo clic no ejecuta');
      await turno('sí');
      assert.deepEqual(mandados.map((m) => m.para), [['bruno@example.test']], 'una sola vez');
    } finally {
      p.cerrar();
    }
  });
});

test('panel: si el borrador que espera no dice su huella, «Aprobar» NO llama al envío (sin huella = bloqueo)', async () => {
  D._usarAlmacenDurable(D.almacenEnMemoria());
  let envios = 0;
  const p = panel({
    borradores: {
      vigente: () => ({ intento: 'i-ana' }),
      enviar: async () => ((envios += 1), { estado: 'succeeded', resumen: 'CORREO ENVIADO a ana@example.test' }),
      descartar: async () => undefined,
    },
  });
  try {
    const ref = await TR.abrirDecisionDeBorrador(JOSE, 'tel', { canal: 'correo', intento: 'i-ana', para: ['ana@example.test'], desde: 'jose@prueba.example.test', asunto: 'X', texto: 'Hola', vence: Date.now() + 60_000, huella: 'h-ana' });
    const t = (await p.pedir(`/api/trabajos/${ref!.id}`)).json.tarea;
    const r = await p.pedir(`/api/trabajos/${t.id}/decisiones`, { decisionId: t.decisionId, expectedVersion: t.version, opcion: 'aprobar' });
    assert.equal(r.status, 409);
    assert.equal(envios, 0);
  } finally {
    p.cerrar();
    D._usarAlmacenDurable(null);
  }
});

/* ================================================================== la computadora */

const CLAVE_NODO = 'clave-de-prueba';
type TareaNodo = { id: string; instruccion: string; estado: string; pregunta: string | null; pregunta_id: string | null; propuesta: string | null };

/** Un nodo como agente.py: el «sí» tiene que nombrar la pregunta Y la propuesta exactas; se cuentan los aceptados. */
async function nodo(o: { sinPropuesta?: boolean } = {}) {
  const tareas = new Map<string, TareaNodo>();
  const efectos: Array<{ tarea: string; pregunta_id: string | null; propuesta: string | null }> = [];
  const srv = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      const json = (code: number, j: unknown) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(j)));
      const cuerpo = datos ? JSON.parse(datos) : null;
      if (req.url === '/salud') return json(200, { ok: true, motores: ['holo'], ocupada: false, capacidades: ['pausar', 'confirmar', 'control'] });
      if (req.headers.authorization !== `Bearer ${CLAVE_NODO}`) return json(401, { detail: 'clave' });
      if (req.method === 'POST' && req.url === '/tareas') {
        const id = `a${tareas.size + 1}`;
        tareas.set(id, { id, instruccion: cuerpo.instruccion, estado: 'trabajando', pregunta: null, pregunta_id: null, propuesta: null });
        return json(200, { id, estado: 'en_cola' });
      }
      const m = req.url!.match(/^\/tareas\/(\w+)(?:\/(\w+))?/);
      const t = m && tareas.get(m[1]);
      if (!t) return json(404, { detail: 'no existe' });
      if (req.method === 'GET' && !m![2]) {
        return json(200, { id: t.id, motor: 'holo', instruccion: t.instruccion, estado: t.estado, pasos: [], respuesta: null, error: null, segundos: 1, pregunta: t.pregunta, pregunta_id: t.pregunta_id, ...(o.sinPropuesta ? {} : { propuesta: t.propuesta }) });
      }
      if (m![2] === 'confirmar') {
        if (t.estado !== 'confirmar' || cuerpo.pregunta_id !== t.pregunta_id) return json(409, { detail: 'otra pregunta' });
        if (cuerpo.propuesta && cuerpo.propuesta !== t.propuesta) return json(409, { detail: 'otra propuesta' });
        if (cuerpo.si && !o.sinPropuesta && cuerpo.propuesta !== t.propuesta) return json(409, { detail: 'el sí no nombra la propuesta' });
        if (cuerpo.si) efectos.push({ tarea: t.id, pregunta_id: t.pregunta_id, propuesta: t.propuesta });
        Object.assign(t, { estado: 'trabajando', pregunta: null, pregunta_id: null, propuesta: null });
        return json(200, { id: t.id, si: !!cuerpo.si });
      }
      return json(200, { id: t.id, estado: t.estado });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const preguntar = (id: string, pregunta: string, pregunta_id: string, propuesta: string | null) => Object.assign(tareas.get(id)!, { estado: 'confirmar', pregunta, pregunta_id, propuesta });
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, tareas, efectos, preguntar, cerrar: () => new Promise<void>((r) => (srv.closeAllConnections?.(), srv.close(() => r()))) };
}

async function conNodo<T>(o: { sinPropuesta?: boolean }, fn: (n: Awaited<ReturnType<typeof nodo>>, avisos: AvisoApp[]) => Promise<T>): Promise<T> {
  const n = await nodo(o);
  const antes = { u: process.env.COMPUTADORA_URL, c: process.env.COMPUTADORA_CLAVE, t: { ...PC.TIEMPOS_SEGUIR } };
  Object.assign(process.env, { COMPUTADORA_URL: n.url, COMPUTADORA_CLAVE: CLAVE_NODO });
  Object.assign(PC.TIEMPOS_SEGUIR, { sondeoMs: 40, silencioTrasTurnoMs: 0, narrarCadaMs: 0, trabajandoCadaMs: 10_000, fallosAntesDeAvisar: 3, sinRespuestaMs: 3000, reintentoMs: 50 });
  PC._olvidarEncargos();
  const avisos: AvisoApp[] = [];
  PC.alAvisarApp((_q, a) => (avisos.push(a), 1));
  try {
    return await fn(n, avisos);
  } finally {
    PC.alAvisarApp(null);
    PC._olvidarEncargos();
    Object.assign(PC.TIEMPOS_SEGUIR, antes.t);
    for (const [k, v] of [['COMPUTADORA_URL', antes.u], ['COMPUTADORA_CLAVE', antes.c]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await n.cerrar();
  }
}

const preguntasVistas = (avisos: AvisoApp[]) => avisos.filter((a) => a.fase === 'confirmar');
const PREG_ANA = 'Voy a tocar «Enviar» (para ana@example.test). ¿Lo hago?';
const PREG_BRUNO = 'Voy a tocar «Enviar» (para bruno@example.test). ¿Lo hago?';

test('computadora: preguntó por Ana y, antes del «sí», la propuesta pasó a Bruno → el «sí» del chat NO contesta la de Bruno; informado, una vez', async () => {
  await conNodo({}, async (n, avisos) => {
    const r = await PC.encargarTarea({ instruccion: 'Manda el mensaje a Ana', quien: JOSE, motor: 'holo', esperaMs: 0 });
    n.preguntar(r.id!, PREG_ANA, 'p1', 'hA');
    await hasta(() => preguntasVistas(avisos).length === 1);
    n.preguntar(r.id!, PREG_BRUNO, 'p2', 'hB');
    await hasta(() => preguntasVistas(avisos).length === 2);
    const d = await turno('sí');
    assert.equal(n.efectos.length, 0, 'el «sí» era para Ana: no contesta la de Bruno');
    assert.match(d.hechos.join('\n'), /bruno@example\.test/, 'se le dice a quién va ahora');
    await turno('sí');
    assert.deepEqual(n.efectos, [{ tarea: r.id, pregunta_id: 'p2', propuesta: 'hB' }], 'informado: contesta ESA propuesta');
    await turno('sí');
    assert.equal(n.efectos.length, 1, 'una sola vez');
  });
});

test('computadora: la MISMA pregunta (mismo id) cambia de contenido antes del «sí» → ni el chat ni la app la contestan con el sí de antes', async () => {
  await conNodo({}, async (n, avisos) => {
    const r = await PC.encargarTarea({ instruccion: 'Manda el mensaje a Ana', quien: JOSE, motor: 'holo', esperaMs: 0 });
    n.preguntar(r.id!, PREG_ANA, 'p1', 'hA');
    await hasta(() => preguntasVistas(avisos).length === 1);
    n.preguntar(r.id!, 'Voy a tocar «Enviar» (para ana@example.test; por L 5,000). ¿Lo hago?', 'p1', 'hA2');
    await hasta(() => preguntasVistas(avisos).length === 2);
    // La app de antes, con la tarjeta de la primera versión: nombra la pregunta pero no la propuesta.
    const pasa: RequestHandler = (_q, _r, nx) => nx();
    const app = express();
    app.use(express.json());
    PC.montarRutasComputadora(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe: () => ({ correo: JOSE, token: 'token-de-prueba' }) } as any);
    const srv = app.listen(0, '127.0.0.1');
    await new Promise((x) => srv.once('listening', x));
    try {
      const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/computadora/tareas/${r.id}/confirmar`;
      const sinPropuesta = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ si: true, preguntaId: 'p1' }) });
      assert.equal(sinPropuesta.status, 409, 'un sí que no nombra la propuesta no aprueba la de ahora');
      assert.equal(n.efectos.length, 0);
      await turno('sí');
      assert.equal(n.efectos.length, 0, 'el «sí» del chat era para la versión de antes');
      const conPropuesta = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ si: true, preguntaId: 'p1', propuesta: 'hA2' }) });
      assert.equal(conPropuesta.status, 200, 'lo exacto que muestra ahora sí');
      assert.deepEqual(n.efectos, [{ tarea: r.id, pregunta_id: 'p1', propuesta: 'hA2' }]);
    } finally {
      srv.close();
    }
  });
});

test('computadora: dos misiones esperan su sí a la vez → un «sí» suelto no contesta ninguna (pregunta cuál)', async () => {
  await conNodo({}, async (n, avisos) => {
    const a = await PC.encargarTarea({ instruccion: 'Manda el mensaje a Ana', quien: JOSE, motor: 'holo', esperaMs: 0 });
    const b = await PC.encargarTarea({ instruccion: 'Manda el mensaje a Bruno', quien: JOSE, motor: 'holo', esperaMs: 0 });
    n.preguntar(a.id!, PREG_ANA, 'p1', 'hA');
    n.preguntar(b.id!, PREG_BRUNO, 'p2', 'hB');
    await hasta(() => preguntasVistas(avisos).length === 2);
    const d = await turno('sí');
    assert.equal(n.efectos.length, 0, 'el «sí» pudo ser para cualquiera de las dos');
    assert.match(d.hechos.join('\n'), /cuál/i);
  });
});

test('computadora: sin la huella de la propuesta (nodo de antes) el «sí» no se manda', async () => {
  await conNodo({ sinPropuesta: true }, async (n, avisos) => {
    const r = await PC.encargarTarea({ instruccion: 'Manda el mensaje a Ana', quien: JOSE, motor: 'holo', esperaMs: 0 });
    n.preguntar(r.id!, PREG_ANA, 'p1', null);
    await hasta(() => preguntasVistas(avisos).length === 1);
    await turno('sí');
    assert.equal(n.efectos.length, 0);
  });
});

/* ================================================================== la app del teléfono (PULSE2CHAT) */

test('app: dos borradores en el mismo turno (Ana y luego Bruno) → el «sí» no manda el de Bruno; informado, sale UNA vez con el texto aprobado', () => {
  APP._reiniciarAccionesApp();
  const yo = 'pulse@example.test';
  const amb = APP.ambitoApp(yo, 'tel-1');
  APP.abrirTurnoApp(amb);
  APP.empujarAccion(yo, { tipo: 'redactar', para: 'ana@example.test', texto: 'Llego a las 3' }, { aparato: 'tel-1' });
  APP.empujarAccion(yo, { tipo: 'redactar', para: 'bruno@example.test', texto: 'Llego a las 3' }, { aparato: 'tel-1' });
  APP.abrirTurnoApp(amb);
  const enviosDe = (xs: Array<{ tipo: string }>) => xs.filter((x) => x.tipo === 'enviar');
  // El camino rápido («sí») y el del cerebro (el modelo pide enviar): ninguno manda a Bruno con el sí de Ana.
  const rapida = APP.ordenPorReglas('sí', { pendiente: APP.pendienteDe(amb) });
  assert.notEqual(rapida?.accion?.tipo, 'enviar', 'el camino rápido no manda');
  assert.equal(enviosDe(APP.prepararAcciones([{ tipo: 'enviar' }], { mensaje: 'sí, envíalo', pendiente: APP.pendienteAnterior(amb) })).length, 0, 'el del cerebro tampoco');
  // Ya se le dijo a quién va ahora: el «sí» del turno siguiente es para Bruno.
  assert.equal(rapida?.confirmarCambio, true, 'le dice a quién va ahora');
  APP.confirmarCambioApp(amb);
  APP.abrirTurnoApp(amb);
  const ok = APP.prepararAcciones([{ tipo: 'enviar' }], { mensaje: 'sí, envíalo', pendiente: APP.pendienteAnterior(amb) });
  assert.deepEqual(enviosDe(ok), [{ tipo: 'enviar', para: 'bruno@example.test', texto: 'Llego a las 3' }], 'a Bruno, con el texto que oyó');
  APP.empujarAccion(yo, ok[0], { aparato: 'tel-1' });
  APP.abrirTurnoApp(amb);
  assert.equal(enviosDe(APP.prepararAcciones([{ tipo: 'enviar' }], { mensaje: 'sí, envíalo', pendiente: APP.pendienteAnterior(amb) })).length, 0, 'una sola vez');
});

test('app: «enviar» lleva el texto aprobado (el teléfono no manda otro contenido con ese «sí»)', () => {
  APP._reiniciarAccionesApp();
  const yo = 'pulse2@example.test';
  const amb = APP.ambitoApp(yo, 'tel-1');
  APP.abrirTurnoApp(amb);
  APP.empujarAccion(yo, { tipo: 'redactar', para: 'ana@example.test', texto: 'Nos vemos el lunes' }, { aparato: 'tel-1' });
  APP.abrirTurnoApp(amb);
  const r = APP.ordenPorReglas('sí', { pendiente: APP.pendienteDe(amb) });
  assert.deepEqual(r?.accion, { tipo: 'enviar', para: 'ana@example.test', texto: 'Nos vemos el lunes' });
});

test('teléfono: dos contactos que se llaman «Ana» → no elige ninguno (antes ganaba la charla más reciente)', () => {
  const lista = [
    { correo: 'ana.paz@example.test', nombre: 'Ana' },
    { correo: 'ana.lopez@example.test', nombre: 'Ana' },
    { correo: 'bruno@example.test', nombre: 'Bruno Díaz' },
  ];
  assert.equal(elegirContacto('Ana', lista), null);
  assert.deepEqual(elegirContacto('ana.lopez@example.test', lista), lista[1], 'por correo, exacto');
  assert.deepEqual(elegirContacto('Bruno', lista), lista[2], 'uno solo: ese');
});

/* ================================================================== el círculo */

test('círculo: el «permiso permanente» de recordatorios ya no manda nada sin su «sí» (era un permiso por CLASE de acción)', async () => {
  const dueno = 'maria@example.test';
  const { persona: p } = await CI.agregarPersona(dueno, { nombre: 'Luis', relacion: 'esposo', canales: { whatsapp: '+50488887777' } });
  await CI.actualizarPersona(dueno, p.id, { permisos: { recordatorios: 'permitido' } }, { permitirPermisos: true });
  const enviados: any[] = [];
  const borradores: any[] = [];
  const deps = { whatsappListo: () => true, enviar: async (c: string, t: string) => void enviados.push({ c, t }), borrador: (_q: string, _a: string, b: any) => (borradores.push(b), 'BORRADOR') } as any;
  const r = await CI.correrCirculoConEstado(dueno, 'recordar Luis | Transfiere L 5,000 a la cuenta 1234', '', deps);
  assert.equal(enviados.length, 0, 'ningún contenido sale sin aprobar ESE contenido');
  assert.equal(borradores.length, 1, 'queda en borrador, esperando su «sí»');
  assert.equal(r.recibo?.efecto, 'borrador');
});

/* ================================================================== la cola de aprobaciones */

test('aprobaciones: lo mismo pedido por OTRA persona no se junta con la solicitud de la primera (quien la pidió no la firma)', async () => {
  const antes = { e: process.env.ELECTRUM_DB_URL, c: process.env.COGNITIVO_DB_URL, d: process.env.COGNITIVO_DIR };
  delete process.env.ELECTRUM_DB_URL;
  delete process.env.COGNITIVO_DB_URL;
  process.env.COGNITIVO_DIR = fs.mkdtempSync(path.join(DIR, 'cognitivo-'));
  try {
    const { autorizar } = await import('../lib/cognitivo/politica');
    const { firmar, registrarEjecutor } = await import('../lib/cognitivo/aprobaciones');
    const hechas: unknown[] = [];
    registrarEjecutor('permisos_exactos.mandar_informe', async (args) => ((hechas.push(args), { ok: true, texto: 'mandado' })));
    const pedido = (quien: string) => ({ herramienta: 'permisos_exactos.mandar_informe', efecto: 'externo' as const, plataforma: 'electrum' as const, args: { a: 'cliente@example.test' }, quien, nivel: 'mando' as const, prueba: 'sesion' as const, destino: 'tercero' as const });
    const deJose = await autorizar(pedido('jose'));
    const deMedardo = await autorizar(pedido('medardo'));
    assert.ok(deJose.aprobacionId && deMedardo.aprobacionId);
    assert.notEqual(deMedardo.aprobacionId, deJose.aprobacionId, 'cada quien su solicitud');
    const r = await firmar({ id: deMedardo.aprobacionId!, quien: 'medardo', nivel: 'mando', plataforma: 'electrum', decision: 'aprobar' });
    assert.equal(r.ok, false, 'Medardo no aprueba lo que él mismo pidió');
    assert.equal(hechas.length, 0);
    // La de José la firma otra persona: se hace UNA vez, con los argumentos congelados.
    assert.equal((await firmar({ id: deJose.aprobacionId!, quien: 'medardo', nivel: 'mando', plataforma: 'electrum', decision: 'aprobar' })).aprobacion?.estado, 'ejecutada');
    assert.equal((await firmar({ id: deJose.aprobacionId!, quien: 'carlos', nivel: 'mando', plataforma: 'electrum', decision: 'aprobar' })).ok, false);
    assert.deepEqual(hechas, [{ a: 'cliente@example.test' }]);
  } finally {
    for (const [k, v] of [['ELECTRUM_DB_URL', antes.e], ['COGNITIVO_DB_URL', antes.c], ['COGNITIVO_DIR', antes.d]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
