/**
 * «Una aprobación para Ana nunca permite una acción dirigida a Bruno» (revisión externa, 4-oct).
 *
 * Cada camino de aprobación de un correo o un WhatsApp que AURA deja como borrador queda atado al destino EXACTO
 * (destinatario o chat + contenido + cuenta) y se vuelve a mirar justo antes del efecto:
 *
 *  · el «sí» del chat: si en el mismo turno el borrador se reemplazó por otro (otro destino o contenido), el «sí» que
 *    oyó para el de antes no manda el nuevo: primero se confirma ese, nombrando a quién va;
 *  · el segundo «sí» de una repetición incierta es de ESA operación y ese destinatario, no de otro borrador;
 *  · «Aprobar» del panel lleva la huella de lo que mostró la tarjeta: con otro destino bajo el mismo intento, no sale;
 *  · WhatsApp: el chat se resuelve al armar el borrador, nunca adivinando entre dos con el mismo nombre, y el
 *    borrador dice el número al que va.
 *
 * Sin SMTP ni puente de verdad: un buzón y un puente de mentira que cuentan lo que sale. Lo durable, en memoria.
 */
import './datos-prueba'; // la junta inventada de las pruebas (lo real vive en Render)
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aprobacion-destino-'));
process.env.CORREO_CLAVE_CIFRADO ||= 'llave-de-prueba';
process.env.ULTRON_CORREO_DIR = DIR;
process.env.ULTRON_TAREA_CURSO_DIR = path.join(DIR, 'tarea-en-curso');
process.env.ULTRON_ABIERTOS_DIR = path.join(DIR, 'abiertos');
process.env.ULTRON_DURABLE_DIR = path.join(DIR, 'durable');
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const D = await import('../lib/durable');
const C = await import('../server/correo');
const W = await import('../server/whatsapp');
const { agregarCuenta, cuentasDe, quitarCuenta, _olvidarCuentas } = await import('../lib/correo/cuentas');
type Envio = import('../lib/correo/buzon').Envio;

/* ------------------------------------------------------------------ correo */

