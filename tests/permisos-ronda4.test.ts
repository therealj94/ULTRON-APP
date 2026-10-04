/**
 * PERMISOS EXACTOS, CUARTA RONDA: los huecos de la regla única (lib/afirmacion.ts) que encontró la tercera revisión.
 *
 *  1. El nombre del avatar es relleno solo como vocativo suelto al principio o al final («Aura, sí», «sí, Claudio»);
 *     detrás de «a/para/to» o si es el de un contacto, es un destinatario.
 *  2. «a mí», «para mí», «a mi correo», «send it to me»: un destino propio, que solo coincide con algo para la persona.
 *  3. Varios destinatarios: nombrar solo una parte pregunta; nombrarlos a todos (exacto) ejecuta. El aviso, en singular.
 *  4. Los números y montos del texto de la pregunta de su computadora nunca cuentan como hora ni destino.
 *  5. Una pregunta («¿sí?», «sí o qué») nunca es un sí.
 *  6. «no, a Bruno» es una corrección: pregunta y no descarta; solo «no, cancela el de Bruno» o «no, el WhatsApp no».
 *  7. Uso normal: «siiii», «ajá», «👍», «eh sí», «sí, así está perfecto»…; «dale» vale igual en la app y en el correo.
 *
 * Los caminos REALES con efectos simulados y contados: el turno del servidor (buzón SMTP y puente de WhatsApp de
 * mentira), el atajo de la app (ordenPorReglas), el cerebro (prepararAcciones) y la función única. Datos sintéticos.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'permisos-ronda4-'));
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
const chat = (jid: string, nombre: string, numero: string) => ({ jid, nombre, grupo: false, noLeidos: 0, hora: Date.now(), ultimo: '', ultimoMio: false, numero });
const BRUNO = chat('50477773333@s.whatsapp.net', 'Bruno', '+50477773333');

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
        return json(200, { chats: [BRUNO].filter((c) => !b || sinT(c.nombre).includes(b)) });
      }
      if (u.pathname === '/contactos') return json(200, { contactos: [] });
      if (u.pathname === '/mensajes') return json(200, { chat: BRUNO, mensajes: [] });
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


/** Lo que se dice cuando no se hizo nada y se pregunta (o se pide confirmar). */
const PREGUNTA = /cuál|no coincide|no es eso|nombró|no queda claro|confirm/i;
const vivo = (b: any) => !!b && !b.soloPanel;

/* ------------------------------------------------------------------ 1, 2, 5, 7: un correo para Ana */

type Espera = 'manda' | 'pregunta';
const CORREO_ANA: Array<[string, Espera]> = [
  // 7. Uso normal: afirmaciones puras que antes no valían.
  ['siiii', 'manda'],
  ['síííí', 'manda'],
  ['ajá', 'manda'],
  ['obvio', 'manda'],
  ['por supuesto', 'manda'],
  ['afirmativo', 'manda'],
  ['ándale', 'manda'],
  ['👍', 'manda'],
  ['✅', 'manda'],
  ['eh sí', 'manda'],
  ['este… sí, mándalo', 'manda'],
  ['sí. a ver… sí, mándalo', 'manda'],
  ['sí, así está perfecto', 'manda'],
  ['sí, ese mismo', 'manda'],
  ['mmm sí', 'manda'],
  // 1. El nombre del avatar: vocativo suelto al principio o al final, sí; detrás de «a/para», nunca.
  ['Aura, sí', 'manda'],
  ['sí, Claudio', 'manda'],
  ['sí, envíalo AURA', 'manda'],
  ['sí, a Antonio', 'pregunta'],
  ['sí, mándaselo a Claudio', 'pregunta'],
  ['sí, a Aura', 'pregunta'],
  ['send it to Aura', 'pregunta'],
  ['sí, para Ojos', 'pregunta'],
  // 2. Un destino propio («a mí», «a mi correo») nunca coincide con un correo para Ana.
  ['sí, para mí', 'pregunta'],
  ['sí, a mí', 'pregunta'],
  ['send it to me', 'pregunta'],
  ['mándalo a mi correo', 'pregunta'],
  ['sí, mándamelo', 'pregunta'],
  // 5. Una pregunta nunca es un sí.
  ['¿sí?', 'pregunta'],
  ['¿ok?', 'pregunta'],
  ['sí o qué', 'pregunta'],
  ['¿lo mando?', 'pregunta'],
  ['sí, ¿verdad?', 'pregunta'],
];

