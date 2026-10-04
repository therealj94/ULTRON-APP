/**
 * AUR13 (documento maestro: recorrido R2 de la sección 5, secciones 10 y 15): el correo que sale tras el «sí».
 *
 * Sin SMTP ni IMAP de verdad: un buzón falso que cuenta lo que sale y puede colgarse a mitad (timeout después de
 * DATA), rechazar o encontrar el correo en Enviados por su Message-ID. Lo durable va a un almacén en memoria
 * (el mismo contrato que S3 condicional de lib/durable.ts).
 *
 * Lo que tiene que ser verdad:
 *  · el envío pasa por el registro de operaciones: operationId estable por borrador aprobado, registrado y
 *    «dispatched» ANTES de tocar el SMTP; el mismo borrador sale una sola vez (reintento, dos réplicas, reinicio);
 *  · un timeout queda «unknown»: «No he podido confirmar el envío», no se reenvía a ciegas y se reconcilia por el
 *    Message-ID que pone AURA (en Enviados, si el proveedor lo guarda);
 *  · el «sí» autoriza ESE destinatario, cuenta y contenido (Ana→Bruno): un cambio pide otra decisión;
 *  · estado de entrega honesto: aceptado / fallido / incierto (nunca «entregado» sin constancia);
 *  · el correo no depende de WhatsApp; la cobertura de revisar/buscar se dice («miré los N de M»).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'correo-envio-'));
process.env.CORREO_CLAVE_CIFRADO ||= 'llave-de-prueba';
process.env.ULTRON_CORREO_DIR = DIR;
process.env.ULTRON_TAREA_CURSO_DIR = path.join(DIR, 'tarea-en-curso');
process.env.ULTRON_ABIERTOS_DIR = path.join(DIR, 'abiertos');
process.env.ULTRON_DURABLE_DIR = path.join(DIR, 'durable');
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const D = await import('../lib/durable');
const E = await import('../lib/envios');
const C = await import('../server/correo');
const { agregarCuenta, cuentasDe, quitarCuenta, _olvidarCuentas } = await import('../lib/correo/cuentas');
type Envio = import('../lib/correo/buzon').Envio;

const PROV = { nombre: 'Prueba', imap: { host: '127.0.0.1', puerto: 993, seguro: true }, smtp: { host: '127.0.0.1', puerto: 465, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: false } as any;

type Modo = 'ok' | 'timeout' | 'timeout-sin-copia' | 'auth' | 'rechazo';
/** Un buzón falso para el envío: `modo` decide qué pasa al mandar; `enEnviados`, qué encuentra la búsqueda por Message-ID. */
function buzonDeEnvio() {
  const mandados: Envio[] = [];
  const estado = { modo: 'ok' as Modo, enEnviados: new Set<string>(), alDespachar: [] as string[], buscados: [] as string[] };
  const buzon = {
    mandar: async (q: string, _c: unknown, e: Envio) => {
      // Persistir antes de actuar: cuando el SMTP recibe el correo, la operación ya está «dispatched».
      if (e.operacion) {
        const l = await D.leerOperacion(q, e.operacion);
        estado.alDespachar.push(l.ok && l.valor ? l.valor.estado : 'sin-registro');
      }
      if (estado.modo === 'auth') throw Object.assign(new Error('Invalid login: 535 5.7.8'), { code: 'EAUTH', command: 'AUTH PLAIN', responseCode: 535 });
      if (estado.modo === 'rechazo') throw Object.assign(new Error("Can't send mail - all recipients were rejected"), { code: 'EENVELOPE', command: 'RCPT TO', rejected: e.para });
      mandados.push(e);
      if (estado.modo === 'timeout' || estado.modo === 'timeout-sin-copia') {
        // El servidor se quedó con el correo (pudo haber salido) pero no contestó a tiempo.
        if (estado.modo === 'timeout' && e.messageId) estado.enEnviados.add(e.messageId);
        throw Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT', command: 'DATA' });
      }
      return { messageId: e.messageId || '<x@prueba.hn>', guardadoEnEnviados: false, aceptados: [...e.para, ...(e.cc || [])], rechazados: [] };
    },
    buscarEnviado: async (_q: string, _c: unknown, messageId: string) => {
      estado.buscados.push(messageId);
      return estado.enEnviados.has(messageId) ? ('encontrado' as const) : ('no-encontrado' as const);
    },
  };
  return { mandados, estado, buzon };
}

