/**
 * EN ORDEN, SIN DEJAR NADA ATRÁS (José, 5-oct): «que me salga el pop up y me pregunte… y pueda decirlo hablado… y que
 * sea más inteligente en manejar las cosas en orden, porque a veces se queda con algo que quedó atrás sin hacer».
 *
 * Las causas que se encontraron en el código (cada prueba falla con el código de antes):
 *   1. Un borrador apartado para el panel (siguió con otra cosa) se PISABA en silencio al armar otro en la misma
 *      conversación: su tarjeta decía «ya no está esperando (se resolvió en otro lado)». Ahora espera en orden.
 *   2. Con la ventana de decisión mostrando un apartado, un «sí» dicho no hacía nada («está en tu panel»).
 *   3. Con dos esperando, un «sí» puro preguntaba «¿cuál?» aunque la persona estuviera viendo una: ahora es para la que ve
 *      (su intento y su huella exactos), y nunca para otra.
 *   4. En la voz, el «sí» mandaba el mensaje pero su tarea del panel se quedaba esperando la decisión (y luego decía
 *      «no se envió nada»): ahora se cierra con lo que de verdad pasó.
 *   5. Un borrador que vencía desaparecía sin aviso: ahora se dice una vez («¿lo rehago?»).
 *   6. Terminada una cosa, lo que seguía pendiente no se volvía a mencionar: ahora se menciona una vez (lo más viejo
 *      primero) y su «sí» siguiente es para eso.
 *   7. «Editar» solo dejaba una sugerencia en el chat: ahora el texto editado es un borrador nuevo (otro intento, otra
 *      huella) que espera su propio «sí»; el de antes ya no se puede mandar.
 *
 * Caminos REALES con efectos simulados y contados. Datos sintéticos.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-en-orden-'));
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
const TD = await import('../lib/tareas-durables');
const DP = await import('../server/decision-en-pantalla');
const COLA = await import('../server/borradores-cola');
const { agregarCuenta, cuentasDe, quitarCuenta, _olvidarCuentas } = await import('../lib/correo/cuentas');
const VOCES = await import('../lib/voces-miembro');
const { MODELO_VOZ } = await import('../lib/voces-motor');
const VOZ_TEL = await import('../mobile/src/voces/voces');
type Envio = import('../lib/correo/buzon').Envio;

const JOSE = 'jose-orden@example.test';
const CLAVE_PUENTE = 'clave-del-puente-de-prueba-123';
const PROV = { nombre: 'Prueba', imap: { host: '127.0.0.1', puerto: 993, seguro: true }, smtp: { host: '127.0.0.1', puerto: 465, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: false } as any;
const sinT = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const chat = (jid: string, nombre: string, numero: string) => ({ jid, nombre, grupo: false, noLeidos: 0, hora: Date.now(), ultimo: '', ultimoMio: false, numero });
const BRUNO = chat('50477773333@s.whatsapp.net', 'Bruno', '+50477773333');
const TIGO = chat('50477770001@s.whatsapp.net', 'Tigo', '+50477770001');
const CHATS = [BRUNO, TIGO];

async function conEntorno<R>(fn: (e: { mandados: Envio[]; enviados: Array<{ chat: string; texto: string }> }) => Promise<R>): Promise<R> {
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
    listar: async () => [],
    mandar: async (_q: string, _c: unknown, e: Envio) => (mandados.push(e), { messageId: e.messageId || '<x@example.test>', guardadoEnEnviados: false, aceptados: [...e.para], rechazados: [] }),
    buscarEnviado: async () => 'no-encontrado' as const,
  };
  const antes = { u: process.env.WHATSAPP_PUENTE_URL, c: process.env.WHATSAPP_PUENTE_CLAVE, d: process.env.WHATSAPP_DUENOS };
  Object.assign(process.env, { WHATSAPP_PUENTE_URL: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, WHATSAPP_PUENTE_CLAVE: CLAVE_PUENTE, WHATSAPP_DUENOS: JOSE });
  D._usarAlmacenDurable(D.almacenEnMemoria());
  C._buzonDePrueba(buzon as any);
  C._olvidarCorreo();
  W._olvidarWhatsapp();
  DP._olvidarEnPantalla();
  T._olvidarMencionados?.();
  COLA._olvidarVencidos?.();
  _olvidarCuentas();
  for (const c of await cuentasDe(JOSE)) await quitarCuenta(JOSE, c.id);
  await agregarCuenta(JOSE, 'jose-orden@prueba.example.test', PROV, 'clave');
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
    DP._olvidarEnPantalla();
    D._usarAlmacenDurable(null);
    await new Promise<void>((r) => srv.close(() => r()));
  }
}

const turno = (mensaje: string, o: Record<string, unknown> = {}) => T.resolverDecisionesDelTurno({ dueno: JOSE, ambito: 'tel', mensaje, whatsapp: true, registrarEfecto: async () => true, ...o } as any);
const waParaBruno = (texto = 'Llego a las 5.') => W.correrWhatsapp(JOSE, `responder Bruno | ${texto}`, 'tel');
const waParaTigo = (texto = 'Mañana pago la factura.') => W.correrWhatsapp(JOSE, `responder Tigo | ${texto}`, 'tel');
const correoParaAna = (texto = 'Va el informe.') => C.correrCorreo(JOSE, `escribir ana@example.test | Informe | ${texto}`, 'tel');
const vistaDe = (canal: 'correo' | 'whatsapp', b: { intento: string; huella: string }) => ({ canal, ambito: 'tel', intento: b.intento, huella: b.huella, tareaId: 'tk_x', decisionId: 'dc_x', via: 'pantalla' as const, t: Date.now() + 1 });
const esperar = async (cond: () => Promise<boolean> | boolean, ms = 2000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
};

/* ------------------------------------------------------------------ 1. el apartado no se pisa */

