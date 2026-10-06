/**
 * Revisión del 6-oct (bloqueante 1): «Un "sí" hablado puede aprobar un borrador editado que no coincide con el mostrado,
 * o seleccionar otro si se pierde el registro de la ventana.» Regla del dueño: «Ningún envío si la aprobación no coincide
 * exactamente con lo mostrado».
 *
 * Ahora un «sí» HABLADO manda un correo o un WhatsApp solo si está atado a la huella exacta que ese aparato muestra (el
 * campo `decisionVista` del teléfono o el registro de la ventana de ESE aparato): server/decision-hablada.ts. Caminos
 * REALES (borradores de server/whatsapp.ts y server/correo.ts, rutas de server/trabajos.ts, la regla única) con los
 * envíos simulados y contados. Datos sintéticos.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-hablada-'));
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

const JOSE = 'jose-hablada@example.test';
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
  await agregarCuenta(JOSE, 'jose-hablada@prueba.example.test', PROV, 'clave');
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

/** Un turno del chat (escrito). */
const escrito = (mensaje: string, o: Record<string, unknown> = {}) => T.resolverDecisionesDelTurno({ dueno: JOSE, ambito: 'tel', mensaje, whatsapp: true, registrarEfecto: async () => true, ...o } as any);
/** Un turno HABLADO desde el teléfono de José (como lo arma server.ts: `hablado`, `aparato` y, si vino, `decisionVista`). */
const hablado = (mensaje: string, o: Record<string, unknown> = {}) => escrito(mensaje, { hablado: true, aparato: APARATO, ...o });
const waPara = (quien: 'Bruno' | 'Tigo', texto: string) => W.correrWhatsapp(JOSE, `responder ${quien} | ${texto}`, 'tel');
/** La tarjeta (tarea durable con su decisión) de un borrador de WhatsApp, como la abre server.ts. */
async function tarjeta(w: { intento: string; huella: string; texto: string; vence: number } & Parameters<typeof W.destinoWhatsapp>[0]) {
  const ref = await TR.abrirDecisionDeBorrador(JOSE, 'tel', { canal: 'whatsapp', intento: w.intento, para: W.destinoWhatsapp(w), texto: w.texto, vence: w.vence, huella: w.huella });
  assert.ok(ref);
  return ref!;
}
const tareaDe = async (e: Entorno, id: string) => (await e.pedir(`/api/trabajos/${id}`)).json.tarea;
/** Lo que manda el teléfono con la frase mientras la ventana muestra esa tarea (mobile/src/lib/decisionVista.ts). */
const campoDe = (t: any) => ({ tareaId: t.id, decisionId: t.decisionId, huella: t.decision?.fingerprint });
const esperar = async (cond: () => boolean, ms = 2000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
};

test('editar y decir «sí» antes de que la ventana vuelva a dibujarse: no sale el texto editado; solo la huella NUEVA, ya mostrada, se aprueba', async () => {
  await conEntorno(async (e) => {
    await waPara('Bruno', 'Llego a las 5.');
    const v1 = W.borradorWhatsappDe(JOSE, 'tel')!;
    const ref = await tarjeta(v1);
    const t1 = await tareaDe(e, ref.id);
    // La ventana la muestra (y lo avisa) y la persona edita el texto.
    assert.equal((await e.pedir(`/api/trabajos/${ref.id}/en-pantalla`, { decisionId: t1.decisionId, visible: true, seq: 1 })).json.registrada, true);
    const ed = await e.pedir(`/api/trabajos/${ref.id}/editar`, { decisionId: t1.decisionId, expectedVersion: t1.version, texto: 'Llego a las 7, perdón.' });
    assert.equal(ed.status, 200, JSON.stringify(ed.json));
    const v2 = W.borradorWhatsappDe(JOSE, 'tel')!;
    assert.notEqual(v2.huella, v1.huella);

    // «sí» hablado ANTES de que la ventana muestre la versión nueva: sin campo (una app de antes, la conversación de voz)…
    const a = await hablado('sí');
    assert.equal(e.enviados.length, 0, `el texto editado (que no se mostró) no sale: ${a.hechos.join(' | ')}`);
    assert.match(a.hechos.join('\n'), /NO se mandó nada/);
    assert.equal(t1.decision.fingerprint, v1.huella, 'la tarjeta trae la huella de lo que muestra (lo que el teléfono manda con la frase)');
    // …y con el campo de lo que la ventana TODAVÍA muestra (la huella vieja): tampoco.
    const b = await hablado('sí, mándalo', { decisionVista: campoDe(t1) });
    assert.equal(e.enviados.length, 0, 'la huella vieja nunca aprueba');
    assert.match(b.hechos.join('\n'), /ya no es lo que espera/);

    // La ventana vuelve a dibujarse con la versión nueva (otra decisión, la huella nueva) y lo avisa: ese «sí» sí la manda.
    const t2 = await tareaDe(e, ref.id);
    assert.equal(t2.decision.fingerprint, v2.huella);
    assert.equal((await e.pedir(`/api/trabajos/${ref.id}/en-pantalla`, { decisionId: t2.decisionId, visible: true, seq: 2 })).json.registrada, true);
    const c = await hablado('sí', { decisionVista: campoDe(t2) });
    assert.equal(c.respondio, true, c.hechos.join(' | '));
    assert.deepEqual(e.enviados, [{ chat: BRUNO.jid, texto: 'Llego a las 7, perdón.' }], 'sale lo que se mostró, una vez');
  });
});

