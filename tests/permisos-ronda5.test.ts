/**
 * PERMISOS EXACTOS, QUINTA RONDA: la regla única al revés (lib/afirmacion.ts) — lista blanca, cerrada por defecto.
 *
 *  1. Atajo (ejecutar sin preguntar): solo si, tras normalizar y quitar un conjunto CERRADO de fichas (afirmaciones y
 *     cortesía), no queda NINGUNA. Cualquier otra ficha (él, «al señor», «Bueno», «Lee», una hora, un nombre) no.
 *  2. Turno completo: lo que sobra tiene que identificar sin dudas UNA decisión (destinatario —nombre o correo, también
 *     dictado— y/o canal, a todos si son varios). Un pronombre, una palabra que no cuadra o que cuadra con el texto o el
 *     destino de otra pendiente («el de la luz»), pregunta.
 *  3. Sin colapsar vocales fuera de las afirmaciones («Lee» no es «le»); el avatar que es un contacto no es vocativo.
 *  4. «no sé», «no es eso», «no estoy seguro» no son un «no»: preguntan y no descartan.
 *  Y una prueba de propiedad: una afirmación más una palabra de un diccionario de 200, con semilla fija.
 *
 * Caminos REALES con efectos simulados y contados (buzón SMTP y puente de WhatsApp de mentira, el atajo de la app,
 * prepararAcciones). Datos sintéticos (example.test, números falsos).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'permisos-ronda5-'));
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
const TIGO = chat('50477770001@s.whatsapp.net', 'Tigo', '+50477770001');
const ANTONIO = chat('50477770002@s.whatsapp.net', 'Antonio', '+50477770002');
const PAZ = chat('50477770003@s.whatsapp.net', 'Paz', '+50477770003');
const CLARO = chat('50477770004@s.whatsapp.net', 'Claro', '+50477770004');
const CHATS = [BRUNO, TIGO, ANTONIO, PAZ, CLARO];

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

/* ------------------------------------------------------------------ el servidor, con efectos contados */

type Espera = 'manda' | 'pregunta';

test('ronda 5 (servidor): correo para Ana y Bruno — un pronombre o «al señor» no eligen a nadie', async () => {
  const filas: Array<[string, Espera]> = [
    ['sí', 'manda'],
    ['dale', 'manda'],
    ['sí, mándaselo a él', 'pregunta'],
    ['sí, a ella', 'pregunta'],
    ['sí, al señor', 'pregunta'],
    ['yes, send it to him', 'pregunta'],
    ['sí, mándaselo a ellos', 'pregunta'],
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
      const vale = espera === 'manda' ? efectos === 1 : efectos === 0 && vivo(C.borradorDe(JOSE, 'tel')) && PREGUNTA.test(r.hechos.join('\n'));
      if (!vale) fallos.push(`«${frase}» esperaba ${espera}: efectos=${efectos}`);
    }
  });
  assert.deepEqual(fallos, []);
});

const CORREO_ANA: Array<[string, Espera | 'descarta' | 'sigue']> = [
  // Lo de siempre.
  ['sí', 'manda'],
  ['dale', 'manda'],
  ['sí señor', 'manda'],
  ['sí, envíalo porfavor', 'manda'],
  // Uso normal que tiene que confirmar.
  ['mándelo', 'manda'],
  ['envíelo', 'manda'],
  ['hágale pues', 'manda'],
  ['ándele', 'manda'],
  ['ta bueno', 'manda'],
  ['cabal', 'manda'],
  ['ya estuvo', 'manda'],
  ['chévere, mándalo', 'manda'],
  ['sí, no hay clavo', 'manda'],
  ['va pues', 'manda'],
  ['vale', 'manda'],
  // El correo dicho tal cual, o dictado.
  ['sí, a ana@example.test', 'manda'],
  ['sí, a ana arroba example punto test', 'manda'],
  ['sí, a Ana', 'manda'],
  // Palabras que la regla vieja quitaba o colapsaba: ahora no eligen a Ana.
  ['sí, mándaselo a Bueno', 'pregunta'],
  ['sí, a Lee', 'pregunta'],
  ['sí, a él', 'pregunta'],
  ['sí, a la luz', 'pregunta'],
  ['sí, a otro@example.test', 'pregunta'],
  ['sí, a ana arroba otro punto test', 'pregunta'],
  ['sí, al señor', 'pregunta'],
  // No sé / no es eso: ni sí ni no; no se descarta nada.
  ['no sé', 'sigue'],
  ['no lo sé', 'sigue'],
  ['no es eso', 'sigue'],
  ['no estoy seguro', 'sigue'],
  // El «no» claro descarta (una sola pendiente).
  ['no', 'descarta'],
  ['no lo mandes', 'descarta'],
  ['cancélalo', 'descarta'],
  ['no gracias', 'descarta'],
  ['mejor no', 'descarta'],
];

