/**
 * CUENTAS PROPIAS DE AU-RA FP Y DR ELECTRUM.
 *
 * Hasta ahora la clave de cada persona vivía en el cerebro remoto (ultron.ordenglobal.link), escrita
 * en una variable de entorno: nadie podía cambiarla ni recuperarla sin tocar Render a mano, y entrar
 * una persona nueva era editar un JSON. Aquí cada plataforma tiene su propio registro, en la misma
 * base Postgres para las dos (así la clave es UNA aunque sean dos servicios):
 *
 *  · `cuentas.cuenta`    — correo, nombre, clave (scrypt, nunca en claro), a qué plataformas entra.
 *  · `cuentas.enlace`    — enlaces de un solo uso para poner o recuperar la clave: se guarda la
 *                          huella SHA-256, no el enlace; vencen solos y se gastan al usarse.
 *  · `cuentas.solicitud` — quien pide entrar desde la web, hasta que el aprobador dice sí o no.
 *
 * El cerebro remoto sigue siendo la puerta de quien todavía no se hizo clave propia: la primera vez
 * que alguien cambia o recupera su clave, la de aquí manda y la del remoto deja de abrir estas dos
 * plataformas (no se toca, porque abre otras cosas de Orden Global).
 *
 * Base: `CUENTAS_DB_URL`, o la cognitiva, o la de Dr Electrum. Sin base, todo esto contesta «no
 * disponible» y la entrada funciona como antes.
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { configTls } from '../lib/ssl-base';
import { exigirBaseDePrueba } from '../lib/base-de-pruebas';
import { fijarCuentasAprobadas, personaPorCorreoExacto, type Nivel, type Plataforma } from '../lib/acceso';
import { DOMINIO_CODIGO, fijarClaveCambiadaEn } from './seguridad';

const scrypt = promisify(crypto.scrypt) as (clave: crypto.BinaryLike, sal: crypto.BinaryLike, largo: number, opciones: crypto.ScryptOptions) => Promise<Buffer>;

export type Cuenta = {
  correo: string;
  nombre: string;
  acceso: Partial<Record<Plataforma, Nivel>>;
  estado: 'activa' | 'suspendida';
  tieneClave: boolean;
  claveDesde: number | null;
};

export type Solicitud = {
  id: number;
  nombre: string;
  correo: string;
  motivo: string;
  plataforma: Plataforma;
  estado: 'pendiente' | 'aprobada' | 'rechazada';
  nivel: Nivel | null;
  creada: string;
  decidida: string | null;
  decididaPor: string | null;
};

export const NIVELES: Nivel[] = ['lee', 'escribe', 'mando'];

/* ------------------------------------------------------------------ base */

let pool: Pool | null = null;
let esquemaListo: Promise<void> | null = null;

export function urlCuentas(): string {
  return String(process.env.CUENTAS_DB_URL || process.env.COGNITIVO_DB_URL || process.env.ELECTRUM_DB_URL || '').trim();
}

export function cuentasDisponibles(): boolean {
  return !!urlCuentas();
}

