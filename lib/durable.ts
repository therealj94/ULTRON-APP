/**
 * LO DURABLE DE AURA (AUR06): «crear una vez», compare-and-set, leases con fencing y el registro de
 * operaciones, sin base de datos nueva.
 *
 * Por qué: el turno único (server/turno-unico.ts) y las tareas de la computadora deduplicaban en un Map del
 * proceso. Un reinicio o una segunda réplica no lo veían y el mismo pedido podía correr dos veces (y con él
 * un envío o un clic). Aquí vive lo mínimo para que eso no pase, sobre lo que el proyecto ya usa:
 *
 *  · S3 (el cubo de la memoria, `ULTRON_MEMORIA_BUCKET`, bajo `ultron/durable/`) con escrituras
 *    CONDICIONALES: `If-None-Match: *` crea solo si no existe (412 si ya está) e `If-Match: <ETag>` escribe
 *    solo si nadie cambió el objeto desde que se leyó. S3 es fuertemente consistente al leer después de
 *    escribir: dos réplicas que «crean» la misma clave a la vez, una gana y la otra recibe conflicto.
 *  · Sin S3 configurado (desarrollo, pruebas): el disco local (`ULTRON_DURABLE_DIR` o `data/durable/`). Crear
 *    es atómico (se escribe aparte y se enlaza con `link`, que falla si ya existe) y el CAS es atómico dentro
 *    del proceso (todo síncrono). Sobrevive a un reinicio del proceso, pero NO coordina réplicas ni
 *    contenedores distintos: se avisa una vez en el log.
 *
 * Reglas (sección 8 del documento maestro):
 *  · Las claves son por DUEÑO (un sha256 del correo o de quien habla según el servidor, nunca del cuerpo) +
 *    el id de la petición lógica (`requestId`, `idTurno`). Nunca se deduplica por texto ni entre personas.
 *  · Persistir antes de actuar: la operación queda `requested` y luego `dispatched` ANTES de tocar afuera.
 *  · Un lease tiene vencimiento y un token de fencing que solo sube. Solo el token vigente inicia efectos.
 *  · Terminales monotónicos: `succeeded` y `failed` no cambian; `unknown` solo sale por reconciliación.
 *  · Un fallo del almacén no es «no existe»: se devuelve `ok: false` y quien llama decide (no se inventa).
 *  · Nada aquí guarda contraseñas, tokens ni textos privados: solo estados, ids, hashes y recibos.
 *
 * Limpieza: los objetos no se borran desde aquí (son pequeños). En el cubo conviene una regla de ciclo de
 * vida sobre el prefijo `ultron/durable/` (p. ej. expirar a los 30 días).
 *
 * CÓMO ENGANCHAR LA COMPUTADORA (server/computadora.ts / nodo; se integra aparte):
 *   1. Crear la tarea una sola vez por dueño + request_id (perder la respuesta, reiniciar u otra réplica
 *      devuelven la MISMA tarea):
 *        const r = await reservarPedido({ espacio: 'computadora/pedidos', dueno: correo, requestId, propuesto: idNuevo });
 *        if (r.ok === false) → 503 honesto o el dedupe en RAM de hoy con aviso; nunca crear a ciegas.
 *        if (!r.nuevo) → devolver la tarea r.id (no se crea otra).
 *   2. Quien la corre toma su lease y lo renueva mientras trabaja:
 *        const l = await tomarLease(claveDe('computadora/leases', correo, taskId), PROCESO_DURABLE, 60_000);
 *        if (l.ok === false) → la corre otro (o el almacén no contestó): no se corre.
 *        cada ~20 s: renovarLease(l.lease, 60_000); si `perdido`, se para sin más efectos.
 *   3. Cada efecto (enviar un formulario, publicar, un clic sensible) pasa por el registro de operaciones:
 *        await ejecutarUnaVez({ dueno: correo, requestId: `${taskId}:${pasoId}`, tipo: 'computadora.accion',
 *                               argsHash, lease: l.lease }, () => hacerElClic());
 *      Si ya existía, no se repite (se devuelve su estado). Si el efecto lanza o el proceso muere tras el
 *      despacho, queda `unknown`: se reconcilia mirando la pantalla o el recibo, nunca se reenvía a ciegas.
 *   4. El token del lease (l.lease.token) viaja al nodo como fencing: el nodo rechaza órdenes con un token
 *      menor que el último que vio (un worker viejo que despierta tarde no hace nada).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { s3GetJsonConEtag, s3Listo, s3PutJsonCondicional } from './s3';

/* ------------------------------------------------------------------ el almacén */

