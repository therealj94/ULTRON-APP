/**
 * Avisos de mensajes importantes (auditoría del 7-oct, A-6): lib/alertas-mensajes.ts (triaje, horas quietas, tope),
 * server/alertas-mensajes.ts (el aviso firmado del puente, la vuelta del correo, la lista VIP) y lo que hace el teléfono
 * con el aviso (mobile/src/push/logica.ts, mobile/src/whatsapp/pedido.ts).
 *
 * Lo que tiene que ser verdad:
 *  · triaje: un VIP o alguien del círculo avisa; un desconocido solo con algo urgente o importante de verdad (una pregunta
 *    suelta no); nunca publicidad ni una posible estafa (salvo un VIP);
 *  · horas quietas 22:00–07:00 de Honduras: nada, salvo un VIP con algo urgente;
 *  · un aviso por chat cada 10 minutos y hasta 6 por hora (12 si son urgentes); el mismo mensaje una sola vez;
 *  · el aviso del puente sin firma, con otra clave, viejo o repetido: 401; solo avisa a la persona dueña de ESA cuenta;
 *  · el aviso lleva una línea y una respuesta sugerida; al tocarlo, el chat se abre con la sugerencia como BORRADOR.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express, { type RequestHandler } from 'express';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'alertas-'));
process.env.ULTRON_VIP_DIR = path.join(DIR, 'vip');
process.env.ULTRON_WA_DUENOS_DIR = path.join(DIR, 'wa-duenos');
process.env.ULTRON_DURABLE_DIR = path.join(DIR, 'durable');
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const A = await import('../lib/alertas-mensajes');
const S = await import('../server/alertas-mensajes');
const V = await import('../lib/contactos-vip');
const { correrTriajeConEstado } = await import('../lib/triaje');
const { anotarDuenoCuentaWA, duenosDeCuentaWA, _olvidarDuenosCuentaWA } = await import('../lib/duenos-cuenta-wa');
const { datosParaFcm } = await import('../lib/push');
const L = await import('../mobile/src/push/logica');
const P = await import('../mobile/src/whatsapp/pedido');

/** Las 10:00 y las 23:30 de un día cualquiera en Honduras (UTC−6, sin horario de verano). */
const DIEZ_AM = Date.parse('2026-10-07T16:00:00Z');
const ONCE_Y_MEDIA_PM = Date.parse('2026-10-08T05:30:00Z');

const ev = (o: Partial<import('../lib/alertas-mensajes').EventoMensaje> = {}) => ({
  canal: 'whatsapp' as const,
  id: `m${Math.random().toString(36).slice(2)}`,
  chat: '50499991111@s.whatsapp.net',
  nombre: 'Ana Paz',
  numero: '+50499991111',
  grupo: false,
  hora: DIEZ_AM,
  texto: 'Hola, ¿cómo estás?',
  ...o,
});

