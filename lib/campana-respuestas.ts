/**
 * CAMPAÑA SFSP: QUIÉN CONTESTÓ.
 *
 * Todos los días a las 7:00 de Honduras, AU-RA abre el buzón de José (j.ordonez@ordenglobal.org)
 * por IMAP, SOLO PARA LEER (EXAMINE: no marca nada como leído, no mueve ni borra), y le manda por
 * Telegram quién contestó el correo de la campaña en las últimas 24 horas. Aparta los rebotes y a
 * quien pidió no recibir más, para anotarlo en la lista de bajas.
 *
 * Variables:
 *  · CAMPANA_IMAP_CLAVE (obligatoria): la contraseña del buzón. Sin ella no arranca.
 *  · CAMPANA_IMAP_USUARIO (j.ordonez@ordenglobal.org), CAMPANA_IMAP_HOST (mail.ordenglobal.org),
 *    CAMPANA_IMAP_PUERTO (993).
 *
 * El IMAP es un cliente mínimo sobre TLS (LOGIN, EXAMINE, SEARCH, FETCH de cabeceras y el inicio
 * del texto, LOGOUT): cinco órdenes no justifican una dependencia más en el servidor.
 */

import tls from 'node:tls';
import { canales } from './canales';

export type Respuesta = { de: string; correo: string; asunto: string; fecha: string; extracto: string };
export type Clasificadas = { respuestas: Respuesta[]; bajas: Respuesta[]; rebotes: Respuesta[] };

// Los asuntos del correo de la campaña, en los dos idiomas y en sus versiones anteriores.
const ASUNTOS = /invitaci[oó]n personal|personal invitation|unir a centroam[eé]rica|unite central america|uniting central america/i;
const REBOTE = /mailer-daemon|postmaster|mail delivery|delivery status|undeliver|no se pudo entregar|returned mail|failure notice/i;
const BAJA = /^\s*(no|no gracias|no, gracias|no thanks|no, thanks|unsubscribe|remove|stop|baja|darme de baja)\s*[.!]?\s*$/i;

// ─── Hora de la revisión ─────────────────────────────────────────────────────────────────────────