test('causa 1: un apartado (WhatsApp) no se pierde al armar otro borrador a OTRO chat; su tarjeta todavía lo manda', async () => {
  await conEntorno(async ({ enviados }) => {
    await waParaBruno();
    const bruno = W.borradorWhatsappDe(JOSE, 'tel')!;
    await turno('¿qué hora es en Madrid?'); // siguió con otra cosa: apartado para el panel
    assert.equal(W.borradorWhatsappDe(JOSE, 'tel')?.soloPanel, true);
    await waParaTigo();
    assert.match(W.borradorWhatsappDe(JOSE, 'tel')!.nombre, /Tigo/, 'el nuevo espera en el lugar principal');
    const sigue = W.borradorWhatsappPorIntento(JOSE, 'tel', bruno.intento);
    assert.ok(sigue, 'el de Bruno sigue esperando (antes se pisaba en silencio)');
    assert.deepEqual(W.apartadosWhatsappDe(JOSE, 'tel').map((b) => b.nombre), ['Bruno']);
    const r = await T.resolverBorradorDesdePanel(JOSE, 'whatsapp', 'tel', bruno.intento, 'sí', bruno.huella);
    assert.equal(r.estado, 'succeeded', r.resumen);
    assert.deepEqual(enviados.map((e) => e.chat), [BRUNO.jid], 'sale el de Bruno, una vez');
    assert.match(W.borradorWhatsappDe(JOSE, 'tel')!.nombre, /Tigo/, 'el de Tigo sigue esperando su propio «sí»');
    assert.equal(W.borradorWhatsappPorIntento(JOSE, 'tel', bruno.intento), null, 'ya no espera');
  });
});

test('causa 1: lo mismo con el correo; y una aprobación con otra huella no manda el apartado', async () => {
  await conEntorno(async ({ mandados }) => {
    await correoParaAna();
    const ana = C.borradorDe(JOSE, 'tel')!;
    await turno('cuéntame un chiste');
    await C.correrCorreo(JOSE, 'escribir bruno@example.test | Otro | Esto es para Bruno.', 'tel');
    assert.deepEqual(C.apartadosCorreoDe(JOSE, 'tel').map((b) => b.para.join(',')), ['ana@example.test']);
    const mala = await T.resolverBorradorDesdePanel(JOSE, 'correo', 'tel', ana.intento, 'sí', 'otra-huella');
    assert.equal(mala.estado, 'stale');
    assert.equal(mandados.length, 0);
    const ok = await T.resolverBorradorDesdePanel(JOSE, 'correo', 'tel', ana.intento, 'sí', ana.huella);
    assert.equal(ok.estado, 'succeeded', ok.resumen);
    assert.deepEqual(mandados.map((m) => m.para), [['ana@example.test']]);
    assert.deepEqual(C.borradorDe(JOSE, 'tel')!.para, ['bruno@example.test']);
  });
});

test('causa 1: al MISMO chat, el borrador nuevo es otra versión: reemplaza al apartado (no quedan dos) y se le dice', async () => {
  await conEntorno(async () => {
    await waParaBruno('Llego a las 5.');
    await turno('¿y el clima?');
    const r = await waParaBruno('Llego a las 6.');
    assert.match(r, /REEMPLAZA al que esperaba en su panel/);
    assert.equal(W.apartadosWhatsappDe(JOSE, 'tel').length, 0, 'no queda la versión vieja esperando');
    assert.equal(W.borradorWhatsappDe(JOSE, 'tel')!.texto, 'Llego a las 6.');
  });
});

/* ------------------------------------------------------------------ 2 y 3. lo que tiene a la vista */

