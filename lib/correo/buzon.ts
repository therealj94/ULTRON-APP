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
  /** Los nombres de sus adjuntos (sin las imágenes metidas en el cuerpo, como logos y firmas). */
  adjuntos?: string[];
  /** El principio del texto, limpio (solo si se pidió `extractos`). */
  extracto?: string;
};

export type Mensaje = Omit<Resumen, 'adjuntos'> & {
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


const ENTIDADES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', iexcl: '¡',
  iquest: '¿', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', ndash: '–', mdash: '—', hellip: '…',
  euro: '€', copy: '©', reg: '®', trade: '™', bull: '•', middot: '·', deg: '°', zwnj: '', zwj: '', shy: '',
};

/** Las entidades de HTML a su letra (&aacute; → á, &#233; → é, &#x2019; → ’). */
function sinEntidades(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTIDADES[e] ?? ENTIDADES[e.toLowerCase()] ?? m;
  });
}

/**
 * HTML a texto legible (cuando el correo no trae parte de texto): sin estilos ni scripts ni lo escondido
 * (el «preheader» de los boletines), con saltos donde el HTML los pone, viñetas en las listas y las letras
 * con tilde bien escritas. Los enlaces quedan con su texto, no con la dirección.
 */
export function htmlATexto(html: string): string {
  return sinEntidades(
    String(html || '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|head|title|noscript)[\s\S]*?<\/\1>/gi, '')
      // Un trozo cortado (el extracto lee solo el principio) puede dejar un estilo o una etiqueta sin cerrar.
      .replace(/<(script|style|head)\b[\s\S]*$/i, '')
      .replace(/<[^>]*$/, '')
      .replace(/<(div|span|p|td|table)\b[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<\/li>/gi, '')
      .replace(/<\/(p|div|tr|h[1-6]|table|ul|ol|blockquote)>/gi, '\n')
      .replace(/<(p|h[1-6]|table|ul|ol)\b[^>]*>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' ')
      .replace(/<img\b[^>]*>/gi, '')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/ /g, ' ')
    .replace(/[​-‍⁠﻿͏]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Lo que el correo dice, sin el hilo citado de abajo (lo de «El lunes, Fulano escribió:» en adelante). */
export function sinCitas(texto: string): string {
  const lineas = String(texto || '').split('\n');
  const corte = lineas.findIndex(
    (l) =>
      /^(El .{3,120} escribió:|On .{3,120} wrote:|-{2,}\s*(Mensaje original|Original Message|Forwarded message|Mensaje reenviado)\s*-*|_{10,}|De: .+|From: .+)$/i.test(l.trim()) ||
      /^>/.test(l)
  );
  return (corte > 0 ? lineas.slice(0, corte) : lineas).join('\n').trim();
}

/** Las líneas de relleno de una firma o un aviso legal: desde aquí para abajo no se lee. */
const FIN_DE_CUERPO =
  /^(--\s*|enviado desde mi (iphone|ipad|android|samsung|celular|tel[eé]fono|m[oó]vil).*|sent from my .+|get outlook for .+|obt[eé]n outlook para .+|descarga outlook para .+|este (mensaje|correo)( electr[oó]nico)? (y sus anexos )?(es|contiene|puede contener|va dirigido) .*(confidencial|privilegiad|exclusivo).*|aviso de confidencialidad.*|confidencialidad:.*|confidentiality notice.*|this (e-?mail|message)( and any attachments)? (is|are|may contain) .*confidential.*|antes de imprimir.*|por favor,? considere el medio ambiente.*|please consider the environment.*)$/i;

/**
 * El cuerpo para LEERLO: sin el hilo citado, sin la firma automática («Enviado desde mi iPhone», el aviso
 * de confidencialidad, lo que va después de «-- »), sin direcciones larguísimas (se dice de qué sitio es
 * el enlace) y sin las marcas de imágenes. Lo que dice la persona queda tal cual.
 */
export function limpiarCuerpo(texto: string): string {
  const lineas = sinCitas(String(texto || '').replace(/\r\n?/g, '\n')).split('\n');
  const fin = lineas.findIndex((l, i) => i > 0 && FIN_DE_CUERPO.test(l.trim()));
  return (fin > 0 ? lineas.slice(0, fin) : lineas)
    .join('\n')
    .replace(/\[(image|imagen|cid):[^\]]*\]/gi, '')
    .replace(/<?(https?:\/\/[^\s<>"')\]]+)>?/gi, (_m, url: string) => {
      try {
        return `[enlace a ${new URL(url).hostname.replace(/^www\./, '')}]`;
      } catch {
        return '[enlace]';
      }
    })
    .replace(/(\[enlace[^\]]*\]\s*){2,}/g, (m) => `${m.trim().split(/\]\s*/)[0]}] `)
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** El principio del texto en una línea, cortado en una palabra. */
export function extractoDe(texto: string, max = 160): string {
  const s = limpiarCuerpo(texto).replace(/\[enlace[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

/**
 * El texto en trozos para leerlo en voz alta: por párrafos, juntando los cortos y partiendo los largos en
 * frases, sin pasar de `max` letras cada uno. Así la voz lee un trozo y pregunta si sigue.
 */
export function enTrozos(texto: string, max = 600): string[] {
  const parrafos = String(texto || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const piezas: string[] = [];
  for (const p of parrafos) {
    if (p.length <= max) piezas.push(p);
    else {
      let actual = '';
      for (const f of p.split(/(?<=[.!?…])\s+/)) {
        if (actual && actual.length + f.length + 1 > max) {
          piezas.push(actual);
          actual = '';
        }
        actual = actual ? `${actual} ${f}` : f;
        while (actual.length > max) {
          const corte = actual.lastIndexOf(' ', max) > max / 2 ? actual.lastIndexOf(' ', max) : max;
          piezas.push(actual.slice(0, corte));
          actual = actual.slice(corte).trim();
        }
      }
      if (actual) piezas.push(actual);
    }
  }
  const trozos: string[] = [];
  for (const p of piezas) {
    const ult = trozos[trozos.length - 1];
    if (ult !== undefined && ult.length + p.length + 2 <= max) trozos[trozos.length - 1] = `${ult}\n\n${p}`;
    else trozos.push(p);
  }
  return trozos;
}

/** Una parte del correo (lo que llega por IMAP) a texto: su codificación y su juego de letras. */
export function decodificarParte(buf: Buffer | Uint8Array, codificacion = '', juego = 'utf-8'): string {
  let bytes = Buffer.from(buf);
  const cod = codificacion.toLowerCase();
  if (cod === 'base64') {
    const b64 = bytes.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, '');
    bytes = Buffer.from(b64.slice(0, b64.length - (b64.length % 4)), 'base64');
  } else if (cod === 'quoted-printable') {
    const qp = bytes.toString('latin1').replace(/=\r?\n/g, '');
    const out: number[] = [];
    for (let i = 0; i < qp.length; i++) {
      const h = qp[i] === '=' ? qp.slice(i + 1, i + 3) : '';
      if (/^[0-9A-Fa-f]{2}$/.test(h)) {
        out.push(parseInt(h, 16));
        i += 2;
      } else out.push(qp.charCodeAt(i) & 0xff);
    }
    bytes = Buffer.from(out);
  }
  try {
    return new TextDecoder(juego || 'utf-8').decode(bytes).replace(/�+$/, '');
  } catch {
    return new TextDecoder('utf-8').decode(bytes).replace(/�+$/, '');
  }
}

type NodoEstructura = { part?: string; type: string; parameters?: Record<string, string>; encoding?: string; disposition?: string; dispositionParameters?: Record<string, string>; id?: string; childNodes?: NodoEstructura[] };

/**
 * De la estructura del correo (BODYSTRUCTURE): la parte de texto que se puede leer (la de texto plano; si
 * no hay, la de HTML) y los nombres de los adjuntos (sin las imágenes metidas en el cuerpo).
 */
export function partesDe(est: NodoEstructura | undefined): { texto: { parte: string; codificacion: string; juego: string; html: boolean } | null; adjuntos: string[] } {
  const adjuntos: string[] = [];
  let plano: NodoEstructura | null = null;
  let html: NodoEstructura | null = null;
  const ir = (n: NodoEstructura | undefined) => {
    if (!n) return;
    if (n.childNodes?.length) return n.childNodes.forEach(ir);
    const tipo = String(n.type || '').toLowerCase();
    const nombre = n.dispositionParameters?.filename || n.parameters?.name || '';
    const disp = String(n.disposition || '').toLowerCase();
    const esAdjunto = disp === 'attachment' || (!!nombre && !tipo.startsWith('text/') && !(tipo.startsWith('image/') && (disp === 'inline' || n.id)));
    if (esAdjunto) adjuntos.push(nombre || tipo);
    else if (tipo === 'text/plain' && !plano) plano = n;
    else if (tipo === 'text/html' && !html) html = n;
  };
  ir(est);
  const elegido: NodoEstructura | null = plano || html;
  return {
    texto: elegido
      ? {
          parte: (elegido as NodoEstructura).part || '1',
          codificacion: (elegido as NodoEstructura).encoding || '',
          juego: (elegido as NodoEstructura).parameters?.charset || 'utf-8',
          html: !plano,
        }
      : null,
    adjuntos,
  };
}

/**
 * Los de la bandeja de entrada de una cuenta: los no leídos (o los últimos), del más nuevo al más viejo.
 * Con `extractos`, cada uno trae también el principio de su texto y sus adjuntos (sin marcarlo leído).
 */
/**
 * Cuánto se miró (AUR13, cobertura honesta): `total` los que encajan en la bandeja de entrada, `revisados` los que se
 * trajeron. Quien llama pasa el objeto y `listar` lo llena; así dice «miré los 13 más recientes de 40», no «todo».
 */
export type Cobertura = { total?: number; revisados?: number };

export async function listar(
  quien: string,
  c: CuentaCorreo,
  o: { soloNoLeidos?: boolean; buscar?: string; n?: number; extractos?: boolean; cobertura?: Cobertura; desde?: Date; hasta?: Date } = {}
): Promise<Resumen[]> {
  const cliente = await imapPara(c.proveedor, await credencial(quien, c));
  try {
    const candado = await cliente.getMailboxLock('INBOX', { readOnly: true });
    try {
      const t = o.buscar?.trim();
      const base: Record<string, unknown> = t ? { or: [{ from: t }, { subject: t }, { body: t }] } : o.soloNoLeidos ? { seen: false } : { all: true };
      // LANG-02: un intervalo («el último correo de ayer»). SINCE/BEFORE de IMAP son por DÍA y en la zona del servidor:
      // se abre un día de margen a cada lado y quien llama filtra exacto por la hora (America/Tegucigalpa).
      const DIA = 24 * 3600_000;
      const consulta = {
        ...base,
        ...(o.desde ? { since: new Date(o.desde.getTime() - DIA) } : {}),
        ...(o.hasta ? { before: new Date(o.hasta.getTime() + DIA) } : {}),
      };
      const uids = ((await cliente.search(consulta, { uid: true })) || []) as number[];
      const ultimos = uids.slice(-(o.n ?? 10)).reverse();
      if (o.cobertura) Object.assign(o.cobertura, { total: uids.length, revisados: ultimos.length });
      if (!ultimos.length) return [];
      const msgs = await cliente.fetchAll(ultimos.join(','), { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: !!o.extractos }, { uid: true });
      const lista: Resumen[] = [];
      for (const m of msgs) {
        const de = m.envelope?.from?.[0];
        const r: Resumen = {
          ref: `${c.id}:${m.uid}`,
          cuenta: c.correo,
          de: de?.name || de?.address || '',
          deCorreo: de?.address || '',
          asunto: m.envelope?.subject || '(sin asunto)',
          // Sin fecha del servidor ni del encabezado: '' (no «ahora»: un correo sin fecha no es el más nuevo ni «de hoy»).
          fecha: m.internalDate || m.envelope?.date ? new Date((m.internalDate || m.envelope?.date) as Date | string).toISOString() : '',
          noLeido: !m.flags?.has('\\Seen'),
        };
        if (o.extractos && m.bodyStructure) {
          // El principio del texto (los primeros 3 KB de su parte de texto, con PEEK: no lo marca leído).
          const partes = partesDe(m.bodyStructure as NodoEstructura);
          r.adjuntos = partes.adjuntos;
          if (partes.texto) {
            try {
              const x = await cliente.fetchOne(String(m.uid), { uid: true, bodyParts: [{ key: partes.texto.parte, maxLength: 3000 }] }, { uid: true });
              const buf = x && x.bodyParts ? [...x.bodyParts.values()][0] : undefined;
              if (buf) {
                const crudo = decodificarParte(buf, partes.texto.codificacion, partes.texto.juego);
                r.extracto = extractoDe(partes.texto.html ? htmlATexto(crudo) : crudo);
              }
            } catch {
              /* sin extracto: igual se lista */
            }
          }
        }
        lista.push(r);
      }
      return lista.sort((a, b) => b.fecha.localeCompare(a.fecha));
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
      // El texto plano si lo trae y dice algo; si no (o es solo «ver en el navegador»), el HTML pasado a texto.
      const deHtml = typeof p.html === 'string' ? htmlATexto(p.html) : '';
      const plano = (p.text || '').trim();
      const texto = plano.length >= 40 || !deHtml ? plano || deHtml : deHtml.length > plano.length * 2 ? deHtml : plano;
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
        // Las imágenes metidas en el cuerpo (logos, firmas: `related`) no son adjuntos para la persona.
        adjuntos: (p.attachments || []).filter((a) => !a.related).map((a) => ({ nombre: a.filename || 'adjunto', tipo: a.contentType, bytes: a.size })),
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

/** Lo más grande que se baja un correo entero para sacarle un adjunto, y lo más grande que se lee de un adjunto. */
export const MAX_CORREO_CON_ADJUNTOS = 30 * 1024 * 1024;
export const MAX_ADJUNTO_CORREO = 10 * 1024 * 1024;

export type AdjuntoCorreo =
  | { estado: 'ok'; nombre: string; tipo: string; bytes: number; datos: Buffer; n: number; total: number; de: string; deCorreo: string; asunto: string }
  | { estado: 'fuera'; total: number; nombres: string[] }
  | { estado: 'grande'; bytes: number; nombre?: string };

/**
 * El adjunto `n` (desde 1, en el orden en que `leer` los nombra: sin las imágenes metidas en el cuerpo) de un correo de
 * ESA cuenta. Sin marcarlo leído (el buzón se abre de solo lectura). null si el correo ya no está. Un correo de más de
 * MAX_CORREO_CON_ADJUNTOS ni se baja; un adjunto de más de MAX_ADJUNTO_CORREO no se devuelve.
 */
export async function adjunto(quien: string, c: CuentaCorreo, uid: number, n: number): Promise<AdjuntoCorreo | null> {
  const cliente = await imapPara(c.proveedor, await credencial(quien, c));
  try {
    const candado = await cliente.getMailboxLock('INBOX', { readOnly: true });
    try {
      const meta = await cliente.fetchOne(String(uid), { uid: true, size: true }, { uid: true });
      if (!meta) return null;
      if (Number(meta.size) > MAX_CORREO_CON_ADJUNTOS) return { estado: 'grande', bytes: Number(meta.size) };
      const m = await cliente.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
      if (!m || !m.source) return null;
      const p = await simpleParser(m.source);
      const adjuntos = (p.attachments || []).filter((a) => !a.related);
      const a = adjuntos[n - 1];
      if (!a) return { estado: 'fuera', total: adjuntos.length, nombres: adjuntos.map((x) => x.filename || 'adjunto') };
      const nombre = a.filename || 'adjunto';
      if (a.size > MAX_ADJUNTO_CORREO) return { estado: 'grande', bytes: a.size, nombre };
      const de = nombreDe(p.from);
      return { estado: 'ok', nombre, tipo: a.contentType || 'application/octet-stream', bytes: a.size, datos: Buffer.from(a.content), n, total: adjuntos.length, de: de.nombre, deCorreo: de.correo, asunto: p.subject || '(sin asunto)' };
    } finally {
      candado.release();
    }
  } finally {
    await cliente.logout().catch(() => {});
  }
}

export type Envio = {
  para: string[];
  cc?: string[];
  asunto: string;
  texto: string;
  enRespuestaA?: string;
  referencias?: string[];
  /** AUR13: el Message-ID que pone AURA (derivado de la operación, lib/envios.ts): con él se reconcilia en Enviados. */
  messageId?: string;
  /** AUR13: el operationId del registro durable (no viaja en el correo; para la traza y las pruebas). */
  operacion?: string;
};

/** Un fallo ANTES de hablar con el SMTP (la clave, el token, la dirección del servidor): seguro que no salió nada. */
export class FalloAntesDeMandar extends Error {
  antesDeMandar = true;
  constructor(public causa: unknown) {
    super(String((causa as any)?.message || causa));
    // Lo que explicarFallo mira para decirlo bien (la clave, el certificado, el servidor).
    for (const k of ['code', 'command', 'responseCode', 'response', 'responseText', 'authenticationFailed', 'serverResponseCode']) {
      if ((causa as any)?.[k] !== undefined) (this as any)[k] = (causa as any)[k];
    }
  }
}

/**
 * Manda un correo. Se arma una sola vez (MailComposer) para mandar por SMTP y, si el proveedor no lo
 * hace solo, guardar esa misma copia en «Enviados» por IMAP.
 */
export async function mandar(quien: string, c: CuentaCorreo, e: Envio): Promise<{ messageId: string; guardadoEnEnviados: boolean; aceptados: string[]; rechazados: string[] }> {
  let cred: Credencial;
  let crudo: Buffer;
  let t: Awaited<ReturnType<typeof smtpPara>>;
  try {
    cred = await credencial(quien, c);
    const correo = {
      from: c.correo,
      to: e.para.join(', '),
      ...(e.cc?.length ? { cc: e.cc.join(', ') } : {}),
      subject: e.asunto,
      text: e.texto,
      ...(e.messageId ? { messageId: e.messageId } : {}),
      ...(e.enRespuestaA ? { inReplyTo: e.enRespuestaA, references: [...(e.referencias || []), e.enRespuestaA].join(' ') } : {}),
    };
    crudo = await new MailComposer(correo).compile().build();
    t = await smtpPara(c.proveedor, cred);
  } catch (err) {
    throw new FalloAntesDeMandar(err);
  }
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

/**
 * AUR13, reconciliar un envío incierto: ¿está en «Enviados» el correo con este Message-ID? `encontrado` lo prueba;
 * `no-encontrado` NO prueba que no salió (el proveedor puede no guardar copia, o tardar); `sin-carpeta` si la cuenta
 * no tiene carpeta de enviados. Lanza si no se pudo mirar (quien llama lo trata como «no consta»).
 */
export async function buscarEnviado(quien: string, c: CuentaCorreo, messageId: string): Promise<'encontrado' | 'no-encontrado' | 'sin-carpeta'> {
  const id = String(messageId || '').trim();
  if (!/^<[^<>\s]{3,500}>$/.test(id)) return 'no-encontrado';
  const cliente = await imapPara(c.proveedor, await credencial(quien, c));
  try {
    const carpetas = await cliente.list();
    const enviados = carpetas.find((f) => f.specialUse === '\\Sent')?.path || carpetas.find((f) => /^(sent|enviados|sent items|elementos enviados)$/i.test(f.name))?.path;
    if (!enviados) return 'sin-carpeta';
    const candado = await cliente.getMailboxLock(enviados, { readOnly: true });
    try {
      const uids = ((await cliente.search({ header: { 'message-id': id } }, { uid: true })) || []) as number[];
      return uids.length ? 'encontrado' : 'no-encontrado';
    } finally {
      candado.release();
    }
  } finally {
    await cliente.logout().catch(() => {});
  }
}