test('triaje: VIP, círculo, urgencias de verdad; una pregunta suelta, la publicidad y la estafa no', () => {
  const vips = [{ nombre: 'Ana Paz', numero: '50499991111', t: 0 }];
  const vip = A.triarMensaje(ev(), { vips, ahora: DIEZ_AM });
  assert.ok(vip.avisar && vip.vip && !vip.urgente);
  assert.equal(vip.titulo, 'WhatsApp · Ana Paz');
  assert.equal(vip.resumen, 'Ana Paz: «Hola, ¿cómo estás?»');
  assert.ok(vip.sugerencia.startsWith('Hola Ana'), vip.sugerencia);
  // El mismo VIP con algo urgente: urgente (y el título lo dice).
  const vipUrg = A.triarMensaje(ev({ texto: 'Llámame, es urgente' }), { vips, ahora: DIEZ_AM });
  assert.ok(vipUrg.urgente && vipUrg.titulo.startsWith('Urgente · '));
  // El VIP se reconoce por su número aunque el nombre sea otro (y con o sin +504).
  assert.ok(A.triarMensaje(ev({ nombre: 'Anita', numero: '99991111' }), { vips, ahora: DIEZ_AM }).vip);
  // Un desconocido que pregunta algo: no basta.
  const pregunta = A.triarMensaje(ev({ nombre: 'Carlos', numero: '+50433332222', texto: '¿Me confirmas la reunión?' }), { ahora: DIEZ_AM });
  assert.equal(pregunta.avisar, false);
  // Un desconocido con dinero y urgencia: sí.
  const urg = A.triarMensaje(ev({ nombre: 'Carlos', numero: '+50433332222', texto: 'Me urge que me confirmes el pago de la factura hoy' }), { ahora: DIEZ_AM });
  assert.ok(urg.avisar, JSON.stringify(urg));
  // Publicidad: nunca.
  assert.equal(A.triarMensaje(ev({ nombre: 'Tienda', numero: '+50422221111', texto: 'URGENTE: oferta 50% de descuento, compra ahora' }), { ahora: DIEZ_AM }).avisar, false);
  // Laya ve una estafa: no se avisa (ni se sugiere respuesta)… salvo que sea un VIP.
  const laya = { estafa: 0.9, urgente: 0.9 };
  assert.equal(A.triarMensaje(ev({ nombre: 'Banco', numero: '+50411110000', texto: 'Su cuenta será bloqueada, mande su clave' }), { laya, ahora: DIEZ_AM }).avisar, false);
  const vipEstafa = A.triarMensaje(ev({ texto: 'Su cuenta será bloqueada' }), { vips, laya, ahora: DIEZ_AM });
  assert.ok(vipEstafa.avisar && vipEstafa.sugerencia === '');
  // Alguien de su círculo (su esposa).
  const circulo = [{ id: 'c1', nombre: 'María', alias: ['mi esposa'], relacion: 'esposa', canales: { whatsapp: '+50477776666' }, permisos: { recordatorios: 'preguntar', mensajes: 'preguntar' }, creado: 0, actualizado: 0 }] as any;
  const esposa = A.triarMensaje(ev({ nombre: 'María', numero: '+50477776666', texto: 'Ya llegué' }), { circulo, ahora: DIEZ_AM });
  assert.ok(esposa.avisar && !esposa.urgente, 'importante, no urgente: «urgente» lo dice el mensaje, no quién lo manda');
  // Una nota de voz sin texto se resume como tal; un correo, con su asunto.
  assert.match(A.triarMensaje(ev({ texto: '', tipo: 'audio', duracion: 9 }), { vips, ahora: DIEZ_AM }).resumen, /te mandó una nota de voz \(9 s\)/);
  const correo = A.triarMensaje({ canal: 'correo', id: 'c:1', chat: 'abc123:1', nombre: 'Banco Atlántida', correoDe: 'avisos@banco.hn', grupo: false, hora: DIEZ_AM, asunto: 'Pago rechazado', texto: 'Urgente: su transferencia fue rechazada' }, { ahora: DIEZ_AM });
  assert.ok(correo.avisar && correo.titulo.startsWith('Urgente · Correo · Banco'), JSON.stringify(correo));
  assert.match(correo.resumen, /^Banco Atlántida: «Pago rechazado» — Urgente/);
});

test('horas quietas (22:00–07:00 de Honduras): solo un VIP con algo urgente', () => {
  A._olvidarAlertas();
  assert.deepEqual(A.decidirEnvio('a@x.hn', 'c1', { urgente: true, vip: false }, ONCE_Y_MEDIA_PM), { enviar: false, porque: 'quietas' });
  assert.deepEqual(A.decidirEnvio('a@x.hn', 'c1', { urgente: false, vip: true }, ONCE_Y_MEDIA_PM), { enviar: false, porque: 'quietas' });
  assert.deepEqual(A.decidirEnvio('a@x.hn', 'c1', { urgente: true, vip: true }, ONCE_Y_MEDIA_PM), { enviar: true });
  // A las 7:30 ya no son horas quietas.
  assert.deepEqual(A.decidirEnvio('a@x.hn', 'c2', { urgente: false, vip: false }, Date.parse('2026-10-08T13:30:00Z')), { enviar: true });
});