const ESQUEMA = `
CREATE SCHEMA IF NOT EXISTS cuentas;
CREATE TABLE IF NOT EXISTS cuentas.cuenta (
  correo       text PRIMARY KEY,
  nombre       text NOT NULL DEFAULT '',
  clave_hash   text,
  clave_desde  bigint,
  acceso       jsonb NOT NULL DEFAULT '{}'::jsonb,
  estado       text NOT NULL DEFAULT 'activa',
  creada       timestamptz NOT NULL DEFAULT now(),
  aprobada_por text
);
CREATE TABLE IF NOT EXISTS cuentas.enlace (
  huella  text PRIMARY KEY,
  correo  text NOT NULL,
  tipo    text NOT NULL,
  vence   timestamptz NOT NULL,
  usado   timestamptz,
  creado  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS enlace_correo_tipo ON cuentas.enlace (correo, tipo);
CREATE TABLE IF NOT EXISTS cuentas.solicitud (
  id           bigserial PRIMARY KEY,
  nombre       text NOT NULL,
  correo       text NOT NULL,
  motivo       text NOT NULL DEFAULT '',
  plataforma   text NOT NULL,
  estado       text NOT NULL DEFAULT 'pendiente',
  nivel        text,
  creada       timestamptz NOT NULL DEFAULT now(),
  decidida     timestamptz,
  decidida_por text,
  nota         text
);
CREATE INDEX IF NOT EXISTS solicitud_estado ON cuentas.solicitud (estado, creada DESC);
CREATE TABLE IF NOT EXISTS cuentas.codigo (
  id           bigserial PRIMARY KEY,
  huella       text NOT NULL UNIQUE,
  pista        text NOT NULL,
  plataforma   text NOT NULL,
  nivel        text NOT NULL DEFAULT 'lee',
  para         text NOT NULL DEFAULT '',
  creado_por   text NOT NULL,
  creado       timestamptz NOT NULL DEFAULT now(),
  vence        timestamptz NOT NULL,
  revocado     timestamptz,
  primer_uso   timestamptz,
  usos         integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS codigo_vence ON cuentas.codigo (plataforma, vence DESC);
`;

function conexion(): Pool {
  if (!pool) {
    const url = urlCuentas();
    if (!url) throw new Error('sin base de cuentas');
    exigirBaseDePrueba(url);
    pool = new Pool({
      // TLS verificado (lib/ssl-base.ts): la URL sin sus parámetros de TLS y el objeto que de verdad usa pg.
      // Un certificado propio se declara con su CA (BASE_SSL_CA o sslrootcert), no apagando la verificación.
      ...configTls(url),
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
    });
    pool.on('error', (e) => console.error('[cuentas] conexión perdida:', String(e?.message || e).slice(0, 160)));
  }
  return pool;
}

async function asegurarEsquema(): Promise<void> {
  if (!esquemaListo) {
    esquemaListo = (async () => {
      // Los dos servicios arrancan a la vez contra la misma base: si uno crea el esquema mientras
      // el otro también, el segundo choca con un «ya existe» de catálogo. Un reintento lo resuelve.
      try {
        await conexion().query(ESQUEMA);
      } catch {
        await new Promise((r) => setTimeout(r, 400));
        await conexion().query(ESQUEMA);
      }
    })().catch((e) => {
      esquemaListo = null;
      throw e;
    });
  }
  return esquemaListo;
}

async function q<T = any>(texto: string, params: unknown[] = []): Promise<T[]> {
  await asegurarEsquema();
  return (await conexion().query(texto, params as any[])).rows as T[];
}

/** Solo pruebas: cierra la conexión y olvida el esquema, para cambiar de base entre pruebas. */
export async function _cerrarCuentas() {
  if (pool) await pool.end().catch(() => {});
  pool = null;
  esquemaListo = null;
  claveDesdePorCorreo.clear();
}

/* ------------------------------------------------------------------ claves */

const N = 16384;
const R = 8;
const P = 1;
const LARGO = 64;

