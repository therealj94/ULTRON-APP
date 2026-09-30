/**
 * LA GEOLOGÍA DE UNA ZONA — rocas, intrusivos, fallas, rumbos, tectónica y yacimientos, cruzados en
 * PostGIS con las capas de geología (esquema v8: litologia, falla, placa, provincia_geologica,
 * tracto_permisivo) y las de yacimientos (ocurrencia).
 *
 * La zona puede ser una concesión, cualquier capa cargada (los polígonos de un proyecto: «Tule»,
 * «MINAS DE ORO I»), un municipio o un punto con radio.
 *
 * Lo que esto NO hace, y dice: no encuentra recursos. Encuentra INDICIOS —las condiciones que en
 * Honduras acompañan a los yacimientos conocidos: un plutón, su contacto con calizas, fallas que
 * se cruzan, un tracto que el USGS considera permisivo, minas cerca— y dice de dónde sale cada uno.
 * El mapa geológico cargado es regional (1:2 500 000, ±1,6 km): sirve para saber qué mirar, no
 * para decidir dentro de una concesión. Eso lo pide la cartografía 1:50 000, el muestreo y la
 * geoquímica, y la conclusión lo recuerda siempre.
 *
 * Los rumbos se miden sobre el elipsoide (rumbo inicial de cada segmento, ponderado por su largo),
 * no en una cuadrícula UTM: Honduras cae en dos zonas y la convergencia torcería las rosetas.
 */
import type { Geometry, Position } from 'geojson';
import { conTextoReparado, consultaConTope, hayBase, type RolCapa } from './db';
import { capasPorRol, nombreDe } from './entorno';
import { sqlCapaVisible } from './organizacion';

const TOPE_MS = 10000;
const consulta = <T = any>(sql: string, params: unknown[] = []) => consultaConTope<T>(sql, params, TOPE_MS).then(conTextoReparado);

/* ------------------------------------------------------------------ tipos */

export type Zona = {
  concesion?: number | string;
  /** Nombre de una capa cargada: sus polígonos, unidos, son la zona. */
  capa?: string;
  municipio?: string;
  lon?: number;
  lat?: number;
  /** Radio del entorno que se mira alrededor, y del círculo si la zona es un punto. */
  radioKm?: number;
};

export type ClaseRoca = 'intrusiva' | 'volcanica' | 'sedimentaria' | 'metamorfica' | 'ultramafica' | 'aluvial' | 'otra';

export type Unidad = { unidad: string; descripcion: string; edad: string; clase: ClaseRoca; ha: number; pct: number; km: number; capa: string };
export type Falla = { nombre: string; tipo: string; activa: boolean; certeza: string; capa: string; kmDentro: number; km: number };
export type Familia = { desde: number; hasta: number; peso: number; rumbo: string };
export type Yacimiento = { nombre: string; mineral: string; tipo: string; estado: string; capa: string; km: number; dentro: boolean };
export type Criterio = { clave: string; cumple: boolean; puntos: number; evidencia: string; modelos: string[] };

export type Geologia = {
  zona: { nombre: string; tipo: 'concesión' | 'capa' | 'municipio' | 'punto'; id?: number; ha: number; lon: number; lat: number; geojson: Geometry };
  radioKm: number;
  /** Qué capas se usaron para cada rol: la fuente de cada cifra. */
  fuentes: Partial<Record<RolCapa, string[]>>;
  /** Roles de geología sin capa cargada: se dicen, no se callan. */
  faltan: string[];
  escala: string | null;
  litologia: { dentro: Unidad[]; cerca: Unidad[]; coberturaPct: number };
  intrusivos: { dentro: Unidad[]; cerca: Unidad[]; kmContactoDentro: number; kmAlContacto: number | null; kmContactoCarbonato: number };
  fallas: {
    dentro: Falla[];
    cerca: Falla[];
    kmDentro: number;
    densidad: number | null;
    rumbos: { bins: number[]; dominante: string | null; concentracion: number; familias: Familia[]; kmMedidos: number };
    intersecciones: Array<[number, number]>;
    activaMasCercana: Falla | null;
  };
  tectonica: { placas: Array<{ nombre: string; tipo: string; km: number }>; provincias: Array<{ nombre: string; pct: number }> };
  recursos: {
    tractos: Array<{ nombre: string; geologia: string; edad: string; esperados: string; p50: string; p10: string; conocidos: string; pct: number }>;
    yacimientos: Yacimiento[];
    porMineral: Array<{ mineral: string; n: number }>;
    porTipo: Array<{ tipo: string; n: number }>;
  };
  indicios: { nivel: 'alto' | 'medio' | 'bajo' | 'sin indicios'; puntos: number; criterios: Criterio[]; modelos: string[] };
  ms: number;
};

export const NOMBRE_ROL_GEO: Record<string, string> = {
  litologia: 'mapa geológico (unidades de roca)',
  falla: 'fallas',
  placa: 'límites de placa',
  provincia_geologica: 'provincias geológicas',
  tracto_permisivo: 'tractos permisivos',
  ocurrencia: 'yacimientos y ocurrencias',
};

/* ------------------------------------------------------------------ utilidades */

const r2 = (x: number) => Math.round(x * 100) / 100;
const n = (x: unknown) => (x == null || x === '' ? null : Number(x));
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** La clase de una roca por lo que dice su descripción, para capas que no traen CLASE_ROCA. */
export function claseDeRoca(texto: string): ClaseRoca {
  const d = norm(texto);
  if (/plut|intrus|granit|diorit|tonalit|batolit|pluton/.test(d)) return 'intrusiva';
  if (/ultramafic|serpentin|peridot|ofiolit|ophiolit/.test(d)) return 'ultramafica';
  if (/volcan|pirocl|pyroclast|toba|tuff|basalt|andesit|riolit|ignimbrit/.test(d)) return 'volcanica';
  if (/metamorf|metamorph|esquist|schist|gneis|filit|marmol|marble|cuarcit/.test(d)) return 'metamorfica';
  if (/aluvi|alluvi/.test(d)) return 'aluvial';
  if (/estrat|strata|sediment|caliz|limestone|lutit|arenisc|conglomer|deposit|marin|carbonat/.test(d)) return 'sedimentaria';
  return 'otra';
}

