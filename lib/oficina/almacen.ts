/**
 * ARCHIVOS DE OFICINA: DÓNDE QUEDAN Y QUIÉN LOS PUEDE BAJAR (FILE-02: «descargas autenticadas, nombre saneado, tamaño
 * acotado, tipo real, retención definida y cero archivos de otro dueño»).
 *
 * Dos cosas separadas:
 *  · los BYTES, en un almacén de archivos: el cubo de la memoria (S3, `ultron/documentos/`) si está configurado; si no,
 *    el disco (`ULTRON_DOCUMENTOS_DIR` o `data/documentos/`); en pruebas, memoria. Se escriben primero como TEMPORAL
 *    (invisible), se releen y validan, y solo entonces se confirman con un `rename` atómico (o un PUT): nunca queda a la
 *    vista un archivo a medias;
 *  · la FICHA (manifiesto) de cada archivo, en lo durable (lib/durable.ts) bajo la huella de su dueño: nombre, tipo,
 *    tamaño, sha256, cuándo vence y qué se validó. La clave lleva la huella del dueño: con la sesión de otro, la ficha
 *    simplemente no existe (404, igual que un id inventado). La descarga compara el sha256 de los bytes con el de la
 *    ficha antes de servirlos.
 *
 * Retención: `AURA_DOCUMENTOS_DIAS` (7 por defecto). Vencido, la descarga contesta 410 y borra los bytes que pueda;
 * en S3 conviene además una regla de ciclo de vida sobre `ultron/documentos/` (los objetos no se borran desde aquí).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { almacenDurable, claveDe, crearUnaVez, huellaDueno, type AlmacenDurable } from '../durable';
import { s3GetBytes, s3Listo, s3PutBytes } from '../s3';
import { MIME, TOPES, type TipoArchivo } from './spec';
import { sha256 } from './validar';

/* ------------------------------------------------------------------ bytes */

export interface AlmacenArchivos {
  readonly tipo: 'disco' | 'memoria' | 's3';
  /** Escribe los bytes como temporal (no se ve ni se puede bajar). Devuelve su ficha de temporal. */
  escribirTemporal(datos: Buffer): Promise<string>;
  leerTemporal(token: string): Promise<Buffer | null>;
  descartarTemporal(token: string): Promise<void>;
  /** Lo hace visible como `clave`, de una vez (rename atómico / PUT). */
  confirmar(token: string, clave: string, mime: string): Promise<void>;
  leer(clave: string): Promise<Buffer | null>;
  borrar(clave: string): Promise<void>;
  /** Dónde está el temporal en el disco (para las pruebas que lo dañan a propósito). */
  rutaTemporal?(token: string): string | null;
}

/** `huella/id`: la huella del dueño (40 hex) y el id del archivo. Nada más entra en una ruta o una clave de S3. */
const RE_CLAVE = /^[0-9a-f]{40}\/d_[0-9a-f]{24}$/;
const validarClave = (clave: string) => {
  if (!RE_CLAVE.test(clave)) throw new Error('clave de archivo inválida');
  return clave;
};
const RE_TOKEN = /^[0-9a-f]{32}$/;
const nuevoToken = () => crypto.randomBytes(16).toString('hex');

/** Los temporales en disco (también los de S3 antes de subir): una carpeta propia, nombres al azar. */
function temporalesEnDisco(dir: () => string) {
  const ruta = (t: string) => {
    if (!RE_TOKEN.test(t)) throw new Error('temporal inválido');
    return path.join(dir(), `${t}.part`);
  };
  return {
    async escribirTemporal(datos: Buffer) {
      const t = nuevoToken();
      fs.mkdirSync(dir(), { recursive: true });
      fs.writeFileSync(ruta(t), datos, { mode: 0o600 });
      return t;
    },
    async leerTemporal(t: string) {
      try {
        return fs.readFileSync(ruta(t));
      } catch {
        return null;
      }
    },
    async descartarTemporal(t: string) {
      fs.rmSync(ruta(t), { force: true });
    },
    rutaTemporal: (t: string) => ruta(t),
  };
}

