/**
 * PERMISOS EXACTOS, TERCERA RONDA: UNA SOLA REGLA PARA TODOS LOS CAMINOS (lib/afirmacion.ts).
 *
 * Una decisión pendiente se ejecuta sin preguntar SOLO si el mensaje es una AFIRMACIÓN PURA (palabras de sí o de envío
 * y relleno cortés, nada más) o si nombra EXACTAMENTE esa decisión (destinatario, canal y hora). Cualquier otro
 * contenido (un nombre, un número, una hora, otro canal, «y a Bruno», «a los dos») no ejecuta nada: si no coincide sin
 * dudas con una decisión, se pregunta. Las negativas pasan por la misma selección: «no» con varias esperando pregunta
 * cuál; «no, el correo» descarta solo el correo.
 *
 * La tabla pasa por los caminos REALES, con efectos simulados y contados:
 *   · el turno del servidor (server/decision-turno.ts) con un buzón SMTP y un puente de WhatsApp de mentira;
 *   · el atajo de la app (ordenPorReglas) y el camino del cerebro (prepararAcciones), contando los `enviar`/`llamar`;
 *   · y la función única (decidirPendiente), cuando existe.
 * Datos sintéticos (example.test, números falsos).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'permisos-ronda3-'));
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

/* ------------------------------------------------------------------ la tabla del servidor */

type Espera = 'manda' | 'pregunta' | 'nada';
/** Un correo para Ana esperando (y nada más). */
const SOLO_CORREO_ANA: Array<[string, Espera]> = [
  // Afirmaciones puras: mandan exactamente una vez.
  ['sí', 'manda'],
  ['si', 'manda'],
  ['Sí.', 'manda'],
  ['dale', 'manda'],
  ['ok', 'manda'],
  ['okay', 'manda'],
  ['claro', 'manda'],
  ['listo', 'manda'],
  ['hazlo', 'manda'],
  ['envíalo', 'manda'],
  ['mándalo', 'manda'],
  ['mándaselo', 'manda'],
  ['sí señor', 'manda'],
  ['sí, de acuerdo', 'manda'],
  ['sí por fa', 'manda'],
  ['sí, envíalo porfavor', 'manda'],
  ['sí, mándalo ahorita', 'manda'],
  ['sí, dale nomás', 'manda'],
  ['sí, hágale', 'manda'],
  ['sí, envíalo tal cual', 'manda'],
  ['sí, envíalo AURA', 'manda'],
  ['sí, gracias', 'manda'],
  ['yes', 'manda'],
  ['send it', 'manda'],
  ['go ahead', 'manda'],
  // Nombra exactamente esa decisión: manda.
  ['sí, a Ana', 'manda'],
  ['sí, el correo', 'manda'],
  ['sí, mándale el correo a Ana', 'manda'],
  ['Ana, mándalo', 'manda'],
  ['send it to Ana', 'manda'],
  // Nombra otra cosa: no manda nada y pregunta.
  ['sí, a Bruno', 'pregunta'],
  ['sí, el de WhatsApp', 'pregunta'],
  ['mándale el mensaje a Bruno', 'pregunta'],
  ['Bruno, mándalo', 'pregunta'],
  ['para Bruno, envíalo', 'pregunta'],
  ['send the message to Bruno', 'pregunta'],
  ['sí, mándalo a las 5', 'pregunta'],
  ['sí, mándalo mañana', 'pregunta'],
  ['envíalo a Ana y a Bruno', 'pregunta'],
  ['sí, a los dos', 'pregunta'],
  ['sí mándaselo a Ana por WhatsApp', 'pregunta'],
  // Ni sí ni no claro, o un cambio: no se manda nada.
  ['sí, pero a Bruno', 'nada'],
  ['sí espera', 'nada'],
];

