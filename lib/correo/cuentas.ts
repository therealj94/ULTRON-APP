/**
 * LOS CORREOS DE CADA PERSONA: qué buzones conectó y con qué los abre.
 *
 * La clave (o el token de Microsoft) se guarda cifrada con AES-256-GCM; la llave sale de
 * CORREO_CLAVE_CIFRADO (o, si falta, del secreto de sesión) y nunca se guarda junto a los datos. Lo
 * cifrado va a S3 (`ultron/correo/<huella>.json`) y a disco, como el perfil; la clave en claro solo vive
 * en memoria el rato que dura una conexión. Al modelo nunca le llega ni la clave ni el token.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { clave } from '../boveda';
import { s3GetJson, s3Listo, s3PutJson } from '../s3';
import type { Proveedor } from './proveedores';

export type CuentaCorreo = {
  id: string;
  correo: string;
  proveedor: Pick<Proveedor, 'nombre' | 'imap' | 'smtp' | 'auth' | 'usuario' | 'guardaEnviados'>;
  /** Cifrado: la clave del buzón, o los tokens de Microsoft en JSON. */
  secreto: string;
  agregada: number;
};

/** Lo que se le muestra a la app: sin secreto. */
export type CuentaPublica = Omit<CuentaCorreo, 'secreto'>;

export function publica(c: CuentaCorreo): CuentaPublica {
  const { secreto: _s, ...resto } = c;
  return resto;
}

/* ------------------------------------------------------------------ cifrado */

function llave(): Buffer {
  const base = clave('correo_cifrado');
  if (!base) throw new Error('Falta CORREO_CLAVE_CIFRADO (o ULTRON_SESION_SECRETO) para guardar claves de correo.');
  return crypto.createHash('sha256').update(`correo|${base}`).digest();
}

export function cifrar(texto: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', llave(), iv);
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), datos.toString('base64')].join('.');
}

export function descifrar(sobre: string): string {
  const [v, iv, tag, datos] = String(sobre || '').split('.');
  if (v !== 'v1' || !iv || !tag || !datos) throw new Error('secreto ilegible');
  const d = crypto.createDecipheriv('aes-256-gcm', llave(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(datos, 'base64')), d.final()]).toString('utf8');
}

/* ------------------------------------------------------------------ dónde se guarda */

const cache = new Map<string, CuentaCorreo[]>();

const normal = (quien: string) => String(quien || '').trim().toLowerCase();
const huella = (quien: string) => crypto.createHash('sha256').update(`correo-cuentas|${normal(quien)}`).digest('hex').slice(0, 32);
const claveS3 = (quien: string) => `ultron/correo/${huella(quien)}.json`;
const carpeta = () => process.env.ULTRON_CORREO_DIR || path.join(process.cwd(), 'data', 'correo');

function deDisco(quien: string): CuentaCorreo[] | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(carpeta(), `${huella(quien)}.json`), 'utf8')).cuentas ?? null;
  } catch {
    return null;
  }
}

function aDisco(quien: string, cuentas: CuentaCorreo[]): boolean {
  try {
    fs.mkdirSync(carpeta(), { recursive: true });
    const f = path.join(carpeta(), `${huella(quien)}.json`);
    // Escribir y renombrar: un corte a medias no deja un archivo roto que se leería como «sin cuentas».
    fs.writeFileSync(`${f}.tmp`, JSON.stringify({ cuentas }), { mode: 0o600 });
    fs.renameSync(`${f}.tmp`, f);
    return true;
  } catch {
    /* disco de solo lectura: queda S3 */
    return false;
  }
}

/** S3 no se pudo leer para esta persona: sus cuentas se ven vacías, pero no se puede guardar encima. */
export class CuentasNoDisponibles extends Error {}

/**
 * S3 no confirmó la ESCRITURA (auditoría del 3-oct, COM02): no se cambió nada —ni memoria ni disco—, así
 * que nadie anuncia una cuenta que un reinicio perdería, y lo de antes sigue intacto. Es un
 * CuentasNoDisponibles: la ruta (server/correo.ts, noGuardado) ya lo contesta con 503 y esta frase.
 */
export class CuentasNoGuardadas extends CuentasNoDisponibles {}

/** El disco de este servicio sobrevive a un redespliegue (lo declara PERFIL_DISCO_DURABLE, como el perfil). */
const discoDurable = () => process.env.PERFIL_DISCO_DURABLE === '1' || process.env.PERFIL_DISCO_DURABLE === 'true';

async function leerCuentas(quien: string): Promise<{ cuentas: CuentaCorreo[]; leidas: boolean }> {
  const q = normal(quien);
  if (!q) return { cuentas: [], leidas: true };
  const enCache = cache.get(q);
  if (enCache) return { cuentas: enCache, leidas: true };
  let cuentas = deDisco(q);
  if (!cuentas && s3Listo()) {
    const r = await s3GetJson(claveS3(q)).catch(() => null);
    if (r?.ok && Array.isArray(r.json?.cuentas)) {
      cuentas = r.json.cuentas;
      aDisco(q, cuentas!);
    } else if (!r?.ok) {
      // Ni el 404 de «no tiene cuentas»: un fallo. No se guarda en la caché, para volver a preguntar.
      return { cuentas: [], leidas: false };
    }
  }
  cache.set(q, cuentas ?? []);
  return { cuentas: cuentas ?? [], leidas: true };
}

