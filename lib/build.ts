/**
 * EL MANIFIESTO DE ESTA COMPILACIÓN (documento maestro del 3-oct, AUR16 / gate G0): qué revisión corre, en qué
 * servicio, con qué contratos y con qué banderas, para que una prueba o un reporte se pueda atribuir a un build
 * concreto. El /api/health público solo dice el commit corto; esto va detrás de la sesión de mesa.
 *
 * P5 (auditoría externa del 4-oct, «una entrega identificable»): `manifiestoEntrega` añade lo que el manifiesto de antes
 * no acreditaba —el SHA y la hora del servidor, el SHA del build web que se sirve, lo que el nodo de la computadora dice
 * de sí mismo en /salud (su huella, su validador, sus capacidades; «desconocido» si no contesta), el validador mínimo que
 * exige el servidor y las versiones de esquema— para que un ensayo se atribuya a la combinación exacta. Y
 * `sondearAlmacen`: un /api/health 200 dice que hay servidor, no que el almacén durable lea y escriba.
 *
 * Nada secreto: ni llaves, ni direcciones de nodos, ni cuántas personas hay. Solo nombres, versiones y si una
 * capacidad está configurada (configurada ≠ verificada de punta a punta: eso lo acreditan las pruebas).
 */
import fs from 'node:fs';
import path from 'node:path';
import { almacenDurable, PROCESO_DURABLE, type AlmacenDurable } from './durable';
import { VALIDADOR_MIN } from './entregables';
import { pushConfigurado } from './push';
import { pushWebConfigurado } from './push-web';
import { ESQUEMA_INDICE, ESQUEMA_INVENTARIO, ESQUEMA_TAREAS, modoReconciliacion } from './tareas-durables';

/** Versiones de los contratos entre piezas; se suben cuando cambia la forma de lo que viaja. */
export const CONTRATOS = {
  /** Entradas al escritorio remoto: secuencia, época, viewport, ACK (AUR09). */
  entradaRemota: 1,
  /** Permiso ligado a la operación exacta y parada en tres estados (AUR02/AUR03). */
  computadora: 3,
  /** Turnos y operaciones durables con lease y fencing (AUR06). */
  durable: 1,
  /** Recibos tipados de herramientas (AUR07). */
  recibos: 1,
} as const;

/**
 * Las versiones de lo que se GUARDA (P5): si una versión vieja del servidor lee datos de una nueva, tiene que poder
 * decir qué esquema encontró. `misionesComputadora` 1: la misión durable de server/computadora.ts (P5/A6);
 * `indiceTareas` 2: el índice con `fin` (P5/A7; el v1 se sigue leyendo); `inventarioTareas` 1: la marca de inventario
 * reconciliado del índice (A7, auditoría del 5-oct).
 */
export const ESQUEMA = { tareas: ESQUEMA_TAREAS, indiceTareas: ESQUEMA_INDICE, inventarioTareas: ESQUEMA_INVENTARIO, misionesComputadora: 1 } as const;

export type ManifiestoBuild = {
  commit: string | null;
  servicio: string | null;
  plataforma: 'aura' | 'electrum';
  arrancoEn: string;
  node: string;
  contratos: typeof CONTRATOS;
  durable: { tipo: string; multiReplica: boolean };
  banderas: Record<string, boolean>;
};

const ARRANQUE = new Date().toISOString();

export function manifiestoBuild(o: { plataforma: 'aura' | 'electrum'; banderas?: Record<string, boolean> }, env: NodeJS.ProcessEnv = process.env): ManifiestoBuild {
  const a = almacenDurable();
  return {
    commit: String(env.RENDER_GIT_COMMIT || '').trim() || null,
    servicio: String(env.RENDER_SERVICE_NAME || '').trim() || null,
    plataforma: o.plataforma,
    arrancoEn: ARRANQUE,
    node: process.version,
    contratos: CONTRATOS,
    durable: { tipo: a.tipo, multiReplica: a.multiReplica },
    banderas: {
      push: pushConfigurado(),
      pushWeb: pushWebConfigurado(),
      serviceWorker: String(env.AURA_SW ?? '1').trim() !== '0',
      // A7: ¿la reconciliación del inventario de tareas puede escribir (agregar lo que falta)? `AURA_RECONCILIAR_TAREAS`.
      reconciliarTareas: modoReconciliacion(env) === 'agregar',
      ...(o.banderas || {}),
    },
  };
}