/** La próxima 7:00 de Honduras (UTC−6, sin horario de verano) después de `ahora`. */
export function proximaRevision(ahora = new Date(), hora = 7): Date {
  const utc = hora + 6;
  const d = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate(), utc, 0, 0));
  if (d.getTime() <= ahora.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

// ─── Lectura de cabeceras ────────────────────────────────────────────────────────────────────────

/** «=?UTF-8?B?...?=» y «=?UTF-8?Q?...?=» (RFC 2047) a texto. */
export function decodificarCabecera(s: string): string {
  return s
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, tipo: string, dato: string) => {
      try {
        const buf = tipo.toUpperCase() === 'B'
          ? Buffer.from(dato, 'base64')
          : Buffer.from(dato.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (__, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
        return new TextDecoder(/utf-?8/i.test(charset) ? 'utf-8' : 'latin1').decode(buf);
      } catch {
        return dato;
      }
    });
}

function cabecera(bloque: string, nombre: string): string {
  const m = bloque.match(new RegExp(`^${nombre}:([^\\r\\n]*(?:\\r?\\n[ \\t][^\\r\\n]*)*)`, 'im'));
  return m ? decodificarCabecera(m[1].replace(/\r?\n[ \t]+/g, ' ').trim()) : '';
}

/** «José <j@x.org>» → { nombre: 'José', correo: 'j@x.org' }. */
export function remitente(from: string): { nombre: string; correo: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  if (m) return { nombre: m[1].trim() || m[2], correo: m[2].trim().toLowerCase() };
  const c = from.trim().toLowerCase();
  return { nombre: c, correo: c };
}

/** La primera línea escrita por quien contesta: sin la cita del correo original. */
export function extracto(texto: string): string {
  const lineas: string[] = [];
  for (const l of texto.split(/\r?\n/)) {
    if (/^\s*>/.test(l) || /^(el|on) .+(escribió|wrote):?\s*$/i.test(l.trim()) || /^-{2,}\s*(original|mensaje)/i.test(l.trim())) break;
    if (/^(content-|--)/i.test(l.trim())) continue;
    if (l.trim()) lineas.push(l.trim());
    if (lineas.join(' ').length > 200) break;
  }
  return lineas.join(' ').slice(0, 200);
}

/**
 * Texto plano del inicio del cuerpo: quita cabeceras MIME y decodifica quoted-printable o base64.
 * `crudo` son los bytes tal cual (latin1: un carácter por byte); el resultado es UTF-8.
 */
export function textoDelCuerpo(crudo: string): string {
  let t = crudo;
  const qp = /content-transfer-encoding:\s*quoted-printable/i.test(t);
  const b64 = t.match(/content-transfer-encoding:\s*base64\s*\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/i);
  if (b64) {
    try { return Buffer.from(b64[1].replace(/\s+/g, ''), 'base64').toString('utf8'); } catch { /* sigue */ }
  }
  t = t.replace(/^[\s\S]*?content-type:\s*text\/plain[^\n]*\n(?:[a-z-]+:[^\n]*\n)*\r?\n/i, '');
  if (qp) t = t.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return Buffer.from(t, 'latin1').toString('utf8');
}

/** Separa las respuestas de la campaña, las bajas y los rebotes. Lo demás del buzón no se toca. */
export function clasificar(mensajes: Array<{ from: string; asunto: string; fecha: string; texto: string }>): Clasificadas {
  const out: Clasificadas = { respuestas: [], bajas: [], rebotes: [] };
  for (const m of mensajes) {
    const { nombre, correo } = remitente(m.from);
    const r: Respuesta = { de: nombre, correo, asunto: m.asunto, fecha: m.fecha, extracto: extracto(m.texto) };
    if (REBOTE.test(m.from) || REBOTE.test(m.asunto)) {
      if (ASUNTOS.test(m.texto) || ASUNTOS.test(m.asunto)) out.rebotes.push(r);
      continue;
    }
    if (!ASUNTOS.test(m.asunto)) continue;
    if (BAJA.test(r.extracto) || /^\s*no\s*$/i.test(m.asunto.replace(/^(re|aw|rv|fw|fwd):\s*/i, ''))) out.bajas.push(r);
    else out.respuestas.push(r);
  }
  return out;
}

/** El mensaje de Telegram. Si nadie contestó, también se dice: José quiere saberlo cada mañana. */
export function resumen(c: Clasificadas, desde: Date): string {
  const dia = desde.toISOString().slice(0, 10);
  const lineas = [`AU-RA · Campaña SFSP · respuestas desde el ${dia}`];
  if (!c.respuestas.length) lineas.push('', 'Nadie contestó en las últimas 24 horas.');
  else {
    lineas.push('', `Contestaron ${c.respuestas.length}:`);
    for (const r of c.respuestas.slice(0, 25)) lineas.push(`• ${r.de} <${r.correo}>${r.extracto ? `\n  «${r.extracto}»` : ''}`);
    if (c.respuestas.length > 25) lineas.push(`… y ${c.respuestas.length - 25} más en el buzón.`);
  }
  if (c.bajas.length) lineas.push('', `Pidieron no recibir más (${c.bajas.length}), van a bajas.txt:`, ...c.bajas.map((r) => `• ${r.correo}`));
  if (c.rebotes.length) lineas.push('', `Rebotaron ${c.rebotes.length} (el correo no existe o no acepta).`);
  lineas.push('', 'Todo está en j.ordonez@ordenglobal.org.');
  return lineas.join('\n');
}

// ─── IMAP mínimo ─────────────────────────────────────────────────────────────────────────────────

const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fechaImap = (d: Date) => `${d.getUTCDate()}-${MESES[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
const citar = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

class Imap {
  private sock!: tls.TLSSocket;
  private buf = '';
  private n = 0;
  private espera: ((s: string) => void) | null = null;

  async abrir(host: string, puerto: number) {
    await new Promise<void>((ok, mal) => {
      this.sock = tls.connect({ host, port: puerto, servername: host }, () => ok());
      this.sock.setTimeout(30_000, () => this.sock.destroy(new Error('IMAP sin respuesta')));
      this.sock.on('error', mal);
      this.sock.on('data', (d) => { this.buf += d.toString('latin1'); this.revisar(); });
    });
    await this.hasta(/^\* (OK|PREAUTH)/m);
  }

  private revisar() { if (this.espera) this.espera(this.buf); }

  private hasta(re: RegExp): Promise<string> {
    return new Promise((ok) => {
      const mirar = (b: string) => { if (re.test(b)) { this.espera = null; const r = this.buf; this.buf = ''; ok(r); } };
      this.espera = mirar;
      mirar(this.buf);
    });
  }

  async orden(texto: string): Promise<string> {
    const tag = `a${++this.n}`;
    this.sock.write(`${tag} ${texto}\r\n`);
    const r = await this.hasta(new RegExp(`^${tag} (OK|NO|BAD)`, 'm'));
    if (!new RegExp(`^${tag} OK`, 'm').test(r)) throw new Error(`IMAP ${texto.split(' ')[0]}: ${r.split('\n').pop()?.slice(0, 120)}`);
    return r;
  }

  cerrar() { try { this.sock.write('z LOGOUT\r\n'); this.sock.end(); } catch { /* ya cerrado */ } }
}

/** Los mensajes del buzón desde `desde`: remitente, asunto, fecha y el inicio del texto. */
export async function leerBuzon(desde: Date) {
  const host = process.env.CAMPANA_IMAP_HOST || 'mail.ordenglobal.org';
  const puerto = Number(process.env.CAMPANA_IMAP_PUERTO || 993);
  const usuario = process.env.CAMPANA_IMAP_USUARIO || 'j.ordonez@ordenglobal.org';
  const clave = process.env.CAMPANA_IMAP_CLAVE || '';
  if (!clave) throw new Error('Falta CAMPANA_IMAP_CLAVE.');
  const imap = new Imap();
  await imap.abrir(host, puerto);
  try {
    await imap.orden(`LOGIN ${citar(usuario)} ${citar(clave)}`);
    await imap.orden('EXAMINE INBOX');
    const busca = await imap.orden(`SEARCH SINCE ${fechaImap(desde)}`);
    const ids = (busca.match(/^\* SEARCH([\d ]*)/m)?.[1] || '').trim().split(/\s+/).filter(Boolean).slice(-300);
    if (!ids.length) return [];
    const r = await imap.orden(`FETCH ${ids.join(',')} (INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] BODY.PEEK[TEXT]<0.3000>)`);
    // Cada mensaje empieza con «* N FETCH»; dentro vienen las cabeceras y el inicio del texto.
    return r.split(/^\* \d+ FETCH /m).slice(1).map((bloque) => {
      const fecha = bloque.match(/INTERNALDATE "([^"]+)"/)?.[1] || '';
      const i = bloque.search(/BODY\[TEXT\]/i);
      const cab = i > 0 ? bloque.slice(0, i) : bloque;
      // El texto llega como literal IMAP «{n}\r\n» seguido de n bytes exactos: se corta ahí, o se
      // colaría el cierre de la respuesta.
      const lit = i > 0 ? bloque.slice(i).match(/^BODY\[TEXT\]<?\d*>? \{(\d+)\}\r?\n/i) : null;
      const cuerpo = lit ? bloque.slice(i + lit[0].length, i + lit[0].length + Number(lit[1])) : '';
      return { from: cabecera(cab, 'From'), asunto: cabecera(cab, 'Subject'), fecha, texto: textoDelCuerpo(cuerpo) };
    }).filter((m) => new Date(m.fecha).getTime() >= desde.getTime() || !m.fecha);
  } finally {
    imap.cerrar();
  }
}

// ─── La revisión diaria ──────────────────────────────────────────────────────────────────────────

export async function revisarRespuestas(ahora = new Date()): Promise<{ ok: boolean; detalle: string }> {
  const desde = new Date(ahora.getTime() - 24 * 3600_000);
  try {
    const c = clasificar(await leerBuzon(desde));
    const env = await canales.telegram({ texto: resumen(c, desde) });
    return { ok: env.ok, detalle: `${c.respuestas.length} respuestas, ${c.bajas.length} bajas, ${c.rebotes.length} rebotes · ${env.detalle}` };
  } catch (e: any) {
    // Si el buzón no abre, José también se entera: el silencio parecería «nadie contestó».
    const detalle = String(e?.message || e).slice(0, 160);
    await canales.telegram({ texto: `AU-RA · Campaña SFSP: no pude revisar el buzón esta mañana (${detalle}).` }).catch(() => {});
    return { ok: false, detalle };
  }
}

let reloj: ReturnType<typeof setTimeout> | null = null;

export function iniciarRevisionCampana(): string {
  if (reloj) return 'ya estaba en marcha';
  if (!process.env.CAMPANA_IMAP_CLAVE) return 'apagada: falta CAMPANA_IMAP_CLAVE';
  const programar = () => {
    const cuando = proximaRevision();
    reloj = setTimeout(async () => {
      const r = await revisarRespuestas();
      console.log('[AU-RA] campaña', r.detalle);
      programar();
    }, cuando.getTime() - Date.now());
    return cuando;
  };
  return `próxima revisión ${programar().toISOString()}`;
}
