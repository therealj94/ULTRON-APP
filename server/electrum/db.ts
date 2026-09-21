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
  // `concesiona`, no `concesionari`: el formato DBF corta los nombres de columna a DIEZ caracteres,
  // así que «concesionario» llega recortado y la expresión larga no casaba con nada. El catastro
  // nacional de Honduras entero se cargó sin titular por esto, y no dio ningún error: simplemente
  // quedaron mil concesiones sin dueño. Las columnas recortadas son la norma, no la excepción.
  titular: [/^(titular|concesiona|empresa|propietari|solicitante|benefici)/i],
  departamento: [/^(departament|depto|dpto)/i],
  municipio: [/^(municipio|munic|mpio)/i],
  tipo: [/^(tipo|categoria|clase|modalidad)/i],
  mineral: [/^(mineral|sustancia|recurso)/i],
  estado: [/^(estado|situacion|status|vigencia)/i],
  hectareas: [/^(hectarea|hectárea|has?$|area|área|superficie)/i],
};

/**
 * ¿Los rasgos de esta capa parecen derechos mineros?
 *
 * El criterio es el titular. `entidad_geo` existe justamente para lo otro —bocaminas, ríos,
 * poblados, áreas protegidas— y meterlo todo en `concesion` hace que el cruce de traslapes
 * devuelva ruido en vez de conflictos de derechos.
 */