test('tope: uno por chat cada 10 minutos; 6 por hora (12 los urgentes); por persona', () => {
  A._olvidarAlertas();
  const t0 = DIEZ_AM;
  assert.equal(A.decidirEnvio('b@x.hn', 'chat', { urgente: false, vip: true }, t0).enviar, true);
  assert.deepEqual(A.decidirEnvio('b@x.hn', 'chat', { urgente: false, vip: true }, t0 + 60_000), { enviar: false, porque: 'chat' });
  assert.equal(A.decidirEnvio('b@x.hn', 'chat', { urgente: false, vip: true }, t0 + 11 * 60_000).enviar, true);
  // Otra persona no comparte el tope.
  assert.equal(A.decidirEnvio('otra@x.hn', 'chat', { urgente: false, vip: true }, t0 + 60_000).enviar, true);
  A._olvidarAlertas();
  for (let i = 0; i < 6; i++) assert.equal(A.decidirEnvio('c@x.hn', `chat${i}`, { urgente: false, vip: false }, t0 + i).enviar, true);
  assert.deepEqual(A.decidirEnvio('c@x.hn', 'chat7', { urgente: false, vip: false }, t0 + 10), { enviar: false, porque: 'hora' });
  // Lo urgente tiene su propio tope (12 en la hora).
  for (let i = 0; i < 6; i++) assert.equal(A.decidirEnvio('c@x.hn', `u${i}`, { urgente: true, vip: false }, t0 + 20 + i).enviar, true);
  assert.deepEqual(A.decidirEnvio('c@x.hn', 'u9', { urgente: true, vip: false }, t0 + 40), { enviar: false, porque: 'hora' });
  // Pasada la hora, vuelve a haber lugar.
  assert.equal(A.decidirEnvio('c@x.hn', 'chat8', { urgente: false, vip: false }, t0 + 3_600_001).enviar, true);
});

test('el aviso: una línea, la sugerencia y a qué chat lleva; el mismo mensaje una sola vez; con los avisos apagados, nada', async () => {
  A._olvidarAlertas();
  const empujados: any[] = [];
  const vistos = new Set<string>();
  let apagado = false;
  A._alertasDePrueba({
    vips: async () => [{ nombre: 'Ana Paz', numero: '50499991111', t: 0 }],
    circulo: async () => [],
    laya: async () => null,
    push: async (c, d) => (empujados.push({ c, d }), { enviados: 1, entrega: 'aceptado' as const }),
    primeraVez: async (f, c, id) => (vistos.has(`${f}|${c}|${id}`) ? false : (vistos.add(`${f}|${c}|${id}`), true)),
    apagado: async () => apagado,
    ahora: () => DIEZ_AM,
  });
  try {
    const e = ev({ id: 'M1', texto: 'Te mandé la cotización, ¿la viste?' });
    const r = await A.alertarSiImporta('jose@x.hn', e, 'wa-alerta');
    assert.ok(r.avisado, r.porque);
    assert.equal(r.porque, 'aceptado', 'Firebase solo lo aceptó: nunca «entregado»');
    const d = empujados[0].d;
    assert.equal(d.tipo, 'mensaje-externo');
    assert.equal(d.canal, 'whatsapp');
    assert.equal(d.chat, '50499991111@s.whatsapp.net');
    assert.equal(d.abrir, 'whatsapp');
    assert.match(d.texto, /^Ana Paz: «Te mandé la cotización/);
    assert.ok(String(d.sugerencia).length > 0);
    // Viaja como texto por FCM (y el id sale del mensaje: el mismo mensaje, el mismo aviso).
    const fcm = datosParaFcm('jose@x.hn', d, DIEZ_AM);
    assert.equal(fcm.tipo, 'mensaje-externo');
    assert.match(fcm.id, /^mx[0-9a-f]{24}$/);
    // El mismo mensaje otra vez (el puente reintenta): no se avisa dos veces.
    A._olvidarAlertas();
    assert.equal((await A.alertarSiImporta('jose@x.hn', e, 'wa-alerta')).porque, 'repetido');
    apagado = true;
    assert.equal((await A.alertarSiImporta('jose@x.hn', ev({ id: 'M2' }), 'wa-alerta')).porque, 'avisos apagados');
    assert.equal(empujados.length, 1);
  } finally {
    A._alertasDePrueba(null);
  }
});

/* ── el aviso firmado del puente ─────────────────────────────────────────────────────────── */

const CLAVE = 'clave-del-puente-de-prueba-123';