async function conEnvio(quien: string, desde: string, f: (b: ReturnType<typeof buzonDeEnvio>) => Promise<void>) {
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

test('el «sí» manda por el registro durable: operationId del borrador, registrado ANTES de mandar, un solo efecto aunque se reintente, haya dos réplicas o el «hacer» de la voz corra dos veces', async () => {
  await conEnvio('nora@x.hn', 'nora@prueba.hn', async ({ mandados, estado }) => {
    await C.correrCorreo('nora@x.hn', 'escribir ana@example.test | Contrato | Ana, te mando el contrato firmado.', 'tel');
    const b = C.borradorDe('nora@x.hn', 'tel')!;
    const op = E.operacionDeBorrador('correo', b.intento);
    const r = (await C.resolverBorradorConEstado('nora@x.hn', 'tel', 'sí'))!;
    assert.equal(r.estado, 'succeeded');
    assert.match(r.texto, /^CORREO ENVIADO desde nora@prueba\.hn a ana@example\.test — «Contrato»/);
    // Estado de entrega honesto: aceptado por el servidor de salida, no «entregado».
    assert.equal(r.recibo?.entrega, 'aceptado');
    assert.match(r.texto, /aceptado por el servidor de salida/i);
    assert.match(r.texto, /no confirma que (ya )?esté en su bandeja/i);
    assert.doesNotMatch(r.texto, /\bentregado\b/i);
    assert.equal(r.recibo?.operacion, op, 'el recibo lleva el operationId estable del borrador');
    assert.equal(mandados.length, 1);
    assert.deepEqual(estado.alDespachar, ['dispatched'], 'se registró y quedó «dispatched» antes de tocar el SMTP');
    // El Message-ID lo pone AURA, derivado de la operación: con él se reconcilia en Enviados.
    assert.equal(mandados[0].messageId, E.messageIdDeOperacion(op, 'nora@prueba.hn'));
    assert.match(mandados[0].messageId!, /^<aura\.[a-f0-9]{24,}@prueba\.hn>$/);
    const guardada = await D.leerOperacion('nora@x.hn', op);
    assert.ok(guardada.ok && guardada.valor);
    assert.equal(guardada.valor!.estado, 'succeeded');
    assert.deepEqual(guardada.valor!.historia.map((h) => h.estado), ['requested', 'dispatched', 'succeeded']);
    assert.equal(guardada.valor!.recibo?.entrega, 'aceptado');
    // El mismo borrador aprobado otra vez (un reintento, otra réplica con la misma copia, tras reiniciar): no sale de nuevo.
    const otraVez = await C.enviarBorradorAprobado('nora@x.hn', b);
    assert.equal(otraVez.estado, 'succeeded');
    assert.equal(otraVez.recibo?.repetido, true);
    assert.match(otraVez.texto, /ya había salido/i);
    assert.equal(mandados.length, 1, 'un solo efecto');
    // Dos réplicas a la vez con el mismo borrador aprobado: sale uno.
    await C.correrCorreo('nora@x.hn', 'escribir ana@example.test | Otro | Segundo correo.', 'tel');
    const b2 = C.borradorDe('nora@x.hn', 'tel')!;
    const [x, y] = await Promise.all([C.enviarBorradorAprobado('nora@x.hn', b2), C.enviarBorradorAprobado('nora@x.hn', b2)]);
    assert.equal(mandados.length, 2, 'dos réplicas, un correo');
    assert.equal([x, y].filter((z) => z.recibo?.repetido).length, 1);
    // En la voz, si el «hacer» del turno corre dos veces, tampoco se duplica.
    C._olvidarCorreo();
    await C.correrCorreo('nora@x.hn', 'escribir ana@example.test | Tercero | Tercer correo.', 'tel');
    const v = retenerVoz();
    await C.resolverBorradorConEstado('nora@x.hn', 'tel', 'sí', v.opciones as any);
    v.r.hacer!();
    v.r.hacer!();
    await esperar();
    assert.equal(mandados.length, 3);
    assert.match(C.avisosDeEnvio('nora@x.hn', 'tel').join(' '), /CORREO ENVIADO/);
  });
});

test('un timeout después de DATA queda «unknown»: «No he podido confirmar el envío», no se reenvía a ciegas y se reconcilia por Message-ID en Enviados', async () => {
  await conEnvio('omar@x.hn', 'omar@prueba.hn', async ({ mandados, estado }) => {
    estado.modo = 'timeout-sin-copia';
    await C.correrCorreo('omar@x.hn', 'escribir ana@example.test | Pago | Ana, ya hice el pago.', 'tel');
    const op = E.operacionDeBorrador('correo', C.borradorDe('omar@x.hn', 'tel')!.intento);
    const r = (await C.resolverBorradorConEstado('omar@x.hn', 'tel', 'sí'))!;
    assert.equal(r.estado, 'unknown');
    assert.equal(r.recibo?.entrega, 'incierto');
    assert.equal(r.recibo?.efecto, 'posible');
    assert.equal(r.recibo?.operacion, op, 'conserva el operationId');
    assert.match(r.texto, /No he podido confirmar el envío/);
    assert.doesNotMatch(r.texto, /CORREO ENVIADO|NO se pudo mandar|no salió/i);
    assert.equal(mandados.length, 1);
    assert.ok(estado.buscados.includes(E.messageIdDeOperacion(op, 'omar@prueba.hn')), 'se buscó en Enviados antes de rendirse');
    const l = await D.leerOperacion('omar@x.hn', op);
    assert.equal(l.ok && l.valor?.estado, 'unknown');
    // Lo pide otra vez (otro borrador igual): primero se reconcilia; sigue sin constar → no sale, se pide otra decisión.
    await C.correrCorreo('omar@x.hn', 'escribir ana@example.test | Pago | Ana, ya hice el pago.', 'tel');
    const r2 = (await C.resolverBorradorConEstado('omar@x.hn', 'tel', 'sí'))!;
    assert.equal(mandados.length, 1, 'no se reenvía a ciegas');
    assert.equal(r2.recibo?.efecto, 'ninguno');
    assert.match(r2.texto, /sin confirmar/);
    assert.match(r2.texto, /«sí» otra vez/);
    assert.ok(C.borradorDe('omar@x.hn', 'tel'), 'queda esperando una decisión nueva');
    // Ahora aparece en Enviados (el proveedor tardó en guardarlo): la reconciliación lo da por hecho y NO sale otra vez.
    estado.enEnviados.add(E.messageIdDeOperacion(op, 'omar@prueba.hn'));
    estado.modo = 'ok';
    const r3 = (await C.resolverBorradorConEstado('omar@x.hn', 'tel', 'sí'))!;
    assert.equal(mandados.length, 1, 'ya había salido: no se duplica');
    assert.match(r3.texto, /CORREO ENVIADO/);
    assert.match(r3.texto, /Enviados/);
    assert.match(r3.texto, /no lo volví a mandar/i);
    const l2 = await D.leerOperacion('omar@x.hn', op);
    assert.equal(l2.ok && l2.valor?.estado, 'succeeded', 'la operación incierta se cerró por reconciliación');
    assert.equal(l2.ok && l2.valor?.recibo?.efecto, 'confirmed');
  });
});

test('aceptar el riesgo de repetir un envío incierto es una decisión informada (sale con otra operación); un timeout que sí quedó en Enviados se confirma enseguida', async () => {
  await conEnvio('pia@x.hn', 'pia@prueba.hn', async ({ mandados, estado }) => {
    estado.modo = 'timeout-sin-copia';
    await C.correrCorreo('pia@x.hn', 'escribir ana@example.test | Hola | Texto igual.', 'tel');
    assert.equal((await C.resolverBorradorConEstado('pia@x.hn', 'tel', 'sí'))!.estado, 'unknown');
    await C.correrCorreo('pia@x.hn', 'escribir ana@example.test | Hola | Texto igual.', 'tel');
    await C.resolverBorradorConEstado('pia@x.hn', 'tel', 'sí');
    assert.equal(mandados.length, 1);
    // Dice «sí» otra vez sabiendo que podría llegar repetido: sale, con otra operación.
    estado.modo = 'ok';
    const r = (await C.resolverBorradorConEstado('pia@x.hn', 'tel', 'sí'))!;
    assert.equal(r.estado, 'succeeded');
    assert.equal(mandados.length, 2);
    assert.notEqual(mandados[0].messageId, mandados[1].messageId, 'cada operación con su Message-ID');
    // Un timeout cuyo correo SÍ quedó en Enviados (Gmail lo guarda solo): se confirma al reconciliar enseguida.
    estado.modo = 'timeout';
    await C.correrCorreo('pia@x.hn', 'escribir beto@example.test | Otro | Otro texto.', 'tel');
    const r2 = (await C.resolverBorradorConEstado('pia@x.hn', 'tel', 'sí'))!;
    assert.equal(r2.estado, 'succeeded');
    assert.match(r2.texto, /CORREO ENVIADO/);
    assert.match(r2.texto, /Enviados/);
    assert.equal(mandados.length, 3);
  });
});

test('un fallo antes de mandar (la clave, todos rechazados) es «fallido» con certeza y se dice así', async () => {
  await conEnvio('quim@x.hn', 'quim@prueba.hn', async ({ estado }) => {
    estado.modo = 'auth';
    await C.correrCorreo('quim@x.hn', 'escribir ana@example.test | Hola | Texto.', 'tel');
    const r = (await C.resolverBorradorConEstado('quim@x.hn', 'tel', 'sí'))!;
    assert.equal(r.estado, 'failed');
    assert.equal(r.recibo?.entrega, 'fallido');
    assert.equal(r.recibo?.efecto, 'ninguno');
    assert.match(r.texto, /NO se pudo mandar|NO se mandó/);
    assert.doesNotMatch(r.texto, /No he podido confirmar/);
    estado.modo = 'rechazo';
    await C.correrCorreo('quim@x.hn', 'escribir nadie@example.test | Hola | Texto.', 'tel');
    const r2 = (await C.resolverBorradorConEstado('quim@x.hn', 'tel', 'sí'))!;
    assert.equal(r2.estado, 'failed');
    assert.match(r2.texto, /rechazó nadie@example\.test/);
  });
});

test('sección 10, Ana→Bruno: el «sí» autoriza ESE borrador; si antes de ejecutar cambia destinatario o contenido, no sale, la aprobación no se consume y aparece otra decisión', async () => {
  await conEnvio('rita@x.hn', 'rita@prueba.hn', async ({ mandados }) => {
    // 1) El plan cambia a Bruno (otro borrador) entre el «sí» y el efecto (la voz espera a que el turno se confirme).
    await C.correrCorreo('rita@x.hn', 'escribir ana@example.test | Borrador X | Ana, va el informe.', 'tel');
    const v = retenerVoz();
    await C.resolverBorradorConEstado('rita@x.hn', 'tel', 'sí', v.opciones as any);
    await C.correrCorreo('rita@x.hn', 'escribir bruno@example.test | Borrador X | Ana, va el informe.', 'tel');
    v.r.hacer!();
    await esperar();
    assert.equal(mandados.length, 0, 'no sale ni a Ana ni a Bruno');
    assert.match(C.avisosDeEnvio('rita@x.hn', 'tel').join(' '), /NO se mandó.*cambió/);
    assert.deepEqual(C.borradorDe('rita@x.hn', 'tel')?.para, ['bruno@example.test'], 'la decisión nueva (Bruno) espera su propio «sí»');
    await C.resolverBorradorConEstado('rita@x.hn', 'tel', 'no');
    // 2) Alguien cambia el destinatario del borrador ya aprobado (servidor/ejecutor): no se manda lo que no se aprobó.
    await C.correrCorreo('rita@x.hn', 'escribir ana@example.test | Borrador Y | Texto aprobado.', 'tel');
    const aprobado = C.borradorDe('rita@x.hn', 'tel')!;
    const v2 = retenerVoz();
    await C.resolverBorradorConEstado('rita@x.hn', 'tel', 'sí', v2.opciones as any);
    aprobado.para = ['bruno@example.test'];
    v2.r.hacer!();
    await esperar();
    assert.equal(mandados.length, 0);
    assert.match(C.avisosDeEnvio('rita@x.hn', 'tel').join(' '), /NO se mandó.*no es lo que aprobó/);
    const nueva = C.borradorDe('rita@x.hn', 'tel');
    assert.deepEqual(nueva?.para, ['bruno@example.test'], 'aparece una decisión nueva con el cambio');
    assert.notEqual(nueva?.intento, aprobado.intento, 'con otro intento: la aprobación anterior no vale para Bruno');
    await C.resolverBorradorConEstado('rita@x.hn', 'tel', 'no');
    // Contenido consecuente cambiado tras el «sí»: igual.
    await C.correrCorreo('rita@x.hn', 'escribir ana@example.test | Z | Pago de 100.', 'tel');
    const z = C.borradorDe('rita@x.hn', 'tel')!;
    const v3 = retenerVoz();
    await C.resolverBorradorConEstado('rita@x.hn', 'tel', 'sí', v3.opciones as any);
    z.texto = 'Pago de 10000.';
    v3.r.hacer!();
    await esperar();
    assert.equal(mandados.length, 0);
    await C.resolverBorradorConEstado('rita@x.hn', 'tel', 'no');
    // 3) En el registro durable: la operación de un borrador aprobado no se canjea con otro contenido (replay manipulado).
    const op = E.operacionDeBorrador('correo', 'intento-de-prueba');
    const legit = await E.enviarUnaVez({ canal: 'correo', dueno: 'rita@x.hn', operacion: op, huella: 'huella-ana', efecto: async () => ({ estado: 'failed', detalle: 'no hubo efecto' }), reconciliar: async () => ({ encontrado: false }) });
    assert.equal(legit.estado, 'failed');
    const ajeno = await E.enviarUnaVez({ canal: 'correo', dueno: 'rita@x.hn', operacion: op, huella: 'huella-bruno', efecto: async () => assert.fail('no se corre'), reconciliar: async () => ({ encontrado: false }) });
    assert.equal(ajeno.motivo, 'aprobacion-no-coincide');
    assert.equal(ajeno.estado, 'failed');
    // Lo legítimo sale una vez.
    await C.correrCorreo('rita@x.hn', 'escribir bruno@example.test | Final | Hola Bruno.', 'tel');
    assert.equal((await C.resolverBorradorConEstado('rita@x.hn', 'tel', 'sí'))!.estado, 'succeeded');
    assert.deepEqual(mandados.map((m) => m.para), [['bruno@example.test']]);
  });
});

test('la tarea de correo no depende de WhatsApp (sin puente el correo funciona y el «sí» de WhatsApp no estorba)', async () => {
  const antes = { u: process.env.WHATSAPP_PUENTE_URL, c: process.env.WHATSAPP_PUENTE_CLAVE, d: process.env.WHATSAPP_DUENOS };
  delete process.env.WHATSAPP_PUENTE_URL;
  delete process.env.WHATSAPP_PUENTE_CLAVE;
  process.env.WHATSAPP_DUENOS = 'sara@x.hn';
  const W = await import('../server/whatsapp');
  try {
    await conEnvio('sara@x.hn', 'sara@prueba.hn', async ({ mandados }) => {
      await C.correrCorreo('sara@x.hn', 'escribir ana@example.test | Hola | Sin WhatsApp.', 'tel');
      assert.equal(await W.resolverBorradorWhatsapp('sara@x.hn', 'tel', 'sí'), null, 'WhatsApp no tiene nada que decir');
      assert.equal((await C.resolverBorradorConEstado('sara@x.hn', 'tel', 'sí'))!.estado, 'succeeded');
      assert.equal(mandados.length, 1);
    });
  } finally {
    for (const [k, v] of Object.entries({ WHATSAPP_PUENTE_URL: antes.u, WHATSAPP_PUENTE_CLAVE: antes.c, WHATSAPP_DUENOS: antes.d })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('cobertura honesta al revisar y buscar: «miré los N más recientes de M», nunca «todo el correo»', async () => {
  const res = (uid: number, de: string, asunto: string) => ({ ref: '', uid, cuenta: 'tito@prueba.hn', de, deCorreo: `${de.toLowerCase()}@x.hn`, asunto, fecha: new Date(Date.now() - uid * 60_000).toISOString(), noLeido: true });
  C._olvidarCorreo();
  _olvidarCuentas();
  C._buzonDePrueba({
    listar: async (_q: string, c: any, o: any = {}) => {
      const r = [res(1, 'Ana', 'Uno'), res(2, 'Beto', 'Dos'), res(3, 'Carla', 'Tres')].map((x) => ({ ...x, ref: `${c.id}:${x.uid}` }));
      if (o.cobertura) Object.assign(o.cobertura, { total: o.buscar ? 25 : 40, revisados: r.length });
      return r;
    },
  } as any);
  try {
    for (const c of await cuentasDe('tito@x.hn')) await quitarCuenta('tito@x.hn', c.id);
    await agregarCuenta('tito@x.hn', 'tito@prueba.hn', PROV, 'clave');
    const r = await C.correrCorreoConEstado('tito@x.hn', 'revisar', 'tel');
    assert.match(r.texto, /COBERTURA: miré los 3 más recientes de 40 sin leer en tito@prueba\.hn \(solo la bandeja de entrada\)/);
    assert.match(r.texto, /no digas que revisaste todo/i);
    assert.equal(r.recibo?.incompleto, true, 'una muestra no se memoriza como el total');
    const s = await C.correrCorreoConEstado('tito@x.hn', 'buscar Ana', 'tel');
    assert.match(s.texto, /COBERTURA: miré los 3 más recientes de 25 que encajan en tito@prueba\.hn/);
    // Sin saber el total (un proveedor que no lo da): igual se dice que es una muestra.
    C._buzonDePrueba({ listar: async (_q: string, c: any) => [{ ...res(1, 'Ana', 'Uno'), ref: `${c.id}:1` }] } as any);
    const u = await C.correrCorreoConEstado('tito@x.hn', 'revisar', 'tel');
    assert.match(u.texto, /COBERTURA: miré los 1 más recientes sin leer en tito@prueba\.hn/);
  } finally {
    C._buzonDePrueba(null);
    for (const c of await cuentasDe('tito@x.hn')) await quitarCuenta('tito@x.hn', c.id);
  }
});

test('la app: /api/correo/enviar con idEnvio sale una sola vez; el mismo id con otro destinatario pide otra confirmación; un timeout es «incierto», no «no salió»', async () => {
  const express = (await import('express')).default;
  await conEnvio('ulises@x.hn', 'ulises@prueba.hn', async ({ mandados, estado }) => {
    const app = express();
    app.use(express.json());
    const pasa: import('express').RequestHandler = (_q, _r, n) => n();
    C.montarRutasCorreo(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null) });
    const srv = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => srv.once('listening', () => r()));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const enviar = async (cuerpo: unknown) => {
      const r = await fetch(`${base}/api/correo/enviar`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-quien': 'ulises@x.hn' }, body: JSON.stringify(cuerpo) });
      return { status: r.status, j: (await r.json()) as any };
    };
    try {
      const c = (await cuentasDe('ulises@x.hn'))[0];
      const listo = { cuentaId: c.id, para: ['ana@example.test'], asunto: 'Hola', texto: 'Ana, ¿nos vemos?', confirmado: true, idEnvio: 'toque-1234567890' };
      const a = await enviar(listo);
      assert.equal(a.status, 200, JSON.stringify(a.j));
      assert.equal(a.j.entrega, 'aceptado');
      assert.ok(a.j.operacion);
      const b = await enviar(listo);
      assert.equal(b.status, 200);
      assert.equal(b.j.repetido, true, 'el reintento del mismo toque no sale otra vez');
      assert.equal(mandados.length, 1);
      // El mismo toque con otro destinatario (un cliente manipulado o un reintento con cambios): no se canjea.
      const otro = await enviar({ ...listo, para: ['bruno@example.test'] });
      assert.equal(otro.status, 409);
      assert.equal(otro.j.code, 'confirmacion_de_otro_envio');
      assert.equal(mandados.length, 1);
      // Timeout: 202 incierto, nunca «No salió».
      estado.modo = 'timeout-sin-copia';
      const t = await enviar({ ...listo, idEnvio: 'toque-otro-0987654321', asunto: 'Otro' });
      assert.equal(t.status, 202);
      assert.equal(t.j.estado, 'incierto');
      assert.match(t.j.error, /No he podido confirmar el envío/);
      assert.doesNotMatch(t.j.error, /No salió/);
    } finally {
      srv.close();
    }
  });
});