test('ronda 4 (servidor): un correo para Ana — avatares, destino propio, preguntas y el uso normal', async () => {
  const fallos: string[] = [];
  await conEntorno([], async ({ mandados }) => {
    for (const [frase, espera] of CORREO_ANA) {
      C._olvidarCorreo();
      const antes = mandados.length;
      await C.correrCorreo(JOSE, 'escribir ana@example.test | Informe | Va el informe.', 'tel');
      const r = await turno(frase);
      await turno(frase);
      const efectos = mandados.length - antes;
      const vale = espera === 'manda' ? efectos === 1 && mandados.at(-1)!.para[0] === 'ana@example.test' : efectos === 0 && vivo(C.borradorDe(JOSE, 'tel')) && PREGUNTA.test(r.hechos.join('\n'));
      if (!vale) fallos.push(`«${frase}» esperaba ${espera}: efectos=${efectos} sigue=${vivo(C.borradorDe(JOSE, 'tel'))} hechos=${JSON.stringify(r.hechos.join(' ').slice(0, 90))}`);
    }
  });
  assert.deepEqual(fallos, [], `${fallos.length} de ${CORREO_ANA.length} frases fallan:\n${fallos.join('\n')}`);
});

test('ronda 4 (servidor): un correo para la PROPIA persona — «sí, a mí» coincide', async () => {
  await conEntorno([], async ({ mandados }) => {
    await C.correrCorreo(JOSE, `escribir ${JOSE} | Nota | Recordar el informe.`, 'tel');
    await turno('sí, a mí');
    await turno('sí, a mí');
    assert.deepEqual(mandados.map((m) => m.para), [[JOSE]]);
  });
});

/* ------------------------------------------------------------------ 3: varios destinatarios */

test('ronda 4 (servidor): un correo para Ana Y Bruno — nombrar a uno solo pregunta; a los dos (exacto) manda; el aviso con buena gramática', async () => {
  const filas: Array<[string, Espera]> = [
    ['sí', 'manda'],
    ['sí, el correo', 'manda'],
    ['sí, a Ana y a Bruno', 'manda'],
    ['sí, a Bruno y Ana', 'manda'],
    ['sí, a Ana', 'pregunta'],
    ['sí, a Bruno', 'pregunta'],
    ['envíale a Ana el de Bruno', 'pregunta'],
    ['sí, a Ana y a Carla', 'pregunta'],
  ];
  const fallos: string[] = [];
  await conEntorno([], async ({ mandados }) => {
    for (const [frase, espera] of filas) {
      C._olvidarCorreo();
      const antes = mandados.length;
      await C.correrCorreo(JOSE, 'escribir ana@example.test, bruno@example.test | Informe | Va el informe.', 'tel');
      const r = await turno(frase);
      await turno(frase);
      const efectos = mandados.length - antes;
      const hechos = r.hechos.join('\n');
      const vale = espera === 'manda' ? efectos === 1 && mandados.at(-1)!.para.length === 2 : efectos === 0 && PREGUNTA.test(hechos);
      if (!vale || /hay 1 cosas/.test(hechos)) fallos.push(`«${frase}» esperaba ${espera}: efectos=${efectos} hechos=${JSON.stringify(hechos.slice(0, 120))}`);
    }
    // La gramática del aviso con una sola cosa esperando (antes: «hay 1 cosas»).
    C._olvidarCorreo();
    await C.correrCorreo(JOSE, 'escribir ana@example.test | Informe | Va.', 'tel');
    const r = await turno('sí, a los dos');
    if (/hay 1 cosas/.test(r.hechos.join('\n'))) fallos.push('«sí, a los dos» con una sola: «hay 1 cosas»');
  });
  assert.deepEqual(fallos, []);
});

/* ------------------------------------------------------------------ 2, 6: correo para Ana y WhatsApp para Bruno */

