/**
 * LOS CALENDARIOS QUE CONECTÓ CADA PERSONA (Microsoft y/o Google) y su permiso, cifrado.
 *
 * El mismo cofre que el correo (lib/correo/cuentas.ts): los tokens van cifrados con AES-256-GCM con la llave de
 * CORREO_CLAVE_CIFRADO (o la de la sesión), a S3 (`ultron/calendario/<huella>.json`) y a disco; el modelo nunca los ve.
 * Las mismas reglas de honestidad del cofre: «no pude leer» no es «no tienes calendario» (`leidas: false`), y conectar
 * solo dice que quedó si S3 lo confirmó (si S3 existe); el token renovado se guarda aunque S3 falle (más vale en memoria).
 *
 * `conAcceso`: el token vigente (lo renueva si vence en menos de 2 min o si la API dice 401, una vez) y la llamada. Si
 * el proveedor ya no deja renovar, la conexión queda marcada `reconectar` (la app lo dice así, no «conectado»).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cifrar, descifrar } from '../correo/cuentas';
import { s3GetJson, s3Listo, s3PutJson } from '../s3';
import { ErrorCalendario, renovarTokens, type ProveedorCal, type TokensCal } from './proveedores';

export type ConexionCal = {
  proveedor: ProveedorCal;
  cuenta: string;
  /** Cifrado: los tokens en JSON. */
  secreto: string;
  agregada: number;
  /** El proveedor ya no deja renovar el permiso: hay que volver a conectar. */
  reconectar?: boolean;
};
export type ConexionPublica = Omit<ConexionCal, 'secreto'>;
export const publicaCal = ({ secreto: _s, ...resto }: ConexionCal): ConexionPublica => resto;

type Fetch = typeof fetch;

const cache = new Map<string, ConexionCal[]>();
const normal = (q: string) => String(q || '').trim().toLowerCase();
const huella = (q: string) => crypto.createHash('sha256').update(`calendario|${normal(q)}`).digest('hex').slice(0, 32);
const claveS3 = (q: string) => `ultron/calendario/${huella(q)}.json`;
const carpeta = () => process.env.ULTRON_CALENDARIO_DIR || path.join(process.cwd(), 'data', 'calendario');

function deDisco(q: string): ConexionCal[] | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(carpeta(), `${huella(q)}.json`), 'utf8')).conexiones ?? null;
  } catch {
    return null;
  }
}

function aDisco(q: string, xs: ConexionCal[]) {
  try {
    fs.mkdirSync(carpeta(), { recursive: true });
    const f = path.join(carpeta(), `${huella(q)}.json`);
    fs.writeFileSync(`${f}.tmp`, JSON.stringify({ conexiones: xs }), { mode: 0o600 });
    fs.renameSync(`${f}.tmp`, f);
  } catch {
    /* disco de solo lectura: queda S3 */
  }
}

/** Las conexiones de una persona; `leidas: false` si S3 no dejó leerlas (no es «no tiene»). */
export async function conexionesDe(quien: string): Promise<{ leidas: boolean; conexiones: ConexionCal[] }> {
  const q = normal(quien);
  if (!q) return { leidas: true, conexiones: [] };
  const c = cache.get(q);
  if (c) return { leidas: true, conexiones: c };
  let xs = deDisco(q);
  if (!xs && s3Listo()) {
    const r = await s3GetJson(claveS3(q)).catch(() => null);
    if (r?.ok && Array.isArray(r.json?.conexiones)) {
      xs = r.json.conexiones;
      aDisco(q, xs!);
    } else if (!r?.ok) return { leidas: false, conexiones: [] };
  }
  cache.set(q, xs ?? []);
  return { leidas: true, conexiones: xs ?? [] };
}

export class CalendarioNoGuardado extends Error {}

async function guardar(quien: string, xs: ConexionCal[], soloSiDurable: boolean): Promise<void> {
  const q = normal(quien);
  if (s3Listo()) {
    const r = await s3PutJson(claveS3(q), { conexiones: xs }).catch((e) => ({ ok: false, detalle: String(e?.message || e) }));
    if (!r.ok && soloSiDurable) throw new CalendarioNoGuardado('No pude guardar tu calendario de forma segura en este momento; no cambié nada. Prueba otra vez en un rato.');
  }
  cache.set(q, xs);
  aDisco(q, xs);
}