export async function cifrarClave(clave: string): Promise<string> {
  const sal = crypto.randomBytes(16);
  const h = await scrypt(clave.normalize('NFKC'), sal, LARGO, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64url')}$${h.toString('base64url')}`;
}

export async function claveCoincide(clave: string, guardada: string | null | undefined): Promise<boolean> {
  const partes = String(guardada || '').split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, n, r, p, sal, h] = partes;
  const esperado = Buffer.from(h, 'base64url');
  const calculado = await scrypt(clave.normalize('NFKC'), Buffer.from(sal, 'base64url'), esperado.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return calculado.length === esperado.length && crypto.timingSafeEqual(calculado, esperado);
}

/** Qué tiene de malo una clave nueva, o null si sirve. */
export function problemaDeClave(clave: unknown, correo = ''): string | null {
  const c = String(clave ?? '');
  if (c.length < 10) return 'La contraseña necesita al menos 10 caracteres.';
  if (c.length > 200) return 'La contraseña es demasiado larga (máximo 200 caracteres).';
  if (/^(.)\1+$/.test(c)) return 'La contraseña no puede ser un mismo carácter repetido.';
  if (/^\d+$/.test(c)) return 'La contraseña no puede ser solo números.';
  const local = String(correo).split('@')[0].toLowerCase();
  if (local.length >= 4 && c.toLowerCase().includes(local)) return 'La contraseña no puede contener tu correo.';
  return null;
}

/* ------------------------------------------------------------------ caché compartida */

const claveDesdePorCorreo = new Map<string, number>();
fijarClaveCambiadaEn((correo) => claveDesdePorCorreo.get(correo) ?? null);

function filaACuenta(f: any): Cuenta {
  return {
    correo: f.correo,
    nombre: f.nombre || '',
    acceso: f.acceso || {},
    estado: f.estado === 'suspendida' ? 'suspendida' : 'activa',
    tieneClave: !!f.clave_hash,
    claveDesde: f.clave_desde == null ? null : Number(f.clave_desde),
  };
}

/** Un id de padrón estable y que no choca con los de la junta. */
export function idDeCuenta(correo: string): string {
  const local = correo.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24) || 'cuenta';
  return `c-${local}-${crypto.createHash('sha256').update(correo).digest('hex').slice(0, 6)}`;
}

/**
 * Trae de la base lo que el resto del servidor necesita sin esperar: quién tiene acceso aprobado
 * (va al padrón) y desde cuándo vale la clave de cada uno (corta las sesiones viejas). El otro
 * servicio escribe en la misma base, así que esto se repite cada minuto.
 */
export async function recargarCuentas(): Promise<number> {
  if (!cuentasDisponibles()) return 0;
  const filas = await q(`SELECT correo, nombre, acceso, estado, clave_hash IS NOT NULL AS clave_hash, clave_desde FROM cuentas.cuenta`);
  const cuentas = filas.map(filaACuenta);
  // Los códigos de los últimos dos días: los vivos entran al padrón; los vencidos o revocados
  // cortan toda sesión abierta con ellos (sesión anterior a «desde» = no vale).
  const codigos = await q<{ id: string; nivel: Nivel; para: string; plataforma: Plataforma; vence: Date; revocado: Date | null }>(
    `SELECT id::text, nivel, para, plataforma, vence, revocado FROM cuentas.codigo WHERE vence > now() - interval '2 days'`
  );
  claveDesdePorCorreo.clear();
  for (const c of cuentas) if (c.claveDesde) claveDesdePorCorreo.set(c.correo, c.claveDesde);
  const ahora = Date.now();
  const vivos = [];
  for (const k of codigos) {
    const fin = k.revocado ? new Date(k.revocado).getTime() : new Date(k.vence).getTime();
    // Vencido o revocado: TODA sesión suya queda fuera, sin comparar horas (el reloj de la base y el
    // del servidor no tienen por qué coincidir al milisegundo). Con él ya no se abren sesiones nuevas.
    if (k.revocado || fin <= ahora) claveDesdePorCorreo.set(correoDeCodigo(Number(k.id)), Number.MAX_SAFE_INTEGER);
    else vivos.push({ id: `t-${k.id}`, nombre: k.para || 'Invitado', correos: [correoDeCodigo(Number(k.id))], acceso: { [k.plataforma]: k.nivel } });
  }
  fijarCuentasAprobadas([
    ...cuentas
      .filter((c) => c.estado === 'activa' && Object.keys(c.acceso).length)
      .map((c) => ({ id: idDeCuenta(c.correo), nombre: c.nombre, correos: [c.correo], acceso: c.acceso })),
    ...vivos,
  ]);
  return cuentas.length;
}

