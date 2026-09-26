/**
 * EL ENTORNO DE UNA CONCESIÓN — lo que tiene alrededor, medido en la base.
 *
 * La ficha decía de quién es una concesión y cuánto mide, y nada de dónde está. En el nodo están
 * cargados los ríos del país, los caseríos, las aldeas, las áreas protegidas, las microcuencas
 * declaradas, los municipios… y ninguna de esas capas se cruzaba con nada. Pero las preguntas que
 * deciden si una concesión se puede trabajar son justamente esas: ¿pisa un área protegida?, ¿hay
 * gente viviendo dentro?, ¿por dónde corre el agua?, ¿qué tan lejos queda la carretera?
 *
 * Tres reglas, las mismas del informe:
 *
 *  · Las CIFRAS salen de PostGIS, medidas sobre el elipsoide (`geography`), nunca del modelo. Este
 *    módulo devuelve un objeto tipado con los números y, aparte, las alertas ya redactadas: el
 *    modelo las cita, no las calcula.
 *  · Una capa que no está cargada se dice «no cargada». Nunca se contesta «no pisa ningún área
 *    protegida» sin tener la capa de áreas protegidas delante: esa frase, dicha sin datos, es la
 *    que después hace que nadie se crea el resto de la ficha.
 *  · Cada cruce es independiente. Si una capa trae un polígono roto y su consulta falla, esa
 *    sección dice que falló y las otras siguen: una ficha sin microcuencas es mejor que ninguna.
 *
 * Las capas se eligen por su ROL (`capa.rol`, esquema v7), no por su nombre.
 *
 * Velocidad: la red hídrica son 119 mil líneas. Todo va con el índice espacial —`&&` contra la
 * caja de la concesión, ampliada en grados lo justo para la distancia que se pide— y solo sobre lo
 * que sobrevive a ese filtro se mide en metros sobre `geography`. Las consultas corren en paralelo.
 */
import { baseTieneRol, consultaConTope, hayBase, rolDeCapa, traslapesDe, type RolCapa } from './db';

/** Cada consulta del entorno la corta la base a los 8 s: una capa lenta no se queda con el pool. */
const TOPE_MS = 8000;
const consulta = <T = any>(sql: string, params: unknown[] = []) => consultaConTope<T>(sql, params, TOPE_MS);

/* ------------------------------------------------------------------ tipos */

export type Pisada = { nombre: string; ha: number; pct: number };
export type Cercana = { nombre: string; km: number };
export type Poblado = { nombre: string; tipo: 'caserío' | 'aldea' | 'poblado'; km: number; dentro: boolean; poblacion: number | null };
export type Punto = { nombre: string; km: number; dentro: boolean; detalle: string | null };

/** Una sección del entorno: o se cruzó, o la capa no está, o la consulta falló (y se dice). */
export type Seccion<T> = ({ estado: 'ok' } & T) | { estado: 'no-cargada' } | { estado: 'error'; motivo: string };

export type Entorno = {
  concesion: { id: number; nombre: string; hectareas: number };
  /** Qué capas se usaron para cada rol, por su nombre: la fuente de cada cifra. */
  capas: Partial<Record<RolCapa, string[]>>;
  municipios: Seccion<{ lista: Pisada[] }>;
  departamentos: Seccion<{ lista: Pisada[] }>;
  areasProtegidas: Seccion<{ pisa: Pisada[]; cerca: Cercana[] }>;
  microcuencas: Seccion<{ pisa: Pisada[] }>;
  forestal: Seccion<{ pisa: Pisada[] }>;
  rios: Seccion<{ kmDentro: number; tramos: Array<{ nombre: string | null; km: number }>; masCercano: Cercana | null }>;
  poblados: Seccion<{ dentro: number; cerca: number; lista: Poblado[]; porTipo: Array<{ tipo: Poblado['tipo']; dentro: number; cerca: number }>; poblacionDentro: number | null }>;
  carretera: Seccion<{ km: number | null; franja: boolean }>;
  zonasInformales: Seccion<{ lista: Punto[] }>;
  ocurrencias: Seccion<{ lista: Punto[] }>;
  traslapes: Array<{ con: string; conId: number; hectareas: number; pct: number }>;
  /** Roles sin capa cargada: esos cruces no se hicieron. */
  faltan: RolCapa[];
  alertas: string[];
  ms: number;
};

