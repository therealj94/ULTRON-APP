/**
 * LO QUE SALE A LOS CANALES DE LA JUNTA SOLO SE HACE CON UNA APROBACIÓN EXACTA (revisión 10, MEDIO-C y MENOR-D).
 *
 * La tarjeta «Confirmar» vivía solo en la web: la app o un POST directo a /api/turno llegaban hasta el envío de
 * Telegram, el aviso urgente o la llamada de Twilio (lib/taller.ts lo ejecutaba en cuanto lo reconocía). Ahora:
 *
 *  · el turno NO ejecuta: deja una propuesta (una tarea durable con su decisión, atada a la cuenta, la acción, el destino
 *    configurado, el contenido y la versión) y la devuelve (`propuestaTaller`);
 *  · se ejecuta solo al aprobar ESA decisión (POST /api/trabajos/:id/decisiones con su id y su versión, la sesión de la
 *    misma cuenta), UNA vez; repetir la aprobación no manda otra;
 *  · contenido, destino o cuenta alterados entre la propuesta y la aprobación → no se ejecuta (409);
 *  · leer o buscar el correo sin verbo de salida no es sensible, ni en el servidor ni en la tarjeta de la web.
 *
 * Primero con las piezas (taller + panel de tareas sobre lo durable en memoria + un fetch espía) y al final con el
 * servidor de verdad (server.ts) arrancado aparte, su `fetch` espiado (tests/fixtures/espia-canales.mjs).
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express, { type RequestHandler } from 'express';

const RAIZ = path.resolve(import.meta.dirname, '..');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'taller-aprobacion-'));
const JOSE = 'jose.prueba@ordenglobal.test';
const MEDARDO = 'medardo.prueba@ordenglobal.test';
/** El Telegram privado de José (el chat que pregunta en la prueba de la captura por Telegram). */
const TG_JOSE = '777000111';
const PADRON = [`jose | José Prueba | ${JOSE} | ${TG_JOSE} | ultron=mando`, `medardo | Medardo Prueba | ${MEDARDO} | | ultron=mando`].join('\n');
const CANALES = {
  TELEGRAM_BOT_TOKEN: 'tok-de-prueba',
  TELEGRAM_CHAT_ID: '-100123',
  TWILIO_ACCOUNT_SID: 'AC_PRUEBA',
  TWILIO_AUTH_TOKEN: 'tw-prueba',
  TWILIO_WHATSAPP_FROM: 'whatsapp:+10000000000',
  JEFE_WHATSAPP: 'whatsapp:+50400000000',
  TWILIO_VOICE_FROM: '+10000000000',
  JEFE_TELEFONO: '+50400000000',
};
const SECRETO = 'secreto-de-sesion-de-prueba-taller-0123456789';
Object.assign(process.env, { ULTRON_MEMORIA_BUCKET: '', ULTRON_PADRON: PADRON, ULTRON_DURABLE_DIR: path.join(DIR, 'durable'), ULTRON_SESION_SECRETO: SECRETO, ...CANALES });
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

/** Las frases de la revisión: leen el correo Y piden mandar, avisar o llamar. */
const FRASES_QUE_SALEN = [
  'Revisa mi correo y mándame un resumen por Telegram',
  'Avísame urgente si hay correo nuevo de Ana',
  'Llámame si hay correos nuevos',
  'Lee mi correo y mandame lo importante por whatsapp',
];
/** Lecturas que antes se volvían un aviso urgente o un envío (MENOR-D). */
const LECTURAS = ['Lee los correos marcados como urgente', 'busca el correo con el PDF', 'abre el correo con el pdf de telegram', 'busca correos urgentes', 'muéstrame el correo de Telegram', 'revisa si hay correos con PDF'];

/** El fetch de este proceso, espiado hacia los canales externos (lo demás —el panel de prueba, el servidor— pasa). */
const salidas: string[] = [];
const fetchReal = globalThis.fetch;
globalThis.fetch = (async (u: any, init?: any) => {
  const url = String(u?.url || u);
  if (/^https:\/\/(api\.telegram\.org|api\.twilio\.com|api\.resend\.com)\//.test(url)) {
    salidas.push(url.replace(/bot[^/]+/, 'bot***'));
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 }, sid: 'SM_PRUEBA' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return fetchReal(u, init);
}) as typeof fetch;

