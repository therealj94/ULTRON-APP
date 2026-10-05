/**
 * S3 mínimo (SigV4): GetObject / PutObject / ListObjectsV2. Sin SDK. Cero teatro si faltan claves.
 *
 * Dos cubos: la memoria de ULTRON (`ULTRON_MEMORIA_BUCKET`) y el de expedientes de Dr Electrum
 * (`ELECTRUM_EXPEDIENTES_BUCKET`), donde José sube carpetas enteras y quedan los originales.
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

export function bucketExpedientes(): string {
  return String(process.env.ELECTRUM_EXPEDIENTES_BUCKET || '').trim();
}

export function expedientesListo(): boolean {
  return !!(bucketExpedientes() && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
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

/**
 * Codificación de SigV4 (RFC 3986). `encodeURIComponent` deja sin tocar `!'()*`, y S3 las exige
 * codificadas en la petición canónica: «HND_SilverProspects (1).docx» daba SignatureDoesNotMatch.
 */
function rfc3986(s: string) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function encodePath(key: string) {
  return (
    '/' +
    key
      .split('/')
      .map((p) => rfc3986(p))
      .join('/')
  );
}

async function s3(opts: {
  method: 'GET' | 'PUT';
  key: string;
  body?: Buffer;
  bucket?: string;
  query?: Record<string, string>;
  contentType?: string;
  timeoutMs?: number;
  /** «bytes=a-b»: solo ese tramo del objeto (S3 contesta 206). No entra en la firma: S3 no lo exige. */
  range?: string;
  /**
   * Escritura condicional (lib/durable.ts): `If-None-Match: *` (crear solo si no existe; 412 si ya existe) o
   * `If-Match: <ETag>` (compare-and-set; 412 si cambió). Van firmadas.
   */
  condicion?: { 'if-none-match'?: '*'; 'if-match'?: string };
}): Promise<{ ok: boolean; status: number; body: Buffer; detalle: string; cabeceras?: Record<string, string> }> {
  const bucket = opts.bucket ?? bucketMemoria();
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
  const contentType = opts.method === 'PUT' ? opts.contentType || 'application/json' : '';
  const query = Object.keys(opts.query || {})
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(opts.query![k])}`)
    .join('&');
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) headers['content-type'] = contentType;
  if (opts.condicion?.['if-none-match']) headers['if-none-match'] = opts.condicion['if-none-match'];
  if (opts.condicion?.['if-match']) headers['if-match'] = opts.condicion['if-match'];
  const signed = Object.keys(headers).sort();
  const canonicalHeaders = signed.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = signed.join(';');
  const canonical = [opts.method, path, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256hex(canonical)}`;
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  if (opts.range) headers.range = opts.range;
  try {
    const r = await fetch(`https://${host}${path}${query ? `?${query}` : ''}`, {
      method: opts.method,
      headers,
      body: opts.method === 'PUT' ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 12000),
    });
    const buf = Buffer.from(await r.arrayBuffer());
    const cabeceras: Record<string, string> = {};
    for (const k of ['content-range', 'etag', 'last-modified', 'content-type']) {
      const v = r.headers.get(k);
      if (v) cabeceras[k] = v;
    }
    if (!r.ok) {
      return { ok: false, status: r.status, body: buf, detalle: `S3 ${r.status}: ${buf.toString('utf8').slice(0, 160)}`, cabeceras };
    }
    return { ok: true, status: r.status, body: buf, detalle: 'ok', cabeceras };
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

/** Un JSON con su ETag (para el compare-and-set de lib/durable.ts). 404 = `missing`, no un fallo. */
export async function s3GetJsonConEtag(key: string, timeoutMs = 8000): Promise<{ ok: boolean; json: any | null; etag: string | null; detalle: string; missing?: boolean }> {
  const r = await s3({ method: 'GET', key, timeoutMs });
  if (r.status === 404) return { ok: true, json: null, etag: null, detalle: 'vacío', missing: true };
  if (!r.ok) return { ok: false, json: null, etag: null, detalle: r.detalle };
  try {
    return { ok: true, json: JSON.parse(r.body.toString('utf8')), etag: r.cabeceras?.etag || null, detalle: 'ok' };
  } catch {
    return { ok: false, json: null, etag: null, detalle: 'S3: JSON inválido' };
  }
}