test('ronda 5 (servidor): un correo para Ana — lista blanca: el uso normal confirma; lo que no se reconoce pregunta; «no sé» no descarta', async () => {
  const fallos: string[] = [];
  await conEntorno([], async ({ mandados }) => {
    for (const [frase, espera] of CORREO_ANA) {
      C._olvidarCorreo();
      const antes = mandados.length;
      await C.correrCorreo(JOSE, 'escribir ana@example.test | Informe | Va el informe.', 'tel');
      const r = await turno(frase);
      await turno(frase);
      const efectos = mandados.length - antes;
      const b = C.borradorDe(JOSE, 'tel');
      const hechos = r.hechos.join('\n');
      const vale =
        espera === 'manda' ? efectos === 1 && mandados.at(-1)!.para[0] === 'ana@example.test'
        : espera === 'descarta' ? efectos === 0 && !b
        : efectos === 0 && vivo(b) && PREGUNTA.test(hechos);
      if (!vale) fallos.push(`«${frase}» esperaba ${espera}: efectos=${efectos} borrador=${b ? (b.soloPanel ? 'apartado' : 'vivo') : 'fuera'} hechos=${JSON.stringify(hechos.slice(0, 80))}`);
    }
  });
  assert.deepEqual(fallos, [], `${fallos.length} de ${CORREO_ANA.length} frases fallan:\n${fallos.join('\n')}`);
});

test('ronda 5 (servidor): WhatsApp para Tigo — «sí, mándaselo a Claro» pregunta; el «sí» suelto manda una vez', async () => {
  const fallos: string[] = [];
  await conEntorno([], async ({ enviados }) => {
    for (const [frase, espera] of [['sí, mándaselo a Claro', 'pregunta'], ['sí', 'manda'], ['dale', 'manda'], ['sí, a Tigo', 'manda']] as Array<[string, Espera]>) {
      W._olvidarWhatsapp();
      const antes = enviados.length;
      await W.correrWhatsapp(JOSE, 'responder Tigo | Ya pagué la factura.', 'tel');
      const r = await turno(frase);
      await turno(frase);
      const efectos = enviados.length - antes;
      const vale = espera === 'manda' ? efectos === 1 : efectos === 0 && PREGUNTA.test(r.hechos.join('\n'));
      if (!vale) fallos.push(`«${frase}» esperaba ${espera}: efectos=${efectos}`);
    }
  });
  assert.deepEqual(fallos, []);
});

test('ronda 5 (servidor): correo a Ana y WhatsApp a Antonio (contacto) — «Antonio, sí» no es un vocativo: pregunta', async () => {
  await conEntorno([], async ({ mandados, enviados }) => {
    await C.correrCorreo(JOSE, 'escribir ana@example.test | Informe | Va.', 'tel');
    await W.correrWhatsapp(JOSE, 'responder Antonio | Va.', 'tel');
    const r = await turno('Antonio, sí', { conocidos: ['Ana', 'Antonio'] });
    assert.equal(mandados.length + enviados.length, 0, 'no sale nada');
    assert.ok(vivo(C.borradorDe(JOSE, 'tel')) && vivo(W.borradorWhatsappDe(JOSE, 'tel')), 'los dos siguen esperando');
    assert.match(r.hechos.join('\n'), PREGUNTA);
  });
});

test('ronda 5 (servidor): correo a Luz y WhatsApp a Paz sobre la luz — «sí, el de la luz» pregunta', async () => {
  await conEntorno([], async ({ mandados, enviados }) => {
    await C.correrCorreo(JOSE, 'escribir luz@example.test | Hola | Hola Luz.', 'tel');
    await W.correrWhatsapp(JOSE, 'responder Paz | Mañana cortan la luz en la colonia.', 'tel');
    const r = await turno('sí, el de la luz');
    assert.equal(mandados.length + enviados.length, 0, 'no sale nada');
    assert.ok(vivo(C.borradorDe(JOSE, 'tel')) && vivo(W.borradorWhatsappDe(JOSE, 'tel')));
    assert.match(r.hechos.join('\n'), PREGUNTA);
    // Sin ambigüedad: el canal o el nombre de Paz eligen.
    await turno('sí, el WhatsApp de Paz');
    assert.equal(enviados.length, 1);
    assert.equal(mandados.length, 0);
  });
});

