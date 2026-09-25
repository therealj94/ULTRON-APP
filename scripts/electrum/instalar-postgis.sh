#!/usr/bin/env bash
#
# ELECTRUM — instala PostgreSQL + PostGIS en el nodo y deja el catastro listo.
#
# Pensado para correrse UNA vez en la máquina de AWS, como root o con sudo. Es idempotente: si algo
# ya está puesto, lo respeta y sigue. No toca nada de AU-RA ni de Genesis.
#
#   sudo bash instalar-postgis.sh
#   sudo CLAVE='una-clave-larga-de-verdad' bash instalar-postgis.sh
#
# Al terminar imprime el ELECTRUM_DB_URL que hay que poner en el servicio de Render.
#
# SOBRE LA RED: por defecto la base queda escuchando SOLO en localhost. Abrirla a internet es la
# forma más rápida de que alguien se lleve el catastro entero, así que si Render tiene que llegar
# hasta aquí, lo correcto es un túnel o una regla de grupo de seguridad hacia la IP de salida de
# Render, no `0.0.0.0/0`. El script no abre el puerto solo, a propósito: hay que decidirlo a mano.
set -euo pipefail

BASE="${BASE:-electrum}"
USUARIO="${USUARIO:-electrum}"
CLAVE="${CLAVE:-}"
PUERTO="${PUERTO:-5432}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
paso()  { printf '\n\033[36m== %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { rojo "Corré esto con sudo."; exit 1; }

# --- clave: si no la dan, se genera una y se muestra al final. Nunca una por defecto.
if [ -z "$CLAVE" ]; then
  CLAVE="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 28)"
  GENERADA=1
fi

paso "Detectando el sistema"
if [ -f /etc/os-release ]; then . /etc/os-release; else rojo "No reconozco este sistema."; exit 1; fi
echo "  $PRETTY_NAME"

paso "Instalando PostgreSQL y PostGIS"
case "$ID" in
  ubuntu|debian)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y --no-install-recommends postgresql postgresql-contrib postgis "postgresql-$(psql --version 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo 16)-postgis-3" 2>/dev/null \
      || apt-get install -y --no-install-recommends postgresql postgresql-contrib postgis
    ;;
  amzn|rhel|centos|rocky|almalinux)
    dnf install -y postgresql-server postgresql-contrib postgis || yum install -y postgresql-server postgresql-contrib postgis
    [ -d /var/lib/pgsql/data/base ] || postgresql-setup --initdb
    ;;
  *)
    rojo "Sistema no contemplado ($ID). Instalá postgresql y postgis a mano y volvé a correr esto."
    exit 1
    ;;
esac

paso "Arrancando el servicio"
systemctl enable --now postgresql
sleep 2
systemctl is-active --quiet postgresql || { rojo "PostgreSQL no arrancó. Mirá: journalctl -u postgresql -n 50"; exit 1; }

# pgvector: la búsqueda por significado (BGE-M3, 1024 dimensiones) sobre los fragmentos de los
# expedientes. Es opcional a propósito: si no se puede instalar, el esquema salta ese bloque y la
# búsqueda sigue siendo por palabras, como antes. Nada se rompe; solo se avisa.
paso "pgvector (búsqueda por significado)"
PGVER=$(su - postgres -c "psql -tAc 'SHOW server_version_num'" | cut -c1-2)
case "$ID" in
  ubuntu|debian)
    # Ubuntu 24.04 lo trae; 22.04 (la base de muchas AMI) no. Ahí se agrega el repositorio oficial
    # de PostgreSQL (PGDG), que publica pgvector para cada versión.
    if ! apt-get install -y --no-install-recommends "postgresql-${PGVER}-pgvector" 2>/dev/null; then
      apt-get install -y --no-install-recommends postgresql-common ca-certificates \
        && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
        && apt-get install -y --no-install-recommends "postgresql-${PGVER}-pgvector" \
        || SIN_VECTOR=1
    fi ;;
  amzn|rhel|centos|rocky|almalinux)
    dnf install -y "pgvector_${PGVER}" 2>/dev/null || dnf install -y pgvector 2>/dev/null || SIN_VECTOR=1 ;;
