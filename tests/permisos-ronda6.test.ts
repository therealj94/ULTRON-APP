/**
 * PERMISOS EXACTOS, SEXTA RONDA (quinta revisión independiente sobre 98b4a90).
 *
 *  G1-A (grave): «sí, a Ana» mandaba al grupo «Familia de Ana». Un grupo solo se identifica por su nombre COMPLETO; una
 *        persona con nombre de varias palabras, por su nombre de pila, su apellido o el completo, si ningún otro
 *        contacto conocido ni otro destino comparte esa palabra; el nombre completo de OTRO contacto siempre pregunta.
 *  M1-B: sin teléfono (la web), los chats de WhatsApp de la cuenta cuentan como conocidos («Antonio, sí»).
 *  M1-C: uso normal que debe confirmar (voseo, «pue», vocativos de lista cerrada, «a todos» con una sola pendiente).
 *
 * Caminos REALES con efectos simulados y contados (puente de WhatsApp y buzón SMTP de mentira). Datos sintéticos.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'permisos-ronda6-'));
process.env.CORREO_CLAVE_CIFRADO ||= 'llave-de-prueba';
Object.assign(process.env, {
  ULTRON_CORREO_DIR: DIR,
  ULTRON_TAREA_CURSO_DIR: path.join(DIR, 'tarea-en-curso'),
  ULTRON_ABIERTOS_DIR: path.join(DIR, 'abiertos'),
  ULTRON_DURABLE_DIR: path.join(DIR, 'durable'),
  ULTRON_MEMORIA_BUCKET: '',
});
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const D = await import('../lib/durable');
const C = await import('../server/correo');
const W = await import('../server/whatsapp');
const T = await import('../server/decision-turno');
const APP = await import('../lib/acciones-app');
const { agregarCuenta, cuentasDe, quitarCuenta, _olvidarCuentas } = await import('../lib/correo/cuentas');
type Envio = import('../lib/correo/buzon').Envio;

/* ------------------------------------------------------------------ el entorno de mentira */

