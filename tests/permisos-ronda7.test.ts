/**
 * PERMISOS EXACTOS, SÉPTIMA RONDA (sexta revisión independiente sobre 5f42632).
 *
 *  G1-N1 (grave, concurrencia): un «sí» decidido para Ana terminaba mandando el borrador de Bruno que otro turno de la
 *         misma conversación armó en la ventana entre decidir y resolver. Ahora lo decidido va atado a su intento y su
 *         huella; si cambió, no sale nada y se pregunta. Los conocidos se cargan ANTES de decidir.
 *  G1-m1: si la lista de chats no llega a tiempo, un nombre que no es el COMPLETO del destino pregunta.
 *  G1-m2: un vocativo de la lista («amor», «jefe», «bro», «señor») que es un contacto o un destino pregunta.
 *  G1-m3: el nombre completo del destino lo identifica aunque otro contacto comparta una de sus palabras.
 *  G1-m4: uso normal que debe confirmar («mándalo así», «bueno, mándalo», «yes sir», «sounds good»…).
 *
 * Caminos REALES con efectos simulados y contados; la carrera, reproducida de forma determinista. Datos sintéticos.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'permisos-ronda7-'));
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
/** Si está puesta, la lista de chats (la que carga los conocidos) espera a que la prueba suelte esta promesa. */
let RETENER_CHATS: Promise<void> | null = null;
/** Avisa a la prueba que la lista de chats ya se pidió (y está retenida). */
let AL_PEDIR_CHATS: (() => void) | null = null;

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
        const contestar = () => json(200, { chats: CHATS.filter((c) => !b || sinT(c.nombre).includes(b)) });
        if (RETENER_CHATS && !b) {
          AL_PEDIR_CHATS?.();
          return void RETENER_CHATS.then(contestar);
        }
        return contestar();
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
const PREGUNTA = /cuál|no coincide|no es eso|nombró|no queda claro|confirm|cambió/i;
const vivo = (b: any) => !!b && !b.soloPanel;

/** Otro turno de la misma conversación aparta lo que esperaba y arma uno nuevo para Bruno. */
async function otroTurnoCambiaA(canal: 'correo' | 'whatsapp') {
  if (canal === 'correo') {
    C.borradorDe(JOSE, 'tel')!.soloPanel = true;
    await C.correrCorreo(JOSE, 'escribir bruno@example.test | Otro | Esto es para Bruno.', 'tel');
  } else {
    W.borradorWhatsappDe(JOSE, 'tel')!.soloPanel = true;
    await W.correrWhatsapp(JOSE, 'responder Bruno | Esto es para Bruno.', 'tel');
  }
}

async function armarParaAna(canal: 'correo' | 'whatsapp') {
  if (canal === 'correo') await C.correrCorreo(JOSE, 'escribir ana@example.test | Informe | Va el informe.', 'tel');
  else await W.correrWhatsapp(JOSE, 'responder Ana López | Va el informe.', 'tel');
}

/* ------------------------------------------------------------------ G1-N1: la carrera */

test('ronda 7 G1-N1: el «sí» decidido para Ana NO manda el borrador de Bruno que otro turno armó mientras se registraba el efecto (correo y WhatsApp)', async () => {
  const fallos: string[] = [];
  for (const canal of ['correo', 'whatsapp'] as const) {
    for (const frase of ['sí', 'sí, a Ana']) {
      CHATS = [BRUNO, ANA_LOPEZ];
      await conEntorno([], async ({ mandados, enviados }) => {
        await armarParaAna(canal);
        // La ventana: entre decidir y resolver, otro turno cambia lo que espera (aquí, mientras se registra el efecto).
        const r = await turno(frase, { registrarEfecto: async () => (await otroTurnoCambiaA(canal), true) });
        const efectos = mandados.length + enviados.length;
        const nuevo = canal === 'correo' ? C.borradorDe(JOSE, 'tel') : W.borradorWhatsappDe(JOSE, 'tel');
        if (efectos !== 0) fallos.push(`${canal} «${frase}»: salió ${JSON.stringify(canal === 'correo' ? mandados.map((m) => m.para) : enviados.map((e) => e.chat))}`);
        if (!vivo(nuevo)) fallos.push(`${canal} «${frase}»: el borrador de Bruno no siguió esperando`);
        if (!PREGUNTA.test(r.hechos.join('\n'))) fallos.push(`${canal} «${frase}»: no se pregunta de nuevo`);
      });
    }
  }
  assert.deepEqual(fallos, []);
});