/* ------------------------------------------------------------------ constantes */

/** Radio para áreas protegidas, zonas informales y ocurrencias. */
export const RADIO_LEJOS_M = 5000;
/** Radio para caseríos y aldeas: a dos kilómetros una voladura se oye y el polvo llega. */
export const RADIO_POBLADOS_M = 2000;

/** Cómo se dice cada rol en una frase, para «no cargada». */
export const NOMBRE_ROL: Record<RolCapa, string> = {
  rio: 'red hídrica',
  poblado: 'caseríos y aldeas',
  area_protegida: 'áreas protegidas',
  microcuenca: 'microcuencas declaradas',
  carretera: 'carreteras',
  municipio: 'municipios',
  departamento: 'departamentos',
  ocurrencia: 'yacimientos y ocurrencias',
  zona_informal: 'zonas de minería informal',
  forestal: 'patrimonio forestal',
};

/** Qué sección del entorno sale de qué rol. */
export const SECCIONES: Partial<Record<keyof Entorno, RolCapa>> = {
  municipios: 'municipio',
  departamentos: 'departamento',
  areasProtegidas: 'area_protegida',
  microcuencas: 'microcuenca',
  forestal: 'forestal',
  rios: 'rio',
  poblados: 'poblado',
  carretera: 'carretera',
  zonasInformales: 'zona_informal',
  ocurrencias: 'ocurrencia',
};

/* ------------------------------------------------------------------ SQL común */

/**
 * La concesión, una vez: su geometría, la misma en `geography`, su área y cuántos grados hay que
 * ampliar su caja para cubrir N metros a su latitud (un grado de longitud mide 107 km en Honduras,
 * no 111). Con eso el `&&` descarta por índice todo lo que no puede estar a menos de N metros.
 */
const C = (metros = 0) => `c AS (
  SELECT geom, geom::geography AS gg,
         ST_Expand(geom, ${metros} / (111320.0 * cos(radians(ST_Y(ST_Centroid(geom)))))) AS caja
    FROM concesion WHERE id = $1
)`;

/** Geometría reparable sin tocar la fila: un polígono roto en una capa no tumba el cruce. */
const VALIDA = `CASE WHEN ST_IsValid(e.geom) THEN e.geom ELSE ST_CollectionExtract(ST_MakeValid(e.geom), ST_Dimension(e.geom) + 1) END`;

/**
 * El nombre de una entidad. `entidad_geo.nombre` lo puso el cargador con la primera columna que
 * parecía un nombre (NOMBRE, NOM_…); si no encontró ninguna escribió «entidad 17» o el CÓDIGO del
 * rasgo («0801»), y ninguna de las dos cosas es un nombre. Entonces se busca en los atributos del
 * .dbf una columna del oficio de la capa (MUNICIPIO, CASERIO, NOM_RIO…) cuyo valor tenga letras.
 */
const CLAVES_NOMBRE: Partial<Record<RolCapa, string>> = {
  municipio: '^(nom_?mun|municip|munic|nombre|nom)',
  departamento: '^(nom_?dep|departam|depto|dpto|nombre|nom)',
  poblado: '^(nom_?cas|nom_?ald|caserio|aldea|nombre|nom|comunid|locali|name)',
  rio: '^(nom_?rio|nombre|nom|rio|quebrada|toponim|name)',
};
export const nombreDe = (rol: RolCapa) => `COALESCE(
  NULLIF(CASE WHEN e.nombre ~* '^entidad [0-9]+$' OR e.nombre !~ '[A-Za-zÁÉÍÓÚÑáéíóúñ]' THEN NULL ELSE trim(e.nombre) END, ''),
  (SELECT trim(a.v) FROM jsonb_each_text(e.atributos) AS a(k, v)
    WHERE a.k ~* '${CLAVES_NOMBRE[rol] || '^(nombre|nom|name|denomin)'}' AND a.v ~ '[A-Za-zÁÉÍÓÚÑáéíóúñ]' LIMIT 1)
)`;