/* ------------------------------------------------------------------ P5: la entrega completa */

const DESCONOCIDO = 'desconocido' as const;
type Desconocido = typeof DESCONOCIDO;

/** Lo que el servidor sabe del nodo por su /salud (server/computadora.ts estadoComputadora). */
export type SaludNodo = { configurada: boolean; ok: boolean; motores?: string[]; ocupada?: boolean; capacidades?: string[]; hash?: string | null; validador?: number | null; detalle?: string };

export type ManifiestoEntrega = ManifiestoBuild & {
  servidor: { sha: string; hora: string; servicio: string | null; node: string };
  web: { sha: string; hora: string | Desconocido };
  nodo: {
    estado: 'alcanzable' | 'desconocido' | 'no_configurado';
    hash: string;
    validador: number | Desconocido;
    capacidades: string[] | Desconocido;
    /** ¿Su validador llega al mínimo que exige el servidor? null si no se sabe. */
    validadorSuficiente: boolean | null;
  };
  validadorMinimo: number;
  esquema: typeof ESQUEMA;
  generado: string;
};

/** El build web que se sirve: `dist/aura-build.json`, que escribe el plugin de Vite (scripts/pwa/vite-build-info.ts). */
export function leerBuildWeb(archivo = path.join(process.cwd(), 'dist', 'aura-build.json')): { sha: string; hora: string | Desconocido } {
  try {
    const j = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    const sha = typeof j?.sha === 'string' && /^[0-9a-f]{7,40}$/i.test(j.sha) ? j.sha : DESCONOCIDO;
    const hora = typeof j?.hora === 'string' && Date.parse(j.hora) > 0 ? j.hora : DESCONOCIDO;
    return { sha, hora };
  } catch {
    return { sha: DESCONOCIDO, hora: DESCONOCIDO };
  }
}

/** Solo lo que identifica al nodo; nunca su dirección, su llave ni el texto de un error (puede traer la dirección). */
function nodoDe(s: SaludNodo | null): ManifiestoEntrega['nodo'] {
  if (s && !s.configurada) return { estado: 'no_configurado', hash: DESCONOCIDO, validador: DESCONOCIDO, capacidades: DESCONOCIDO, validadorSuficiente: null };
  if (!s || !s.ok) return { estado: 'desconocido', hash: DESCONOCIDO, validador: DESCONOCIDO, capacidades: DESCONOCIDO, validadorSuficiente: null };
  const hash = typeof s.hash === 'string' && /^[0-9a-f]{8,64}$/i.test(s.hash) ? s.hash : DESCONOCIDO;
  const validador = typeof s.validador === 'number' && Number.isInteger(s.validador) ? s.validador : DESCONOCIDO;
  const capacidades = Array.isArray(s.capacidades) ? s.capacidades.filter((c) => typeof c === 'string' && /^[a-z0-9-]{1,40}$/.test(c)).slice(0, 20) : DESCONOCIDO;
  // Un nodo que no dice su validador es uno viejo: no llega al mínimo (lo que compruebe queda «sin comprobar»).
  return { estado: 'alcanzable', hash, validador, capacidades, validadorSuficiente: validador === DESCONOCIDO ? false : validador >= VALIDADOR_MIN };
}

/**
 * El manifiesto de la entrega: el de siempre (mismos campos, para las herramientas de antes) más servidor, web, nodo,
 * validador mínimo y esquema. `nodo` pregunta al nodo (server.ts le pasa estadoComputadora, con su tope de tiempo); si
 * no contesta o lanza, «desconocido».
 */