let reloj: NodeJS.Timeout | null = null;
export function mantenerCuentasAlDia(cadaMs = 60_000) {
  if (!cuentasDisponibles() || reloj) return;
  const una = () => recargarCuentas().catch((e) => console.warn('[cuentas] no pude recargar:', String(e?.message || e).slice(0, 160)));
  void una();
  reloj = setInterval(una, cadaMs);
  reloj.unref?.();
}

/* ------------------------------------------------------------------ cuentas */

export async function cuentaDe(correo: string): Promise<Cuenta | null> {
  const [f] = await q(`SELECT correo, nombre, acceso, estado, clave_hash, clave_desde FROM cuentas.cuenta WHERE correo = $1`, [correo]);
  return f ? filaACuenta(f) : null;
}

/**
 * La entrada con clave propia. `sin_clave` quiere decir «esta persona todavía no se hizo clave
 * aquí»: quien llama prueba entonces con el cerebro remoto, como siempre.
 */
export async function entrarConCuenta(correo: string, clave: string): Promise<'ok' | 'mal' | 'suspendida' | 'sin_clave'> {
  const [f] = await q(`SELECT clave_hash, estado FROM cuentas.cuenta WHERE correo = $1`, [correo]);
  if (!f?.clave_hash) return 'sin_clave';
  if (f.estado === 'suspendida') return 'suspendida';
  return (await claveCoincide(clave, f.clave_hash)) ? 'ok' : 'mal';
}

/**
 * Pone la clave. Desde este momento las sesiones abiertas antes dejan de valer, en este servicio al
 * instante y en el otro en menos de un minuto (lo que tarda en recargar).
 */
export async function fijarClave(correo: string, clave: string, nombre = ''): Promise<number> {
  const hash = await cifrarClave(clave);
  const desde = Date.now();
  await q(
    `INSERT INTO cuentas.cuenta (correo, nombre, clave_hash, clave_desde) VALUES ($1, $2, $3, $4)
     ON CONFLICT (correo) DO UPDATE SET clave_hash = EXCLUDED.clave_hash, clave_desde = EXCLUDED.clave_desde,
       nombre = CASE WHEN cuentas.cuenta.nombre = '' THEN EXCLUDED.nombre ELSE cuentas.cuenta.nombre END`,
    [correo, nombre, hash, desde]
  );
  claveDesdePorCorreo.set(correo, desde);
  return desde;
}

/** ¿Este correo puede pedir un enlace de clave? Solo si está EXACTO en el padrón o tiene cuenta activa. */
export async function puedeRecuperar(correo: string): Promise<boolean> {
  if (personaPorCorreoExacto(correo)) return true;
  const c = await cuentaDe(correo);
  return !!c && c.estado === 'activa' && Object.keys(c.acceso).length > 0;
}

/* ------------------------------------------------------------------ enlaces */

export type TipoEnlace = 'restablecer' | 'activar';
const huella = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

/**
 * Un enlace nuevo invalida los anteriores del mismo tipo para ese correo. Devuelve null si ya se
 * mandó uno hace menos de `esperaMs` (para que el formulario no sirva para inundar un buzón).
 */