test('la firma es la misma que hace el puente (servicios/whatsapp-puente/aviso.go)', () => {
  assert.equal(S.firmarAviso('clave-larga-de-veinticuatro-o-mas', 1700000000, '{"id":"X"}'), 't=1700000000,v1=85a5d30a85ccaf5031d012e17d682881fe84c5f44cf41018915511f66d08a2dc');
});

async function appAvisos(procesados: any[]) {
  const app = express();
  app.use(express.json({ limit: '1mb', verify: S.capturarCuerpoAviso }));
  const pasa: RequestHandler = (_q, _r, n) => n();
  S.montarRutasAlertas(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null), procesar: async (a) => procesados.push(a), esperar: true });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { base, cerrar: () => new Promise<void>((r) => srv.close(() => r())) };
}

test('el aviso del puente: sin firma, con otra clave, viejo o repetido → 401; bien firmado → 202 y se procesa', async () => {
  const antes = process.env.WHATSAPP_PUENTE_CLAVE;
  process.env.WHATSAPP_PUENTE_CLAVE = CLAVE;
  S._olvidarFirmasAviso();
  const procesados: any[] = [];
  const { base, cerrar } = await appAvisos(procesados);
  try {
    const cuerpo = JSON.stringify({ cuenta: 'legado', id: '3EB0AA11', chat: '50499991111@s.whatsapp.net', de: '50499991111@s.whatsapp.net', nombreDe: 'Ana', grupo: false, hora: Date.now(), tipo: 'texto', texto: 'Hola' });
    const t = Math.floor(Date.now() / 1000);
    const mandar = (firma: string | null, c = cuerpo) => fetch(`${base}/api/whatsapp/aviso`, { method: 'POST', headers: { 'content-type': 'application/json', ...(firma ? { 'x-puente-firma': firma } : {}) }, body: c });
    assert.equal((await mandar(null)).status, 401, 'sin firma');
    assert.equal((await mandar(S.firmarAviso('otra-clave-de-veinticuatro-letras', t, cuerpo))).status, 401, 'firmado con otra clave');
    assert.equal((await mandar(S.firmarAviso(CLAVE, t - 3600, cuerpo))).status, 401, 'una firma de hace una hora');
    // El cuerpo cambiado después de firmar (un espacio de más): no.
    assert.equal((await mandar(S.firmarAviso(CLAVE, t, cuerpo), `${cuerpo} `)).status, 401, 'otro cuerpo');
    const buena = S.firmarAviso(CLAVE, t, cuerpo);
    const r = await mandar(buena);
    assert.equal(r.status, 202);
    assert.equal(procesados.length, 1);
    assert.equal(procesados[0].chat, '50499991111@s.whatsapp.net');
    assert.equal(procesados[0].cuenta, 'legado');
    assert.equal((await mandar(buena)).status, 401, 'la misma firma repetida');
    // Bien firmado pero sin lo imprescindible: 400, sin procesar.
    const raro = JSON.stringify({ cuenta: '../otra', id: 'x', chat: 'y' });
    assert.equal((await mandar(S.firmarAviso(CLAVE, t + 1, raro), raro)).status, 400);
    assert.equal(procesados.length, 1);
  } finally {
    await cerrar();
    if (antes === undefined) delete process.env.WHATSAPP_PUENTE_CLAVE;
    else process.env.WHATSAPP_PUENTE_CLAVE = antes;
  }
});

test('el aviso solo le llega a la persona dueña de ESA cuenta (la clave se vuelve a sacar) y con permiso de WhatsApp', async () => {
  _olvidarDuenosCuentaWA();
  const cuenta = 'a'.repeat(40);
  await anotarDuenoCuentaWA(cuenta, 'ana@x.hn');
  await anotarDuenoCuentaWA(cuenta, 'intruso@x.hn');
  await anotarDuenoCuentaWA(cuenta, 'suspendida@x.hn');
  assert.deepEqual((await duenosDeCuentaWA(cuenta)).sort(), ['ana@x.hn', 'intruso@x.hn', 'suspendida@x.hn']);
  const alertados: string[] = [];
  const r = await S.procesarAvisoWhatsapp(
    { cuenta, id: 'M9', chat: '50499991111@s.whatsapp.net', de: '50499991111@s.whatsapp.net', nombreDe: 'Beto', grupo: false, hora: DIEZ_AM, tipo: 'texto', texto: 'Urgente' },
    {
      // Solo la clave de Ana es esa cuenta; el registro dice «intruso» pero su clave es otra.
      claveDe: (c) => (c === 'ana@x.hn' || c === 'suspendida@x.hn' ? cuenta : 'b'.repeat(40)),
      permitido: async (c) => c !== 'suspendida@x.hn',
      alertar: async (c, e) => (alertados.push(`${c}:${e.nombre}:${e.numero}`), { correo: c, avisado: true, porque: 'aceptado' }),
    }
  );
  assert.deepEqual(alertados, ['ana@x.hn:Beto:+50499991111']);
  assert.equal(r.find((x) => x.correo === 'intruso@x.hn')?.porque, 'no es su cuenta');
  assert.equal(r.find((x) => x.correo === 'suspendida@x.hn')?.porque, 'sin permiso de WhatsApp');
});