test('ronda 7 G1-N1: lo mismo si el cambio llega mientras el puente carga la lista de chats (la promesa la suelta la prueba)', async () => {
  const fallos: string[] = [];
  for (const canal of ['correo', 'whatsapp'] as const) {
    CHATS = [BRUNO, ANA_LOPEZ];
    await conEntorno([], async ({ mandados, enviados }) => {
      await armarParaAna(canal);
      let soltar!: () => void;
      const pedido = new Promise<void>((r) => (AL_PEDIR_CHATS = r));
      RETENER_CHATS = new Promise<void>((r) => (soltar = r));
      try {
        const enCurso = turno('sí');
        await Promise.race([pedido, new Promise((r) => setTimeout(r, 300))]);
        await otroTurnoCambiaA(canal);
        soltar();
        const r = await enCurso;
        if (mandados.length + enviados.length !== 0) fallos.push(`${canal}: salió ${JSON.stringify(canal === 'correo' ? mandados.map((m) => m.para) : enviados.map((e) => e.chat))}`);
        if (!PREGUNTA.test(r.hechos.join('\n'))) fallos.push(`${canal}: no se pregunta de nuevo`);
      } finally {
        soltar();
        RETENER_CHATS = null;
        AL_PEDIR_CHATS = null;
      }
    });
  }
  assert.deepEqual(fallos, []);
});

test('ronda 7 G1-N1: sin carrera, el «sí» manda una vez (correo, WhatsApp)', async () => {
  for (const canal of ['correo', 'whatsapp'] as const) {
    CHATS = [BRUNO, ANA_LOPEZ];
    await conEntorno([], async ({ mandados, enviados }) => {
      await armarParaAna(canal);
      await turno('sí');
      await turno('sí');
      assert.equal(mandados.length + enviados.length, 1, canal);
    });
  }
});

/* ------------------------------------------------------------------ G1-m1: el puente lento */

test('ronda 7 G1-m1: si la lista de chats no llega a tiempo, «sí, a Ana» con Ana López y Ana Pérez pregunta; el nombre completo y el «sí» suelto siguen', async () => {
  const casos: Array<[string, number]> = [['sí, a Ana', 0], ['sí, a Ana López', 1], ['sí', 1]];
  const fallos: string[] = [];
  for (const [frase, debe] of casos) {
    CHATS = [BRUNO, ANA_LOPEZ, ANA_PEREZ];
    await conEntorno([], async ({ enviados }) => {
      await W.correrWhatsapp(JOSE, 'responder Ana López | Va el informe.', 'tel');
      let soltar!: () => void;
      RETENER_CHATS = new Promise<void>((r) => (soltar = r));
      try {
        const r = await turno(frase);
        if (enviados.length !== debe || (debe === 0 && !PREGUNTA.test(r.hechos.join('\n')))) fallos.push(`«${frase}»: enviados=${enviados.length}`);
      } finally {
        soltar();
        RETENER_CHATS = null;
      }
    });
  }
  assert.deepEqual(fallos, []);
});

/* ------------------------------------------------------------------ G1-m2, G1-m3: la función única */

test('ronda 7 G1-m2/G1-m3 (función única): vocativos que son contactos preguntan; el nombre completo del destino identifica aunque otro comparta una palabra', async () => {
  const A = await import('../lib/afirmacion');
  const ana: any = { tipo: 'correo', destino: 'Ana <ana@example.test>' };
  const familia: any = { tipo: 'whatsapp', destino: 'Familia de Ana', grupo: true };
  const lopez: any = { tipo: 'whatsapp', destino: 'Ana López (+50477770005)' };
  const filas: Array<[string, any[], string, string[]?]> = [
    ['sí, amor', [ana], 'preguntar', ['Amor']],
    ['sí, jefe', [ana], 'preguntar', ['Jefe']],
    ['sí, bro', [ana], 'preguntar', ['Bro']],
    ['sí, señor', [ana], 'preguntar', ['Señor']],
    ['sí, amor', [ana], 'ejecutar'],
    ['sí, jefe', [ana], 'ejecutar'],
    ['sí, a la familia de Ana', [familia], 'ejecutar', ['Ana']],
    ['sí, a Ana López', [lopez], 'ejecutar', ['Ana']],
    ['sí, a Ana', [lopez], 'preguntar', ['Ana']],
    ['sí, a la familia', [familia], 'preguntar', ['Ana']],
  ];
  const fallos: string[] = [];
  for (const [frase, ps, tipo, conocidos] of filas) {
    const d: any = A.decidirPendiente(frase, ps, conocidos ? { conocidos } : {});
    if (d.tipo !== tipo) fallos.push(`«${frase}»${conocidos ? ` con ${conocidos}` : ''}: esperaba ${tipo}, dio ${d.tipo}`);
  }
  // La app: con un contacto «Amor», «sí, amor» no manda el borrador de Ana.
  const ctx: any = { pantalla: 'chats', contactos: [{ correo: 'ana@example.test', nombre: 'Ana' }, { correo: 'amor@example.test', nombre: 'Amor' }], manos: ['enviar_exacto'] };
  const pend = { para: 'ana@example.test', texto: 'Llego a las 3' };
  if (APP.ordenPorReglas('sí, amor', { pendiente: pend, contexto: ctx })?.accion?.tipo === 'enviar') fallos.push('app: «sí, amor» con un contacto Amor mandó');
  if (APP.prepararAcciones([{ tipo: 'enviar' }], { mensaje: 'sí, amor', pendiente: pend, contexto: ctx }).length) fallos.push('app (cerebro): «sí, amor» con un contacto Amor mandó');
  assert.deepEqual(fallos, []);
});