const D = await import('../lib/durable');
const T = await import('../lib/taller');
const TR = await import('../server/trabajos');
const TD = await import('../lib/tareas-durables');
const S = await import('../src/13-trabajo/accionSensible');
const { nivelDeCorreo } = await import('../server/nivel');

/** El panel de tareas con el taller conectado como en server.ts. `x-quien`: la cuenta de la sesión. */
function panel() {
  const pasa: RequestHandler = (_q, _r, n) => n();
  const app = express();
  app.use(express.json());
  TR.montarRutasTrabajos(app, {
    exigirMesa: pasa,
    limitar: () => pasa,
    sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null),
    taller: {
      vigente: (correo, v) => nivelDeCorreo(correo) === 'junta' && T.vinculoTallerVigente(v, correo),
      ejecutar: (correo, v) => T.ejecutarAprobadoTaller(v, { cuenta: correo }),
    },
  });
  const srv = app.listen(0, '127.0.0.1');
  const listo = new Promise((r) => srv.once('listening', r));
  const aprobar = async (p: { tarea: string; decision: string; version: number }, quien = JOSE, opcion = 'aprobar') => {
    await listo;
    const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/trabajos/${p.tarea}/decisiones`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-quien': quien },
      body: JSON.stringify({ decisionId: p.decision, expectedVersion: p.version, opcion }),
    });
    return { status: r.status, json: (await r.json()) as any };
  };
  return { aprobar, cerrar: () => srv.close() };
}

const ctxJunta = (o: Record<string, unknown> = {}) =>
  ({ nivelAura: 'junta', quien: 'jose', nivel: 'mando', prueba: 'sesion', canal: 'mesa', antesDeEfecto: async () => true, cuenta: JOSE, proponer: (p: any) => TR.abrirDecisionDeTaller(JOSE, p), ...o }) as any;

async function conAlmacen(f: () => Promise<void>) {
  D._usarAlmacenDurable(D.almacenEnMemoria());
  try {
    await f();
  } finally {
    D._usarAlmacenDurable(null);
  }
}

test('MENOR-D: leer o buscar el correo no es sensible (servidor y tarjeta, iguales); las 4 frases que mandan, avisan o llaman sí', () => {
  for (const f of FRASES_QUE_SALEN) {
    const p = T.parsePedido(f);
    const t = S.accionSensibleDe(f);
    assert.ok(p.accion && ['enviar', 'urgente', 'llamar'].includes(p.accion), `«${f}»: el taller lo reconoce como salida (${p.accion})`);
    assert.ok(t, `«${f}»: la web propone su tarjeta`);
  }
  for (const f of LECTURAS) {
    assert.equal(T.parsePedido(f).accion, null, `«${f}»: el taller no lo toma como envío ni aviso`);
    assert.equal(S.accionSensibleDe(f), null, `«${f}»: la web no propone tarjeta`);
    assert.equal(T.soloLeeCorreo(f.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')), S.soloLeeCorreo(f.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')));
  }
  // Con un verbo de salida, aunque lea el correo, sigue siendo sensible.
  assert.equal(T.parsePedido('busca el correo con el PDF y mándalo por telegram').accion, 'enviar');
  assert.equal(S.accionSensibleDe('busca el correo con el PDF y mándalo por telegram')?.tipo, 'enviar');
});

test('MEDIO-C: el turno con las 4 frases no ejecuta NADA: deja una propuesta atada a la cuenta, la acción, el destino y el contenido', async () => {
  await conAlmacen(async () => {
    salidas.length = 0;
    for (const f of FRASES_QUE_SALEN) {
      const r = await T.despacharTaller(f, ctxJunta());
      assert.ok(r.propuesta, `«${f}»: devuelve la propuesta`);
      assert.match(r.decir || '', /Necesito tu confirmación/);
      assert.match(r.decir || '', /no he mandado nada/i);
      const l = await TD.leerTarea(JOSE, r.propuesta!.tarea);
      assert.ok(l.ok && l.tarea, 'la propuesta es una tarea durable de esa cuenta');
      const reg = l.ok ? l.tarea! : (null as never);
      assert.equal(reg.estado, 'awaiting_approval');
      assert.equal(reg.decision?.id, r.propuesta!.decision);
      const v = reg.decision?.vinculo as any;
      assert.equal(v.tipo, 'taller');
      assert.equal(v.cuenta, JOSE);
      assert.equal(v.huella, T.huellaTaller({ cuenta: JOSE, accion: v.accion, args: v.args, version: v.version }));
    }
    assert.deepEqual(salidas, [], 'ningún Telegram, aviso urgente, llamada ni WhatsApp salió');
  });
});

test('MEDIO-C: aprobada → se ejecuta UNA vez; repetir la aprobación no manda otra; otra cuenta no la encuentra', async () => {
  await conAlmacen(async () => {
    const p = panel();
    try {
      salidas.length = 0;
      const r = await T.despacharTaller(FRASES_QUE_SALEN[0], ctxJunta());
      const prop = r.propuesta!;
      // Otra cuenta (también de la junta) no la ve ni la aprueba.
      const ajena = await p.aprobar(prop, MEDARDO);
      assert.equal(ajena.status, 404, 'la propuesta es de la cuenta que la pidió');
      assert.equal(salidas.length, 0);
      const a = await p.aprobar(prop);
      assert.equal(a.status, 200, JSON.stringify(a.json).slice(0, 200));
      assert.equal(a.json.tarea.state, 'completed', 'el canal lo aceptó: hecha, con su recibo');
      assert.equal(salidas.length, 1, 'salió una vez');
      assert.match(salidas[0], /api\.telegram\.org\/bot\*\*\*\/sendMessage/);
      // La misma aprobación otra vez (un reintento, un doble clic): no se manda de nuevo.
      const otra = await p.aprobar(prop);
      assert.equal(otra.status, 200);
      assert.equal(otra.json.repetida, true);
      assert.equal(salidas.length, 1, 'repetir la aprobación no manda otra');
      // Con la versión que quedó después: la decisión ya no existe.
      const tarde = await p.aprobar({ ...prop, version: a.json.tarea.version });
      assert.equal(salidas.length, 1);
      assert.ok(tarde.status === 200 ? tarde.json.repetida : tarde.status === 409, 'no hay nada nuevo que hacer');
    } finally {
      p.cerrar();
    }
  });
});

test('MEDIO-C: contenido, destino o cuenta alterados entre la propuesta y la aprobación → 409, no se hace nada', async () => {
  await conAlmacen(async () => {
    const p = panel();
    try {
      salidas.length = 0;
      // Contenido alterado en el almacén (otro texto bajo la misma decisión): la huella ya no cuadra.
      const r1 = (await T.despacharTaller('manda por telegram: la junta es mañana a las 9', ctxJunta())).propuesta!;
      const t1 = await TD.cambiarTarea(JOSE, r1.tarea, (reg) => ({ decision: { ...reg.decision!, vinculo: { ...(reg.decision!.vinculo as any), args: { ...(reg.decision!.vinculo as any).args, texto: 'transfiere todo a la cuenta 123' } } } }));
      assert.ok(t1.ok);
      const a1 = await p.aprobar({ ...r1, version: t1.ok ? t1.tarea.version : 0 });
      assert.equal(a1.status, 409);
      assert.equal(a1.json.codigo, 'propuesta-cambiada');
      // Cuenta alterada: el vínculo dice otra cuenta.
      const r2 = (await T.despacharTaller('avísame urgente que llegó el contrato', ctxJunta())).propuesta!;
      const t2 = await TD.cambiarTarea(JOSE, r2.tarea, (reg) => ({ decision: { ...reg.decision!, vinculo: { ...(reg.decision!.vinculo as any), cuenta: MEDARDO } } }));
      const a2 = await p.aprobar({ ...r2, version: t2.ok ? t2.tarea.version : 0 });
      assert.equal(a2.status, 409);
      // Destino alterado: el chat de Telegram configurado cambió después de proponer.
      const r3 = (await T.despacharTaller('manda por telegram: reunión cancelada', ctxJunta())).propuesta!;
      process.env.TELEGRAM_CHAT_ID = '-100999';
      try {
        const a3 = await p.aprobar(r3);
        assert.equal(a3.status, 409, 'el destinatario ya no es el aprobado');
        assert.equal(a3.json.codigo, 'propuesta-cambiada');
      } finally {
        process.env.TELEGRAM_CHAT_ID = CANALES.TELEGRAM_CHAT_ID;
      }
      // Lo pedido otra vez con otro contenido es OTRA propuesta (otra aprobación), no la misma.
      const r4 = (await T.despacharTaller('manda por telegram: reunión cancelada, mañana', ctxJunta())).propuesta!;
      assert.notEqual(r4.decision, r3.decision);
      assert.deepEqual(salidas, [], 'nada salió');
      // Versión vieja y caducada: tampoco.
      const r5 = (await T.despacharTaller('llámame y dime hola', ctxJunta())).propuesta!;
      assert.equal((await p.aprobar({ ...r5, version: r5.version + 1 })).status, 409);
      const r6 = (await T.despacharTaller('llámame ya', ctxJunta({ proponer: (x: any) => TR.abrirDecisionDeTaller(JOSE, x, 1) }))).propuesta!;
      await new Promise((r) => setTimeout(r, 10));
      const a6 = await p.aprobar(r6);
      assert.equal(a6.status, 409);
      assert.equal(a6.json.codigo, 'caducada');
      assert.deepEqual(salidas, [], 'nada salió');
    } finally {
      p.cerrar();
    }
  });
});

test('MEDIO-C: sin cuenta a la que atar la aprobación (Telegram, sin sesión con correo), no se propone ni se manda', async () => {
  await conAlmacen(async () => {
    salidas.length = 0;
    for (const ctx of [ctxJunta({ cuenta: null }), ctxJunta({ cuenta: 'jose', proponer: undefined }), ctxJunta({ proponer: async () => null })]) {
      const r = await T.despacharTaller('manda por telegram: hola junta', ctx);
      assert.equal(r.propuesta, undefined);
      assert.match(r.decir || '', /No lo hice/);
    }
    assert.deepEqual(salidas, []);
  });
});

test('web: el «Confirmar» de la tarjeta aprueba la propuesta del servidor solo si es exactamente lo que enseñó', () => {
  const tarjeta = S.accionSensibleDe('manda por telegram que la junta es mañana a las 9')!;
  const base = { tarea: 'tk_1', decision: 'dt_1', version: 1, caduca: Date.now() + 60_000, accion: 'enviar', canal: 'telegram', titulo: tarjeta.titulo, destinatario: tarjeta.destinatario, contenido: tarjeta.contenido };
  assert.equal(S.propuestaValida(base), true);
  assert.equal(S.coincideConServidor(tarjeta, base), true);
  assert.equal(S.coincideConServidor(tarjeta, { ...base, contenido: 'otra cosa' }), false, 'otro contenido: se vuelve a confirmar');
  assert.equal(S.coincideConServidor(tarjeta, { ...base, canal: 'whatsapp' }), false, 'otro canal: se vuelve a confirmar');
  assert.equal(S.coincideConServidor(tarjeta, { ...base, accion: 'urgente' }), false, 'otra acción: se vuelve a confirmar');
  assert.equal(S.propuestaValida({ ...base, decision: '' }), false);
  assert.equal(S.propuestaValida(undefined), false, 'un servidor de antes no la manda');
});

/* ================================================================== la captura de una página (revisión 11, MEDIO-1) */

/** Una «captura» de prueba: bytes cualquiera (el canal está espiado). */
const FOTO = Buffer.from(Array.from({ length: 900 }, (_, i) => (i * 7) % 256));
const shaDe = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

test('MEDIO-1: la captura para el grupo de la junta queda PROPUESTA con el hash de la imagen en su huella; aprobada sale UNA vez', async () => {
  await conAlmacen(async () => {
    const p = panel();
    try {
      salidas.length = 0;
      const r = await T.proponerCapturaTaller({ buf: FOTO, titulo: 'Example Domain', url: 'https://example.com/' }, ctxJunta());
      assert.ok(r.propuesta, `devuelve la propuesta: ${r.texto}`);
      assert.match(r.texto, /Necesito tu confirmación/);
      assert.equal(r.propuesta!.accion, 'foto');
      assert.equal(r.propuesta!.canal, 'telegram');
      assert.deepEqual(salidas, [], 'proponer no publica nada');
      const l = await TD.leerTarea(JOSE, r.propuesta!.tarea);
      const v = (l.ok ? l.tarea!.decision?.vinculo : null) as any;
      assert.equal(v.accion, 'foto');
      assert.equal(v.args.foto, shaDe(FOTO), 'el sha256 de la imagen exacta va en los argumentos');
      assert.equal(v.huella, T.huellaTaller({ cuenta: JOSE, accion: 'foto', args: v.args, version: v.version }));
      assert.notEqual(v.huella, T.huellaTaller({ cuenta: JOSE, accion: 'foto', args: { ...v.args, foto: shaDe(Buffer.from('otra')) }, version: v.version }), 'otra imagen, otra huella');
      // Otra cuenta no la aprueba; la dueña sí, y sale una vez.
      assert.equal((await p.aprobar(r.propuesta!, MEDARDO)).status, 404);
      const a = await p.aprobar(r.propuesta!);
      assert.equal(a.status, 200, JSON.stringify(a.json).slice(0, 200));
      assert.equal(a.json.tarea.state, 'completed');
      assert.equal(salidas.length, 1);
      assert.match(salidas[0], /api\.telegram\.org\/bot\*\*\*\/sendPhoto/);
      assert.equal((await p.aprobar(r.propuesta!)).json.repetida, true);
      assert.equal(salidas.length, 1, 'repetir la aprobación no la publica otra vez');
    } finally {
      p.cerrar();
    }
  });
});

test('MEDIO-1: otra imagen bajo la misma decisión, la imagen guardada cambiada, sin cuenta, un miembro o la voz → no sale nada', async () => {
  await conAlmacen(async () => {
    const p = panel();
    try {
      salidas.length = 0;
      // El hash de los argumentos cambiado en el almacén: la huella ya no cuadra (409).
      const r1 = (await T.proponerCapturaTaller({ buf: FOTO, url: 'https://example.com/' }, ctxJunta())).propuesta!;
      const otra = Buffer.from('otra imagen cualquiera, más larga que la primera para que no coincida');
      assert.ok(await T.guardarFotoTaller(otra));
      const t1 = await TD.cambiarTarea(JOSE, r1.tarea, (reg) => ({ decision: { ...reg.decision!, vinculo: { ...(reg.decision!.vinculo as any), args: { ...(reg.decision!.vinculo as any).args, foto: shaDe(otra) } } } }));
      const a1 = await p.aprobar({ ...r1, version: t1.ok ? t1.tarea.version : 0 });
      assert.equal(a1.status, 409);
      assert.equal(a1.json.codigo, 'propuesta-cambiada');
      // Los bytes guardados cambiados (mismo nombre, otra imagen): no dan el hash aprobado y no se manda.
      const foto2 = Buffer.from(FOTO.map((b) => (b + 1) % 256));
      const r2 = (await T.proponerCapturaTaller({ buf: foto2, url: 'https://example.com/b' }, ctxJunta())).propuesta!;
      const clave = D.claveDe('taller/capturas', 'taller-capturas', shaDe(foto2));
      const leido = await D.leerDurable<any>(clave);
      assert.ok(leido.ok && leido.valor);
      assert.equal((await D.compararYGuardar(clave, { ...(leido as any).valor, b64: otra.toString('base64') }, (leido as any).etag)).ok, true);
      const a2 = await p.aprobar(r2);
      assert.notEqual(a2.json?.tarea?.state, 'completed', 'la imagen cambiada no se publica');
      assert.deepEqual(salidas, [], 'nada salió');
      for (const ctx of [ctxJunta({ cuenta: null }), ctxJunta({ proponer: async () => null }), ctxJunta({ nivelAura: 'miembro' }), ctxJunta({ soloConsulta: true })]) {
        const r = await T.proponerCapturaTaller({ buf: FOTO, url: 'https://example.com/' }, ctx);
        assert.equal(r.propuesta, undefined);
      }
      assert.deepEqual(salidas, []);
    } finally {
      p.cerrar();
    }
  });
});

/* ================================================================== el servidor de verdad: POST /api/turno */

const PORT = 7760 + Math.floor(Math.random() * 30);
const BASE = `http://127.0.0.1:${PORT}`;
const ESPIA = path.join(DIR, 'espia-canales.log');
let proc: ChildProcess | null = null;
let errores = '';
const nodo = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => res.setHeader('Content-Type', 'application/json').end(JSON.stringify({ message: { content: 'Va bien.' } })));
});
/** El ojo del nodo (el navegador que abre la página y la fotografía), de mentira: `/foto` devuelve la imagen de prueba. */
const pedidosOjo: string[] = [];
const ojo = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    pedidosOjo.push(String(req.url));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/foto' ? { imagen: FOTO.toString('base64') } : { titulo: 'Example Domain', texto: 'Example Domain. This domain is for use in documentation examples.' }));
  });
});
const SECRETO_WEBHOOK = 'secreto-webhook-de-prueba-0123';
const salidasServidor = () => (fs.existsSync(ESPIA) ? fs.readFileSync(ESPIA, 'utf8').trim().split('\n').filter(Boolean).map((x) => JSON.parse(x)) : []);