test('tabla (servidor): un correo para Ana esperando — puras mandan una vez, lo nombrado que coincide manda, lo demás no', async () => {
  const fallos: string[] = [];
  await conEntorno([], async ({ mandados }) => {
    for (const [frase, espera] of SOLO_CORREO_ANA) {
      C._olvidarCorreo();
      const antes = mandados.length;
      await C.correrCorreo(JOSE, 'escribir ana@example.test | Informe | Va el informe.', 'tel');
      const r = await turno(frase);
      await turno(frase); // un segundo igual: nunca un segundo efecto
      const efectos = mandados.length - antes;
      const sigue = C.borradorDe(JOSE, 'tel');
      const vale = espera === 'manda' ? efectos === 1 && mandados.at(-1)!.para[0] === 'ana@example.test' : espera === 'pregunta' ? efectos === 0 && /cuál|no es eso|no coincide|nombró/i.test(r.hechos.join('\n')) : efectos === 0;
      if (!vale) fallos.push(`«${frase}» esperaba ${espera}: efectos=${efectos}, sigue=${!!sigue}`);
    }
  });
  assert.deepEqual(fallos, [], `${fallos.length} de ${SOLO_CORREO_ANA.length} frases fallan:\n${fallos.join('\n')}`);
});

test('tabla (servidor): un WhatsApp para Bruno — el canal nombrado cuenta aunque coincida el destinatario', async () => {
  const filas: Array<[string, Espera]> = [
    ['sí, a Bruno', 'manda'],
    ['sí, por WhatsApp', 'manda'],
    ['sí mándaselo a Bruno por correo', 'pregunta'],
    ['sí, a Bruno y a Ana', 'pregunta'],
  ];
  const fallos: string[] = [];
  await conEntorno([], async ({ enviados }) => {
    for (const [frase, espera] of filas) {
      W._olvidarWhatsapp();
      const antes = enviados.length;
      await W.correrWhatsapp(JOSE, 'responder Bruno | Va el informe.', 'tel');
      await turno(frase);
      const efectos = enviados.length - antes;
      if ((espera === 'manda') !== (efectos === 1) || efectos > 1) fallos.push(`«${frase}» esperaba ${espera}: efectos=${efectos}`);
    }
  });
  assert.deepEqual(fallos, []);
});

test('tabla (servidor): un correo a aperez@ (Ana Pérez en la lista) — «sí, a Ana» coincide por el nombre del contacto', async () => {
  const lista = [{ ref: 'x:1', de: 'Ana Pérez', deCorreo: 'aperez@example.test', asunto: 'Factura', fecha: new Date().toISOString(), noLeido: true, adjuntos: [], extracto: '' }];
  await conEntorno(lista, async ({ mandados }) => {
    await C.correrCorreo(JOSE, 'revisar', 'tel');
    await C.correrCorreo(JOSE, 'escribir Ana | Hola | Hola Ana.', 'tel');
    assert.deepEqual(C.borradorDe(JOSE, 'tel')?.para, ['aperez@example.test']);
    await turno('sí, a Ana');
    assert.deepEqual(mandados.map((m) => m.para), [['aperez@example.test']]);
  });
});

test('tabla (servidor): correo y WhatsApp esperando — «no» pasa por la misma selección (solo el nombrado se descarta; suelto, pregunta)', async () => {
  const filas: Array<[string, 'ambos-siguen' | 'solo-correo-fuera' | 'solo-wa-fuera' | 'manda-correo']> = [
    ['no', 'ambos-siguen'],
    ['cancela', 'ambos-siguen'],
    ['no lo mandes', 'ambos-siguen'],
    ['no, el correo', 'solo-correo-fuera'],
    ['no, el de WhatsApp', 'solo-wa-fuera'],
    ['sí', 'ambos-siguen'],
    ['sí, el correo', 'manda-correo'],
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
      const vivo = (b: any) => !!b && !b.soloPanel;
      const efectos = mandados.length - m0 + (enviados.length - e0);
      const ok =
        espera === 'ambos-siguen' ? vivo(correo) && vivo(wa) && efectos === 0
        : espera === 'solo-correo-fuera' ? !correo && vivo(wa) && efectos === 0
        : espera === 'solo-wa-fuera' ? vivo(correo) && !wa && efectos === 0
        : mandados.length - m0 === 1 && enviados.length === e0 && vivo(wa);
      if (!ok) fallos.push(`«${frase}» esperaba ${espera}: correo=${correo ? (correo.soloPanel ? 'apartado' : 'vivo') : 'fuera'} wa=${wa ? (wa.soloPanel ? 'apartado' : 'vivo') : 'fuera'} efectos=${efectos}`);
    }
  });
  assert.deepEqual(fallos, []);
});

