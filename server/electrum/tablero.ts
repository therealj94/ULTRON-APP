/**
 * EL TABLERO NACIONAL.
 *
 * Lo que una institución quiere ver de un vistazo, y que hasta ahora había que preguntar de a una:
 * cuántas concesiones hay y de qué clase, en qué estado, en qué departamentos, cuántas se pisan
 * entre sí, y —lo que importa para fiscalizar— cuáles pisan áreas protegidas, microcuencas
 * declaradas o tienen caseríos dentro. Cada conflicto lleva el id de la concesión, para que tocarlo
 * en la pantalla vuele el mapa hasta ella.
 *
 * Todo se calcula en PostGIS con tope por consulta, y se guarda diez minutos: el catastro no cambia
 * entre dos vistazos, y una demo no puede esperar 10 s cada vez que se abre el tablero.
 *
 * Detalles del padrón nacional que están resueltos aquí y no en la carga:
 *  · no trae tipo, mineral ni departamento; la clase (metálica, no metálica, artesanal) sale del
 *    nombre de la capa de la que vino cada concesión, y el departamento de cruzarla con la capa de
 *    departamentos;
 *  · la capa de caseríos incluye algún polígono que lo cubre todo: los caseríos se cuentan solo
 *    como puntos.
 */
import { conTextoReparado, consultaConTope, hayBase, resumenTraslapes } from './db';
import { capasPorRol, nombreDe } from './entorno';

const TOPE = 20000;
const q = <T = any>(sql: string, p: unknown[] = [], ms = TOPE) => consultaConTope<T>(sql, p, ms).then(conTextoReparado);
/** En segundo plano nadie espera: el cálculo pesado tiene más margen que un pedido de la pantalla. */
const TOPE_FONDO = 60000;
const VALIDA = `CASE WHEN ST_IsValid(e.geom) THEN e.geom ELSE ST_CollectionExtract(ST_MakeValid(e.geom), 3) END`;

export type Conflicto = { id: number; concesion: string; estado: string | null; con: string; ha: number; pct: number };
export type Tablero = {
  generado: string;
  total: { concesiones: number; hectareas: number };
  porEstado: Array<{ nombre: string; n: number; ha: number }>;
  porClase: Array<{ nombre: string; n: number; ha: number }>;
  porDepartamento: Array<{ nombre: string; n: number }>;
  traslapes: {
    total: number;
    hectareas: number;
    /** Entre concesiones con el mismo nombre: el mismo derecho cargado dos veces, casi siempre. */
    mismoNombre: { total: number; hectareas: number };
    /** Los mayores entre concesiones DISTINTAS, que son los que importan. */
    mayores: Array<{ a: string; b: string; ha: number; aId: number; bId: number }>;
  };
  areasProtegidas: { concesiones: number; hectareas: number; lista: Conflicto[] } | null;
  microcuencas: { concesiones: number; hectareas: number; lista: Conflicto[] } | null;
  poblados: { concesiones: number; caserios: number; lista: Array<{ id: number; concesion: string; n: number; nombres: string[] }> } | null;
  /**
   * Secciones que no se alcanzaron a calcular esta vez (vienen en null o vacías y se reintentan en
   * un minuto). No es lo mismo que una capa que no está cargada: eso también es null, pero sin
   * figurar acá.
   */
  incompletas: string[];
  ms: number;
};

/**
 * La clase que trae el padrón en su columna CLASIFICAC, legible. El .dbf del catastro perdió las
 * tildes al exportarse —vienen como «?»: «Peque?a Min. No Met?lica»— y no hay byte que reparar,
 * así que se reponen las palabras que usa el padrón. Null si no trae clase.
 */