before(async () => {
  await new Promise<void>((r) => nodo.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => ojo.listen(0, '127.0.0.1', r));
  const cwd = path.join(DIR, 'servidor');
  fs.mkdirSync(cwd, { recursive: true });
  proc = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), '--import', path.join(RAIZ, 'tests/fixtures/espia-canales.mjs'), path.join(RAIZ, 'server.ts')], {
    cwd,
    env: {
      PATH: process.env.PATH || '',
      HOME: cwd,
      PORT: String(PORT),
      PLATAFORMA: 'ultron',
      TSX_TSCONFIG_PATH: path.join(RAIZ, 'tsconfig.json'),
      ULTRON_SESION_SECRETO: SECRETO,
      ULTRON_SESIONES_CERRADAS_ARCHIVO: path.join(cwd, 'cerradas.json'),
      ULTRON_PERFILES_DIR: path.join(cwd, 'perfiles'),
      ULTRON_PADRON: PADRON,
      ULTRON_NODO_URL: `http://127.0.0.1:${(nodo.address() as AddressInfo).port}`,
      ULTRON_NODO_SECRETO: 'prueba',
      ESPIA_CANALES_ARCHIVO: ESPIA,
      ULTRON_OJO_URL: `http://127.0.0.1:${(ojo.address() as AddressInfo).port}`,
      ULTRON_OJO_CLAVE: 'ojo-de-prueba',
      TELEGRAM_WEBHOOK_SECRET: SECRETO_WEBHOOK,
      ...(process.env.NODE_EXTRA_CA_CERTS ? { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS } : {}),
      ...CANALES,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  });
  proc.stderr?.on('data', (d) => (errores = (errores + d).slice(-4000)));
  let listo = false;
  for (let i = 0; i < 240 && !listo; i++) {
    try {
      listo = (await fetchReal(`${BASE}/api/health`)).ok;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  assert.ok(listo, `el servidor no levantó: ${errores}`);
});