export type Leido<T> = { ok: true; valor: T; etag: string } | { ok: true; valor: null; etag: null } | { ok: false; detalle: string };
export type Escrito = { ok: true; etag: string } | { ok: false; conflicto: true; detalle?: string } | { ok: false; conflicto: false; detalle: string };

export interface AlmacenDurable {
  readonly tipo: 's3' | 'disco' | 'memoria';
  /** ¿Coordina procesos en máquinas distintas? Solo S3. */
  readonly multiReplica: boolean;
  leer<T = unknown>(clave: string): Promise<Leido<T>>;
  /** Crea solo si no existe. `conflicto` si ya estaba. */
  crear(clave: string, valor: unknown): Promise<Escrito>;
  /** Escribe solo si el ETag sigue siendo ese. `conflicto` si cambió (o ya no existe). */
  cas(clave: string, valor: unknown, etag: string): Promise<Escrito>;
}

/** Una clave: segmentos cortos y limpios, sin «..» (va a S3 y al disco). */
const RE_CLAVE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}(\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}){0,8}$/;
function validar(clave: string): string {
  if (!RE_CLAVE.test(clave) || clave.includes('..')) throw new Error(`clave durable inválida: ${String(clave).slice(0, 80)}`);
  return clave;
}

const PREFIJO_S3 = 'ultron/durable';
/** Lo durable no espera tanto como la memoria: está en el camino de cada turno. */
const TOPE_S3_MS = 5000;

/** S3 con escrituras condicionales (lib/s3.ts). */
export function almacenS3(prefijo = PREFIJO_S3, timeoutMs = TOPE_S3_MS): AlmacenDurable {
  const k = (clave: string) => `${prefijo}/${validar(clave)}.json`;
  return {
    tipo: 's3',
    multiReplica: true,
    async leer<T>(clave: string): Promise<Leido<T>> {
      const r = await s3GetJsonConEtag(k(clave), timeoutMs).catch((e) => ({ ok: false, json: null, etag: null, detalle: String(e?.message || e), missing: false }));
      if (r.ok && r.missing) return { ok: true, valor: null, etag: null };
      if (r.ok === false) return { ok: false, detalle: r.detalle };
      // Sin ETag no hay compare-and-set posible: mejor no saber que creer que se sabe.
      if (!r.etag || r.json === null) return { ok: false, detalle: 'S3 contestó sin ETag o sin contenido' };
      return { ok: true, valor: r.json as T, etag: r.etag };
    },
    async crear(clave: string, valor: unknown): Promise<Escrito> {
      const r = await s3PutJsonCondicional(k(clave), valor, { siNoExiste: true }, timeoutMs).catch((e) => ({ ok: false, etag: null, conflicto: false, status: 0, detalle: String(e?.message || e) }));
      if (r.ok === true) return { ok: true, etag: r.etag || '' };
      return r.conflicto ? { ok: false, conflicto: true, detalle: r.detalle } : { ok: false, conflicto: false, detalle: r.detalle };
    },
    async cas(clave: string, valor: unknown, etag: string): Promise<Escrito> {
      if (!etag) return { ok: false, conflicto: true, detalle: 'sin ETag' };
      const r = await s3PutJsonCondicional(k(clave), valor, { siCoincide: etag }, timeoutMs).catch((e) => ({ ok: false, etag: null, conflicto: false, status: 0, detalle: String(e?.message || e) }));
      if (r.ok === true) return { ok: true, etag: r.etag || '' };
      return r.conflicto ? { ok: false, conflicto: true, detalle: r.detalle } : { ok: false, conflicto: false, detalle: r.detalle };
    },
  };
}