/* ------------------------------------------------------------------ G1-m4: uso normal */

/** Lo de la revisión y variantes razonables de sí / va / dale. */
const USO_NORMAL = [
  'mándalo así', 'bueno, mándalo', 'así es', 'confirmado', 'yes sir', 'send it now', 'sounds good', 'todo bien, mándalo',
  'sí, sí', 'dale, dale', 'va, va', 'sale pues', 'ok, dale', 'sí, dale', 'dale que sí', 'simón, mándalo', 'claro, claro',
  'de una vez', 'hágalo', 'hacele', 'ya, mándalo', 'okey dokey', 'yep, send it', 'yeah, go ahead', 'sure, send it',
  'of course', 'alright', 'all right', 'absolutely', 'sí, por favor, mándalo', 'sí, gracias, mándalo', 'está bien, mándalo',
  'perfecto, mándalo', 'excelente', 'genial', 'súper', 'sí, adelante', 'adelante pues', 'sí, va', 'sí, ok', 'ok ok',
  'listo, mándalo', 'sí, envíalo ya', 'mándalo de una', 'sí, ándale', 'échale', 'dele', 'dale nomás', 'entonces sí, mándalo',
];

test('ronda 7 G1-m4: uso normal que confirma (función, atajo de la app y servidor, una vez)', async () => {
  const A = await import('../lib/afirmacion');
  const fallos: string[] = [];
  const PEND = { para: 'ana@example.test', texto: 'Llego a las 3' };
  const CTX: any = { pantalla: 'chats', contactos: [{ correo: 'ana@example.test', nombre: 'Ana' }], manos: ['enviar_exacto'] };
  for (const frase of USO_NORMAL) {
    if (!A.esAfirmacionPura(frase)) fallos.push(`pura «${frase}»`);
    if (APP.ordenPorReglas(frase, { pendiente: PEND, contexto: CTX })?.accion?.tipo !== 'enviar') fallos.push(`atajo «${frase}»`);
  }
  CHATS = [BRUNO];
  await conEntorno([], async ({ mandados }) => {
    for (const frase of USO_NORMAL.slice(0, 12)) {
      C._olvidarCorreo();
      const antes = mandados.length;
      await C.correrCorreo(JOSE, 'escribir ana@example.test | Informe | Va.', 'tel');
      await turno(frase);
      await turno(frase);
      if (mandados.length - antes !== 1) fallos.push(`servidor «${frase}»: ${mandados.length - antes}`);
    }
  });
  assert.deepEqual(fallos, [], `${fallos.length} fallos`);
});

test('ronda 7 G1-m4: sin abrir agujeros — «bueno» o «así» detrás de «a»/«para» no son cortesía', async () => {
  const A = await import('../lib/afirmacion');
  const ana: any = { tipo: 'correo', destino: 'Ana <ana@example.test>' };
  const fallos: string[] = [];
  for (const frase of ['sí, mándaselo a Bueno', 'sí, a Bueno', 'sí, para Bueno', 'yes sir, send it to the sir']) {
    const d: any = A.decidirPendiente(frase, [ana]);
    if (d.tipo === 'ejecutar' || A.esAfirmacionPura(frase)) fallos.push(`«${frase}» ejecutó`);
  }
  assert.deepEqual(fallos, []);
});

/* ------------------------------------------------------------------ la app: lo que espera, con su texto */

test('ronda 7 G1-N1 (app): lo que espera la app lleva su versión — otro texto para la misma persona no es lo que se decidió', () => {
  APP._reiniciarAccionesApp();
  const amb = APP.ambitoApp(JOSE, 'tel');
  APP.abrirTurnoApp(amb);
  APP.anotarPendiente(amb, { para: 'ana@example.test', texto: 'Llego a las 3' });
  APP.abrirTurnoApp(amb);
  const visto = APP.appEsperandoDe(amb);
  APP.anotarPendiente(amb, { para: 'ana@example.test', texto: 'Ya no voy' });
  const ahora = APP.appEsperandoDe(amb);
  assert.equal((APP as any).mismaEsperaApp?.(visto, ahora), false, 'otro texto: no es la misma');
  assert.equal((APP as any).mismaEsperaApp?.(visto, visto), true);
});
