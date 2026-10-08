/**
 * LA BIBLIOTECA — el panel de infraestructura de lo que sabe Dr Electrum.
 *
 * José lo pidió así: «un panel donde esté toda la información, que se pueda ver, eliminar,
 * agregar, ordenar en carpetas, y funciones para mantener qué información tiene Dr Electrum y, si
 * hay que actualizar, poder controlar cuáles».
 *
 * Hasta ahora lo cargado era una lista plana de expedientes y capas por fecha. Con cien documentos
 * se aguanta; con las 2 000 piezas de la carpeta de INDEXSA no se encuentra nada, y lo peor: no se
 * veía qué estaba MAL cargado. Los 37 PDF de INHGEOMIN que quedaron cortados en 8 000 caracteres se
 * descubrieron por casualidad, cuando Dr Electrum dijo que de un informe «solo tenía el índice».
 *
 * Aquí cada pieza lleva su ESTADO, calculado de lo que de verdad hay en la base:
 *
 *  - `sin_texto`   — no tiene ni un fragmento: un escaneo sin leer. Dr Electrum no sabe nada de él.
 *  - `cortado`     — la firma del tope viejo: varias páginas y ~8 000 caracteres justos.
 *  - `poco_texto`  — menos de 400 caracteres por página: formularios con mucha imagen, escaneos
 *                    a medias. Sabe algo, no todo.
 *  - `repetido`    — hay otro documento con el mismo nombre (otra versión, o el mismo dos veces).
 *  - `vacia`       — una capa sin ninguna geometría.
 *  - `ok`.
 *
 * Y cada acción que cambia algo queda en la bitácora: quién, qué y cuándo. En un sistema que
 * contesta con fuentes, «¿quién borró el informe de Minas de Oro?» tiene que tener respuesta.
 */
import { baseTieneRol, consulta, enTransaccion, hayBase, olvidarConfigDeTexto, olvidarEsquemaV10 } from './db';
import { cargarTexto, huellaDe, releerDocumento } from './aprender';
import { olvidarTablero } from './tablero';
import { bajarExpediente, bucketExpedientes } from '../../lib/s3';
import { asegurarOrganizacion, organizacionActual, organizacionParaGuardar, sqlCapaPropia, sqlCapaVisible, sqlDocumentoVisible } from './organizacion';

/* ------------------------------------------------------------------------------ esquema */

const ESQUEMA = [
  `ALTER TABLE documento ADD COLUMN IF NOT EXISTS carpeta text`,
  `ALTER TABLE documento ADD COLUMN IF NOT EXISTS releido timestamptz`,
  `ALTER TABLE capa ADD COLUMN IF NOT EXISTS carpeta text`,
  `CREATE INDEX IF NOT EXISTS documento_carpeta_idx ON documento (carpeta)`,
  `CREATE INDEX IF NOT EXISTS capa_carpeta_idx ON capa (carpeta)`,
  `CREATE TABLE IF NOT EXISTS biblioteca_bitacora (
     id bigserial PRIMARY KEY, cuando timestamptz NOT NULL DEFAULT now(), quien text,
     accion text NOT NULL, objeto text, detalle jsonb NOT NULL DEFAULT '{}'::jsonb)`,
  `CREATE INDEX IF NOT EXISTS biblioteca_bitacora_cuando_idx ON biblioteca_bitacora (cuando DESC)`,
  `CREATE TABLE IF NOT EXISTS importacion (
     id bigserial PRIMARY KEY, prefijo text NOT NULL, carpeta text,
     estado text NOT NULL DEFAULT 'en_curso', total integer NOT NULL DEFAULT 0,
     hechos integer NOT NULL DEFAULT 0, nuevos integer NOT NULL DEFAULT 0,
     repetidos integer NOT NULL DEFAULT 0, fallos integer NOT NULL DEFAULT 0,
     omitidos integer NOT NULL DEFAULT 0, por text,
     iniciada timestamptz NOT NULL DEFAULT now(), actualizada timestamptz NOT NULL DEFAULT now(),
     terminada timestamptz, detalle jsonb NOT NULL DEFAULT '[]'::jsonb)`,
  `ALTER TABLE importacion ADD COLUMN IF NOT EXISTS donde text`,
  `ALTER TABLE importacion ADD COLUMN IF NOT EXISTS opciones jsonb NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE importacion ADD COLUMN IF NOT EXISTS trabajo text`,
  `INSERT INTO esquema_version (version, nota)
     VALUES (9, 'panel de infraestructura: carpetas, bitácora e importaciones desde el cubo')
     ON CONFLICT (version) DO NOTHING`,
  // Lo que ya entró con la fecha vacía del .dbf leída como 1899 (ver `fecha` en db.ts): no es fecha.
  `UPDATE concesion SET vence = NULL WHERE vence < DATE '1901-01-01'`,
  `UPDATE concesion SET otorgada = NULL WHERE otorgada < DATE '1901-01-01'`,
];

