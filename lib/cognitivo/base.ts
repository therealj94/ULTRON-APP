/**
 * DÓNDE SE GUARDA LO COGNITIVO — trazas, auditoría, aprobaciones, entidades.
 *
 * Postgres si hay una base: `COGNITIVO_DB_URL`, o la de Dr Electrum (`ELECTRUM_DB_URL`) si no hay
 * otra, porque es la misma máquina y una base más es una copia de seguridad más que olvidar.
 * Sin base, cae a archivos JSONL en `data/cognitivo/`: la plataforma tiene que poder arrancar en
 * un portátil o en Render sin disco persistente y seguir dejando rastro, aunque ese rastro se
 * pierda al redesplegar. Quien lee `tipo()` sabe cuál de los dos tiene.
 *
 * Una regla atraviesa todo el módulo: **guardar nunca rompe un turno**. Si la base se cae a media
 * conversación, la persona recibe su respuesta y el fallo va al log. La traza es para auditar, no
 * una razón más para que el sistema no conteste.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { ESQUEMA_COGNITIVO } from './esquema';

let pool: Pool | null = null;
let esquemaListo: Promise<void> | null = null;

export function urlBase(): string {
  return String(process.env.COGNITIVO_DB_URL || process.env.ELECTRUM_DB_URL || '').trim();
}

export function tipo(): 'postgres' | 'archivo' {
  return urlBase() ? 'postgres' : 'archivo';
}

function conexion(): Pool {
  if (!pool) {
    const url = urlBase();
    pool = new Pool({
      connectionString: url,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 6_000,
      ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
    });
    // Un cliente ocioso que se cae no puede tumbar el proceso.
    pool.on('error', (e) => console.error('[cognitivo] conexión perdida:', String(e?.message || e).slice(0, 160)));
  }
  return pool;
}

/** Crea las tablas la primera vez. Idempotente; una sola vez por proceso. */
export function asegurarEsquema(): Promise<void> {
  if (tipo() !== 'postgres') return Promise.resolve();
  if (!esquemaListo) {
    esquemaListo = conexion()
      .query(ESQUEMA_COGNITIVO)
      .then(() => undefined)
      .catch((e) => {
        esquemaListo = null; // se reintenta en la próxima petición
        throw e;
      });
  }
  return esquemaListo;
}

export async function sql<T = any>(texto: string, params: unknown[] = []): Promise<T[]> {
  await asegurarEsquema();
  const r = await conexion().query(texto, params as any[]);
  return r.rows as T[];
}

/** Una transacción: el bloque recibe su propia función de consulta. */
export async function enTransaccion<T>(fn: (q: <R = any>(t: string, p?: unknown[]) => Promise<R[]>) => Promise<T>): Promise<T> {
  await asegurarEsquema();
  const c = await conexion().connect();
  try {
    await c.query('BEGIN');
    const out = await fn(async (t, p = []) => (await c.query(t, p as any[])).rows);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function cerrar() {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
    esquemaListo = null;
  }
}

/* ------------------------------------------------------------------ archivos */

export function dirArchivos(): string {
  return path.resolve(process.env.COGNITIVO_DIR || path.join(process.cwd(), 'data', 'cognitivo'));
}

/** Tope por archivo: al pasarlo se rota y se conserva el anterior (.1). */
const topeBytes = () => Number(process.env.COGNITIVO_TOPE_BYTES || 20 * 1024 * 1024);

/**
 * Anexa una fila. Al pasar el tope, el archivo actual pasa a `.1`.
 *
 * Con `historia: true` (la auditoría) el `.1` anterior NO se pisa: se archiva como
 * `.gen-<fecha>`. Una cadena de hashes que pierde su principio ya no se puede verificar —el primer
 * registro que queda apunta a uno que no existe— y parecería alterada sin que nadie la tocara.
 */
export function anexar(coleccion: string, fila: unknown, opts: { historia?: boolean } = {}) {
  const dir = dirArchivos();
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${coleccion}.jsonl`);
  try {
    if (fs.existsSync(f) && fs.statSync(f).size > topeBytes()) {
      if (opts.historia && fs.existsSync(`${f}.1`)) {
        fs.renameSync(`${f}.1`, `${f}.gen-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.hrtime.bigint()}`);
      }
      fs.renameSync(f, `${f}.1`);
    }
  } catch {
    /* si no se pudo rotar, se sigue anexando */
  }
  fs.appendFileSync(f, `${JSON.stringify(fila)}\n`);
}

function leerArchivoJsonl<T>(p: string, out: T[]) {
  if (!fs.existsSync(p)) return;
  for (const linea of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!linea.trim()) continue;
    try {
      out.push(JSON.parse(linea));
    } catch {
      /* línea cortada por un apagón: se salta */
    }
  }
}

/** La colección entera, con las generaciones archivadas, de la más vieja a la más nueva. */
export function leerHistoria<T = any>(coleccion: string): T[] {
  const dir = dirArchivos();
  const base = `${coleccion}.jsonl`;
  const archivadas = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((n) => n.startsWith(`${base}.gen-`))
        .sort()
    : [];
  const out: T[] = [];
  for (const n of archivadas) leerArchivoJsonl(path.join(dir, n), out);
  leerArchivoJsonl(path.join(dir, `${base}.1`), out);
  leerArchivoJsonl(path.join(dir, base), out);
  return out;
}

/** Todas las filas de una colección (actual + rotada), de la más vieja a la más nueva. */
export function leerTodas<T = any>(coleccion: string): T[] {
  const f = path.join(dirArchivos(), `${coleccion}.jsonl`);
  const out: T[] = [];
  for (const p of [`${f}.1`, f]) {
    if (!fs.existsSync(p)) continue;
    for (const linea of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!linea.trim()) continue;
      try {
        out.push(JSON.parse(linea));
      } catch {
        /* línea cortada por un apagón: se salta */
      }
    }
  }
  return out;
}

/** Reescribe una colección entera (para las que se actualizan, como las aprobaciones). */
export function reescribir(coleccion: string, filas: unknown[]) {
  const dir = dirArchivos();
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${coleccion}.jsonl`);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, filas.map((x) => JSON.stringify(x)).join('\n') + (filas.length ? '\n' : ''));
  fs.renameSync(tmp, f);
}

