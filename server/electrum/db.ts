/**
 * ACCESO A DATOS DE ELECTRUM — el catastro vive en PostGIS, no en memoria.
 *
 * Un catastro nacional son miles de polígonos y las preguntas que importan son espaciales: qué se
 * traslapa con qué, qué cae dentro de esta área, qué hay a menos de dos kilómetros de este río.
 * Eso lo resuelve una base con índice espacial en milisegundos; en memoria, no termina.
 *
 * Conexión por ELECTRUM_DB_URL (postgres://usuario:clave@host:5432/electrum). Sin esa variable,
 * `hayBase()` devuelve false y quien llama decide qué hacer: la plataforma tiene que poder arrancar
 * y decir «no tengo catastro conectado» en vez de caerse.
 *
 * Todo entra y sale en WGS84 (SRID 4326). Las áreas se piden siempre sobre `geography`, que es la
 * cuenta geodésica; pedirlas sobre `geometry` daría grados cuadrados, que no significan nada.
 */
import { Pool, type PoolClient } from 'pg';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { areaHectareas, etiqueta, type Capa } from './gis';

let pool: Pool | null = null;

export function hayBase(): boolean {
  return !!process.env.ELECTRUM_DB_URL;
}

function conexion(): Pool {
  if (!pool) {
    const url = process.env.ELECTRUM_DB_URL;
    if (!url) throw new Error('Falta ELECTRUM_DB_URL: no hay catastro conectado.');
    pool = new Pool({
      connectionString: url,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      // El nodo propio usa certificado propio; fuera de eso, TLS normal.
      ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

export async function cerrarBase() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function consulta<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await conexion().query(sql, params as any[]);
  return r.rows as T[];
}

/** ¿Está viva y con PostGIS puesto? Es lo que contesta el panel de estado. */
export async function saludBase(): Promise<{ viva: boolean; postgis?: string; concesiones?: number; motivo?: string }> {
  if (!hayBase()) return { viva: false, motivo: 'sin ELECTRUM_DB_URL' };
  try {
    const [{ v }] = await consulta<{ v: string }>('SELECT postgis_lib_version() AS v');
    const [{ n }] = await consulta<{ n: string }>('SELECT count(*)::text AS n FROM concesion');
    return { viva: true, postgis: v, concesiones: Number(n) };
  } catch (e: any) {
    return { viva: false, motivo: String(e?.message || e).slice(0, 140) };
  }
}

/* ------------------------------------------------------------------ carga */

/** Campos del .dbf que suelen traer cada cosa, en el orden en que hay que probarlos. */
const CAMPOS: Record<string, RegExp[]> = {
  expediente: [/^(expediente|exp|no_exp|num_exp|codigo|clave)/i],
  titular: [/^(titular|concesionari|empresa|propietari|solicitante)/i],
  departamento: [/^(departament|depto|dpto)/i],
  municipio: [/^(municipio|munic|mpio)/i],
  tipo: [/^(tipo|categoria|clase|modalidad)/i],
  mineral: [/^(mineral|sustancia|recurso)/i],
  estado: [/^(estado|situacion|status|vigencia)/i],
  hectareas: [/^(hectarea|hectárea|has?$|area|área|superficie)/i],
};

function delDbf(props: Record<string, unknown>, campo: string): string | null {
  for (const re of CAMPOS[campo] || []) {
    const k = Object.keys(props).find((x) => re.test(x));
    if (k && props[k] != null && String(props[k]).trim()) return String(props[k]).trim();
  }
  return null;
}

function fecha(props: Record<string, unknown>, res: RegExp): string | null {
  const k = Object.keys(props).find((x) => res.test(x));
  if (!k || !props[k]) return null;
  const d = new Date(String(props[k]));
  return isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

/** Envuelve cualquier polígono como MultiPolygon, que es lo que exige la columna. */
function comoMulti(g: Geometry): Geometry | null {
  if (!g) return null;
  if (g.type === 'MultiPolygon') return g;
  if (g.type === 'Polygon') return { type: 'MultiPolygon', coordinates: [g.coordinates] } as Geometry;
  return null;
}

/**
 * Guarda una capa leída por el motor GIS. Los polígonos entran como concesiones; lo demás, como
 * entidades geográficas. Todo en una transacción: una carga a medias es peor que ninguna.
 */
export async function guardarCapa(
  capa: Capa,
  opts: { archivo?: string; subidoPor?: string; avisos?: unknown[]; comoConcesiones?: boolean } = {}
): Promise<{ capaId: number; concesiones: number; entidades: number }> {
  const cliente: PoolClient = await conexion().connect();
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query(
      `INSERT INTO capa (nombre, formato, origen_crs, archivo, subido_por, entidades, descartadas, avisos)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [capa.nombre, capa.formato, capa.origenCrs, opts.archivo || null, opts.subidoPor || null, capa.entidades, capa.descartadas, JSON.stringify(opts.avisos || [])]
    );
    const capaId = Number(rows[0].id);

    let nConc = 0;
    let nEnt = 0;
    const comoConcesiones = opts.comoConcesiones !== false;

    for (let i = 0; i < capa.geojson.features.length; i++) {
      const f = capa.geojson.features[i] as Feature;
      if (!f.geometry) continue;
      const props = (f.properties || {}) as Record<string, unknown>;
      const multi = comoMulti(f.geometry);

      if (comoConcesiones && multi) {
        const declarada = Number(delDbf(props, 'hectareas'));
        await cliente.query(
          `INSERT INTO concesion
             (capa_id, expediente, nombre, titular, departamento, municipio, tipo, mineral, estado,
              otorgada, vence, hectareas, hectareas_dec, atributos, geom)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                   ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($15), 4326)))`,
          [
            capaId,
            delDbf(props, 'expediente'),
            etiqueta(f, i),
            delDbf(props, 'titular'),
            delDbf(props, 'departamento'),
            delDbf(props, 'municipio'),
            delDbf(props, 'tipo'),
            delDbf(props, 'mineral'),
            delDbf(props, 'estado'),
            fecha(props, /^(otorgad|inicio|desde|fecha_ini)/i),
            fecha(props, /^(vence|vencim|caduc|hasta|fecha_fin)/i),
            // El área buena la mide el motor GIS sobre el elipsoide, no el .dbf.
            areaHectareas(f).toFixed(4),
            isFinite(declarada) && declarada > 0 ? declarada : null,
            JSON.stringify(props),
            JSON.stringify(f.geometry),
          ]
        );
        nConc++;
      } else {
        await cliente.query(
          `INSERT INTO entidad_geo (capa_id, nombre, clase, atributos, geom)
           VALUES ($1,$2,$3,$4, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326))`,
          [capaId, etiqueta(f, i), String(props.clase || props.tipo || 'otro'), JSON.stringify(props), JSON.stringify(f.geometry)]
        );
        nEnt++;
      }
    }

    await cliente.query('COMMIT');
    return { capaId, concesiones: nConc, entidades: nEnt };
  } catch (e) {
    await cliente.query('ROLLBACK');
    throw e;
  } finally {
    cliente.release();
  }
}

/* ------------------------------------------------------------------ consultas */

export type FilaConcesion = {
  id: number;
  expediente: string | null;
  nombre: string;
  titular: string | null;
  departamento: string | null;
  municipio: string | null;
  tipo: string | null;
  mineral: string | null;
  estado: string | null;
  otorgada: string | null;
  vence: string | null;
  hectareas: number | null;
  hectareas_dec: number | null;
};

const CAMPOS_SELECT = `id, expediente, nombre, titular, departamento, municipio, tipo, mineral,
  estado, to_char(otorgada,'YYYY-MM-DD') AS otorgada, to_char(vence,'YYYY-MM-DD') AS vence,
  hectareas::float8 AS hectareas, hectareas_dec::float8 AS hectareas_dec`;

/**
 * Busca por nombre, titular, expediente o municipio.
 *
 * Hay dos búsquedas distintas metidas en una, porque la gente falla de dos maneras:
 *
 *  - Escribe mal: «Quebrda Seca». Eso lo resuelve la similitud por trigramas (`%`).
 *  - Escribe solo un pedazo: «Andina», cuando el titular es «Compañía Demo Andina Ltda.». Eso NO lo
 *    resuelve la similitud, porque comparar seis letras contra veintiséis da 0,27 y el umbral es
 *    0,3. Para eso está la subcadena (LIKE), que el índice GIN de trigramas también acelera.
 *
 * `unaccent` en todo para que «Danlí» y «Danli» sean lo mismo, que es como lo escribe medio padrón.
 */
export async function buscarConcesiones(texto: string, limite = 20): Promise<FilaConcesion[]> {
  const q = String(texto || '').trim();
  if (!q) return [];
  return consulta<FilaConcesion>(
    `WITH b AS (SELECT unaccent(lower($1)) AS q)
     SELECT ${CAMPOS_SELECT},
            GREATEST(
              similarity(unaccent(lower(nombre)), b.q),
              similarity(unaccent(lower(coalesce(titular,''))), b.q),
              CASE WHEN unaccent(lower(nombre)) LIKE '%' || b.q || '%' THEN 0.9 ELSE 0 END,
              CASE WHEN unaccent(lower(coalesce(titular,''))) LIKE '%' || b.q || '%' THEN 0.8 ELSE 0 END,
              CASE WHEN unaccent(lower(coalesce(expediente,''))) = b.q THEN 1 ELSE 0 END
            ) AS puntaje
     FROM concesion, b
     WHERE unaccent(lower(nombre)) % b.q
        OR unaccent(lower(coalesce(titular,''))) % b.q
        OR unaccent(lower(nombre)) LIKE '%' || b.q || '%'
        OR unaccent(lower(coalesce(titular,''))) LIKE '%' || b.q || '%'
        OR unaccent(lower(coalesce(expediente,''))) = b.q
        OR unaccent(lower(coalesce(municipio,''))) = b.q
     ORDER BY puntaje DESC NULLS LAST, nombre
     LIMIT $2`,
    [q, limite]
  );
}

/** Las que vencen dentro de `dias`, de la más urgente a la menos. Las ya vencidas entran primero. */
export async function porVencer(dias = 365, limite = 50): Promise<Array<FilaConcesion & { dias: number }>> {
  return consulta(
    `SELECT ${CAMPOS_SELECT}, (vence - CURRENT_DATE) AS dias
     FROM concesion
     WHERE vence IS NOT NULL AND vence <= CURRENT_DATE + ($1 || ' days')::interval
     ORDER BY vence ASC
     LIMIT $2`,
    [String(dias), limite]
  );
}

/** Traslapes guardados, del más grande al más chico, con los nombres de las dos partes. */
export async function traslapes(limite = 50): Promise<Array<{ a: string; b: string; hectareas: number; a_id: number; b_id: number }>> {
  return consulta(
    `SELECT ca.nombre AS a, cb.nombre AS b, t.hectareas::float8 AS hectareas, t.a_id, t.b_id
     FROM traslape t
     JOIN concesion ca ON ca.id = t.a_id
     JOIN concesion cb ON cb.id = t.b_id
     ORDER BY t.hectareas DESC
     LIMIT $1`,
    [limite]
  );
}

/** Vuelve a calcular todos los traslapes del padrón. Devuelve cuántos encontró. */
export async function recalcularTraslapes(minimoHa = 0.01): Promise<number> {
  const [{ n }] = await consulta<{ n: number }>('SELECT recalcular_traslapes($1) AS n', [minimoHa]);
  return Number(n);
}

/** Qué concesión cubre este punto. La pregunta de «estoy parado aquí, ¿de quién es esto?». */
export async function concesionEnPunto(lon: number, lat: number): Promise<FilaConcesion[]> {
  return consulta<FilaConcesion>(
    `SELECT ${CAMPOS_SELECT}
     FROM concesion
     WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))`,
    [lon, lat]
  );
}

/** Qué hay a menos de tantos kilómetros de un punto. Se mide sobre el elipsoide, no en grados. */
export async function cercaDe(lon: number, lat: number, km: number, limite = 30): Promise<Array<FilaConcesion & { km: number }>> {
  return consulta(
    `SELECT ${CAMPOS_SELECT},
            (ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) / 1000.0)::float8 AS km
     FROM concesion
     WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3 * 1000.0)
     ORDER BY km ASC
     LIMIT $4`,
    [lon, lat, km, limite]
  );
}

/** La geometría de una concesión, para dibujarla y para volar el mapa hacia ella. */
export async function geometriaDe(id: number): Promise<{ geojson: Geometry; centro: [number, number]; encuadre: [number, number, number, number] } | null> {
  const r = await consulta<{ g: string; lon: number; lat: number; o: number; s: number; e: number; n: number }>(
    `SELECT ST_AsGeoJSON(geom) AS g,
            ST_X(ST_PointOnSurface(geom)) AS lon, ST_Y(ST_PointOnSurface(geom)) AS lat,
            ST_XMin(geom) AS o, ST_YMin(geom) AS s, ST_XMax(geom) AS e, ST_YMax(geom) AS n
     FROM concesion WHERE id = $1`,
    [id]
  );
  if (!r.length) return null;
  return { geojson: JSON.parse(r[0].g), centro: [r[0].lon, r[0].lat], encuadre: [r[0].o, r[0].s, r[0].e, r[0].n] };
}

/** Una capa entera como GeoJSON, para pintarla en el mapa. */
export async function capaGeojson(capaId: number): Promise<FeatureCollection> {
  const filas = await consulta<{ f: string }>(
    `SELECT json_build_object(
              'type','Feature',
              'geometry', ST_AsGeoJSON(geom)::json,
              'properties', json_build_object(
                'id', id, 'nombre', nombre, 'expediente', expediente, 'titular', titular,
                'estado', estado, 'hectareas', hectareas::float8)
            )::text AS f
     FROM concesion WHERE capa_id = $1`,
    [capaId]
  );
  return { type: 'FeatureCollection', features: filas.map((x) => JSON.parse(x.f)) };
}

/* ------------------------------------------------------------------ expedientes */

/**
 * Busca en los documentos subidos y devuelve el fragmento con su página, para poder citarlo.
 * Una cita sin página no sirve: nadie puede ir a comprobarla, que es para lo que existe una cita.
 */
export async function buscarEnExpedientes(
  texto: string,
  limite = 8
): Promise<Array<{ documento: string; pagina: number | null; texto: string; puntaje: number }>> {
  const q = String(texto || '').trim();
  if (!q) return [];
  return consulta(
    `SELECT d.nombre AS documento, f.pagina, f.texto,
            ts_rank(f.tsv, websearch_to_tsquery('spanish', $1))::float8 AS puntaje
     FROM fragmento f
     JOIN documento d ON d.id = f.documento_id
     WHERE f.tsv @@ websearch_to_tsquery('spanish', $1)
     ORDER BY puntaje DESC
     LIMIT $2`,
    [q, limite]
  );
}