export async function crearEnlace(correo: string, tipo: TipoEnlace, minutos: number, esperaMs = 90_000): Promise<string | null> {
  await asegurarEsquema();
  // Todo en una transacción con un candado por correo y tipo: dos pedidos a la vez (dos pestañas, o
  // los dos servicios) no pueden dejar dos enlaces vivos.
  const c = await conexion().connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`cuentas.enlace:${tipo}:${correo}`]);
    if (esperaMs > 0) {
      const r = await c.query(
        `SELECT 1 FROM cuentas.enlace WHERE correo = $1 AND tipo = $2 AND usado IS NULL AND creado > now() - ($3::float8 * interval '1 millisecond') LIMIT 1`,
        [correo, tipo, esperaMs]
      );
      if (r.rowCount) {
        await c.query('COMMIT');
        return null;
      }
    }
    await c.query(`UPDATE cuentas.enlace SET usado = now() WHERE correo = $1 AND tipo = $2 AND usado IS NULL`, [correo, tipo]);
    const token = crypto.randomBytes(32).toString('base64url');
    await c.query(`INSERT INTO cuentas.enlace (huella, correo, tipo, vence) VALUES ($1, $2, $3, now() + ($4::float8 * interval '1 minute'))`, [
      huella(token),
      correo,
      tipo,
      minutos,
    ]);
    await c.query('COMMIT');
    return token;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Gasta el enlace (una sola vez, y solo si no venció). Devuelve el correo, o null. */
export async function usarEnlace(token: string): Promise<{ correo: string; tipo: TipoEnlace } | null> {
  const t = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(t)) return null;
  const [f] = await q(
    `UPDATE cuentas.enlace SET usado = now() WHERE huella = $1 AND usado IS NULL AND vence > now() RETURNING correo, tipo`,
    [huella(t)]
  );
  return f ? { correo: f.correo, tipo: f.tipo } : null;
}

/** ¿Sirve todavía? Para que la pantalla avise ANTES de que la persona escriba su clave nueva. */
export async function enlaceVigente(token: string): Promise<{ correo: string; tipo: TipoEnlace } | null> {
  const t = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(t)) return null;
  const [f] = await q(`SELECT correo, tipo FROM cuentas.enlace WHERE huella = $1 AND usado IS NULL AND vence > now()`, [huella(t)]);
  return f ? { correo: f.correo, tipo: f.tipo } : null;
}

/* ------------------------------------------------------------------ solicitudes */

function filaASolicitud(f: any): Solicitud {
  return {
    id: Number(f.id),
    nombre: f.nombre,
    correo: f.correo,
    motivo: f.motivo || '',
    plataforma: f.plataforma,
    estado: f.estado,
    nivel: f.nivel || null,
    creada: new Date(f.creada).toISOString(),
    decidida: f.decidida ? new Date(f.decidida).toISOString() : null,
    decididaPor: f.decidida_por || null,
  };
}

/**
 * Guarda la solicitud. Null si no hace falta una nueva: ya tiene acceso a esta plataforma o ya hay
 * una pendiente con ese correo. Quien pide no se entera de la diferencia (la respuesta es la misma),
 * para que el formulario no sirva para averiguar quién tiene cuenta.
 */
export async function crearSolicitud(s: { nombre: string; correo: string; motivo: string; plataforma: Plataforma }): Promise<Solicitud | null> {
  const persona = personaPorCorreoExacto(s.correo);
  if (persona?.acceso[s.plataforma]) return null;
  const [pendiente] = await q(`SELECT 1 FROM cuentas.solicitud WHERE correo = $1 AND plataforma = $2 AND estado = 'pendiente' LIMIT 1`, [
    s.correo,
    s.plataforma,
  ]);
  if (pendiente) return null;
  const [f] = await q(`INSERT INTO cuentas.solicitud (nombre, correo, motivo, plataforma) VALUES ($1, $2, $3, $4) RETURNING *`, [
    s.nombre,
    s.correo,
    s.motivo,
    s.plataforma,
  ]);
  return filaASolicitud(f);
}

export async function listarSolicitudes(plataforma: Plataforma, limite = 50): Promise<Solicitud[]> {
  const filas = await q(
    `SELECT * FROM cuentas.solicitud WHERE plataforma = $1
      ORDER BY (estado = 'pendiente') DESC, creada DESC LIMIT $2`,
    [plataforma, limite]
  );
  return filas.map(filaASolicitud);
}

