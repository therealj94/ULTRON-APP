/**
 * LA CADENA DE AUDITORÍA — lo que pasó, en un orden que no se puede reescribir sin que se note.
 *
 * Cada registro lleva la firma (HMAC-SHA256) del registro anterior más su propio contenido. Si
 * alguien borra una fila o cambia una palabra en la base, la firma de esa fila deja de cuadrar y
 * todas las que vienen detrás también. `verificarCadena()` recorre la cadena y dice el primer
 * eslabón roto.
 *
 * Aquí va lo que un auditor pregunta: qué regla bloqueó qué, quién aprobó qué y cuándo, qué se
 * ejecutó después de aprobarse. No va cada turno de conversación (eso es la traza, que es mucho más
 * voluminosa): va cada DECISIÓN.
 *
 * La clave del HMAC sale de `AUDITORIA_SECRETO` o, si no está, del secreto de sesión. Quien tiene
 * la clave podría rehacer la cadena entera; por eso en producción conviene una clave propia que no
 * viva en la misma base.
 */
import crypto from 'node:crypto';
import { anexar, enTransaccion, leerTodas, sql, tipo } from './base';

export type TipoAuditoria =
  | 'politica.bloqueo'
  | 'politica.revision'
  | 'aprobacion.creada'
  | 'aprobacion.firmada'
  | 'aprobacion.aprobada'
  | 'aprobacion.rechazada'
  | 'aprobacion.vencida'
  | 'aprobacion.ejecutada'
  | 'entidad.cambio'
  | 'sistema.cambio';

export type RegistroAuditoria = {
  seq: number;
  t: string;
  tipo: TipoAuditoria;
  plataforma: string | null;
  quien: string | null;
  datos: Record<string, unknown>;
  hash_prev: string;
  hash: string;
};

const GENESIS = '0'.repeat(64);

function clave(): string {
  const k = String(process.env.AUDITORIA_SECRETO || process.env.ULTRON_SESION_SECRETO || process.env.ULTRON_MESA_CLAVE || '').trim();
  // Sin ninguna clave (desarrollo) la cadena sigue encadenada, pero cualquiera podría rehacerla.
  return k || 'sin-clave-de-auditoria';
}

/** JSON con las llaves ordenadas: el mismo objeto firma igual escrito en cualquier orden. */
export function canonico(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`)
    .join(',')}}`;
}

export function firmar(prev: string, r: { t: string; tipo: string; plataforma: string | null; quien: string | null; datos: unknown }): string {
  return crypto
    .createHmac('sha256', clave())
    .update(`${prev}|${r.t}|${r.tipo}|${r.plataforma ?? ''}|${r.quien ?? ''}|${canonico(r.datos)}`)
    .digest('hex');
}

/** Encola las escrituras al archivo: dos registros simultáneos no pueden firmar el mismo «anterior». */
let colaArchivo: Promise<unknown> = Promise.resolve();

export async function auditar(e: { tipo: TipoAuditoria; plataforma?: string | null; quien?: string | null; datos: Record<string, unknown> }): Promise<RegistroAuditoria | null> {
  const base = { t: new Date().toISOString(), tipo: e.tipo, plataforma: e.plataforma ?? null, quien: e.quien ?? null, datos: e.datos };
  try {
    if (tipo() === 'postgres') {
      // El bloqueo transaccional serializa a todos los que escriben en la cadena, aunque vengan de
      // dos procesos distintos: sin él, dos registros simultáneos colgarían del mismo anterior.
      return await enTransaccion(async (q) => {
        await q(`SELECT pg_advisory_xact_lock(7314159)`);
        const [ult] = await q<{ hash: string }>(`SELECT hash FROM cognitivo.auditoria ORDER BY seq DESC LIMIT 1`);
        const prev = ult?.hash || GENESIS;
        const hash = firmar(prev, base);
        const [fila] = await q<RegistroAuditoria>(
          `INSERT INTO cognitivo.auditoria (t, tipo, plataforma, quien, datos, hash_prev, hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING seq, t, tipo, plataforma, quien, datos, hash_prev, hash`,
          [base.t, base.tipo, base.plataforma, base.quien, base.datos, prev, hash]
        );
        return { ...fila, seq: Number(fila.seq), t: new Date(fila.t as any).toISOString() };
      });
    }
    const hecho = colaArchivo.then(() => {
      const todas = leerTodas<RegistroAuditoria>('auditoria');
      const ult = todas[todas.length - 1];
      const prev = ult?.hash || GENESIS;
      const r: RegistroAuditoria = { seq: (ult?.seq || 0) + 1, ...base, hash_prev: prev, hash: firmar(prev, base) };
      anexar('auditoria', r);
      return r;
    });
    colaArchivo = hecho.catch(() => {});
    return await hecho;
  } catch (err: any) {
    console.error('[auditoría] no pude registrar', e.tipo, String(err?.message || err).slice(0, 160));
    return null;
  }
}

export async function leerAuditoria(opts: { limite?: number; tipo?: string } = {}): Promise<RegistroAuditoria[]> {
  const limite = Math.min(Math.max(opts.limite || 100, 1), 1000);
  if (tipo() === 'postgres') {
    const filas = await sql<RegistroAuditoria>(
      `SELECT seq, t, tipo, plataforma, quien, datos, hash_prev, hash FROM cognitivo.auditoria
       WHERE ($1::text IS NULL OR tipo = $1) ORDER BY seq DESC LIMIT $2`,
      [opts.tipo || null, limite]
    );
    return filas.map((f) => ({ ...f, seq: Number(f.seq), t: new Date(f.t as any).toISOString() }));
  }
  return leerTodas<RegistroAuditoria>('auditoria')
    .filter((r) => !opts.tipo || r.tipo === opts.tipo)
    .reverse()
    .slice(0, limite);
}

/**
 * Recorre la cadena entera desde el principio. Devuelve cuántos eslabones cuadran y, si alguno no,
 * cuál fue el primero roto. Con la cadena de archivo, lo rotado (.1) cuenta como parte de ella.
 */
export async function verificarCadena(): Promise<{ ok: boolean; revisados: number; roto?: { seq: number; motivo: string } }> {
  let filas: RegistroAuditoria[];
  if (tipo() === 'postgres') {
    filas = (await sql<RegistroAuditoria>(`SELECT seq, t, tipo, plataforma, quien, datos, hash_prev, hash FROM cognitivo.auditoria ORDER BY seq ASC`)).map((f) => ({
      ...f,
      seq: Number(f.seq),
      t: new Date(f.t as any).toISOString(),
    }));
  } else {
    filas = leerTodas<RegistroAuditoria>('auditoria');
  }
  let prev = GENESIS;
  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    if (f.hash_prev !== prev) return { ok: false, revisados: i, roto: { seq: f.seq, motivo: 'no cuelga del registro anterior (falta o se movió uno)' } };
    const esperado = firmar(prev, f);
    if (esperado !== f.hash) return { ok: false, revisados: i, roto: { seq: f.seq, motivo: 'el contenido no coincide con su firma (se modificó)' } };
    prev = f.hash;
  }
  return { ok: true, revisados: filas.length };
}