after(() => {
  try {
    if (proc?.pid) process.kill(-proc.pid);
  } catch {
    /* ya se fue */
  }
  nodo.closeAllConnections?.();
  nodo.close();
  ojo.closeAllConnections?.();
  ojo.close();
});

test('servidor de verdad: POST /api/turno (y el stream) con las 4 frases → nada sale, vuelve la propuesta; aprobarla la hace UNA vez', { timeout: 180_000 }, async () => {
  const { emitirSesion } = await import('../server/seguridad');
  const sesion = (correo: string, nombre: string) => emitirSesion({ correo, nombre, rol: 'Junta' }).token;
  const hJose = { 'content-type': 'application/json', 'x-ultron-sesion': sesion(JOSE, 'José Prueba') };
  const hMedardo = { 'content-type': 'application/json', 'x-ultron-sesion': sesion(MEDARDO, 'Medardo Prueba') };
  const pedir = (ruta: string, cuerpo: unknown, h: Record<string, string> = hJose) => fetchReal(`${BASE}${ruta}`, { method: 'POST', headers: h, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(60_000) });
  const propuestas: any[] = [];
  for (const [i, f] of FRASES_QUE_SALEN.entries()) {
    const r = await pedir('/api/turno', { message: f, idTurno: `prueba-taller-${i}-${Date.now().toString(36)}` });
    const j: any = await r.json();
    assert.equal(r.status, 200, `«${f}»: ${JSON.stringify(j).slice(0, 200)} ${errores.slice(-400)}`);
    assert.equal(j.via, 'taller');
    assert.match(String(j.reply), /Necesito tu confirmación/, `«${f}»: ${j.reply}`);
    assert.ok(j.propuestaTaller?.tarea && j.propuestaTaller?.decision, `«${f}»: devuelve la propuesta`);
    assert.ok((j.tareas || []).some((t: any) => t.id === j.propuestaTaller.tarea && t.state === 'awaiting_approval'), 'y la enlaza como tarea que espera decisión');
    propuestas.push(j.propuestaTaller);
  }
  // El stream (la web) igual: la propuesta en el `done`, nada sale.
  const st = await pedir('/api/turno/stream', { message: 'manda por telegram que la junta es mañana a las 9', idTurno: `prueba-taller-st-${Date.now().toString(36)}` });
  const sse = await st.text();
  const done = JSON.parse((sse.match(/event: done\ndata: (.+)\n/) || [])[1] || '{}');
  assert.ok(done.propuestaTaller?.decision, `el stream devuelve la propuesta: ${sse.slice(-300)}`);
  assert.deepEqual(salidasServidor(), [], `ningún canal recibió nada antes de aprobar: ${JSON.stringify(salidasServidor())}`);

  // Otra cuenta de la junta no aprueba la de José.
  const prop = propuestas[0];
  const decidir = (p: any, h = hJose) => pedir(`/api/trabajos/${p.tarea}/decisiones`, { decisionId: p.decision, expectedVersion: p.version, opcion: 'aprobar' }, h);
  assert.equal((await decidir(prop, hMedardo)).status, 404);
  assert.equal(salidasServidor().length, 0);
  // José la aprueba: sale UNA vez.
  const a = await decidir(prop);
  const aj: any = await a.json();
  assert.equal(a.status, 200, JSON.stringify(aj).slice(0, 300));
  assert.equal(aj.tarea.state, 'completed');
  const s1 = salidasServidor();
  assert.equal(s1.length, 1, `salió una vez: ${JSON.stringify(s1)}`);
  assert.match(s1[0].url, /api\.telegram\.org\/bot\*\*\*\/sendMessage/);
  // Repetir la aprobación: no sale otra.
  const b = await decidir(prop);
  assert.equal(b.status, 200);
  assert.equal(((await b.json()) as any).repetida, true);
  assert.equal(salidasServidor().length, 1, 'la aprobación repetida no manda otra');
  // Una app de antes, mandando el mismo pedido otra vez, solo recibe otra propuesta.
  const r = await pedir('/api/turno', { message: FRASES_QUE_SALEN[0], idTurno: `prueba-taller-otra-${Date.now().toString(36)}` });
  const rj: any = await r.json();
  assert.ok(rj.propuestaTaller?.decision && rj.propuestaTaller.decision !== prop.decision, 'otra propuesta, no la aprobada');
  assert.equal(salidasServidor().length, 1, 'y nada sale sin aprobarla');
});