test('ronda 4 (servidor): correo para Ana y WhatsApp para Bruno — «a mi correo» pregunta; «no, a Bruno» no descarta nada; el «no» claro sí', async () => {
  const filas: Array<[string, 'ambos-siguen' | 'solo-wa-fuera' | 'solo-correo-fuera']> = [
    ['mándalo a mi correo', 'ambos-siguen'],
    ['sí, mándamelo a mí', 'ambos-siguen'],
    ['no, a Bruno', 'ambos-siguen'],
    ['no, mándalo a Bruno', 'ambos-siguen'],
    ['no, a Ana', 'ambos-siguen'],
    ['no, el de Bruno', 'ambos-siguen'],
    ['no, cancela el de Bruno', 'solo-wa-fuera'],
    ['no, el WhatsApp no', 'solo-wa-fuera'],
    ['no, el correo', 'solo-correo-fuera'],
    ['no lo mandes', 'ambos-siguen'],
  ];
  const fallos: string[] = [];
  await conEntorno([], async ({ mandados, enviados }) => {
    for (const [frase, espera] of filas) {
      C._olvidarCorreo();
      W._olvidarWhatsapp();
      const m0 = mandados.length;
      const e0 = enviados.length;
      await C.correrCorreo(JOSE, 'escribir ana@example.test | Informe | Va.', 'tel');
      await W.correrWhatsapp(JOSE, 'responder Bruno | Va.', 'tel');
      await turno(frase);
      const correo = C.borradorDe(JOSE, 'tel');
      const wa = W.borradorWhatsappDe(JOSE, 'tel');
      const efectos = mandados.length - m0 + (enviados.length - e0);
      const ok = efectos === 0 && (espera === 'ambos-siguen' ? vivo(correo) && vivo(wa) : espera === 'solo-wa-fuera' ? vivo(correo) && !wa : !correo && vivo(wa));
      if (!ok) fallos.push(`«${frase}» esperaba ${espera}: correo=${correo ? (correo.soloPanel ? 'apartado' : 'vivo') : 'fuera'} wa=${wa ? (wa.soloPanel ? 'apartado' : 'vivo') : 'fuera'} efectos=${efectos}`);
    }
  });
  assert.deepEqual(fallos, []);
});

/* ------------------------------------------------------------------ la app: el atajo y el cerebro */

const CTX: any = {
  pantalla: 'chats',
  contactos: [
    { correo: 'ana@example.test', nombre: 'Ana' },
    { correo: 'bruno@example.test', nombre: 'Bruno' },
    { correo: 'antonio@example.test', nombre: 'Antonio' },
  ],
  manos: ['enviar_exacto', 'llamar', 'recordatorio'],
};
const PEND_ANA = { para: 'ana@example.test', texto: 'Llego a las 3' };

test('ronda 4 (app): borrador para Ana — «dale» vale igual que en el correo; avatares, destino propio y preguntas no mandan', () => {
  const filas: Array<[string, boolean]> = [
    ['dale', true],
    ['ok', true],
    ['👍', true],
    ['siiii', true],
    ['ajá', true],
    ['Aura, sí', true],
    ['sí, así está perfecto', true],
    ['sí, a Antonio', false],
    ['sí, a Aura', false],
    ['sí, mándaselo a Claudio', false],
    ['sí, para mí', false],
    ['send it to me', false],
    ['¿sí?', false],
    ['sí o qué', false],
  ];
  const fallos: string[] = [];
  for (const [frase, manda] of filas) {
    const r = APP.ordenPorReglas(frase, { pendiente: PEND_ANA, contexto: CTX });
    const atajo = r?.accion?.tipo === 'enviar';
    const e = APP.prepararAcciones([{ tipo: 'enviar' }], { mensaje: frase, pendiente: PEND_ANA, contexto: CTX }).filter((a) => a.tipo === 'enviar');
    const cerebro = e.length === 1 && (e[0] as any).para === 'ana@example.test';
    if (atajo !== manda || cerebro !== manda) fallos.push(`«${frase}» esperaba ${manda ? 'manda' : 'no manda'}: atajo=${atajo} cerebro=${cerebro}`);
  }
  assert.deepEqual(fallos, []);
});

test('ronda 4 (app): un contacto que se llama como el avatar — «Aura, sí» ya no es un vocativo: no manda a Ana', () => {
  const ctx = { ...CTX, contactos: [...CTX.contactos, { correo: 'aura@example.test', nombre: 'Aura' }] };
  assert.notEqual(APP.ordenPorReglas('Aura, sí', { pendiente: PEND_ANA, contexto: ctx })?.accion?.tipo, 'enviar');
  assert.deepEqual(APP.prepararAcciones([{ tipo: 'enviar' }], { mensaje: 'Aura, sí', pendiente: PEND_ANA, contexto: ctx }), []);
  assert.equal(APP.prepararAcciones([{ tipo: 'enviar' }], { mensaje: 'Aura, sí', pendiente: PEND_ANA, contexto: CTX }).length, 1, 'sin ese contacto, sí es vocativo');
});