const JOSE = 'jose3@example.test';
const CLAVE_PUENTE = 'clave-del-puente-de-prueba-123';
const PROV = { nombre: 'Prueba', imap: { host: '127.0.0.1', puerto: 993, seguro: true }, smtp: { host: '127.0.0.1', puerto: 465, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: false } as any;
const sinT = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const chat = (jid: string, nombre: string, numero: string, grupo = false) => ({ jid, nombre, grupo, noLeidos: 0, hora: Date.now(), ultimo: '', ultimoMio: false, numero });
const BRUNO = chat('50477773333@s.whatsapp.net', 'Bruno', '+50477773333');
const TIGO = chat('50477770001@s.whatsapp.net', 'Tigo', '+50477770001');
const ANTONIO = chat('50477770002@s.whatsapp.net', 'Antonio', '+50477770002');
const PAZ = chat('50477770003@s.whatsapp.net', 'Paz', '+50477770003');
const CLARO = chat('50477770004@s.whatsapp.net', 'Claro', '+50477770004');
const FAMILIA_ANA = chat('120363000000000001@g.us', 'Familia de Ana', '', true);
const GRUPO_TODOS = chat('120363000000000002@g.us', 'Grupo Familia Todos', '', true);
const ANA_LOPEZ = chat('50477770005@s.whatsapp.net', 'Ana López', '+50477770005');
const ANA_PEREZ = chat('50477770006@s.whatsapp.net', 'Ana Pérez', '+50477770006');
/** Los chats que el puente de mentira dice tener (cada prueba pone los suyos). */
let CHATS: any[] = [BRUNO, TIGO, ANTONIO, PAZ, CLARO];

async function conEntorno<R>(lista: any[], fn: (e: { mandados: Envio[]; enviados: Array<{ chat: string; texto: string }> }) => Promise<R>): Promise<R> {
  const enviados: Array<{ chat: string; texto: string }> = [];
  const srv = http.createServer((req, res) => {
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
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const mandados: Envio[] = [];
  const buzon = {
    listar: async () => lista,
    mandar: async (_q: string, _c: unknown, e: Envio) => (mandados.push(e), { messageId: e.messageId || '<x@example.test>', guardadoEnEnviados: false, aceptados: [...e.para], rechazados: [] }),
    buscarEnviado: async () => 'no-encontrado' as const,
  };
  const antes = { u: process.env.WHATSAPP_PUENTE_URL, c: process.env.WHATSAPP_PUENTE_CLAVE, d: process.env.WHATSAPP_DUENOS };
  Object.assign(process.env, { WHATSAPP_PUENTE_URL: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, WHATSAPP_PUENTE_CLAVE: CLAVE_PUENTE, WHATSAPP_DUENOS: JOSE });
  D._usarAlmacenDurable(D.almacenEnMemoria());
  C._buzonDePrueba(buzon as any);
  C._olvidarCorreo();
  W._olvidarWhatsapp();
  _olvidarCuentas();
  for (const c of await cuentasDe(JOSE)) await quitarCuenta(JOSE, c.id);
  await agregarCuenta(JOSE, 'jose3@prueba.example.test', PROV, 'clave');
  try {
    return await fn({ mandados, enviados });
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
    await new Promise<void>((r) => srv.close(() => r()));
  }
}



const turno = (mensaje: string, o: Record<string, unknown> = {}) => T.resolverDecisionesDelTurno({ dueno: JOSE, ambito: 'tel', mensaje, whatsapp: true, registrarEfecto: async () => true, ...o } as any);
const PREGUNTA = /cuál|no coincide|no es eso|nombró|no queda claro|confirm/i;
const vivo = (b: any) => !!b && !b.soloPanel;
type Espera = 'manda' | 'pregunta';

/** Un WhatsApp para `chat` esperando; `frase` en el turno real (dos veces). Devuelve los envíos y los hechos. */
async function conWhatsapp(chats: any[], para: string, frase: string, o: Record<string, unknown> = {}) {
  CHATS = chats;
  return conEntorno([], async ({ enviados }) => {
    await W.correrWhatsapp(JOSE, `responder ${para} | Llego a las 7.`, 'tel');
    const r = await turno(frase, o);
    await turno(frase, o);
    return { enviados: enviados.map((e) => e.chat), hechos: r.hechos.join('\n'), sigue: vivo(W.borradorWhatsappDe(JOSE, 'tel')) };
  });
}

/* ------------------------------------------------------------------ G1-A: grupos y nombres de varias palabras */

test('ronda 6 G1-A (servidor): «sí, a Ana» NO manda al grupo «Familia de Ana»; solo su nombre completo lo identifica', async () => {
  const filas: Array<[string, Espera]> = [
    ['sí, a Ana', 'pregunta'],
    ['sí, a la familia', 'pregunta'],
    ['sí, al grupo', 'pregunta'],
    ['sí, a la familia de Ana', 'manda'],
    ['sí', 'manda'],
  ];
  const fallos: string[] = [];
  for (const [frase, espera] of filas) {
    const r = await conWhatsapp([BRUNO, FAMILIA_ANA], 'Familia de Ana', frase);
    const vale = espera === 'manda' ? r.enviados.length === 1 && r.enviados[0] === FAMILIA_ANA.jid : r.enviados.length === 0 && r.sigue && PREGUNTA.test(r.hechos);
    if (!vale) fallos.push(`«${frase}» esperaba ${espera}: enviados=${JSON.stringify(r.enviados)}`);
  }
  assert.deepEqual(fallos, []);
});

test('ronda 6 G1-A (servidor): «sí, a la familia» o «sí, al grupo» contra «Grupo Familia Todos» preguntan', async () => {
  const fallos: string[] = [];
  for (const [frase, espera] of [['sí, a la familia', 'pregunta'], ['sí, al grupo', 'pregunta'], ['dale', 'manda']] as Array<[string, Espera]>) {
    const r = await conWhatsapp([BRUNO, GRUPO_TODOS], 'Grupo Familia Todos', frase);
    const vale = espera === 'manda' ? r.enviados.length === 1 : r.enviados.length === 0 && r.sigue && PREGUNTA.test(r.hechos);
    if (!vale) fallos.push(`«${frase}» esperaba ${espera}: enviados=${JSON.stringify(r.enviados)}`);
  }
  assert.deepEqual(fallos, []);
});

test('ronda 6 G1-A (servidor): WhatsApp para «Ana López» — «sí, a Ana» manda sin otra Ana; con «Ana Pérez» entre sus chats, pregunta', async () => {
  const sola = await conWhatsapp([BRUNO, ANA_LOPEZ], 'Ana López', 'sí, a Ana');
  assert.deepEqual(sola.enviados, [ANA_LOPEZ.jid], 'sin otra Ana: el nombre de pila la identifica');
  const apellido = await conWhatsapp([BRUNO, ANA_LOPEZ, ANA_PEREZ], 'Ana López', 'sí, a López');
  assert.deepEqual(apellido.enviados, [ANA_LOPEZ.jid], 'el apellido, que nadie más tiene, la identifica');
  const otra = await conWhatsapp([BRUNO, ANA_LOPEZ, ANA_PEREZ], 'Ana López', 'sí, a Ana');
  assert.deepEqual(otra.enviados, [], 'con otra Ana conocida: no sale');
  assert.match(otra.hechos, PREGUNTA);
  const otraPorTelefono = await conWhatsapp([BRUNO, ANA_LOPEZ], 'Ana López', 'sí, a Ana', { conocidos: ['Ana Pérez'] });
  assert.deepEqual(otraPorTelefono.enviados, [], 'un contacto «Ana Pérez» del teléfono también la vuelve dudosa');
});

test('ronda 6 G1-A (función única): grupos, nombre de pila, apellido, nombre de otro contacto', async () => {
  const A = await import('../lib/afirmacion');
  const familia: any = { tipo: 'whatsapp', destino: 'Familia de Ana', grupo: true };
  const todos: any = { tipo: 'whatsapp', destino: 'Grupo Familia Todos', grupo: true };
  const lopez: any = { tipo: 'whatsapp', destino: 'Ana López (+50477770005)' };
  const filas: Array<[string, any[], string, string[]?]> = [
    ['sí, a Ana', [familia], 'preguntar'],
    ['sí, a la familia', [familia], 'preguntar'],
    ['sí, a la familia de Ana', [familia], 'ejecutar'],
    ['sí, al grupo', [todos], 'preguntar'],
    ['sí, al grupo familia', [todos], 'preguntar'],
    ['sí, a Ana', [lopez], 'ejecutar'],
    ['sí, a López', [lopez], 'ejecutar'],
    ['sí, a Ana López', [lopez], 'ejecutar'],
    ['sí, a Ana', [lopez], 'preguntar', ['Ana Pérez']],
    ['sí, a López', [lopez], 'ejecutar', ['Ana Pérez']],
    ['sí, a Ana López', [lopez], 'ejecutar', ['Ana Pérez']],
    ['sí, a Ana', [lopez], 'preguntar', ['Ana']],
    ['sí, a Bruno', [lopez], 'preguntar', ['Bruno']],
  ];
  const fallos: string[] = [];
  for (const [frase, ps, tipo, conocidos] of filas) {
    const d: any = A.decidirPendiente(frase, ps, conocidos ? { conocidos } : {});
    if (d.tipo !== tipo) fallos.push(`«${frase}»${conocidos ? ` con ${conocidos}` : ''}: esperaba ${tipo}, dio ${d.tipo}`);
  }
  assert.deepEqual(fallos, []);
});

/* ------------------------------------------------------------------ M1-B: en la web, sus chats de WhatsApp cuentan */

test('ronda 6 M1-B (servidor, sin teléfono): «Antonio, sí» con Antonio entre sus chats de WhatsApp pregunta', async () => {
  CHATS = [BRUNO, ANTONIO];
  await conEntorno([], async ({ mandados }) => {
    await C.correrCorreo(JOSE, 'escribir ana@example.test | Informe | Va.', 'tel');
    const r = await turno('Antonio, sí');
    assert.equal(mandados.length, 0, 'no sale el correo para Ana');
    assert.ok(vivo(C.borradorDe(JOSE, 'tel')));
    assert.match(r.hechos.join('\n'), PREGUNTA);
    // Sin Antonio entre sus chats, es el vocativo de siempre.
    CHATS = [BRUNO];
    W._olvidarWhatsapp();
    C._olvidarCorreo();
    await C.correrCorreo(JOSE, 'escribir ana@example.test | Informe | Va.', 'tel');
    await turno('Antonio, sí');
    assert.equal(mandados.length, 1);
  });
});

/* ------------------------------------------------------------------ M1-C: uso normal */

const USO_NORMAL = [
  'vaya pues', 'sí pue', 'dale pue', 'ta bien',
  'hacelo', 'mandalo', 'mandá', 'enviá', 'sí, mandá',
  'jefe, sí', 'sí, jefa', 'sí mano', 'sí, hermano', 'sí, hermana', 'dale compa', 'sí, amor', 'sí, mi amor', 'sí, cariño', 'sí bro', 'yes boss', 'ok man',
  'sí, mándalo ahora', 'sí, ya', 'órale', 'okis', 'sure thing', 'go for it',
];

test('ronda 6 M1-C: uso normal que confirma (atajo de la app y servidor), una vez', async () => {
  const fallos: string[] = [];
  const PEND = { para: 'ana@example.test', texto: 'Llego a las 3' };
  const CTX: any = { pantalla: 'chats', contactos: [{ correo: 'ana@example.test', nombre: 'Ana' }], manos: ['enviar_exacto'] };
  for (const frase of USO_NORMAL) {
    if (APP.ordenPorReglas(frase, { pendiente: PEND, contexto: CTX })?.accion?.tipo !== 'enviar') fallos.push(`atajo «${frase}»`);
  }
  CHATS = [BRUNO];
  await conEntorno([], async ({ mandados }) => {
    for (const frase of USO_NORMAL) {
      C._olvidarCorreo();
      const antes = mandados.length;
      await C.correrCorreo(JOSE, 'escribir ana@example.test | Informe | Va.', 'tel');
      await turno(frase);
      await turno(frase);
      if (mandados.length - antes !== 1) fallos.push(`servidor «${frase}»: ${mandados.length - antes}`);
    }
  });
  assert.deepEqual(fallos, []);
});

test('ronda 6 M1-C: los vocativos nuevos solo sueltos — «sí, a mi jefe», «mándaselo al hermano» preguntan', async () => {
  const A = await import('../lib/afirmacion');
  const ana: any = { tipo: 'correo', destino: 'Ana <ana@example.test>' };
  const fallos: string[] = [];
  for (const frase of ['sí, a mi jefe', 'mándaselo al hermano', 'sí, para mi amor', 'sí, a la jefa', 'send it to the boss']) {
    const d: any = A.decidirPendiente(frase, [ana]);
    if (d.tipo !== 'preguntar') fallos.push(`«${frase}»: dio ${d.tipo}`);
    if (A.esAfirmacionPura(frase)) fallos.push(`«${frase}» es pura`);
  }
  assert.deepEqual(fallos, []);
});

test('ronda 6 M1-C: «sí, a todos» / «a los dos» con UN correo para varios ejecuta para todos; con varias pendientes, pregunta', async () => {
  CHATS = [BRUNO];
  const fallos: string[] = [];
  await conEntorno([], async ({ mandados, enviados }) => {
    for (const frase of ['sí, a todos', 'sí, a los dos', 'mándaselo a los dos']) {
      C._olvidarCorreo();
      W._olvidarWhatsapp();
      const antes = mandados.length;
      await C.correrCorreo(JOSE, 'escribir ana@example.test, bruno@example.test | Informe | Va.', 'tel');
      await turno(frase);
      await turno(frase);
      if (mandados.length - antes !== 1 || mandados.at(-1)!.para.length !== 2) fallos.push(`una pendiente «${frase}»: ${mandados.length - antes}`);
      // Con otra pendiente además (un WhatsApp para Bruno): pregunta.
      C._olvidarCorreo();
      const m0 = mandados.length;
      const e0 = enviados.length;
      await C.correrCorreo(JOSE, 'escribir ana@example.test, bruno@example.test | Informe | Va.', 'tel');
      await W.correrWhatsapp(JOSE, 'responder Bruno | Va.', 'tel');
      const r = await turno(frase);
      if (mandados.length !== m0 || enviados.length !== e0 || !PREGUNTA.test(r.hechos.join('\n'))) fallos.push(`dos pendientes «${frase}»: mandados=${mandados.length - m0} enviados=${enviados.length - e0}`);
    }
  });
  assert.deepEqual(fallos, []);
});
