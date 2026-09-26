-- ELECTRUM — esquema del catastro y los expedientes.
--
-- Corre sobre PostgreSQL con PostGIS. Es idempotente: se puede aplicar tantas veces como haga falta.
-- Cada cambio futuro va como un bloque nuevo al final, nunca editando uno viejo, y la tabla
-- `esquema_version` deja constancia de hasta dónde se aplicó.
--
-- Decisiones que conviene entender antes de tocarlo:
--
--  * Todo se guarda en WGS84 (SRID 4326). La reproyección se hace al entrar, una sola vez, en el
--    motor GIS. Guardar cada capa en su propia proyección es cómodo el primer día y un infierno al
--    mes siguiente, cuando hay que cruzar dos capas que no coinciden.
--  * La geometría es MULTIPOLYGON, no POLYGON: una concesión puede venir partida en varios recintos
--    y obligarla a ser un solo polígono es perder datos.
--  * El área NO se guarda como la declaró el archivo: se guarda la medida sobre el elipsoide
--    (geography), y aparte la declarada, para poder mostrar la diferencia. Es la comprobación que
--    más pleitos evita.
--  * Los atributos originales del .dbf van completos en un JSONB. Un catastro real trae columnas que
--    nadie previó y tirarlas es perder el expediente.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- búsqueda por nombre aunque venga mal escrito
CREATE EXTENSION IF NOT EXISTS unaccent;  -- «Danlí» y «Danli» son lo mismo

CREATE TABLE IF NOT EXISTS esquema_version (
  version    integer PRIMARY KEY,
  aplicado   timestamptz NOT NULL DEFAULT now(),
  nota       text
);

-- ---------------------------------------------------------------- capas

-- Una capa es un archivo que alguien subió: un shapefile de concesiones, un KML de un bloque, etc.
CREATE TABLE IF NOT EXISTS capa (
  id           bigserial PRIMARY KEY,
  nombre       text NOT NULL,
  formato      text NOT NULL,              -- shapefile | geojson | kml | kmz | csv
  origen_crs   text NOT NULL,              -- lo que declaraba el .prj, tal cual
  archivo      text,                       -- dónde quedó el original (el expediente es la fuente)
  subido_por   text,
  subido       timestamptz NOT NULL DEFAULT now(),
  entidades    integer NOT NULL DEFAULT 0,
  descartadas  integer NOT NULL DEFAULT 0,
  avisos       jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (nombre, subido)
);

-- ---------------------------------------------------------------- concesiones

CREATE TABLE IF NOT EXISTS concesion (
  id             bigserial PRIMARY KEY,
  capa_id        bigint REFERENCES capa(id) ON DELETE CASCADE,
  expediente     text,
  nombre         text NOT NULL,
  titular        text,
  pais           text NOT NULL DEFAULT 'HN',
  departamento   text,
  municipio      text,
  tipo           text,                      -- exploración | explotación
  mineral        text,
  estado         text,                      -- vigente | en trámite | suspendida | vencida
  otorgada       date,
  vence          date,
  ambiental      text,
  -- Área medida sobre el elipsoide por el motor GIS, en hectáreas. Esta es la buena.
  hectareas      numeric(14, 4),
  -- Área tal como la declaraba el archivo o el expediente, para poder contrastar.
  hectareas_dec  numeric(14, 4),
  -- Todo lo que venía en el .dbf, sin perder nada.
  atributos      jsonb NOT NULL DEFAULT '{}'::jsonb,
  geom           geometry(MultiPolygon, 4326) NOT NULL,
  creado         timestamptz NOT NULL DEFAULT now(),
  actualizado    timestamptz NOT NULL DEFAULT now()
);