const CLASES: ClaseRoca[] = ['intrusiva', 'volcanica', 'sedimentaria', 'metamorfica', 'ultramafica', 'aluvial', 'otra'];
const aClase = (cl: string, texto: string): ClaseRoca => (CLASES.includes(cl as ClaseRoca) ? (cl as ClaseRoca) : claseDeRoca(texto));

/** Rumbo de un eje (0–180) como se escribe en geología: 45 → «N45°E», 135 → «N45°W». */
export function rumboTexto(az: number): string {
  const a = ((az % 180) + 180) % 180;
  const g = Math.round(a);
  if (g === 0 || g === 180) return 'N–S';
  if (g === 90) return 'E–W';
  return g < 90 ? `N${g}°E` : `N${180 - g}°W`;
}

const RAD = Math.PI / 180;
/** Rumbo inicial (0–360) y largo en km de un segmento, sobre la esfera de radio medio. */
function segmento(a: Position, b: Position): { az: number; km: number } {
  const [l1, f1] = [a[0] * RAD, a[1] * RAD];
  const [l2, f2] = [b[0] * RAD, b[1] * RAD];
  const y = Math.sin(l2 - l1) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(l2 - l1);
  const az = (Math.atan2(y, x) / RAD + 360) % 360;
  const h = Math.sin((f2 - f1) / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin((l2 - l1) / 2) ** 2;
  return { az, km: 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h))) };
}

function lineas(g: Geometry | null): Position[][] {
  if (!g) return [];
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(lineas);
  return [];
}

/**
 * La roseta: 18 clases de 10° (datos axiales, 0–180°) ponderadas por largo; la dirección media por
 * ángulo doble (para ejes, promediar 10° y 170° da 0°, no 90°); la concentración es la longitud
 * del vector medio (0 = sin dirección preferente, 1 = todas paralelas); y las familias son los
 * picos que se llevan al menos el 12 % del largo medido.
 */
export function roseta(geoms: Array<Geometry | null>): Geologia['fallas']['rumbos'] {
  const bins = new Array(18).fill(0);
  let s = 0, c = 0, total = 0;
  for (const g of geoms) {
    for (const l of lineas(g)) {
      for (let i = 1; i < l.length; i++) {
        const { az, km } = segmento(l[i - 1], l[i]);
        if (!(km > 0)) continue;
        const ax = az % 180;
        bins[Math.min(17, Math.floor(ax / 10))] += km;
        s += km * Math.sin(2 * ax * RAD);
        c += km * Math.cos(2 * ax * RAD);
        total += km;
      }
    }
  }
  if (!total) return { bins, dominante: null, concentracion: 0, familias: [], kmMedidos: 0 };
  const media = ((Math.atan2(s, c) / RAD / 2) + 180) % 180;
  const familias: Familia[] = [];
  for (let i = 0; i < 18; i++) {
    const prev = bins[(i + 17) % 18];
    const next = bins[(i + 1) % 18];
    if (bins[i] / total >= 0.12 && bins[i] >= prev && bins[i] >= next) {
      familias.push({ desde: i * 10, hasta: i * 10 + 10, peso: r2(bins[i] / total), rumbo: `${rumboTexto(i * 10 + 5)} (${rumboTexto(i * 10)} a ${rumboTexto(i * 10 + 10)})` });
    }
  }
  familias.sort((a, b) => b.peso - a.peso);
  return { bins: bins.map(r2), dominante: rumboTexto(media), concentracion: r2(Math.hypot(s, c) / total), familias: familias.slice(0, 3), kmMedidos: r2(total) };
}

/* ------------------------------------------------------------------ la zona */

type ZonaResuelta = Geologia['zona'];

/** La geometría de la zona. La concesión primero, después una capa, un municipio y por último un punto. */
export async function resolverZona(z: Zona): Promise<ZonaResuelta | { error: string }> {
  const radioM = Math.max(500, Math.min(50000, (z.radioKm ?? 5) * 1000));
  const fila = (sql: string, params: unknown[]) =>
    consulta<{ nombre: string; g: string; ha: number; lon: number; lat: number }>(
      `SELECT nombre, ST_AsGeoJSON(g, 6) AS g, (ST_Area(g::geography) / 10000.0)::float8 AS ha,
              ST_X(ST_PointOnSurface(g))::float8 AS lon, ST_Y(ST_PointOnSurface(g))::float8 AS lat
         FROM (${sql}) t WHERE g IS NOT NULL AND NOT ST_IsEmpty(g) LIMIT 1`,
      params
    );
  if (z.concesion != null && String(z.concesion).trim()) {
    const id = Number(z.concesion);
    const [f] = Number.isSafeInteger(id) && id > 0
      ? await fila(`SELECT nombre, geom AS g FROM concesion WHERE id = $1`, [id])
      : await fila(
          `SELECT nombre, geom AS g FROM concesion WHERE nombre ILIKE '%' || $1 || '%' OR expediente = $1
            ORDER BY (lower(nombre) = lower($1)) DESC, length(nombre) LIMIT 1`,
          [String(z.concesion).trim()]
        );
    if (!f) return { error: `No encuentro la concesión «${z.concesion}» en el catastro.` };
    // El id, para lo que se guarda por concesión (el satélite): la misma búsqueda, el mismo orden.
    const idC =
      Number.isSafeInteger(id) && id > 0
        ? id
        : Number(
            (
              await consulta<{ id: string }>(
                `SELECT id::text FROM concesion WHERE nombre ILIKE '%' || $1 || '%' OR expediente = $1
                  ORDER BY (lower(nombre) = lower($1)) DESC, length(nombre) LIMIT 1`,
                [String(z.concesion).trim()]
              )
            )[0]?.id
          ) || undefined;
    return { nombre: f.nombre, tipo: 'concesión', id: idC, ha: r2(f.ha), lon: f.lon, lat: f.lat, geojson: JSON.parse(f.g) };
  }
  if (z.capa && z.capa.trim()) {
    const [f] = await fila(
      `SELECT k.nombre, (SELECT ST_Union(e.geom) FROM entidad_geo e WHERE e.capa_id = k.id AND GeometryType(e.geom) ~ 'POLYGON') AS g
         FROM capa k WHERE k.nombre ILIKE '%' || $1 || '%'${sqlCapaVisible('k')}
        ORDER BY (lower(k.nombre) = lower($1)) DESC, length(k.nombre) LIMIT 1`,
      [z.capa.trim()]
    );
    if (!f) return { error: `No encuentro una capa con polígonos que se llame «${z.capa}».` };
    return { nombre: f.nombre, tipo: 'capa', ha: r2(f.ha), lon: f.lon, lat: f.lat, geojson: JSON.parse(f.g) };
  }
  if (z.municipio && z.municipio.trim()) {
    const ids = (await capasPorRol()).filter((x) => x.rol === 'municipio').map((x) => x.id);
    if (!ids.length) return { error: 'No hay capa de municipios cargada.' };
    const [f] = await fila(
      `SELECT ${nombreDe('municipio')} AS nombre, e.geom AS g FROM entidad_geo e
        WHERE e.capa_id = ANY($2) AND unaccent(lower(${nombreDe('municipio')})) = unaccent(lower($1))`,
      [z.municipio.trim(), ids]
    );
    if (!f) return { error: `No encuentro el municipio «${z.municipio}».` };
    return { nombre: `municipio de ${f.nombre}`, tipo: 'municipio', ha: r2(f.ha), lon: f.lon, lat: f.lat, geojson: JSON.parse(f.g) };
  }
  if (z.lon != null && z.lat != null && isFinite(z.lon) && isFinite(z.lat)) {
    if (Math.abs(z.lat) > 90 || Math.abs(z.lon) > 180) return { error: 'Esas coordenadas no son grados de longitud y latitud.' };
    const [f] = await fila(`SELECT 'punto' AS nombre, ST_Buffer(ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)::geometry AS g`, [z.lon, z.lat, radioM]);
    return {
      nombre: `punto ${z.lat.toFixed(4)}, ${z.lon.toFixed(4)} (radio ${r2(radioM / 1000)} km)`,
      tipo: 'punto', ha: r2(f.ha), lon: z.lon, lat: z.lat, geojson: JSON.parse(f.g),
    };
  }
  return { error: 'Decime la zona: una concesión, una capa, un municipio o unas coordenadas.' };
}