test('servidor de verdad (revisión 11, MEDIO-1): «haz una captura de …» desde la mesa no publica en el grupo; queda propuesta y aprobada sale UNA vez', { timeout: 180_000 }, async (t) => {
  const { emitirSesion } = await import('../server/seguridad');
  const hJose = { 'content-type': 'application/json', 'x-ultron-sesion': emitirSesion({ correo: JOSE, nombre: 'José Prueba', rol: 'Junta' }).token };
  const pedir = (ruta: string, cuerpo: unknown) => fetchReal(`${BASE}${ruta}`, { method: 'POST', headers: hJose, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(90_000) });
  const fotos = () => salidasServidor().filter((x: any) => /sendPhoto/.test(x.url));
  const antes = fotos().length;
  const r = await pedir('/api/turno', { message: 'haz una captura de https://example.com', idTurno: `prueba-captura-${Date.now().toString(36)}` });
  const j: any = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j).slice(0, 200));
  // La captura la toma el ojo después de comprobar que la página es pública (eso necesita red): sin red no hay foto que probar.
  if (!pedidosOjo.includes('/foto')) return t.skip(`sin red para abrir example.com: el ojo no llegó a fotografiar (${JSON.stringify(j.herramientas)})`);
  assert.ok((j.herramientas || []).includes('foto'), 'la página se fotografió');
  assert.equal(fotos().length, antes, `sin aprobar, ninguna foto salió al grupo: ${JSON.stringify(fotos())}`);
  const prop = j.propuestaTaller;
  assert.ok(prop?.decision, `vuelve la propuesta de la captura: ${JSON.stringify(j).slice(0, 300)}`);
  assert.equal(prop.accion, 'foto');
  assert.ok((j.tareas || []).some((x: any) => x.id === prop.tarea && x.state === 'awaiting_approval'));
  const decidir = () => pedir(`/api/trabajos/${prop.tarea}/decisiones`, { decisionId: prop.decision, expectedVersion: prop.version, opcion: 'aprobar' });
  const a = await decidir();
  const aj: any = await a.json();
  assert.equal(a.status, 200, JSON.stringify(aj).slice(0, 300));
  assert.equal(aj.tarea.state, 'completed');
  const f = fotos().slice(antes);
  assert.equal(f.length, 1, `aprobada, salió UNA foto: ${JSON.stringify(f)}`);
  assert.match(f[0].cuerpo, new RegExp(`chat_id=${CANALES.TELEGRAM_CHAT_ID}`), 'al grupo configurado de la junta');
  assert.match(f[0].cuerpo, new RegExp(`photo=sha256:${shaDe(FOTO)}`), 'la imagen exacta que se propuso');
  assert.equal(((await (await decidir()).json()) as any).repetida, true);
  assert.equal(fotos().length, antes + 1, 'repetir la aprobación no la publica otra vez');
});

