import assert from 'node:assert/strict';
import net from 'node:net';
import { describe, it } from 'node:test';
import {
  clasificar,
  decodificarCabecera,
  extracto,
  leerBuzon,
  proximaRevision,
  remitente,
  resumen,
  textoDelCuerpo,
  trozos,
} from '../lib/campana-respuestas';

describe('Campaña SFSP: quién contestó', () => {
  it('la revisión cae a las 7:00 de Honduras (13:00 UTC), hoy o mañana', () => {
    assert.equal(proximaRevision(new Date('2026-09-29T01:00:00Z')).toISOString(), '2026-09-29T13:00:00.000Z');
    assert.equal(proximaRevision(new Date('2026-09-29T13:00:00Z')).toISOString(), '2026-09-30T13:00:00.000Z');
    assert.equal(proximaRevision(new Date('2026-09-29T20:30:00Z')).toISOString(), '2026-09-30T13:00:00.000Z');
  });

  it('decodifica asuntos y remitentes con tildes', () => {
    assert.equal(decodificarCabecera('=?UTF-8?B?UmU6IEludml0YWNpw7NuIHBlcnNvbmFs?='), 'Re: Invitación personal');
    assert.equal(decodificarCabecera('=?iso-8859-1?Q?Jos=E9_P=E9rez?='), 'José Pérez');
    assert.deepEqual(remitente('"Ana Gómez" <Ana@Banco.com>'), { nombre: 'Ana Gómez', correo: 'ana@banco.com' });
    assert.deepEqual(remitente('info@x.org'), { nombre: 'info@x.org', correo: 'info@x.org' });
  });

  it('el extracto es lo que escribió quien contesta, sin la cita', () => {
    const t = 'Me interesa, conversemos el jueves.\n\nEl lun, 29 sept 2026 a las 8:00, José Ordoñez escribió:\n> Este correo no le llegó por casualidad.';
    assert.equal(extracto(t), 'Me interesa, conversemos el jueves.');
    assert.equal(textoDelCuerpo('Content-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: base64\n\nU8OtLCBjb252ZXJzZW1vcy4=\n'), 'Sí, conversemos.');
  });

  it('separa respuestas, bajas y rebotes, y deja fuera el resto del buzón', () => {
    const c = clasificar([
      { from: 'Ana <ana@banco.com>', asunto: 'Re: Invitación personal: unir a Centroamérica', fecha: '', texto: 'Con gusto, ¿el martes?' },
      { from: 'bob@fund.com', asunto: 'RE: Personal invitation: uniting Central America', fecha: '', texto: 'No\n\nOn Mon, José wrote:\n> ...' },
      { from: 'MAILER-DAEMON@amazonses.com', asunto: 'Delivery Status Notification (Failure)', fecha: '', texto: 'Invitación personal: unir a Centroamérica' },
      { from: 'banco@otro.com', asunto: 'Su estado de cuenta', fecha: '', texto: 'hola' },
    ]);
    assert.equal(c.respuestas.length, 1);
    assert.equal(c.respuestas[0].correo, 'ana@banco.com');
    assert.deepEqual(c.bajas.map((r) => r.correo), ['bob@fund.com']);
    assert.equal(c.rebotes.length, 1);
  });

  it('el resumen dice también cuando nadie contestó', () => {
    const vacio = resumen({ respuestas: [], bajas: [], rebotes: [] }, new Date('2026-09-29T13:00:00Z'));
    assert.match(vacio, /Nadie contestó/);
    const lleno = resumen(
      { respuestas: [{ de: 'Ana', correo: 'ana@banco.com', asunto: 'Re', fecha: '', extracto: 'Con gusto' }], bajas: [], rebotes: [] },
      new Date('2026-09-29T13:00:00Z'),
    );
    assert.match(lleno, /Contestaron 1:\n• Ana <ana@banco\.com>\n  «Con gusto»/);
  });

  it('en un correo multipart toma solo la parte de texto: un «No» es una baja', () => {
    const crudo = '--b1\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nNo\r\n--b1\r\nContent-Type: text/html\r\n\r\n<html><p>No</p></html>\r\n--b1--\r\n';
    assert.equal(textoDelCuerpo(crudo).trim(), 'No');
    const c = clasificar([{ from: 'x@y.com', asunto: 'Re: Invitación personal: unir a Centroamérica', fecha: '', texto: textoDelCuerpo(crudo) }]);
    assert.equal(c.bajas.length, 1);
  });

  it('un resumen largo se parte en mensajes sin perder a nadie, y las bajas van primero', () => {
    const respuestas = Array.from({ length: 60 }, (_, i) => ({ de: `P${i}`, correo: `p${i}@x.com`, asunto: '', fecha: '', extracto: 'x'.repeat(190) }));
    const texto = resumen({ respuestas, bajas: [{ de: 'B', correo: 'baja@x.com', asunto: '', fecha: '', extracto: 'no' }], rebotes: [] }, new Date());
    const partes = trozos(texto);
    assert.ok(partes.length > 1);
    assert.ok(partes.every((p) => p.length <= 3900));
    assert.equal(partes.join('\n'), texto);
    assert.ok(texto.indexOf('baja@x.com') < texto.indexOf('p0@x.com'));
  });

  it('si el servidor IMAP no contesta, la lectura falla en vez de quedarse esperando', async () => {
    const mudo = net.createServer(() => {}).listen(0);
    await new Promise((ok) => mudo.once('listening', ok));
    process.env.CAMPANA_IMAP_HOST = '127.0.0.1';
    process.env.CAMPANA_IMAP_PUERTO = String((mudo.address() as net.AddressInfo).port);
    process.env.CAMPANA_IMAP_CLAVE = 'x';
    try {
      await assert.rejects(leerBuzon(new Date(), 300));
    } finally {
      delete process.env.CAMPANA_IMAP_HOST;
      delete process.env.CAMPANA_IMAP_PUERTO;
      delete process.env.CAMPANA_IMAP_CLAVE;
      mudo.close();
    }
  });

  it('si el servidor rechaza la contraseña, el error dice el motivo', async () => {
    const srv = net.createServer((c) => {
      c.write('* OK listo\r\n');
      c.on('data', (d) => { const tag = String(d).split(' ')[0]; c.write(`${tag} NO [AUTHENTICATIONFAILED] Authentication failed.\r\n`); });
    }).listen(0);
    await new Promise((ok) => srv.once('listening', ok));
    const { Imap } = await import('../lib/campana-respuestas');
    const imap = new Imap();
    try {
      await imap.abrir('127.0.0.1', (srv.address() as net.AddressInfo).port, 2000, false);
      await assert.rejects(imap.orden('LOGIN "a" "b"'), /AUTHENTICATIONFAILED\] Authentication failed/);
    } finally {
      imap.cerrar();
      srv.close();
    }
  });
});
