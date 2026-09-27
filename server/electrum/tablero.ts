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
import { conTextoReparado, consultaConTope, hayBase, resumenTraslapes, traslapes } from './db';
import { capasPorRol, nombreDe } from './entorno';

const TOPE = 20000;
const q = <T = any>(sql: string, p: unknown[] = []) => consultaConTope<T>(sql, p, TOPE).then(conTextoReparado);
const VALIDA = `CASE WHEN ST_IsValid(e.geom) THEN e.geom ELSE ST_CollectionExtract(ST_MakeValid(e.geom), 3) END`;

export type Conflicto = { id: number; concesion: string; estado: string | null; con: string; ha: number; pct: number };
export type Tablero = {
  generado: string;
  total: { concesiones: number; hectareas: number };
  porEstado: Array<{ nombre: string; n: number; ha: number }>;
  porClase: Array<{ nombre: string; n: number; ha: number }>;
  porDepartamento: Array<{ nombre: string; n: number }>;
  traslapes: { total: number; hectareas: number; mayores: Array<{ a: string; b: string; ha: number; aId: number; bId: number }> };
  areasProtegidas: { concesiones: number; hectareas: number; lista: Conflicto[] } | null;
  microcuencas: { concesiones: number; hectareas: number; lista: Conflicto[] } | null;
  poblados: { concesiones: number; caserios: number; lista: Array<{ id: number; concesion: string; n: number; nombres: string[] }> } | null;
  ms: number;
};

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

async function conflictos(capas: number[], rol: 'area_protegida' | 'microcuenca') {
  if (!capas.length) return null;
  const filas = await q<{ id: string; concesion: string; estado: string | null; con: string | null; ha: number; ha_c: number }>(
    `WITH p AS (
       SELECT k.id, k.nombre AS concesion, k.estado, k.hectareas AS ha_c, ${nombreDe(rol)} AS con,
              ST_Area(ST_Intersection(k.geom, ${VALIDA})::geography) / 10000.0 AS ha
         FROM concesion k
         JOIN entidad_geo e ON e.capa_id = ANY($1) AND e.geom && k.geom AND ST_Dimension(e.geom) = 2
          AND ST_Intersects(k.geom, ${VALIDA})
     )
     SELECT id::text, concesion, estado, con, sum(ha)::float8 AS ha, max(ha_c)::float8 AS ha_c
       FROM p GROUP BY id, concesion, estado, con
      HAVING sum(ha) >= 0.01
      ORDER BY ha DESC`,
    [capas]
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

async function calcular(): Promise<Tablero> {
  const t0 = Date.now();
  const capas = await capasPorRol();
  const de = (rol: string) => capas.filter((c) => c.rol === rol).map((c) => c.id);

  const [total, porEstado, porClase, porDepartamento, tr, mayores, ap, mc, pob] = await Promise.all([
    q<{ n: number; ha: number }>(`SELECT count(*)::int AS n, coalesce(sum(hectareas), 0)::float8 AS ha FROM concesion`),
    q<{ nombre: string | null; n: number; ha: number }>(
      `SELECT estado AS nombre, count(*)::int AS n, coalesce(sum(hectareas), 0)::float8 AS ha FROM concesion GROUP BY 1 ORDER BY 2 DESC`
    ),
    q<{ capa: string | null; n: number; ha: number }>(
      `SELECT c.nombre AS capa, count(*)::int AS n, coalesce(sum(k.hectareas), 0)::float8 AS ha
         FROM concesion k LEFT JOIN capa c ON c.id = k.capa_id GROUP BY 1`
    ),
    de('departamento').length
      ? q<{ nombre: string | null; n: number }>(
          `SELECT ${nombreDe('departamento')} AS nombre, count(*)::int AS n
             FROM concesion k
             JOIN entidad_geo e ON e.capa_id = ANY($1) AND e.geom && k.geom AND ST_Intersects(e.geom, ST_PointOnSurface(k.geom))
            GROUP BY 1 ORDER BY 2 DESC`,
          [de('departamento')]
        )
      : Promise.resolve([]),
    resumenTraslapes(),
    traslapes(8),
    conflictos(de('area_protegida'), 'area_protegida'),
    conflictos(de('microcuenca'), 'microcuenca'),
    de('poblado').length
      ? q<{ id: string; concesion: string; n: number; nombres: string[] | null }>(
          `SELECT k.id::text, k.nombre AS concesion, count(*)::int AS n,
                  (array_agg(DISTINCT ${nombreDe('poblado')}) FILTER (WHERE ${nombreDe('poblado')} IS NOT NULL))[1:4] AS nombres
             FROM concesion k
             JOIN entidad_geo e ON e.capa_id = ANY($1) AND ST_Dimension(e.geom) = 0 AND e.geom && k.geom AND ST_Intersects(k.geom, e.geom)
            GROUP BY k.id, k.nombre ORDER BY n DESC`,
          [de('poblado')]
        )
      : Promise.resolve(null),
  ]);

  // Las capas del catastro traen la clase en el nombre; varias capas pueden dar la misma clase.
  const clases = new Map<string, { n: number; ha: number }>();
  for (const f of porClase) {
    const c = claseDeCapa(f.capa);
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
      mayores: mayores.map((m) => ({ a: m.a, b: m.b, ha: r1(m.hectareas), aId: Number(m.a_id), bId: Number(m.b_id) })),
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
    ms: Date.now() - t0,
  };
}

let guardado: { t: number; datos: Tablero } | null = null;
let enCurso: Promise<Tablero> | null = null;
const VIGENCIA_MS = 10 * 60 * 1000;

/** El tablero, de la caché si tiene menos de diez minutos. Dos pedidos a la vez comparten el cálculo. */
export async function tablero(opts: { fresco?: boolean } = {}): Promise<Tablero> {
  if (!hayBase()) throw new Error('sin base');
  if (!opts.fresco && guardado && Date.now() - guardado.t < VIGENCIA_MS) return guardado.datos;
  if (!enCurso) {
    enCurso = calcular()
      .then((datos) => {
        guardado = { t: Date.now(), datos };
        return datos;
      })
      .finally(() => {
        enCurso = null;
      });
  }
  return enCurso;
}

/** Para las pruebas: que el siguiente pedido recalcule. */
export function olvidarTablero() {
  guardado = null;
}