const PROV = { nombre: 'Prueba', imap: { host: '127.0.0.1', puerto: 993, seguro: true }, smtp: { host: '127.0.0.1', puerto: 465, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: false } as any;

function buzonDeEnvio() {
  const mandados: Envio[] = [];
  const estado = { modo: 'ok' as 'ok' | 'timeout-sin-copia' };
  const buzon = {
    mandar: async (_q: string, _c: unknown, e: Envio) => {
      mandados.push(e);
      if (estado.modo === 'timeout-sin-copia') throw Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT', command: 'DATA' });
      return { messageId: e.messageId || '<x@prueba.hn>', guardadoEnEnviados: false, aceptados: [...e.para, ...(e.cc || [])], rechazados: [] };
    },
    buscarEnviado: async () => 'no-encontrado' as const,
  };
  return { mandados, estado, buzon };
}

async function conCorreo(quien: string, desde: string, f: (b: ReturnType<typeof buzonDeEnvio>) => Promise<void>) {
  const b = buzonDeEnvio();
  D._usarAlmacenDurable(D.almacenEnMemoria());
  C._buzonDePrueba(b.buzon as any);
  C._olvidarCorreo();
  _olvidarCuentas();
  for (const c of await cuentasDe(quien)) await quitarCuenta(quien, c.id);
  await agregarCuenta(quien, desde, PROV, 'clave');
  try {
    await f(b);
  } finally {
    D._usarAlmacenDurable(null);
    C._buzonDePrueba(null);
    C._olvidarCorreo();
    for (const c of await cuentasDe(quien)) await quitarCuenta(quien, c.id);
  }
}

const retenerVoz = () => {
  const r: { hacer: (() => void) | null; descartar: (() => void) | null } = { hacer: null, descartar: null };
  return { r, opciones: { hacer: (f: () => void) => (r.hacer = f), alDescartar: (f: () => void) => (r.descartar = f), recordar: () => {} } };
};
const esperar = (ms = 60) => new Promise((r) => setTimeout(r, ms));

test('correo: el borrador para Ana se reemplaza por uno para Bruno en el mismo turno → el «sí» que oyó para Ana NO manda a Bruno', async () => {
  await conCorreo('ines@x.hn', 'ines@prueba.hn', async ({ mandados }) => {
    await C.correrCorreo('ines@x.hn', 'escribir ana@example.test | Informe | Va el informe del mes.', 'tel');
    // En el mismo turno (la persona no decidió nada en medio) se arma otro: ahora para Bruno.
    const otro = await C.correrCorreoConEstado('ines@x.hn', 'escribir bruno@example.test | Informe | Va el informe del mes.', 'tel');
    const r = (await C.resolverBorradorConEstado('ines@x.hn', 'tel', 'sí'))!;
    assert.equal(mandados.length, 0, 'aprobé para Ana: no sale para Bruno');
    assert.match(otro.texto, /REEMPLAZA al que esperaba para ana@example\.test/, 'el modelo sabe que cambió el destino');
    assert.equal(r.estado, 'failed');
    assert.equal(r.recibo?.codigo, 'confirmar-destino');
    assert.match(r.texto, /antes era para ana@example\.test/);
    assert.match(r.texto, /bruno@example\.test/);
    assert.deepEqual(C.borradorDe('ines@x.hn', 'tel')?.para, ['bruno@example.test'], 'el de Bruno sigue esperando su propia decisión');
    // En la voz también: el «sí» especulativo no se retiene para mandarlo después.
    C._olvidarCorreo();
    await C.correrCorreo('ines@x.hn', 'escribir ana@example.test | Informe | Va el informe del mes.', 'tel');
    await C.correrCorreo('ines@x.hn', 'escribir bruno@example.test | Informe | Va el informe del mes.', 'tel');
    const v = retenerVoz();
    const rv = (await C.resolverBorradorConEstado('ines@x.hn', 'tel', 'sí', v.opciones as any))!;
    assert.equal(rv.recibo?.codigo, 'confirmar-destino');
    assert.equal(v.r.hacer, null, 'no quedó ningún envío retenido');
    // Ya informado (le leyó el de Bruno), su «sí» de ahora es para Bruno: sale una vez, a Bruno.
    const ok = (await C.resolverBorradorConEstado('ines@x.hn', 'tel', 'sí'))!;
    assert.equal(ok.estado, 'succeeded', ok.texto);
    assert.deepEqual(mandados.map((m) => m.para), [['bruno@example.test']]);
  });
});

test('correo: cambiar el borrador por el camino normal («cámbialo…» y otro borrador) no pide confirmar dos veces', async () => {
  await conCorreo('juan@x.hn', 'juan@prueba.hn', async ({ mandados }) => {
    await C.correrCorreo('juan@x.hn', 'escribir ana@example.test | Hola | Primer texto.', 'tel');
    // La persona pide un cambio: el de antes se aparta (AUR08) y el nuevo es lo que oyó.
    await C.resolverBorradorConEstado('juan@x.hn', 'tel', 'mejor mándaselo a Bruno, por favor');
    const nuevo = await C.correrCorreoConEstado('juan@x.hn', 'escribir bruno@example.test | Hola | Primer texto.', 'tel');
    assert.doesNotMatch(nuevo.texto, /REEMPLAZA/);
    assert.equal((await C.resolverBorradorConEstado('juan@x.hn', 'tel', 'sí'))!.estado, 'succeeded');
    assert.deepEqual(mandados.map((m) => m.para), [['bruno@example.test']]);
  });
});

test('correo: el segundo «sí» de una repetición incierta es de ESA operación para Ana; si en medio se armó otro para Bruno, no lo manda', async () => {
  await conCorreo('kati@x.hn', 'kati@prueba.hn', async ({ mandados, estado }) => {
    estado.modo = 'timeout-sin-copia';
    await C.correrCorreo('kati@x.hn', 'escribir ana@example.test | Pago | Ana, ya pagué.', 'tel');
    assert.equal((await C.resolverBorradorConEstado('kati@x.hn', 'tel', 'sí'))!.estado, 'unknown');
    estado.modo = 'ok';
    await C.correrCorreo('kati@x.hn', 'escribir ana@example.test | Pago | Ana, ya pagué.', 'tel');
    const r1 = (await C.resolverBorradorConEstado('kati@x.hn', 'tel', 'sí'))!;
    assert.equal(r1.recibo?.codigo, 'confirmar-repeticion');
    assert.ok(C.borradorDe('kati@x.hn', 'tel')?.repeticionAceptada, 'espera el «sí» informado para repetir a Ana');
    // En ese mismo turno el modelo arma otro, para Bruno.
    await C.correrCorreo('kati@x.hn', 'escribir bruno@example.test | Pago | Bruno, ya pagué.', 'tel');
    assert.equal(C.borradorDe('kati@x.hn', 'tel')?.repeticionAceptada, undefined, 'la aceptación de repetir era de Ana: no pasa a Bruno');
    const r2 = (await C.resolverBorradorConEstado('kati@x.hn', 'tel', 'sí'))!;
    assert.equal(r2.recibo?.codigo, 'confirmar-destino');
    assert.equal(mandados.length, 1, 'solo el intento incierto de Ana; nada para Bruno con el «sí» de Ana');
  });
});

test('correo: «Aprobar» del panel lleva la huella de lo que mostró; el mismo intento con otro destinatario no sale', async () => {
  await conCorreo('lola@x.hn', 'lola@prueba.hn', async ({ mandados }) => {
    await C.correrCorreo('lola@x.hn', 'escribir ana@example.test | Contrato | Va firmado.', 'tel');
    const b = C.borradorDe('lola@x.hn', 'tel')!;
    const vista = b.huella;
    // La tarjeta mostraba Ana. El borrador que espera con ESE intento ahora va a Bruno (otra copia, otro proceso…).
    b.para = ['bruno@example.test'];
    b.huella = C.huellaCorreo(b);
    const r = (await C.resolverBorradorConEstado('lola@x.hn', 'tel', 'sí', undefined, { desdePanel: true, huella: vista }))!;
    assert.equal(mandados.length, 0, 'aprobé a Ana en el panel: no sale para Bruno');
    assert.equal(r.recibo?.codigo, 'aprobacion');
    assert.ok(C.borradorDe('lola@x.hn', 'tel'), 'no se consume: espera una decisión sobre lo que de verdad hay');
    // Sin huella, el panel no aprueba nada (un cliente viejo no autoriza a ciegas).
    const sin = (await C.resolverBorradorConEstado('lola@x.hn', 'tel', 'sí', undefined, { desdePanel: true }))!;
    assert.equal(sin.recibo?.codigo, 'aprobacion');
    assert.equal(mandados.length, 0);
    // Lo legítimo: la huella de lo que muestra el panel ahora.
    C._olvidarCorreo();
    await C.correrCorreo('lola@x.hn', 'escribir ana@example.test | Contrato | Va firmado.', 'tel');
    const ok = (await C.resolverBorradorConEstado('lola@x.hn', 'tel', 'sí', undefined, { desdePanel: true, huella: C.borradorDe('lola@x.hn', 'tel')!.huella }))!;
    assert.equal(ok.estado, 'succeeded', ok.texto);
    assert.deepEqual(mandados.map((m) => m.para), [['ana@example.test']]);
  });
});

test('correo (ya seguro, evidencia): un «sí» de voz para Ana no manda si el borrador cambió antes del efecto, ni lo repone encima del nuevo', async () => {
  await conCorreo('mara@x.hn', 'mara@prueba.hn', async ({ mandados }) => {
    await C.correrCorreo('mara@x.hn', 'escribir ana@example.test | X | Hola.', 'tel');
    const v = retenerVoz();
    await C.resolverBorradorConEstado('mara@x.hn', 'tel', 'sí', v.opciones as any);
    await C.correrCorreo('mara@x.hn', 'escribir bruno@example.test | X | Hola.', 'tel');
    v.r.descartar!();
    assert.deepEqual(C.borradorDe('mara@x.hn', 'tel')?.para, ['bruno@example.test'], 'el turno descartado no repone a Ana encima de Bruno');
    v.r.hacer!();
    await esperar();
    assert.equal(mandados.length, 0);
  });
});

/* ------------------------------------------------------------------ WhatsApp */

const CLAVE = 'clave-del-puente-de-prueba-123';
const JOSE = 'j.herrera@ordenglobal.org';
const sinT = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Un puente de mentira: `chats` (lo que lista), `buscados` (lo que contesta una búsqueda, si se da) y lo que sale. */
async function puente(o: { chats: any[]; buscados?: any[]; contactos?: any[] }) {
  const enviados: Array<{ chat: string; texto: string }> = [];
  const srv = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      const json = (code: number, j: unknown) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(j)));
      if (req.headers.authorization !== `Bearer ${CLAVE}`) return json(401, { error: 'clave' });
      const u = new URL(req.url!, 'http://x');
      if (u.pathname === '/estado') return json(200, { vinculado: true, conectado: true, numero: '+50499998888', vinculando: false });
      if (u.pathname === '/chats') {
        const b = sinT(u.searchParams.get('buscar') || '');
        if (b && o.buscados) return json(200, { chats: o.buscados });
        return json(200, { chats: o.chats.filter((c) => !b || sinT(c.nombre).includes(b) || c.jid.includes(b)) });
      }
      if (u.pathname === '/contactos') return json(200, { contactos: o.contactos || [] });
      if (u.pathname === '/mensajes') return json(200, { chat: o.chats[0], mensajes: [] });
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