export async function manifiestoEntrega(
  o: { plataforma: 'aura' | 'electrum'; banderas?: Record<string, boolean> },
  d: { env?: NodeJS.ProcessEnv; nodo?: () => Promise<SaludNodo>; archivoWeb?: string } = {}
): Promise<ManifiestoEntrega> {
  const env = d.env ?? process.env;
  const base = manifiestoBuild(o, env);
  const salud = d.nodo ? await d.nodo().catch(() => null) : null;
  return {
    ...base,
    servidor: { sha: base.commit || DESCONOCIDO, hora: ARRANQUE, servicio: base.servicio, node: process.version },
    web: leerBuildWeb(d.archivoWeb),
    nodo: nodoDe(salud),
    validadorMinimo: VALIDADOR_MIN,
    esquema: ESQUEMA,
    generado: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ P5: ¿lee y escribe el almacén durable? */

/**
 * `listado`: si el almacén deja enumerar (A7, inventario de tareas por dueño). «ok» = una lista real contestó; «denegado» =
 * el almacén lo rechazó (p. ej. sin `s3:ListBucket`): el inventario de tareas queda «sin reconciliar» y lo dice; «sin-fuente»
 * = este almacén no sabe listar. No cambia `ok` (leer y escribir siguen siendo lo que decide la salud del almacén).
 */
export type SaludAlmacen = {
  ok: boolean;
  tipo: string;
  multiReplica: boolean;
  lectura: boolean;
  escritura: boolean;
  listado?: 'ok' | 'denegado' | 'sin-fuente';
  ms: number;
  comprobado: string;
  detalle?: string;
};

/** Una lista de una sola clave bajo `salud/` (lo que el inventario de tareas necesita poder hacer). Nunca lanza. */
async function sondearListado(a: AlmacenDurable): Promise<'ok' | 'denegado' | 'sin-fuente'> {
  if (!a.listar) return 'sin-fuente';
  try {
    const l = await a.listar('salud', { max: 1 });
    return l.ok ? 'ok' : 'denegado';
  } catch {
    return 'denegado';
  }
}

let ultimoSondeo: { en: number; r: SaludAlmacen } | null = null;
let sondeando: Promise<SaludAlmacen> | null = null;
/** Cada cuánto se escribe de verdad (el /api/health público se consulta seguido; esto va con caché). */
export const SONDEO_ALMACEN_MS = 30_000;

/**
 * Escribe (CAS sobre `salud/<proceso>`) y vuelve a leer lo escrito. `ok` solo si las dos cosas funcionaron y lo leído
 * es lo escrito. Con caché de SONDEO_ALMACEN_MS (`forzar` la salta). Nunca lanza.
 */
export async function sondearAlmacen(a: AlmacenDurable = almacenDurable(), o: { forzar?: boolean } = {}): Promise<SaludAlmacen> {
  if (!o.forzar && ultimoSondeo && Date.now() - ultimoSondeo.en < SONDEO_ALMACEN_MS) return ultimoSondeo.r;
  if (!o.forzar && sondeando) return sondeando;
  const hacer = async (): Promise<SaludAlmacen> => {
    const t0 = Date.now();
    const clave = `salud/${PROCESO_DURABLE}`;
    const marca = `${t0}-${Math.random().toString(36).slice(2, 8)}`;
    const fin = (lectura: boolean, escritura: boolean, detalle?: string): SaludAlmacen => ({
      ok: lectura && escritura,
      tipo: a.tipo,
      multiReplica: a.multiReplica,
      lectura,
      escritura,
      ms: Date.now() - t0,
      comprobado: new Date().toISOString(),
      ...(detalle ? { detalle: detalle.replace(/https?:\/\/\S+/g, '[dirección]').slice(0, 120) } : {}),
    });
    try {
      const antes = await a.leer<{ marca: string }>(clave);
      if (antes.ok === false) {
        const w = await a.crear(clave, { marca });
        return fin(false, w.ok === true || w.conflicto === true, antes.detalle);
      }
      const w = antes.valor === null ? await a.crear(clave, { marca }) : await a.cas(clave, { marca }, antes.etag);
      if (w.ok === false) return fin(true, false, w.detalle || 'conflicto al escribir');
      const despues = await a.leer<{ marca: string }>(clave);
      if (despues.ok === false) return fin(false, true, despues.detalle);
      if (despues.valor?.marca !== marca) return fin(false, true, 'lo leído no es lo escrito');
      return { ...fin(true, true), listado: await sondearListado(a) };
    } catch (e: any) {
      return fin(false, false, String(e?.message || e));
    }
  };
  const p = hacer();
  if (!o.forzar) sondeando = p;
  const r = await p.finally(() => {
    if (sondeando === p) sondeando = null;
  });
  ultimoSondeo = { en: Date.now(), r };
  return r;
}