test('la vuelta del correo: solo lo nuevo (lo de ayer no llueve al arrancar) y por el mismo triaje', async () => {
  const alertas: any[] = [];
  const r = await S.revisarCorreoParaAlertas('jose@x.hn', {
    cuentas: async () => ({ ok: true, cuentas: [{ id: 'abc123', correo: 'jose@prueba.hn' }] }),
    noLeidos: async () => [
      { ref: 'abc123:10', de: 'Banco', deCorreo: 'avisos@banco.hn', asunto: 'Pago rechazado', fecha: new Date(DIEZ_AM - 5 * 60_000).toISOString(), extracto: 'Urgente: su transferencia fue rechazada' },
      { ref: 'abc123:9', de: 'Viejo', deCorreo: 'v@x.hn', asunto: 'De ayer', fecha: new Date(DIEZ_AM - 26 * 3600_000).toISOString() },
    ],
    alertar: async (c, e) => (alertas.push(e), { correo: c, avisado: true, porque: 'aceptado' }),
    ahora: () => DIEZ_AM,
  });
  assert.equal(r.length, 1);
  assert.equal(alertas[0].canal, 'correo');
  assert.equal(alertas[0].chat, 'abc123:10');
  assert.equal(alertas[0].correoDe, 'avisos@banco.hn');
  // Sus cuentas no se pudieron leer: no se avisa nada (y no se inventa).
  assert.deepEqual(await S.revisarCorreoParaAlertas('jose@x.hn', { cuentas: async () => ({ ok: false }), alertar: async () => assert.fail('no') }), []);
});

test('la lista VIP: agregar (por voz o por la app), reconocer por número, correo o nombre exacto, y quitar', async () => {
  V._olvidarVips();
  const q = 'lista@x.hn';
  const r = await correrTriajeConEstado(q, 'vip agregar Ana Paz | +504 9999-1111 | ', '');
  assert.equal(r.estado, 'succeeded');
  assert.match(r.texto, /^VIP GUARDADO: Ana Paz\. Lo reconoceré por su número \(\+50499991111\)/);
  assert.equal(r.recibo?.efecto, 'guardado');
  await correrTriajeConEstado(q, 'vip agregar avisos@banco.hn', '');
  await correrTriajeConEstado(q, 'vip agregar Mamá', '');
  const l = await correrTriajeConEstado(q, 'vip listar', '');
  assert.match(l.texto, /VIP \(3\): Ana Paz \(\+50499991111\) · avisos@banco\.hn <avisos@banco\.hn> · Mamá/);
  const { contactos } = (await V.vipsDe(q)) as { ok: true; contactos: import('../lib/contactos-vip').ContactoVip[] };
  assert.equal(V.vipDe(contactos, { nombre: 'otro nombre', numero: '99991111' })?.nombre, 'Ana Paz');
  assert.equal(V.vipDe(contactos, { correo: 'AVISOS@banco.hn' })?.correo, 'avisos@banco.hn');
  assert.equal(V.vipDe(contactos, { nombre: 'mama' })?.nombre, 'Mamá');
  assert.equal(V.vipDe(contactos, { nombre: 'Mamá Lucha' }), null, 'por nombre, solo el exacto');
  const fuera = await correrTriajeConEstado(q, 'vip quitar +50499991111', '');
  assert.match(fuera.texto, /^VIP QUITADO: Ana Paz/);
  const nada = await correrTriajeConEstado(q, 'vip quitar Nadie', '');
  assert.equal(nada.estado, 'failed');
});