function pareceCatastro(rasgos: Feature[]): boolean {
  const muestra = rasgos.filter((f) => f && f.properties).slice(0, 50);
  if (!muestra.length) return false;
  const con = muestra.filter((f) => delDbf(f.properties as Record<string, unknown>, 'titular')).length;
  return con > muestra.length / 2;
}

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
): Promise<{ capaId: number; concesiones: number; entidades: number; repetidas: number }> {
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
    let nRep = 0;
    /*
     * ¿Esta capa es catastro o es geografía?
     *
     * Antes TODO entraba como concesión. Con dos capas de prueba no se nota; con un catastro
     * nacional de verdad, las aldeas, los municipios, las microcuencas y los buffers de carretera
     * acabaron en la tabla de concesiones: 9732 «concesiones» donde los derechos mineros eran 1080,
     * y 43158 «traslapes» que en su mayoría eran un municipio solapando lo que contiene. Eso no es
     * un número inflado, es un padrón inservible: el traslape de verdad —dos derechos pisándose—
     * queda enterrado bajo el ruido, y preguntarle al cerebro cuántas concesiones hay devuelve una
     * mentira.
     *
     * Lo que distingue a un derecho minero de un accidente geográfico es que TIENE DUEÑO. Un
     * municipio no tiene concesionario. Se mira una muestra de la capa y se decide por mayoría,
     * no rasgo a rasgo: una capa es de una cosa o de la otra, y decidir por rasgo deja la mitad de
     * un shapefile en cada tabla.
     */
    const comoConcesiones = opts.comoConcesiones ?? pareceCatastro(capa.geojson.features as Feature[]);

    /*
     * En bloques, no de una en una.
     *
     * Antes cada entidad costaba un viaje a la base —y cada concesión dos, porque la comprobación
     * de huella iba aparte—. Con la base al otro lado de un túnel eso no es lento, es inviable: una
     * capa de treinta mil aldeas son sesenta mil idas y vueltas, y el catastro nacional entero no
     * terminaba nunca. Agrupando de cien en cien, el mismo trabajo son unos cientos de viajes.
     *
     * El tamaño del bloque lo limita el número de parámetros de PostgreSQL (65535): con quince
     * columnas por concesión, cien filas son mil quinientos, de sobra dentro.
     */
    const BLOQUE = 100;
    const rasgos = (capa.geojson.features as Feature[]).filter((f) => f && f.geometry);

    for (let inicio = 0; inicio < rasgos.length; inicio += BLOQUE) {
      const tramo = rasgos.slice(inicio, inicio + BLOQUE);
      const concesiones: Array<{ f: Feature; i: number }> = [];
      const entidades: Array<{ f: Feature; i: number }> = [];

      tramo.forEach((f, k) => {
        const destino = comoConcesiones && comoMulti(f.geometry!) ? concesiones : entidades;
        destino.push({ f, i: inicio + k });
      });

      if (concesiones.length) {
        /*
         * Una geometría idéntica ya cargada NO entra otra vez. Cargar el mismo shapefile dos veces
         * no solo duplica filas: hace que cada concesión aparezca traslapada al 100 % con su propia
         * copia, y el padrón entero parece un desastre de superposiciones que no existe. Pasó en la
         * primera prueba de carga de verdad.
         *
         * Se pregunta por las cien de golpe en vez de una por una: misma comprobación, un viaje.
         */
        const geoms = concesiones.map(({ f }) => JSON.stringify(f.geometry));
        const repetidas = await cliente.query<{ pos: string }>(
          `SELECT t.pos::text AS pos
             FROM unnest($1::text[]) WITH ORDINALITY AS t(g, pos)
            WHERE EXISTS (
              SELECT 1 FROM concesion c
               WHERE c.huella = md5(ST_AsBinary(ST_Normalize(ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(t.g), 4326)))))
            )`,
          [geoms]
        );
        const yaEstan = new Set(repetidas.rows.map((r) => Number(r.pos)));
        nRep += yaEstan.size;

        const nuevas = concesiones.filter((_, k) => !yaEstan.has(k + 1));
        if (nuevas.length) {
          const valores: unknown[] = [];
          const marcas = nuevas.map(({ f, i }) => {
            const props = (f.properties || {}) as Record<string, unknown>;
            const declarada = Number(delDbf(props, 'hectareas'));
            const b = valores.length;
            valores.push(
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
              JSON.stringify(f.geometry)
            );
            const n = (k: number) => `$${b + k}`;
            return `(${n(1)},${n(2)},${n(3)},${n(4)},${n(5)},${n(6)},${n(7)},${n(8)},${n(9)},${n(10)},${n(11)},${n(12)},${n(13)},${n(14)},ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${n(15)}), 4326)))`;
          });
          await cliente.query(
            `INSERT INTO concesion
               (capa_id, expediente, nombre, titular, departamento, municipio, tipo, mineral, estado,
                otorgada, vence, hectareas, hectareas_dec, atributos, geom)
             VALUES ${marcas.join(',')}`,
            valores
          );
          nConc += nuevas.length;
        }
      }

      if (entidades.length) {
        const valores: unknown[] = [];
        const marcas = entidades.map(({ f, i }) => {
          const props = (f.properties || {}) as Record<string, unknown>;
          const b = valores.length;
          valores.push(capaId, etiqueta(f, i), String(props.clase || props.tipo || 'otro'), JSON.stringify(props), JSON.stringify(f.geometry));
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},ST_SetSRID(ST_GeomFromGeoJSON($${b + 5}), 4326))`;
        });
        await cliente.query(`INSERT INTO entidad_geo (capa_id, nombre, clase, atributos, geom) VALUES ${marcas.join(',')}`, valores);
        nEnt += entidades.length;
      }
    }

    /*
     * Una capa que no aportó nada no es una capa.
     *
     * La deduplicación por huella impedía que se repitieran las CONCESIONES, pero la fila de `capa`
     * se creaba igual. Subir el mismo catastro tres veces dejaba tres «catastro · 2 entidades» en
     * la lista, todas mintiendo: las dos últimas no metieron ni una geometría. Quien lo mira cuenta
     * seis concesiones donde hay dos.
     *
     * Se borra solo en ese caso exacto —capa de concesiones, todo repetido, nada nuevo—, para que
     * una capa legítimamente vacía o una de entidades geográficas siga registrándose.
     */
    const noAporto = comoConcesiones && nConc === 0 && nEnt === 0 && nRep > 0;
    if (noAporto) await cliente.query('DELETE FROM capa WHERE id = $1', [capaId]);

    await cliente.query('COMMIT');
    return { capaId: noAporto ? 0 : capaId, concesiones: nConc, entidades: nEnt, repetidas: nRep };
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

/**
 * Cuántas concesiones traen fecha de vencimiento, y cuántas hay en total.
 *
 * Hace falta para no mentir. Un padrón sin fechas y un padrón donde de verdad no vence nada este
 * año dan la misma respuesta vacía, y no son lo mismo ni de lejos: lo primero es que falta un dato,
 * lo segundo es una noticia tranquilizadora. El catastro nacional de Honduras no trae ni una sola
 * fecha —ni de otorgamiento ni de vencimiento— en sus 1079 concesiones, así que preguntar qué
 * vence este año contestaba «ninguna» con toda tranquilidad.
 */
export async function coberturaDeFechas(): Promise<{ conVence: number; total: number }> {
  const [r] = await consulta<{ con: string; total: string }>(
    `SELECT count(*) FILTER (WHERE vence IS NOT NULL)::text AS con, count(*)::text AS total FROM concesion`
  );
  return { conVence: Number(r?.con || 0), total: Number(r?.total || 0) };
}

/**
 * Todo el catastro como GeoJSON, para pintarlo en el mapa de una vez.
 *
 * Con mil concesiones cargadas, el mapa salía vacío hasta que alguien preguntaba por una: los datos
 * estaban y no se veían. Un catastro que no se ve no sirve para lo que sirve un catastro, que es
 * mirar dónde está cada cosa respecto de las demás.
 *
 * La geometría va simplificada. A la escala de un país, los vértices que distinguen dos polígonos
 * están muy por debajo de un píxel, y mandarlos todos multiplica el peso sin cambiar un solo punto
 * de la pantalla. `ST_SimplifyPreserveTopology` no rompe los polígonos —no deja huecos ni cruces—,
 * y lo que se usa para MEDIR sigue siendo la geometría entera de la base: esto es para verlo, no
 * para contar hectáreas.
 */
export async function catastroGeojson(limite = 4000, toleranciaGrados = 0.0001): Promise<FeatureCollection> {
  const filas = await consulta<{ g: string; id: number; nombre: string; titular: string | null; estado: string | null; ha: number | null }>(
    `SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, $2))::text AS g,
            id, nombre, titular, estado, hectareas::float8 AS ha
       FROM concesion
      WHERE geom IS NOT NULL
      ORDER BY hectareas DESC NULLS LAST
      LIMIT $1`,
    [limite, toleranciaGrados]
  );
  return {
    type: 'FeatureCollection',
    features: filas.map((f) => ({
      type: 'Feature',
      geometry: JSON.parse(f.g) as Geometry,
      properties: { id: f.id, nombre: f.nombre, titular: f.titular, estado: f.estado, hectareas: f.ha },
    })),
  } as FeatureCollection;
}

/** El rectángulo que abarca todo el catastro, para encuadrar el mapa al abrirlo. */
export async function encuadreCatastro(): Promise<[number, number, number, number] | null> {
  const [r] = await consulta<{ x1: number; y1: number; x2: number; y2: number }>(
    `SELECT ST_XMin(e) x1, ST_YMin(e) y1, ST_XMax(e) x2, ST_YMax(e) y2
       FROM (SELECT ST_Extent(geom) e FROM concesion) t WHERE e IS NOT NULL`
  );
  return r ? [Number(r.x1), Number(r.y1), Number(r.x2), Number(r.y2)] : null;
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
 * Palabras con las que empieza una pregunta y que NO son vacías para Postgres.
 *
 * Esto costó un fallo real: `websearch_to_tsquery` une todos los términos con Y, y «cuál» no está
 * en la lista de palabras vacías del español. Así que preguntar «¿cuál es la ley media?» exigía que
 * el documento contuviera literalmente «cuál», y no encontraba nada. La gente pregunta en preguntas.
 */
const INTERROGATIVAS =
  /\b(qu[eé]|cu[aá]l(es)?|c[oó]mo|cu[aá]nt[oa]s?|d[oó]nde|cu[aá]ndo|qui[eé]n(es)?|por qu[eé]|para qu[eé]|dime|decime|dame|mostrame|busca|buscame|hay|existe|tiene|es|son|est[aá]n?)\b/gi;

function terminosDeBusqueda(texto: string): string {
  return String(texto || '')
    .replace(/[¿?¡!.,;:]/g, ' ')
    .replace(INTERROGATIVAS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Busca en los documentos subidos y devuelve el fragmento con su página, para poder citarlo.
 * Una cita sin página no sirve: nadie puede ir a comprobarla, que es para lo que existe una cita.
 *
 * Dos pasadas: primero exigiendo todos los términos (preciso), y si eso no da nada, pidiendo
 * cualquiera de ellos y ordenando por relevancia. Un buscador que devuelve cero ante una pregunta
 * bien formulada no sirve, aunque sea técnicamente correcto.
 */
export async function buscarEnExpedientes(
  texto: string,
  limite = 8
): Promise<Array<{ documento: string; pagina: number | null; texto: string; puntaje: number }>> {
  const limpio = terminosDeBusqueda(texto);
  if (!limpio) return [];

  /*
   * `ts_headline` recorta el trozo ALREDEDOR de lo que coincidió, en vez de devolver el principio
   * del fragmento. Es la diferencia entre citar «la ley media ponderada es de 3,4 g/t» y citar el
   * encabezado del informe: lo segundo es técnicamente la misma fuente y no le sirve a nadie.
   */
  const SQL = (op: string) => `
    WITH q AS (SELECT ${op} AS tq)
    SELECT d.nombre AS documento, f.pagina,
           ts_headline('spanish', f.texto, q.tq,
             'MaxWords=55, MinWords=25, ShortWord=3, MaxFragments=2, FragmentDelimiter=" … ", StartSel="", StopSel=""') AS texto,
           ts_rank(f.tsv, q.tq)::float8 AS puntaje
    FROM fragmento f
    JOIN documento d ON d.id = f.documento_id, q
    WHERE f.tsv @@ q.tq
    ORDER BY puntaje DESC
    LIMIT $2`;

  const exacto = await consulta<any>(SQL("websearch_to_tsquery('spanish', $1)"), [limpio, limite]);
  if (exacto.length) return exacto;

  // Segunda pasada: cualquiera de los términos, que es lo que un humano espera de un buscador.
  const sueltos = limpio
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 8)
    .map((w) => w.replace(/['\\:&|!()<>]/g, ''))
    .filter(Boolean)
    .join(' | ');
  if (!sueltos) return [];
  return consulta(SQL("to_tsquery('spanish', $1)"), [sueltos, limite]);
}