/** Población, si el .dbf la trae (POB_TOTAL, POBLACION, HABITANTES…) y es un número. */
const POBLACION = `(SELECT replace(a.v, ',', '.')::numeric FROM jsonb_each_text(e.atributos) AS a(k, v)
  WHERE a.k ~* '^(pob|poblac|habitan|hab_|total_?pob)' AND trim(a.v) ~ '^[0-9]+([.,][0-9]+)?$' LIMIT 1)`;

/** Un dato de una ocurrencia que ayude a leerla: mineral, sustancia o tipo. */
const DETALLE = `(SELECT trim(a.v) FROM jsonb_each_text(e.atributos) AS a(k, v)
  WHERE a.k ~* '^(mineral|sustanc|commod|element|recurso|metal|tipo)' AND a.v ~ '[A-Za-z]' LIMIT 1)`;

/* ------------------------------------------------------------------ capas por rol */

type CapaRol = { id: number; nombre: string; rol: RolCapa };

/**
 * Las capas de geografía con su rol. Si la base todavía no tiene la v7 (el código llegó antes que
 * el esquema), el rol se calcula aquí con el mismo patrón que usaría la base.
 */
export async function capasPorRol(): Promise<CapaRol[]> {
  const tiene = await baseTieneRol();
  const filas = await consulta<{ id: string; nombre: string; rol: string | null }>(
    `SELECT id::text, nombre, ${tiene ? 'rol' : 'NULL::text AS rol'}
       FROM capa WHERE EXISTS (SELECT 1 FROM entidad_geo e WHERE e.capa_id = capa.id)`
  );
  return filas
    .map((f) => ({ id: Number(f.id), nombre: f.nombre, rol: (tiene ? f.rol : rolDeCapa(f.nombre)) as RolCapa | null }))
    .filter((f): f is CapaRol => !!f.rol);
}

/* ------------------------------------------------------------------ utilidades */

const num = (x: unknown) => (x == null ? null : Number(x));
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Una sección que no puede colgar la ficha: si tarda más de lo razonable, se dice. */
async function seccion<T>(ids: number[], fn: () => Promise<T>, msMax = 8000): Promise<Seccion<T>> {
  if (!ids.length) return { estado: 'no-cargada' };
  let reloj: NodeJS.Timeout | undefined;
  try {
    const datos = await Promise.race([
      fn(),
      new Promise<never>((_, no) => {
        reloj = setTimeout(() => no(new Error(`tardó más de ${msMax / 1000} s`)), msMax);
      }),
    ]);
    return { estado: 'ok', ...datos } as Seccion<T>;
  } catch (e: any) {
    return { estado: 'error', motivo: String(e?.message || e).slice(0, 160) };
  } finally {
    clearTimeout(reloj);
  }
}

/** Polígonos que pisa: hectáreas y porcentaje de la concesión, por nombre. */
async function pisadas(id: number, capas: number[], rol: RolCapa, haConcesion: number): Promise<Pisada[]> {
  /*
   * Se une por nombre ANTES de medir: dos rasgos del mismo área protegida que se solapan (pasa con
   * capas digitalizadas por partes) contarían dos veces la misma hectárea y la ficha diría que la
   * concesión pisa más de lo que mide. Y se mide con TODOS los rasgos que la tocan: un LIMIT antes
   * de unir dejaba fuera nombres y hectáreas cuando eran muchos (revisión de Codex en #38); lo
   * único que se limita es la lista que se enseña.
   */
  const filas = await consulta<{ nombre: string | null; ha: number }>(
    `WITH ${C()},
     t AS (
       SELECT ${nombreDe(rol)} AS nombre, ${VALIDA} AS g
         FROM entidad_geo e, c
        WHERE e.capa_id = ANY($2) AND e.geom && c.geom AND ST_Dimension(e.geom) = 2
          AND ST_Intersects(${VALIDA}, c.geom)
     )
     SELECT t.nombre, (ST_Area(ST_Intersection((SELECT geom FROM c), ST_Union(t.g))::geography) / 10000.0)::float8 AS ha
       FROM t GROUP BY t.nombre
      ORDER BY ha DESC LIMIT 12`,
    [id, capas]
  );
  return filas
    .filter((f) => f.ha >= 0.01)
    .map((f) => ({ nombre: f.nombre || 'sin nombre en la capa', ha: r2(f.ha), pct: haConcesion > 0 ? (f.ha / haConcesion) * 100 : 0 }));
}