export function almacenArchivosDisco(dir?: string): AlmacenArchivos {
  const base = () => dir || process.env.ULTRON_DOCUMENTOS_DIR || path.join(process.cwd(), 'data', 'documentos');
  const final = (clave: string) => path.join(base(), `${validarClave(clave)}.bin`);
  const tmp = temporalesEnDisco(() => path.join(base(), '.tmp'));
  return {
    tipo: 'disco',
    ...tmp,
    async confirmar(token, clave) {
      const f = final(clave);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.renameSync(tmp.rutaTemporal(token), f);
    },
    async leer(clave) {
      try {
        return fs.readFileSync(final(clave));
      } catch (e: any) {
        if (e?.code === 'ENOENT') return null;
        throw e;
      }
    },
    async borrar(clave) {
      fs.rmSync(final(clave), { force: true });
    },
  };
}

export function almacenArchivosMemoria(): AlmacenArchivos & { objetos: Map<string, Buffer>; temporales: Map<string, Buffer> } {
  const objetos = new Map<string, Buffer>();
  const temporales = new Map<string, Buffer>();
  return {
    tipo: 'memoria',
    objetos,
    temporales,
    async escribirTemporal(datos) {
      const t = nuevoToken();
      temporales.set(t, Buffer.from(datos));
      return t;
    },
    async leerTemporal(t) {
      return temporales.get(t) ?? null;
    },
    async descartarTemporal(t) {
      temporales.delete(t);
    },
    async confirmar(t, clave) {
      const b = temporales.get(t);
      if (!b) throw new Error('el temporal ya no está');
      objetos.set(validarClave(clave), b);
      temporales.delete(t);
    },
    async leer(clave) {
      return objetos.get(validarClave(clave)) ?? null;
    },
    async borrar(clave) {
      objetos.delete(validarClave(clave));
    },
  };
}

/** S3 (el cubo de la memoria). El temporal vive en el disco de la réplica; confirmar = subir y releer. */
export function almacenArchivosS3(prefijo = 'ultron/documentos'): AlmacenArchivos {
  const tmp = temporalesEnDisco(() => path.join(os.tmpdir(), 'aura-documentos'));
  const k = (clave: string) => `${prefijo}/${validarClave(clave)}.bin`;
  return {
    tipo: 's3',
    ...tmp,
    async confirmar(token, clave, mime) {
      const b = await tmp.leerTemporal(token);
      if (!b) throw new Error('el temporal ya no está');
      const r = await s3PutBytes(k(clave), b, mime);
      if (!r.ok) throw new Error(`no pude guardarlo en S3 (${r.detalle.slice(0, 80)})`);
      await tmp.descartarTemporal(token);
    },
    async leer(clave) {
      const r = await s3GetBytes(k(clave));
      if (!r.ok) throw new Error(`no pude leerlo de S3 (${r.detalle.slice(0, 80)})`);
      return r.datos;
    },
    async borrar() {
      /* S3: lo borra la regla de ciclo de vida del cubo (la ficha vencida ya no deja bajarlo). */
    },
  };
}

let forzado: AlmacenArchivos | null = null;
let memoriaPruebas: AlmacenArchivos | null = null;
let unico: AlmacenArchivos | null = null;

/** El almacén de archivos de este proceso: memoria en pruebas, S3 si está, si no el disco. */
export function almacenArchivos(): AlmacenArchivos {
  if (forzado) return forzado;
  if (process.env.NODE_TEST_CONTEXT && !s3Listo()) return (memoriaPruebas ||= almacenArchivosMemoria());
  return (unico ||= s3Listo() ? almacenArchivosS3() : almacenArchivosDisco());
}

/** Solo pruebas. */
export function _usarAlmacenArchivos(a: AlmacenArchivos | null) {
  forzado = a;
}

/* ------------------------------------------------------------------ fichas */

export const ESPACIO_ARCHIVOS = 'documentos/archivos';
export const ESPACIO_LOTES = 'documentos/lotes';

export function retencionMs(env: NodeJS.ProcessEnv = process.env): number {
  const d = Number(env.AURA_DOCUMENTOS_DIAS);
  return (Number.isFinite(d) && d > 0 ? Math.min(d, 365) : 7) * 86_400_000;
}