-- El índice que hace posible preguntar «qué se traslapa con esto» sobre un catastro nacional.
CREATE INDEX IF NOT EXISTS concesion_geom_idx ON concesion USING GIST (geom);
CREATE INDEX IF NOT EXISTS concesion_capa_idx ON concesion (capa_id);
CREATE INDEX IF NOT EXISTS concesion_vence_idx ON concesion (vence);
CREATE INDEX IF NOT EXISTS concesion_nombre_trgm ON concesion USING GIN (nombre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS concesion_titular_trgm ON concesion USING GIN (titular gin_trgm_ops);
CREATE INDEX IF NOT EXISTS concesion_atributos_idx ON concesion USING GIN (atributos);

-- ---------------------------------------------------------------- otras capas geográficas

-- Cualquier cosa que no sea una concesión: bocaminas, campamentos, ríos, caminos, poblados,
-- áreas protegidas. Se guarda con geometría genérica porque puede ser punto, línea o polígono.
CREATE TABLE IF NOT EXISTS entidad_geo (
  id         bigserial PRIMARY KEY,
  capa_id    bigint REFERENCES capa(id) ON DELETE CASCADE,
  nombre     text,
  clase      text,                          -- bocamina | poblado | rio | camino | area_protegida | otro
  atributos  jsonb NOT NULL DEFAULT '{}'::jsonb,
  geom       geometry(Geometry, 4326) NOT NULL,
  creado     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entidad_geo_geom_idx ON entidad_geo USING GIST (geom);
CREATE INDEX IF NOT EXISTS entidad_geo_capa_idx ON entidad_geo (capa_id);
CREATE INDEX IF NOT EXISTS entidad_geo_clase_idx ON entidad_geo (clase);

-- ---------------------------------------------------------------- expedientes (documentos)

CREATE TABLE IF NOT EXISTS documento (
  id            bigserial PRIMARY KEY,
  nombre        text NOT NULL,
  tipo          text,                       -- 43-101 | resolución | ensayo | plan de labores | otro
  concesion_id  bigint REFERENCES concesion(id) ON DELETE SET NULL,
  archivo       text,                       -- el original, intacto
  paginas       integer,
  subido_por    text,
  subido        timestamptz NOT NULL DEFAULT now(),
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS documento_concesion_idx ON documento (concesion_id);

-- Un documento se parte en trozos para poder citarlo con página. Sin la página, una cita no sirve
-- de nada: nadie puede ir a comprobarla, que es justo para lo que existe una cita.
CREATE TABLE IF NOT EXISTS fragmento (
  id            bigserial PRIMARY KEY,
  documento_id  bigint NOT NULL REFERENCES documento(id) ON DELETE CASCADE,
  pagina        integer,
  orden         integer NOT NULL,
  texto         text NOT NULL,
  -- Índice de texto completo en español, que es en lo que vienen los expedientes.
  tsv           tsvector GENERATED ALWAYS AS (to_tsvector('spanish', texto)) STORED
);
CREATE INDEX IF NOT EXISTS fragmento_doc_idx ON fragmento (documento_id, orden);
CREATE INDEX IF NOT EXISTS fragmento_tsv_idx ON fragmento USING GIN (tsv);

-- ---------------------------------------------------------------- traslapes

-- Los traslapes se calculan y se guardan: en un catastro nacional recalcularlos en cada pregunta
-- cuesta minutos, y son un hecho del padrón, no de la consulta.
CREATE TABLE IF NOT EXISTS traslape (
  id          bigserial PRIMARY KEY,
  a_id        bigint NOT NULL REFERENCES concesion(id) ON DELETE CASCADE,
  b_id        bigint NOT NULL REFERENCES concesion(id) ON DELETE CASCADE,
  hectareas   numeric(14, 4) NOT NULL,
  geom        geometry(MultiPolygon, 4326),
  calculado   timestamptz NOT NULL DEFAULT now(),
  CHECK (a_id < b_id),                      -- un par, una fila: nunca A-B y B-A
  UNIQUE (a_id, b_id)
);
CREATE INDEX IF NOT EXISTS traslape_geom_idx ON traslape USING GIST (geom);

-- ---------------------------------------------------------------- funciones de consulta

-- Área en hectáreas medida sobre el elipsoide. `geography` obliga a Postgres a hacer la cuenta
-- geodésica; con `geometry` la haría en grados cuadrados, que no significan nada.
CREATE OR REPLACE FUNCTION ha_elipsoide(g geometry) RETURNS numeric AS $$
  SELECT ROUND((ST_Area(g::geography) / 10000.0)::numeric, 4);
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;

-- Recalcula todos los traslapes del padrón. `&&` usa el índice espacial para descartar de golpe
-- los pares que ni se acercan; sin eso, esto no termina nunca con miles de polígonos.
CREATE OR REPLACE FUNCTION recalcular_traslapes(minimo_ha numeric DEFAULT 0.01)
RETURNS integer AS $$
DECLARE n integer;
BEGIN
  DELETE FROM traslape;
  INSERT INTO traslape (a_id, b_id, hectareas, geom)
  SELECT a.id, b.id,
         ha_elipsoide(ST_Intersection(a.geom, b.geom)),
         ST_Multi(ST_CollectionExtract(ST_Intersection(a.geom, b.geom), 3))
  FROM concesion a
  JOIN concesion b ON a.id < b.id AND a.geom && b.geom AND ST_Intersects(a.geom, b.geom)
  WHERE ha_elipsoide(ST_Intersection(a.geom, b.geom)) >= minimo_ha;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

INSERT INTO esquema_version (version, nota)
VALUES (1, 'catastro, entidades, expedientes con cita a página, traslapes')
ON CONFLICT (version) DO NOTHING;

-- ---------------------------------------------------------------- versión 2
--
-- Huella de la geometría, para no cargar dos veces lo mismo.
--
-- Cargar el mismo shapefile dos veces no solo duplica filas: hace que cada concesión aparezca
-- traslapada al 100 % con su propia copia, y el padrón entero parece un desastre de superposiciones
-- que no existe. Pasó en la primera prueba de carga y por eso está aquí.
--
-- ST_Normalize pone los anillos en un orden canónico, así que dos archivos con los vértices escritos
-- al revés dan la misma huella, que es lo que uno quiere.

ALTER TABLE concesion ADD COLUMN IF NOT EXISTS huella text
  GENERATED ALWAYS AS (md5(ST_AsBinary(ST_Normalize(geom)))) STORED;

CREATE INDEX IF NOT EXISTS concesion_huella_idx ON concesion (huella);

INSERT INTO esquema_version (version, nota)
VALUES (2, 'huella de geometría para no duplicar el catastro')
ON CONFLICT (version) DO NOTHING;

-- ---------------------------------------------------------------- versión 3
--
-- Huella del documento, para poder reanudar una carga grande.
--
-- El catastro ya no se duplicaba, pero los expedientes sí: cargar la misma carpeta dos veces metía
-- cada informe otra vez, y una búsqueda devolvía la misma cita dos y tres veces, con páginas
-- idénticas, como si dos peritos hubieran escrito lo mismo. Con 1,2 GB de expedientes la carga se
-- corta seguro alguna vez —una caída de red, un Ctrl-C—, y sin esto relanzarla ensucia la base en
-- lugar de continuarla.
--
-- La huella es del CONTENIDO, no del nombre: el mismo expediente llega con veinte nombres distintos
-- («informe.pdf», «informe (1).pdf», «Informe_final_v2.pdf») y son el mismo papel. Al revés también:
-- un nombre repetido con contenido distinto es una versión corregida y debe entrar.
--
-- El índice va sobre (huella, concesión) y no sobre la huella sola porque el mismo documento puede
-- estar legítimamente atado a dos concesiones distintas. COALESCE porque en SQL dos NULL no son
-- iguales, y sin él los documentos sin concesión —que son la mayoría— no quedarían protegidos.

ALTER TABLE documento ADD COLUMN IF NOT EXISTS huella text;

CREATE UNIQUE INDEX IF NOT EXISTS documento_huella_idx
  ON documento (huella, COALESCE(concesion_id, -1))
  WHERE huella IS NOT NULL;

INSERT INTO esquema_version (version, nota)
VALUES (3, 'huella de documento para reanudar cargas grandes sin duplicar')
ON CONFLICT (version) DO NOTHING;

-- ---------------------------------------------------------------- versión 4
--
-- El cruce de traslapes calculaba lo mismo tres veces.
--
-- La versión anterior invocaba `ST_Intersection` en el SELECT —dos veces, una para el área y otra
-- para la geometría— y una tercera en el WHERE, más `ha_elipsoide` dos veces. Intersecar dos
-- polígonos es de lo más caro que hay en PostGIS, y se hacía el triple de veces de las necesarias.
--
-- Con dos polígonos de prueba da igual. Con el padrón nacional de Honduras —siete mil concesiones
-- una vez cruzadas las capas de derechos mineros, áreas protegidas y microcuencas— la diferencia
-- es de minutos, y se nota cada vez que alguien sube una capa por la web.
--
-- Ahora se interseca una sola vez en una CTE, se mide una sola vez sobre esa intersección, y el
-- filtro usa la medida ya calculada. El resultado es idéntico; lo único que cambia es el trabajo.

CREATE OR REPLACE FUNCTION recalcular_traslapes(minimo_ha numeric DEFAULT 0.01)
RETURNS integer AS $$
DECLARE n integer;
BEGIN
  DELETE FROM traslape;
  INSERT INTO traslape (a_id, b_id, hectareas, geom)
  WITH pares AS (
    -- `&&` usa el índice espacial para descartar de golpe los pares que ni se acercan; sin eso,
    -- esto no termina nunca con miles de polígonos.
    SELECT a.id AS a_id, b.id AS b_id, ST_Intersection(a.geom, b.geom) AS corte
      FROM concesion a
      JOIN concesion b ON a.id < b.id AND a.geom && b.geom AND ST_Intersects(a.geom, b.geom)
  ),
  medidos AS (
    SELECT a_id, b_id, corte, ha_elipsoide(corte) AS ha FROM pares
  )
  SELECT a_id, b_id, ha, ST_Multi(ST_CollectionExtract(corte, 3))
    FROM medidos
   WHERE ha >= minimo_ha;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

INSERT INTO esquema_version (version, nota)
VALUES (4, 'el cruce de traslapes interseca una vez en vez de tres')
ON CONFLICT (version) DO NOTHING;

-- ---------------------------------------------------------------- 5 · búsqueda por significado

-- BGE-M3 da vectores de 1024 dimensiones. La columna y su índice solo se crean si pgvector está
-- instalado en el servidor (apt install postgresql-<versión>-pgvector): sin él, este bloque avisa y
-- sigue, y la búsqueda de expedientes se queda en texto completo, como siempre. Nada falla.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
    EXECUTE 'ALTER TABLE fragmento ADD COLUMN IF NOT EXISTS embedding vector(1024)';
    -- HNSW con coseno: los vectores de BGE-M3 vienen normalizados.
    EXECUTE 'CREATE INDEX IF NOT EXISTS fragmento_embedding_idx ON fragmento USING hnsw (embedding vector_cosine_ops)';
  ELSE
    RAISE NOTICE 'pgvector no está instalado: la búsqueda de expedientes sigue siendo por texto completo.';
  END IF;
END $$;

INSERT INTO esquema_version (version, nota)
VALUES (5, 'búsqueda por significado: fragmento.embedding (pgvector, si está)')
ON CONFLICT (version) DO NOTHING;

-- ---------------------------------------------------------------- versión 6
--
-- Un solo polígono roto tumbaba el cruce de traslapes del padrón entero.
--
-- Un lindero que se cruza consigo mismo —un «moño», dos vértices digitalizados al revés— es válido
-- para el .shp y para el mapa, pero `ST_Intersection` se niega a cortarlo: «TopologyException: side
-- location conflict». Como `recalcular_traslapes` cruza TODO el padrón, una sola concesión así hacía
-- fallar cada carga posterior de cualquier persona, y los traslapes se quedaban congelados en lo que
-- hubiera antes. La aplicación ya repara al guardar (server/electrum/db.ts, GEOM_VALIDA); esto
-- repara lo que hubiera entrado antes y deja el cruce a salvo de lo que se cuele por otro camino.

-- Un lindero degenerado (todo línea o punto) repararía a un polígono vacío: se deja como está en
-- vez de guardarlo vacío, porque sin centro ni encuadre el informe de esa concesión no se arma. Al
-- cruce no llega: `recalcular_traslapes` lo descarta.
UPDATE concesion
   SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3)),
       hectareas = ha_elipsoide(ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3)))
 WHERE NOT ST_IsValid(geom)
   AND NOT ST_IsEmpty(ST_CollectionExtract(ST_MakeValid(geom), 3));

