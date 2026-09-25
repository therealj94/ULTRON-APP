/**
 * Las tablas de la capa cognitiva. Idempotente: se aplica al primer uso en cada proceso y también a
 * mano (`scripts/cognitivo/esquema.mjs` la imprime para psql). Cada cambio futuro va como bloque
 * nuevo al final, nunca editando uno viejo.
 *
 * Viven en su propio esquema de Postgres (`cognitivo`) para no mezclarse con el catastro: se pueden
 * respaldar, vaciar o mover aparte sin tocar un polígono.
 */
export const ESQUEMA_COGNITIVO = `
CREATE SCHEMA IF NOT EXISTS cognitivo;

-- La cadena de auditoría. Cada fila firma a la anterior: borrar o cambiar una rompe todas las
-- que siguen, y verificarCadena() dice dónde.
CREATE TABLE IF NOT EXISTS cognitivo.auditoria (
  seq        bigserial PRIMARY KEY,
  t          timestamptz NOT NULL DEFAULT now(),
  tipo       text NOT NULL,
  plataforma text,
  quien      text,
  datos      jsonb NOT NULL,
  hash_prev  text NOT NULL,
  hash       text NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS auditoria_tipo_t ON cognitivo.auditoria (tipo, t DESC);

-- Un turno de conversación, de punta a punta.
CREATE TABLE IF NOT EXISTS cognitivo.traza_turno (
  id            uuid PRIMARY KEY,
  t_inicio      timestamptz NOT NULL,
  t_fin         timestamptz,
  plataforma    text NOT NULL,
  canal         text,
  quien         text,
  nivel         text,
  pregunta      text,
  clasificacion jsonb,
  agente        text,
  modelo        text,
  via           text,
  pasos         jsonb NOT NULL DEFAULT '[]',
  documentos    jsonb NOT NULL DEFAULT '[]',
  politica      jsonb NOT NULL DEFAULT '[]',
  respuesta     text,
  emocion       text,
  ms            integer,
  tokens_in     integer,
  tokens_out    integer,
  error         text,
  version       text,
  feedback      smallint,
  feedback_nota text,
  feedback_de   text
);
CREATE INDEX IF NOT EXISTS traza_turno_t ON cognitivo.traza_turno (plataforma, t_inicio DESC);
CREATE INDEX IF NOT EXISTS traza_turno_quien ON cognitivo.traza_turno (quien, t_inicio DESC);

-- Acciones que una regla mandó a revisión humana. La acción queda CONGELADA (herramienta +
-- argumentos + huella): lo que se aprueba es exactamente lo que se ejecuta.
CREATE TABLE IF NOT EXISTS cognitivo.aprobacion (
  id           uuid PRIMARY KEY,
  creada       timestamptz NOT NULL DEFAULT now(),
  vence        timestamptz NOT NULL,
  plataforma   text NOT NULL,
  herramienta  text NOT NULL,
  efecto       text NOT NULL DEFAULT 'escritura',
  argumentos   jsonb NOT NULL,
  huella       text NOT NULL,
  pedida_por   text,
  regla        text NOT NULL,
  motivo       text NOT NULL,
  riesgo       integer,
  necesarias   smallint NOT NULL DEFAULT 1,
  estado       text NOT NULL DEFAULT 'pendiente',
  firmas       jsonb NOT NULL DEFAULT '[]',
  resultado    jsonb,
  traza_id     uuid,
  contexto     jsonb
);
ALTER TABLE cognitivo.aprobacion ADD COLUMN IF NOT EXISTS efecto text NOT NULL DEFAULT 'escritura';
ALTER TABLE cognitivo.aprobacion ADD COLUMN IF NOT EXISTS contexto jsonb;
CREATE INDEX IF NOT EXISTS aprobacion_estado ON cognitivo.aprobacion (estado, creada DESC);

-- Memoria estructurada: las cosas del mundo (empresas, personas, proyectos, documentos,
-- concesiones, wallets) y cómo se relacionan. No reemplaza al RAG: es lo que se sabe con certeza.
CREATE TABLE IF NOT EXISTS cognitivo.entidad (
  id          bigserial PRIMARY KEY,
  plataforma  text NOT NULL,
  tipo        text NOT NULL,
  nombre      text NOT NULL,
  clave       text NOT NULL,
  atributos   jsonb NOT NULL DEFAULT '{}',
  estado      text,
  riesgo      text,
  creada      timestamptz NOT NULL DEFAULT now(),
  actualizada timestamptz NOT NULL DEFAULT now(),
  creada_por  text,
  UNIQUE (plataforma, tipo, clave)
);
CREATE INDEX IF NOT EXISTS entidad_nombre ON cognitivo.entidad (plataforma, lower(nombre));

CREATE TABLE IF NOT EXISTS cognitivo.relacion (
  id         bigserial PRIMARY KEY,
  desde      bigint NOT NULL REFERENCES cognitivo.entidad(id) ON DELETE CASCADE,
  hasta      bigint NOT NULL REFERENCES cognitivo.entidad(id) ON DELETE CASCADE,
  tipo       text NOT NULL,
  atributos  jsonb NOT NULL DEFAULT '{}',
  creada     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (desde, hasta, tipo)
);

CREATE TABLE IF NOT EXISTS cognitivo.evento (
  id         bigserial PRIMARY KEY,
  entidad    bigint NOT NULL REFERENCES cognitivo.entidad(id) ON DELETE CASCADE,
  t          timestamptz NOT NULL DEFAULT now(),
  tipo       text NOT NULL,
  detalle    text NOT NULL,
  fuente     text,
  quien      text
);
CREATE INDEX IF NOT EXISTS evento_entidad ON cognitivo.evento (entidad, t DESC);
`;