test('causa 2: un «sí» dicho mientras la ventana muestra el apartado lo manda; sin la ventana, no', async () => {
  await conEntorno(async ({ enviados }) => {
    await waParaBruno();
    await turno('¿qué hora es?');
    const b = W.borradorWhatsappDe(JOSE, 'tel')!;
    const sin = await turno('sí', { enPantalla: null });
    assert.equal(enviados.length, 0, 'sin ventana: como siempre, el apartado no lo resuelve el chat');
    assert.match(sin.hechos.join('\n'), /NO se mandó nada/);
    // La ventana avisa qué muestra (POST /api/trabajos/:id/en-pantalla): el registro del servidor.
    DP.fijarEnPantalla(JOSE, { canal: 'whatsapp', ambito: 'tel', intento: b.intento, huella: b.huella, tareaId: 'tk_1', decisionId: 'dc_1', via: 'pantalla' });
    const con = await turno('sí');
    assert.equal(con.respondio, true);
    assert.deepEqual(enviados.map((e) => e.chat), [BRUNO.jid], 'sale ESE, una vez');
  });
});

test('causa 2: un «no» dicho con la ventana a la vista descarta el apartado (y nada sale)', async () => {
  await conEntorno(async ({ enviados }) => {
    await waParaBruno();
    await turno('otra cosa');
    const b = W.borradorWhatsappDe(JOSE, 'tel')!;
    await turno('no', { enPantalla: vistaDe('whatsapp', b) });
    assert.equal(enviados.length, 0);
    assert.equal(W.borradorWhatsappPorIntento(JOSE, 'tel', b.intento), null, 'descartado');
  });
});

test('causa 3: correo y WhatsApp esperando: «sí» con la ventana mostrando el WhatsApp manda SOLO ese; sin ventana pregunta', async () => {
  await conEntorno(async ({ mandados, enviados }) => {
    await correoParaAna();
    await waParaBruno();
    const w = W.borradorWhatsappDe(JOSE, 'tel')!;
    const ambiguo = await turno('sí', { enPantalla: null });
    assert.equal(ambiguo.ambiguo, true, 'sin ventana: pregunta cuál (como siempre)');
    assert.equal(mandados.length + enviados.length, 0);
    // Una «vista» de otra versión (otra huella) no cuenta: pregunta.
    const vieja = await turno('sí', { enPantalla: { ...vistaDe('whatsapp', w), huella: 'otra' } });
    assert.equal(vieja.ambiguo, true);
    assert.equal(mandados.length + enviados.length, 0, 'nunca a una que no es la que ve');
    const r = await turno('sí', { enPantalla: vistaDe('whatsapp', w) });
    assert.equal(r.respondio, true);
    assert.deepEqual(enviados.map((e) => e.chat), [BRUNO.jid]);
    assert.equal(mandados.length, 0, 'el correo sigue esperando');
    assert.ok(C.borradorDe(JOSE, 'tel'), 'el correo no se tocó');
  });
});

test('causa 3: nombrar otra cosa gana a la ventana («sí, el correo» con el WhatsApp a la vista manda el correo)', async () => {
  await conEntorno(async ({ mandados, enviados }) => {
    await correoParaAna();
    await waParaBruno();
    const w = W.borradorWhatsappDe(JOSE, 'tel')!;
    await turno('sí, el correo', { enPantalla: vistaDe('whatsapp', w) });
    assert.deepEqual(mandados.map((m) => m.para), [['ana@example.test']]);
    assert.equal(enviados.length, 0);
  });
});

/* ------------------------------------------------------------------ 4. la voz cierra la tarea */

test('causa 4: en la voz, el «sí» cierra su tarea del panel con lo que de verdad pasó (antes se quedaba esperando)', async () => {
  await conEntorno(async ({ enviados }) => {
    await waParaBruno();
    const w = W.borradorWhatsappDe(JOSE, 'tel')!;
    const ref = await TR.abrirDecisionDeBorrador(JOSE, 'tel', { canal: 'whatsapp', intento: w.intento, para: W.destinoWhatsapp(w), texto: w.texto, vence: w.vence, huella: w.huella });
    assert.ok(ref);
    const hacer: Array<() => void> = [];
    const retener = { hacer: (f: () => void) => void hacer.push(f), alDescartar: () => undefined, recordar: () => undefined };
    await turno('sí', { retener });
    assert.equal(enviados.length, 0, 'en la voz el envío espera a que se confirme el turno');
    for (const f of hacer) f(); // ElevenLabs confirmó el turno
    assert.ok(await esperar(() => enviados.length === 1), 'salió');
    const cerrada = await esperar(async () => {
      const l = await TD.leerTarea(JOSE, ref!.id);
      return l.ok && l.tarea?.estado === 'completed';
    });
    assert.ok(cerrada, 'la tarea queda completada con su recibo (no esperando una decisión ya tomada)');
  });
});