async function paraCambiar(quien: string): Promise<ConexionCal[]> {
  const r = await conexionesDe(quien);
  if (!r.leidas) throw new CalendarioNoGuardado('No pude leer tus calendarios guardados en este momento; no cambié nada. Prueba otra vez en un rato.');
  return r.conexiones;
}

/** Conecta (o reemplaza) el calendario de ese proveedor. Lanza CalendarioNoGuardado sin haber cambiado nada. */
export async function conectarCalendario(quien: string, proveedor: ProveedorCal, cuenta: string, tokens: TokensCal): Promise<ConexionCal> {
  const xs = await paraCambiar(quien);
  const c: ConexionCal = { proveedor, cuenta: cuenta || '', secreto: cifrar(JSON.stringify(tokens)), agregada: Date.now() };
  await guardar(quien, [...xs.filter((x) => x.proveedor !== proveedor), c], true);
  return c;
}

/** Quita la conexión de ese proveedor. false si no estaba. */
export async function desconectarCalendario(quien: string, proveedor: ProveedorCal): Promise<boolean> {
  const xs = await paraCambiar(quien);
  const quedan = xs.filter((x) => x.proveedor !== proveedor);
  if (quedan.length === xs.length) return false;
  await guardar(quien, quedan, true);
  return true;
}

async function actualizar(quien: string, proveedor: ProveedorCal, cambio: Partial<ConexionCal>) {
  const r = await conexionesDe(quien);
  if (!r.leidas) return;
  await guardar(
    quien,
    r.conexiones.map((x) => (x.proveedor === proveedor ? { ...x, ...cambio } : x)),
    false
  ).catch(() => undefined);
}

/** Margen: se renueva si el token vence en menos de esto. */
const MARGEN_MS = 2 * 60_000;

/**
 * Corre `f` con un token vigente de ese proveedor: lo renueva antes si está por vencer y, si la API dice 401, renueva
 * y reintenta UNA vez. Lo renovado queda guardado (Microsoft rota el de renovación: perderlo obligaría a reconectar).
 */
export async function conAcceso<T>(quien: string, proveedor: ProveedorCal, f: (acceso: string) => Promise<T>, o: { traer?: Fetch; ahora?: () => number } = {}): Promise<T> {
  const r = await conexionesDe(quien);
  if (!r.leidas) throw new ErrorCalendario('No pude leer tu calendario guardado ahora mismo.', 'proveedor');
  const c = r.conexiones.find((x) => x.proveedor === proveedor);
  if (!c) throw new ErrorCalendario('Ese calendario no está conectado.', 'reconectar');
  if (c.reconectar) throw new ErrorCalendario('El permiso del calendario venció o se quitó: hay que volver a conectarlo.', 'reconectar');
  let t: TokensCal;
  try {
    t = JSON.parse(descifrar(c.secreto));
  } catch {
    throw new ErrorCalendario('No pude abrir el permiso guardado del calendario: hay que volver a conectarlo.', 'reconectar');
  }
  const ahora = o.ahora || Date.now;
  const renovarYGuardar = async () => {
    try {
      t = await renovarTokens(proveedor, t, o.traer);
    } catch (e) {
      if (e instanceof ErrorCalendario && e.codigo === 'reconectar') await actualizar(quien, proveedor, { reconectar: true });
      throw e;
    }
    await actualizar(quien, proveedor, { secreto: cifrar(JSON.stringify(t)), reconectar: false });
  };
  if (!t.acceso || t.venceEl - ahora() < MARGEN_MS) await renovarYGuardar();
  try {
    return await f(t.acceso);
  } catch (e) {
    if (!(e instanceof ErrorCalendario) || e.codigo !== 'auth') throw e;
    await renovarYGuardar();
    return f(t.acceso);
  }
}

/** Pruebas. */
export function _olvidarCalendarios() {
  cache.clear();
}
