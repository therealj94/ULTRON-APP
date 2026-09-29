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
import { areaHectareas, etiqueta, repararTexto, type Capa } from './gis';
import { buscarPorSignificado } from './vectores';
import { fundirPorRango } from '../../lib/cognitivo/embeddings';
import { trazaActual } from '../../lib/cognitivo/traza';

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
    /*
     * Un cliente ocioso que pierde la conexión —la base se reinicia, el túnel se corta, el TLS se
     * renegocia— hace que el pool emita 'error'. Sin oyente, Node lo trata como una excepción sin
     * atrapar y TUMBA EL PROCESO: Dr Electrum entero, por una conexión que ni se estaba usando. Con
     * oyente, el pool descarta ese cliente y la próxima consulta abre uno nuevo.
     */
    pool.on('error', (e) => console.error('[electrum] conexión con el catastro perdida:', String(e?.message || e).slice(0, 160)));
  }
  return pool;
}

export async function cerrarBase() {
  if (pool) {
    await pool.end();
    pool = null;
  }
  // La próxima conexión puede ser a otra base (las pruebas lo hacen): que vuelva a preguntar.
  conRol = null;
}

export async function consulta<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await conexion().query(sql, params as any[]);
  return r.rows as T[];
}

/** Varias consultas en una transacción: o entran todas, o ninguna. */
export async function enTransaccion<T>(fn: (q: (sql: string, params?: unknown[]) => Promise<any[]>) => Promise<T>): Promise<T> {
  const cliente = await conexion().connect();
  try {
    await cliente.query('BEGIN');
    const r = await fn(async (sql, params = []) => (await cliente.query(sql, params as any[])).rows);
    await cliente.query('COMMIT');
    return r;
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
}

/**
 * Una consulta que la BASE corta si tarda más de `ms`, y devuelve la conexión al pool.
 *
 * Cortar solo en Node (un Promise.race con un reloj) deja la consulta corriendo en Postgres con su
 * conexión tomada: unas cuantas fichas contra una capa lenta agotaban las ocho del pool y frenaban
 * todo el catastro (revisión de Codex en #38). `SET LOCAL` vale solo dentro de esta transacción.
 */
export async function consultaConTope<T = any>(sql: string, params: unknown[] = [], ms = 8000): Promise<T[]> {
  const cliente = await conexion().connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query(`SET LOCAL statement_timeout = ${Math.max(100, Math.floor(ms))}`);
    const r = await cliente.query(sql, params as any[]);
    await cliente.query('COMMIT');
    return r.rows as T[];
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
}

/**
 * Las filas con los textos de las capas reparados (ver `repararTexto`). Lo ya cargado con acentos
 * rotos se lee bien sin reescribir la base; lo que se cargue desde ahora ya entra reparado.
 */
export function conTextoReparado<T>(filas: T[]): T[] {
  for (const f of filas as Array<Record<string, unknown>>) {
    for (const k of Object.keys(f)) {
      const v = f[k];
      if (typeof v === 'string') f[k] = repararTexto(v);
      else if (Array.isArray(v)) f[k] = v.map((x) => (typeof x === 'string' ? repararTexto(x) : x));
    }
  }
  return filas;
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
  const v = props[k];
  const d = v instanceof Date ? v : new Date(String(v));
  if (!isFinite(d.getTime())) return null;
  // Una fecha VACÍA del .dbf («00000000») llega leída como 30-11-1899, y la de Excel/Access como
  // 30-12-1899: no es una fecha, es la ausencia de una. Guardada, 703 concesiones salían «vencidas
  // hace 46 000 días» y tapaban las que de verdad vencen.
  if (d.getUTCFullYear() <= 1900) return null;
  return d.toISOString().slice(0, 10);
}

/** Envuelve cualquier polígono como MultiPolygon, que es lo que exige la columna. */
function comoMulti(g: Geometry): Geometry | null {
  if (!g) return null;
  if (g.type === 'MultiPolygon') return g;
  if (g.type === 'Polygon') return { type: 'MultiPolygon', coordinates: [g.coordinates] } as Geometry;
  return null;
}

/**
 * La geometría de una concesión tal como se guarda, a partir del GeoJSON que llega en `param`.
 *
 *  · `ST_Force2D`: un KML de Google Earth trae altura en cada vértice («-86.2,14.6,0») y la columna
 *    es 2D. Sin esto TODO KML real se caía con «Geometry has Z dimension but column does not».
 *  · `ST_MakeValid` + `ST_CollectionExtract(…, 3)`: un lindero que se cruza consigo mismo se repara
 *    y queda solo lo que es superficie. A un polígono ya válido no le cambia nada —PostGIS lo
 *    devuelve intacto—, así que la huella de lo que ya estaba cargado sigue siendo la misma.
 */
const GEOM_VALIDA = (param: string) =>
  `ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(${param}), 4326))), 3))`;

/* ------------------------------------------------------------------ rol de una capa */

/** Lo que una capa de geografía ES para el cruce de la ficha (esquema v7, `capa.rol`). */
export type RolEntorno =
  | 'rio'
  | 'poblado'
  | 'area_protegida'
  | 'microcuenca'
  | 'carretera'
  | 'municipio'
  | 'departamento'
  | 'ocurrencia'
  | 'zona_informal'
  | 'forestal';

/**
 * Las capas de geología (esquema v8): unidades de roca, fallas, límites de placa, provincias
 * geológicas y tractos permisivos. Las cruza server/electrum/geologia.ts, no la ficha del entorno:
 * que falte el mapa geológico no es algo que la ficha de una concesión tenga que reclamar.
 */
export type RolGeologia = 'litologia' | 'falla' | 'placa' | 'provincia_geologica' | 'tracto_permisivo';

/**
 * Capas de REFERENCIA (esquema v10): se ven en el mapa pero no son el catastro. `historico` son
 * estudios viejos —JICA-MMAJ 1978-2003 y lo parecido—: sirven de contexto, no dicen quién tiene qué
 * hoy. `proyecto` son los polígonos propios (Minas de Oro I–V, Monarka…): contados como concesiones
 * se traslapaban con su propia copia del catastro oficial.
 */
export type RolReferencia = 'historico' | 'proyecto';

export type RolCapa = RolEntorno | RolGeologia | RolReferencia;

/**
 * Los patrones, EN ORDEN: gana el primero que casa, del más específico al más general.
 *
 * Es la misma lista que `electrum_rol_capa()` en scripts/electrum/esquema.sql, que es la que
 * rellenó las capas que ya estaban cargadas; esta es la que decide las que se suban desde ahora.
 * Dos copias porque la base las necesita para el relleno y la aplicación para no depender de que
 * la v7 esté aplicada. tests/electrum-entorno.test.ts compara las dos contra PostGIS: si alguien
 * toca una y no la otra, falla.
 *
 * Por qué ese orden: una «microcuenca» no es un río aunque hable de agua; un «Parque Nacional
 * Bosque Nublado» es un área protegida y no patrimonio forestal; «Aldeas del municipio» son aldeas.
 * Las palabras cortas van enteras: «aluvial» no es una red vial ni «estructura» una ruta.
 */
const ROLES: Array<[RolCapa, RegExp]> = [
  // Geología (v8) primero: «Fallas geológicas» es una falla, no una unidad de roca, y «Provincias
  // geológicas» tampoco; por eso litología va la última de las cinco.
  ['tracto_permisivo', /tractos? permisiv|permissive/],
  ['placa', /placas? tectonic|limites? de placas?|plate boundar|pb2002/],
  ['provincia_geologica', /provincias? geologic|geologic provinc/],
  ['falla', /(^| )fallas?( |$)|(^| )faults?( |$)|lineamiento|estructuras? geologic|estructural/],
  ['litologia', /geolog|litolog|litholog|intrusiv|(^| )plutones?( |$)/],
  // Después de litología: un mapa geológico de JICA sigue siendo roca; las «zonas de JICA», historia.
  ['historico', /(^| )jica( |$)|(^| )mmaj( |$)|historic/],
  ['microcuenca', /microcuenca|cuencas? declarada/],
  ['zona_informal', /informal|artesanal|guiris|pequena mineria|(^| )mape( |$)/],
  ['ocurrencia', /ocurrencia|yacimiento|defomin|indicio|prospecto/],
  ['area_protegida', /protegida|sinaph|reserva biologica|parque nacional|refugio de vida/],
  ['forestal', /forestal|bosque/],
  ['poblado', /caserio|aldea|poblad|comunidad|localidad|asentamiento|ciudad/],
  ['carretera', /carretera|(^| )(red vial|vias?|caminos?|rutas?)( |$)/],
  ['departamento', /departament/],
  ['municipio', /municipi|municipal/],
  ['rio', /red hidric|hidrograf|(^| )(rios?|quebradas?|drenajes?|cauces?)( |$)/],
];

/** El rol que le toca a una capa por su nombre, o null si no casa con ninguno. */
export function rolDeCapa(nombre: string | null | undefined): RolCapa | null {
  const n = String(nombre || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  for (const [rol, re] of ROLES) if (re.test(n)) return rol;
  return null;
}

/**
 * ¿La base ya tiene `capa.rol`? Se pregunta una vez por conexión.
 *
 * El código llega a Render antes de que alguien aplique la v7 en el nodo, y un INSERT que nombra
 * una columna inexistente tumbaría TODA carga de capas —también las de concesiones, que no
 * necesitan rol—. Sin la columna se guarda como siempre y el entorno calcula el rol al vuelo.
 */
let conRol: Promise<boolean> | null = null;
export function baseTieneRol(): Promise<boolean> {
  if (!conRol) {
    conRol = consulta<{ si: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'capa' AND column_name = 'rol') AS si`
    )
      .then((r) => !!r[0]?.si)
      .catch(() => {
        conRol = null;
        return false;
      });
  }
  return conRol;
}

/**
 * Guarda una capa leída por el motor GIS. Los polígonos entran como concesiones; lo demás, como
 * entidades geográficas. Todo en una transacción: una carga a medias es peor que ninguna.
 */
export async function guardarCapa(
  capa: Capa,
  opts: { archivo?: string; subidoPor?: string; avisos?: unknown[]; comoConcesiones?: boolean } = {}
): Promise<{ capaId: number; concesiones: number; entidades: number; repetidas: number; reparadas: number; vacias: number }> {
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
    /** Polígonos que venían rotos y entraron reparados. */
    let nInv = 0;
    /** Polígonos tan rotos que al repararlos no quedó superficie: no entran. */
    let nVac = 0;
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
        /*
         * En el mismo viaje se pregunta si cada polígono es VÁLIDO.
         *
         * Un lindero que se cruza consigo mismo (un «moño», dos vértices dibujados al revés) es
         * más común de lo que parece en un catastro digitalizado a mano. Guardado tal cual, el
         * primer cruce de traslapes que lo toca revienta con «TopologyException» y, como el cruce
         * es del padrón entero, a partir de ahí CADA carga de cualquier persona termina en error.
         * Se repara al entrar (`GEOM_VALIDA`), se mide sobre lo reparado y se avisa de cuántos fueron.
         */
        const revision = await cliente.query<{ pos: string; repetida: boolean; invalida: boolean; vacia: boolean }>(
          `SELECT t.pos::text AS pos,
                  EXISTS (SELECT 1 FROM concesion c WHERE c.huella = md5(ST_AsBinary(ST_Normalize(${GEOM_VALIDA('t.g')})))) AS repetida,
                  NOT ST_IsValid(ST_Force2D(ST_GeomFromGeoJSON(t.g))) AS invalida,
                  ST_IsEmpty(${GEOM_VALIDA('t.g')}) AS vacia
             FROM unnest($1::text[]) WITH ORDINALITY AS t(g, pos)`,
          [geoms]
        );
        const estado = new Map(revision.rows.map((r) => [Number(r.pos), r]));
        const yaEstan = new Set(revision.rows.filter((r) => r.repetida).map((r) => Number(r.pos)));
        nRep += yaEstan.size;
        const vacias = revision.rows.filter((r) => r.vacia && !r.repetida).length;
        nVac += vacias;

        const nuevas = concesiones.filter((_, k) => !yaEstan.has(k + 1) && !estado.get(k + 1)?.vacia);
        if (nuevas.length) {
          const valores: unknown[] = [];
          const marcas = nuevas.map(({ f, i }) => {
            const props = (f.properties || {}) as Record<string, unknown>;
            const declarada = Number(delDbf(props, 'hectareas'));
            const k = concesiones.findIndex((c) => c.f === f) + 1;
            const invalida = !!estado.get(k)?.invalida;
            if (invalida) nInv += 1;
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
              // El área buena la mide el motor GIS sobre el elipsoide, no el .dbf. Si el polígono
              // venía roto, la mide PostGIS sobre el reparado: el área de un «moño» no significa nada.
              invalida ? null : areaHectareas(f).toFixed(4),
              isFinite(declarada) && declarada > 0 ? declarada : null,
              JSON.stringify(props),
              JSON.stringify(f.geometry)
            );
            const n = (k: number) => `$${b + k}`;
            return `(${n(1)},${n(2)},${n(3)},${n(4)},${n(5)},${n(6)},${n(7)},${n(8)},${n(9)},${n(10)},${n(11)},${n(12)},${n(13)},${n(14)},${GEOM_VALIDA(n(15))})`;
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
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($${b + 5}), 4326)))`;
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
    /*
     * El rol, solo para geografía: una capa de derechos mineros que se llame «Concesiones del
     * municipio de Danlí» no es un municipio, y con rol la ficha la cruzaría como tal.
     */
    else if (!comoConcesiones && nEnt > 0 && (await baseTieneRol())) {
      const rol = rolDeCapa(capa.nombre);
      if (rol) await cliente.query('UPDATE capa SET rol = $2 WHERE id = $1', [capaId, rol]);
    }
    // Los reparados entraron sin área: se mide sobre la geometría que de verdad quedó guardada.
    if (nInv) await cliente.query('UPDATE concesion SET hectareas = ha_elipsoide(geom) WHERE capa_id = $1 AND hectareas IS NULL', [capaId]);

    await cliente.query('COMMIT');
    return { capaId: noAporto ? 0 : capaId, concesiones: nConc, entidades: nEnt, repetidas: nRep, reparadas: nInv, vacias: nVac };
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

/**
 * Cómo se nombra una concesión cuando hay más de una que se llama igual.
 *
 * En un padrón nacional se repiten los nombres —«Cerro Partido» en El Corpus y otro en Danlí, cargados
 * de dos capas distintas— y la respuesta era «coincide con varias: Cerro Partido, Cerro Partido.
 * Decime cuál», que nadie puede contestar. Con el expediente, el titular y el municipio al lado, sí.
 */
export function distinguir(f: FilaConcesion): string {
  const extra = [f.expediente, f.titular, f.municipio].filter(Boolean).join(', ');
  return extra ? `${f.nombre} (${extra}; id ${f.id})` : `${f.nombre} (id ${f.id})`;
}

const normal = (t: string) =>
  String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * De lo que devolvió la búsqueda, la que se nombró EXACTAMENTE, si es una sola.
 *
 * La búsqueda es tolerante a propósito, así que «Cerro Partido» trae también «Cerro Partido Norte»:
 * eso no convierte el pedido en ambiguo si solo una de las dos se llama así, o si se dio el
 * expediente o el id tal cual.
 */
export function unicaExacta(filas: FilaConcesion[], pedido: string): FilaConcesion | null {
  const q = normal(pedido);
  const exactas = filas.filter((f) => normal(f.nombre) === q || normal(f.expediente || '') === q || String(f.id) === q);
  return exactas.length === 1 ? exactas[0] : null;
}

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

/**
 * «Hoy» en Honduras. `CURRENT_DATE` es el día del servidor de base de datos —UTC en el nodo—, y de
 * las seis de la tarde a medianoche hondureña ya es mañana allí: una concesión que vence hoy salía
 * como vencida ayer. La fecha de un vencimiento es la del calendario de quien la tiene que renovar.
 */
const HOY_HN = `(now() AT TIME ZONE 'America/Tegucigalpa')::date`;

/** Las que vencen dentro de `dias`, de la más urgente a la menos. Las ya vencidas entran primero. */
export async function porVencer(dias = 365, limite = 50): Promise<Array<FilaConcesion & { dias: number }>> {
  return consulta(
    `SELECT ${CAMPOS_SELECT}, (vence - ${HOY_HN}) AS dias
     FROM concesion
     WHERE vence IS NOT NULL AND vence <= ${HOY_HN} + ($1 || ' days')::interval
     ORDER BY vence ASC
     LIMIT $2`,
    [String(dias), limite]
  );
}

/**
 * Las que vencen DENTRO de un año calendario de Honduras: «este año» es de hoy al 31 de diciembre
 * (lo ya vencido se cuenta aparte) y «el año que viene» es del 1 de enero al 31 de diciembre. Con
 * solo un tope de días, «el año que viene» traía primero todo lo anterior y, con el límite de la
 * lista, podía no enseñar ni una del año pedido (revisión de Codex en #45).
 */
export function rangoDeAnio(periodo: 'este_anio' | 'proximo_anio'): string {
  return periodo === 'este_anio'
    ? `vence >= ${HOY_HN} AND vence <= make_date(extract(year FROM ${HOY_HN})::int, 12, 31)`
    : `vence >= make_date(extract(year FROM ${HOY_HN})::int + 1, 1, 1) AND vence <= make_date(extract(year FROM ${HOY_HN})::int + 1, 12, 31)`;
}

export async function vencenEnAnio(periodo: 'este_anio' | 'proximo_anio', limite = 50): Promise<{ filas: Array<FilaConcesion & { dias: number }>; total: number }> {
  const donde = `vence IS NOT NULL AND ${rangoDeAnio(periodo)}`;
  const [filas, [c]] = await Promise.all([
    consulta<FilaConcesion & { dias: number }>(`SELECT ${CAMPOS_SELECT}, (vence - ${HOY_HN}) AS dias FROM concesion WHERE ${donde} ORDER BY vence ASC LIMIT $1`, [limite]),
    consulta<{ n: number }>(`SELECT count(*)::int AS n FROM concesion WHERE ${donde}`),
  ]);
  return { filas, total: Number(c?.n || 0) };
}

/** Cuántas vencen dentro de la ventana, sin límite: la cifra que se afirma, no el largo de la lista. */
export async function contarPorVencer(dias = 365): Promise<number> {
  const [r] = await consulta<{ n: number }>(
    `SELECT count(*)::int AS n FROM concesion
     WHERE vence IS NOT NULL AND vence <= ${HOY_HN} + ($1 || ' days')::interval`,
    [String(dias)]
  );
  return Number(r?.n || 0);
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
  const filas = await consulta<{ g: string; id: number; nombre: string; titular: string | null; estado: string | null; ha: number | null; vence: string | null }>(
    // Seis decimales son once centímetros: de sobra para pintar, y el cuerpo baja un cuarto frente a
    // los quince que manda PostGIS por defecto (ruido de coma flotante que nadie ve).
    `SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, $2), 6)::text AS g,
            id, nombre, titular, estado, hectareas::float8 AS ha, to_char(vence, 'YYYY-MM-DD') AS vence
       FROM concesion
      WHERE geom IS NOT NULL
      ORDER BY hectareas DESC NULLS LAST
      LIMIT $1`,
    [limite, toleranciaGrados]
  ).then(conTextoReparado);
  return {
    type: 'FeatureCollection',
    features: filas.map((f) => ({
      type: 'Feature',
      geometry: JSON.parse(f.g) as Geometry,
      properties: { id: f.id, nombre: f.nombre, titular: f.titular, estado: f.estado, hectareas: f.ha, ...(f.vence ? { vence: f.vence } : {}) },
    })),
  } as FeatureCollection;
}

/**
 * Las zonas donde dos concesiones se pisan, con su geometría, para rayarlas en el mapa. Las más
 * grandes primero y con tope: son para verlas, no para medir (eso lo hace `traslapes`).
 */
export async function traslapesGeojson(limite = 3000, toleranciaGrados = 0.0001): Promise<FeatureCollection> {
  const filas = await consulta<{ g: string; a: string; b: string; ha: number }>(
    `SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(t.geom, $2), 6)::text AS g,
            ca.nombre AS a, cb.nombre AS b, t.hectareas::float8 AS ha
       FROM traslape t JOIN concesion ca ON ca.id = t.a_id JOIN concesion cb ON cb.id = t.b_id
      WHERE t.geom IS NOT NULL AND NOT ST_IsEmpty(t.geom)
      ORDER BY t.hectareas DESC
      LIMIT $1`,
    [limite, toleranciaGrados]
  ).then(conTextoReparado);
  return {
    type: 'FeatureCollection',
    features: filas.map((f) => ({ type: 'Feature', geometry: JSON.parse(f.g) as Geometry, properties: { a: f.a, b: f.b, hectareas: f.ha } })),
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

/**
 * Cuántos traslapes hay y cuánta superficie pisan, contando TODOS.
 *
 * `traslapes()` trae los mayores con un límite, que está bien para una tabla pero no para una cifra:
 * con 96 traslapes cargados, «hay 60» salía de contar la lista recortada. El total se pide aparte.
 */
export async function resumenTraslapes(): Promise<{ total: number; hectareas: number; ajenos: number }> {
  const [r] = await consulta<{ total: number; hectareas: number; ajenos: number }>(
    `SELECT count(*)::int AS total,
            coalesce(sum(t.hectareas), 0)::float8 AS hectareas,
            count(*) FILTER (WHERE coalesce(ca.titular, '') <> coalesce(cb.titular, ''))::int AS ajenos
     FROM traslape t
     JOIN concesion ca ON ca.id = t.a_id
     JOIN concesion cb ON cb.id = t.b_id`
  );
  return { total: Number(r?.total || 0), hectareas: Number(r?.hectareas || 0), ajenos: Number(r?.ajenos || 0) };
}

/** Los traslapes de UNA concesión, todos: no los que entren entre los mayores del país. */
export async function traslapesDe(id: number): Promise<Array<{ a: string; b: string; hectareas: number; a_id: number; b_id: number }>> {
  return consulta(
    `SELECT ca.nombre AS a, cb.nombre AS b, t.hectareas::float8 AS hectareas, t.a_id, t.b_id
     FROM traslape t
     JOIN concesion ca ON ca.id = t.a_id
     JOIN concesion cb ON cb.id = t.b_id
     WHERE t.a_id = $1 OR t.b_id = $1
     ORDER BY t.hectareas DESC`,
    [id]
  );
}

/**
 * Los traslapes que toca una capa recién cargada: entre sus propias concesiones Y contra todo lo que
 * ya estaba en el padrón. Es lo que hay que decirle a quien acaba de subirla; mirar solo dentro del
 * archivo le contaba «no se pisa ninguno» a una concesión que se come media de la vecina.
 */
export async function traslapesDeCapa(capaId: number): Promise<Array<{ a: string; b: string; hectareas: number }>> {
  return consulta(
    `SELECT ca.nombre AS a, cb.nombre AS b, t.hectareas::float8 AS hectareas
     FROM traslape t
     JOIN concesion ca ON ca.id = t.a_id
     JOIN concesion cb ON cb.id = t.b_id
     WHERE ca.capa_id = $1 OR cb.capa_id = $1
     ORDER BY t.hectareas DESC`,
    [capaId]
  );
}

/** Vuelve a calcular todos los traslapes del padrón. Devuelve cuántos encontró. */
export async function recalcularTraslapes(minimoHa = 0.01): Promise<number> {
  const [{ n }] = await consulta<{ n: number }>('SELECT recalcular_traslapes($1) AS n', [minimoHa]);
  return Number(n);
}

/** Una concesión por su id, con todos sus campos: la ficha que se abre al tocarla en el mapa. */
export async function concesionPorId(id: number): Promise<FilaConcesion | null> {
  const [f] = await consulta<FilaConcesion>(`SELECT ${CAMPOS_SELECT} FROM concesion WHERE id = $1`, [id]);
  return f ? { ...f, id: Number(f.id) } : null;
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

/**
 * Varias concesiones juntas, para pintarlas y encuadrarlas de una vez: lo que devolvió una
 * búsqueda con más de un resultado. El mapa enseña las candidatas mientras el doctor pregunta cuál.
 */
export async function geometriasDe(ids: number[]): Promise<{ geojson: FeatureCollection; encuadre: [number, number, number, number] } | null> {
  if (!ids.length) return null;
  const filas = await consulta<{ f: string; o: number; s: number; e: number; n: number }>(
    `SELECT json_build_object('type','Feature','geometry', ST_AsGeoJSON(geom)::json,
              'properties', json_build_object('id', id, 'nombre', nombre, 'expediente', expediente))::text AS f,
            ST_XMin(geom) o, ST_YMin(geom) s, ST_XMax(geom) e, ST_YMax(geom) n
       FROM concesion WHERE id = ANY($1::bigint[]) AND geom IS NOT NULL AND NOT ST_IsEmpty(geom)`,
    [ids]
  );
  if (!filas.length) return null;
  return {
    geojson: { type: 'FeatureCollection', features: filas.map((x) => JSON.parse(x.f)) },
    encuadre: [Math.min(...filas.map((x) => x.o)), Math.min(...filas.map((x) => x.s)), Math.max(...filas.map((x) => x.e)), Math.max(...filas.map((x) => x.n))],
  };
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
/**
 * LOS INFORMES EN INGLÉS SE BUSCAN EN ESPAÑOL.
 *
 * El índice de texto completo es español, y los informes de JICA (1978-1980) —y cualquier 43-101—
 * están en inglés: preguntar por «ley de oro» no encontraba «gold grade» aunque estuviera en cada
 * página. Los vectores cruzan idiomas, pero solo si hay nodo de vectores; esto no depende de nada.
 * Cada término técnico se busca también por su equivalente en inglés.
 */
export const GLOSARIO_MINERO: Record<string, string[]> = {
  oro: ['gold'], plata: ['silver'], cobre: ['copper'], plomo: ['lead'], zinc: ['zinc'], hierro: ['iron'],
  antimonio: ['antimony'], molibdeno: ['molybdenum'], manganeso: ['manganese'], estano: ['tin'], tungsteno: ['tungsten'],
  veta: ['vein'], vetas: ['veins'], vetilla: ['veinlet'], ley: ['grade'], leyes: ['grades', 'assay'],
  perforacion: ['drilling', 'boring'], sondeo: ['drill', 'boring'], sondeos: ['drill', 'borings'], pozo: ['hole'],
  muestra: ['sample'], muestras: ['samples'], muestreo: ['sampling'], falla: ['fault'], fallas: ['faults'],
  yacimiento: ['deposit', 'ore'], yacimientos: ['deposits', 'ore'], mena: ['ore'], mineralizacion: ['mineralization', 'mineralized'],
  alteracion: ['alteration'], porfido: ['porphyry'], skarn: ['skarn'], geoquimica: ['geochemical', 'geochemistry'],
  geofisica: ['geophysical', 'geophysics'], anomalia: ['anomaly'], anomalias: ['anomalies'], trinchera: ['trench'],
  trincheras: ['trenches'], reservas: ['reserves'], recursos: ['resources'], mina: ['mine'], minas: ['mines'],
  roca: ['rock'], rocas: ['rocks'], intrusivo: ['intrusive'], intrusivos: ['intrusive', 'intrusives'], granito: ['granite'],
  granodiorita: ['granodiorite'], andesita: ['andesite'], caliza: ['limestone'], calizas: ['limestones'], esquisto: ['schist'],
  filita: ['phyllite'], toba: ['tuff'], cuarzo: ['quartz'], pirita: ['pyrite'], galena: ['galena'], esfalerita: ['sphalerite'],
  calcopirita: ['chalcopyrite'], magnetita: ['magnetite'], recomendacion: ['recommendation'], recomendaciones: ['recommendations'],
  conclusion: ['conclusion'], conclusiones: ['conclusions'], geologia: ['geology', 'geological'], estructura: ['structure'],
  rumbo: ['strike', 'trend'], buzamiento: ['dip'], espesor: ['thickness', 'width'], ancho: ['width'], tonelaje: ['tonnage'],
  levantamiento: ['survey'], estudio: ['survey', 'study'], informe: ['report'], resumen: ['summary', 'abstract'],
  formacion: ['formation'], sector: ['sector'], area: ['area'], prospecto: ['prospect'], exploracion: ['exploration'],
  aluvial: ['alluvial', 'placer'], suelo: ['soil'], sedimentos: ['sediments', 'sediment'], quebrada: ['stream', 'creek'],
};

const sinTilde = (w: string) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Los términos de la búsqueda como `tsquery`, cada uno con su equivalente en inglés si lo tiene:
 * «ley oro» → `(ley | grade) & (oro | gold)`. Con `o` en vez de `y`, cualquiera de todos.
 * Devuelve null si ningún término tiene traducción: entonces sirve la búsqueda de siempre.
 */
export function consultaBilingue(limpio: string, union: '&' | '|' = '&'): string | null {
  const palabras = limpio
    .split(/\s+/)
    .map((w) => w.replace(/['\\:&|!()<>*"-]/g, ''))
    .filter((w) => w.length >= 2)
    .slice(0, 10);
  let traducida = false;
  const grupos = palabras.map((w) => {
    const en = GLOSARIO_MINERO[sinTilde(w)];
    if (!en) return w;
    traducida = true;
    return `(${[w, ...en].join(' | ')})`;
  });
  return traducida && grupos.length ? grupos.join(` ${union} `) : null;
}

/**
 * «Solo en este documento o carpeta»: cada palabra del filtro tiene que aparecer en el nombre o en
 * la carpeta del documento («JICA Fase III» encuentra «JICA-MMAJ 2003 … Fase III (OCR).txt»;
 * «INDEXSA» encuentra todo lo de la carpeta «INDEXSA SEP 2026/…»). Devuelve el trozo de SQL y sus
 * parámetros a partir de `desde`.
 */
export function filtroDocumento(documento: string | undefined, desde: number): { sql: string; args: string[] } {
  // «#123»: ese documento y ningún otro (lo usa la búsqueda previa del turno cuando ya sabe cuál es).
  const porId = /^#(\d{1,9})$/.exec(String(documento || '').trim());
  if (porId) return { sql: ` AND d.id = $${desde}::bigint`, args: [porId[1]] };
  const palabras = String(documento || '')
    .split(/[\s/_,.;:()«»"'-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2)
    .slice(0, 6);
  if (!palabras.length) return { sql: '', args: [] };
  const sql = palabras
    .map((_, i) => `unaccent(lower(d.nombre || ' ' || coalesce(d.carpeta, ''))) LIKE unaccent(lower($${desde + i})) ESCAPE '\\'`)
    .join(' AND ');
  return { sql: ` AND ${sql}`, args: palabras.map((w) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) };
}

export async function buscarPorTexto(
  texto: string,
  limite = 8,
  opts: { documento?: string } = {}
): Promise<Array<{ id: number; documento: string; pagina: number | null; texto: string; puntaje: number }>> {
  const limpio = terminosDeBusqueda(texto);
  const filtro = filtroDocumento(opts.documento, 3);
  if (!limpio) {
    if (!filtro.sql) return [];
    // Sin términos útiles pero con documento: el comienzo del documento, que es de lo que trata.
    return primerosFragmentos(opts.documento, limite);
  }

  /*
   * `ts_headline` recorta el trozo ALREDEDOR de lo que coincidió, en vez de devolver el principio
   * del fragmento. Es la diferencia entre citar «la ley media ponderada es de 3,4 g/t» y citar el
   * encabezado del informe: lo segundo es técnicamente la misma fuente y no le sirve a nadie.
   */
  const SQL = (op: string) => `
    WITH q AS (SELECT ${op} AS tq)
    SELECT f.id, d.nombre AS documento, f.pagina,
           ts_headline('spanish', f.texto, q.tq,
             'MaxWords=55, MinWords=25, ShortWord=3, MaxFragments=2, FragmentDelimiter=" … ", StartSel="", StopSel=""') AS texto,
           ts_rank(f.tsv, q.tq)::float8 AS puntaje
    FROM fragmento f
    JOIN documento d ON d.id = f.documento_id, q
    WHERE f.tsv @@ q.tq${filtro.sql}
    ORDER BY puntaje DESC
    LIMIT $2`;

  const bilingue = consultaBilingue(limpio, '&');
  const exacto = await consulta<any>(
    bilingue ? SQL("to_tsquery('spanish', $1)") : SQL("websearch_to_tsquery('spanish', $1)"),
    [bilingue || limpio, limite, ...filtro.args]
  );
  if (exacto.length) return exacto;

  // Segunda pasada: cualquiera de los términos, que es lo que un humano espera de un buscador.
  const sueltos = limpio
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 8)
    .map((w) => w.replace(/['\\:&|!()<>]/g, ''))
    .filter(Boolean)
    .join(' | ');
  if (!sueltos) return filtro.sql ? primerosFragmentos(opts.documento, limite) : [];
  const alguno = await consulta<any>(SQL("to_tsquery('spanish', $1)"), [consultaBilingue(limpio, '|') || sueltos, limite, ...filtro.args]);
  if (alguno.length || !filtro.sql) return alguno;
  return primerosFragmentos(opts.documento, limite);
}

/** El comienzo de los documentos que casan con el filtro: portada, índice, resumen. */
async function primerosFragmentos(documento: string | undefined, limite: number) {
  const filtro = filtroDocumento(documento, 2);
  if (!filtro.sql) return [];
  return consulta<{ id: number; documento: string; pagina: number | null; texto: string; puntaje: number }>(
    `SELECT f.id, d.nombre AS documento, f.pagina, left(f.texto, 700) AS texto, 0::float8 AS puntaje
       FROM fragmento f JOIN documento d ON d.id = f.documento_id
      WHERE f.orden < 3${filtro.sql}
      ORDER BY d.id, f.orden
      LIMIT $1`,
    [limite, ...filtro.args]
  );
}

export type HitExpediente = { documento: string; pagina: number | null; texto: string; puntaje: number; via?: 'texto' | 'significado' | 'ambos' };

/**
 * La búsqueda de expedientes que usa Dr Electrum: HÍBRIDA si hay vectores (texto completo +
 * significado, fundidos por rango), y solo por texto si no. Lo que sale queda anotado en la traza
 * del turno como documento consultado.
 */
export async function buscarEnExpedientes(texto: string, limite = 8, opts: { documento?: string } = {}): Promise<HitExpediente[]> {
  const [porTexto, porSignificado] = await Promise.all([
    buscarPorTexto(texto, Math.max(limite, 20), opts),
    buscarPorSignificado(texto, Math.max(limite, 20), opts).catch(() => []),
  ]);
  let hits: HitExpediente[];
  if (!porSignificado.length) {
    hits = porTexto.slice(0, limite).map(({ id: _id, ...h }) => ({ ...h, via: 'texto' as const }));
  } else {
    const fundidos = fundirPorRango<{ id: number; documento: string; pagina: number | null; texto: string }>([porTexto, porSignificado], (x) => String(x.id));
    hits = fundidos.slice(0, limite).map(({ item, puntaje, de }) => ({
      documento: item.documento,
      pagina: item.pagina,
      texto: item.texto,
      puntaje: Math.round(puntaje * 10000) / 10000,
      via: de.length > 1 ? ('ambos' as const) : de[0] === 0 ? ('texto' as const) : ('significado' as const),
    }));
  }
  for (const h of hits) trazaActual()?.documento({ fuente: h.documento, ref: h.pagina ? `p. ${h.pagina}` : undefined, puntaje: h.puntaje });
  return hits;
}

/** Dónde retomar: la página y, si se cortó dentro de ella, cuántos trozos de esa página ya se leyeron. */
export type Cursor = { pagina: number; trozo: number };

export type LecturaSeguida =
  | { ok: false; candidatos: string[] }
  | {
      ok: true;
      documento: string;
      carpeta: string | null;
      desde: number;
      hasta: number;
      ultima: number | null;
      sigue: Cursor | null;
      texto: string;
      otros: string[];
    };

/**
 * Leer SEGUIDO un documento desde una página: el capítulo que el índice o la búsqueda ubicaron.
 * La búsqueda devuelve trozos sueltos y cortos; para contestar «qué concluye el capítulo 5» hay que
 * leer las páginas enteras. Devuelve hasta `tope` caracteres y dice dónde sigue.
 *
 * El corte puede caer dentro de una página (una hoja de cálculo es una sola página enorme): por eso
 * el cursor lleva también el trozo, y `trozo` salta los ya leídos de la primera página. Con solo el
 * número de página, retomar repetiría el mismo comienzo para siempre.
 *
 * `documento` es parte del nombre o de la carpeta (como en la búsqueda) o el número del documento.
 * Entre varios que casan gana el que trae la frase entera en el nombre y, después, el de más texto:
 * «Fase III» tiene que dar el informe de 125 páginas y no un mapa de una.
 */
export async function leerSeguido(
  documento: string,
  desde = 1,
  opts: { paginas?: number; tope?: number; trozo?: number } = {}
): Promise<LecturaSeguida> {
  const ref = String(documento || '').trim().slice(0, 160);
  const paginas = Math.max(1, Math.min(20, Math.floor(opts.paginas ?? 6)));
  const tope = Math.max(1000, Math.min(20000, opts.tope ?? 9000));
  const inicio = Math.max(1, Math.floor(Number(desde) || 1));
  const saltar = Math.max(0, Math.floor(Number(opts.trozo) || 0));
  const porId = /^#?(\d{1,9})$/.exec(ref);
  const filtro = porId ? { sql: ` AND d.id = $2`, args: [porId[1]] } : filtroDocumento(ref, 2);
  if (!filtro.sql) return { ok: false, candidatos: [] };
  const frase = `%${ref.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const candidatos = await consulta<{ id: number; nombre: string; carpeta: string | null; n: number; ultima: number | null }>(
    `SELECT d.id, d.nombre, d.carpeta, count(f.id)::int AS n, max(f.pagina) AS ultima
       FROM documento d JOIN fragmento f ON f.documento_id = d.id
      WHERE true${filtro.sql}
      GROUP BY d.id
      ORDER BY (unaccent(lower(d.nombre)) LIKE unaccent(lower($1)) ESCAPE '\\') DESC, count(f.id) DESC, d.id DESC
      LIMIT 6`,
    [frase, ...filtro.args]
  );
  if (!candidatos.length) return { ok: false, candidatos: [] };
  const d = candidatos[0];
  const conPaginas = d.ultima != null;
  // Con páginas se lee por página; sin ellas (un .txt sin saltos), `desde` cuenta trozos.
  const filas = await consulta<{ pagina: number | null; orden: number; texto: string }>(
    conPaginas
      ? `SELECT pagina, orden, texto FROM fragmento WHERE documento_id = $1 AND pagina >= $2 AND pagina < $3 ORDER BY orden`
      : `SELECT pagina, orden, texto FROM fragmento WHERE documento_id = $1 AND orden >= $2 - 1 AND orden < $3 - 1 ORDER BY orden`,
    [d.id, inicio, inicio + paginas]
  );
  let texto = '';
  let hasta = inicio - 1;
  let sigue: Cursor | null = null;
  let anterior: { pagina: number | null; texto: string } | null = null;
  let paginaActual: number | null = null;
  let enPagina = 0; // cuántos trozos de la página actual van (leídos o saltados)
  for (const f of filas) {
    const donde = conPaginas ? Number(f.pagina) : f.orden + 1;
    if (donde !== paginaActual) {
      paginaActual = donde;
      enPagina = 0;
    }
    const indice = enPagina++;
    // Los trozos ya leídos de la primera página se saltan, pero sirven para quitar la cola del siguiente.
    if (conPaginas && donde === inicio && indice < saltar) {
      anterior = { pagina: f.pagina, texto: f.texto };
      continue;
    }
    // Cada trozo empieza con la cola del anterior de la misma página (para la búsqueda): aquí sobra.
    let t = f.texto;
    if (anterior && anterior.pagina === f.pagina) {
      const cola = anterior.texto.slice(-120);
      if (cola.length >= 40 && t.startsWith(cola)) t = t.slice(cola.length).replace(/^\s+/, '');
    }
    const cabeza = conPaginas && donde !== hasta ? `\n[p. ${donde}${indice ? ', sigue' : ''}]\n` : '\n';
    if (texto.length + cabeza.length + t.length > tope && texto) {
      sigue = { pagina: donde, trozo: conPaginas ? indice : 0 };
      break;
    }
    texto += cabeza + t;
    hasta = donde;
    anterior = { pagina: f.pagina, texto: f.texto };
  }
  if (sigue == null) {
    // Lo que sigue es la próxima página QUE TIENE TEXTO: si el rango pedido estaba en blanco, avanzar.
    const [prox] = await consulta<{ p: number | null }>(
      conPaginas
        ? `SELECT min(pagina) AS p FROM fragmento WHERE documento_id = $1 AND pagina >= $2`
        : `SELECT min(orden) + 1 AS p FROM fragmento WHERE documento_id = $1 AND orden >= $2 - 1`,
      [d.id, inicio + paginas]
    );
    if (prox?.p != null) sigue = { pagina: Number(prox.p), trozo: 0 };
  }
  trazaActual()?.documento({ fuente: d.nombre, ref: conPaginas ? `pp. ${inicio}-${Math.max(inicio, hasta)}` : undefined, puntaje: 1 });
  return {
    ok: true,
    documento: d.nombre,
    carpeta: d.carpeta,
    desde: inicio,
    hasta: Math.max(inicio - 1, hasta),
    ultima: conPaginas ? d.ultima : d.n,
    sigue,
    texto: texto.trim(),
    otros: candidatos.slice(1).map((c) => c.nombre),
  };
}