/* ------------------------------------------------------------------ SQL */

const Z = (radio: string) => `z AS (
  SELECT g, g::geography AS gg,
         ST_Expand(g, ${radio} / (111320.0 * cos(radians(ST_Y(ST_PointOnSurface(g)))))) AS caja
    FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g) s
)`;
const VALIDA = `CASE WHEN ST_IsValid(e.geom) THEN e.geom ELSE ST_CollectionExtract(ST_MakeValid(e.geom), ST_Dimension(e.geom) + 1) END`;
const TEXTO_UNIDAD = `(coalesce(e.atributos->>'DESCRIPCION', '') || ' ' || coalesce(e.atributos->>'DESCRIPCION_ORIGINAL', '') || ' ' || coalesce(e.nombre, ''))`;
const ES_INTRUSIVA = `(coalesce(e.atributos->>'CLASE_ROCA', '') = 'intrusiva' OR (coalesce(e.atributos->>'CLASE_ROCA', '') = '' AND ${TEXTO_UNIDAD} ~* 'plut|intrus|granit|diorit|tonalit|batolit'))`;
const ES_CARBONATO = `(coalesce(e.atributos->>'CLASE_ROCA', 'sedimentaria') IN ('sedimentaria', '') AND ${TEXTO_UNIDAD} ~* 'caliz|carbonat|limestone|marin')`;
const ATR = (patron: string) => `(SELECT trim(a.v) FROM jsonb_each_text(e.atributos) AS a(k, v) WHERE a.k ~* '${patron}' AND a.v ~ '[A-Za-z]' LIMIT 1)`;
/*
 * El nombre de una unidad de roca. Los mapas geológicos locales (Minas de Oro, Olancho, La Lola…)
 * no traen UNIDAD/DESCRIPCION como los de data/geologia, y la unidad salía «entidad 61» o «0 0»: el
 * nombre de relleno del cargador o un código vacío. Solo vale un texto con letras; si no hay, se busca
 * en los campos con que esos mapas suelen llamarla.
 */
const CON_LETRA = (x: string) => `(CASE WHEN ${x} ~ '[A-Za-z]' AND ${x} !~ '^entidad [0-9]+$' THEN trim(${x}) END)`;
const ATR_UNIDAD = '^(unidad|unit|simbol|símbol|symbol|sigla|cod_?geo|glg|formac|litolog|lithol)';
const ATR_DESCRIPCION = '^(descrip|desc_|litolog|lithol|tipo_?roca|roca|rock|formac)';

/* ------------------------------------------------------------------ el análisis */