/* ------------------------------------------------------------------ la app */

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

test('ronda 5 (app): borrador para Ana — el atajo solo con lista blanca; «Antonio, sí» (contacto) no manda', () => {
  const filas: Array<[string, boolean]> = [
    ['sí', true],
    ['dale', true],
    ['mándelo', true],
    ['ta bueno', true],
    ['cabal', true],
    ['chévere, mándalo', true],
    ['sí, no hay clavo', true],
    ['sí, mándaselo a Bueno', false],
    ['sí, a Lee', false],
    ['sí, a él', false],
    ['Antonio, sí', false],
    ['no sé', false],
  ];
  const fallos: string[] = [];
  for (const [frase, manda] of filas) {
    const r = APP.ordenPorReglas(frase, { pendiente: PEND_ANA, contexto: CTX });
    const atajo = r?.accion?.tipo === 'enviar';
    const e = APP.prepararAcciones([{ tipo: 'enviar' }], { mensaje: frase, pendiente: PEND_ANA, contexto: CTX }).filter((a) => a.tipo === 'enviar');
    if (atajo !== manda || (e.length === 1) !== manda) fallos.push(`«${frase}» esperaba ${manda ? 'manda' : 'no manda'}: atajo=${atajo} cerebro=${e.length}`);
    if (frase === 'no sé' && r?.accion?.tipo === 'descartar') fallos.push('«no sé» descartó el borrador');
  }
  assert.deepEqual(fallos, []);
});

/* ------------------------------------------------------------------ la función única */