test('editar: la vieja tampoco vale si el registro de la ventana se queda con ella (el «sí» hablado no elige la única que queda)', async () => {
  await conEntorno(async (e) => {
    await waPara('Bruno', 'Llego a las 5.');
    const v1 = W.borradorWhatsappDe(JOSE, 'tel')!;
    // El registro dice v1 (la ventana lo mostró) y el borrador se edita por otro lado (otro aparato, el panel).
    DP.fijarEnPantalla(JOSE, { canal: 'whatsapp', ambito: 'tel', intento: v1.intento, huella: v1.huella, tareaId: 'tk_x', decisionId: 'dc_x', via: 'pantalla', aparato: APARATO } as any);
    const r = W.editarBorradorWhatsapp(JOSE, 'tel', v1.intento, v1.huella, { texto: 'Mejor a las 8.' });
    assert.ok(r.ok);
    await hablado('sí');
    assert.equal(e.enviados.length, 0, 'lo que espera no es lo que la ventana mostraba: no sale');
    // SEC-01 (residual escrito): escrito tampoco manda la versión editada que nunca se presentó; se la vuelve a presentar
    // (con su texto exacto) y se pregunta. El «sí» escrito siguiente, a ESA versión ya presentada, sale una vez.
    const r1 = await escrito('sí');
    assert.equal(e.enviados.length, 0, `la versión editada no se presentó: ${r1.hechos.join(' | ')}`);
    assert.match(r1.hechos.join('\n'), /NO se mandó nada[\s\S]*Mejor a las 8\./);
    await escrito('sí');
    assert.deepEqual(e.enviados.map((x) => x.texto), ['Mejor a las 8.'], 'presentada, sale exactamente esa, una vez');
  });
});