/*
 * v10 (scripts/electrum/esquema.sql): los roles de referencia —histórico y proyecto—. Va aparte y
 * cada paso por su cuenta: una base sin `capa.rol` (anterior a la v7) no puede tomar la restricción,
 * y eso no debe dejar sin panel de infraestructura a quien la usa.
 */
/** Tablas de la v10 que no dependen de `capa.rol`: se aplican siempre. */
const ESQUEMA_V10_TABLAS = [
  // El catastro nacional trae la clase en `clasificac` y entró sin tipo: se rellena de sus atributos.
  `UPDATE concesion SET tipo = trim(coalesce(atributos->>'clasificac', atributos->>'CLASIFICAC')) WHERE tipo IS NULL AND (atributos ? 'clasificac' OR atributos ? 'CLASIFICAC')`,
  `ALTER TABLE capa ADD COLUMN IF NOT EXISTS huella text`,
  `CREATE INDEX IF NOT EXISTS capa_huella_idx ON capa (huella)`,
  `CREATE TABLE IF NOT EXISTS cartera (
  id          bigserial PRIMARY KEY,
  nombre      text NOT NULL UNIQUE,
  origen      text,
  por         text,
  creada      timestamptz NOT NULL DEFAULT now(),
  actualizada timestamptz NOT NULL DEFAULT now()
)`,
  `CREATE TABLE IF NOT EXISTS cartera_concesion (
  cartera_id  bigint NOT NULL REFERENCES cartera(id) ON DELETE CASCADE,
  huella      text NOT NULL,
  expediente  text,
  nombre      text,
  atributos   jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (cartera_id, huella)
)`,
  `CREATE INDEX IF NOT EXISTS cartera_concesion_huella_idx ON cartera_concesion (huella)`,
];

const ESQUEMA_V10 = [
  `ALTER TABLE capa DROP CONSTRAINT IF EXISTS capa_rol_valido`,
  `ALTER TABLE capa ADD CONSTRAINT capa_rol_valido CHECK (rol IS NULL OR rol IN (
     'rio', 'poblado', 'area_protegida', 'microcuenca', 'carretera', 'municipio', 'departamento',
     'ocurrencia', 'zona_informal', 'forestal',
     'litologia', 'falla', 'placa', 'provincia_geologica', 'tracto_permisivo',
     'historico', 'proyecto'))`,
  // Sin reemplazar electrum_rol_capa(): en producción su dueño es el administrador de la base y el
  // usuario de la aplicación no puede («must be owner of function»). El patrón es el de `rolDeCapa`.
  `UPDATE capa c SET rol = 'historico'
    WHERE c.rol IS NULL AND lower(c.nombre) ~ '(^|[^a-z])(jica|mmaj)([^a-z]|$)|historic'
      AND EXISTS (SELECT 1 FROM entidad_geo e WHERE e.capa_id = c.id)`,
  `INSERT INTO esquema_version (version, nota)
     VALUES (10, 'catastro oficial único; capas de referencia: histórico y proyecto')
     ON CONFLICT (version) DO NOTHING`,
];

/*
 * v11: búsqueda sin tildes (db.ts, `configDeTexto`). `es_sin_tilde` es `spanish` con `unaccent`
 * delante del lematizador, y la columna `tsv` se regenera con ella. Regenerar reescribe la tabla de
 * fragmentos una vez (unos segundos por cada diez mil); después, cada arranque solo comprueba.
 */
