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

function aDisco(quien: string, cuentas: CuentaCorreo[]) {
  try {
    fs.mkdirSync(carpeta(), { recursive: true });
    fs.writeFileSync(path.join(carpeta(), `${huella(quien)}.json`), JSON.stringify({ cuentas }), { mode: 0o600 });
  } catch {
    /* disco de solo lectura: queda S3 */
  }
}

export async function cuentasDe(quien: string): Promise<CuentaCorreo[]> {
  const q = normal(quien);
  if (!q) return [];
  const enCache = cache.get(q);
  if (enCache) return enCache;
  let cuentas = deDisco(q);
  if (!cuentas && s3Listo()) {
    const r = await s3GetJson(claveS3(q)).catch(() => null);
    if (r?.ok && Array.isArray(r.json?.cuentas)) {
      cuentas = r.json.cuentas;
      aDisco(q, cuentas!);
    }
  }
  cache.set(q, cuentas ?? []);
  return cuentas ?? [];
}

async function guardar(quien: string, cuentas: CuentaCorreo[]) {
  const q = normal(quien);
  cache.set(q, cuentas);
  aDisco(q, cuentas);
  if (s3Listo()) {
    const r = await s3PutJson(claveS3(q), { cuentas });
    if (!r.ok) console.warn('[correo] no pude guardar en S3:', r.detalle.slice(0, 120));
  }
}

/** Agrega (o reemplaza, si ya estaba esa dirección) una cuenta ya probada. */
export async function agregarCuenta(quien: string, correo: string, proveedor: CuentaCorreo['proveedor'], secretoEnClaro: string): Promise<CuentaCorreo> {
  const cuentas = await cuentasDe(quien);
  const c: CuentaCorreo = {
    id: crypto.randomBytes(6).toString('hex'),
    correo: correo.trim().toLowerCase(),
    proveedor,
    secreto: cifrar(secretoEnClaro),
    agregada: Date.now(),
  };
  await guardar(quien, [...cuentas.filter((x) => x.correo !== c.correo), c]);
  return c;
}

export async function quitarCuenta(quien: string, id: string): Promise<boolean> {
  const cuentas = await cuentasDe(quien);
  const quedan = cuentas.filter((c) => c.id !== id);
  if (quedan.length === cuentas.length) return false;
  await guardar(quien, quedan);
  return true;
}

/** Cambia el secreto guardado (Microsoft renueva el token de renovación). */
export async function actualizarSecreto(quien: string, id: string, secretoEnClaro: string) {
  const cuentas = await cuentasDe(quien);
  await guardar(
    quien,
    cuentas.map((c) => (c.id === id ? { ...c, secreto: cifrar(secretoEnClaro) } : c))
  );
}

/** Pruebas: olvidar la caché. */
export function _olvidarCuentas() {
  cache.clear();
}