export async function solicitudesPendientes(plataforma: Plataforma): Promise<number> {
  const [f] = await q(`SELECT count(*)::int AS n FROM cuentas.solicitud WHERE plataforma = $1 AND estado = 'pendiente'`, [plataforma]);
  return f?.n || 0;
}

/**
 * Aprueba o rechaza, una sola vez (una solicitud ya decidida no cambia). Al aprobar, la cuenta queda
 * con acceso a la plataforma pedida y el nivel elegido; si todavía no tiene clave, devuelve el enlace
 * para que la persona se la ponga. El acceso que la persona ya tenía en otra plataforma no se toca.
 */
export async function decidirSolicitud(
  id: number,
  decision: 'aprobar' | 'rechazar',
  opciones: { nivel?: Nivel; por: string; nota?: string }
): Promise<{ solicitud: Solicitud; enlace: string | null; yaTeniaClave: boolean } | null> {
  const nivel = decision === 'aprobar' ? opciones.nivel || 'lee' : null;
  if (nivel && !NIVELES.includes(nivel)) throw new Error('nivel inválido');
  const [f] = await q(
    `UPDATE cuentas.solicitud SET estado = $2, nivel = $3, decidida = now(), decidida_por = $4, nota = $5
      WHERE id = $1 AND estado = 'pendiente' RETURNING *`,
    [id, decision === 'aprobar' ? 'aprobada' : 'rechazada', nivel, opciones.por, opciones.nota || null]
  );
  if (!f) return null;
  const solicitud = filaASolicitud(f);
  if (decision === 'rechazar') return { solicitud, enlace: null, yaTeniaClave: false };
  const [c] = await q(
    `INSERT INTO cuentas.cuenta (correo, nombre, acceso, aprobada_por) VALUES ($1, $2, jsonb_build_object($3::text, $4::text), $5)
     ON CONFLICT (correo) DO UPDATE SET acceso = cuentas.cuenta.acceso || jsonb_build_object($3::text, $4::text),
       estado = 'activa', aprobada_por = EXCLUDED.aprobada_por,
       nombre = CASE WHEN cuentas.cuenta.nombre = '' THEN EXCLUDED.nombre ELSE cuentas.cuenta.nombre END
     RETURNING clave_hash IS NOT NULL AS tiene`,
    [solicitud.correo, solicitud.nombre, solicitud.plataforma, nivel, opciones.por]
  );
  await recargarCuentas();
  const yaTeniaClave = !!c?.tiene;
  const enlace = yaTeniaClave ? null : await crearEnlace(solicitud.correo, 'activar', 72 * 60, 0);
  return { solicitud, enlace, yaTeniaClave };
}

/* ------------------------------------------------------------------ códigos temporales */

/**
 * Un acceso que se entrega en mano y se apaga solo: 1, 5 o 24 horas, a lo sumo. Cada código es
 * nuevo y al azar (~59 bits), y de él se guarda solo la huella y los últimos 4 caracteres para
 * reconocerlo en la lista: el código entero se ve UNA vez, al crearlo. La sesión que abre vence
 * con el código, y al revocarlo o vencer, cualquier sesión abierta con él deja de valer.
 */
export const HORAS_CODIGO = [1, 5, 24] as const;
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I/L: se dicta por teléfono

export function correoDeCodigo(id: number): string {
  return `codigo-${id}${DOMINIO_CODIGO}`;
}

/** «de 7kq4 m9xp-2hrt» → «DE-7KQ4-M9XP-2HRT». Null si no tiene forma de código. */
export function normalizarCodigo(texto: unknown): string | null {
  const limpio = String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cuerpo = limpio.startsWith('DE') ? limpio.slice(2) : limpio;
  if (cuerpo.length !== 12 || [...cuerpo].some((c) => !ALFABETO.includes(c))) return null;
  return `DE-${cuerpo.slice(0, 4)}-${cuerpo.slice(4, 8)}-${cuerpo.slice(8)}`;
}

