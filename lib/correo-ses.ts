/**
 * CORREO POR AMAZON SES, SIN SDK.
 *
 * Los enlaces de contraseña y los avisos de cuentas nuevas salen de aquí. La cuenta de AWS de Orden
 * Global ya tiene SES en producción y el dominio ordenglobal.org verificado (SPF, DKIM, DMARC), así
 * que no hace falta otro proveedor: una llamada firmada a la API v2 de SES, igual que lib/s3.ts firma
 * las de S3.
 *
 * Variables:
 *  · AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION — las mismas de la memoria en S3; el
 *    usuario IAM necesita `ses:SendEmail` para el remitente.
 *  · CORREO_REMITENTE — por defecto «Orden Global <no-responder@ordenglobal.org>».
 *  · CORREO_DESVIO_ARCHIVO — SOLO para probar en local: los correos se escriben en ese archivo (una
 *    línea JSON cada uno) en vez de salir. En producción no se pone.
 *
 * Nunca lanza: devuelve { ok, detalle } para que quien llama decida qué decir.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { regionAws } from './s3';

export type Correo = { para: string; asunto: string; texto: string; html?: string; responderA?: string };
export type EnvioCorreo = { ok: boolean; detalle: string; id?: string };

export const REMITENTE_POR_DEFECTO = 'Orden Global <no-responder@ordenglobal.org>';

export function remitente(): string {
  return String(process.env.CORREO_REMITENTE || REMITENTE_POR_DEFECTO).trim();
}

export function correoListo(): boolean {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

const sha256hex = (d: string | Buffer) => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k: crypto.BinaryLike, d: string) => crypto.createHmac('sha256', k).update(d).digest();

/** La petición firmada (SigV4) para SES v2 SendEmail. Separada para poder probarla sin red. */
export function peticionSes(c: Correo, ahora = new Date()) {
  const access = String(process.env.AWS_ACCESS_KEY_ID || '').trim();
  const secret = String(process.env.AWS_SECRET_ACCESS_KEY || '').trim();
  const region = regionAws();
  const host = `email.${region}.amazonaws.com`;
  const ruta = '/v2/email/outbound-emails';
  const cuerpo = JSON.stringify({
    FromEmailAddress: remitente(),
    Destination: { ToAddresses: [c.para] },
    ...(c.responderA ? { ReplyToAddresses: [c.responderA] } : {}),
    Content: {
      Simple: {
        Subject: { Data: c.asunto, Charset: 'UTF-8' },
        Body: {
          Text: { Data: c.texto, Charset: 'UTF-8' },
          ...(c.html ? { Html: { Data: c.html, Charset: 'UTF-8' } } : {}),
        },
      },
    },
  });
  const amzDate = ahora.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const fecha = amzDate.slice(0, 8);
  const hashCuerpo = sha256hex(cuerpo);
  const headers: Record<string, string> = { 'content-type': 'application/json', host, 'x-amz-date': amzDate };
  const firmadas = Object.keys(headers).sort();
  const canonica = ['POST', ruta, '', firmadas.map((k) => `${k}:${headers[k]}\n`).join(''), firmadas.join(';'), hashCuerpo].join('\n');
  const alcance = `${fecha}/${region}/ses/aws4_request`;
  const aFirmar = `AWS4-HMAC-SHA256\n${amzDate}\n${alcance}\n${sha256hex(canonica)}`;
  const kFirma = hmac(hmac(hmac(hmac(`AWS4${secret}`, fecha), region), 'ses'), 'aws4_request');
  const firma = crypto.createHmac('sha256', kFirma).update(aFirmar).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${access}/${alcance}, SignedHeaders=${firmadas.join(';')}, Signature=${firma}`;
  return { url: `https://${host}${ruta}`, headers, cuerpo };
}

/** Una dirección de correo razonable: sin espacios, una @, dominio con punto. */
export function correoValido(c: unknown): boolean {
  const s = String(c || '').trim();
  return s.length <= 254 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i.test(s);
}

export async function enviarCorreo(c: Correo): Promise<EnvioCorreo> {
  const desvio = String(process.env.CORREO_DESVIO_ARCHIVO || '').trim();
  if (desvio) {
    try {
      fs.appendFileSync(desvio, JSON.stringify({ ...c, en: new Date().toISOString() }) + '\n');
      return { ok: true, detalle: `desviado a ${desvio}` };
    } catch (e: any) {
      return { ok: false, detalle: String(e?.message || e).slice(0, 200) };
    }
  }
  if (!correoListo()) return { ok: false, detalle: 'Sin AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY: no hay con qué mandar correo.' };
  if (!correoValido(c.para)) return { ok: false, detalle: 'Dirección de correo inválida.' };
  const p = peticionSes(c);
  try {
    const r = await fetch(p.url, { method: 'POST', headers: p.headers, body: p.cuerpo, signal: AbortSignal.timeout(12000) });
    const t = await r.text();
    if (!r.ok) return { ok: false, detalle: `SES ${r.status}: ${t.slice(0, 200)}` };
    let id: string | undefined;
    try {
      id = JSON.parse(t)?.MessageId;
    } catch {
      /* SES contestó 200 sin JSON: el correo salió igual */
    }
    return { ok: true, detalle: 'enviado', id };
  } catch (e: any) {
    return { ok: false, detalle: String(e?.message || e).slice(0, 200) };
  }
}
