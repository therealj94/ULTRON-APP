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
import { _redLocalEnPruebas, sinCitas, htmlATexto } from '../lib/correo/buzon';
import { borradorDe, correrCorreo, resolverBorrador, respuestaAlBorrador, _olvidarCorreo } from '../server/correo';
import { ipPublicaDe } from '../lib/red-publica';
import { extraerPedidoHerramienta, instruccionHarness } from '../lib/harness';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'correo-'));
process.env.CORREO_CLAVE_CIFRADO = 'llave-de-prueba';
process.env.ULTRON_CORREO_DIR = DIR;

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
  const isp = await detectarProveedor('a@raro.com', { traer: async (u) => (u.includes('thunderbird') ? XML_YAHOO : null), mx: async () => [] });
  assert.equal(isp?.fuente, 'ispdb');
  assert.deepEqual(isp?.imap, { host: 'imap.mail.yahoo.com', puerto: 993, seguro: true }, 'nunca el IMAP sin cifrar');
  const gw = await detectarProveedor('a@empresa.hn', { traer: async () => null, mx: async () => ['aspmx.l.google.com'] });
  assert.equal(gw?.nombre, 'Google Workspace');
  const m365 = await detectarProveedor('a@unah.edu.hn', { traer: async () => null, mx: async () => ['unah-edu-hn.mail.protection.outlook.com'] });
  assert.equal(m365?.auth, 'microsoft');
  const propio = await detectarProveedor('a@ordenglobal.org', sinRed);
  assert.equal(propio?.imap.host, 'mail.ordenglobal.org');
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
  for (const t of ['sí pero cámbiale el saludo', 'qué hora es', 'sí, y además dime cuántos correos tengo sin leer hoy']) assert.equal(respuestaAlBorrador(t), null, t);
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
    onData: (st, _s, cb) => void simpleParser(st).then((m) => (recibidos.push(m), cb())),
  });
  await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', r));
  const puerto = (smtp.server.address() as any).port;
  _redLocalEnPruebas(true);
  _olvidarCorreo();
  _olvidarCuentas();
  try {
    await agregarCuenta('lola@x.hn', 'lola@prueba.hn', { nombre: 'Prueba', imap: { host: '127.0.0.1', puerto: 993, seguro: true }, smtp: { host: '127.0.0.1', puerto, seguro: true }, auth: 'clave', usuario: 'correo', guardaEnviados: true }, 'clave-buena');
    assert.match(await correrCorreo('lola@x.hn', 'escribir no-es-correo | Hola | texto'), /no es una dirección/);
    const b = await correrCorreo('lola@x.hn', 'escribir beto@empresa.hn | Reunión | Beto, ¿nos vemos el jueves a las 3?');
    assert.match(b, /BORRADOR \(NO enviado\)/);
    assert.match(b, /Léeselo tal cual/);
    assert.equal(recibidos.length, 0, 'el borrador no sale solo');
    assert.equal(await resolverBorrador('lola@x.hn', 'qué hora es'), null, 'otra cosa no lo manda');
    assert.ok(borradorDe('lola@x.hn'), 'y sigue esperando');
    const enviado = await resolverBorrador('lola@x.hn', 'Sí, mándalo');
    assert.match(enviado!, /CORREO ENVIADO desde lola@prueba.hn a beto@empresa.hn/);
    assert.equal(recibidos.length, 1);
    assert.equal(recibidos[0].subject, 'Reunión');
    assert.match(recibidos[0].text || '', /jueves a las 3/);
    assert.equal(borradorDe('lola@x.hn'), null, 'una vez mandado, ya no hay borrador');
    assert.equal(await resolverBorrador('lola@x.hn', 'sí'), null, 'un segundo «sí» no manda nada más');
    // «no» lo descarta sin mandar.
    await correrCorreo('lola@x.hn', 'escribir beto@empresa.hn | Otro | otro texto');
    assert.match((await resolverBorrador('lola@x.hn', 'no'))!, /no se mandó/);
    assert.equal(recibidos.length, 1);
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
    assert.match((await resolverBorrador('dueno@x.hn', 'dale'))!, /CORREO ENVIADO.*quedó en Enviados/);
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