/* ── el teléfono ─────────────────────────────────────────────────────────────────────────── */

test('el teléfono: enseña el aviso con la sugerencia y, al tocarlo, abre ese chat con la sugerencia como borrador', () => {
  const para = 'u0123456789abcdef';
  const k = { AndroidImportance: { HIGH: 4 }, AndroidVisibility: { PRIVATE: 0, PUBLIC: 1 }, TriggerType: { TIMESTAMP: 0 }, AlarmType: { SET_AND_ALLOW_WHILE_IDLE: 0 }, AndroidCategory: { CALL: 'call', ALARM: 'alarm' }, EventType: { DISMISSED: 0, PRESS: 1, ACTION_PRESS: 2, DELIVERED: 3 } } as any;
  const datos = { aura: 'push', tipo: 'mensaje-externo', id: 'mx0123456789abcdef01234567', para, enviado: String(DIEZ_AM), canal: 'whatsapp', titulo: 'WhatsApp · Ana Paz', texto: 'Ana Paz: «¿Viste la cotización?»', sugerencia: 'Hola Ana, ya vi tu mensaje. Te respondo en un rato.', chat: '50499991111@s.whatsapp.net', nombre: 'Ana Paz', abrir: 'whatsapp' };
  const p = L.leerDatos(datos)!;
  assert.equal(p.tipo, 'mensaje-externo');
  const plan = L.planear(p, { dueno: para, ahora: DIEZ_AM, k });
  assert.equal(plan.que, 'mostrar');
  if (plan.que === 'mostrar') {
    assert.equal(plan.aviso.title, 'WhatsApp · Ana Paz');
    assert.match(String(plan.aviso.body), /Sugerencia: «Hola Ana/);
    assert.equal((plan.aviso.android as any).visibility, 0, 'privado en la pantalla bloqueada');
  }
  assert.deepEqual(L.destinoMensajeExterno(p), { abrir: 'whatsapp', chat: '50499991111@s.whatsapp.net', nombre: 'Ana Paz', borrador: 'Hola Ana, ya vi tu mensaje. Te respondo en un rato.' });
  // De otra cuenta: no se enseña. Un chat que no es un jid: el aviso no vale.
  assert.equal(L.planear(p, { dueno: 'ufedcba9876543210', ahora: DIEZ_AM, k }).que, 'ignorar');
  assert.equal(L.leerDatos({ ...datos, chat: 'javascript:alert(1)' }), null);
  // El pedido «abre ese chat con este borrador»: una sola vez, y vence.
  assert.equal(P.pedirChatWA({ jid: 'no es un jid', borrador: 'x' }), false);
  assert.equal(P.pedirChatWA({ jid: '50499991111@s.whatsapp.net', nombre: 'Ana Paz', borrador: 'Hola Ana' }, DIEZ_AM), true);
  let avisado = 0;
  const dejar = P.alPedirChatWA(() => avisado++);
  P.pedirChatWA({ jid: '50499991111@s.whatsapp.net', nombre: 'Ana Paz', borrador: 'Hola Ana' }, DIEZ_AM);
  dejar();
  assert.equal(avisado, 1);
  assert.deepEqual(P.tomarPedidoWA(DIEZ_AM + 1000), { jid: '50499991111@s.whatsapp.net', nombre: 'Ana Paz', borrador: 'Hola Ana', en: DIEZ_AM });
  assert.equal(P.tomarPedidoWA(DIEZ_AM + 2000), null, 'una sola vez');
  P.pedirChatWA({ jid: '50499991111@s.whatsapp.net', borrador: 'tarde' }, DIEZ_AM);
  assert.equal(P.tomarPedidoWA(DIEZ_AM + P.VIDA_PEDIDO_MS + 1), null, 'vencido');
  // Un correo importante: abre sus correos y AURA dice de quién es.
  const c = L.leerDatos({ ...datos, canal: 'correo', chat: 'abc123:10', abrir: 'correos', texto: 'Banco: «Pago rechazado»' })!;
  assert.deepEqual(L.destinoMensajeExterno(c), { abrir: 'correos', decir: 'Banco: «Pago rechazado»' });
});