CREATE OR REPLACE FUNCTION recalcular_traslapes(minimo_ha numeric DEFAULT 0.01)
RETURNS integer AS $$
DECLARE n integer;
BEGIN
  DELETE FROM traslape;
  INSERT INTO traslape (a_id, b_id, hectareas, geom)
  WITH validas AS (
    -- Lo que no sea válido se repara aquí, para el cruce, sin tocar la fila.
    -- Lo que al repararse queda vacío no tiene superficie con qué traslapar.
    SELECT id, geom FROM (
      SELECT id, CASE WHEN ST_IsValid(geom) THEN geom ELSE ST_CollectionExtract(ST_MakeValid(geom), 3) END AS geom
        FROM concesion
    ) r
     WHERE NOT ST_IsEmpty(r.geom)
  ),
  pares AS (
    SELECT a.id AS a_id, b.id AS b_id, ST_Intersection(a.geom, b.geom) AS corte
      FROM validas a
      JOIN validas b ON a.id < b.id AND a.geom && b.geom AND ST_Intersects(a.geom, b.geom)
  ),
  medidos AS (
    SELECT a_id, b_id, corte, ha_elipsoide(corte) AS ha FROM pares
  )
  SELECT a_id, b_id, ha, ST_Multi(ST_CollectionExtract(corte, 3))
    FROM medidos
   WHERE ha >= minimo_ha;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

INSERT INTO esquema_version (version, nota)
VALUES (6, 'polígonos rotos reparados y cruce de traslapes a prueba de ellos')
ON CONFLICT (version) DO NOTHING;