esac
if [ "${SIN_VECTOR:-0}" = "1" ]; then
  rojo "  no pude instalar pgvector: la búsqueda por significado queda apagada (la de palabras sigue)."
else
  echo "  pgvector instalado para PostgreSQL ${PGVER}"
fi

paso "Creando usuario y base"
# `psql -tAc` devuelve vacío si no existe: así no se intenta crear dos veces.
existe_rol=$(su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='${USUARIO}'\"" || true)
if [ -z "$existe_rol" ]; then
  su - postgres -c "psql -c \"CREATE ROLE ${USUARIO} LOGIN PASSWORD '${CLAVE}'\""
  echo "  usuario ${USUARIO} creado"
else
  su - postgres -c "psql -c \"ALTER ROLE ${USUARIO} LOGIN PASSWORD '${CLAVE}'\""
  echo "  usuario ${USUARIO} ya existía; clave actualizada"
fi

existe_base=$(su - postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='${BASE}'\"" || true)
if [ -z "$existe_base" ]; then
  su - postgres -c "createdb -O ${USUARIO} ${BASE}"
  echo "  base ${BASE} creada"
else
  echo "  base ${BASE} ya existía"
fi

paso "Aplicando el esquema"
if [ ! -f "${AQUI}/esquema.sql" ]; then
  rojo "No encuentro esquema.sql junto a este script. Copiá los dos archivos al nodo."
  exit 1
fi
# Las extensiones las tiene que crear un superusuario; el resto del esquema lo puede el dueño.
su - postgres -c "psql -d ${BASE} -v ON_ERROR_STOP=1 -f ${AQUI}/esquema.sql"
su - postgres -c "psql -d ${BASE} -c 'GRANT ALL ON SCHEMA public TO ${USUARIO}'"

# El esquema lo aplica postgres porque CREATE EXTENSION exige superusuario, así que todo queda
# siendo PROPIEDAD de postgres y el usuario de la aplicación solo tiene permisos prestados. No es lo
# mismo: con GRANT ALL se puede insertar y borrar, pero no ser dueño, y sin ser dueño fallan
# TRUNCATE ... RESTART IDENTITY («must be owner of sequence») y cualquier ALTER TABLE, que es
# exactamente lo que necesita la próxima migración del esquema. Se descubrió corriendo las pruebas
# conectado como `electrum` en vez de como superusuario; como superusuario pasaban todas.
#
# Se traspasa la propiedad de lo NUESTRO y solo de lo nuestro: lo que pertenece a una extensión
# —spatial_ref_sys y las vistas de PostGIS— se deja en paz, porque es de la extensión y cambiarlo
# es pelearse con su desinstalador.
paso "Traspasando la propiedad al usuario de la aplicación"
su - postgres -c "psql -d ${BASE} -v ON_ERROR_STOP=1 -c \"
DO \\\$\\\$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS nombre, c.relkind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r','S','v','m','p')
       AND NOT EXISTS (
             SELECT 1 FROM pg_depend d
              WHERE d.objid = c.oid AND d.deptype = 'e')
       -- Las secuencias de un bigserial cuelgan de su columna: heredan el dueño de la tabla y
       -- cambiarlo suelto lo rechaza el propio Postgres («cannot change owner of sequence»).
       AND NOT (c.relkind = 'S' AND EXISTS (
             SELECT 1 FROM pg_depend d
              WHERE d.objid = c.oid AND d.deptype = 'a'))
  LOOP
    IF r.relkind = 'S' THEN
      EXECUTE format('ALTER SEQUENCE %s OWNER TO %I', r.nombre, '${USUARIO}');
    ELSIF r.relkind IN ('v','m') THEN
      EXECUTE format('ALTER VIEW %s OWNER TO %I', r.nombre, '${USUARIO}');
    ELSE
      EXECUTE format('ALTER TABLE %s OWNER TO %I', r.nombre, '${USUARIO}');
    END IF;
  END LOOP;