test('causa 4: en la voz, el «no» cierra la tarea como rechazada al momento', async () => {
  await conEntorno(async ({ enviados }) => {
    await waParaBruno();
    const w = W.borradorWhatsappDe(JOSE, 'tel')!;
    const ref = await TR.abrirDecisionDeBorrador(JOSE, 'tel', { canal: 'whatsapp', intento: w.intento, para: W.destinoWhatsapp(w), texto: w.texto, vence: w.vence, huella: w.huella });
    await turno('no', { retener: { hacer: () => undefined, alDescartar: () => undefined } });
    assert.equal(enviados.length, 0);
    assert.ok(
      await esperar(async () => {
        const l = await TD.leerTarea(JOSE, ref!.id);
        return l.ok && l.tarea?.estado === 'cancelled';
      })
    );
  });
});

/* ------------------------------------------------------------------ 5. lo vencido se dice */

test('causa 5: un borrador que venció sin decidirse se dice UNA vez («¿lo rehago?»), no desaparece en silencio', async () => {
  await conEntorno(async ({ enviados }) => {
    await waParaBruno();
    W.borradorWhatsappDe(JOSE, 'tel')!.vence = Date.now() - 1;
    const r = await turno('hola, ¿cómo vas?');
    assert.match(r.hechos.join('\n'), /QUEDÓ ATRÁS: el borrador de WhatsApp para Bruno.*venció sin enviarse.*rehaces/s);
    const otra = await turno('¿y ahora?');
    assert.doesNotMatch(otra.hechos.join('\n'), /QUEDÓ ATRÁS/, 'una sola vez');
    assert.equal(enviados.length, 0);
  });
});

test('causa 5: también un apartado que vence esperando en orden', async () => {
  await conEntorno(async () => {
    await waParaBruno();
    await turno('otra cosa');
    await waParaTigo();
    W.apartadosWhatsappDe(JOSE, 'tel')[0].vence = Date.now() - 1;
    const r = await turno('¿qué tal?');
    assert.match(r.hechos.join('\n'), /QUEDÓ ATRÁS: el borrador de WhatsApp para Bruno/);
  });
});

/* ------------------------------------------------------------------ 6. lo que sigue, en orden */

test('causa 6: terminada una, menciona lo que sigue (lo más viejo primero) UNA vez; el «sí» lo manda solo con la ventana a la vista', async () => {
  await conEntorno(async ({ mandados, enviados }) => {
    await waParaBruno();
    await turno('¿qué hora es?'); // el de Bruno queda apartado
    await correoParaAna();
    const r = await turno('sí'); // solo el correo espera en el chat: sale
    assert.deepEqual(mandados.map((m) => m.para), [['ana@example.test']]);
    assert.match(r.hechos.join('\n'), /PENDIENTE EN ORDEN:.*WhatsApp para Bruno/s, 'menciona lo que quedó atrás');
    assert.match(r.hechos.join('\n'), /ventana de decisión/, 'dice dónde se aprueba');
    // Revisión independiente (G2): la mención es SOLO información; aunque AU-RA lo nombre, un «sí» suelto no lo manda.
    const r2 = await turno('sí', { dijoAntes: 'Listo, el correo para Ana salió. Quedó pendiente el WhatsApp para Bruno, ¿lo envío?' });
    assert.equal(enviados.length, 0, `la mención no autoriza nada: ${r2.hechos.join(' | ')}`);
    // Con la ventana mostrándolo (lo ve: a quién y el texto exacto), su «sí» sí lo manda.
    const b = W.borradorWhatsappDe(JOSE, 'tel')!;
    DP.fijarEnPantalla(JOSE, { canal: 'whatsapp', ambito: 'tel', intento: b.intento, huella: b.huella, tareaId: 'tk_b', decisionId: 'dc_b', via: 'pantalla' });
    const r3 = await turno('sí');
    assert.deepEqual(enviados.map((e) => e.chat), [BRUNO.jid], r3.hechos.join(' | '));
    assert.doesNotMatch(r3.hechos.join('\n'), /PENDIENTE EN ORDEN/, 'ya no queda nada: no insiste');
  });
});

test('G2 (revisión): «Listo, le mandé el correo a Bruno. ¿Algo más?» → «sí» NO manda el WhatsApp apartado para Bruno', async () => {
  await conEntorno(async ({ mandados, enviados }) => {
    await waParaBruno();
    await turno('¿qué hora es?');
    await C.correrCorreo(JOSE, 'escribir bruno@example.test | Hola | Te mando el informe.', 'tel');
    await turno('sí'); // sale el correo a Bruno; se menciona el WhatsApp para Bruno
    assert.equal(mandados.length, 1);
    const r = await turno('sí', { dijoAntes: 'Listo, le mandé el correo a Bruno. ¿Algo más?' });
    assert.equal(enviados.length, 0, 'nadie preguntó por el WhatsApp: no sale');
    assert.match(r.hechos.join('\n'), /NO se mandó nada/);
  });
});