test('tabla (servidor): texto a medio escribir en el chat de Bruno — un «sí» suelto al correo de Ana sale; «sí, mándalo» o nombrar el chat pregunta', async () => {
  const ctx: any = { pantalla: 'chats', contactos: [{ correo: 'bruno@example.test', nombre: 'Bruno' }], chatAbierto: { correo: 'bruno@example.test', nombre: 'Bruno' }, borrador: 'Hola Bru', manos: ['enviar_exacto'] };
  const filas: Array<[string, Espera]> = [
    ['sí', 'manda'],
    ['dale', 'manda'],
    ['sí, a Ana', 'manda'],
    ['sí, mándalo', 'pregunta'],
    ['sí, el de Bruno', 'pregunta'],
  ];
  const fallos: string[] = [];
  await conEntorno([], async ({ mandados }) => {
    for (const [frase, espera] of filas) {
      C._olvidarCorreo();
      APP._reiniciarAccionesApp();
      const amb = APP.ambitoApp(JOSE, 'tel');
      APP.abrirTurnoApp(amb);
      const antes = mandados.length;
      await C.correrCorreo(JOSE, 'escribir ana@example.test | Hola | Hola Ana.', 'tel');
      await turno(frase, { app: (APP.appEsperandoDe as any)(amb, ctx) });
      const efectos = mandados.length - antes;
      if ((espera === 'manda' && efectos !== 1) || (espera !== 'manda' && efectos !== 0)) fallos.push(`«${frase}» esperaba ${espera}: efectos=${efectos}`);
    }
  });
  assert.deepEqual(fallos, []);
});

/* ------------------------------------------------------------------ la tabla de la app */

const CTX: any = { pantalla: 'chats', contactos: [{ correo: 'ana@example.test', nombre: 'Ana' }, { correo: 'bruno@example.test', nombre: 'Bruno' }], manos: ['enviar_exacto', 'llamar', 'recordatorio'] };
const PEND_ANA = { para: 'ana@example.test', texto: 'Llego a las 3' };
const enviosDe = (xs: Array<{ tipo: string; para?: string }>) => xs.filter((x) => x.tipo === 'enviar');

