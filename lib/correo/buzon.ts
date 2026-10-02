/**
 * EL BUZÓN: leer, buscar y mandar correo de cualquier proveedor (IMAP para leer, SMTP para mandar).
 *
 * Se usan las bibliotecas que ya resuelven bien el correo: imapflow (IMAP moderno: IDLE, búsquedas,
 * OAuth2), mailparser (MIME, adjuntos, juegos de caracteres) y nodemailer (SMTP, OAuth2, armado del
 * mensaje). Las tres son del mismo autor y licencia MIT.
 *
 * Se conecta a la IP pública ya resuelta del servidor (el nombre va solo para el certificado TLS): el
 * dominio lo escribió la persona y no puede llevar al servidor a su propia red.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { ipPublicaDe } from '../red-publica';
import { actualizarSecreto, descifrar, type CuentaCorreo } from './cuentas';
import { renovar, type TokensMicrosoft } from './microsoft';
import type { Proveedor } from './proveedores';

export type Resumen = {
  /** «<cuenta>:<uid>»: con esto se vuelve a abrir. */
  ref: string;
  cuenta: string;
  de: string;
  deCorreo: string;
  asunto: string;
  fecha: string;
  noLeido: boolean;
};

export type Mensaje = Resumen & {
  para: string;
  /** Con copia, como texto («Ana <ana@x.hn>, …»); «» si no hay. */
  cc: string;
  /** Las direcciones solas de «para» y «cc» (para «responder a todos»). */
  paraCorreos: string[];
  ccCorreos: string[];
  texto: string;
  adjuntos: { nombre: string; tipo: string; bytes: number }[];
  messageId: string;
  referencias: string[];
  responderA: string;
};

type Credencial = { user: string; pass?: string; accessToken?: string };

/** Pruebas: un servidor de correo local (Dovecot, smtp-server) con certificado propio. Nunca en producción. */
const PRUEBA = { local: false };
export function _redLocalEnPruebas(si: boolean) {
  PRUEBA.local = si && process.env.NODE_ENV !== 'production';
}
const ipDe = (host: string) => (PRUEBA.local ? Promise.resolve(host) : ipPublicaDe(host));

/** Lo que hace falta para entrar: la clave, o un token de Microsoft vigente (se renueva y se guarda). */
async function credencial(quien: string, c: CuentaCorreo): Promise<Credencial> {
  const usuario = c.proveedor.usuario === 'local' ? c.correo.split('@')[0] : c.correo;
  const secreto = descifrar(c.secreto);
  if (c.proveedor.auth !== 'microsoft') return { user: usuario, pass: secreto };
  let t = JSON.parse(secreto) as TokensMicrosoft;
  if (Date.now() > t.venceEl - 60_000) {
    t = await renovar(t.renovacion);
    // El token nuevo sirve para esta vez aunque no se pueda guardar (S3 sin leer): no se corta el correo.
    await actualizarSecreto(quien, c.id, JSON.stringify(t)).catch((e) => console.warn('[correo] no guardé el token renovado:', String(e?.message || e).slice(0, 120)));
  }
  return { user: usuario, accessToken: t.acceso };
}

async function imapPara(prov: Pick<Proveedor, 'imap'>, cred: Credencial): Promise<ImapFlow> {
  const ip = await ipDe(prov.imap.host);
  const cliente = new ImapFlow({
    host: ip,
    port: prov.imap.puerto,
    secure: prov.imap.seguro,
    // En 143 el cifrado (STARTTLS) es obligatorio: sin él, la clave viajaría en claro.
    ...(prov.imap.seguro ? {} : { doSTARTTLS: true }),
    servername: prov.imap.host,
    tls: { servername: prov.imap.host, rejectUnauthorized: !PRUEBA.local },
    auth: cred.accessToken ? { user: cred.user, accessToken: cred.accessToken } : { user: cred.user, pass: cred.pass },
    logger: false,
    disableAutoIdle: true,
    clientInfo: { name: 'AU-RA' },
  });
  // Un error del socket después de conectar no debe tumbar el servidor.
  cliente.on('error', (e: Error) => console.warn('[correo imap]', String(e?.message || e).slice(0, 120)));
  await cliente.connect();
  return cliente;
}