export function normalizarClase(v: string | null | undefined): string | null {
  const t = String(v || '').trim();
  if (!t) return null;
  const arreglado = t
    .replace(/Peque\?a/gi, 'Pequeña')
    .replace(/Miner\?a/gi, 'Minería')
    .replace(/Met\?lica/gi, 'Metálica')
    .replace(/Pr\?stamo/gi, 'Préstamo')
    .replace(/\bMin\.\s/gi, 'Minería ')
    .replace(/\s+/g, ' ');
  return arreglado.replace(/(^|\s)(\S)/g, (_m, e, c) => e + c.toUpperCase()).replace(/\bDe\b/g, 'de');
}

/** La clase de una concesión por el nombre de la capa de la que vino. */
export function claseDeCapa(nombre: string | null | undefined): string {
  const n = String(nombre || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  if (/artesanal/.test(n)) return 'Minería artesanal';
  if (/no\s*metal/.test(n)) return 'No metálica';
  if (/metal/.test(n)) return 'Metálica';
  return 'Sin clase en la capa';
}

const r1 = (x: unknown) => Math.round(Number(x || 0) * 10) / 10;

/*
 * Cada polígono de la capa se valida UNA vez (no una por cada concesión que toca) y se corta en
 * piezas de 128 vértices: la intersección con una pieza chica es barata y el índice de `concesion`
 * encuentra las que la tocan. Las piezas no se superponen, así que las hectáreas suman igual.
 * Medido con las 324 áreas protegidas y las 1 782 concesiones reales: de 6,5 s a 1 s con el mismo
 * resultado; en producción, con la geometría sin simplificar, la versión anterior pasaba de 20 s y
 * el tablero no salía.
 */
async function conflictos(capas: number[], rol: 'area_protegida' | 'microcuenca', tope: number) {
  if (!capas.length) return null;
  const filas = await q<{ id: string; concesion: string; estado: string | null; con: string | null; ha: number; ha_c: number }>(
    `WITH e AS MATERIALIZED (
       SELECT ${nombreDe(rol)} AS con, ${VALIDA} AS g
         FROM entidad_geo e
        WHERE e.capa_id = ANY($1) AND ST_Dimension(e.geom) = 2
          AND e.geom && (SELECT ST_SetSRID(ST_Extent(geom)::geometry, 4326) FROM concesion)
     ),
     piezas AS MATERIALIZED (SELECT con, ST_Subdivide(g, 128) AS g FROM e WHERE NOT ST_IsEmpty(g)),
     p AS (
       SELECT k.id, k.nombre AS concesion, k.estado, k.hectareas AS ha_c, x.con,
              ST_Area(ST_Intersection(k.geom, x.g)::geography) / 10000.0 AS ha
         FROM piezas x JOIN concesion k ON k.geom && x.g AND ST_Intersects(k.geom, x.g)
     )
     SELECT id::text, concesion, estado, con, sum(ha)::float8 AS ha, max(ha_c)::float8 AS ha_c
       FROM p GROUP BY id, concesion, estado, con
      HAVING sum(ha) >= 0.01
      ORDER BY ha DESC`,
    [capas],
    tope
  );
  const ids = new Set(filas.map((f) => f.id));
  return {
    concesiones: ids.size,
    hectareas: r1(filas.reduce((s, f) => s + f.ha, 0)),
    lista: filas.slice(0, 20).map((f) => ({
      id: Number(f.id),
      concesion: f.concesion,
      estado: f.estado,
      con: f.con || 'sin nombre en la capa',
      ha: r1(f.ha),
      pct: f.ha_c ? r1((f.ha / f.ha_c) * 100) : 0,
    })),
  };
}

async function calcular(tope = TOPE): Promise<Tablero> {
  const t0 = Date.now();
  // Lo pesado (cruces con capas) no tumba el tablero entero: si no llega, esa sección sale vacía,
  // queda anotada en `incompletas` y el resto se muestra igual.
  const incompletas: string[] = [];
  const opcional = <T,>(que: string, p: Promise<T>, vacio: T): Promise<T> =>
    p.catch((e) => {
      incompletas.push(que);
      console.warn(`[electrum] tablero: ${que} no llegó:`, String(e?.message || e).slice(0, 120));
      return vacio;
    });
  const capas = await capasPorRol();
  const de = (rol: string) => capas.filter((c) => c.rol === rol).map((c) => c.id);

  const [total, porEstado, porClase, porDepartamento, tr, mayores, ap, mc, pob] = await Promise.all([
    q<{ n: number; ha: number }>(`SELECT count(*)::int AS n, coalesce(sum(hectareas), 0)::float8 AS ha FROM concesion`),
    q<{ nombre: string | null; n: number; ha: number }>(
      `SELECT estado AS nombre, count(*)::int AS n, coalesce(sum(hectareas), 0)::float8 AS ha FROM concesion GROUP BY 1 ORDER BY 2 DESC`
    ),
    q<{ capa: string | null; clase: string | null; n: number; ha: number }>(
      // La llave se busca sin distinguir mayúsculas: según cómo se cargó el .dbf llega como
      // «clasificac» o «CLASIFICAC», y en JSONB son llaves distintas.
      `SELECT c.nombre AS capa,
              (SELECT a.valor FROM jsonb_each_text(k.atributos) AS a(llave, valor) WHERE lower(a.llave) = 'clasificac' LIMIT 1) AS clase,
              count(*)::int AS n, coalesce(sum(k.hectareas), 0)::float8 AS ha
         FROM concesion k LEFT JOIN capa c ON c.id = k.capa_id GROUP BY 1, 2`
    ),
    de('departamento').length
      ? opcional('departamentos', q<{ nombre: string | null; n: number }>(
          `SELECT ${nombreDe('departamento')} AS nombre, count(*)::int AS n
             FROM concesion k
             JOIN entidad_geo e ON e.capa_id = ANY($1) AND e.geom && k.geom AND ST_Intersects(e.geom, ST_PointOnSurface(k.geom))
            GROUP BY 1 ORDER BY 2 DESC`,
          [de('departamento')],
          tope
        ), [])
      : Promise.resolve([]),
    resumenTraslapes(),
    // Se separan los de mismo nombre: en el padrón nacional muchos «traslapes» son el mismo derecho
    // cargado desde dos capas («Las Joyas con Las Joyas»), y listarlos como conflicto confunde.
    q<{ a: string; b: string; ha: number; a_id: string; b_id: string; mismo: boolean }>(
      `SELECT ca.nombre AS a, cb.nombre AS b, t.hectareas::float8 AS ha, t.a_id::text, t.b_id::text,
              lower(unaccent(trim(ca.nombre))) = lower(unaccent(trim(cb.nombre))) AS mismo
         FROM traslape t JOIN concesion ca ON ca.id = t.a_id JOIN concesion cb ON cb.id = t.b_id
        ORDER BY t.hectareas DESC`
    ),
    opcional('areas_protegidas', conflictos(de('area_protegida'), 'area_protegida', tope), null),
    opcional('microcuencas', conflictos(de('microcuenca'), 'microcuenca', tope), null),
    de('poblado').length
      ? opcional('poblados', q<{ id: string; concesion: string; n: number; nombres: string[] | null }>(
          `SELECT k.id::text, k.nombre AS concesion, count(*)::int AS n,
                  (array_agg(DISTINCT ${nombreDe('poblado')}) FILTER (WHERE ${nombreDe('poblado')} IS NOT NULL))[1:4] AS nombres
             FROM concesion k
             JOIN entidad_geo e ON e.capa_id = ANY($1) AND ST_Dimension(e.geom) = 0 AND e.geom && k.geom AND ST_Intersects(k.geom, e.geom)
            GROUP BY k.id, k.nombre ORDER BY n DESC`,
          [de('poblado')],
          tope
        ), null)
      : Promise.resolve(null),
  ]);

  // La clase del padrón (CLASIFICAC) si la trae; si no, la que dice el nombre de la capa.
  const clases = new Map<string, { n: number; ha: number }>();
  for (const f of porClase) {
    const c = normalizarClase(f.clase) || claseDeCapa(f.capa);
    const a = clases.get(c) || { n: 0, ha: 0 };
    clases.set(c, { n: a.n + f.n, ha: a.ha + f.ha });
  }

  return {
    generado: new Date().toISOString(),
    total: { concesiones: total[0]?.n || 0, hectareas: Math.round(total[0]?.ha || 0) },
    porEstado: porEstado.map((f) => ({ nombre: f.nombre || 'Sin estado', n: f.n, ha: Math.round(f.ha) })),
    porClase: [...clases].map(([nombre, v]) => ({ nombre, n: v.n, ha: Math.round(v.ha) })).sort((a, b) => b.n - a.n),
    porDepartamento: porDepartamento.map((f) => ({ nombre: f.nombre || 'Sin nombre', n: f.n })),
    traslapes: {
      total: tr.total,
      hectareas: Math.round(tr.hectareas),
      mismoNombre: {
        total: mayores.filter((m) => m.mismo).length,
        hectareas: Math.round(mayores.filter((m) => m.mismo).reduce((s, m) => s + m.ha, 0)),
      },
      mayores: mayores
        .filter((m) => !m.mismo)
        .slice(0, 8)
        .map((m) => ({ a: m.a, b: m.b, ha: r1(m.ha), aId: Number(m.a_id), bId: Number(m.b_id) })),
    },
    areasProtegidas: ap,
    microcuencas: mc,
    poblados: pob
      ? {
          concesiones: pob.length,
          caserios: pob.reduce((s, f) => s + f.n, 0),
          lista: pob.slice(0, 15).map((f) => ({ id: Number(f.id), concesion: f.concesion, n: f.n, nombres: (f.nombres || []).filter(Boolean) })),
        }
      : null,
    incompletas,
    ms: Date.now() - t0,
  };
}

let guardado: { t: number; datos: Tablero } | null = null;
let enCurso: Promise<Tablero> | null = null;
const VIGENCIA_MS = 10 * 60 * 1000;

/** El tablero, de la caché si tiene menos de diez minutos. Dos pedidos a la vez comparten el cálculo. */
export async function tablero(opts: { fresco?: boolean; tope?: number } = {}): Promise<Tablero> {
  if (!hayBase()) throw new Error('sin base');
  if (!opts.fresco && guardado && Date.now() - guardado.t < VIGENCIA_MS) return guardado.datos;
  if (!enCurso) {
    enCurso = calcular(opts.tope)
      .then((datos) => {
        // Incompleto: sirve ya, pero vence en un minuto para reintentar lo que faltó.
        guardado = { t: datos.incompletas.length ? Date.now() - VIGENCIA_MS + 60_000 : Date.now(), datos };
        return datos;
      })
      .finally(() => {
        enCurso = null;
      });
  }
  return enCurso;
}

/**
 * El tablero listo antes de que alguien lo abra: se calcula al arrancar y se renueva antes de que
 * venza. Con el catastro nacional el cálculo en frío tarda ~11 s, y en una demo el primer toque al
 * tablero no puede quedarse en esqueletos.
 */
let mantenedor: NodeJS.Timeout | null = null;
export function mantenerTableroCaliente(retrasoMs = 20_000) {
  if (mantenedor || !hayBase()) return;
  const calentar = () => void tablero({ fresco: true, tope: TOPE_FONDO }).catch((e) => console.warn('[electrum] tablero en segundo plano:', String(e?.message || e).slice(0, 120)));
  setTimeout(calentar, retrasoMs).unref?.();
  mantenedor = setInterval(calentar, VIGENCIA_MS - 60_000);
  mantenedor.unref?.();
}

/** Para las pruebas: que el siguiente pedido recalcule. */
export function olvidarTablero() {
  guardado = null;
}