/* ------------------------------------------------------------------ el entorno */

/**
 * El entorno completo de una concesión. Devuelve null si no existe o no tiene superficie.
 */
export async function entornoDe(idPedido: number | string): Promise<Entorno | null> {
  if (!hayBase()) return null;
  // Quien llama con una fila de pg trae el id como texto (bigint): se normaliza aquí, una vez.
  const id = Number(idPedido);
  const t0 = Date.now();

  const [c] = await consulta<{ nombre: string; m2: number; vacia: boolean }>(
    `SELECT nombre, ST_Area(geom::geography)::float8 AS m2, ST_IsEmpty(geom) AS vacia FROM concesion WHERE id = $1`,
    [id]
  );
  if (!c || c.vacia) return null;
  const ha = c.m2 / 10000;

  const capas = await capasPorRol();
  const de = (rol: RolCapa) => capas.filter((x) => x.rol === rol).map((x) => x.id);
  const nombres: Partial<Record<RolCapa, string[]>> = {};
  for (const x of capas) (nombres[x.rol] ||= []).push(x.nombre);
  const tipoDeCapa = new Map(
    capas.filter((x) => x.rol === 'poblado').map((x) => {
      const n = rolDeCapaNormal(x.nombre);
      return [x.id, (/caserio/.test(n) ? 'caserío' : /aldea/.test(n) ? 'aldea' : 'poblado') as Poblado['tipo']];
    })
  );

  const [municipios, departamentos, areasProtegidas, microcuencas, forestal, rios, poblados, carretera, zonasInformales, ocurrencias, traslapes] =
    await Promise.all([
      seccion(de('municipio'), async () => ({ lista: await pisadas(id, de('municipio'), 'municipio', ha) })),
      seccion(de('departamento'), async () => ({ lista: await pisadas(id, de('departamento'), 'departamento', ha) })),

      seccion(de('area_protegida'), async () => {
        const [pisa, cerca] = await Promise.all([
          pisadas(id, de('area_protegida'), 'area_protegida', ha),
          consulta<{ nombre: string | null; km: number }>(
            `WITH ${C(RADIO_LEJOS_M)}
             SELECT nombre, min(m)::float8 / 1000.0 AS km FROM (
               SELECT ${nombreDe('area_protegida')} AS nombre, ST_Distance(e.geom::geography, c.gg) AS m
                 FROM entidad_geo e, c
                WHERE e.capa_id = ANY($2) AND e.geom && c.caja
                  AND ST_DWithin(e.geom::geography, c.gg, ${RADIO_LEJOS_M})
             ) t GROUP BY nombre ORDER BY km LIMIT 12`,
            [id, de('area_protegida')]
          ),
        ]);
        const pisadasN = new Set(pisa.map((p) => p.nombre));
        return {
          pisa,
          cerca: cerca
            .filter((x) => x.km > 0 && !pisadasN.has(x.nombre || 'sin nombre en la capa'))
            .map((x) => ({ nombre: x.nombre || 'sin nombre en la capa', km: r2(x.km) })),
        };
      }),

      seccion(de('microcuenca'), async () => ({ pisa: await pisadas(id, de('microcuenca'), 'microcuenca', ha) })),
      seccion(de('forestal'), async () => ({ pisa: await pisadas(id, de('forestal'), 'forestal', ha) })),

      seccion(de('rio'), async () => {
        /*
         * Kilómetros de cauce DENTRO: la intersección de cada línea con el polígono, medida sobre el
         * elipsoide. El total sale de una ventana sobre TODOS los grupos, antes del LIMIT: la lista
         * lleva los diez cauces más largos, la cifra lleva todos.
         */
        const tramos = await consulta<{ nombre: string | null; km: number; total: number }>(
          `WITH ${C()},
           t AS (
             SELECT ${nombreDe('rio')} AS nombre,
                    ST_Length(ST_Intersection(${VALIDA}, c.geom)::geography) / 1000.0 AS km
               FROM entidad_geo e, c
              WHERE e.capa_id = ANY($2) AND e.geom && c.geom AND ST_Dimension(e.geom) = 1
                AND ST_Intersects(e.geom, c.geom)
           ),
           g AS (SELECT nombre, sum(km) AS km FROM t GROUP BY nombre)
           SELECT nombre, km::float8, (sum(km) OVER ())::float8 AS total FROM g ORDER BY km DESC LIMIT 10`,
          [id, de('rio')]
        );
        const kmDentro = tramos.length ? r2(tramos[0].total) : 0;
        let masCercano: Cercana | null = null;
        if (kmDentro <= 0) {
          /*
           * Si no cruza ninguno, el más cercano. `<->` recorre el índice por distancia (en grados,
           * que para ordenar sirve); de los cinco primeros se mide de verdad en metros y gana el
           * menor, porque en grados un kilómetro al norte y uno al este no pesan igual.
           */
          const [r] = await consulta<{ nombre: string | null; km: number }>(
            `WITH cand AS (
               SELECT e.* FROM entidad_geo e
                WHERE e.capa_id = ANY($2) AND ST_Dimension(e.geom) = 1
                ORDER BY e.geom <-> (SELECT geom FROM concesion WHERE id = $1)
                LIMIT 5
             )
             SELECT ${nombreDe('rio')} AS nombre,
                    (ST_Distance(e.geom::geography, (SELECT geom::geography FROM concesion WHERE id = $1)) / 1000.0)::float8 AS km
               FROM cand e ORDER BY km LIMIT 1`,
            [id, de('rio')]
          );
          if (r) masCercano = { nombre: r.nombre || 'cauce sin nombre en la capa', km: r2(r.km) };
        }
        return {
          kmDentro,
          tramos: tramos.filter((x) => x.km >= 0.005).map((x) => ({ nombre: x.nombre, km: r2(x.km) })),
          masCercano,
        };
      }),

      seccion(de('poblado'), async () => {
        const ids = de('poblado');
        const [conteo, lista] = await Promise.all([
          consulta<{ capa_id: string; dentro: number; cerca: number; pob: number | null }>(
            `WITH ${C(RADIO_POBLADOS_M)}
             SELECT e.capa_id::text,
                    count(*) FILTER (WHERE ST_Intersects(e.geom, c.geom))::int AS dentro,
                    count(*) FILTER (WHERE NOT ST_Intersects(e.geom, c.geom))::int AS cerca,
                    sum(${POBLACION}) FILTER (WHERE ST_Intersects(e.geom, c.geom))::float8 AS pob
               FROM entidad_geo e, c
              WHERE e.capa_id = ANY($2) AND e.geom && c.caja
                AND ST_DWithin(e.geom::geography, c.gg, ${RADIO_POBLADOS_M})
              GROUP BY e.capa_id`,
            [id, ids]
          ),
          consulta<{ capa_id: string; nombre: string | null; km: number; dentro: boolean; pob: number | null }>(
            `WITH ${C(RADIO_POBLADOS_M)}
             SELECT e.capa_id::text, ${nombreDe('poblado')} AS nombre,
                    (ST_Distance(e.geom::geography, c.gg) / 1000.0)::float8 AS km,
                    ST_Intersects(e.geom, c.geom) AS dentro, ${POBLACION}::float8 AS pob
               FROM entidad_geo e, c
              WHERE e.capa_id = ANY($2) AND e.geom && c.caja
                AND ST_DWithin(e.geom::geography, c.gg, ${RADIO_POBLADOS_M})
              ORDER BY km LIMIT 40`,
            [id, ids]
          ),
        ]);
        const porTipo = new Map<Poblado['tipo'], { dentro: number; cerca: number }>();
        let pob: number | null = null;
        for (const f of conteo) {
          const tipo = tipoDeCapa.get(Number(f.capa_id)) || 'poblado';
          const t = porTipo.get(tipo) || { dentro: 0, cerca: 0 };
          t.dentro += f.dentro;
          t.cerca += f.cerca;
          porTipo.set(tipo, t);
          if (f.pob != null) pob = (pob || 0) + Number(f.pob);
        }
        return {
          dentro: conteo.reduce((n, f) => n + f.dentro, 0),
          cerca: conteo.reduce((n, f) => n + f.cerca, 0),
          porTipo: [...porTipo].map(([tipo, v]) => ({ tipo, ...v })),
          poblacionDentro: pob,
          lista: lista.map((f) => ({
            nombre: f.nombre || 'sin nombre en la capa',
            tipo: tipoDeCapa.get(Number(f.capa_id)) || 'poblado',
            km: f.dentro ? 0 : r2(f.km),
            dentro: f.dentro,
            poblacion: num(f.pob),
          })),
        };
      }),

      seccion(de('carretera'), async () => {
        // La capa del país es un «Buffer Carretera»: una franja, no el eje. Se dice cuál de las dos es.
        const [r] = await consulta<{ km: number; dim: number }>(
          `WITH cand AS (
             SELECT e.geom FROM entidad_geo e
              WHERE e.capa_id = ANY($2)
              ORDER BY e.geom <-> (SELECT geom FROM concesion WHERE id = $1)
              LIMIT 5
           )
           SELECT (ST_Distance(cand.geom::geography, (SELECT geom::geography FROM concesion WHERE id = $1)) / 1000.0)::float8 AS km,
                  ST_Dimension(cand.geom) AS dim
             FROM cand ORDER BY km LIMIT 1`,
          [id, de('carretera')]
        );
        return { km: r ? r2(r.km) : null, franja: r ? Number(r.dim) === 2 : false };
      }),

      seccion(de('zona_informal'), async () => ({ lista: await puntosCerca(id, de('zona_informal'), 'zona_informal') })),
      seccion(de('ocurrencia'), async () => ({ lista: await puntosCerca(id, de('ocurrencia'), 'ocurrencia') })),

      traslapesDe(id).catch(() => []),
    ]);

  const e: Entorno = {
    concesion: { id, nombre: c.nombre, hectareas: r2(ha) },
    capas: nombres,
    municipios,
    departamentos,
    areasProtegidas,
    microcuencas,
    forestal,
    rios,
    poblados,
    carretera,
    zonasInformales,
    ocurrencias,
    // `bigint` llega de pg como texto: se compara como número o «la otra» sale siendo ella misma.
    traslapes: traslapes.map((t) => ({
      con: Number(t.a_id) === id ? t.b : t.a,
      conId: Number(Number(t.a_id) === id ? t.b_id : t.a_id),
      hectareas: t.hectareas,
      pct: ha > 0 ? (t.hectareas / ha) * 100 : 0,
    })),
    faltan: (Object.keys(NOMBRE_ROL) as RolCapa[]).filter((r) => !de(r).length),
    alertas: [],
    ms: 0,
  };
  e.alertas = alertasDe(e);
  e.ms = Date.now() - t0;
  return e;
}

