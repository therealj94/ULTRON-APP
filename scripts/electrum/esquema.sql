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