const ESQUEMA_V11 = [
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'es_sin_tilde') THEN
       CREATE TEXT SEARCH CONFIGURATION es_sin_tilde (COPY = spanish);
       ALTER TEXT SEARCH CONFIGURATION es_sin_tilde ALTER MAPPING FOR hword, hword_part, word WITH unaccent, spanish_stem;
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
        WHERE d.adrelid = 'fragmento'::regclass AND a.attname = 'tsv' AND pg_get_expr(d.adbin, d.adrelid) LIKE '%es_sin_tilde%'
     ) THEN
       DROP INDEX IF EXISTS fragmento_tsv_idx;
       ALTER TABLE fragmento DROP COLUMN IF EXISTS tsv;
       ALTER TABLE fragmento ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('es_sin_tilde'::regconfig, texto)) STORED;
       CREATE INDEX fragmento_tsv_idx ON fragmento USING GIN (tsv);
     END IF;
   END $$`,
];

let listo: Promise<boolean> | null = null;
/** Las columnas y tablas del panel. Idempotente: se aplica una vez por arranque. */
export function asegurarBiblioteca(): Promise<boolean> {
  if (!hayBase()) return Promise.resolve(false);
  if (!listo) {
    listo = (async () => {
      for (const sql of ESQUEMA) await consulta(sql);
      for (const sql of ESQUEMA_V10_TABLAS) {
        await consulta(sql).catch((e) => console.error('[biblioteca] v10:', String(e?.message || e).slice(0, 200)));
      }
      if (await baseTieneRol()) {
        for (const sql of ESQUEMA_V10) {
          await consulta(sql).catch((e) => console.error('[biblioteca] v10:', String(e?.message || e).slice(0, 200)));
        }
      }
      for (const sql of ESQUEMA_V11) {
        await consulta(sql).catch((e) => console.error('[biblioteca] v11:', String(e?.message || e).slice(0, 200)));
      }
      olvidarConfigDeTexto();
      olvidarEsquemaV10();
      // Una importación que corría DENTRO de este servidor murió con el reinicio: se dice. Las que
      // corren en un trabajo de Render siguen vivas aunque el servidor se reinicie.
      await consulta(`UPDATE importacion SET estado = 'interrumpida', terminada = now() WHERE estado IN ('en_curso', 'parando') AND donde = 'servidor'`);
      return true;
    })().catch((e) => {
      console.error('[biblioteca] no pude preparar el esquema:', String(e?.message || e).slice(0, 200));
      listo = null;
      return false;
    });
  }
  return listo;
}

/* ------------------------------------------------------------------------------ carpetas */

/**
 * Una carpeta es una ruta «A/B/C». Se limpia lo que llega: sin tramos vacíos, sin «..», sin
 * caracteres de control, hasta 8 niveles de 80 caracteres. Vacía es «sin carpeta» (null).
 */
export function normalizarCarpeta(c: unknown): string | null {
  const tramos = String(c ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\\/g, '/')
    .split('/')
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter((t) => t && t !== '.' && t !== '..')
    .map((t) => t.slice(0, 80))
    .slice(0, 8);
  return tramos.length ? tramos.join('/') : null;
}

function likeEscapado(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/* ------------------------------------------------------------------------------ estados */

export const ESTADOS = ['ok', 'sin_texto', 'cortado', 'poco_texto', 'repetido', 'vacia'] as const;
export type Estado = (typeof ESTADOS)[number];

let conVector: Promise<boolean> | null = null;
function hayVectores(): Promise<boolean> {
  if (!conVector) {
    conVector = consulta<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'fragmento' AND column_name = 'embedding'`
    )
      .then(([r]) => Number(r?.n || 0) > 0)
      .catch(() => false);
  }
  return conVector;
}

/**
 * Todo lo que sabe, como una sola tabla: documentos y capas juntos, cada uno con su estado. Es una
 * CTE y no una vista para no depender de un DDL más en producción; el coste es una agregación sobre
 * los fragmentos, que con decenas de miles tarda milisegundos.
 */
async function itemsCte(): Promise<string> {
  const sinv = (await hayVectores()) ? `count(*) FILTER (WHERE embedding IS NULL)::int` : `0`;
  return `
  WITH f AS (
    SELECT documento_id, count(*)::int AS n, coalesce(sum(length(texto)), 0)::int AS car, ${sinv} AS sinv
      FROM fragmento GROUP BY documento_id
  ),
  rep AS (SELECT lower(nombre) AS ln FROM documento d WHERE true${sqlDocumentoVisible('d')} GROUP BY 1 HAVING count(*) > 1),
  items AS (
    SELECT 'documento'::text AS clase, d.id, d.nombre, d.carpeta, d.subido, d.subido_por,
           coalesce(d.tipo, 'otro') AS detalle, coalesce(d.paginas, 0) AS cantidad,
           coalesce(f.n, 0) AS fragmentos, coalesce(f.car, 0) AS caracteres, coalesce(f.sinv, 0) AS sin_vector,
           (d.archivo IS NOT NULL) AS original, lower(substring(d.archivo from '\.([A-Za-z0-9]+)$')) AS ext_original, d.releido,
           CASE WHEN coalesce(f.n, 0) = 0 THEN 'sin_texto'
                -- La firma del tope viejo solo vale para lo leído CON ese tope: se quitó el 1-oct-2026
                -- (#106). Lo subido o releído después que mide ~8 000 caracteres es así de largo de
                -- verdad, y marcarlo «cortado» llenaba el panel de falsas alarmas.
                WHEN coalesce(d.paginas, 0) > 3 AND f.car BETWEEN 7400 AND 8200
                     AND d.subido < DATE '2026-10-02' AND d.releido IS NULL THEN 'cortado'
                WHEN coalesce(d.paginas, 0) >= 3 AND f.car < d.paginas * 400 THEN 'poco_texto'
                WHEN rep.ln IS NOT NULL THEN 'repetido'
                ELSE 'ok' END AS estado
      FROM documento d
      LEFT JOIN f ON f.documento_id = d.id
      LEFT JOIN rep ON rep.ln = lower(d.nombre)
     WHERE true${sqlDocumentoVisible('d')}
    UNION ALL
    SELECT 'capa', c.id, c.nombre, c.carpeta, c.subido, c.subido_por, c.formato, c.entidades,
           0, 0, 0, (c.archivo IS NOT NULL), lower(substring(c.archivo from '\.([A-Za-z0-9]+)$')), NULL::timestamptz,
           CASE WHEN c.entidades = 0 THEN 'vacia' ELSE 'ok' END
      FROM capa c
     WHERE true${sqlCapaVisible('c')}
  )`;
}