function codigoNuevo(): string {
  const bytes = crypto.randomBytes(24);
  let c = '';
  // Rechazo por encima del múltiplo para que ninguna letra salga más que otra.
  for (const b of bytes) {
    if (b >= 248) continue;
    c += ALFABETO[b % ALFABETO.length];
    if (c.length === 12) break;
  }
  if (c.length < 12) return codigoNuevo();
  return `DE-${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

export type CodigoVisible = {
  id: number;
  pista: string;
  para: string;
  nivel: Nivel;
  creado: string;
  vence: string;
  revocado: string | null;
  primerUso: string | null;
  usos: number;
  estado: 'vivo' | 'vencido' | 'revocado';
};

function filaACodigo(f: any): CodigoVisible {
  const vence = new Date(f.vence);
  return {
    id: Number(f.id),
    pista: f.pista,
    para: f.para || '',
    nivel: f.nivel,
    creado: new Date(f.creado).toISOString(),
    vence: vence.toISOString(),
    revocado: f.revocado ? new Date(f.revocado).toISOString() : null,
    primerUso: f.primer_uso ? new Date(f.primer_uso).toISOString() : null,
    usos: Number(f.usos || 0),
    estado: f.revocado ? 'revocado' : vence.getTime() <= Date.now() ? 'vencido' : 'vivo',
  };
}

export async function crearCodigo(o: { horas: number; plataforma: Plataforma; nivel: Nivel; para: string; por: string }): Promise<{ codigo: string } & CodigoVisible> {
  if (!HORAS_CODIGO.includes(o.horas as any)) throw new Error('duración inválida');
  if (o.nivel === 'mando') throw new Error('un código temporal no da mando');
  for (let intento = 0; intento < 5; intento++) {
    const codigo = codigoNuevo();
    const [f] = await q(
      `INSERT INTO cuentas.codigo (huella, pista, plataforma, nivel, para, creado_por, vence)
       VALUES ($1, $2, $3, $4, $5, $6, now() + ($7::float8 * interval '1 hour'))
       ON CONFLICT (huella) DO NOTHING RETURNING *`,
      [huella(codigo), codigo.slice(-4), o.plataforma, o.nivel, o.para.slice(0, 80), o.por, o.horas]
    );
    if (f) {
      await recargarCuentas();
      return { codigo, ...filaACodigo(f) };
    }
  }
  throw new Error('no pude generar un código único');
}

export async function listarCodigos(plataforma: Plataforma): Promise<CodigoVisible[]> {
  const filas = await q(`SELECT * FROM cuentas.codigo WHERE plataforma = $1 AND vence > now() - interval '7 days' ORDER BY creado DESC LIMIT 40`, [plataforma]);
  return filas.map(filaACodigo);
}

export async function revocarCodigo(id: number, plataforma: Plataforma): Promise<boolean> {
  const [f] = await q(`UPDATE cuentas.codigo SET revocado = now() WHERE id = $1 AND plataforma = $2 AND revocado IS NULL AND vence > now() RETURNING id`, [id, plataforma]);
  if (!f) return false;
  claveDesdePorCorreo.set(correoDeCodigo(id), Number.MAX_SAFE_INTEGER);
  await recargarCuentas();
  return true;
}

/** Entrar con un código: vivo, de esta plataforma y no revocado. */
export async function entrarConCodigo(texto: string, plataforma: Plataforma): Promise<CodigoVisible | null> {
  const codigo = normalizarCodigo(texto);
  if (!codigo) return null;
  const [f] = await q(
    `UPDATE cuentas.codigo SET usos = usos + 1, primer_uso = coalesce(primer_uso, now())
      WHERE huella = $1 AND plataforma = $2 AND revocado IS NULL AND vence > now() RETURNING *`,
    [huella(codigo), plataforma]
  );
  if (!f) return null;
  await recargarCuentas();
  return filaACodigo(f);
}