export async function geologiaDe(z: Zona): Promise<Geologia | { error: string }> {
  if (!hayBase()) return { error: 'El catastro no está conectado.' };
  const t0 = Date.now();
  const zona = await resolverZona(z);
  if ('error' in zona) return zona;
  const radioKm = Math.max(1, Math.min(50, z.radioKm ?? 10));
  /*
   * Si la zona es un punto, ya ES el círculo de ese radio: sumarle otro entorno del mismo radio
   * miraba hasta el doble de lejos y daba distancias medidas desde el borde del círculo, no desde el
   * punto (revisión de Codex en #41). Para un punto, «cerca» es «dentro del círculo».
   */
  const R = zona.tipo === 'punto' ? 0 : radioKm * 1000;

  const capas = await capasPorRol();
  const de = (rol: RolCapa) => capas.filter((x) => x.rol === rol).map((x) => x.id);
  const fuentes: Geologia['fuentes'] = {};
  for (const x of capas) if (['litologia', 'falla', 'placa', 'provincia_geologica', 'tracto_permisivo', 'ocurrencia'].includes(x.rol)) (fuentes[x.rol] ||= []).push(x.nombre);
  const faltan = (['litologia', 'falla', 'placa', 'tracto_permisivo', 'ocurrencia'] as RolCapa[]).filter((r) => !de(r).length).map((r) => NOMBRE_ROL_GEO[r]);
  const G = JSON.stringify(zona.geojson);
  const vacio = <T>(v: T) => Promise.resolve(v);

  const [unidades, contacto, fallas, cruces, activas, placas, provincias, tractos, yac, escala] = await Promise.all([
    de('litologia').length
      ? consulta<{ u: string; d: string; ed: string; cl: string; capa: string; ha: number; km: number }>(
          `WITH ${Z('$3')},
           t AS (
             SELECT coalesce(${CON_LETRA(`e.atributos->>'UNIDAD'`)}, ${ATR(ATR_UNIDAD)}, ${CON_LETRA('e.nombre')}, 'sin nombre') AS u,
                    coalesce(${CON_LETRA(`e.atributos->>'DESCRIPCION'`)}, ${ATR(ATR_DESCRIPCION)}, '') AS d,
                    coalesce(e.atributos->>'EDAD', '') AS ed, coalesce(e.atributos->>'CLASE_ROCA', '') AS cl,
                    k.nombre AS capa, ${VALIDA} AS g
               FROM entidad_geo e JOIN capa k ON k.id = e.capa_id, z
              WHERE e.capa_id = ANY($2) AND e.geom && z.caja AND ST_DWithin(e.geom::geography, z.gg, $3))
           SELECT u, d, ed, cl, capa,
                  (ST_Area(ST_Intersection(ST_Union(t.g), (SELECT g FROM z))::geography) / 10000.0)::float8 AS ha,
                  (min(ST_Distance(t.g::geography, (SELECT gg FROM z))) / 1000.0)::float8 AS km
             FROM t GROUP BY u, d, ed, cl, capa ORDER BY ha DESC, km`,
          [G, de('litologia'), R]
        )
      : vacio([]),
    de('litologia').length
      ? consulta<{ dentro: number | null; al: number | null; skarn: number | null }>(
          `WITH ${Z('$3')}, zb AS (SELECT ST_Buffer(z.gg, $3)::geometry AS g FROM z),
           i AS (SELECT ST_Union(${VALIDA}) AS g FROM entidad_geo e, zb WHERE e.capa_id = ANY($2) AND e.geom && zb.g AND ST_Intersects(e.geom, zb.g) AND ${ES_INTRUSIVA}),
           c AS (SELECT ST_Union(${VALIDA}) AS g FROM entidad_geo e, zb WHERE e.capa_id = ANY($2) AND e.geom && zb.g AND ST_Intersects(e.geom, zb.g) AND ${ES_CARBONATO})
           SELECT (SELECT ST_Length(ST_Intersection(ST_Boundary(i.g), z.g)::geography) / 1000.0 FROM i, z WHERE i.g IS NOT NULL)::float8 AS dentro,
                  (SELECT ST_Distance(ST_Boundary(i.g)::geography, z.gg) / 1000.0 FROM i, z WHERE i.g IS NOT NULL)::float8 AS al,
                  (SELECT ST_Length(ST_Intersection(ST_Intersection(ST_Boundary(i.g), ST_Buffer(c.g::geography, 300)::geometry), zb.g)::geography) / 1000.0
                     FROM i, c, zb WHERE i.g IS NOT NULL AND c.g IS NOT NULL)::float8 AS skarn`,
          [G, de('litologia'), R]
        )
      : vacio([]),
    de('falla').length
      ? consulta<{ nombre: string | null; tipo: string; activa: string; certeza: string; capa: string; km_dentro: number; km: number; g: string | null }>(
          `WITH ${Z('$3')}
           SELECT ${nombreDe('falla')} AS nombre, coalesce(e.atributos->>'TIPO', ${ATR('^(tipo|type|clase|slip)')}, '') AS tipo,
                  coalesce(e.atributos->>'ACTIVA', '') AS activa, coalesce(e.atributos->>'CERTEZA', '') AS certeza, k.nombre AS capa,
                  (ST_Length(ST_Intersection(e.geom, z.g)::geography) / 1000.0)::float8 AS km_dentro,
                  (ST_Distance(e.geom::geography, z.gg) / 1000.0)::float8 AS km,
                  ST_AsGeoJSON(ST_Intersection(e.geom, ST_Buffer(z.gg, $3)::geometry), 5) AS g
             FROM entidad_geo e JOIN capa k ON k.id = e.capa_id, z
            WHERE e.capa_id = ANY($2) AND e.geom && z.caja AND ST_DWithin(e.geom::geography, z.gg, $3)
            ORDER BY km, km_dentro DESC LIMIT 400`,
          [G, de('falla'), R]
        )
      : vacio([]),
    /*
     * Cruces de fallas dentro del radio, de la MISMA fuente: el trazo de Motagua en el USGS y en
     * GEM es la misma falla dibujada dos veces, y cruzarlos entre sí daría cientos de «cruces» a lo
     * largo de su traza. Los puntos a menos de 500 m se cuentan una vez.
     */
    de('falla').length
      ? consulta<{ lon: number; lat: number }>(
          `WITH ${Z('$3')}, zb AS (SELECT ST_Buffer(z.gg, $3)::geometry AS g FROM z),
           f AS (SELECT e.id, e.capa_id, ST_Intersection(e.geom, zb.g) AS g FROM entidad_geo e, zb
                  WHERE e.capa_id = ANY($2) AND e.geom && zb.g AND ST_Intersects(e.geom, zb.g)),
           p AS (SELECT (ST_Dump(ST_Intersection(a.g, b.g))).geom AS p FROM f a JOIN f b
                   ON a.capa_id = b.capa_id AND a.id < b.id AND ST_Intersects(a.g, b.g))
           SELECT ST_X(ST_Centroid(ST_Collect(p)))::float8 AS lon, ST_Y(ST_Centroid(ST_Collect(p)))::float8 AS lat
             FROM (SELECT p, ST_ClusterDBSCAN(ST_Transform(p, 32616), 500, 1) OVER () AS grupo FROM p WHERE GeometryType(p) = 'POINT') s
            GROUP BY grupo LIMIT 200`,
          [G, de('falla'), R]
        )
      : vacio([]),
    de('falla').length
      ? consulta<{ nombre: string | null; tipo: string; capa: string; km: number }>(
          `WITH ${Z('0')}
           SELECT nombre, tipo, capa, (ST_Distance(g::geography, (SELECT gg FROM z)) / 1000.0)::float8 AS km FROM (
             SELECT ${nombreDe('falla')} AS nombre, coalesce(e.atributos->>'TIPO', '') AS tipo, k.nombre AS capa, e.geom AS g
               FROM entidad_geo e JOIN capa k ON k.id = e.capa_id, z
              WHERE e.capa_id = ANY($2) AND e.atributos->>'ACTIVA' = 'sí'
              ORDER BY e.geom <-> z.g LIMIT 12) t
           ORDER BY km LIMIT 3`,
          [G, de('falla')]
        )
      : vacio([]),
    de('placa').length
      ? consulta<{ nombre: string; tipo: string; km: number }>(
          `WITH ${Z('0')}
           SELECT e.nombre, coalesce(e.atributos->>'TIPO', '') AS tipo, (ST_Distance(e.geom::geography, z.gg) / 1000.0)::float8 AS km
             FROM entidad_geo e, z WHERE e.capa_id = ANY($2) ORDER BY km LIMIT 3`,
          [G, de('placa')]
        )
      : vacio([]),
    de('provincia_geologica').length
      ? consulta<{ nombre: string; pct: number }>(
          `WITH ${Z('0')}
           SELECT e.nombre, (100.0 * ST_Area(ST_Intersection(${VALIDA}, z.g)::geography) / nullif(ST_Area(z.gg), 0))::float8 AS pct
             FROM entidad_geo e, z WHERE e.capa_id = ANY($2) AND e.geom && z.g AND ST_Intersects(e.geom, z.g) ORDER BY pct DESC LIMIT 4`,
          [G, de('provincia_geologica')]
        )
      : vacio([]),
    de('tracto_permisivo').length
      ? consulta<{ nombre: string; a: Record<string, string>; pct: number }>(
          `WITH ${Z('0')}
           SELECT e.nombre, e.atributos AS a, (100.0 * ST_Area(ST_Intersection(${VALIDA}, z.g)::geography) / nullif(ST_Area(z.gg), 0))::float8 AS pct
             FROM entidad_geo e, z WHERE e.capa_id = ANY($2) AND e.geom && z.g AND ST_Intersects(e.geom, z.g) ORDER BY pct DESC`,
          [G, de('tracto_permisivo')]
        )
      : vacio([]),
    de('ocurrencia').length
      ? consulta<{ nombre: string | null; mineral: string | null; tipo: string | null; estado: string | null; capa: string; km: number; dentro: boolean; lugar: string }>(
          `WITH ${Z('$3')}
           SELECT ${nombreDe('ocurrencia')} AS nombre, ${ATR('^(mineral|comm|sustanc|element|metal)')} AS mineral,
                  ${ATR('^(tipo|type)$')} AS tipo, ${ATR('^(estado|dev_stat|status|sitestatus)')} AS estado, k.nombre AS capa,
                  (ST_Distance(e.geom::geography, z.gg) / 1000.0)::float8 AS km, ST_Intersects(e.geom, z.g) AS dentro,
                  round(ST_X(ST_PointOnSurface(e.geom))::numeric, 3) || ',' || round(ST_Y(ST_PointOnSurface(e.geom))::numeric, 3) AS lugar
             FROM entidad_geo e JOIN capa k ON k.id = e.capa_id, z
            WHERE e.capa_id = ANY($2) AND e.geom && z.caja AND ST_DWithin(e.geom::geography, z.gg, $3)
            ORDER BY km LIMIT 400`,
          [G, de('ocurrencia'), R]
        )
      : vacio([]),
    de('litologia').length
      ? consulta<{ e: string | null }>(`SELECT (SELECT atributos->>'ESCALA' FROM entidad_geo WHERE capa_id = ANY($1) AND atributos ? 'ESCALA' LIMIT 1) AS e`, [de('litologia')])
      : vacio([]),
  ]);

  /* --- litología --- */
  const todas: Unidad[] = unidades.map((u) => ({
    unidad: u.u === 'sin nombre' ? `unidad sin nombre (${u.capa})` : u.u,
    // La misma palabra como unidad y descripción se decía dos veces («Tv tv»).
    descripcion: norm(u.d) === norm(u.u) ? '' : u.d,
    edad: u.ed, clase: aClase(u.cl, `${u.d} ${u.u}`), capa: u.capa,
    ha: r2(u.ha || 0), pct: zona.ha > 0 ? r2(((u.ha || 0) / zona.ha) * 100) : 0, km: r2(u.km || 0),
  }));
  const dentro = todas.filter((u) => u.ha > 0.01).sort((a, b) => b.ha - a.ha);
  const cerca = todas.filter((u) => !(u.ha > 0.01)).sort((a, b) => a.km - b.km);
  const coberturaPct = r2(Math.min(100, dentro.reduce((s, u) => s + u.pct, 0)));
  const [ct] = contacto;

  /* --- fallas --- */
  const lista: Falla[] = fallas.map((f) => ({
    nombre: f.nombre && !/^entidad \d+$/.test(f.nombre) ? f.nombre : 'Falla sin nombre en el mapa',
    tipo: f.tipo || 'sin dato', activa: f.activa === 'sí', certeza: f.certeza, capa: f.capa, kmDentro: r2(f.km_dentro || 0), km: r2(f.km || 0),
  }));
  const fDentro = lista.filter((f) => f.kmDentro > 0).sort((a, b) => b.kmDentro - a.kmDentro);
  const fCerca = lista.filter((f) => !(f.kmDentro > 0));
  const kmDentro = r2(fDentro.reduce((s, f) => s + f.kmDentro, 0));
  const km2 = zona.ha / 100;
  const rumbos = roseta(fallas.map((f) => (f.g ? (JSON.parse(f.g) as Geometry) : null)));
  const [act] = activas;

  /*
   * Yacimientos: el mismo nombre a menos de 2 km es el mismo yacimiento contado por dos catálogos
   * (MRDS y DEFOMIN lo repiten a menudo, con coordenadas que difieren unos cientos de metros). Se
   * funde en uno, juntando minerales, tipos y fuentes. Los sin nombre no se funden: no hay con qué.
   */
  const yacimientos: Array<Yacimiento & { _p: [number, number] }> = [];
  for (const y of yac) {
    const nombre = y.nombre && !/^entidad \d+$/.test(y.nombre) ? y.nombre : 'sin nombre';
    const [lon, lat] = y.lugar.split(',').map(Number);
    const igual = nombre !== 'sin nombre' && yacimientos.find((o) => norm(o.nombre) === norm(nombre) && segmento(o._p, [lon, lat]).km < 2);
    const minerales = (y.mineral || '').toLowerCase().split(/[,;/]+/).map((x) => x.trim()).filter(Boolean);
    if (igual) {
      igual.mineral = [...new Set([...igual.mineral.split(', ').filter(Boolean), ...minerales])].join(', ');
      if (y.tipo && !igual.tipo.toLowerCase().includes(y.tipo.toLowerCase())) igual.tipo = [igual.tipo, y.tipo].filter(Boolean).join('; ');
      if (y.estado && !igual.estado) igual.estado = y.estado;
      if (!igual.capa.includes(y.capa)) igual.capa += ` + ${y.capa}`;
      igual.dentro ||= y.dentro;
      igual.km = igual.dentro ? 0 : Math.min(igual.km, r2(y.km));
      continue;
    }
    yacimientos.push({ nombre, mineral: minerales.join(', '), tipo: y.tipo || '', estado: y.estado || '', capa: y.capa, km: y.dentro ? 0 : r2(y.km), dentro: y.dentro, _p: [lon, lat] });
  }
  const cuenta = (xs: string[]) => {
    const m = new Map<string, number>();
    for (const x of xs) if (x) m.set(x, (m.get(x) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const porMineral = cuenta(yacimientos.flatMap((y) => y.mineral.split(/[,;/]+/).map((s) => s.trim()).filter(Boolean))).map(([mineral, k]) => ({ mineral, n: k }));
  const porTipo = cuenta(yacimientos.map((y) => y.tipo.toLowerCase())).map(([tipo, k]) => ({ tipo, n: k }));

  const g: Geologia = {
    zona,
    radioKm,
    fuentes,
    faltan,
    escala: escala[0]?.e ? `1:${String(Number(escala[0].e.replace(/^1:/, ''))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}` : null,
    litologia: { dentro, cerca: cerca.slice(0, 15), coberturaPct },
    intrusivos: {
      dentro: dentro.filter((u) => u.clase === 'intrusiva'),
      cerca: cerca.filter((u) => u.clase === 'intrusiva').slice(0, 8),
      kmContactoDentro: r2(ct?.dentro || 0),
      kmAlContacto: ct?.al == null ? null : r2(ct.al),
      kmContactoCarbonato: r2(ct?.skarn || 0),
    },
    fallas: {
      dentro: fDentro.slice(0, 30),
      cerca: fCerca.slice(0, 20),
      kmDentro,
      densidad: km2 >= 1 ? r2(kmDentro / km2) : null,
      rumbos,
      intersecciones: cruces.map((c) => [c.lon, c.lat] as [number, number]),
      activaMasCercana: act ? { nombre: act.nombre || 'Falla activa sin nombre', tipo: act.tipo || 'sin dato', activa: true, certeza: '', capa: act.capa, kmDentro: 0, km: r2(act.km) } : null,
    },
    tectonica: {
      placas: placas.map((p) => ({ nombre: p.nombre, tipo: p.tipo, km: Math.round(p.km) })),
      provincias: provincias.filter((p) => p.pct > 0.5).map((p) => ({ nombre: p.nombre, pct: r2(p.pct) })),
    },
    recursos: {
      tractos: tractos.map((t) => ({
        nombre: t.nombre, geologia: t.a?.GEOLOGIA || '', edad: t.a?.EDAD || '', esperados: t.a?.DEPOSITOS_ESPERADOS_MEDIA || '',
        p50: t.a?.DEPOSITOS_ESPERADOS_P50 || '', p10: t.a?.DEPOSITOS_ESPERADOS_P10 || '', conocidos: t.a?.DEPOSITOS_CONOCIDOS || '', pct: r2(t.pct),
      })),
      yacimientos: yacimientos.slice(0, 60).map(({ _p, ...y }) => y),
      porMineral,
      porTipo,
    },
    indicios: { nivel: 'sin indicios', puntos: 0, criterios: [], modelos: [] },
    ms: 0,
  };
  g.indicios = indiciosDe(g);
  g.ms = Date.now() - t0;
  return g;
}

/* ------------------------------------------------------------------ indicios */

const nf = (x: number, d = 1) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: d }).format(x);
/** «6.1» → «6,1»; «0.0» → «0». */
const cifra = (x: string) => (x === '' || x == null || !isFinite(Number(x)) ? '?' : new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(Number(x)));
const km1 = (k: number) => (k < 1 ? `${Math.round(k * 1000)} m` : `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(k)} km`);

/**
 * Los criterios, cada uno con su evidencia y los modelos de yacimiento que apoya. Son los que usa
 * la exploración regional en el bloque Chortís: no es una fórmula de nadie, y por eso cada punto
 * se explica en vez de esconderse en un número.
 */
/** Los modelos de yacimiento, con un nombre cada uno para que no salgan repetidos con otras palabras. */
const M = {
  porfido: 'pórfido de cobre (y oro)',
  skarn: 'skarn de cobre, zinc u oro',
  vetasIntrusivo: 'vetas relacionadas con intrusivos',
  epitermal: 'epitermal de oro y plata',
  orogenico: 'vetas de oro orogénicas o mesotermales',
  placer: 'placeres de oro',
};

export function indiciosDe(g: Geologia): Geologia['indicios'] {
  const c: Criterio[] = [];
  const add = (clave: string, cumple: boolean, puntos: number, evidencia: string, modelos: string[]) => c.push({ clave, cumple, puntos: cumple ? puntos : 0, evidencia, modelos });
  const lito = g.fuentes.litologia?.length;

  if (lito) {
    const i = g.intrusivos;
    const cercano = i.cerca.find((u) => u.km <= 5);
    add(
      'intrusivo',
      !!i.dentro.length || !!cercano,
      2,
      i.dentro.length
        ? `Hay roca intrusiva dentro: ${i.dentro.map((u) => `${u.unidad} (${u.descripcion ? `${u.descripcion.toLowerCase()}, ` : ''}${nf(u.pct)} %)`).join('; ')}.`
        : cercano
          ? `Hay un intrusivo a ${km1(cercano.km)}: ${cercano.unidad}${cercano.descripcion ? ` (${cercano.descripcion.toLowerCase()})` : ''}.`
          : 'No hay roca intrusiva dentro ni a menos de 5 km en el mapa cargado.',
      [M.porfido, M.skarn, M.vetasIntrusivo]
    );
    add(
      'skarn',
      i.kmContactoCarbonato > 0,
      2,
      i.kmContactoCarbonato > 0
        ? `El contacto de un intrusivo con estratos marinos (calizas en buena parte) corre ${km1(i.kmContactoCarbonato)} a menos de ${g.radioKm} km: es el ambiente del skarn.`
        : 'No hay contacto de intrusivo con estratos marinos o carbonatados en el radio mirado.',
      [M.skarn]
    );
    const volc = [...g.litologia.dentro, ...g.litologia.cerca.filter((u) => u.km <= 5)].filter((u) => u.clase === 'volcanica' && /terciari|mioceno|plioceno|oligoceno/i.test(`${u.edad} ${u.descripcion}`));
    add(
      'volcanicas_terciarias',
      !!volc.length,
      1,
      volc.length ? `Rocas volcánicas terciarias ${volc.some((u) => u.ha > 0) ? 'dentro' : 'a menos de 5 km'}: ${[...new Set(volc.map((u) => u.unidad))].join(', ')}.` : 'Sin volcánicas terciarias dentro ni a menos de 5 km.',
      [M.epitermal]
    );
    const meta = g.litologia.dentro.filter((u) => u.clase === 'metamorfica');
    add(
      'metamorficas_con_fallas',
      !!meta.length && (g.fallas.dentro.length > 0 || g.fallas.cerca.some((f) => f.km <= 2)),
      1,
      meta.length ? `Basamento metamórfico dentro (${meta.map((u) => u.unidad).join(', ')})${g.fallas.dentro.length ? ', cortado por fallas' : ''}.` : 'Sin basamento metamórfico dentro.',
      [M.orogenico]
    );
  }
  if (g.fuentes.falla?.length) {
    const cruza = g.fallas.dentro.length > 0;
    const cerca = g.fallas.cerca.find((f) => f.km <= 2);
    add(
      'fallas',
      cruza || !!cerca,
      1,
      cruza
        ? `${g.fallas.dentro.length === 1 ? 'Una falla cruza' : `${g.fallas.dentro.length} fallas cruzan`} la zona (${km1(g.fallas.kmDentro)} de traza dentro)${g.fallas.rumbos.dominante ? `; rumbo dominante ${g.fallas.rumbos.dominante}` : ''}.`
        : cerca ? `Una falla pasa a ${km1(cerca.km)}.` : 'Ninguna falla del mapa cruza la zona ni pasa a menos de 2 km.',
      []
    );
    add(
      'cruces_de_fallas',
      g.fallas.intersecciones.length > 0,
      1,
      g.fallas.intersecciones.length ? `${g.fallas.intersecciones.length} ${g.fallas.intersecciones.length === 1 ? 'cruce' : 'cruces'} de fallas a menos de ${g.radioKm} km.` : `Sin cruces de fallas a menos de ${g.radioKm} km.`,
      []
    );
  }
  if (g.fuentes.tracto_permisivo?.length) {
    const t = g.recursos.tractos[0];
    add(
      'tracto_permisivo',
      !!t,
      2,
      t
        ? `${t.pct >= 99.5 ? 'Toda la zona está' : `El ${nf(t.pct)} % de la zona está`} en el ${t.nombre}, que el USGS considera permisivo para pórfido de cobre: estima ${cifra(t.esperados)} depósitos por descubrir en todo el tracto (P50 ${cifra(t.p50)}, P10 ${cifra(t.p10)}) y ${cifra(t.conocidos || '0')} conocidos. Es una cifra para todo el tracto, no para esta zona.`
        : 'Fuera de los tractos permisivos para pórfido de cobre del USGS.',
      [M.porfido]
    );
  }
  if (g.fuentes.ocurrencia?.length) {
    const y = g.recursos.yacimientos;
    const prod = y.filter((x) => /product/i.test(x.estado));
    add(
      'yacimientos_cerca',
      y.length > 0,
      y.length >= 5 ? 2 : 1,
      y.length
        ? `${y.length} ${y.length === 1 ? 'yacimiento u ocurrencia registrado' : 'yacimientos u ocurrencias registrados'} a menos de ${g.radioKm} km${y.some((x) => x.dentro) ? `, ${y.filter((x) => x.dentro).length} dentro` : ''}${g.recursos.porMineral.length ? ` (${g.recursos.porMineral.slice(0, 4).map((m) => `${m.mineral}: ${m.n}`).join(', ')})` : ''}.`
        : `Ningún yacimiento registrado a menos de ${g.radioKm} km.`,
      []
    );
    add(
      'minas_productoras',
      prod.length > 0,
      1,
      prod.length ? `${prod.length} con producción registrada (${prod.slice(0, 3).map((x) => x.nombre).join(', ')}${prod.length > 3 ? '…' : ''}).` : 'Ninguno con producción registrada.',
      []
    );
    const aluvion = g.litologia.dentro.some((u) => u.clase === 'aluvial');
    const oro = y.some((x) => /oro|gold|\bau\b/i.test(x.mineral));
    add('placeres', aluvion && oro, 1, aluvion && oro ? 'Aluvión cuaternario dentro y oro registrado en el radio: posibles placeres.' : 'Sin aluvión con oro registrado cerca.', [M.placer]);
  }

  const puntos = c.reduce((s, x) => s + x.puntos, 0);
  const nivel = puntos >= 7 ? 'alto' : puntos >= 4 ? 'medio' : puntos >= 1 ? 'bajo' : 'sin indicios';
  const modelos = [...new Set(c.filter((x) => x.cumple).flatMap((x) => x.modelos))];
  return { nivel, puntos, criterios: c, modelos };
}

/* ------------------------------------------------------------------ en texto */

/** Las fallas con el mismo nombre y tipo, juntas: «3 fallas sin nombre (desplazamiento desconocido), 20,2 km». */
function agrupar(fs: Falla[]): string[] {
  const m = new Map<string, { f: Falla; n: number; km: number }>();
  for (const f of fs) {
    const k = `${f.nombre}|${f.tipo}|${f.activa}`;
    const x = m.get(k) || { f, n: 0, km: 0 };
    x.n++;
    x.km += f.kmDentro;
    m.set(k, x);
  }
  return [...m.values()]
    .sort((a, b) => b.km - a.km)
    .map(({ f, n: k, km }) => {
      const quien = k > 1 ? (/^falla sin nombre/i.test(f.nombre) ? `${k} fallas sin nombre en el mapa` : `${f.nombre} (${k} trazos)`) : f.nombre;
      return `${quien} (${f.tipo}${f.activa ? ', activa' : ''}; ${nf(km)} km dentro)`;
    });
}

/** Para el doctor y para Telegram: lo que hay, de dónde sale y qué no se puede afirmar. */
export function geologiaEnTexto(g: Geologia): string {
  const l: string[] = [];
  l.push(`GEOLOGÍA — ${g.zona.nombre} (${nf(g.zona.ha, 0)} ha; entorno de ${g.radioKm} km).`);
  if (g.faltan.length) l.push(`No cargado (no lo afirmo ni lo niego): ${g.faltan.join(', ')}.`);
  if (g.litologia.dentro.length) {
    l.push(`Rocas${g.escala ? ` (mapa ${g.escala})` : ''}: ${g.litologia.dentro.slice(0, 6).map((u) => `${u.unidad}${u.descripcion ? ` ${u.descripcion.toLowerCase()}` : ''}${u.edad ? `, ${u.edad}` : ''} — ${nf(u.pct)} %`).join('; ')}.`);
  }
  const i = g.intrusivos;
  if (g.fuentes.litologia?.length) {
    l.push(
      i.dentro.length
        ? `Intrusivos dentro: ${i.dentro.map((u) => `${u.unidad} (${nf(u.pct)} %)`).join(', ')}; ${nf(i.kmContactoDentro)} km de contacto intrusivo dentro.`
        : i.cerca.length ? `Intrusivo más cercano: ${i.cerca[0].unidad}${i.cerca[0].descripcion ? ` ${i.cerca[0].descripcion.toLowerCase()}` : ''}, a ${km1(i.cerca[0].km)}.` : `Sin intrusivos a menos de ${g.radioKm} km.`
    );
    if (i.kmContactoCarbonato > 0) l.push(`Contacto intrusivo–estratos marinos en el entorno: ${nf(i.kmContactoCarbonato)} km (ambiente de skarn).`);
  }
  const f = g.fallas;
  if (g.fuentes.falla?.length) {
    l.push(
      f.dentro.length
        ? `Fallas que cruzan: ${agrupar(f.dentro).slice(0, 6).join('; ')}.${f.densidad != null ? ` Densidad ${nf(f.densidad, 2)} km de falla por km².` : ''}`
        : f.cerca.length ? `Ninguna falla cruza; la más cercana, ${f.cerca[0].nombre} (${f.cerca[0].tipo}), a ${km1(f.cerca[0].km)}.` : `Sin fallas a menos de ${g.radioKm} km.`
    );
    if (f.rumbos.dominante) {
      l.push(`Rumbos (${nf(f.rumbos.kmMedidos)} km medidos en el entorno): dominante ${f.rumbos.dominante}, concentración ${nf(f.rumbos.concentracion, 2)}${f.rumbos.familias.length ? `; familias ${f.rumbos.familias.map((x) => `${x.rumbo} ${Math.round(x.peso * 100)} %`).join(', ')}` : ''}. Cruces de fallas: ${f.intersecciones.length}.`);
    }
    if (f.activaMasCercana) l.push(`Falla activa más cercana: ${f.activaMasCercana.nombre} (${f.activaMasCercana.tipo}), a ${km1(f.activaMasCercana.km)}.`);
  }
  if (g.tectonica.placas.length || g.tectonica.provincias.length) {
    l.push(
      `Tectónica: ${g.tectonica.provincias.length ? `provincia ${g.tectonica.provincias.map((p) => p.nombre).join(' / ')}. ` : ''}${g.tectonica.placas.map((p) => `${p.nombre}, a ${nf(p.km, 0)} km: ${p.tipo}`).join('. ')}.`
    );
  }
  if (g.recursos.tractos.length) l.push(`Tractos permisivos del USGS: ${g.recursos.tractos.map((t) => `${t.nombre}, ${nf(t.pct)} % de la zona (${t.edad}): ${t.geologia}`).join(' ')}`);
  if (g.recursos.yacimientos.length) {
    l.push(`Yacimientos a menos de ${g.radioKm} km (${g.recursos.yacimientos.length}): ${g.recursos.yacimientos.slice(0, 8).map((y) => `${y.nombre}${y.mineral ? ` (${y.mineral}${y.tipo ? `, ${y.tipo}` : ''})` : ''} ${y.dentro ? 'dentro' : `a ${km1(y.km)}`}`).join('; ')}.`);
  }
  l.push(`INDICIOS: ${g.indicios.nivel.toUpperCase()} (${g.indicios.puntos} puntos). ${g.indicios.criterios.filter((x) => x.cumple).map((x) => x.evidencia).join(' ')}`);
  if (g.indicios.modelos.length) l.push(`Modelos de yacimiento compatibles: ${g.indicios.modelos.join(', ')}.`);
  l.push(
    `Límites: ${g.escala ? `el mapa geológico es regional (${g.escala}, error de ubicación del orden de 1,6 km) y ` : ''}un indicio no es un recurso. Confirmar con cartografía 1:50 000, muestreo, geoquímica y, si sigue, geofísica y perforación.`
  );
  const src = Object.entries(g.fuentes).map(([rol, v]) => `${NOMBRE_ROL_GEO[rol] || rol}: ${v!.join(', ')}`);
  if (src.length) l.push(`Fuentes: ${src.join(' · ')}.`);
  return l.join('\n');
}