/* ------------------------------------------------------------------ secretos */

/**
 * Lo que no puede quedar escrito en una traza aunque alguien lo pegue en el chat.
 *
 * Pasa: la junta pega claves en la conversación para que el sistema las use. La traza es lo que un
 * auditor va a leer, y una clave en texto plano ahí es una clave filtrada. Se tapa antes de guardar.
 */
const PATRONES_SECRETOS: RegExp[] = [
  /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, // AWS
  /\bsk_[A-Za-z0-9]{20,}\b/g, // ElevenLabs y similares
  /\b[rsp]k_(live|test)_[A-Za-z0-9]{10,}\b/g, // Stripe
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google
  /\bsk-[A-Za-z0-9_-]{20,}\b/g, // OpenAI y similares
  /\brnd_[A-Za-z0-9]{16,}\b/g, // Render
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g, // token de bot de Telegram
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:\s/]+:[^@\s]+@/gi, // URL con clave
  // Secreto de AWS: 40 caracteres base64 con mayúsculas Y minúsculas. Exigir las dos deja fuera
  // los hashes hexadecimales (sha1, commits), que son de 40 también y no son secretos.
  /(?<![A-Za-z0-9+/])(?=[A-Za-z0-9/+]{0,39}[A-Z])(?=[A-Za-z0-9/+]{0,39}[a-z])[A-Za-z0-9/+]{40}(?![A-Za-z0-9+/=])/g,
];

export function redactar(texto: string): string {
  let s = String(texto ?? '');
  for (const re of PATRONES_SECRETOS) s = s.replace(re, '[SECRETO TAPADO]');
  // {"password":"xxx"}, 'api_key': 'xxx'
  s = s.replace(
    /(["'](?:clave|contrase[ñn]a|password|passwd|pass|secret[oa]?|token|api[_-]?key|access[_-]?key|private[_-]?key)["']\s*:\s*["'])([^"']{4,})(["'])/gi,
    '$1[SECRETO TAPADO]$3'
  );
  // «clave: xxx», «password=xxx», «la clave es xxx», «mi contraseña es xxx», «token xxx»
  s = s.replace(/\b(clave|contrase[ñn]a|password|passwd|secret[oa]?|token|api[_ -]?key)(\s*[:=]\s*|\s+(?:es|is|era)\s+|\s+)([^\s"',}]{6,})/gi, '$1$2[SECRETO TAPADO]');
  return s;
}

/** Corta y tapa: lo que entra a una traza. */
export function paraTraza(texto: unknown, max = 4000): string {
  return redactar(String(texto ?? '')).slice(0, max);
}