export type ManifiestoArchivo = {
  v: 1;
  id: string;
  /** Huella del dueño (nunca el correo). */
  dueno: string;
  nombre: string;
  tipo: TipoArchivo;
  mime: string;
  bytes: number;
  sha256: string;
  creado: number;
  vence: number;
  /** El pedido (lote) del que salió. */
  lote: string;
  validacion: { estructural: boolean; semantico: boolean; render?: 'hecho' | 'omitido' | 'fallido' };
};

/** El id de un archivo: el mismo para el mismo dueño, pedido y nombre (un reintento nunca crea otro). */
export function idArchivo(dueno: string, requestId: string, nombre: string): string {
  return `d_${crypto.createHash('sha256').update(`${huellaDueno(dueno)}|${requestId}|${nombre.toLowerCase()}`).digest('hex').slice(0, 24)}`;
}
export const claveArchivo = (dueno: string, id: string) => `${huellaDueno(dueno)}/${id}`;
export const claveManifiesto = (dueno: string, id: string) => claveDe(ESPACIO_ARCHIVOS, dueno, id);

/**
 * Pone el archivo a disposición: su ficha se crea UNA vez (atómico entre réplicas con S3). Si ya existía con la misma
 * huella, es el mismo archivo (`nueva: false`): un reintento o una reanudación nunca duplican la entrega. Con otra
 * huella es un conflicto (no se pisa lo que ya se entregó).
 */
export async function publicarManifiesto(m: ManifiestoArchivo, dueno: string, a: AlmacenDurable = almacenDurable()): Promise<{ ok: true; nueva: boolean; m: ManifiestoArchivo } | { ok: false; detalle: string }> {
  const r = await crearUnaVez(claveManifiesto(dueno, m.id), m, a);
  if (r.ok === false) return { ok: false, detalle: r.detalle };
  if (!r.creado && r.valor.sha256 !== m.sha256) return { ok: false, detalle: 'ya hay otro archivo entregado con ese id' };
  return { ok: true, nueva: r.creado, m: r.valor };
}

export type Descarga =
  | { estado: 'ok'; m: ManifiestoArchivo; datos: Buffer }
  | { estado: 'no' }
  | { estado: 'vencido'; m: ManifiestoArchivo }
  | { estado: 'danado'; m: ManifiestoArchivo }
  | { estado: 'almacen'; detalle: string };

const RE_ID = /^d_[0-9a-f]{24}$/;

/**
 * Lo que necesita la ruta de descarga: la ficha del DUEÑO de la sesión (otra cuenta → no existe), que no esté vencida,
 * y los bytes con la misma huella que la ficha (si no, «dañado»: nunca se sirve otra cosa).
 */
export async function abrirDescarga(dueno: string, id: string, o: { ahora?: number; almacen?: AlmacenDurable; archivos?: AlmacenArchivos } = {}): Promise<Descarga> {
  if (!dueno || !RE_ID.test(String(id || ''))) return { estado: 'no' };
  const a = o.almacen || almacenDurable();
  const l = await a.leer<ManifiestoArchivo>(claveManifiesto(dueno, id));
  if (l.ok === false) return { estado: 'almacen', detalle: l.detalle };
  const m = l.valor;
  if (!m || m.dueno !== huellaDueno(dueno) || m.id !== id) return { estado: 'no' };
  const arch = o.archivos || almacenArchivos();
  if ((o.ahora ?? Date.now()) > m.vence) {
    await arch.borrar(claveArchivo(dueno, id)).catch(() => undefined);
    return { estado: 'vencido', m };
  }
  let datos: Buffer | null;
  try {
    datos = await arch.leer(claveArchivo(dueno, id));
  } catch (e: any) {
    return { estado: 'almacen', detalle: String(e?.message || e).slice(0, 120) };
  }
  if (!datos || datos.length !== m.bytes || datos.length > TOPES.bytes || sha256(datos) !== m.sha256) return { estado: 'danado', m };
  return { estado: 'ok', m, datos };
}

/**
 * `Content-Disposition` seguro: el nombre ya viene saneado (spec.nombreSeguro); aquí además una versión ASCII entre
 * comillas (sin comillas ni barras) y la UTF-8 de RFC 5987 para «cotización.xlsx».
 */
export function disposicionDescarga(nombre: string): string {
  const ascii = nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`;
}

/** El MIME real de un tipo (nunca el que diga el cliente). */
export const mimeDe = (t: TipoArchivo) => MIME[t];