END
\\\$\\\$;\""

paso "Comprobando que quedó bien"
VER_PG=$(su - postgres -c "psql -tAc 'SELECT version()'" | head -1)
VER_GIS=$(su - postgres -c "psql -d ${BASE} -tAc 'SELECT postgis_lib_version()'")
TABLAS=$(su - postgres -c "psql -d ${BASE} -tAc \"SELECT count(*) FROM information_schema.tables WHERE table_schema='public'\"")
echo "  ${VER_PG}"
echo "  PostGIS ${VER_GIS}"
echo "  ${TABLAS} tablas en el esquema"
VER_VECTOR=$(su - postgres -c "psql -d ${BASE} -tAc \"SELECT extversion FROM pg_extension WHERE extname='vector'\"")
if [ -n "${VER_VECTOR}" ]; then
  echo "  pgvector ${VER_VECTOR}: búsqueda por significado disponible (falta EMBED_URL en el servicio)"
else
  echo "  sin pgvector: búsqueda solo por palabras"
fi

# Una prueba de verdad: mide un cuadrado conocido y comprueba que la cuenta es geodésica.
AREA=$(su - postgres -c "psql -d ${BASE} -tAc \"SELECT round(ha_elipsoide(ST_GeomFromText('POLYGON((-86.6 14.0,-86.6 14.01,-86.59 14.01,-86.59 14.0,-86.6 14.0))',4326)))\"")
if [ "${AREA}" -ge 118 ] && [ "${AREA}" -le 122 ]; then
  echo "  medición geodésica correcta (${AREA} ha en el cuadrado de prueba)"
else
  rojo "  la medición dio ${AREA} ha y debería rondar 120. Revisá la instalación de PostGIS."
  exit 1
fi

verde "
Listo."
echo

# Con SILENCIO=1 la clave NO se imprime. Es para cuando esto se lanza por SSM: la salida de un
# comando de SSM queda guardada en el historial de AWS, y cualquiera con ssm:GetCommandInvocation
# la puede leer después. La contraseña de la base no puede vivir ahí. Se deja en un archivo que solo
# root puede abrir y se recoge entrando a la máquina.
DESTINO=/root/electrum-db-url
if [ "${SILENCIO:-0}" = "1" ]; then
  umask 077
  printf 'ELECTRUM_DB_URL=postgres://%s:%s@<ip-o-dns-del-nodo>:%s/%s\n' "${USUARIO}" "${CLAVE}" "${PUERTO}" "${BASE}" > "${DESTINO}"
  chmod 600 "${DESTINO}"
  echo "La cadena de conexión quedó en ${DESTINO}, solo legible por root."
  echo "No la imprimo aquí: la salida de SSM se guarda en el historial de AWS."
  echo "Recogela con:  sudo cat ${DESTINO}"
else
  echo "Poné esto en el servicio de Render de Electrum:"
  echo
  echo "  ELECTRUM_DB_URL=postgres://${USUARIO}:${CLAVE}@<ip-o-dns-del-nodo>:${PUERTO}/${BASE}"
  echo
  if [ "${GENERADA:-0}" = "1" ]; then
    rojo "La clave se generó sola y es la de arriba. Guardala ahora: no se vuelve a mostrar."
  fi
fi
cat <<'FIN'

Falta decidir la red, a mano y con criterio:

  1. Recomendado: túnel SSH desde donde corra el servidor, o VPN. Nada expuesto.
  2. Si hace falta abrir el puerto, abrilo SOLO a la IP de salida del servicio, nunca a 0.0.0.0/0,
     y editá en postgresql.conf:   listen_addresses = 'localhost,<ip-privada>'
     y en pg_hba.conf:             hostssl electrum electrum <ip>/32 scram-sha-256
     Después:                      systemctl reload postgresql

Un catastro completo es información sensible. Abrir 5432 a internet con una clave es, tarde o
temprano, regalarlo.
FIN