test('causa 6: no insiste: lo mismo no se menciona dos veces, y un «no» va a lo único que espera en el chat (no a lo mencionado)', async () => {
  await conEntorno(async ({ mandados, enviados }) => {
    await waParaBruno();
    await turno('otra cosa');
    await correoParaAna();
    await turno('sí'); // sale el correo y menciona el de Bruno
    const bruno = W.borradorWhatsappDe(JOSE, 'tel')!;
    await C.correrCorreo(JOSE, 'escribir carla@example.test | Hola | Nos vemos.', 'tel');
    const r = await turno('no');
    assert.ok(W.borradorWhatsappPorIntento(JOSE, 'tel', bruno.intento), 'el de Bruno sigue esperando');
    assert.equal(C.borradorDe(JOSE, 'tel'), null, 'el «no» fue para el de Carla (el único que esperaba en el chat)');
    assert.doesNotMatch(r.hechos.join('\n'), /PENDIENTE EN ORDEN/, 'no insiste con lo ya mencionado');
    assert.equal(mandados.length, 1);
    assert.equal(enviados.length, 0);
  });
});

test('MENOR 4 (revisión 7.5): un turno de voz descartado no gasta la mención de lo pendiente; uno confirmado sí', async () => {
  await conEntorno(async ({ mandados }) => {
    await waParaBruno();
    await turno('otra cosa'); // el de Bruno queda apartado
    await correoParaAna();
    const voz = () => {
      const hacer: Array<() => void> = [];
      const descartes: Array<() => void> = [];
      return { hacer, descartes, retener: { hacer: (f: () => void) => void hacer.push(f), alDescartar: (f: () => void) => void descartes.push(f), recordar: () => undefined } };
    };
    // La frase seguía: el turno especulativo se descarta (nada sale y la mención no se oyó).
    const a = voz();
    const r1 = await turno('sí', { retener: a.retener });
    assert.match(r1.hechos.join('\n'), /PENDIENTE EN ORDEN:.*WhatsApp para Bruno/s);
    for (const f of a.descartes) f();
    assert.equal(mandados.length, 0);
    // La frase entera: se vuelve a mencionar (antes ya estaba «dicha» y no se decía nunca).
    const b = voz();
    const r2 = await turno('sí', { retener: b.retener });
    assert.match(r2.hechos.join('\n'), /PENDIENTE EN ORDEN:.*WhatsApp para Bruno/s, 'el descartado no gastó la mención');
    for (const f of b.hacer) f();
    assert.ok(await esperar(() => mandados.length === 1), 'confirmado, sale el correo');
    // Confirmado: ya no se insiste.
    await correoParaAna('Otra versión.');
    const r3 = await turno('sí');
    assert.doesNotMatch(r3.hechos.join('\n'), /PENDIENTE EN ORDEN/, 'la mención confirmada sí se gastó');
  });
});

/* ------------------------------------------------------------------ revisión independiente */

test('G1 (revisión): con un apartado a la vista y una pregunta NUEVA de la app (recordatorio), un «sí» no manda el de la ventana: pregunta cuál', async () => {
  await conEntorno(async ({ enviados }) => {
    await waParaBruno();
    await turno('otra cosa');
    const b = W.borradorWhatsappDe(JOSE, 'tel')!;
    const vista = vistaDe('whatsapp', b);
    const app = { que: 'recordatorio', para: 'tomar la pastilla a las 8', huella: 'h-rec' };
    const si = await turno('sí', { enPantalla: vista, app, appEspera: true });
    assert.equal(enviados.length, 0, 'el «sí» pudo ser para el recordatorio que AU-RA acaba de proponer');
    assert.equal(si.ambiguo, true);
    assert.equal(si.appBloqueada, true, 'tampoco sale el recordatorio sin decir cuál');
    const no = await turno('no', { enPantalla: vista, app, appEspera: true });
    assert.equal(no.ambiguo, true);
    assert.ok(W.borradorWhatsappPorIntento(JOSE, 'tel', b.intento), 'un «no» tampoco descarta el de la ventana');
  });
});

test('G1 (revisión): una pregunta de su computadora es más nueva que lo que se ve (conLaVista no elige la ventana)', () => {
  const analisis = { pura: true, negativaPura: false, niega: false } as any;
  const ventana = { origen: 'whatsapp', tipo: 'whatsapp', aVista: true, creado: 1000, id: 'w' } as any;
  const compu = { origen: 'computadora', tipo: 'computadora', texto: '¿Confirmo el pago?', id: 't1' } as any;
  const d = T.conLaVista({ tipo: 'preguntar', motivo: 'ambiguo', candidatos: [ventana, compu], negativa: false, analisis }, { t: 5000 });
  assert.equal(d.tipo, 'preguntar');
  const dNo = T.conLaVista({ tipo: 'preguntar', motivo: 'ambiguo', candidatos: [ventana, compu], negativa: true, analisis: { ...analisis, pura: false, negativaPura: true, niega: true } }, { t: 5000 });
  assert.equal(dNo.tipo, 'preguntar');
  // Solo borradores, la ventana más nueva: sí elige la de la ventana.
  const otro = { origen: 'correo', tipo: 'correo', creado: 500, id: 'c' } as any;
  assert.equal(T.conLaVista({ tipo: 'preguntar', motivo: 'ambiguo', candidatos: [ventana, otro], negativa: false, analisis }, { t: 5000 }).tipo, 'ejecutar');
});

