/**
 * S3 mínimo (SigV4): GetObject / PutObject. Sin SDK. Cero teatro si faltan claves.
 */

import crypto from 'node:crypto';

export function bucketMemoria(): string {
  return String(process.env.ULTRON_MEMORIA_BUCKET || '').trim();
}

export function regionAws(): string {
  return String(process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1')
    .trim()
    .replace(' ', '-');
}

export function s3Listo(): boolean {
  return !!(bucketMemoria() && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

function sha256hex(data: string | Buffer) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key: crypto.BinaryLike, data: string) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function amzDateNow() {
  const d = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return { amzDate: d, dateStamp: d.slice(0, 8) };
}

function encodePath(key: string) {
  return (
    '/' +
    key
      .split('/')
      .map((p) => encodeURIComponent(p))
      .join('/')
  );
}

async function s3(opts: { method: 'GET' | 'PUT'; key: string; body?: Buffer }): Promise<{ ok: boolean; status: number; body: Buffer; detalle: string }> {
  const bucket = bucketMemoria();
  const access = String(process.env.AWS_ACCESS_KEY_ID || '').trim();
  const secret = String(process.env.AWS_SECRET_ACCESS_KEY || '').trim();
  const region = regionAws();
  if (!bucket || !access || !secret) {
    return { ok: false, status: 0, body: Buffer.alloc(0), detalle: 'Falta ULTRON_MEMORIA_BUCKET o AWS_* . No toqué S3.' };
  }
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const path = encodePath(opts.key);
  const body = opts.body || Buffer.alloc(0);
  const payloadHash = sha256hex(body);
  const { amzDate, dateStamp } = amzDateNow();
  const contentType = opts.method === 'PUT' ? 'application/json' : '';
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) headers['content-type'] = contentType;
  const signed = Object.keys(headers).sort();
  const canonicalHeaders = signed.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = signed.join(';');
  const canonical = [opts.method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256hex(canonical)}`;
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  try {
    const r = await fetch(`https://${host}${path}`, {
      method: opts.method,
      headers,
      body: opts.method === 'PUT' ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(12000),
    });
    const buf = Buffer.from(await r.arrayBuffer());
    if (!r.ok) {
      return { ok: false, status: r.status, body: buf, detalle: `S3 ${r.status}: ${buf.toString('utf8').slice(0, 160)}` };
    }
    return { ok: true, status: r.status, body: buf, detalle: 'ok' };
  } catch (e: any) {
    return { ok: false, status: 0, body: Buffer.alloc(0), detalle: String(e?.message || e).slice(0, 160) };
  }
}

export async function s3GetJson(key: string): Promise<{ ok: boolean; json: any | null; detalle: string; missing?: boolean }> {
  const r = await s3({ method: 'GET', key });
  if (r.status === 404) return { ok: true, json: null, detalle: 'vacío', missing: true };
  if (!r.ok) return { ok: false, json: null, detalle: r.detalle };
  try {
    return { ok: true, json: JSON.parse(r.body.toString('utf8')), detalle: 'ok' };
  } catch {
    return { ok: false, json: null, detalle: 'S3: JSON inválido' };
  }
}

export async function s3PutJson(key: string, json: unknown): Promise<{ ok: boolean; detalle: string }> {
  const body = Buffer.from(JSON.stringify(json), 'utf8');
  const r = await s3({ method: 'PUT', key, body });
  return { ok: r.ok, detalle: r.detalle };
}