export type Item = {
  clase: 'documento' | 'capa';
  id: number;
  nombre: string;
  carpeta: string | null;
  subido: string;
  subido_por: string | null;
  detalle: string;
  cantidad: number;
  fragmentos: number;
  caracteres: number;
  sin_vector: number;
  original: boolean;
  /** La extensión del original («pdf», «jpg»…), sin la ruta del cubo. */
  ext_original: string | null;
  releido: string | null;
  estado: Estado;
};

/* ------------------------------------------------------------------------------ lectura */

export async function resumen() {
  await asegurarBiblioteca();
  const cte = await itemsCte();
  const [r] = await consulta<any>(
    `${cte}
     SELECT count(*) FILTER (WHERE clase = 'documento')::int AS documentos,
            count(*) FILTER (WHERE clase = 'capa')::int AS capas,
            count(DISTINCT carpeta)::int AS carpetas,
            count(*) FILTER (WHERE carpeta IS NULL)::int AS sin_carpeta,
            count(*) FILTER (WHERE estado <> 'ok')::int AS atencion,
            count(*) FILTER (WHERE original)::int AS con_original,
            coalesce(sum(fragmentos), 0)::int AS fragmentos,
            coalesce(sum(caracteres), 0)::bigint AS caracteres,
            coalesce(sum(sin_vector), 0)::int AS sin_vector,
            count(*) FILTER (WHERE estado = 'sin_texto')::int AS sin_texto,
            count(*) FILTER (WHERE estado = 'cortado')::int AS cortado,
            count(*) FILTER (WHERE estado = 'poco_texto')::int AS poco_texto,
            count(*) FILTER (WHERE estado = 'repetido')::int AS repetido,
            count(*) FILTER (WHERE estado = 'vacia')::int AS vacia
       FROM items`
  );
  return {
    documentos: r.documentos,
    capas: r.capas,
    carpetas: r.carpetas,
    sinCarpeta: r.sin_carpeta,
    atencion: r.atencion,
    conOriginal: r.con_original,
    fragmentos: r.fragmentos,
    caracteres: Number(r.caracteres),
    sinVector: r.sin_vector,
    porEstado: { sin_texto: r.sin_texto, cortado: r.cortado, poco_texto: r.poco_texto, repetido: r.repetido, vacia: r.vacia },
    cubo: !!bucketExpedientes(),
  };
}

/** Cada carpeta con lo que tiene directamente (el árbol lo arma la pantalla sumando hacia arriba). */
export async function arbol() {
  await asegurarBiblioteca();
  const cte = await itemsCte();
  return consulta<{ carpeta: string | null; documentos: number; capas: number; atencion: number }>(
    `${cte}
     SELECT carpeta,
            count(*) FILTER (WHERE clase = 'documento')::int AS documentos,
            count(*) FILTER (WHERE clase = 'capa')::int AS capas,
            count(*) FILTER (WHERE estado <> 'ok')::int AS atencion
       FROM items GROUP BY carpeta ORDER BY carpeta NULLS FIRST`
  );
}

const ORDENES: Record<string, string> = {
  nombre: 'lower(nombre)',
  subido: 'subido',
  cantidad: 'cantidad',
  caracteres: 'caracteres',
  estado: `CASE estado WHEN 'sin_texto' THEN 0 WHEN 'cortado' THEN 1 WHEN 'poco_texto' THEN 2 WHEN 'repetido' THEN 3 WHEN 'vacia' THEN 4 ELSE 5 END`,
  carpeta: `coalesce(carpeta, '')`,
};