test('ronda 4 (app): «¿llamo a Ana?» — «sí, a Antonio» o «sí, llámale a Claudio» no llaman a Ana', () => {
  const prop = { tipo: 'llamar' as const, con: 'ana@example.test', nombre: 'Ana', video: false };
  const fallos: string[] = [];
  for (const [frase, llama] of [['sí, a Antonio', false], ['sí, llámale a Claudio', false], ['¿sí?', false], ['ándale', true]] as Array<[string, boolean]>) {
    const r = APP.ordenPorReglas(frase, { propuesta: prop, contexto: CTX });
    const atajo = r?.accion?.tipo === 'llamar';
    const cerebro = APP.prepararAcciones([{ tipo: 'llamar', con: 'Ana', video: false }], { mensaje: frase, propuesta: prop, contexto: CTX }).some((a) => a.tipo === 'llamar');
    if ((atajo && !llama) || cerebro !== llama) fallos.push(`«${frase}» esperaba ${llama ? 'llama' : 'no llama'}: atajo=${atajo} cerebro=${cerebro}`);
  }
  assert.deepEqual(fallos, []);
});

/* ------------------------------------------------------------------ la función única */

test('ronda 4 (función única): montos de la pregunta, varios destinatarios, destino propio, preguntas, avatares y «no» con destinatario', async () => {
  const A = await import('../lib/afirmacion');
  const ana: any = { tipo: 'correo', destino: 'Ana <ana@example.test>' };
  const bruno: any = { tipo: 'whatsapp', destino: 'Bruno (+50477773333)' };
  const dos: any = { tipo: 'correo', destino: 'ana@example.test bruno@example.test', destinatarios: ['ana@example.test', 'bruno@example.test'] };
  const pago: any = { tipo: 'computadora', texto: 'Voy a pagar L 5,000 a Ferretería López. ¿Lo hago?' };
  const propio: any = { tipo: 'correo', destino: 'jose3@example.test', propia: true };
  const filas: Array<[string, any[], string, number?]> = [
    ['sí, a las 5', [pago], 'preguntar'],
    ['sí, los 5000', [pago], 'preguntar'],
    ['sí, a López', [pago], 'ejecutar', 0],
    ['sí', [pago], 'ejecutar', 0],
    ['sí, a Ana', [dos], 'preguntar'],
    ['sí, a Ana y a Bruno', [dos], 'ejecutar', 0],
    ['envíale a Ana el de Bruno', [dos], 'preguntar'],
    ['sí, a mí', [ana], 'preguntar'],
    ['sí, a mí', [propio], 'ejecutar', 0],
    ['mándalo a mi correo', [ana, bruno], 'preguntar'],
    ['¿sí?', [ana], 'preguntar'],
    ['sí o qué', [ana], 'preguntar'],
    ['sí, a Antonio', [ana], 'preguntar'],
    ['sí, a Aura', [ana], 'preguntar'],
    ['Aura, sí', [ana], 'ejecutar', 0],
    ['no, a Bruno', [ana, bruno], 'preguntar'],
    ['no, cancela el de Bruno', [ana, bruno], 'no', 1],
    ['no, el WhatsApp no', [ana, bruno], 'no', 1],
    ['siiii', [ana], 'ejecutar', 0],
    ['👍', [ana], 'ejecutar', 0],
  ];
  const fallos: string[] = [];
  for (const [frase, ps, tipo, i] of filas) {
    const d: any = A.decidirPendiente(frase, ps);
    if (d.tipo !== tipo || (i !== undefined && d.p !== ps[i])) fallos.push(`«${frase}» con ${ps.length}: esperaba ${tipo}${i !== undefined ? `#${i}` : ''}, dio ${d.tipo}`);
  }
  // Un nombre de avatar que es el de un contacto conocido no es vocativo.
  const conAura: any = A.decidirPendiente('Aura, sí', [ana], { conocidos: ['Aura'] } as any);
  if (conAura.tipo !== 'preguntar') fallos.push(`«Aura, sí» con un contacto Aura: esperaba preguntar, dio ${conAura.tipo}`);
  assert.deepEqual(fallos, []);
});