test('ronda 5 (función única): pronombres, palabras desconocidas, correos dictados, «no sé», texto de otra pendiente', async () => {
  const A = await import('../lib/afirmacion');
  const ana: any = { tipo: 'correo', destino: 'Ana <ana@example.test>' };
  const dos: any = { tipo: 'correo', destino: 'ana@example.test bruno@example.test', destinatarios: ['ana@example.test', 'bruno@example.test'] };
  const luz: any = { tipo: 'correo', destino: 'luz@example.test', tema: 'Hola Luz' };
  const paz: any = { tipo: 'whatsapp', destino: 'Paz (+50477770003)', tema: 'Mañana cortan la luz en la colonia' };
  const antonio: any = { tipo: 'whatsapp', destino: 'Antonio (+50477770002)' };
  const tigo: any = { tipo: 'whatsapp', destino: 'Tigo (+50477770001)' };
  const filas: Array<[string, any[], string, number?]> = [
    ['sí, mándaselo a él', [dos], 'preguntar'],
    ['yes, send it to him', [dos], 'preguntar'],
    ['sí, al señor', [dos], 'preguntar'],
    ['sí, mándaselo a Bueno', [ana], 'preguntar'],
    ['sí, a Lee', [ana], 'preguntar'],
    ['sí, mándaselo a Claro', [tigo], 'preguntar'],
    ['Antonio, sí', [ana, antonio], 'preguntar'],
    ['sí, el de la luz', [luz, paz], 'preguntar'],
    ['sí, a ana@example.test', [ana], 'ejecutar', 0],
    ['sí, a ana arroba example punto test', [ana], 'ejecutar', 0],
    ['no sé', [ana], 'preguntar'],
    ['no es eso', [ana], 'preguntar'],
    ['no', [ana], 'no', 0],
    ['mándelo', [ana], 'ejecutar', 0],
    ['ta bueno', [ana], 'ejecutar', 0],
    ['sí, no hay clavo', [ana], 'ejecutar', 0],
  ];
  const fallos: string[] = [];
  for (const [frase, ps, tipo, i] of filas) {
    const d: any = A.decidirPendiente(frase, ps);
    if (d.tipo !== tipo || (i !== undefined && d.p !== ps[i])) fallos.push(`«${frase}» con ${ps.length}: esperaba ${tipo}${i !== undefined ? `#${i}` : ''}, dio ${d.tipo}`);
  }
  for (const [frase, pura] of [['sí, a Lee', false], ['sí, mándaselo a Bueno', false], ['ta bueno', true], ['no es eso', false], ['sí, a él', false]] as Array<[string, boolean]>) {
    if (A.esAfirmacionPura(frase) !== pura && !(frase === 'no es eso')) fallos.push(`esAfirmacionPura(«${frase}») debía ser ${pura}`);
  }
  for (const frase of ['no sé', 'no lo sé', 'no es eso', 'no estoy seguro']) if (A.respuestaPura(frase) !== null) fallos.push(`respuestaPura(«${frase}») debía ser null`);
  assert.deepEqual(fallos, []);
});

/* ------------------------------------------------------------------ prueba de propiedad */

/** Generador con semilla fija (mulberry32): la misma secuencia en cada corrida. */
function azar(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 200 palabras comunes del español y nombres (ninguna de cortesía, ningún sí, ningún nombre del avatar). */
const DICCIONARIO = (
  'Ana Bruno Carla Luz Paz Lee Mario Pedro Juan María José Luis Carlos Sofía Lucía Elena Rosa Diego Pablo Andrés ' +
  'Jorge Miguel Laura Marta Teresa Raúl Óscar Hugo Iván Nora Olga Rita Tigo Silvia Celia Esperanza Rocío Ángel Cruz Mar ' +
  'Sol Flor Blanca Dolores Pilar Victoria Gloria Leo Noé Abel Ada Eva Ema Iris Inés Beto Chepe Toño Lupe Memo Nacho ' +
  'casa perro gato agua mañana tarde noche hoy lunes martes viernes cinco diez 5 10 300 hora reunión factura pago banco ' +
  'tienda carro trabajo oficina Rafa mamá papá Tito amigo doctor cita médico escuela niños comida cena almuerzo café ' +
  'dinero precio cuenta tarjeta número teléfono celular whatsapp correo mensaje chat llamada video foto archivo documento ' +
  'informe proyecto planta mina oro plata cobre camión ruta viaje vuelo hotel playa ciudad pueblo Tegucigalpa Honduras ' +
  'él ella le ellos usted ustedes nosotros todo algo mucho poco grande pequeño nuevo viejo rápido lento bien mal peor ' +
  'también aquí allá ahí después antes luego pronto siempre quizás urgente importante privado copia adjunto firma saludo ' +
  'luz agua lluvia calor frío semana mes año domingo sábado jueves miércoles enero junio diciembre tres cuatro seis siete ' +
  'ocho nueve once doce cien mil 2 3 7 12 15 100 1000 ruta norte sur centro colonia barrio calle puerta llave'
).split(/\s+/);

test('ronda 5 (propiedad): una afirmación más UNA palabra de un diccionario de 200 — nunca por atajo; en el turno completo, solo si es el destinatario o el canal', async () => {
  const A = await import('../lib/afirmacion');
  assert.ok(new Set(DICCIONARIO).size >= 200, `el diccionario tiene ${new Set(DICCIONARIO).size} palabras distintas`);
  const r = azar(20261004);
  const afirmaciones = ['sí', 'dale', 'ok', 'envíalo', 'mándalo', 'sí, porfa'];
  const formas = [(af: string, w: string) => `${af}, ${w}`, (af: string, w: string) => `${af}, a ${w}`, (af: string, w: string) => `${w}, ${af}`];
  const sinT2 = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const ana: any = { tipo: 'correo', destino: 'Ana <ana@example.test>' };
  // Lo que sí es el destinatario o el canal de la única pendiente.
  const ES_DEL_CORREO = new Set(['ana', 'correo', 'mensaje']);
  const ES_DEL_MENSAJE_APP = new Set(['ana', 'mensaje', 'chat']);
  const combos: string[] = [];
  const fallos: string[] = [];
  for (let i = 0; i < 600; i++) {
    const w = DICCIONARIO[Math.floor(r() * DICCIONARIO.length)];
    const af = afirmaciones[Math.floor(r() * afirmaciones.length)];
    const frase = formas[Math.floor(r() * formas.length)](af, w);
    combos.push(`${frase}\u0000${sinT2(w)}`);
    const d: any = A.decidirPendiente(frase, [ana]);
    if (A.esAfirmacionPura(frase)) fallos.push(`atajo (pura): «${frase}»`);
    if ((d.tipo === 'ejecutar') !== ES_DEL_CORREO.has(sinT2(w))) fallos.push(`turno: «${frase}» dio ${d.tipo}`);
    const atajo = APP.ordenPorReglas(frase, { pendiente: PEND_ANA, contexto: CTX });
    if (atajo?.accion?.tipo === 'enviar') fallos.push(`atajo de la app: «${frase}»`);
    const cerebro = APP.prepararAcciones([{ tipo: 'enviar' }], { mensaje: frase, pendiente: PEND_ANA, contexto: CTX }).some((a) => a.tipo === 'enviar');
    if (cerebro !== ES_DEL_MENSAJE_APP.has(sinT2(w))) fallos.push(`cerebro de la app: «${frase}» envió=${cerebro}`);
  }
  // Y una muestra por el turno REAL del servidor, contando los correos de mentira.
  await conEntorno([], async ({ mandados }) => {
    for (const c of combos.slice(0, 60)) {
      const [frase, w] = c.split('\u0000');
      C._olvidarCorreo();
      const antes = mandados.length;
      await C.correrCorreo(JOSE, 'escribir ana@example.test | Informe | Va el informe.', 'tel');
      await turno(frase);
      if ((mandados.length - antes === 1) !== ES_DEL_CORREO.has(w)) fallos.push(`turno real: «${frase}» mandó ${mandados.length - antes}`);
    }
  });
  assert.deepEqual(fallos.slice(0, 40), [], `${fallos.length} fallos de ${combos.length} combinaciones`);
});

/* ------------------------------------------------------------------ ajuste: «claro» */

test('ronda 5 (ajuste «claro»): «sí, claro», «ok, claro», «claro, dale»… confirman; «a Claro» o el contacto Claro preguntan', async () => {
  const confirman = ['sí, claro', 'claro que sí', 'sí claro, mándalo', 'ok, claro', 'claro, dale'];
  const fallos: string[] = [];
  // La app: el atajo con un borrador para Ana.
  for (const frase of confirman) {
    const r = APP.ordenPorReglas(frase, { pendiente: PEND_ANA, contexto: CTX });
    if (r?.accion?.tipo !== 'enviar') fallos.push(`atajo «${frase}»: ${JSON.stringify(r?.accion ?? null)}`);
  }
  await conEntorno([], async ({ mandados, enviados }) => {
    // El servidor: un correo para Ana, una vez.
    for (const frase of [...confirman, 'sí, a Claro']) {
      C._olvidarCorreo();
      const antes = mandados.length;
      await C.correrCorreo(JOSE, 'escribir ana@example.test | Informe | Va el informe.', 'tel');
      const r = await turno(frase);
      await turno(frase);
      const efectos = mandados.length - antes;
      const debe = frase === 'sí, a Claro' ? 0 : 1;
      if (efectos !== debe || (debe === 0 && !PREGUNTA.test(r.hechos.join('\n')))) fallos.push(`servidor «${frase}»: efectos=${efectos}`);
    }
    // «mándaselo a Claro» con un WhatsApp para Tigo: pregunta.
    W._olvidarWhatsapp();
    await W.correrWhatsapp(JOSE, 'responder Tigo | Ya pagué.', 'tel');
    const r1 = await turno('mándaselo a Claro');
    if (enviados.length !== 0 || !PREGUNTA.test(r1.hechos.join('\n'))) fallos.push(`«mándaselo a Claro» con Tigo: enviados=${enviados.length}`);
    // «sí, claro» con un WhatsApp para el contacto Claro y otro (correo) para Ana: pregunta.
    W._olvidarWhatsapp();
    C._olvidarCorreo();
    const m0 = mandados.length;
    await W.correrWhatsapp(JOSE, 'responder Claro | Quiero cambiar de plan.', 'tel');
    await C.correrCorreo(JOSE, 'escribir ana@example.test | Informe | Va.', 'tel');
    const r2 = await turno('sí, claro', { conocidos: ['Ana', 'Claro'] });
    if (enviados.length !== 0 || mandados.length !== m0 || !PREGUNTA.test(r2.hechos.join('\n'))) fallos.push(`«sí, claro» con Claro y Ana: enviados=${enviados.length} mandados=${mandados.length - m0}`);
  });
  // La función única: el contacto Claro como vocativo solo no confirma nada.
  const A = await import('../lib/afirmacion');
  const claroWA: any = { tipo: 'whatsapp', destino: 'Claro (+50477770004)' };
  const ana: any = { tipo: 'correo', destino: 'Ana <ana@example.test>' };
  for (const [frase, ps, tipo, conocidos] of [
    ['Claro, sí', [claroWA], 'preguntar'],
    ['sí, a Claro', [claroWA], 'ejecutar'],
    ['sí, claro', [ana], 'ejecutar'],
    ['ok, claro', [ana], 'ejecutar'],
    // Claro solo en la agenda (la compañía de teléfono), sin nada pendiente para él: el «sí, claro» de siempre confirma.
    ['sí, claro', [ana], 'ejecutar', ['Claro']],
    ['claro, sí', [ana], 'ejecutar', ['Claro']],
    ['sí, a Claro', [ana], 'preguntar', ['Claro']],
  ] as Array<[string, any[], string, string[]?]>) {
    const d: any = A.decidirPendiente(frase, ps, conocidos ? { conocidos } : {});
    if (d.tipo !== tipo) fallos.push(`función «${frase}»: esperaba ${tipo}, dio ${d.tipo}`);
  }
  assert.deepEqual(fallos, []);
});