export async function listar(p: {
  carpeta?: string;
  subcarpetas?: boolean;
  q?: string;
  estado?: string;
  clase?: string;
  orden?: string;
  dir?: string;
  desde?: number;
  limite?: number;
}): Promise<{ items: Item[]; total: number }> {
  await asegurarBiblioteca();
  const cte = await itemsCte();
  const donde: string[] = [];
  const args: unknown[] = [];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  if (p.carpeta === '~') donde.push('carpeta IS NULL');
  else if (p.carpeta) {
    const c = normalizarCarpeta(p.carpeta);
    if (c) {
      if (p.subcarpetas) donde.push(`(carpeta = ${arg(c)} OR carpeta LIKE ${arg(likeEscapado(c) + '/%')} ESCAPE '\\')`);
      else donde.push(`carpeta = ${arg(c)}`);
    }
  }
  if (p.q) donde.push(`unaccent(lower(nombre)) LIKE unaccent(lower(${arg(`%${likeEscapado(p.q.slice(0, 120))}%`)})) ESCAPE '\\'`);
  if (p.estado === 'atencion') donde.push(`estado <> 'ok'`);
  else if (p.estado && (ESTADOS as readonly string[]).includes(p.estado)) donde.push(`estado = ${arg(p.estado)}`);
  if (p.clase === 'documento' || p.clase === 'capa') donde.push(`clase = ${arg(p.clase)}`);
  const w = donde.length ? `WHERE ${donde.join(' AND ')}` : '';
  const orden = ORDENES[p.orden || ''] || ORDENES.subido;
  const dir = p.dir === 'asc' ? 'ASC' : p.dir === 'desc' ? 'DESC' : p.orden === 'nombre' || p.orden === 'estado' || p.orden === 'carpeta' ? 'ASC' : 'DESC';
  const limite = Math.max(1, Math.min(500, Math.floor(Number(p.limite) || 100)));
  const desde = Math.max(0, Math.min(100_000, Math.floor(Number(p.desde) || 0)));
  const [t] = await consulta<{ n: number }>(`${cte} SELECT count(*)::int AS n FROM items ${w}`, args);
  const items = await consulta<Item>(
    `${cte} SELECT * FROM items ${w} ORDER BY ${orden} ${dir}, clase, id LIMIT ${limite} OFFSET ${desde}`,
    args
  );
  return { items: items.map((i) => ({ ...i, id: Number(i.id) })), total: Number(t?.n || 0) };
}

/** Todo de una pieza: lo de la lista más un vistazo al texto (documento) o a su catastro (capa). */
export async function detalle(clase: string, id: number) {
  await asegurarBiblioteca();
  const cte = await itemsCte();
  const [item] = await consulta<Item>(`${cte} SELECT * FROM items WHERE clase = $1 AND id = $2`, [clase, id]);
  if (!item) return null;
  if (clase === 'documento') {
    const [d] = await consulta<{ archivo: string | null; huella: string | null; meta: any; concesion: string | null }>(
      `SELECT d.archivo, d.huella, d.meta, c.nombre AS concesion
         FROM documento d LEFT JOIN concesion c ON c.id = d.concesion_id WHERE d.id = $1`,
      [id]
    );
    const vistazo = await consulta<{ pagina: number; texto: string }>(
      `SELECT pagina, left(texto, 700) AS texto FROM fragmento WHERE documento_id = $1 ORDER BY orden LIMIT 3`,
      [id]
    );
    const paginas = await consulta<{ pagina: number; car: number }>(
      `SELECT pagina, sum(length(texto))::int AS car FROM fragmento WHERE documento_id = $1 GROUP BY pagina ORDER BY pagina`,
      [id]
    );
    return {
      ...item,
      id: Number(item.id),
      archivo: d?.archivo ? origenVisible(d.archivo) : null,
      huella: d?.huella || null,
      concesion: d?.concesion || null,
      laya: d?.meta?.laya ? { tipo: d.meta.laya.tipo, certeza: d.meta.laya.pTipo } : null,
      vistazo,
      paginasConTexto: paginas.length,
      paginasSinTexto: Math.max(0, Number(item.cantidad || 0) - paginas.length),
    };
  }
  const [c] = await consulta<{ archivo: string | null; rol: string | null; origen_crs: string; avisos: any; concesiones: number }>(
    `SELECT c.archivo, c.rol, c.origen_crs, c.avisos,
            (SELECT count(*)::int FROM concesion x WHERE x.capa_id = c.id) AS concesiones
       FROM capa c WHERE c.id = $1`,
    [id]
  );
  return {
    ...item,
    id: Number(item.id),
    archivo: c?.archivo ? origenVisible(c.archivo) : null,
    rol: c?.rol || null,
    origenCrs: c?.origen_crs || null,
    concesiones: Number(c?.concesiones || 0),
    avisos: Array.isArray(c?.avisos) ? c.avisos.slice(0, 8) : [],
  };
}

