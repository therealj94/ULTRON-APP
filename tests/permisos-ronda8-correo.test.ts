/**
 * PERMISOS EXACTOS, OCTAVA RONDA (menor): el nombre de un PROVEEDOR («Gmail», «Outlook») no es el canal correo.
 * «sí, al Gmail de Ana», «sí, por gmail», «mándalo por outlook», «yes, via gmail» solo identifican el borrador si
 * coinciden con el dominio de a quién va o de la cuenta desde la que sale; si no, se pregunta.
 * Buzón SMTP de mentira con los envíos contados. Datos sintéticos.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'permisos-ronda8c-'));
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

test('ronda 8 (menor): «Gmail» u «Outlook» dichos no mandan un correo que no es de ese proveedor; si coincide, sí', async () => {
  const fallos: string[] = [];
  const casos: Array<[string, string, number]> = [
    // [para, frase, envíos esperados]
    ['ana@empresa.example.test', 'sí, al Gmail de Ana', 0],
    ['ana@empresa.example.test', 'sí, por gmail', 0],
    ['ana@empresa.example.test', 'sí, mándalo por outlook', 0],
    ['ana@empresa.example.test', 'yes, via gmail', 0],
    ['ana@empresa.example.test', 'sí, a Ana', 1],
    ['ana@empresa.example.test', 'sí', 1],
    ['ana.paz@gmail.com', 'sí, al Gmail de Ana', 1],
    ['ana.paz@gmail.com', 'sí, por gmail', 1],
    ['ana.paz@gmail.com', 'sí, mándalo por outlook', 0],
    ['ana.paz@hotmail.com', 'sí, mándalo por outlook', 1],
  ];
  CHATS = [BRUNO];
  for (const [para, frase, debe] of casos) {
    await conEntorno([], async ({ mandados }) => {
      await C.correrCorreo(JOSE, `escribir ${para} | Informe | Va el informe.`, 'tel');
      const r = await turno(frase);
      await turno(frase);
      if (mandados.length !== debe || (debe === 0 && !PREGUNTA.test(r.hechos.join('\n')))) fallos.push(`${para} «${frase}»: mandados=${mandados.length}`);
    });
  }
  assert.deepEqual(fallos, []);
});

test('ronda 8 (menor, función única): el proveedor coincide con el dominio de para o de desde', async () => {
  const A = await import('../lib/afirmacion');
  const empresa: any = { tipo: 'correo', destino: 'ana@empresa.example.test', desde: 'jose3@prueba.example.test' };
  const desdeGmail: any = { tipo: 'correo', destino: 'ana@empresa.example.test', desde: 'jose3@gmail.com' };
  const fallos: string[] = [];
  for (const [frase, ps, tipo] of [
    ['sí, por gmail', [empresa], 'preguntar'],
    ['sí, por gmail', [desdeGmail], 'ejecutar'],
    ['sí, el correo', [empresa], 'ejecutar'],
    ['yes, via gmail', [empresa], 'preguntar'],
  ] as Array<[string, any[], string]>) {
    const d: any = A.decidirPendiente(frase, ps);
    if (d.tipo !== tipo) fallos.push(`«${frase}»: esperaba ${tipo}, dio ${d.tipo}`);
  }
  assert.deepEqual(fallos, []);
});