test('servidor de verdad (revisión 11, MEDIO-1): pedida por Telegram, la captura se le contesta a ESE chat (no al grupo)', { timeout: 180_000 }, async (t) => {
  const antes = salidasServidor().length;
  const fotosOjo = pedidosOjo.filter((u) => u === '/foto').length;
  const r = await fetchReal(`${BASE}/api/telegram/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRETO_WEBHOOK },
    body: JSON.stringify({ update_id: 900000 + Math.floor(Math.random() * 99999), message: { message_id: 5, chat: { id: Number(TG_JOSE), type: 'private' }, from: { id: Number(TG_JOSE), first_name: 'José' }, text: 'haz una captura de https://example.com' } }),
  });
  assert.equal(r.status, 200);
  // El webhook contesta antes de correr el turno: se espera a que el bot le conteste el texto al chat.
  let nuevas: any[] = [];
  for (let i = 0; i < 360; i++) {
    nuevas = salidasServidor().slice(antes);
    if (nuevas.some((x) => /sendMessage/.test(x.url))) break;
    await new Promise((res) => setTimeout(res, 250));
  }
  const fotos = nuevas.filter((x) => /sendPhoto/.test(x.url));
  if (pedidosOjo.filter((u) => u === '/foto').length === fotosOjo) return t.skip('sin red para abrir example.com: el ojo no llegó a fotografiar');
  assert.equal(fotos.length, 1, `una foto: ${JSON.stringify(nuevas)}`);
  assert.match(fotos[0].cuerpo, new RegExp(`chat_id=${TG_JOSE}(&|$)`), 'al chat que la pidió');
  assert.doesNotMatch(fotos[0].cuerpo, new RegExp(`chat_id=${CANALES.TELEGRAM_CHAT_ID}`), 'no al grupo de la junta');
  assert.equal(nuevas.filter((x) => /sendPhoto/.test(x.url) && x.cuerpo.includes(`chat_id=${CANALES.TELEGRAM_CHAT_ID}`)).length, 0);
});
