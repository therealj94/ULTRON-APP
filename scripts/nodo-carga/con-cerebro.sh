#!/usr/bin/env bash
#
# ELECTRUM — corre un comando con el cerebro a mano: abre los túneles de SSM a la base (5432) y a los
# embeddings (TEI, 8794), exporta ELECTRUM_DB_URL y EMBED_URL, corre el comando y cierra los túneles.
# Se usa EN el nodo de carga, como root:
#
#   con-cerebro tsx scripts/electrum/ordenar-catastro.ts           propuesta de orden, no cambia nada
#   con-cerebro tsx scripts/electrum/ordenar-catastro.ts --aplicar
#   con-cerebro psql "$ELECTRUM_DB_URL" -c 'select count(*) from documento'
#
# `tsx` y las rutas relativas se resuelven en el código del nodo (/opt/electrum-carga/codigo).
# La clave sale de ELECTRUM_CLAVE_DB o de /root/.electrum/db-url, como en cargar-lote.
set -euo pipefail

[ $# -gt 0 ] || { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
CEREBRO="${CEREBRO:-i-06530893af0dd0638}"
EMBED_HOST="${EMBED_HOST:-172.31.23.34}"
P_DB="${P_DB:-55433}"
P_EMBED="${P_EMBED:-58795}"
CODIGO=/opt/electrum-carga/codigo
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

if [ -n "${ELECTRUM_CLAVE_DB:-}" ]; then CLAVE="$ELECTRUM_CLAVE_DB"
elif [ -r /root/.electrum/db-url ]; then
  CLAVE=$(python3 -c 'from urllib.parse import urlsplit; print(urlsplit(open("/root/.electrum/db-url").read().strip()).password or "")')
else read -rsp "Clave del usuario electrum: " CLAVE; echo; fi
[ -n "$CLAVE" ] || { echo "Sin clave no hay base." >&2; exit 1; }

# Puertos distintos de los de cargar-lote: los dos pueden correr a la vez.
PIDS=()
cerrar() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cerrar EXIT INT TERM
aws ssm start-session --target "$CEREBRO" --document-name AWS-StartPortForwardingSession \
  --parameters "{\"portNumber\":[\"5432\"],\"localPortNumber\":[\"${P_DB}\"]}" >/tmp/con-cerebro-db.log 2>&1 &
PIDS+=($!)
aws ssm start-session --target "$CEREBRO" --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"${EMBED_HOST}\"],\"portNumber\":[\"8794\"],\"localPortNumber\":[\"${P_EMBED}\"]}" >/tmp/con-cerebro-embed.log 2>&1 &
PIDS+=($!)
abierto() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
for _ in $(seq 1 30); do abierto "$P_DB" && break; sleep 1; done
abierto "$P_DB" || { echo "El túnel a la base no levantó:" >&2; tail -5 /tmp/con-cerebro-db.log >&2; exit 1; }
for _ in $(seq 1 15); do abierto "$P_EMBED" && break; sleep 1; done

export ELECTRUM_DB_URL="postgres://electrum:${CLAVE}@127.0.0.1:${P_DB}/electrum"
abierto "$P_EMBED" && export EMBED_URL="http://127.0.0.1:${P_EMBED}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"

cd "$CODIGO"
if [ "$1" = tsx ]; then shift; "${CODIGO}/node_modules/.bin/tsx" "$@"; else "$@"; fi