const etagDe = (texto: string) => `"${crypto.createHash('sha256').update(texto).digest('hex').slice(0, 32)}"`;

/**
 * El disco local. Crear es atómico (archivo aparte + `link`, que falla si ya existe); el CAS es atómico en el
 * proceso (lectura, comparación y `rename` síncronos, sin `await` en medio). No coordina réplicas.
 */
export function almacenDisco(dir?: string): AlmacenDurable {
  const carpeta = () => dir || process.env.ULTRON_DURABLE_DIR || path.join(process.cwd(), 'data', 'durable');
  const archivo = (clave: string) => path.join(carpeta(), `${validar(clave)}.json`);
  const temporal = (f: string) => `${f}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const leerSync = (f: string): { texto: string } | null => {
    try {
      return { texto: fs.readFileSync(f, 'utf8') };
    } catch (e: any) {
      if (e?.code === 'ENOENT') return null;
      throw e;
    }
  };
  return {
    tipo: 'disco',
    multiReplica: false,
    async leer<T>(clave: string): Promise<Leido<T>> {
      try {
        const r = leerSync(archivo(clave));
        if (!r) return { ok: true, valor: null, etag: null };
        return { ok: true, valor: JSON.parse(r.texto) as T, etag: etagDe(r.texto) };
      } catch (e: any) {
        return { ok: false, detalle: String(e?.message || e).slice(0, 160) };
      }
    },
    async crear(clave: string, valor: unknown): Promise<Escrito> {
      const f = archivo(clave);
      const texto = JSON.stringify(valor);
      let tmp = '';
      try {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        tmp = temporal(f);
        fs.writeFileSync(tmp, texto);
        fs.linkSync(tmp, f);
        return { ok: true, etag: etagDe(texto) };
      } catch (e: any) {
        if (e?.code === 'EEXIST') return { ok: false, conflicto: true };
        return { ok: false, conflicto: false, detalle: String(e?.message || e).slice(0, 160) };
      } finally {
        if (tmp) fs.rmSync(tmp, { force: true });
      }
    },
    async cas(clave: string, valor: unknown, etag: string): Promise<Escrito> {
      const f = archivo(clave);
      try {
        const r = leerSync(f);
        if (!r || etagDe(r.texto) !== etag) return { ok: false, conflicto: true };
        const texto = JSON.stringify(valor);
        const tmp = temporal(f);
        fs.writeFileSync(tmp, texto);
        fs.renameSync(tmp, f);
        return { ok: true, etag: etagDe(texto) };
      } catch (e: any) {
        return { ok: false, conflicto: false, detalle: String(e?.message || e).slice(0, 160) };
      }
    },
  };
}

/** En memoria: el doble determinista para pruebas de quien use este módulo (no es durable). */
export function almacenEnMemoria(): AlmacenDurable & { objetos: Map<string, string> } {
  const objetos = new Map<string, string>();
  return {
    tipo: 'memoria',
    multiReplica: false,
    objetos,
    async leer<T>(clave: string): Promise<Leido<T>> {
      const t = objetos.get(validar(clave));
      return t === undefined ? { ok: true, valor: null, etag: null } : { ok: true, valor: JSON.parse(t) as T, etag: etagDe(t) };
    },
    async crear(clave: string, valor: unknown): Promise<Escrito> {
      if (objetos.has(validar(clave))) return { ok: false, conflicto: true };
      const t = JSON.stringify(valor);
      objetos.set(clave, t);
      return { ok: true, etag: etagDe(t) };
    },
    async cas(clave: string, valor: unknown, etag: string): Promise<Escrito> {
      const actual = objetos.get(validar(clave));
      if (actual === undefined || etagDe(actual) !== etag) return { ok: false, conflicto: true };
      const t = JSON.stringify(valor);
      objetos.set(clave, t);
      return { ok: true, etag: etagDe(t) };
    },
  };
}

let forzado: AlmacenDurable | null = null;
let s3Unico: AlmacenDurable | null = null;
let discoUnico: AlmacenDurable | null = null;
let avisado = false;

/**
 * El almacén de este proceso: S3 si está configurado; si no, el disco (con un aviso: no es multi-réplica).
 * Se decide en cada llamada (las pruebas cambian el entorno).
 */
export function almacenDurable(): AlmacenDurable {
  if (forzado) return forzado;
  if (s3Listo()) return (s3Unico ||= almacenS3());
  if (!avisado && process.env.NODE_ENV === 'production') {
    avisado = true;
    console.warn('[durable] sin S3 configurado: lo durable va al disco local. Sobrevive un reinicio, pero NO coordina varias réplicas.');
  }
  return (discoUnico ||= almacenDisco());
}

/** Solo pruebas: fija un almacén (`null` vuelve al de siempre). */
export function _usarAlmacenDurable(a: AlmacenDurable | null) {
  forzado = a;
}

/** Quién es este proceso (para leases y registros). Cambia en cada arranque. */
export const PROCESO_DURABLE = `p_${process.pid}_${crypto.randomBytes(5).toString('hex')}`;

/* ------------------------------------------------------------------ claves por dueño */

/** El dueño en una clave: un sha256 de quién (correo o identidad del servidor), en minúsculas. Un listado no enseña correos. */
export function huellaDueno(dueno: string): string {
  const d = String(dueno || '').trim().toLowerCase();
  if (!d) throw new Error('lo durable siempre tiene dueño');
  return crypto.createHash('sha256').update(`aura-durable:${d}`).digest('hex').slice(0, 40);
}

/** Un id de petición en una clave: tal cual si es limpio; si no, su hash (nunca el texto suelto). */
export function idSeguro(id: string): string {
  const s = String(id ?? '');
  if (!s) throw new Error('lo durable siempre tiene id de petición');
  // Sin traducir caracteres (`a:b` y `a.b` serían la misma clave): lo que no es limpio va hasheado entero.
  return /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,95}$/.test(s) && !s.startsWith('h_') ? s : `h_${crypto.createHash('sha256').update(s).digest('hex').slice(0, 40)}`;
}

/** `espacio/huella(dueño)/id`. El espacio es fijo del código («turnos», «computadora/pedidos»). */
export function claveDe(espacio: string, dueno: string, id: string): string {
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+){0,3}$/.test(espacio)) throw new Error(`espacio durable inválido: ${espacio}`);
  return validar(`${espacio}/${huellaDueno(dueno)}/${idSeguro(id)}`);
}

/* ------------------------------------------------------------------ crear una vez, leer, CAS */

export type ResultadoCrear<T> = { ok: true; creado: boolean; valor: T; etag: string } | { ok: false; detalle: string };

/**
 * Crea `clave` con `valor` si no existía (atómico entre réplicas con S3). Si ya existía, devuelve lo que hay
 * (`creado: false`): quien llama ve el original, no el suyo. `ok: false` si el almacén no contestó.
 */
export async function crearUnaVez<T>(clave: string, valor: T, a: AlmacenDurable = almacenDurable()): Promise<ResultadoCrear<T>> {
  for (let i = 0; i < 4; i++) {
    const c = await a.crear(clave, valor);
    if (c.ok === true) return { ok: true, creado: true, valor, etag: c.etag };
    if (c.conflicto === false) return { ok: false, detalle: c.detalle };
    const l = await a.leer<T>(clave);
    if (l.ok === false) return { ok: false, detalle: l.detalle };
    if (l.valor !== null) return { ok: true, creado: false, valor: l.valor, etag: l.etag };
    // 409 de S3 (otra escritura condicional en vuelo) y todavía no se ve nada: otra vuelta.
    await pausa(20 + Math.random() * 40);
  }
  return { ok: false, detalle: 'no pude crear ni leer la clave (conflictos seguidos)' };
}

export async function leerDurable<T>(clave: string, a: AlmacenDurable = almacenDurable()): Promise<Leido<T>> {
  return a.leer<T>(clave);
}

/** Compare-and-set: escribe `valor` solo si el objeto sigue con `etag`. */
export async function compararYGuardar(clave: string, valor: unknown, etag: string, a: AlmacenDurable = almacenDurable()): Promise<Escrito> {
  return a.cas(clave, valor, etag);
}

export type ResultadoModificar<T> = { ok: true; valor: T | null; etag: string | null; cambiado: boolean } | { ok: false; conflicto: boolean; detalle: string };

/**
 * Lee, aplica `f` y escribe con CAS; si otro escribió en medio, vuelve a leer y a aplicar. `f` recibe una
 * copia (o null si no existe) y devuelve el valor nuevo, o `undefined` para no cambiar nada. Si `f` lanza,
 * no se escribe nada y el error sube.
 */
export async function modificarDurable<T>(clave: string, f: (actual: T | null) => T | undefined, a: AlmacenDurable = almacenDurable(), intentos = 6): Promise<ResultadoModificar<T>> {
  for (let i = 0; i < intentos; i++) {
    const l = await a.leer<T>(clave);
    if (l.ok === false) return { ok: false, conflicto: false, detalle: l.detalle };
    const copia = l.valor === null ? null : (JSON.parse(JSON.stringify(l.valor)) as T);
    const nuevo = f(copia);
    if (nuevo === undefined) return { ok: true, valor: l.valor, etag: l.etag, cambiado: false };
    const w = l.etag === null ? await a.crear(clave, nuevo) : await a.cas(clave, nuevo, l.etag);
    if (w.ok === true) return { ok: true, valor: nuevo, etag: w.etag, cambiado: true };
    if (w.conflicto === false) return { ok: false, conflicto: false, detalle: w.detalle };
    await pausa(10 + Math.random() * 30 * (i + 1));
  }
  return { ok: false, conflicto: true, detalle: 'conflictos seguidos al modificar' };
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ leases con fencing */

export type RegistroLease = { titular: string; token: number; vence: number; t: number };
export type Lease = { clave: string; titular: string; token: number; vence: number; etag: string; almacen: AlmacenDurable };

/**
 * Toma el lease de `clave` para `titular` por `ms`. Libre (no existe o venció): se toma con el token
 * siguiente (el token solo sube: un titular viejo nunca vuelve a tener el vigente). Del mismo titular y
 * vigente: se extiende con el mismo token. De otro y vigente: `ocupado`.
 */
export async function tomarLease(
  clave: string,
  titular: string,
  ms: number,
  o: { almacen?: AlmacenDurable; ahora?: () => number } = {}
): Promise<{ ok: true; lease: Lease } | { ok: false; ocupado: RegistroLease } | { ok: false; detalle: string }> {
  const a = o.almacen || almacenDurable();
  const ahora = o.ahora || Date.now;
  for (let i = 0; i < 5; i++) {
    const l = await a.leer<RegistroLease>(clave);
    if (l.ok === false) return { ok: false, detalle: l.detalle };
    const t = ahora();
    const actual = l.valor;
    if (actual && actual.titular !== titular && actual.vence > t) return { ok: false, ocupado: actual };
    const token = !actual ? 1 : actual.titular === titular && actual.vence > t ? actual.token : actual.token + 1;
    const nuevo: RegistroLease = { titular, token, vence: t + ms, t };
    const w = actual ? await a.cas(clave, nuevo, l.etag!) : await a.crear(clave, nuevo);
    if (w.ok === true) return { ok: true, lease: { clave, titular, token, vence: nuevo.vence, etag: w.etag, almacen: a } };
    if (w.conflicto === false) return { ok: false, detalle: w.detalle };
  }
  return { ok: false, detalle: 'conflictos seguidos al tomar el lease' };
}

/** Lo extiende si sigue siendo suyo (mismo token, no vencido). `perdido`: otro lo tomó o venció. */
export async function renovarLease(lease: Lease, ms: number, ahora: () => number = Date.now): Promise<{ ok: true; lease: Lease } | { ok: false; perdido: true } | { ok: false; perdido: false; detalle: string }> {
  const l = await lease.almacen.leer<RegistroLease>(lease.clave);
  if (l.ok === false) return { ok: false, perdido: false, detalle: l.detalle };
  const t = ahora();
  if (!l.valor || l.valor.titular !== lease.titular || l.valor.token !== lease.token || l.valor.vence <= t) return { ok: false, perdido: true };
  const nuevo: RegistroLease = { ...l.valor, vence: t + ms };
  const w = await lease.almacen.cas(lease.clave, nuevo, l.etag!);
  if (w.ok === true) return { ok: true, lease: { ...lease, vence: nuevo.vence, etag: w.etag } };
  return w.conflicto ? { ok: false, perdido: true } : { ok: false, perdido: false, detalle: w.detalle };
}

/** Lo suelta (vence ya) conservando el token: el próximo titular recibe el siguiente. */
export async function soltarLease(lease: Lease): Promise<boolean> {
  const r = await modificarDurable<RegistroLease>(
    lease.clave,
    (v) => (v && v.titular === lease.titular && v.token === lease.token ? { ...v, vence: 0 } : undefined),
    lease.almacen
  );
  return r.ok && r.cambiado;
}

/**
 * FENCING: ¿este token sigue siendo el vigente? Se mira justo antes de iniciar un efecto. Con S3 hay una
 * ventana entre esta lectura y el efecto; por eso el token también viaja con la operación (y al nodo), que
 * rechaza tokens menores al último visto.
 */
export async function leaseVigente(lease: Pick<Lease, 'clave' | 'titular' | 'token' | 'almacen'>, ahora: () => number = Date.now): Promise<boolean> {
  const l = await lease.almacen.leer<RegistroLease>(lease.clave);
  return !!(l.ok && l.valor && l.valor.titular === lease.titular && l.valor.token === lease.token && l.valor.vence > ahora());
}

/* ------------------------------------------------------------------ registro de operaciones */

export type EstadoOperacion = 'requested' | 'dispatched' | 'succeeded' | 'failed' | 'unknown';
export type ReciboOperacion = {
  /** none: no hubo efecto · confirmed: el proveedor lo confirmó · possible: pudo haberse hecho. */
  efecto: 'none' | 'confirmed' | 'possible';
  proveedor?: string;
  referencia?: string;
  detalle?: string;
  /** AUR13 (lib/envios.ts): aceptado por el proveedor / entregado si consta / fallido / incierto. Opcional. */
  entrega?: 'aceptado' | 'entregado' | 'fallido' | 'incierto';
  observado: number;
};
export type Operacion = {
  v: 1;
  /** huella del dueño (nunca el correo). */
  dueno: string;
  requestId: string;
  tipo: string;
  estado: EstadoOperacion;
  /** Hash de los argumentos canónicos: el mismo requestId con otro contenido no es «el mismo pedido». */
  argsHash?: string;
  /** El token de fencing con que se despachó. */
  fencing?: number;
  creada: number;
  actualizada: number;
  recibo?: ReciboOperacion;
  historia: { estado: EstadoOperacion; t: number }[];
};

/** Qué puede seguir a qué. Los terminales no cambian; `unknown` solo sale reconciliando. */
export const TRANSICIONES: Record<EstadoOperacion, EstadoOperacion[]> = {
  requested: ['dispatched', 'failed'],
  dispatched: ['succeeded', 'failed', 'unknown'],
  unknown: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
};

export function claveOperacion(dueno: string, requestId: string): string {
  return claveDe('operaciones', dueno, requestId);
}

/** Un hash estable de los argumentos (para `argsHash`). */
export function hashArgumentos(x: unknown): string {
  const canon = (v: any): any => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  return crypto.createHash('sha256').update(JSON.stringify(canon(x))).digest('hex').slice(0, 40);
}

export type ResultadoRegistrar = { ok: true; nueva: boolean; op: Operacion } | { ok: false; motivo: 'otro-pedido' | 'almacen'; op?: Operacion; detalle: string };

/**
 * Registra la intención (`requested`) una sola vez por dueño + requestId. Si ya existía con el mismo
 * tipo y argumentos, devuelve la existente (`nueva: false`): un reintento ve el estado, no repite. Con
 * otro tipo o argumentos: `otro-pedido` (un id reutilizado nunca hereda el permiso ni el efecto de otro).
 */
export async function registrarOperacion(o: { dueno: string; requestId: string; tipo: string; argsHash?: string; fencing?: number; almacen?: AlmacenDurable; ahora?: number }): Promise<ResultadoRegistrar> {
  const a = o.almacen || almacenDurable();
  const t = o.ahora ?? Date.now();
  const op: Operacion = {
    v: 1,
    dueno: huellaDueno(o.dueno),
    requestId: String(o.requestId),
    tipo: o.tipo,
    estado: 'requested',
    ...(o.argsHash ? { argsHash: o.argsHash } : {}),
    ...(o.fencing !== undefined ? { fencing: o.fencing } : {}),
    creada: t,
    actualizada: t,
    historia: [{ estado: 'requested', t }],
  };
  const r = await crearUnaVez(claveOperacion(o.dueno, o.requestId), op, a);
  if (r.ok === false) return { ok: false, motivo: 'almacen', detalle: r.detalle };
  if (r.creado) return { ok: true, nueva: true, op };
  if (r.valor.tipo !== op.tipo || (r.valor.argsHash || '') !== (op.argsHash || '')) {
    return { ok: false, motivo: 'otro-pedido', op: r.valor, detalle: 'ese requestId ya es de otra operación' };
  }
  return { ok: true, nueva: false, op: r.valor };
}

export async function leerOperacion(dueno: string, requestId: string, a: AlmacenDurable = almacenDurable()): Promise<Leido<Operacion>> {
  return a.leer<Operacion>(claveOperacion(dueno, requestId));
}

export type ResultadoAvanzar = { ok: true; op: Operacion } | { ok: false; motivo: 'transicion' | 'fencing' | 'no-existe' | 'almacen'; op?: Operacion; detalle: string };

/**
 * Cambia el estado con CAS, respetando TRANSICIONES. Repetir el mismo estado es idempotente (devuelve la
 * operación sin tocarla). Con `lease`, antes se comprueba que su token siga vigente (fencing) y no sea menor
 * que el de la operación.
 */
export async function avanzarOperacion(o: {
  dueno: string;
  requestId: string;
  a: EstadoOperacion;
  recibo?: Omit<ReciboOperacion, 'observado'> & { observado?: number };
  lease?: Lease;
  almacen?: AlmacenDurable;
  ahora?: number;
}): Promise<ResultadoAvanzar> {
  const alm = o.almacen || almacenDurable();
  if (o.lease && !(await leaseVigente(o.lease))) return { ok: false, motivo: 'fencing', detalle: 'el lease ya no es de este titular' };
  let motivo = null as 'transicion' | 'fencing' | 'no-existe' | null;
  let vista = undefined as Operacion | undefined;
  const r = await modificarDurable<Operacion>(
    claveOperacion(o.dueno, o.requestId),
    (op) => {
      motivo = null;
      vista = op || undefined;
      if (!op) return void (motivo = 'no-existe');
      if (op.estado === o.a) return undefined;
      if (!TRANSICIONES[op.estado].includes(o.a)) return void (motivo = 'transicion');
      if (o.lease && op.fencing !== undefined && o.lease.token < op.fencing) return void (motivo = 'fencing');
      const t = o.ahora ?? Date.now();
      return {
        ...op,
        estado: o.a,
        actualizada: t,
        ...(o.a === 'dispatched' && o.lease ? { fencing: o.lease.token } : {}),
        ...(o.recibo ? { recibo: { ...o.recibo, observado: o.recibo.observado ?? t } } : {}),
        historia: [...op.historia, { estado: o.a, t }].slice(-20),
      };
    },
    alm
  );
  if (r.ok === false) return { ok: false, motivo: 'almacen', detalle: r.detalle };
  if (motivo) return { ok: false, motivo, op: vista, detalle: motivo === 'transicion' ? `de ${vista?.estado} no se pasa a ${o.a}` : String(motivo) };
  return { ok: true, op: (r.valor || vista)! };
}

export type SalidaEfecto<R> = { estado: 'succeeded' | 'failed' | 'unknown'; recibo?: Omit<ReciboOperacion, 'observado'>; resultado?: R };

/**
 * El patrón completo para un efecto: registrar (una vez) → `dispatched` (persistido ANTES de actuar) → el
 * efecto → su estado con recibo. Si la operación ya existía no se corre otra vez (`corrio: false` con su
 * estado: un `unknown` se reconcilia, no se repite). Si el efecto lanza, queda `unknown` (pudo haber
 * ocurrido). Sin almacén, o sin lease vigente, NO se corre.
 */
export async function ejecutarUnaVez<R>(
  o: { dueno: string; requestId: string; tipo: string; argsHash?: string; lease?: Lease; almacen?: AlmacenDurable },
  efecto: () => Promise<SalidaEfecto<R>>
): Promise<{ corrio: true; op: Operacion; resultado?: R } | { corrio: false; op?: Operacion; motivo: string }> {
  const reg = await registrarOperacion({ ...o, fencing: o.lease?.token });
  if (reg.ok === false) return { corrio: false, op: reg.op, motivo: reg.motivo };
  if (!reg.nueva) return { corrio: false, op: reg.op, motivo: 'ya-registrada' };
  const desp = await avanzarOperacion({ dueno: o.dueno, requestId: o.requestId, a: 'dispatched', lease: o.lease, almacen: o.almacen });
  if (desp.ok === false) {
    // No se despachó: no hubo efecto. Se deja `failed` para que un reintento no crea que sigue pendiente.
    await avanzarOperacion({ dueno: o.dueno, requestId: o.requestId, a: 'failed', recibo: { efecto: 'none', detalle: `no se despachó: ${desp.motivo}` }, almacen: o.almacen });
    return { corrio: false, op: desp.op, motivo: desp.motivo };
  }
  let salida: SalidaEfecto<R>;
  try {
    salida = await efecto();
  } catch (e: any) {
    salida = { estado: 'unknown', recibo: { efecto: 'possible', detalle: String(e?.message || e).slice(0, 160) } };
  }
  const recibo = salida.recibo || { efecto: salida.estado === 'succeeded' ? 'confirmed' : salida.estado === 'failed' ? 'none' : 'possible' };
  const fin = await avanzarOperacion({ dueno: o.dueno, requestId: o.requestId, a: salida.estado, recibo, almacen: o.almacen });
  // Si el cierre no se pudo guardar, la operación queda `dispatched`: quien la vea después la trata como
  // incierta (no se repite a ciegas).
  return { corrio: true, op: fin.ok ? fin.op : desp.op, resultado: salida.resultado };
}

/* ------------------------------------------------------------------ dedupe pedido → id */

/**
 * La misma petición lógica (dueño + requestId) siempre da el mismo id: el primero que la reserva pone el
 * suyo (`propuesto`) y los demás reciben ese. Para «crear la tarea una vez» (computadora, misiones…).
 */
export async function reservarPedido(o: { espacio: string; dueno: string; requestId: string; propuesto: string; almacen?: AlmacenDurable }): Promise<{ ok: true; id: string; nuevo: boolean } | { ok: false; detalle: string }> {
  const r = await crearUnaVez(claveDe(o.espacio, o.dueno, o.requestId), { id: o.propuesto, t: Date.now() }, o.almacen || almacenDurable());
  if (r.ok === false) return { ok: false, detalle: r.detalle };
  return { ok: true, id: String(r.valor.id), nuevo: r.creado };
}