test('G3 (revisión): reescribir el mensaje para la MISMA persona reemplaza también la versión que esperaba entre los apartados (no salen dos)', async () => {
  await conEntorno(async ({ enviados }) => {
    await waParaBruno('Llego a las 5.');
    const v1 = W.borradorWhatsappDe(JOSE, 'tel')!;
    await turno('otra cosa');
    await waParaTigo(); // Bruno v1 pasa a los apartados
    await turno('otra cosa más'); // Tigo también se aparta
    const r = await waParaBruno('Llego a las 6.'); // versión nueva para Bruno
    assert.match(r, /REEMPLAZA/);
    const brunos = [W.borradorWhatsappDe(JOSE, 'tel'), ...W.apartadosWhatsappDe(JOSE, 'tel')].filter((x) => x && x.chat === BRUNO.jid);
    assert.deepEqual(brunos.map((x) => x!.texto), ['Llego a las 6.'], 'una sola versión para Bruno');
    const vieja = await T.resolverBorradorDesdePanel(JOSE, 'whatsapp', 'tel', v1.intento, 'sí', v1.huella);
    assert.equal(vieja.estado, 'stale', 'la versión vieja ya no se puede mandar');
    assert.equal(enviados.length, 0);
  });
});

test('G3 (revisión): lo mismo con el correo (mismos destinatarios en otro orden)', async () => {
  await conEntorno(async ({ mandados }) => {
    await C.correrCorreo(JOSE, 'escribir ana@example.test, bruno@example.test | Junta | Versión 1.', 'tel');
    const v1 = C.borradorDe(JOSE, 'tel')!;
    await turno('otra cosa');
    await C.correrCorreo(JOSE, 'escribir carla@example.test | Otro | Para Carla.', 'tel');
    await turno('otra cosa más');
    await C.correrCorreo(JOSE, 'escribir bruno@example.test, ana@example.test | Junta | Versión 2.', 'tel');
    const juntas = [C.borradorDe(JOSE, 'tel'), ...C.apartadosCorreoDe(JOSE, 'tel')].filter((x) => x && x.asunto === 'Junta');
    assert.deepEqual(juntas.map((x) => x!.texto), ['Versión 2.']);
    assert.equal((await T.resolverBorradorDesdePanel(JOSE, 'correo', 'tel', v1.intento, 'sí', v1.huella)).estado, 'stale');
    assert.equal(mandados.length, 0);
  });
});

test('M2 (revisión): un turno de voz que se descarta deshace el cambio de lugar del apartado a la vista (el otro sigue esperando en el chat)', async () => {
  await conEntorno(async ({ enviados }) => {
    await waParaBruno();
    await turno('otra cosa');
    await waParaTigo(); // Bruno → apartados; Tigo en el lugar principal, esperando en el chat
    const bruno = W.apartadosWhatsappDe(JOSE, 'tel')[0];
    const tigo = W.borradorWhatsappDe(JOSE, 'tel')!;
    const descartes: Array<() => void> = [];
    const hacer: Array<() => void> = [];
    await turno('sí, el de Bruno', { enPantalla: vistaDe('whatsapp', bruno), retener: { hacer: (f: () => void) => void hacer.push(f), alDescartar: (f: () => void) => void descartes.push(f), recordar: () => undefined } });
    // La frase seguía: el turno se descarta.
    for (const f of descartes) f();
    assert.equal(enviados.length, 0);
    const principal = W.borradorWhatsappDe(JOSE, 'tel');
    assert.equal(principal?.intento, tigo.intento, 'Tigo vuelve al lugar principal');
    assert.ok(!principal?.soloPanel, 'y sigue esperando en el chat');
    assert.deepEqual(W.apartadosWhatsappDe(JOSE, 'tel').map((x) => x.intento), [bruno.intento], 'Bruno vuelve a su lugar en la fila');
  });
});