test('tabla (app): borrador de AU-RA para Ana — el atajo solo con afirmación pura; el cerebro solo si lo nombrado coincide', () => {
  const filas: Array<[string, 'atajo-manda' | 'atajo-no' , 'cerebro-manda' | 'cerebro-no']> = [
    ['sí', 'atajo-manda', 'cerebro-manda'],
    ['sí señor', 'atajo-manda', 'cerebro-manda'],
    ['sí, envíalo porfavor', 'atajo-manda', 'cerebro-manda'],
    ['sí, mándalo ahorita', 'atajo-manda', 'cerebro-manda'],
    ['sí, a Ana', 'atajo-no', 'cerebro-manda'],
    ['sí, a Bruno', 'atajo-no', 'cerebro-no'],
    ['mándale el mensaje a Bruno', 'atajo-no', 'cerebro-no'],
    ['sí, pero a Bruno', 'atajo-no', 'cerebro-no'],
    ['Bruno, mándalo', 'atajo-no', 'cerebro-no'],
    ['para Bruno, envíalo', 'atajo-no', 'cerebro-no'],
    ['send the message to Bruno', 'atajo-no', 'cerebro-no'],
    ['sí, mándalo a las 5', 'atajo-no', 'cerebro-no'],
    ['envíalo a Ana y a Bruno', 'atajo-no', 'cerebro-no'],
  ];
  const fallos: string[] = [];
  for (const [frase, atajo, cerebro] of filas) {
    const r = APP.ordenPorReglas(frase, { pendiente: PEND_ANA, contexto: CTX });
    const salioAtajo = r?.accion?.tipo === 'enviar' && r.accion.para === 'ana@example.test' && (r.accion as any).texto === PEND_ANA.texto;
    if (salioAtajo !== (atajo === 'atajo-manda') || (r?.accion?.tipo === 'enviar' && !salioAtajo)) fallos.push(`atajo «${frase}» esperaba ${atajo}: ${JSON.stringify(r?.accion ?? null)}`);
    const e = enviosDe(APP.prepararAcciones([{ tipo: 'enviar' }], { mensaje: frase, pendiente: PEND_ANA, contexto: CTX }));
    const salioCerebro = e.length === 1 && e[0].para === 'ana@example.test';
    if (salioCerebro !== (cerebro === 'cerebro-manda') || e.length > 1) fallos.push(`cerebro «${frase}» esperaba ${cerebro}: ${JSON.stringify(e)}`);
  }
  assert.deepEqual(fallos, []);
});

test('tabla (app): borrador de AU-RA para Ana Y texto escrito en el chat de Bruno — «envíalo» pregunta cuál', () => {
  const ctx = { ...CTX, chatAbierto: { correo: 'bruno@example.test', nombre: 'Bruno' }, borrador: 'Hola Bru, ya voy' };
  const r = APP.ordenPorReglas('envíalo', { pendiente: PEND_ANA, contexto: ctx });
  assert.notEqual(r?.accion?.tipo, 'enviar', 'el atajo no elige');
  assert.deepEqual(enviosDe(APP.prepararAcciones([{ tipo: 'enviar' }], { mensaje: 'envíalo', pendiente: PEND_ANA, contexto: ctx })), [], 'el cerebro tampoco');
  // Si el chat abierto es el de la misma persona (el borrador de AU-RA puesto ahí), no hay dos: sale una vez.
  const mismo = { ...CTX, chatAbierto: { correo: 'ana@example.test', nombre: 'Ana' }, borrador: PEND_ANA.texto };
  assert.deepEqual(APP.ordenPorReglas('envíalo', { pendiente: PEND_ANA, contexto: mismo })?.accion, { tipo: 'enviar', para: 'ana@example.test', texto: PEND_ANA.texto });
});

test('tabla (app): «¿llamo a Ana?» esperando — «sí, a Bruno», «sí, llama a Bruno», «yes, call bruno» no llaman a Ana; «sí, llámale» sí', () => {
  const prop = { tipo: 'llamar' as const, con: 'ana@example.test', nombre: 'Ana', video: false };
  const filas: Array<[string, boolean]> = [
    ['sí', true],
    ['sí, llámale', true],
    ['sí, a Ana', true],
    ['sí, a Bruno', false],
    ['sí, llama a Bruno', false],
    ['yes, call bruno', false],
    ['sí, a las 5', false],
  ];
  const fallos: string[] = [];
  for (const [frase, llama] of filas) {
    const r = APP.ordenPorReglas(frase, { propuesta: prop, contexto: CTX });
    const atajo = r?.accion?.tipo === 'llamar' && (r.accion as any).con === 'ana@example.test';
    const llamadas = APP.prepararAcciones([{ tipo: 'llamar', con: 'Ana', video: false }], { mensaje: frase, propuesta: prop, contexto: CTX }).filter((a) => a.tipo === 'llamar');
    const cerebro = llamadas.length === 1;
    // El atajo puede no decidir (lo hace el cerebro), pero nunca llama a Ana con un «sí» que nombra a otro.
    if ((atajo && !llama) || cerebro !== llama) fallos.push(`«${frase}» esperaba ${llama ? 'llama' : 'no llama'}: atajo=${atajo} cerebro=${cerebro}`);
  }
  assert.deepEqual(fallos, []);
});