test('registro de la ventana perdido (reinicio o caducidad) con 2 esperando: el «sí» hablado nunca elige el otro; pregunta y no manda nada', async () => {
  await conEntorno(async (e) => {
    await waPara('Bruno', 'Llego a las 5.');
    await escrito('¿qué hora es?'); // el de Bruno queda apartado (lo que la ventana muestra)
    await waPara('Tigo', 'Mañana pago la factura.'); // el de Tigo espera en el chat
    const bruno = W.apartadosWhatsappDe(JOSE, 'tel')[0];
    const ref = await tarjeta(bruno);
    const t = await tareaDe(e, ref.id);
    assert.equal((await e.pedir(`/api/trabajos/${ref.id}/en-pantalla`, { decisionId: t.decisionId, visible: true, seq: 1 })).json.registrada, true);

    // El servidor se reinicia: el registro (en memoria) se pierde. La persona sigue viendo el de Bruno y dice «sí».
    DP._olvidarEnPantalla();
    const r1 = await hablado('sí');
    assert.equal(e.enviados.length, 0, `nunca el de Tigo (que no se ve): ${r1.hechos.join(' | ')}`);
    assert.match(r1.hechos.join('\n'), /NO se mandó nada|NO hice ninguna/);
    // Con el campo del teléfono (Bruno) y sin registro que diga desde cuándo se ve, con 2 esperando: pregunta cuál.
    const r2 = await hablado('sí', { decisionVista: campoDe(t) });
    assert.equal(r2.ambiguo, true);
    assert.equal(e.enviados.length, 0);

    // Caducado (la ventana dejó de renovar hace más de EN_PANTALLA_VIVE_MS): lo mismo.
    DP.fijarEnPantalla(JOSE, { canal: 'whatsapp', ambito: 'tel', intento: bruno.intento, huella: bruno.huella, tareaId: ref.id, decisionId: t.decisionId, via: 'pantalla', aparato: APARATO } as any, Date.now() - DP.EN_PANTALLA_VIVE_MS - 1000);
    await hablado('sí');
    assert.equal(e.enviados.length, 0, 'registro caducado: nada');

    // La ventana vuelve a avisar (registro vigente de ESTE aparato) y el teléfono manda el campo: sale SOLO el de Bruno.
    assert.equal((await e.pedir(`/api/trabajos/${ref.id}/en-pantalla`, { decisionId: t.decisionId, visible: true, seq: 2 })).json.registrada, true);
    const r3 = await hablado('sí', { decisionVista: campoDe(t) });
    assert.equal(r3.respondio, true, r3.hechos.join(' | '));
    assert.deepEqual(e.enviados.map((x) => x.chat), [BRUNO.jid], 'el que se ve, y solo ese');
    assert.ok(W.borradorWhatsappDe(JOSE, 'tel') || W.apartadosWhatsappDe(JOSE, 'tel').length, 'el de Tigo sigue esperando');
  });
});

test('aviso con seq vieja (la «oculta» llegó antes que la «visible») y registro de OTRO aparato: el «sí» hablado no manda nada', async () => {
  await conEntorno(async (e) => {
    await waPara('Bruno', 'Llego a las 5.');
    const w = W.borradorWhatsappDe(JOSE, 'tel')!;
    const ref = await tarjeta(w);
    const t = await tareaDe(e, ref.id);
    // Cerró la ventana (seq 5) y el aviso de abrirla de antes (seq 4) llega tarde: no cuenta.
    await e.pedir(`/api/trabajos/${ref.id}/en-pantalla`, { decisionId: t.decisionId, visible: false, seq: 5 });
    const tarde = await e.pedir(`/api/trabajos/${ref.id}/en-pantalla`, { decisionId: t.decisionId, visible: true, seq: 4 });
    assert.equal(tarde.json.vieja, true);
    const r = await hablado('sí');
    assert.equal(e.enviados.length, 0, `la ventana está cerrada: un «sí» dicho no manda (antes, el único que esperaba salía): ${r.hechos.join(' | ')}`);
    // La ventana abierta en OTRO teléfono de la misma cuenta no ata lo que se dice en éste.
    assert.equal((await e.pedir(`/api/trabajos/${ref.id}/en-pantalla`, { decisionId: t.decisionId, visible: true, seq: 1 }, { 'x-aura-aparato': 'otro-telefono' })).json.registrada, true);
    await hablado('sí');
    assert.equal(e.enviados.length, 0, 'registro de otro aparato: nada');
    // Desde ese otro teléfono (el que la muestra), sí.
    await hablado('sí', { aparato: 'otro-telefono' });
    assert.deepEqual(e.enviados.map((x) => x.chat), [BRUNO.jid]);
  });
});