test('MENOR c (revisión): si la voz dice que quien habla NO es el dueño, su «sí» no manda nada (ni su «no» descarta): pide el sí del dueño', async () => {
  await conEntorno(async ({ enviados }) => {
    await waParaBruno();
    const r = await turno('sí', { escena: 'Por la voz, habla Ana (tu esposa), no José. Hay una persona frente a la cámara.' });
    assert.equal(enviados.length, 0);
    assert.match(r.hechos.join('\n'), /quien habla es Ana, no José \(la persona dueña de la cuenta\)\. NO hice nada/);
    assert.ok(W.borradorWhatsappDe(JOSE, 'tel'), 'el borrador sigue esperando');
    await turno('no', { escena: 'Por la voz, habla Ana (tu esposa), no José.' });
    assert.ok(W.borradorWhatsappDe(JOSE, 'tel') && !W.borradorWhatsappDe(JOSE, 'tel')!.soloPanel, 'ni se descarta ni se aparta');
    // El dueño (sin esa escena) sí lo manda.
    await turno('sí');
    assert.equal(enviados.length, 1);
  });
});
/**
 * Revisión 7.5 (M1′): un «sí» o un «no» corto (< 1,5 s: el servidor no saca quién habla) no traía nada, y el «sí» de Ana
 * mandaba el borrador de José. De punta a punta por el campo de verdad: el identificador del teléfono, el campo tal como
 * viaja en el cuerpo del turno (campoQuienHabla, JSON) y la decisión del servidor, que lo valida (app, voz guardada de
 * ESA cuenta, que no es la dueña). Solo frena: nunca da permiso.
 */
async function vozDeAna() {
  const v = (k: number) => Array.from({ length: MODELO_VOZ.dim }, (_, i) => (i === k ? 1 : 0.01));
  const ana = await VOCES.agregarVoz(JOSE, { ok: true, nombre: 'Ana', relacion: 'conocido', parentesco: 'esposa', consentimiento: { como: 'voz', frase: 'sí', t: 1 } }, [v(3)]);
  const yo = await VOCES.agregarVoz(JOSE, { ok: true, nombre: 'José', relacion: 'yo', consentimiento: { como: 'dueño', t: 1 } }, [v(9)]);
  return { ana: { id: ana.id, nombre: 'Ana', relacion: 'conocido' as const, parentesco: 'esposa' }, yo: { id: yo.id, nombre: 'José', relacion: 'yo' as const } };
}

/** El teléfono: frases con lo que contesta el servidor de voces; devuelve el cuerpo del turno de la última. */
async function telefono(frases: Array<{ quien: any; motivo?: string; ms?: number }>) {
  const resp = new Map<string, { quien: any; motivo?: string; ms?: number }>();
  const id = new VOZ_TEL.IdentificadorVoz(async (trozos) => {
    const r = resp.get(trozos[0])!;
    await new Promise((x) => setTimeout(x, r.ms ?? 2));
    return { persona: r.quien, motivo: r.motivo || (r.quien ? 'reconocida' : 'nadie_cerca') };
  });
  let oida = 0;
  for (const [i, f] of frases.entries()) {
    resp.set(`f${i}`, f);
    id.oir(i + 1, [`f${i}`]);
    oida = Date.now();
    id.entregada(i + 1, oida);
    if (i < frases.length - 1) await id.paraTurno(oida);
  }
  const voz = await VOZ_TEL.quienHablaDelTurno(id, oida, 'José');
  const q = VOZ_TEL.campoQuienHabla(voz.quienHabla);
  // Lo que llega al servidor: el cuerpo en JSON, con la sesión y el origen que pone el servidor.
  return { escena: voz.frase, ...JSON.parse(JSON.stringify(q ? { quienHabla: q } : {})), origen: 'app', sesion: { correo: JOSE, nombre: 'José' } };
}

test('M1′ (revisión 7.5): Ana habló y su «sí» corto (sin dato de voz) no manda el borrador de José ni su «no» lo descarta', async () => {
  await conEntorno(async ({ enviados }) => {
    VOCES._olvidarCacheVoces();
    const { ana, yo } = await vozDeAna();
    await waParaBruno();
    // Ana dice algo largo (se la reconoce) y enseguida «sí» (muy corto: el servidor no sabe quién).
    const cuerpo = await telefono([{ quien: ana }, { quien: ana, motivo: 'muy_corta' }]);
    assert.deepEqual(cuerpo.quienHabla, { id: ana.id, reciente: true });
    const r = await turno('sí', cuerpo);
    assert.equal(enviados.length, 0, `antes salía: ${r.hechos.join(' | ')}`);
    assert.equal(r.ambiguo, true);
    assert.match(r.hechos.join('\n'), /NO hice nada/);
    assert.match(r.hechos.join('\n'), /Ana/);
    assert.match(r.hechos.join('\n'), /lo confirma José/);
    // La consulta tardó más que lo que espera el turno: igual (lo de antes quedaba abierto).
    const lento = await telefono([{ quien: ana }, { quien: ana, ms: VOZ_TEL.ESPERA_VOZ_TURNO_MS + 200 }]);
    await turno('no', lento);
    assert.ok(W.borradorWhatsappDe(JOSE, 'tel') && !W.borradorWhatsappDe(JOSE, 'tel')!.soloPanel, 'ni se descarta ni se aparta');
    // José habló después de Ana: su «sí» corto manda (la precaución nunca frena a la dueña reconocida después).
    const deJose = await telefono([{ quien: ana }, { quien: yo }, { quien: null, motivo: 'muy_corta' }]);
    assert.equal(deJose.quienHabla, undefined);
    await turno('sí', deJose);
    assert.equal(enviados.length, 1);
  });
});