test('tabla (app): recordatorio propuesto para las 5 de la tarde — «sí, a las 5» lo pone; «sí, a las 6» no', () => {
  const hoyHN = new Date(Date.now() - 6 * 3600_000);
  const cuando = Date.UTC(hoyHN.getUTCFullYear(), hoyHN.getUTCMonth(), hoyHN.getUTCDate() + 1, 23, 0); // mañana 17:00 en Honduras
  const prop = { tipo: 'recordatorio' as const, texto: 'la pastilla', cuando };
  const filas: Array<[string, boolean]> = [
    ['sí', true],
    ['sí, a las 5', true],
    ['sí, a las 6', false],
  ];
  const fallos: string[] = [];
  for (const [frase, pone] of filas) {
    const r = APP.ordenPorReglas(frase, { propuesta: prop, contexto: CTX });
    const atajo = r?.accion?.tipo === 'recordatorio';
    const cerebro = APP.prepararAcciones([{ tipo: 'recordatorio', texto: 'la pastilla', cuando }], { mensaje: frase, propuesta: prop, contexto: CTX }).filter((a) => a.tipo === 'recordatorio').length === 1;
    if ((atajo && !pone) || cerebro !== pone) fallos.push(`«${frase}» esperaba ${pone ? 'pone' : 'no pone'}: atajo=${atajo} cerebro=${cerebro}`);
  }
  assert.deepEqual(fallos, []);
});

/* ------------------------------------------------------------------ la función única */

test('la función única (lib/afirmacion.ts): afirmación pura, nombra la decisión, no coincide, ambiguo, y el «no» con su selección', async () => {
  const A = await import('../lib/afirmacion' as string).catch(() => null);
  assert.ok(A, 'lib/afirmacion.ts existe');
  const ana = { tipo: 'correo', destino: 'Ana <ana@example.test>' } as const;
  const bruno = { tipo: 'whatsapp', destino: 'Bruno (+50477773333)' } as const;
  const filas: Array<[string, any[], string, number?]> = [
    ['sí, envíalo AURA', [ana], 'ejecutar', 0],
    ['sí señor', [ana], 'ejecutar', 0],
    ['sí, a Ana', [ana], 'ejecutar', 0],
    ['sí, a Bruno', [ana], 'preguntar'],
    ['sí, mándalo a las 5', [ana], 'preguntar'],
    ['sí', [ana, bruno], 'preguntar'],
    ['sí, a Bruno', [ana, bruno], 'ejecutar', 1],
    ['sí, el correo', [ana, bruno], 'ejecutar', 0],
    ['envíalo a Ana y a Bruno', [ana, bruno], 'preguntar'],
    ['no', [ana, bruno], 'preguntar'],
    ['no, el correo', [ana, bruno], 'no', 0],
    ['no', [ana], 'no', 0],
    ['sí, pero a Bruno', [ana], 'nada'],
    ['¿qué hora es?', [ana], 'nada'],
    // Quitar un recordatorio: «sí, cancélalo» es su «sí» (no un «sí» que se contradice); «no, déjalo», su «no».
    ['sí, cancélalo', [{ tipo: 'cancelar_recordatorio', texto: 'La pastilla' }], 'ejecutar', 0],
    ['no, déjalo', [{ tipo: 'cancelar_recordatorio', texto: 'La pastilla' }], 'no', 0],
  ];
  const fallos: string[] = [];
  for (const [frase, ps, tipo, i] of filas) {
    const d = A!.decidirPendiente(frase, ps);
    if (d.tipo !== tipo || (i !== undefined && d.p !== ps[i])) fallos.push(`«${frase}» con ${ps.length}: esperaba ${tipo}${i !== undefined ? `#${i}` : ''}, dio ${d.tipo}`);
  }
  assert.deepEqual(fallos, []);
});