/** Originales que son fotos: esos no se releen con los lectores de texto. */
export const ES_FOTO = /\.(jpe?g|png|webp|heic|heif|bmp|tiff?)$/i;

/** «s3://cubo/entrada/X/y.pdf» → «entrada/X/y.pdf»: el nombre del cubo no le sirve a quien mira. */
function origenVisible(archivo: string): string {
  const m = /^s3:\/\/[^/]+\/(.+)$/.exec(archivo);
  return m ? m[1] : archivo;
}

/* ------------------------------------------------------------------------------ bitácora */

export async function anotar(quien: string | null | undefined, accion: string, objeto: string, detalle: Record<string, unknown> = {}) {
  // Cada anotación es de la organización de quien la hizo, y cada una lee solo las suyas (H14).
  await asegurarOrganizacion().catch(() => {});
  await consulta(`INSERT INTO biblioteca_bitacora (quien, accion, objeto, detalle, organizacion) VALUES ($1,$2,$3,$4,$5)`, [
    quien || null,
    accion,
    objeto.slice(0, 300),
    JSON.stringify(detalle),
    organizacionParaGuardar(),
  ]).catch((e) => console.error('[biblioteca] no pude anotar en la bitácora:', String(e?.message || e).slice(0, 160)));
}

export async function bitacora(limite = 100) {
  await asegurarBiblioteca();
  return consulta<{ id: number; cuando: string; quien: string | null; accion: string; objeto: string; detalle: any }>(
    `SELECT id, cuando, quien, accion, objeto, detalle FROM biblioteca_bitacora d WHERE true${sqlDocumentoVisible('d')} ORDER BY cuando DESC, id DESC LIMIT $1`,
    [Math.max(1, Math.min(500, limite))]
  );
}

/* ------------------------------------------------------------------------------ cambios */

export type Ref = { clase: 'documento' | 'capa'; id: number };

export function refsValidas(v: unknown): Ref[] {
  if (!Array.isArray(v)) return [];
  const out: Ref[] = [];
  for (const x of v.slice(0, 2000)) {
    const clase = (x as any)?.clase;
    const id = Math.floor(Number((x as any)?.id));
    if ((clase === 'documento' || clase === 'capa') && Number.isFinite(id) && id > 0) out.push({ clase, id });
  }
  return out;
}

const ids = (refs: Ref[], clase: Ref['clase']) => refs.filter((r) => r.clase === clase).map((r) => r.id);

/**
 * De lo pedido, solo lo que es de la organización de quien pide (auditoría H14): un cliente no
 * mueve, renombra, relee ni borra lo de otro, ni las capas comunes. Fuera de un ámbito, todo.
 */
async function propios(refs: Ref[]): Promise<Ref[]> {
  if (!organizacionActual()) return refs;
  const d = ids(refs, 'documento');
  const c = ids(refs, 'capa');
  const okD = d.length ? await consulta<{ id: string }>(`SELECT id::text FROM documento d WHERE id = ANY($1::bigint[])${sqlDocumentoVisible('d')}`, [d]) : [];
  const okC = c.length ? await consulta<{ id: string }>(`SELECT id::text FROM capa k WHERE id = ANY($1::bigint[])${sqlCapaPropia('k')}`, [c]) : [];
  return [...okD.map((x) => ({ clase: 'documento' as const, id: Number(x.id) })), ...okC.map((x) => ({ clase: 'capa' as const, id: Number(x.id) }))];
}

export async function mover(refs: Ref[], carpeta: unknown, quien?: string | null) {
  await asegurarBiblioteca();
  refs = await propios(refs);
  const destino = normalizarCarpeta(carpeta);
  const docs = ids(refs, 'documento');
  const capas = ids(refs, 'capa');
  let n = 0;
  if (docs.length) n += (await consulta(`UPDATE documento SET carpeta = $1 WHERE id = ANY($2::bigint[]) RETURNING id`, [destino, docs])).length;
  if (capas.length) n += (await consulta(`UPDATE capa SET carpeta = $1 WHERE id = ANY($2::bigint[]) RETURNING id`, [destino, capas])).length;
  await anotar(quien, 'mover', destino ? `carpeta ${destino}` : 'sin carpeta', { documentos: docs, capas, movidos: n });
  return { movidos: n, carpeta: destino };
}