/**
 * PUT condicional: `siNoExiste` (If-None-Match: *) o `siCoincide` (If-Match: ETag). `conflicto` cuando S3
 * contesta 412 (la condición no se cumplió) o 409 (otra escritura condicional al mismo objeto en curso:
 * se reintenta leyendo). Cualquier otro fallo es `ok: false` sin conflicto: no se sabe, no se da por hecho.
 */
export async function s3PutJsonCondicional(
  key: string,
  json: unknown,
  cond: { siNoExiste?: boolean; siCoincide?: string },
  timeoutMs = 8000
): Promise<{ ok: boolean; etag: string | null; conflicto: boolean; status: number; detalle: string }> {
  const body = Buffer.from(JSON.stringify(json), 'utf8');
  const condicion = cond.siNoExiste ? { 'if-none-match': '*' as const } : cond.siCoincide ? { 'if-match': cond.siCoincide } : undefined;
  if (!condicion) return { ok: false, etag: null, conflicto: false, status: 0, detalle: 'PUT condicional sin condición' };
  const r = await s3({ method: 'PUT', key, body, condicion, timeoutMs });
  return { ok: r.ok, etag: r.cabeceras?.etag || null, conflicto: r.status === 412 || r.status === 409, status: r.status, detalle: r.detalle };
}

/**
 * Las claves de un nivel bajo `prefijo` en el cubo de la memoria (ListObjectsV2 con `delimiter=/`), en orden de clave,
 * empezando DESPUÉS de `desde` (`start-after`: reanudable sin guardar el token de S3). A7 (lib/tareas-durables.ts): es
 * el inventario de las tareas de UN dueño. Necesita el permiso `s3:ListBucket` sobre el cubo (limitado al prefijo
 * `ultron/durable/`); sin él S3 contesta 403 y esto es `ok: false`: no se sabe, no se da por vacío.
 */
export async function s3ListarClaves(
  prefijo: string,
  o: { desde?: string | null; max?: number; timeoutMs?: number } = {}
): Promise<{ ok: true; claves: string[]; truncado: boolean } | { ok: false; detalle: string }> {
  const query: Record<string, string> = { 'list-type': '2', prefix: prefijo, delimiter: '/', 'max-keys': String(Math.max(1, Math.min(1000, Math.floor(o.max || 1000)))) };
  if (o.desde) query['start-after'] = o.desde;
  const r = await s3({ method: 'GET', key: '', query, timeoutMs: o.timeoutMs ?? 8000 });
  if (!r.ok) return { ok: false, detalle: r.detalle };
  const xml = r.body.toString('utf8');
  if (!/<ListBucketResult[\s>]/.test(xml)) return { ok: false, detalle: 'S3 contestó un listado ilegible' };
  const claves = entreEtiquetas(xml, 'Contents')
    .map((c) => desescaparXml(entreEtiquetas(c, 'Key')[0] || ''))
    .filter((k) => k.startsWith(prefijo));
  return { ok: true, claves, truncado: entreEtiquetas(xml, 'IsTruncated')[0] === 'true' };
}

/* ------------------------------------------------------------ cubo de expedientes (Dr Electrum) */

export type ObjetoS3 = { key: string; bytes: number; modificado: string };

function entreEtiquetas(xml: string, etiqueta: string): string[] {
  const re = new RegExp(`<${etiqueta}>([\\s\\S]*?)</${etiqueta}>`, 'g');
  const out: string[] = [];
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(m[1]);
  return out;
}

function desescaparXml(s: string) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