async function conPuente<T>(o: Parameters<typeof puente>[0], fn: (p: Awaited<ReturnType<typeof puente>>) => Promise<T>): Promise<T> {
  const p = await puente(o);
  const antes = { u: process.env.WHATSAPP_PUENTE_URL, c: process.env.WHATSAPP_PUENTE_CLAVE, d: process.env.WHATSAPP_DUENOS };
  process.env.WHATSAPP_PUENTE_URL = p.url;
  process.env.WHATSAPP_PUENTE_CLAVE = CLAVE;
  process.env.WHATSAPP_DUENOS = JOSE;
  D._usarAlmacenDurable(D.almacenEnMemoria());
  W._olvidarWhatsapp();
  try {
    return await fn(p);
  } finally {
    for (const [k, v] of [['WHATSAPP_PUENTE_URL', antes.u], ['WHATSAPP_PUENTE_CLAVE', antes.c], ['WHATSAPP_DUENOS', antes.d]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    W._olvidarWhatsapp();
    D._usarAlmacenDurable(null);
    await p.cerrar();
  }
}

const chat = (jid: string, nombre: string, numero: string) => ({ jid, nombre, grupo: false, noLeidos: 0, hora: Date.now(), ultimo: '', ultimoMio: false, numero });
const ANA_1 = chat('50499991111@s.whatsapp.net', 'Ana', '+50499991111');
const ANA_2 = chat('50499992222@s.whatsapp.net', 'Ana', '+50499992222');
const BRUNO = chat('50477773333@s.whatsapp.net', 'Bruno', '+50477773333');

test('WhatsApp: dos chats que se llaman exactamente «Ana» → pregunta cuál; nunca arma el borrador para la primera que encuentre', async () => {
  await conPuente({ chats: [ANA_2, ANA_1, BRUNO] }, async (p) => {
    const r = await W.correrWhatsappConEstado(JOSE, 'responder Ana | Te veo a las 3', 'tel');
    assert.equal(r.estado, 'failed', r.texto);
    assert.match(r.texto, /hay 2 chats que encajan con «Ana»: Ana \+50499992222 · Ana \+50499991111\. Pregúntale cuál/);
    assert.equal(W.borradorWhatsappDe(JOSE, 'tel'), null, 'sin borrador: no hay a quién aprobar');
    // Con el número, es esa Ana; y el borrador DICE el número al que va (lo que aprueba el «sí»).
    const b = await W.correrWhatsappConEstado(JOSE, 'responder +504 9999-1111 | Te veo a las 3', 'tel');
    assert.match(b.texto, /^BORRADOR DE WHATSAPP \(NO enviado\) para Ana \(\+50499991111\):/);
    assert.match((await W.resolverBorradorWhatsapp(JOSE, 'tel', 'sí'))!, /WHATSAPP ENVIADO a Ana/);
    assert.deepEqual(p.enviados, [{ chat: '50499991111@s.whatsapp.net', texto: 'Te veo a las 3' }]);
  });
});

test('WhatsApp: si la búsqueda del puente devuelve varios chats, pregunta cuál (antes tomaba el primero)', async () => {
  await conPuente({ chats: [], buscados: [ANA_1, ANA_2] }, async (p) => {
    const r = await W.correrWhatsappConEstado(JOSE, 'responder anita | Hola', 'tel');
    assert.equal(r.estado, 'failed', r.texto);
    assert.match(r.texto, /hay 2 chats que encajan con «anita»/);
    assert.equal(W.borradorWhatsappDe(JOSE, 'tel'), null);
    assert.equal(p.enviados.length, 0);
  });
});

test('WhatsApp: el borrador para Ana se reemplaza por uno para Bruno en el mismo turno → el «sí» no manda a Bruno sin confirmarlo', async () => {
  await conPuente({ chats: [ANA_1, BRUNO] }, async (p) => {
    await W.correrWhatsapp(JOSE, 'responder Ana | El informe va hoy', 'tel');
    const otro = await W.correrWhatsappConEstado(JOSE, 'responder Bruno | El informe va hoy', 'tel');
    const r = (await W.resolverBorradorWhatsappConEstado(JOSE, 'tel', 'sí'))!;
    assert.equal(p.enviados.length, 0, 'aprobé para Ana: no sale para Bruno');
    assert.equal(r.recibo?.codigo, 'confirmar-destino');
    assert.match(otro.texto, /REEMPLAZA al que esperaba para Ana/);
    assert.equal(W.borradorWhatsappDe(JOSE, 'tel')?.chat, BRUNO.jid);
    assert.match((await W.resolverBorradorWhatsapp(JOSE, 'tel', 'sí'))!, /WHATSAPP ENVIADO a Bruno/);
    assert.deepEqual(p.enviados.map((e) => e.chat), [BRUNO.jid]);
  });
});

test('WhatsApp: «Aprobar» del panel con la huella de Ana no manda al mismo intento si ahora apunta a otro chat', async () => {
  await conPuente({ chats: [ANA_1, BRUNO] }, async (p) => {
    await W.correrWhatsapp(JOSE, 'responder Ana | Hola', 'tel');
    const b = W.borradorWhatsappDe(JOSE, 'tel')!;
    const vista = b.huella;
    b.chat = BRUNO.jid;
    b.huella = W.huellaWhatsapp(b);
    const r = (await W.resolverBorradorWhatsappConEstado(JOSE, 'tel', 'sí', undefined, { desdePanel: true, huella: vista }))!;
    assert.equal(p.enviados.length, 0, 'aprobé a Ana en el panel: no sale para Bruno');
    assert.equal(r.recibo?.codigo, 'aprobacion');
    b.chat = ANA_1.jid;
    b.huella = W.huellaWhatsapp(b);
    const ok = (await W.resolverBorradorWhatsappConEstado(JOSE, 'tel', 'sí', undefined, { desdePanel: true, huella: vista }))!;
    assert.equal(ok.estado, 'succeeded', ok.texto);
    assert.deepEqual(p.enviados.map((e) => e.chat), [ANA_1.jid]);
  });
});

test('círculo: «escríbele a mi esposa» sale al jid guardado aunque haya otra «Ana» (ya era así), y el borrador dice el número', async () => {
  const { borradorWhatsappParaConEstado } = W;
  await conPuente({ chats: [ANA_1, ANA_2] }, async (p) => {
    const r = borradorWhatsappParaConEstado(JOSE, 'tel', { chat: ANA_2.jid, nombre: 'Ana (esposa)', texto: 'Llego tarde', cuenta: '+50499998888' });
    assert.match(r.texto, /para Ana \(esposa\) \(\+50499992222\)/);
    assert.match((await W.resolverBorradorWhatsapp(JOSE, 'tel', 'sí'))!, /WHATSAPP ENVIADO/);
    assert.deepEqual(p.enviados.map((e) => e.chat), [ANA_2.jid], 'al jid aprobado, aunque haya otra «Ana»');
  });
});
