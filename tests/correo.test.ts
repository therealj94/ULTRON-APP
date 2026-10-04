/**
 * Las manos de correo (lib/correo, server/correo.ts).
 *  · Siempre: detectar proveedores, cifrar, el «sí»/«no» al borrador, escribir → borrador → «sí» →
 *    sale por un SMTP de verdad (smtp-server, local) y nada sale sin el «sí».
 *  · Con un Dovecot local (CORREO_DOVECOT_PUERTO, ver docs/CORREO.md): revisar, buscar, leer, contestar y
 *    que quede en Enviados, contra un IMAP de verdad.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { SMTPServer } from 'smtp-server';
import { simpleParser, type ParsedMail } from 'mailparser';
import { detectarProveedor, leerAutoconfig } from '../lib/correo/proveedores';
import { agregarCuenta, cifrar, cuentasDe, descifrar, _olvidarCuentas } from '../lib/correo/cuentas';
import { _redLocalEnPruebas, explicarFallo, probarCuenta, sinCitas, htmlATexto, limpiarCuerpo, enTrozos, decodificarParte, partesDe, extractoDe, type Envio, type Mensaje, type Resumen } from '../lib/correo/buzon';
import tlsMod from 'node:tls';
import nodemailer from 'nodemailer';
import { avisosDeEnvio, borradorDe, correrCorreo, elegirCorreo, fechaHN, resolverBorrador, respuestaAlBorrador, _buzonDePrueba, _olvidarCorreo } from '../server/correo';
import { ipPublicaDe } from '../lib/red-publica';
import { extraerPedidoHerramienta, instruccionHarness } from '../lib/harness';
import { tareaDe, _olvidarTareas } from '../lib/tarea-en-curso';
import { plegar } from '../lib/cerebro-comun';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'correo-'));
process.env.CORREO_CLAVE_CIFRADO = 'llave-de-prueba';
process.env.ULTRON_CORREO_DIR = DIR;
// La tarea en curso y lo que quedó a medias, en un temporal (nunca en data/ del repositorio).
process.env.ULTRON_TAREA_CURSO_DIR = path.join(DIR, 'tarea-en-curso');
process.env.ULTRON_ABIERTOS_DIR = path.join(DIR, 'abiertos');
// El registro durable de los envíos (lib/durable.ts sin S3), también en el temporal.
process.env.ULTRON_DURABLE_DIR = path.join(DIR, 'durable');

/** Un certificado propio para los servidores locales de la prueba. */
function certificado() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  // node no firma X.509 solo: se usa el de openssl si está; si no, la prueba de SMTP se salta.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-'));
  const llave = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  fs.writeFileSync(llave, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const r = spawnSync('openssl', ['req', '-x509', '-key', llave, '-out', cert, '-days', '1', '-subj', '/CN=localhost']);
  return r.status === 0 ? { key: fs.readFileSync(llave), cert: fs.readFileSync(cert) } : null;
}

const XML_YAHOO = `<clientConfig version="1.1"><emailProvider id="yahoo.com"><displayName>Yahoo! Mail</displayName>
<incomingServer type="pop3"><hostname>pop.mail.yahoo.com</hostname><port>995</port><socketType>SSL</socketType><username>%EMAILADDRESS%</username></incomingServer>
<incomingServer type="imap"><hostname>imap.plano.com</hostname><port>143</port><socketType>plain</socketType><username>%EMAILADDRESS%</username></incomingServer>
<incomingServer type="imap"><hostname>imap.mail.yahoo.com</hostname><port>993</port><socketType>SSL</socketType><username>%EMAILADDRESS%</username></incomingServer>
<outgoingServer type="smtp"><hostname>smtp.mail.yahoo.com</hostname><port>465</port><socketType>SSL</socketType><username>%EMAILADDRESS%</username></outgoingServer>
</emailProvider></clientConfig>`;

test('detectar: conocidos, la base de Thunderbird, el MX de Google/Microsoft y el hosting propio', async () => {
  const sinRed = { traer: async () => null, mx: async () => [] };
  assert.equal((await detectarProveedor('a@gmail.com', sinRed))?.imap.host, 'imap.gmail.com');
  assert.equal((await detectarProveedor('a@hotmail.com', sinRed))?.auth, 'microsoft', 'Outlook ya no acepta contraseñas');
  // Orden Global: conocido, solo correo y contraseña (sin servidores a mano ni «adivinado»).
  const og = await detectarProveedor('Ana@OrdenGlobal.org', sinRed);
  assert.equal(og?.nombre, 'Orden Global');
  assert.equal(og?.fuente, 'conocido');
  assert.equal(og?.auth, 'clave');
  assert.deepEqual([og?.imap.host, og?.imap.puerto, og?.smtp.host, og?.smtp.puerto], ['mail.ordenglobal.org', 993, 'mail.ordenglobal.org', 465]);
  const isp = await detectarProveedor('a@raro.com', { traer: async (u) => (u.includes('thunderbird') ? XML_YAHOO : null), mx: async () => [] });
  assert.equal(isp?.fuente, 'ispdb');
  assert.deepEqual(isp?.imap, { host: 'imap.mail.yahoo.com', puerto: 993, seguro: true }, 'nunca el IMAP sin cifrar');
  const gw = await detectarProveedor('a@empresa.hn', { traer: async () => null, mx: async () => ['aspmx.l.google.com'] });
  assert.equal(gw?.nombre, 'Google Workspace');
  const m365 = await detectarProveedor('a@unah.edu.hn', { traer: async () => null, mx: async () => ['unah-edu-hn.mail.protection.outlook.com'] });
  assert.equal(m365?.auth, 'microsoft');
  const propio = await detectarProveedor('a@mineraelsol.hn', sinRed);
  assert.equal(propio?.imap.host, 'mail.mineraelsol.hn');
  assert.equal(propio?.fuente, 'adivinado');
  assert.equal(await detectarProveedor('no-es-correo', sinRed), null);
  assert.equal(leerAutoconfig('<x/>'), null);
});

test('los servidores internos no se tocan aunque el dominio los anuncie (ProtonMail Bridge, 127.0.0.1)', async () => {
  await assert.rejects(ipPublicaDe('127.0.0.1'), /interno/);
  await assert.rejects(ipPublicaDe('localhost'), /interno/);
  await assert.rejects(ipPublicaDe('10.0.0.5'), /interno/);
  assert.equal(await ipPublicaDe('8.8.8.8'), '8.8.8.8');
});