async function smtpPara(prov: Pick<Proveedor, 'smtp'>, cred: Credencial) {
  const ip = await ipDe(prov.smtp.host);
  return nodemailer.createTransport({
    host: ip,
    port: prov.smtp.puerto,
    secure: prov.smtp.seguro,
    requireTLS: !prov.smtp.seguro,
    tls: { servername: prov.smtp.host, rejectUnauthorized: !PRUEBA.local },
    auth: cred.accessToken ? { type: 'OAuth2', user: cred.user, accessToken: cred.accessToken } : { user: cred.user, pass: cred.pass },
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

/**
 * El fallo de la prueba, dicho para que la persona sepa QUÉ hacer. Antes salía el texto crudo del
 * servidor («Command failed», «535 5.7.8») y, en el teléfono de José (2-oct, ordenglobal.org), no
 * se entendía si era la clave o el servidor. Al final va el detalle técnico entre paréntesis.
 */
export function explicarFallo(e: any, host: string, puerto: number, que: 'leer' | 'mandar'): string {
  const crudo = String(e?.responseText || e?.response || e?.message || e || '').replace(/\s+/g, ' ').slice(0, 120);
  const codigo = String(e?.code || '');
  const todo = `${codigo} ${e?.serverResponseCode || ''} ${crudo}`;
  const detalle = crudo ? ` (${crudo})` : '';
  if (e?.authenticationFailed || codigo === 'EAUTH' || e?.responseCode === 535 || /AUTHENTICATIONFAILED|authentication failed|invalid credentials|incorrect (password|username)|login failed|\b535\b/i.test(todo)) {
    return `${host} no aceptó la clave. Revisa que sea la contraseña de ese correo (la misma con la que entras al webmail); si tiene verificación en dos pasos, crea una contraseña de aplicación.${detalle}`;
  }
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|altname|certificate/i.test(todo)) {
    return `El certificado de seguridad de ${host} no es válido para ese nombre, y así no mando tu clave. Pídele a quien administra tu dominio el nombre exacto del servidor de correo (en cPanel sale en «Configurar cliente de correo»).${detalle}`;
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(todo)) return `No existe el servidor ${host}. Revisa cómo se escribe.${detalle}`;
  if (/servidor interno bloqueado/.test(todo)) return `${host} es una dirección interna: solo se conectan servidores de internet.`;
  if (/ECONNREFUSED|ETIMEDOUT|ETIMEOUT|ECONNRESET|ESOCKET|EHOSTUNREACH|timeout|timed out|closed/i.test(todo)) {
    return `${host} no contestó en el puerto ${puerto}${que === 'leer' ? ' (para leer suele ser 993)' : ' (para mandar suele ser 465 o 587)'}. Revisa el servidor y el puerto.${detalle}`;
  }
  return `No pude ${que === 'leer' ? 'entrar a leer' : 'mandar'} en ${host}:${detalle || ' sin detalle del servidor.'}`;
}

/** Antes de guardar una cuenta: ¿entra a leer y a mandar? Si no, dice por qué (explicarFallo). */
export async function probarCuenta(correo: string, prov: Pick<Proveedor, 'imap' | 'smtp' | 'usuario'>, secreto: { pass?: string; accessToken?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const cred = { user: prov.usuario === 'local' ? correo.split('@')[0] : correo, ...secreto };
  try {
    const c = await imapPara(prov, cred);
    await c.logout().catch(() => {});
  } catch (e: any) {
    return { ok: false, error: `No pude entrar a leer. ${explicarFallo(e, prov.imap.host, prov.imap.puerto, 'leer')}` };
  }
  try {
    const t = await smtpPara(prov, cred);
    await t.verify();
    t.close();
  } catch (e: any) {
    return { ok: false, error: `Entré a leer, pero no a mandar. ${explicarFallo(e, prov.smtp.host, prov.smtp.puerto, 'mandar')}` };
  }
  return { ok: true };
}

function nombreDe(a: AddressObject | AddressObject[] | undefined): { nombre: string; correo: string } {
  const v = Array.isArray(a) ? a[0]?.value?.[0] : a?.value?.[0];
  return { nombre: v?.name || v?.address || '', correo: v?.address || '' };
}

function textoDe(a: AddressObject | AddressObject[] | undefined): string {
  return (Array.isArray(a) ? a : a ? [a] : []).map((x) => x.text).join(', ');
}

/** Solo las direcciones (sin nombres, sin repetir), también las de dentro de un grupo. */
function correosDe(a: AddressObject | AddressObject[] | undefined): string[] {
  const out: string[] = [];
  const meter = (vs: AddressObject['value'] = []) => {
    for (const v of vs) {
      if (v.address && !out.includes(v.address.toLowerCase())) out.push(v.address.toLowerCase());
      if (v.group) meter(v.group);
    }
  };
  for (const x of Array.isArray(a) ? a : a ? [a] : []) meter(x.value);
  return out;
}

/** HTML a texto legible (cuando el correo no trae parte de texto). */
export function htmlATexto(html: string): string {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/** Lo que el correo dice, sin el hilo citado de abajo (lo de «El lunes, Fulano escribió:» en adelante). */
export function sinCitas(texto: string): string {
  const lineas = String(texto || '').split('\n');
  const corte = lineas.findIndex((l) => /^(El .{3,80} escribió:|On .{3,80} wrote:|-{2,}\s*(Mensaje original|Original Message)|De: .+|From: .+)$/i.test(l.trim()) || /^>/.test(l));
  return (corte > 0 ? lineas.slice(0, corte) : lineas).join('\n').trim();
}

/** Los de la bandeja de entrada de una cuenta: los no leídos (o los últimos), del más nuevo al más viejo. */
export async function listar(quien: string, c: CuentaCorreo, o: { soloNoLeidos?: boolean; buscar?: string; n?: number } = {}): Promise<Resumen[]> {
  const cliente = await imapPara(c.proveedor, await credencial(quien, c));
  try {
    const candado = await cliente.getMailboxLock('INBOX', { readOnly: true });
    try {
      const t = o.buscar?.trim();
      const consulta = t ? { or: [{ from: t }, { subject: t }, { body: t }] } : o.soloNoLeidos ? { seen: false } : { all: true };
      const uids = ((await cliente.search(consulta, { uid: true })) || []) as number[];
      const ultimos = uids.slice(-(o.n ?? 10)).reverse();
      if (!ultimos.length) return [];
      const msgs = await cliente.fetchAll(ultimos.join(','), { uid: true, envelope: true, flags: true, internalDate: true }, { uid: true });
      return msgs
        .map((m) => {
          const de = m.envelope?.from?.[0];
          return {
            ref: `${c.id}:${m.uid}`,
            cuenta: c.correo,
            de: de?.name || de?.address || '',
            deCorreo: de?.address || '',
            asunto: m.envelope?.subject || '(sin asunto)',
            fecha: new Date(m.internalDate || m.envelope?.date || Date.now()).toISOString(),
            noLeido: !m.flags?.has('\\Seen'),
          };
        })
        .sort((a, b) => b.fecha.localeCompare(a.fecha));
    } finally {
      candado.release();
    }
  } finally {
    await cliente.logout().catch(() => {});
  }
}

/** Abre un correo y lo marca como leído (como cualquier programa de correo al abrirlo). */
export async function leer(quien: string, c: CuentaCorreo, uid: number): Promise<Mensaje | null> {
  const cliente = await imapPara(c.proveedor, await credencial(quien, c));
  try {
    const candado = await cliente.getMailboxLock('INBOX');
    try {
      const m = await cliente.fetchOne(String(uid), { uid: true, source: true, flags: true, internalDate: true }, { uid: true });
      if (!m || !m.source) return null;
      const p = await simpleParser(m.source);
      await cliente.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }).catch(() => {});
      const de = nombreDe(p.from);
      const texto = (p.text && p.text.trim()) || htmlATexto(typeof p.html === 'string' ? p.html : '');
      const refs = Array.isArray(p.references) ? p.references : p.references ? [p.references] : [];
      return {
        ref: `${c.id}:${uid}`,
        cuenta: c.correo,
        de: de.nombre,
        deCorreo: de.correo,
        para: textoDe(p.to),
        cc: textoDe(p.cc),
        paraCorreos: correosDe(p.to),
        ccCorreos: correosDe(p.cc),
        asunto: p.subject || '(sin asunto)',
        fecha: new Date(p.date || m.internalDate || Date.now()).toISOString(),
        noLeido: false,
        texto: texto.slice(0, 20_000),
        adjuntos: (p.attachments || []).map((a) => ({ nombre: a.filename || 'adjunto', tipo: a.contentType, bytes: a.size })),
        messageId: p.messageId || '',
        referencias: refs,
        responderA: nombreDe(p.replyTo).correo || de.correo,
      };
    } finally {
      candado.release();
    }
  } finally {
    await cliente.logout().catch(() => {});
  }
}

export type Envio = { para: string[]; cc?: string[]; asunto: string; texto: string; enRespuestaA?: string; referencias?: string[] };

/**
 * Manda un correo. Se arma una sola vez (MailComposer) para mandar por SMTP y, si el proveedor no lo
 * hace solo, guardar esa misma copia en «Enviados» por IMAP.
 */
export async function mandar(quien: string, c: CuentaCorreo, e: Envio): Promise<{ messageId: string; guardadoEnEnviados: boolean; aceptados: string[]; rechazados: string[] }> {
  const cred = await credencial(quien, c);
  const correo = {
    from: c.correo,
    to: e.para.join(', '),
    ...(e.cc?.length ? { cc: e.cc.join(', ') } : {}),
    subject: e.asunto,
    text: e.texto,
    ...(e.enRespuestaA ? { inReplyTo: e.enRespuestaA, references: [...(e.referencias || []), e.enRespuestaA].join(' ') } : {}),
  };
  const crudo = await new MailComposer(correo).compile().build();
  const t = await smtpPara(c.proveedor, cred);
  let messageId = '';
  let aceptados: string[] = [];
  let rechazados: string[] = [];
  try {
    const r = await t.sendMail({ envelope: { from: c.correo, to: [...e.para, ...(e.cc || [])] }, raw: crudo });
    messageId = r.messageId || '';
    const dir = (x: unknown) => (typeof x === 'string' ? x : (x as { address?: string })?.address || '');
    aceptados = (r.accepted || []).map(dir).filter(Boolean);
    rechazados = (r.rejected || []).map(dir).filter(Boolean);
  } finally {
    t.close();
  }
  if (!aceptados.length) return { messageId, guardadoEnEnviados: false, aceptados, rechazados };
  let guardado = c.proveedor.guardaEnviados;
  if (!guardado) {
    try {
      const cliente = await imapPara(c.proveedor, cred);
      try {
        const carpetas = await cliente.list();
        const enviados = carpetas.find((f) => f.specialUse === '\\Sent')?.path || carpetas.find((f) => /^(sent|enviados|sent items|elementos enviados)$/i.test(f.name))?.path;
        if (enviados) guardado = !!(await cliente.append(enviados, crudo, ['\\Seen']));
      } finally {
        await cliente.logout().catch(() => {});
      }
    } catch (err: any) {
      console.warn('[correo] mandado, pero no lo pude guardar en Enviados:', String(err?.message || err).slice(0, 120));
    }
  }
  return { messageId, guardadoEnEnviados: guardado, aceptados, rechazados };
}