/**
 * Las cuentas, como siempre: una lectura fallida se ve como lista vacía (nunca lanza; la usan el cerebro y
 * rutas que no esperan un error). Para decir la verdad («no pude leerlas» ≠ «no tiene»), `leerCuentasSeguro`.
 */
export async function cuentasDe(quien: string): Promise<CuentaCorreo[]> {
  return (await leerCuentas(quien)).cuentas;
}

/**
 * Las cuentas distinguiendo «no tiene ninguna» (`{ ok: true, cuentas: [] }`) de «S3 no dejó leerlas»
 * (`{ ok: false }`; auditoría del 3-oct, COM02). Nunca lanza.
 */
export async function leerCuentasSeguro(quien: string): Promise<{ ok: true; cuentas: CuentaCorreo[] } | { ok: false }> {
  const r = await leerCuentas(quien);
  return r.leidas ? { ok: true, cuentas: r.cuentas } : { ok: false };
}

/** Para cambiar la lista: si S3 no se pudo leer, se para aquí (guardar pisaría sus otras cuentas). */
async function cuentasParaCambiar(quien: string): Promise<CuentaCorreo[]> {
  const r = await leerCuentas(quien);
  if (!r.leidas) throw new CuentasNoDisponibles('No pude leer tus cuentas guardadas en este momento; no cambié nada. Prueba otra vez en un rato.');
  return r.cuentas;
}

/**
 * Guarda la lista y devuelve si quedó DURABLE (S3 confirmó, o sin S3 un disco declarado persistente).
 *
 * Con S3, primero S3: si no confirma y `soloSiDurable`, no se toca nada (ni memoria ni disco) y se lanza
 * CuentasNoGuardadas. Antes se anotaba en memoria y en disco y solo se avisaba en el log: la app veía la
 * cuenta «guardada» y un reinicio la perdía (o la sacaba del disco de este contenedor sin estar en S3).
 * Sin `soloSiDurable` (el token renovado de Microsoft: más vale tenerlo en memoria que perderlo), queda
 * en memoria y en disco con `durable: false`.
 */
async function guardar(quien: string, cuentas: CuentaCorreo[], o: { soloSiDurable: boolean }): Promise<{ durable: boolean }> {
  const q = normal(quien);
  if (s3Listo()) {
    const r = await s3PutJson(claveS3(q), { cuentas }).catch((e) => ({ ok: false, detalle: String(e?.message || e) }));
    if (!r.ok) {
      console.warn('[correo] no pude guardar en S3:', String(r.detalle).slice(0, 120));
      if (o.soloSiDurable) throw new CuentasNoGuardadas('No pude guardar tu cuenta de forma segura en este momento; no cambié nada. Prueba otra vez en un rato.');
      cache.set(q, cuentas);
      aDisco(q, cuentas);
      return { durable: false };
    }
    cache.set(q, cuentas);
    aDisco(q, cuentas);
    return { durable: true };
  }
  cache.set(q, cuentas);
  const enDisco = aDisco(q, cuentas);
  return { durable: enDisco && discoDurable() };
}

/**
 * Agrega (o reemplaza, si ya estaba esa dirección) una cuenta ya probada, con su recibo: `durable` dice si
 * quedó guardada de verdad. Lanza CuentasNoDisponibles si no se pudo leer lo guardado y CuentasNoGuardadas
 * si S3 no confirmó la escritura (en los dos casos no cambió nada).
 */
export async function agregarCuentaConRecibo(
  quien: string,
  correo: string,
  proveedor: CuentaCorreo['proveedor'],
  secretoEnClaro: string
): Promise<{ cuenta: CuentaCorreo; durable: boolean }> {
  const cuentas = await cuentasParaCambiar(quien);
  const c: CuentaCorreo = {
    id: crypto.randomBytes(6).toString('hex'),
    correo: correo.trim().toLowerCase(),
    proveedor,
    secreto: cifrar(secretoEnClaro),
    agregada: Date.now(),
  };
  const { durable } = await guardar(quien, [...cuentas.filter((x) => x.correo !== c.correo), c], { soloSiDurable: true });
  return { cuenta: c, durable };
}

/** Lo de siempre (la usa la ruta): la cuenta, o lanza sin haber cambiado nada (ver agregarCuentaConRecibo). */
export async function agregarCuenta(quien: string, correo: string, proveedor: CuentaCorreo['proveedor'], secretoEnClaro: string): Promise<CuentaCorreo> {
  return (await agregarCuentaConRecibo(quien, correo, proveedor, secretoEnClaro)).cuenta;
}

/** Quita una cuenta. false si no estaba; lanza (sin quitarla) si no se pudo leer o S3 no confirmó. */
export async function quitarCuenta(quien: string, id: string): Promise<boolean> {
  const cuentas = await cuentasParaCambiar(quien);
  const quedan = cuentas.filter((c) => c.id !== id);
  if (quedan.length === cuentas.length) return false;
  await guardar(quien, quedan, { soloSiDurable: true });
  return true;
}

/** Cambia el secreto guardado (Microsoft renueva el token de renovación). Devuelve si quedó durable. */
export async function actualizarSecreto(quien: string, id: string, secretoEnClaro: string): Promise<{ durable: boolean }> {
  const cuentas = await cuentasParaCambiar(quien);
  return guardar(
    quien,
    cuentas.map((c) => (c.id === id ? { ...c, secreto: cifrar(secretoEnClaro) } : c)),
    { soloSiDurable: false }
  );
}

/** Pruebas: olvidar la caché. */
export function _olvidarCuentas() {
  cache.clear();
}