test('la clave se guarda cifrada y no se puede alterar', async () => {
  const s = cifrar('clave-secreta');
  assert.ok(!s.includes('clave-secreta'));
  assert.equal(descifrar(s), 'clave-secreta');
  const partes = s.split('.');
  partes[3] = Buffer.from('otra cosa').toString('base64');
  assert.throws(() => descifrar(partes.join('.')));
  _olvidarCuentas();
  await agregarCuenta('pepe@x.hn', 'pepe@gmail.com', { nombre: 'Gmail', imap: { host: 'imap.gmail.com', puerto: 993, seguro: true }, smtp: { host: 'smtp.gmail.com', puerto: 465, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: true }, 'abcd efgh ijkl mnop');
  const enDisco = fs.readdirSync(DIR).map((f) => fs.readFileSync(path.join(DIR, f), 'utf8')).join('');
  assert.ok(!enDisco.includes('abcd efgh'), 'en disco no está en claro');
  assert.ok(!enDisco.includes('pepe@x.hn'), 'ni el correo de la persona en el nombre del archivo');
  _olvidarCuentas();
  assert.equal((await cuentasDe('PEPE@x.hn'))[0].correo, 'pepe@gmail.com', 'se vuelve a leer de disco');
});

test('«sí» y «no» al borrador: solo frases cortas y claras', () => {
  for (const t of ['sí', 'Sí, mándalo', 'dale', 'mándalo', 'ok', 'envíalo por favor', 'perfecto']) assert.equal(respuestaAlBorrador(t), 'si', t);
  for (const t of ['no', 'mejor no', 'cancélalo', 'espera']) assert.equal(respuestaAlBorrador(t), 'no', t);
  // Auditoría, 3-oct: antes «claro que no» y «sí, no lo mandes» MANDABAN el borrador (solo se miraba la primera palabra).
  for (const t of ['claro que no', 'sí, no lo mandes', 'dale, no', 'no, sí mándalo']) assert.equal(respuestaAlBorrador(t), null, t);
  // COM01: «sí espera» y «ok cancela» antes MANDABAN el borrador.
  for (const t of ['sí espera', 'ok cancela', 'dale, para', 'sí, cancélalo', 'listo, alto']) assert.equal(respuestaAlBorrador(t), null, t);
  for (const t of ['mándalo para el lunes', 'sí, envíalo para Juan']) assert.equal(respuestaAlBorrador(t), 'si', t);
  for (const t of ['sí pero cámbiale el saludo', 'qué hora es', 'sí, y además dime cuántos correos tengo sin leer hoy']) assert.equal(respuestaAlBorrador(t), null, t);
});

test('el borrador va atado a su dueño, su cuenta, su intento y su vencimiento: un «sí» no manda uno vencido ni ajeno (auditoría 3-oct, COM01)', async () => {
  const mandados: Envio[] = [];
  _buzonDePrueba({ mandar: async (_q, _c, e) => (mandados.push(e), { aceptados: e.para, rechazados: [], guardadoEnEnviados: false }) as any });
  _olvidarCorreo();
  _olvidarCuentas();
  const realAhora = Date.now;
  try {
    await agregarCuenta('mia@x.hn', 'mia@prueba.hn', { nombre: 'Prueba', imap: { host: '127.0.0.1', puerto: 993, seguro: true }, smtp: { host: '127.0.0.1', puerto: 465, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: false }, 'clave');
    const retener = () => {
      const r: { hacer: (() => void) | null; descartar: (() => void) | null } = { hacer: null, descartar: null };
      return { r, opciones: { hacer: (f: () => void) => (r.hacer = f), alDescartar: (f: () => void) => (r.descartar = f) } };
    };
    // Otra persona en el mismo teléfono: su «sí» no manda el borrador de Mía.
    await correrCorreo('mia@x.hn', 'escribir beto@empresa.hn | Hola | ¿nos vemos?', 'tel');
    assert.equal(await resolverBorrador('ana@x.hn', 'tel', 'sí'), null);
    assert.ok(borradorDe('mia@x.hn', 'tel'));
    // En la voz: dijo «sí», pero el turno se confirma cuando el borrador ya venció: no sale.
    const v = retener();
    assert.match((await resolverBorrador('mia@x.hn', 'tel', 'sí', v.opciones as any))!, /se manda a beto@empresa\.hn en cuanto termine este turno/);
    Date.now = () => realAhora() + 16 * 60_000;
    v.r.hacer!();
    await new Promise((res) => setTimeout(res, 50));
    Date.now = realAhora;
    assert.equal(mandados.length, 0, 'vencido: no se manda');
    assert.match(avisosDeEnvio('mia@x.hn', 'tel').join(' '), /NO se mandó: el borrador venció/);
    // Dijo «sí» en un turno que luego se descartó, y mientras se armó OTRO borrador: el viejo no pisa al nuevo.
    await correrCorreo('mia@x.hn', 'escribir beto@empresa.hn | Viejo | el de antes', 'tel');
    const d = retener();
    await resolverBorrador('mia@x.hn', 'tel', 'sí', d.opciones as any);
    await correrCorreo('mia@x.hn', 'escribir carla@empresa.hn | Nuevo | el de ahora', 'tel');
    d.r.descartar!();
    assert.equal(borradorDe('mia@x.hn', 'tel')!.asunto, 'Nuevo', 'el que espera es el último que se le leyó');
    // La cuenta con que se armó ya no está (cambió de cuenta): un «sí» no lo manda por otra.
    _olvidarCuentas();
    const { quitarCuenta } = await import('../lib/correo/cuentas');
    for (const c of await cuentasDe('mia@x.hn')) await quitarCuenta('mia@x.hn', c.id);
    await agregarCuenta('mia@x.hn', 'otra@prueba.hn', { nombre: 'Prueba', imap: { host: '127.0.0.1', puerto: 993, seguro: true }, smtp: { host: '127.0.0.1', puerto: 465, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: false }, 'clave');
    assert.match((await resolverBorrador('mia@x.hn', 'tel', 'sí'))!, /NO lo mandé|no lo mandé/i);
    assert.equal(mandados.length, 0);
    // Lo legítimo sigue: un borrador nuevo con la cuenta de ahora y un «sí» claro sale.
    await correrCorreo('mia@x.hn', 'escribir beto@empresa.hn | Hola | ya está', 'tel');
    assert.match((await resolverBorrador('mia@x.hn', 'tel', 'sí, mándalo'))!, /CORREO ENVIADO desde otra@prueba\.hn a beto@empresa\.hn/);
    assert.equal(mandados.length, 1);
  } finally {
    Date.now = realAhora;
    _buzonDePrueba(null);
    _olvidarCorreo();
    const { quitarCuenta } = await import('../lib/correo/cuentas');
    for (const c of await cuentasDe('mia@x.hn')) await quitarCuenta('mia@x.hn', c.id);
  }
});

test('el cerebro pide «correo …» y la instrucción le dice que nada sale sin el sí', () => {
  assert.deepEqual(extraerPedidoHerramienta('Va.\nPEDIR_HERRAMIENTA: correo responder 2 | Sí la recibí'), { herramienta: 'correo', arg: 'responder 2 | Sí la recibí' });
  assert.match(instruccionHarness('miembro', false), /PEDIR_HERRAMIENTA: correo revisar/);
  assert.match(instruccionHarness('miembro', false), /Nunca digas que ya salió si no te llegó «CORREO ENVIADO»/);
});

test('sin citas y de HTML a texto', () => {
  assert.equal(sinCitas('Hola\nGracias\n\nEl lun, 1 oct 2026, Ana escribió:\n> viejo'), 'Hola\nGracias');
  assert.equal(htmlATexto('<p>Tu <b>pago</b> fue recibido.</p><script>x()</script>'), 'Tu pago fue recibido.');
});

test('escribir deja un borrador; nada sale hasta el «sí»; el «sí» lo manda el servidor por SMTP de verdad', async (t) => {
  const tls = certificado();
  if (!tls) return t.skip('sin openssl para el certificado de prueba');
  const recibidos: ParsedMail[] = [];
  const smtp = new SMTPServer({
    secure: true, ...tls,
    onAuth: (a, _s, cb) => cb(a.password === 'clave-buena' ? null : new Error('mala'), { user: a.username }),
    onRcptTo: (a, _s, cb) => cb(/^nadie@/.test(a.address) ? Object.assign(new Error('no existe'), { responseCode: 550 }) : undefined),
    onData: (st, _s, cb) => void simpleParser(st).then((m) => (recibidos.push(m), cb())),
  });
  await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', r));
  const puerto = (smtp.server.address() as any).port;
  _redLocalEnPruebas(true);
  _olvidarCorreo();
  _olvidarCuentas();
  try {
    await agregarCuenta('lola@x.hn', 'lola@prueba.hn', { nombre: 'Prueba', imap: { host: '127.0.0.1', puerto: 993, seguro: true }, smtp: { host: '127.0.0.1', puerto, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: true }, 'clave-buena');
    assert.match(await correrCorreo('lola@x.hn', 'escribir no-es-correo | Hola | texto', 'tel'), /no es una dirección/);
    const b = await correrCorreo('lola@x.hn', 'escribir beto@empresa.hn | Reunión | Beto, ¿nos vemos el jueves a las 3?', 'tel');
    assert.match(b, /BORRADOR \(NO enviado\)/);
    assert.match(b, /Léeselo tal cual/);
    assert.equal(recibidos.length, 0, 'el borrador no sale solo');
    assert.equal(await resolverBorrador('lola@x.hn', 'web', 'sí'), null, 'un «sí» en otra conversación no manda el borrador del teléfono');
    assert.equal(borradorDe('lola@x.hn', 'web'), null);
    assert.equal(recibidos.length, 0);
    assert.ok(borradorDe('lola@x.hn', 'tel'), 'y sigue esperando');
    // Otra cosa en el turno siguiente: el chat ya no lo resuelve (auditoría 2-oct: un «ok» de después no manda nada),
    // pero el borrador espera la decisión del panel hasta que venza (AUR08).
    assert.match((await resolverBorrador('lola@x.hn', 'tel', 'qué hora es'))!, /NO se mandó\. Queda en su panel de tareas/);
    assert.equal(borradorDe('lola@x.hn', 'tel')?.soloPanel, true, 'apartado para el panel, no tirado');
    assert.equal(await resolverBorrador('lola@x.hn', 'tel', 'ok'), null, 'y un «ok» después no manda nada');
    assert.equal(await resolverBorrador('lola@x.hn', 'tel', 'sí'), null, 'ni un «sí» suelto');
    assert.equal(recibidos.length, 0);
    await correrCorreo('lola@x.hn', 'escribir beto@empresa.hn | Reunión | Beto, ¿nos vemos el jueves a las 3?', 'tel');
    const enviado = await resolverBorrador('lola@x.hn', 'tel', 'Sí, mándalo');
    assert.match(enviado!, /CORREO ENVIADO desde lola@prueba.hn a beto@empresa.hn/);
    assert.equal(recibidos.length, 1);
    assert.equal(recibidos[0].subject, 'Reunión');
    assert.match(recibidos[0].text || '', /jueves a las 3/);
    assert.equal(borradorDe('lola@x.hn', 'tel'), null, 'una vez mandado, ya no hay borrador');
    assert.equal(await resolverBorrador('lola@x.hn', 'tel', 'sí'), null, 'un segundo «sí» no manda nada más');
    // «no» lo descarta sin mandar.
    await correrCorreo('lola@x.hn', 'escribir beto@empresa.hn | Otro | otro texto', 'tel');
    assert.match((await resolverBorrador('lola@x.hn', 'tel', 'no'))!, /no se mandó/);
    assert.equal(recibidos.length, 1);
    // El servidor acepta a uno y rechaza a otro: se dice a quién NO le llegó.
    await correrCorreo('lola@x.hn', 'escribir beto@empresa.hn, nadie@empresa.hn | Aviso | texto', 'tel');
    const parcial = (await resolverBorrador('lola@x.hn', 'tel', 'sí'))!;
    assert.match(parcial, /CORREO ENVIADO desde lola@prueba.hn a beto@empresa.hn —/);
    assert.match(parcial, /rechazó nadie@empresa.hn/);
    assert.equal(recibidos.length, 2);
    // Todos rechazados: NO se dice «enviado».
    await correrCorreo('lola@x.hn', 'escribir nadie@empresa.hn | Aviso | texto', 'tel');
    const nada = (await resolverBorrador('lola@x.hn', 'tel', 'sí'))!;
    assert.doesNotMatch(nada, /CORREO ENVIADO/);
    assert.match(nada, /NO se (pudo )?mand(ó|ar)/);
    assert.equal(recibidos.length, 2);
    // AUR08: el borrador apartado (siguió con otra cosa) lo manda «Aprobar» del panel, y una sola vez.
    await correrCorreo('lola@x.hn', 'escribir beto@empresa.hn | Panel | lo apruebo desde el panel', 'tel');
    assert.match((await resolverBorrador('lola@x.hn', 'tel', 'y el clima?'))!, /Queda en su panel de tareas/);
    assert.equal(await resolverBorrador('lola@x.hn', 'tel', 'sí'), null);
    assert.equal(recibidos.length, 2, 'el chat no lo mandó');
    // «Aprobar» lleva la huella de lo que mostró la tarjeta (revisión 4-oct): sin ella, nada sale.
    const huellaPanel = borradorDe('lola@x.hn', 'tel')!.huella;
    assert.match((await resolverBorrador('lola@x.hn', 'tel', 'sí', undefined, { desdePanel: true }))!, /NO se mandó: el panel no dijo qué versión aprobó/);
    assert.equal(recibidos.length, 2);
    assert.match((await resolverBorrador('lola@x.hn', 'tel', 'sí', undefined, { desdePanel: true, huella: huellaPanel }))!, /CORREO ENVIADO desde lola@prueba.hn a beto@empresa.hn — «Panel»/);
    assert.equal(recibidos.length, 3);
    assert.equal(borradorDe('lola@x.hn', 'tel'), null, 'mandado: ya no espera');
    assert.equal(await resolverBorrador('lola@x.hn', 'tel', 'sí', undefined, { desdePanel: true, huella: huellaPanel }), null, 'un segundo «Aprobar» no manda nada');
    assert.equal(recibidos.length, 3);
    assert.match(await correrCorreo('otra@x.hn', 'revisar'), /no tiene ningún correo conectado/, 'sin cuentas, lo dice');
    assert.match(await correrCorreo('', 'revisar'), /solo con sesión/);
  } finally {
    _redLocalEnPruebas(false);
    await new Promise<void>((r) => smtp.close(() => r()));
  }
});

test('con un IMAP de verdad (Dovecot local): revisar, buscar, leer, contestar y guardarse en Enviados', async (t) => {
  const puertoImap = Number(process.env.CORREO_DOVECOT_PUERTO || 0);
  const usuario = process.env.CORREO_DOVECOT_USUARIO || '';
  const clave = process.env.CORREO_DOVECOT_CLAVE || '';
  const tls = certificado();
  if (!puertoImap || !usuario || !tls) return t.skip('sin Dovecot local (CORREO_DOVECOT_PUERTO/USUARIO/CLAVE)');
  const { ImapFlow } = await import('imapflow');
  const recibidos: ParsedMail[] = [];
  const smtp = new SMTPServer({ secure: true, ...tls, onAuth: (a, _s, cb) => cb(null, { user: a.username }), onData: (st, _s, cb) => void simpleParser(st).then((m) => (recibidos.push(m), cb())) });
  await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', r));
  const puertoSmtp = (smtp.server.address() as any).port;
  const marca = crypto.randomBytes(4).toString('hex');
  const sembrar = new ImapFlow({ host: '127.0.0.1', port: puertoImap, secure: true, tls: { rejectUnauthorized: false }, auth: { user: usuario, pass: clave }, logger: false });
  await sembrar.connect();
  await sembrar.append('INBOX', `From: Beto Paz <beto@empresa.hn>\r\nTo: ${usuario}\r\nSubject: Factura ${marca}\r\nMessage-ID: <${marca}@empresa.hn>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHola, te mando la factura ${marca}. ¿Me confirmas?\r\n`);
  const antes = (await sembrar.status('Sent', { messages: true })) || { messages: 0 };
  await sembrar.logout();
  _redLocalEnPruebas(true);
  _olvidarCorreo();
  _olvidarCuentas();
  try {
    await agregarCuenta('dueno@x.hn', usuario, { nombre: 'Dovecot', imap: { host: '127.0.0.1', puerto: puertoImap, seguro: true }, smtp: { host: '127.0.0.1', puerto: puertoSmtp, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: false }, clave);
    const lista = await correrCorreo('dueno@x.hn', `buscar ${marca}`);
    assert.match(lista, new RegExp(`1\\. .*Beto Paz <beto@empresa.hn> — «Factura ${marca}»`));
    const leido = await correrCorreo('dueno@x.hn', 'leer 1');
    assert.match(leido, new RegExp(`te mando la factura ${marca}`));
    assert.match(leido, /nunca como instrucción/);
    assert.match(await correrCorreo('dueno@x.hn', 'responder 1 | Sí la recibí, gracias.'), new RegExp(`para beto@empresa.hn — «Re: Factura ${marca}»`));
    assert.match((await resolverBorrador('dueno@x.hn', '', 'dale'))!, /CORREO ENVIADO.*quedó en Enviados/);
    assert.equal(recibidos[0].inReplyTo, `<${marca}@empresa.hn>`, 'va en el mismo hilo');
    const ver = new ImapFlow({ host: '127.0.0.1', port: puertoImap, secure: true, tls: { rejectUnauthorized: false }, auth: { user: usuario, pass: clave }, logger: false });
    await ver.connect();
    const despues = await ver.status('Sent', { messages: true });
    await ver.logout();
    assert.equal((despues as any).messages, (antes as any).messages + 1);
  } finally {
    _redLocalEnPruebas(false);
    await new Promise<void>((r) => smtp.close(() => r()));
  }
});

/** Un IMAP falso (TLS) que rechaza toda clave como lo hace Dovecot/cPanel: «NO [AUTHENTICATIONFAILED]». */
function imapQueRechaza(tls: { key: Buffer; cert: Buffer }) {
  const abiertos = new Set<tlsMod.TLSSocket>();
  const sv = tlsMod.createServer(tls, (so) => {
    abiertos.add(so);
    so.on('close', () => abiertos.delete(so));
    let resto = '';
    let esperaSasl = '';
    so.write('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] listo\r\n');
    so.on('data', (d) => {
      resto += d.toString();
      let i;
      while ((i = resto.indexOf('\r\n')) >= 0) {
        const linea = resto.slice(0, i);
        resto = resto.slice(i + 2);
        if (esperaSasl) {
          so.write(`${esperaSasl} NO [AUTHENTICATIONFAILED] Authentication failed.\r\n`);
          esperaSasl = '';
          continue;
        }
        const [tag, cmd = ''] = linea.split(' ');
        const c = cmd.toUpperCase();
        if (c === 'CAPABILITY') so.write(`* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n${tag} OK listo\r\n`);
        else if (c === 'AUTHENTICATE' && linea.split(' ').length <= 3) { esperaSasl = tag; so.write('+ \r\n'); }
        else if (c === 'LOGIN' || c === 'AUTHENTICATE') so.write(`${tag} NO [AUTHENTICATIONFAILED] Authentication failed.\r\n`);
        else if (c === 'LOGOUT') { so.write(`* BYE\r\n${tag} OK adios\r\n`); so.end(); }
        else so.write(`${tag} OK listo\r\n`);
      }
    });
    so.on('error', () => {});
  });
  return Object.assign(sv, { cerrarTodo: () => { for (const so of abiertos) so.destroy(); sv.close(); } });
}

test('la prueba de la cuenta dice QUÉ pasó: la clave, el servidor que no contesta o el certificado (José, 2-oct)', async (t) => {
  const tls = certificado();
  if (!tls) return t.skip('sin openssl para el certificado de prueba');
  _redLocalEnPruebas(true);
  // 1) IMAP que rechaza la clave (de verdad, por TLS): dice que es la clave y qué hacer.
  const imap = imapQueRechaza(tls);
  await new Promise<void>((r) => imap.listen(0, '127.0.0.1', r));
  const pImap = (imap.address() as any).port;
  // 2) Un puerto donde nadie contesta.
  const libre = await new Promise<number>((r) => { const sv = tlsMod.createServer(tls).listen(0, '127.0.0.1', () => { const p = (sv.address() as any).port; sv.close(() => r(p)); }); });
  // 3) SMTP que rechaza la clave (smtp-server): el error real de nodemailer.
  const smtp = new SMTPServer({ secure: true, ...tls, onAuth: (_a, _s, cb) => cb(new Error('Invalid username or password')) });
  await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', r));
  const pSmtp = (smtp.server.address() as any).port;
  try {
    const r1 = await probarCuenta('j.ordonez@ordenglobal.org', { imap: { host: '127.0.0.1', puerto: pImap, seguro: true }, smtp: { host: '127.0.0.1', puerto: pSmtp, seguro: true }, usuario: 'correo' }, { pass: 'mala' });
    assert.equal(r1.ok, false);
    assert.match((r1 as any).error, /^No pude entrar a leer\. 127\.0\.0\.1 no aceptó la clave\..*contraseña de aplicación/);
    const r2 = await probarCuenta('a@b.hn', { imap: { host: '127.0.0.1', puerto: libre, seguro: true }, smtp: { host: '127.0.0.1', puerto: pSmtp, seguro: true }, usuario: 'correo' }, { pass: 'x' });
    assert.match((r2 as any).error, new RegExp(`no contestó en el puerto ${libre} \\(para leer suele ser 993\\)`));
    const tr = nodemailer.createTransport({ host: '127.0.0.1', port: pSmtp, secure: true, tls: { rejectUnauthorized: false }, auth: { user: 'a@b.hn', pass: 'mala' } });
    const e = await tr.verify().then(() => null, (x) => x);
    tr.close();
    assert.ok(e, 'el SMTP rechazó la clave');
    assert.match(explicarFallo(e, 'mail.ordenglobal.org', 465, 'mandar'), /^mail\.ordenglobal\.org no aceptó la clave/);
    // Certificado de otro nombre (lo que pasa con un hosting que no tiene el de mail.<dominio>): no manda la clave.
    const tc = await new Promise<any>((r) => { const so = tlsMod.connect({ host: '127.0.0.1', port: pImap, servername: 'mail.ordenglobal.org' }, () => r(null)); so.on('error', r); });
    assert.ok(tc, 'el certificado propio no vale');
    assert.match(explicarFallo(Object.assign(new Error("Hostname/IP does not match certificate's altnames"), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }), 'mail.x.hn', 993, 'leer'), /certificado de seguridad de mail\.x\.hn no es válido.*Configurar cliente de correo/);
    assert.match(explicarFallo(tc, 'mail.x.hn', 993, 'leer'), /certificado de seguridad/);
    assert.match(explicarFallo(Object.assign(new Error('getaddrinfo ENOTFOUND mail.nohay.hn'), { code: 'ENOTFOUND' }), 'mail.nohay.hn', 993, 'leer'), /No existe el servidor mail\.nohay\.hn/);
  } finally {
    imap.cerrarTodo();
    await new Promise<void>((r) => smtp.close(() => r()));
    _redLocalEnPruebas(false);
  }
});

/* ------------------------------------------------------------------ leer bien y contestar bien (José, 2-oct) */

test('lectura limpia: HTML con entidades y lo escondido, firma, aviso legal, lo citado y los enlaces', () => {
  const html =
    '<html><head><title>Banco</title><style>.x{color:red}</style></head><body>' +
    '<div style="display:none">Texto escondido del boletín</div>' +
    '<p>Estimada cliente:</p><p>Su estado de cuenta de septiembre ya est&aacute; disponible. Saldo: L.&nbsp;12,500.00 &#8212; gracias.</p>' +
    '<ul><li>Pagos</li><li>Retiros</li></ul><p><a href="https://www.bancatlan.hn/x?track=1">Ver estado</a><img src="cid:logo"></p></body></html>';
  const t = htmlATexto(html);
  assert.match(t, /^Estimada cliente:\n+Su estado de cuenta de septiembre ya está disponible\. Saldo: L\. 12,500\.00 — gracias\./);
  assert.match(t, /• Pagos\n• Retiros/);
  assert.match(t, /Ver estado/);
  assert.doesNotMatch(t, /escondido|color:red|Banco|<|track=/);
  // Un trozo cortado a la mitad (el extracto lee solo el principio) no deja estilos a la vista.
  assert.equal(htmlATexto('<html><head><style>.a{color:red}.b{'), '');
  const cuerpo = limpiarCuerpo(
    'Hola Lola:\n\n¿Nos vemos el lunes? Mira https://maps.google.com/?q=Tegucigalpa&z=15 para llegar.\n\nSaludos,\nAna\n\n-- \nAna Paz | Gerente\nTel. 9999-0000\n\nEl dom, 28 sep 2026, Lola escribió:\n> hola'
  );
  assert.equal(cuerpo, 'Hola Lola:\n\n¿Nos vemos el lunes? Mira [enlace a maps.google.com] para llegar.\n\nSaludos,\nAna');
  assert.equal(limpiarCuerpo('Listo, va el contrato.\n\nEnviado desde mi iPhone'), 'Listo, va el contrato.');
  assert.equal(limpiarCuerpo('Confirmado.\n\nEste mensaje es confidencial y va dirigido solo a su destinatario.'), 'Confirmado.');
  assert.equal(limpiarCuerpo('Va.\n________________________________\nDe: Ana\nEnviado: lunes'), 'Va.');
  assert.equal(extractoDe('Hola José,\n\nte mando la factura de septiembre para que la revises con calma antes del viernes por favor', 40), 'Hola José, te mando la factura de…');
});

test('trozos para la voz, partes del correo por IMAP (base64, quoted-printable) y adjuntos de la estructura', () => {
  const p = 'Esta es una frase de prueba que se repite. '.repeat(6).trim();
  const tz = enTrozos(`${p}\n\n${p}\n\n${p}`, 600);
  assert.equal(tz.length, 2, 'por párrafos, juntando los que caben');
  assert.ok(tz.every((x) => x.length <= 600));
  assert.ok(enTrozos('x'.repeat(1500), 600).every((x) => x.length <= 600), 'aunque no tenga frases');
  assert.equal(decodificarParte(Buffer.from(Buffer.from('Información útil', 'latin1').toString('base64')), 'base64', 'iso-8859-1'), 'Información útil');
  assert.equal(decodificarParte(Buffer.from('Informaci=C3=B3n =\r\n=C3=BAtil'), 'quoted-printable', 'utf-8'), 'Información útil');
  const est = {
    type: 'multipart/mixed',
    childNodes: [
      { type: 'multipart/related', childNodes: [{ part: '1.1', type: 'text/html', encoding: 'quoted-printable', parameters: { charset: 'utf-8' } }, { part: '1.2', type: 'image/png', disposition: 'inline', id: '<logo>', parameters: { name: 'logo.png' } }] },
      { part: '2', type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'factura.pdf' } },
    ],
  };
  assert.deepEqual(partesDe(est), { texto: { parte: '1.1', codificacion: 'quoted-printable', juego: 'utf-8', html: true }, adjuntos: ['factura.pdf'] });
  assert.equal(partesDe({ type: 'text/plain', encoding: '7bit' }).texto?.parte, '1', 'un correo de una sola parte');
});

test('fecha y hora de Honduras como se dicen', () => {
  const ahora = Date.parse('2026-10-02T18:00:00Z'); // 12:00 m. en Honduras
  assert.equal(fechaHN('2026-10-02T15:15:00Z', ahora), 'hoy 9:15 a. m.');
  assert.equal(fechaHN('2026-10-01T22:30:00Z', ahora), 'ayer 4:30 p. m.');
  assert.equal(fechaHN('2026-09-28T14:05:00Z', ahora), 'el lunes 28 de septiembre, 8:05 a. m.');
  assert.equal(fechaHN('2026-08-03T16:00:00Z', ahora), 'el 3 de agosto, 10:00 a. m.');
  assert.equal(fechaHN('2025-12-24T02:00:00Z', ahora), 'el 23 de diciembre de 2025, 8:00 p. m.');
  assert.equal(fechaHN('2026-10-02T03:00:00Z', ahora), 'ayer 9:00 p. m.', 'a las 3 de la mañana en UTC todavía es ayer en Honduras');
});

test('«léeme el 3», «el de Banco Atlántida», «el último de Ana»: a qué correo se refiere', () => {
  const lista = [
    { de: 'Ana Paz', deCorreo: 'ana@paz.hn', asunto: 'Reunión del lunes' },
    { de: 'Banco Atlántida', deCorreo: 'notificaciones@bancatlan.hn', asunto: 'Estado de cuenta de septiembre' },
    { de: 'Ana Paz', deCorreo: 'ana@paz.hn', asunto: 'Factura' },
    { de: 'beto@empresa.hn', deCorreo: 'beto@empresa.hn', asunto: 'Planos' },
  ];
  assert.deepEqual(elegirCorreo(lista, '3'), { tipo: 'uno', i: 2 });
  assert.deepEqual(elegirCorreo(lista, 'el tercero'), { tipo: 'uno', i: 2 });
  assert.deepEqual(elegirCorreo(lista, 'léeme el correo número 2'), { tipo: 'uno', i: 1 });
  assert.deepEqual(elegirCorreo(lista, 'el de Banco Atlántida'), { tipo: 'uno', i: 1 });
  assert.deepEqual(elegirCorreo(lista, 'el del banco'), { tipo: 'uno', i: 1 });
  assert.deepEqual(elegirCorreo(lista, 'el de la factura'), { tipo: 'uno', i: 2 }, 'por asunto');
  assert.deepEqual(elegirCorreo(lista, 'el que mandó beto'), { tipo: 'uno', i: 3 }, 'por la dirección');
  assert.deepEqual(elegirCorreo(lista, 'Ana'), { tipo: 'varios', is: [0, 2] }, 'dos de Ana: hay que preguntar');
  assert.deepEqual(elegirCorreo(lista, 'el último de Ana'), { tipo: 'uno', i: 0 }, 'el más reciente de Ana');
  assert.deepEqual(elegirCorreo(lista, 'Ana factura'), { tipo: 'uno', i: 2 });
  assert.deepEqual(elegirCorreo(lista, 'el último'), { tipo: 'uno', i: 0 });
  assert.deepEqual(elegirCorreo(lista, '7'), { tipo: 'ninguno', consulta: '', reciente: false });
  assert.deepEqual(elegirCorreo(lista, 'el de la notaría'), { tipo: 'ninguno', consulta: 'notaria', reciente: false });
});

/** Un buzón de mentira (sin IMAP ni SMTP) con lo que trae un correo de verdad. */
function buzonFalso() {
  const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
  const ayer = new Date(Date.now() - 30 * 3600_000).toISOString().slice(0, 10);
  const enviados: Envio[] = [];
  const leidos: number[] = [];
  const res = (uid: number, de: string, deCorreo: string, asunto: string, fecha: string, extra: Partial<Resumen> = {}): Resumen => ({ ref: '', cuenta: 'lola@prueba.hn', de, deCorreo, asunto, fecha, noLeido: true, ...extra, uid } as any);
  const bandeja = [
    res(1, 'Ana Paz', 'ana@paz.hn', 'Reunión del lunes', `${hoy}T16:40:00.000Z`, { extracto: '¿Nos vemos el lunes a las 10 en la oficina? Llevo los planos.' }),
    res(2, 'Banco Atlántida', 'notificaciones@bancatlan.hn', 'Estado de cuenta de septiembre', `${hoy}T15:15:00.000Z`, { adjuntos: ['estado-septiembre.pdf'], extracto: 'Estimada cliente: su estado de cuenta…' }),
    res(3, 'Ana Paz', 'ana@paz.hn', 'Factura', `${ayer}T22:30:00.000Z`),
  ];
  const largo = 'Te cuento cómo quedó la factura de septiembre con todos los detalles que me pediste para revisarla. '.repeat(4).trim();
  const mensajes: Record<number, Partial<Mensaje>> = {
    1: {
      texto: 'Hola Lola:\n\n¿Nos vemos el lunes a las 10 en la oficina? Llevo los planos.\n\nSaludos,\nAna\n\n-- \nAna Paz | Gerente\nTel 9999-0000\n\nEl dom, 28 sep 2026, Lola escribió:\n> ¿cuándo nos vemos?',
      paraCorreos: ['lola@prueba.hn', 'beto@empresa.hn'],
      cc: 'Carla <carla@empresa.hn>, LOLA@prueba.hn',
      ccCorreos: ['carla@empresa.hn', 'LOLA@prueba.hn'],
      para: 'Lola <lola@prueba.hn>, Beto <beto@empresa.hn>',
      messageId: '<r1@paz.hn>',
      referencias: ['<r0@prueba.hn>'],
      responderA: 'ana@paz.hn',
    },
    2: {
      texto: htmlATexto('<head><style>p{}</style></head><div style="display:none">oculto</div><p>Estimada cliente:</p><p>Su estado de cuenta de septiembre ya est&aacute; disponible. Saldo: L.&nbsp;12,500.00</p><p>Detalles: https://www.bancatlan.hn/estado?id=123&amp;track=abc</p>'),
      adjuntos: [{ nombre: 'estado-septiembre.pdf', tipo: 'application/pdf', bytes: 123_456 }],
      responderA: 'no-responder@bancatlan.hn',
    },
    3: { texto: `${largo}\n\n${largo}\n\n${largo}\n\n${largo}`, responderA: 'ana@paz.hn' },
    9: { texto: 'Su escritura ya está lista para firmar el jueves.', responderA: 'notaria@lopez.hn' },
  };
  const notaria = res(9, 'Notaría López', 'notaria@lopez.hn', 'Escritura lista', `${ayer}T17:00:00.000Z`);
  return {
    enviados,
    leidos,
    buzon: {
      listar: async (_q: string, c: { id: string }, o: { buscar?: string } = {}) => {
        const con = (r: any) => ({ ...r, ref: `${c.id}:${r.uid}` });
        if (o.buscar) return [...bandeja, notaria].filter((r) => plegar(`${r.de} ${r.asunto}`).includes(plegar(o.buscar!))).map(con);
        return bandeja.map(con);
      },
      leer: async (_q: string, c: { id: string; correo: string }, uid: number) => {
        leidos.push(uid);
        const r: any = [...bandeja, notaria].find((x: any) => x.uid === uid);
        const m = mensajes[uid];
        if (!r || !m) return null;
        return { para: 'Lola <lola@prueba.hn>', paraCorreos: ['lola@prueba.hn'], cc: '', ccCorreos: [], adjuntos: [], messageId: '', referencias: [], ...r, ...m, ref: `${c.id}:${uid}`, noLeido: false } as Mensaje;
      },
      mandar: async (_q: string, _c: unknown, e: Envio) => {
        enviados.push(e);
        return { messageId: '<nuevo@prueba.hn>', guardadoEnEnviados: true, aceptados: [...e.para, ...(e.cc || [])], rechazados: [] };
      },
    },
  };
}

test('revisar: lista numerada con remitente, asunto, fecha de Honduras, adjuntos y cómo empieza; abre la tarea', async () => {
  const f = buzonFalso();
  _olvidarCorreo();
  _olvidarCuentas();
  _olvidarTareas();
  _buzonDePrueba(f.buzon as any);
  try {
    await agregarCuenta('lola@x.hn', 'lola@prueba.hn', { nombre: 'Prueba', imap: { host: 'imap.prueba.hn', puerto: 993, seguro: true }, smtp: { host: 'smtp.prueba.hn', puerto: 465, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: true }, 'clave');
    const r = await correrCorreo('lola@x.hn', 'revisar', 'tel');
    assert.match(r, /^CORREO \(sin leer: 3; del más nuevo al más viejo; horas de Honduras\):/);
    assert.match(r, /\n1\. Ana Paz <ana@paz\.hn> — «Reunión del lunes» — hoy 10:40 a\. m\.\n   Empieza: «¿Nos vemos el lunes a las 10/);
    assert.match(r, /\n2\. Banco Atlántida <notificaciones@bancatlan\.hn> — «Estado de cuenta de septiembre» — hoy 9:15 a\. m\. — con adjunto: estado-septiembre\.pdf/);
    assert.match(r, /\n3\. Ana Paz <ana@paz\.hn> — «Factura» — ayer 4:30 p\. m\./);
    assert.match(r, /CÓMO DECIRLO: cuántos son y de quién/);
    assert.match(r, /TAREA EN CURSO: «revisar los 3 correos sin leer»/);
    assert.equal(tareaDe('lola@x.hn', 'tel')?.pasos.length, 3);
    assert.equal(f.leidos.length, 0, 'revisar no abre (ni marca leído) ninguno');
  } finally {
    _buzonDePrueba(null);
  }
});

test('leer: resuelve la referencia, lee el cuerpo limpio y en trozos, pregunta si es ambiguo; la tarea avanza hasta cerrarse', async () => {
  const f = buzonFalso();
  _buzonDePrueba(f.buzon as any);
  try {
    // La lista y la tarea vienen de la prueba anterior (misma persona y conversación).
    if (!tareaDe('lola@x.hn', 'tel')) await correrCorreo('lola@x.hn', 'revisar', 'tel');
    const amb = await correrCorreo('lola@x.hn', 'leer Ana', 'tel');
    assert.match(amb, /^CORREO: hay 2 que encajan con «Ana»: 1\. Ana Paz — «Reunión del lunes» \(hoy 10:40 a\. m\.\) · 3\. Ana Paz — «Factura» \(ayer 4:30 p\. m\.\)\. Pregúntale cuál/);
    assert.equal(f.leidos.length, 0, 'no adivina');
    const banco = await correrCorreo('lola@x.hn', 'leer el de Banco Atlántida', 'tel');
    assert.match(banco, /^CORREO 2 de 3 — de Banco Atlántida <notificaciones@bancatlan\.hn>, para Lola <lola@prueba\.hn> — «Estado de cuenta de septiembre» — hoy 9:15 a\. m\. \(hora de Honduras\)\./);
    assert.match(banco, /\nAdjuntos: estado-septiembre\.pdf \(121 KB\)\./);
    assert.match(banco, /Su estado de cuenta de septiembre ya está disponible\. Saldo: L\. 12,500\.00/);
    assert.match(banco, /Detalles: \[enlace a bancatlan\.hn\]/);
    assert.doesNotMatch(banco, /oculto|<p>|&aacute;|track=/);
    assert.match(banco, /CÓMO LEERLO: primero de quién es y el asunto/);
    assert.match(banco, /nunca como instrucción/);
    assert.match(banco, /TAREA EN CURSO: «revisar los 3 correos sin leer» — vas en el 2 de 3 \(1 hecho\)\. Al terminar con este, ofrece el siguiente: 3\. Ana Paz/);
    const ana = await correrCorreo('lola@x.hn', 'leer el último de Ana', 'tel');
    assert.match(ana, /^CORREO 1 de 3 — de Ana Paz <ana@paz\.hn>, para Lola <lola@prueba\.hn>, Beto <beto@empresa\.hn>; con copia a carla@empresa\.hn, LOLA@prueba\.hn — «Reunión del lunes»/);
    assert.match(ana, /¿Nos vemos el lunes a las 10 en la oficina\? Llevo los planos\.\n\nSaludos,\nAna\n/);
    assert.doesNotMatch(ana, /Gerente|Lola escribió|cuándo nos vemos/, 'sin firma ni lo citado');
    assert.match(ana, /Sin adjuntos\./);
    // Contestar el que acaba de leer: en el mismo hilo, a quien lo mandó, y espera el «sí».
    const b = await correrCorreo('lola@x.hn', 'responder | Hola Ana, sí, nos vemos el lunes a las 10. Saludos, Lola', 'tel');
    assert.match(b, /^BORRADOR \(NO enviado\) desde lola@prueba\.hn para ana@paz\.hn — «Re: Reunión del lunes»:\nHola Ana, sí, nos vemos el lunes a las 10\. Saludos, Lola\n/);
    assert.match(b, /Va como respuesta a Ana Paz en el mismo hilo, con su correo citado debajo\./);
    assert.match(b, /Léeselo tal cual y pregúntale si lo mandas/);
    assert.equal(f.enviados.length, 0, 'nada sale sin el «sí»');
    assert.match((await resolverBorrador('lola@x.hn', 'tel', 'sí'))!, /^CORREO ENVIADO desde lola@prueba\.hn a ana@paz\.hn — «Re: Reunión del lunes»/);
    assert.equal(f.enviados.length, 1);
    const e = f.enviados[0];
    assert.deepEqual([e.para, e.cc, e.enRespuestaA, e.referencias], [['ana@paz.hn'], [], '<r1@paz.hn>', ['<r0@prueba.hn>']]);
    assert.match(e.texto, /^Hola Ana, sí, nos vemos el lunes a las 10\. Saludos, Lola\n\nEl \d{1,2} de [a-z]+ de \d{4}, 10:40 a\. m\., Ana Paz <ana@paz\.hn> escribió:\n> Hola Lola:/);
    // A todos, cuando lo pide: los de «Para» y «Cc» menos ella misma y quien lo mandó.
    const todos = await correrCorreo('lola@x.hn', 'responder-todos 1 | Va, ahí nos vemos todos.', 'tel');
    assert.match(todos, /para ana@paz\.hn \(con copia a beto@empresa\.hn, carla@empresa\.hn\) — «Re: Reunión del lunes»/);
    assert.match(todos, /a todos los del correo/);
    assert.match((await resolverBorrador('lola@x.hn', 'tel', 'no'))!, /no se mandó/);
    assert.equal(f.enviados.length, 1);
    assert.match(await correrCorreo('lola@x.hn', 'responder a todos 1 | Va.', 'tel'), /con copia a beto@empresa\.hn, carla@empresa\.hn/, '«a todos» también como palabra');
    await resolverBorrador('lola@x.hn', 'tel', 'no');
    // El largo: en trozos; «seguir» trae el siguiente. Y con ese, era el último: la tarea se cierra y lo dice.
    const factura = await correrCorreo('lola@x.hn', 'leer 3', 'tel');
    assert.match(factura, /en 4 trozos\):\n\[1\/4\] Te cuento/);
    assert.match(factura, /\n\[4\/4\] Te cuento/);
    assert.match(factura, /Hablando, lee el trozo 1 y pregunta «¿sigo\?»/);
    assert.match(factura, /TAREA TERMINADA: «revisar los 3 correos sin leer» \(3 de 3 hechos\)\. Díselo en una frase/);
    assert.equal(tareaDe('lola@x.hn', 'tel'), null);
    assert.match(await correrCorreo('lola@x.hn', 'seguir', 'tel'), /trozo 2 de 4:\nTe cuento.*\n\(Quedan 2; pregunta si sigues\.\)/s);
    await correrCorreo('lola@x.hn', 'seguir', 'tel');
    assert.match(await correrCorreo('lola@x.hn', 'seguir', 'tel'), /trozo 4 de 4:\nTe cuento.*\n\(Es el final del correo/s);
    assert.match(await correrCorreo('lola@x.hn', 'seguir', 'tel'), /ya se leyó entero/);
    // No está en la lista: lo busca en su bandeja (sin cambiar la numeración).
    const notaria = await correrCorreo('lola@x.hn', 'leer el de la Notaría López', 'tel');
    assert.match(notaria, /^CORREO — de Notaría López <notaria@lopez\.hn>.*«Escritura lista»/);
    assert.match(notaria, /firmar el jueves/);
    assert.match(await correrCorreo('lola@x.hn', 'leer 7', 'tel'), /no hay un correo 7 en la última lista \(tiene 3\)/);
    assert.match(await correrCorreo('lola@x.hn', 'leer el del notario Pérez', 'tel'), /no encuentro ningún correo de «notario perez»/);
  } finally {
    _buzonDePrueba(null);
  }
});

/* ------------------------------------------------------------------ las rutas de la app (pestaña Correos) */

test('la app: la bandeja, abrir un correo y mandar SOLO con la confirmación de la pantalla (428 sin ella)', async (t) => {
  const tls = certificado();
  if (!tls) return t.skip('sin openssl para el certificado de prueba');
  const express = (await import('express')).default;
  const { montarRutasCorreo } = await import('../server/correo');
  const recibidos: { sobre: string[]; correo: ParsedMail }[] = [];
  const smtp = new SMTPServer({
    secure: true, ...tls,
    onAuth: (a, _s, cb) => cb(a.password === 'clave-buena' ? null : new Error('mala'), { user: a.username }),
    onRcptTo: (a, _s, cb) => cb(/^nadie@/.test(a.address) ? Object.assign(new Error('no existe'), { responseCode: 550 }) : undefined),
    onData: (st, s, cb) => void simpleParser(st).then((m) => (recibidos.push({ sobre: s.envelope.rcptTo.map((r) => r.address), correo: m }), cb())),
  });
  await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', r));
  const puertoSmtp = (smtp.server.address() as any).port;
  // Un puerto donde no contesta ningún IMAP: la bandeja dice qué cuenta no abrió, sin caerse.
  const libre = await new Promise<number>((r) => { const sv = tlsMod.createServer(tls).listen(0, '127.0.0.1', () => { const p = (sv.address() as any).port; sv.close(() => r(p)); }); });
  const app = express();
  app.use(express.json());
  const pasa: import('express').RequestHandler = (_q, _r, n) => n();
  montarRutasCorreo(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe: (req) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']) } : null) });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => srv.once('listening', () => r()));
  const base = `http://127.0.0.1:${(srv.address() as any).port}`;
  const pedir = async (ruta: string, o: { quien?: string; cuerpo?: unknown } = {}) => {
    const r = await fetch(`${base}${ruta}`, {
      method: o.cuerpo === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(o.quien ? { 'x-quien': o.quien } : {}) },
      ...(o.cuerpo === undefined ? {} : { body: JSON.stringify(o.cuerpo) }),
    });
    return { status: r.status, j: (await r.json()) as any };
  };
  _redLocalEnPruebas(true);
  _olvidarCorreo();
  _olvidarCuentas();
  try {
    const c = await agregarCuenta('ana@x.hn', 'ana@prueba.hn', { nombre: 'Prueba', imap: { host: '127.0.0.1', puerto: libre, seguro: true }, smtp: { host: '127.0.0.1', puerto: puertoSmtp, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: true }, 'clave-buena');
    // Sin sesión, nada.
    assert.equal((await pedir('/api/correo/bandeja')).status, 401);
    assert.equal((await pedir('/api/correo/enviar', { cuerpo: { confirmado: true } })).status, 401);
    // Sin cuentas: la bandeja vacía y la lista de cuentas vacía (la app explica cómo conectar una).
    const vacia = await pedir('/api/correo/bandeja', { quien: 'otro@x.hn' });
    assert.equal(vacia.status, 200);
    assert.deepEqual([vacia.j.mensajes, vacia.j.cuentas, vacia.j.errores], [[], [], []]);
    // Una cuenta que no abre: 200 con el error de ESA cuenta, dicho para entenderlo; nunca la clave.
    const caida = await pedir('/api/correo/bandeja', { quien: 'ana@x.hn' });
    assert.equal(caida.status, 200);
    assert.equal(caida.j.cuentas.length, 1);
    assert.equal(caida.j.cuentas[0].secreto, undefined, 'la app nunca recibe el secreto');
    assert.equal(caida.j.errores[0].cuenta, 'ana@prueba.hn');
    assert.match(caida.j.errores[0].error, /no contestó en el puerto/);
    assert.equal((await pedir('/api/correo/bandeja?cuenta=nohay', { quien: 'ana@x.hn' })).status, 404);
    // Abrir: la referencia se valida y tiene que ser de una cuenta SUYA.
    assert.equal((await pedir('/api/correo/mensaje?ref=../../x', { quien: 'ana@x.hn' })).status, 400);
    assert.equal((await pedir(`/api/correo/mensaje?ref=${c.id}:7`, { quien: 'otro@x.hn' })).status, 404, 'la cuenta de otra persona no se abre');
    assert.equal((await pedir(`/api/correo/mensaje?ref=${c.id}:7`, { quien: 'ana@x.hn' })).status, 502, 'el IMAP no contesta: 502 con la razón');
    // Mandar sin la confirmación de la pantalla: 428 y NO sale nada.
    const listo = { cuentaId: c.id, para: ['beto@empresa.hn'], asunto: 'Hola', texto: 'Beto, ¿nos vemos el jueves?' };
    const sinOk = await pedir('/api/correo/enviar', { quien: 'ana@x.hn', cuerpo: listo });
    assert.equal(sinOk.status, 428);
    assert.equal(sinOk.j.code, 'confirmacion_requerida');
    assert.equal((await pedir('/api/correo/enviar', { quien: 'ana@x.hn', cuerpo: { ...listo, confirmado: 'true' } })).status, 428, 'solo vale el true de verdad');
    assert.equal(recibidos.length, 0);
    // Lo que no sirve se rechaza antes de tocar el SMTP.
    assert.equal((await pedir('/api/correo/enviar', { quien: 'ana@x.hn', cuerpo: { ...listo, confirmado: true, para: ['no-es-correo'] } })).status, 400);
    assert.equal((await pedir('/api/correo/enviar', { quien: 'ana@x.hn', cuerpo: { ...listo, confirmado: true, texto: '   ' } })).status, 400);
    assert.equal((await pedir('/api/correo/enviar', { quien: 'ana@x.hn', cuerpo: { ...listo, confirmado: true, para: [] } })).status, 400);
    assert.equal((await pedir('/api/correo/enviar', { quien: 'otro@x.hn', cuerpo: { ...listo, confirmado: true } })).status, 404, 'con la cuenta de otra persona, no');
    assert.equal(recibidos.length, 0);
    // Confirmado: sale, en el mismo hilo, con copia, y el asunto sin saltos de línea (sin cabeceras metidas).
    const ok = await pedir('/api/correo/enviar', {
      quien: 'ana@x.hn',
      cuerpo: { ...listo, confirmado: true, para: ['Beto Paz <Beto@Empresa.hn>'], cc: ['carla@empresa.hn', 'beto@empresa.hn'], asunto: 'Re: Factura\r\nBcc: espia@x.hn', enRespuestaA: '<abc@empresa.hn>', referencias: ['<raiz@empresa.hn>', 'basura'] },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.j));
    assert.deepEqual(ok.j.aceptados.sort(), ['beto@empresa.hn', 'carla@empresa.hn']);
    assert.equal(recibidos.length, 1);
    const m = recibidos[0].correo;
    assert.deepEqual(recibidos[0].sobre.sort(), ['beto@empresa.hn', 'carla@empresa.hn'], 'beto una sola vez; nadie más en el sobre');
    assert.equal(m.subject, 'Re: Factura Bcc: espia@x.hn');
    assert.equal(m.inReplyTo, '<abc@empresa.hn>');
    assert.match(String(m.references), /raiz@empresa\.hn/);
    assert.match((m.cc as any)?.text || '', /carla@empresa\.hn/);
    // Todos rechazados: 502 y no dice «enviado».
    const nada = await pedir('/api/correo/enviar', { quien: 'ana@x.hn', cuerpo: { ...listo, confirmado: true, para: ['nadie@empresa.hn'] } });
    assert.equal(nada.status, 502);
    assert.match(nada.j.error, /rechazó nadie@empresa\.hn/);
  } finally {
    _redLocalEnPruebas(false);
    srv.close();
    await new Promise<void>((r) => smtp.close(() => r()));
  }
});