test('M1′ (revisión 7.5): el campo solo vale desde la app, con una voz guardada de ESA cuenta que no sea la dueña', async () => {
  await conEntorno(async ({ enviados }) => {
    VOCES._olvidarCacheVoces();
    const { ana, yo } = await vozDeAna();
    const sesion = { correo: JOSE, nombre: 'José' };
    await waParaBruno();
    // También el campo de una frase reconocida (sin escena): frena igual que la escena.
    assert.equal((await turno('sí', { quienHabla: { id: ana.id }, origen: 'app', sesion })).ambiguo, true);
    assert.equal(enviados.length, 0);
    // Lo que no es válido no frena (y tampoco da permiso de nada: el «sí» de la dueña sale como siempre).
    await turno('sí', { quienHabla: { id: yo.id, reciente: true }, origen: 'app', sesion });
    assert.equal(enviados.length, 1, 'la voz de la dueña no frena');
    await waParaBruno('Otra cosa.');
    await turno('sí', { quienHabla: { id: ana.id, reciente: true }, origen: 'web', sesion });
    assert.equal(enviados.length, 2, 'fuera de la app el campo no vale');
    await waParaBruno('Y otra.');
    await turno('sí', { quienHabla: { id: ana.id, reciente: true }, origen: 'app', sesion: { correo: 'otra@example.test', nombre: 'Otra' } });
    assert.equal(enviados.length, 3, 'una voz de otra cuenta no vale');
  });
});

/* ------------------------------------------------------------------ 7. editar */

test('causa 7: editar deja un borrador NUEVO (otro intento y huella) con el texto editado; el viejo ya no se manda', async () => {
  await conEntorno(async ({ enviados }) => {
    await waParaBruno('Llego a las 5.');
    const v1 = W.borradorWhatsappDe(JOSE, 'tel')!;
    assert.equal(W.editarBorradorWhatsapp(JOSE, 'tel', v1.intento, 'huella-vieja', { texto: 'x' }).ok, false, 'otra huella no edita');
    const vacio = W.editarBorradorWhatsapp(JOSE, 'tel', v1.intento, v1.huella, { texto: '   ' });
    assert.equal(vacio.ok === false && vacio.codigo, 'vacio');
    const e = W.editarBorradorWhatsapp(JOSE, 'tel', v1.intento, v1.huella, { texto: 'Llego a las 6, perdón.' });
    assert.ok(e.ok);
    if (!e.ok) return;
    assert.notEqual(e.borrador.intento, v1.intento);
    assert.notEqual(e.borrador.huella, v1.huella);
    assert.equal(e.borrador.chat, v1.chat, 'el chat no cambia');
    const vieja = await T.resolverBorradorDesdePanel(JOSE, 'whatsapp', 'tel', v1.intento, 'sí', v1.huella);
    assert.equal(vieja.estado, 'stale', 'la aprobación del texto viejo no manda nada');
    assert.equal(enviados.length, 0);
    const ok = await T.resolverBorradorDesdePanel(JOSE, 'whatsapp', 'tel', e.borrador.intento, 'sí', e.borrador.huella);
    assert.equal(ok.estado, 'succeeded', ok.resumen);
    assert.deepEqual(enviados, [{ chat: BRUNO.jid, texto: 'Llego a las 6, perdón.' }], 'sale el texto editado, tal cual');
  });
});

test('causa 7: editar un correo (texto y asunto) y un apartado en su sitio', async () => {
  await conEntorno(async ({ mandados }) => {
    await correoParaAna();
    await turno('otra cosa');
    await C.correrCorreo(JOSE, 'escribir bruno@example.test | Otro | Para Bruno.', 'tel');
    const ana = C.apartadosCorreoDe(JOSE, 'tel')[0];
    const e = C.editarBorradorCorreo(JOSE, 'tel', ana.intento, ana.huella, { texto: 'Te mando el informe corregido.', asunto: 'Informe v2' });
    assert.ok(e.ok);
    if (!e.ok) return;
    assert.deepEqual(C.apartadosCorreoDe(JOSE, 'tel').map((b) => b.intento), [e.borrador.intento], 'sigue en su lugar de la fila');
    const ok = await T.resolverBorradorDesdePanel(JOSE, 'correo', 'tel', e.borrador.intento, 'sí', e.borrador.huella);
    assert.equal(ok.estado, 'succeeded', ok.resumen);
    assert.equal(mandados[0].asunto, 'Informe v2');
    assert.match(String(mandados[0].texto), /informe corregido/);
  });
});