/** Zonas o puntos a menos de 5 km, marcando los que caen dentro. */
async function puntosCerca(id: number, capas: number[], rol: RolCapa): Promise<Punto[]> {
  const filas = await consulta<{ nombre: string | null; km: number; dentro: boolean; detalle: string | null }>(
    `WITH ${C(RADIO_LEJOS_M)}
     SELECT ${nombreDe(rol)} AS nombre, (ST_Distance(e.geom::geography, c.gg) / 1000.0)::float8 AS km,
            ST_Intersects(e.geom, c.geom) AS dentro, ${DETALLE} AS detalle
       FROM entidad_geo e, c
      WHERE e.capa_id = ANY($2) AND e.geom && c.caja
        AND ST_DWithin(e.geom::geography, c.gg, ${RADIO_LEJOS_M})
      ORDER BY km LIMIT 20`,
    [id, capas]
  );
  return filas.map((f) => ({ nombre: f.nombre || 'sin nombre en la capa', km: f.dentro ? 0 : r2(f.km), dentro: f.dentro, detalle: f.detalle }));
}

function rolDeCapaNormal(n: string): string {
  return n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/* ------------------------------------------------------------------ alertas */

const nf = (n: number, d = 1) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
/** Porcentaje como lo dice una persona: «8 %», «0,4 %», «menos del 0,1 %». */
export const pct = (p: number) => (p >= 10 ? `${Math.round(p)} %` : p >= 0.1 ? `${nf(p, 1)} %` : 'menos del 0,1 %');
const ha1 = (h: number) => `${nf(h, h >= 100 ? 0 : 1)} ha`;
const km1 = (k: number) => (k < 1 ? `${Math.round(k * 1000)} m` : `${nf(k, 1)} km`);
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const lista = (xs: string[], max = 4) => (xs.length > max ? `${xs.slice(0, max).join(', ')} y ${xs.length - max} más` : xs.join(', '));
const TIPO_PLURAL: Record<Poblado['tipo'], [string, string]> = { 'caserío': ['caserío', 'caseríos'], aldea: ['aldea', 'aldeas'], poblado: ['poblado', 'poblados'] };

/**
 * Las alertas en texto llano, de lo más grave a lo informativo. Son las frases que el doctor cita
 * y las que van arriba en la ficha; los números que llevan son los del objeto, formateados.
 */
export function alertasDe(e: Entorno): string[] {
  const a: string[] = [];

  if (e.areasProtegidas.estado === 'ok') {
    for (const p of e.areasProtegidas.pisa) a.push(`Pisa ${ha1(p.ha)} del área protegida ${p.nombre} (${pct(p.pct)} de la concesión).`);
    for (const p of e.areasProtegidas.cerca.slice(0, 3)) a.push(`A ${km1(p.km)} del área protegida ${p.nombre}.`);
  }
  if (e.microcuencas.estado === 'ok') {
    for (const p of e.microcuencas.pisa) a.push(`Microcuenca declarada ${p.nombre}: pisa ${ha1(p.ha)} (${pct(p.pct)} de la concesión).`);
  }
  if (e.poblados.estado === 'ok' && (e.poblados.dentro || e.poblados.cerca)) {
    const dentro = e.poblados.lista.filter((p) => p.dentro).map((p) => p.nombre);
    for (const t of e.poblados.porTipo) {
      const [uno, varios] = TIPO_PLURAL[t.tipo];
      if (t.dentro) {
        const suyos = e.poblados.lista.filter((p) => p.dentro && p.tipo === t.tipo).map((p) => p.nombre);
        a.push(`${plural(t.dentro, `${uno} dentro`, `${varios} dentro`)}${suyos.length ? ` (${lista(suyos)})` : ''}.`);
      }
      if (t.cerca) a.push(`${plural(t.cerca, uno, varios)} a menos de ${RADIO_POBLADOS_M / 1000} km del lindero.`);
    }
    if (dentro.length && e.poblados.poblacionDentro) a.push(`Población declarada dentro: ${nf(e.poblados.poblacionDentro, 0)} personas, según la capa.`);
  }
  if (e.forestal.estado === 'ok' && e.forestal.pisa.length) {
    const tot = e.forestal.pisa.reduce((n, p) => n + p.ha, 0);
    a.push(`Pisa ${ha1(tot)} de patrimonio público forestal (${lista(e.forestal.pisa.map((p) => p.nombre), 3)}).`);
  }
  if (e.rios.estado === 'ok' && e.rios.kmDentro > 0) {
    const con = e.rios.tramos.map((t) => t.nombre).filter((x): x is string => !!x);
    a.push(`Tiene ${km1(e.rios.kmDentro)} de cauces dentro${con.length ? ` (${lista(con, 3)})` : ''}.`);
  }
  if (e.zonasInformales.estado === 'ok') {
    const d = e.zonasInformales.lista.filter((z) => z.dentro);
    const c = e.zonasInformales.lista.filter((z) => !z.dentro);
    if (d.length) a.push(`Dentro de ${plural(d.length, 'zona de minería informal', 'zonas de minería informal')} (${lista(d.map((z) => z.nombre), 3)}).`);
    if (c.length) a.push(`${plural(c.length, 'zona de minería informal', 'zonas de minería informal')} a menos de ${RADIO_LEJOS_M / 1000} km; la más cercana, ${c[0].nombre}, a ${km1(c[0].km)}.`);
  }
  if (e.traslapes.length) {
    a.push(`Se pisa con ${plural(e.traslapes.length, 'otro derecho', 'otros derechos')}: ${lista(e.traslapes.map((t) => `${t.con} (${ha1(t.hectareas)})`), 3)}.`);
  }
  if (e.ocurrencias.estado === 'ok' && e.ocurrencias.lista.length) {
    const d = e.ocurrencias.lista.filter((o) => o.dentro).length;
    a.push(
      `${plural(e.ocurrencias.lista.length, 'yacimiento u ocurrencia registrada', 'yacimientos u ocurrencias registradas')} a menos de ${RADIO_LEJOS_M / 1000} km${d ? `, ${d} dentro` : ''}.`
    );
  }
  return a;
}

/* ------------------------------------------------------------------ en texto */

/**
 * El entorno en texto corto, para que el modelo lo cite. Dice de qué capa sale cada cosa y qué capa
 * falta, para que no se le ocurra rellenar lo que no se cruzó.
 */
export function entornoEnTexto(e: Entorno): string {
  const partes: string[] = [`Entorno de ${e.concesion.nombre} (id ${e.concesion.id}, ${nf(e.concesion.hectareas, 2)} ha medidas).`];
  const lugar = (s: Entorno['municipios']) => (s.estado === 'ok' ? s.lista.map((m) => m.nombre).join(', ') || 'ninguno' : null);
  const mun = lugar(e.municipios);
  const dep = lugar(e.departamentos);
  if (mun || dep) partes.push(`Está en ${[mun && `municipio(s) ${mun}`, dep && `departamento(s) ${dep}`].filter(Boolean).join('; ')}.`);
  if (e.alertas.length) partes.push(`Alertas: ${e.alertas.join(' ')}`);
  else partes.push('Sin alertas en las capas cargadas.');
  if (e.rios.estado === 'ok' && e.rios.kmDentro <= 0 && e.rios.masCercano) partes.push(`No cruza cauces; el más cercano, ${e.rios.masCercano.nombre}, a ${km1(e.rios.masCercano.km)}.`);
  if (e.carretera.estado === 'ok' && e.carretera.km != null) {
    partes.push(
      e.carretera.km === 0
        ? `La ${e.carretera.franja ? 'franja de carretera' : 'carretera'} toca la concesión.`
        : `Carretera más cercana a ${km1(e.carretera.km)}${e.carretera.franja ? ' (medido al borde de la franja de la capa, no al eje)' : ''}.`
    );
  }
  const errores = (Object.entries(SECCIONES) as Array<[keyof Entorno, RolCapa]>)
    .map(([k, rol]) => [rol, e[k]] as const)
    .filter(([, v]) => (v as Seccion<object>).estado === 'error')
    .map(([rol, v]) => `${NOMBRE_ROL[rol]} (${(v as { motivo: string }).motivo})`);
  if (errores.length) partes.push(`No se pudo cruzar: ${errores.join('; ')}.`);
  if (e.faltan.length) partes.push(`Capas NO cargadas (no afirmes nada de ellas): ${e.faltan.map((r) => NOMBRE_ROL[r]).join(', ')}.`);
  return partes.join(' ');
}