/** Todo lo que hay bajo un prefijo (ListObjectsV2, página a página). */
export async function listarExpedientes(prefijo: string, tope = 20_000): Promise<{ ok: boolean; objetos: ObjetoS3[]; detalle: string }> {
  const bucket = bucketExpedientes();
  if (!bucket) return { ok: false, objetos: [], detalle: 'Falta ELECTRUM_EXPEDIENTES_BUCKET.' };
  const objetos: ObjetoS3[] = [];
  let token = '';
  for (;;) {
    const query: Record<string, string> = { 'list-type': '2', prefix: prefijo, 'max-keys': '1000' };
    if (token) query['continuation-token'] = token;
    const r = await s3({ method: 'GET', key: '', bucket, query, timeoutMs: 30_000 });
    if (!r.ok) return { ok: false, objetos, detalle: r.detalle };
    const xml = r.body.toString('utf8');
    for (const c of entreEtiquetas(xml, 'Contents')) {
      const key = desescaparXml(entreEtiquetas(c, 'Key')[0] || '');
      if (!key || key.endsWith('/')) continue;
      objetos.push({ key, bytes: Number(entreEtiquetas(c, 'Size')[0] || 0), modificado: entreEtiquetas(c, 'LastModified')[0] || '' });
    }
    if (objetos.length >= tope) return { ok: true, objetos: objetos.slice(0, tope), detalle: `cortado en ${tope}` };
    const truncado = entreEtiquetas(xml, 'IsTruncated')[0] === 'true';
    token = desescaparXml(entreEtiquetas(xml, 'NextContinuationToken')[0] || '');
    if (!truncado || !token) return { ok: true, objetos, detalle: 'ok' };
  }
}

/** Las «carpetas» de primer nivel bajo un prefijo (con delimitador). */
export async function carpetasExpedientes(prefijo: string): Promise<{ ok: boolean; carpetas: string[]; detalle: string }> {
  const bucket = bucketExpedientes();
  if (!bucket) return { ok: false, carpetas: [], detalle: 'Falta ELECTRUM_EXPEDIENTES_BUCKET.' };
  const r = await s3({ method: 'GET', key: '', bucket, query: { 'list-type': '2', prefix: prefijo, delimiter: '/', 'max-keys': '1000' }, timeoutMs: 30_000 });
  if (!r.ok) return { ok: false, carpetas: [], detalle: r.detalle };
  const xml = r.body.toString('utf8');
  const carpetas = entreEtiquetas(xml, 'CommonPrefixes').map((c) => desescaparXml(entreEtiquetas(c, 'Prefix')[0] || '')).filter(Boolean);
  return { ok: true, carpetas, detalle: 'ok' };
}

/** Un original del cubo de expedientes, entero. */
export async function bajarExpediente(key: string): Promise<{ ok: boolean; datos: Buffer; detalle: string }> {
  const bucket = bucketExpedientes();
  if (!bucket) return { ok: false, datos: Buffer.alloc(0), detalle: 'Falta ELECTRUM_EXPEDIENTES_BUCKET.' };
  const r = await s3({ method: 'GET', key, bucket, timeoutMs: 180_000 });
  return { ok: r.ok, datos: r.ok ? r.body : Buffer.alloc(0), detalle: r.detalle };
}

/** Guarda un original en el cubo de expedientes (lo que entra por la pantalla también queda). */
export async function guardarExpediente(key: string, datos: Buffer, tipo = 'application/octet-stream'): Promise<{ ok: boolean; detalle: string }> {
  const bucket = bucketExpedientes();
  if (!bucket) return { ok: false, detalle: 'Falta ELECTRUM_EXPEDIENTES_BUCKET.' };
  const r = await s3({ method: 'PUT', key, bucket, body: datos, contentType: tipo, timeoutMs: 180_000 });
  return { ok: r.ok, detalle: r.detalle };
}

/**
 * Un TRAMO de un objeto del cubo de expedientes (Range). Lo usan las teselas: un archivo PMTiles de
 * 240 MB se lee a pedacitos, el que pide cada tesela, sin bajarlo nunca entero.
 */
export async function tramoExpediente(
  key: string,
  desde: number,
  hasta: number
): Promise<{ ok: boolean; status: number; datos: Buffer; total: number | null; etag: string | null; detalle: string }> {
  const bucket = bucketExpedientes();
  if (!bucket) return { ok: false, status: 0, datos: Buffer.alloc(0), total: null, etag: null, detalle: 'Falta ELECTRUM_EXPEDIENTES_BUCKET.' };
  const r = await s3({ method: 'GET', key, bucket, range: `bytes=${desde}-${hasta}`, timeoutMs: 30_000 });
  const m = /\/(\d+)$/.exec(r.cabeceras?.['content-range'] || '');
  return {
    ok: r.ok,
    status: r.status,
    datos: r.ok ? r.body : Buffer.alloc(0),
    total: m ? Number(m[1]) : null,
    etag: r.cabeceras?.etag || null,
    detalle: r.detalle,
  };
}