test('turno de voz retenido: atado, sale solo al confirmarse y nada si se descarta; sin atar, nada aunque se confirme', async () => {
  await conEntorno(async (e) => {
    const voz = () => {
      const hacer: Array<() => void> = [];
      const descartes: Array<() => void> = [];
      return { hacer, descartes, retener: { hacer: (f: () => void) => void hacer.push(f), alDescartar: (f: () => void) => void descartes.push(f), recordar: () => undefined } };
    };
    await waPara('Bruno', 'Llego a las 5.');
    const w = W.borradorWhatsappDe(JOSE, 'tel')!;
    // Sin atar (la conversación de voz no trae campo y no hay ventana registrada): nada, ni al confirmarse.
    const sinAtar = voz();
    const r0 = await escrito('sí', { retener: sinAtar.retener });
    for (const f of sinAtar.hacer) f();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(e.enviados.length, 0, `sin atar no sale: ${r0.hechos.join(' | ')}`);
    assert.ok(W.borradorWhatsappDe(JOSE, 'tel'), 'y sigue esperando');
    // Con la ventana de ESTE aparato registrada: el turno especulativo que se descarta no manda nada.
    const ref = await tarjeta(w);
    const t = await tareaDe(e, ref.id);
    assert.equal((await e.pedir(`/api/trabajos/${ref.id}/en-pantalla`, { decisionId: t.decisionId, visible: true, seq: 1 })).json.registrada, true);
    const a = voz();
    await escrito('sí', { retener: a.retener, aparato: APARATO });
    assert.equal(e.enviados.length, 0, 'retenido');
    for (const f of a.descartes) f();
    assert.equal(e.enviados.length, 0, 'descartado: nada');
    assert.ok(W.borradorWhatsappDe(JOSE, 'tel'), 'el borrador vuelve a esperar');
    // La frase entera, confirmada: sale una vez.
    const b = voz();
    await escrito('sí', { retener: b.retener, aparato: APARATO });
    for (const f of b.hacer) f();
    assert.ok(await esperar(() => e.enviados.length === 1), 'confirmado: sale');
    assert.deepEqual(e.enviados.map((x) => x.chat), [BRUNO.jid]);
  });
});

test('el toque en la ventana o el panel (POST decisiones «aprobar») no cambia: manda lo aprobado sin registro ni voz', async () => {
  await conEntorno(async (e) => {
    await waPara('Bruno', 'Llego a las 5.');
    const w = W.borradorWhatsappDe(JOSE, 'tel')!;
    const ref = await tarjeta(w);
    const t = await tareaDe(e, ref.id);
    const r = await e.pedir(`/api/trabajos/${ref.id}/decisiones`, { decisionId: t.decisionId, expectedVersion: t.version, opcion: 'aprobar' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(e.enviados.map((x) => x.chat), [BRUNO.jid]);
  });
});

test('el campo `decisionVista` solo ata: con otra forma se ignora, y nunca manda algo que no espera', async () => {
  await conEntorno(async (e) => {
    await waPara('Bruno', 'Llego a las 5.');
    for (const raro of [{ huella: 'x' }, 'texto', { tareaId: 'a', decisionId: 'b', huella: '<script>' }, { tareaId: 'a', decisionId: 'b', huella: 'f'.repeat(64) }]) {
      await hablado('sí', { decisionVista: raro });
      assert.equal(e.enviados.length, 0, JSON.stringify(raro));
    }
  });
});

test('revisión 7 (MENOR): un registro de la ventana guardado SIN la cabecera del aparato no ata un «sí» hablado de ningún aparato', async () => {
  await conEntorno(async (e) => {
    await waPara('Bruno', 'Llego a las 5.');
    const w = W.borradorWhatsappDe(JOSE, 'tel')!;
    const ref = await tarjeta(w);
    const t = await tareaDe(e, ref.id);
    // La ventana avisa sin `x-aura-aparato` (una app vieja, la web): queda un registro sin aparato.
    assert.equal((await e.pedir(`/api/trabajos/${ref.id}/en-pantalla`, { decisionId: t.decisionId, visible: true }, { 'x-aura-aparato': '' })).json.registrada, true);
    const r1 = await hablado('sí');
    assert.equal(e.enviados.length, 0, `un «sí» dicho en este teléfono no queda atado a un registro sin aparato: ${r1.hechos.join(' | ')}`);
    await hablado('sí', { aparato: 'otro-telefono' });
    assert.equal(e.enviados.length, 0, 'ni en otro teléfono');
    await hablado('sí', { aparato: undefined });
    assert.equal(e.enviados.length, 0, 'ni en un turno sin la cabecera del aparato');
    // El registro de ESTE aparato (con su cabecera) sí ata.
    assert.equal((await e.pedir(`/api/trabajos/${ref.id}/en-pantalla`, { decisionId: t.decisionId, visible: true, seq: 1 })).json.registrada, true);
    const r2 = await hablado('sí');
    assert.equal(r2.respondio, true, r2.hechos.join(' | '));
    assert.deepEqual(e.enviados.map((x) => x.chat), [BRUNO.jid]);
  });
});