export async function renombrarItem(ref: Ref, nombre: unknown, quien?: string | null) {
  await asegurarBiblioteca();
  const limpio = String(nombre ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  if (!limpio) return { ok: false as const, error: 'El nombre no puede quedar vacío.' };
  if (!(await propios([ref])).length) return { ok: false as const, error: 'Ya no existe.' };
  const tabla = ref.clase === 'documento' ? 'documento' : 'capa';
  const [antes] = await consulta<{ nombre: string }>(`SELECT nombre FROM ${tabla} WHERE id = $1`, [ref.id]);
  if (!antes) return { ok: false as const, error: 'Ya no existe.' };
  await consulta(`UPDATE ${tabla} SET nombre = $2 WHERE id = $1`, [ref.id, limpio]);
  await anotar(quien, 'renombrar', `${ref.clase} ${ref.id}`, { de: antes.nombre, a: limpio });
  return { ok: true as const, nombre: limpio };
}

/** Renombra o mueve una carpeta con todo lo que tiene dentro, subcarpetas incluidas. */
export async function renombrarCarpeta(de: unknown, a: unknown, quien?: string | null) {
  await asegurarBiblioteca();
  const origen = normalizarCarpeta(de);
  const destino = normalizarCarpeta(a);
  if (!origen) return { ok: false as const, error: 'Falta la carpeta de origen.' };
  if (destino && (destino === origen || destino.startsWith(origen + '/'))) {
    return { ok: false as const, error: 'Una carpeta no puede ir dentro de sí misma.' };
  }
  let n = 0;
  await enTransaccion(async (q) => {
    for (const tabla of ['documento', 'capa']) {
      const r = await q(
        `UPDATE ${tabla}
            SET carpeta = CASE WHEN carpeta = $1 THEN $2::text
                               WHEN $2::text IS NULL THEN substr(carpeta, length($1) + 2)
                               ELSE $2::text || substr(carpeta, length($1) + 1) END
          WHERE (carpeta = $1 OR carpeta LIKE $3 ESCAPE '\\')${tabla === 'documento' ? sqlDocumentoVisible(tabla) : sqlCapaPropia(tabla)}
          RETURNING id`,
        [origen, destino, likeEscapado(origen) + '/%']
      );
      n += r.length;
    }
  });
  await anotar(quien, 'carpeta', `carpeta ${origen}`, { a: destino, piezas: n });
  return { ok: true as const, piezas: n, carpeta: destino };
}

/**
 * Borrar de verdad. Un documento se lleva sus fragmentos; una capa, sus concesiones, entidades y
 * traslapes (así está el esquema, en cascada). El original en el cubo NO se toca: si se borró por
 * error, se vuelve a importar con «traer también lo borrado» (sin eso, lo borrado no vuelve solo).
 */
export async function eliminar(refs: Ref[], quien?: string | null) {
  await asegurarBiblioteca();
  await asegurarOrganizacion().catch(() => {});
  refs = await propios(refs);
  const docs = ids(refs, 'documento');
  const capas = ids(refs, 'capa');
  const quitados: Array<{ clase: string; id: number; nombre: string; archivo: string | null; huella?: string | null; concesiones?: number }> = [];
  await enTransaccion(async (q) => {
    if (docs.length) {
      const r = await q(`DELETE FROM documento WHERE id = ANY($1::bigint[]) RETURNING id, nombre, archivo, huella`, [docs]);
      for (const x of r as any[]) quitados.push({ clase: 'documento', id: Number(x.id), nombre: x.nombre, archivo: x.archivo || null, huella: x.huella || null });
    }
    if (capas.length) {
      const conc = await q(`SELECT capa_id, count(*)::int AS n FROM concesion WHERE capa_id = ANY($1::bigint[]) GROUP BY capa_id`, [capas]);
      const porCapa = new Map((conc as any[]).map((x) => [Number(x.capa_id), Number(x.n)]));
      const r = await q(`DELETE FROM capa WHERE id = ANY($1::bigint[]) RETURNING id, nombre, archivo`, [capas]);
      for (const x of r as any[]) quitados.push({ clase: 'capa', id: Number(x.id), nombre: x.nombre, archivo: x.archivo || null, concesiones: porCapa.get(Number(x.id)) || 0 });
    }
    // La bitácora va en la MISMA transacción: con el original y la huella anotados, una reimportación
    // no lo vuelve a traer, ni de esa clave ni de una copia en otra carpeta (ver importar.ts). Si la
    // anotación fallara aparte, lo borrado reviviría en silencio.
    for (const x of quitados) {
      await q(`INSERT INTO biblioteca_bitacora (quien, accion, objeto, detalle, organizacion) VALUES ($1, 'eliminar', $2, $3, $4)`, [
        quien || null,
        `${x.clase} ${x.id}`,
        JSON.stringify({ nombre: x.nombre, archivo: x.archivo, huella: x.huella, concesiones: x.concesiones }),
        organizacionParaGuardar(),
      ]);
    }
  });
  if (quitados.some((x) => x.clase === 'capa')) olvidarTablero();
  return { eliminados: quitados.length, quitados };
}

/** Volver a leer un documento desde su original en el cubo. */
export async function releer(id: number, quien?: string | null) {
  await asegurarBiblioteca();
  if (!(await propios([{ clase: 'documento', id }])).length) return { ok: false, dicho: 'Ese documento ya no existe.' };
  const [d] = await consulta<{ nombre: string; archivo: string | null }>(`SELECT nombre, archivo FROM documento WHERE id = $1`, [id]);
  if (!d) return { ok: false, dicho: 'Ese documento ya no existe.' };
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(d.archivo || '');
  if (!m) return { ok: false, dicho: 'No tengo el original guardado: para releerlo hay que volver a subirlo.' };
  if (m[1] !== bucketExpedientes()) return { ok: false, dicho: 'El original está en otro cubo al que este servidor no tiene acceso.' };
  // Una foto se lee con el ojo, no con los lectores de texto: releerla por aquí trataría los bytes
  // de la imagen como si fueran texto. Para renovar una transcripción, se vuelve a subir la foto.
  if (ES_FOTO.test(m[2])) return { ok: false, dicho: 'Es una foto: se lee con el ojo. Para renovar la transcripción, volvé a subirla.' };
  const bajado = await bajarExpediente(m[2]);
  if (!bajado.ok) return { ok: false, dicho: `No pude bajar el original: ${bajado.detalle}` };
  // El nombre del ORIGINAL decide el lector: si se renombró en el panel sin extensión, sigue siendo un PDF.
  const nombreLector = m[2].split('/').pop() || d.nombre;
  const r = await releerDocumento(id, nombreLector, bajado.datos);
  if (r.ok) await consulta(`UPDATE documento SET releido = now() WHERE id = $1`, [id]);
  await anotar(quien, 'releer', `documento ${id}`, { nombre: d.nombre, ok: r.ok, antes: r.antes, ahora: r.ahora });
  return r;
}

/** Cargar el texto de otra lectura (un OCR) en un documento que ya está. Ver `cargarTexto`. */
export async function cargarTextoEn(id: number, nombre: string, datos: Buffer, quien?: string | null, forzar = false, soloSiMejora = false) {
  await asegurarBiblioteca();
  if (!(await propios([{ clase: 'documento', id }])).length) return { ok: false as const, dicho: 'Ese documento ya no existe.' };
  const r = await cargarTexto(id, nombre, datos, { forzar, por: quien, soloSiMejora });
  if (r.ok) await consulta(`UPDATE documento SET releido = now() WHERE id = $1`, [id]);
  await anotar(quien, 'texto', `documento ${id}`, { archivo: nombre, ok: r.ok, antes: r.antes, ahora: r.ahora, forzar });
  return r;
}

/**
 * Un escaneo que no se pudo leer queda ANOTADO: una fila de documento sin fragmentos, con su
 * original, que el panel muestra como «sin texto». Así se sabe que existe y qué falta, y cuando
 * haya OCR se relee desde aquí. Dr Electrum no lo cita (no tiene texto), pero ya no se pierde.
 */
export async function anotarSinTexto(p: {
  nombre: string;
  datos: Buffer;
  carpeta: string | null;
  archivo: string;
  por?: string | null;
  motivo: string;
  /** Las páginas que ya contó pdf.js: volver a abrir un escaneo grande para contarlas son minutos. */
  paginas?: number | null;
}) {
  await asegurarBiblioteca();
  const paginas = p.paginas && p.paginas > 0 ? Math.floor(p.paginas) : null;
  const r = await consulta<{ id: number }>(
    `INSERT INTO documento (nombre, tipo, paginas, subido_por, huella, carpeta, archivo, meta, organizacion)
     VALUES ($1, 'escaneo', $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT DO NOTHING RETURNING id`,
    [p.nombre, paginas, p.por || null, huellaDe(p.datos), p.carpeta, p.archivo, JSON.stringify({ pendiente: 'ocr', motivo: p.motivo.slice(0, 200) }), organizacionParaGuardar()]
  );
  return r[0] ? Number(r[0].id) : null;
}
