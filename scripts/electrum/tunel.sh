#!/usr/bin/env bash
#
# ELECTRUM — abre un túnel a la base del nodo sin abrir ningún puerto a internet.
#
# La base escucha SOLO en localhost del nodo, que es como debe estar: un catastro completo con el
# 5432 abierto a internet es, tarde o temprano, un catastro regalado. Pero entonces el cargador, que
# corre en tu máquina, no llega. Esto lo resuelve sin tocar la red: SSM reenvía el puerto por la API
# de AWS, cifrado, sin grupo de seguridad que cambiar y sin llave SSH.
#
#   ./tunel.sh i-06530893af0dd0638
#
# Dejalo abierto en una terminal. En OTRA, el cargador ya tiene la base en local:
#
#   export ELECTRUM_DB_URL='postgres://electrum:LA-CLAVE@127.0.0.1:55432/electrum'
#   npx tsx scripts/electrum/aprender.ts --seco /ruta/a/los/expedientes
#
# La clave está en el nodo, en /root/electrum-db-url. No viaja por aquí a propósito.
#
# Necesita el plugin de Session Manager, que no viene con la CLI:
#   https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html
set -euo pipefail

INSTANCIA="${1:-}"
LOCAL="${LOCAL:-55432}"
REMOTO="${REMOTO:-5432}"
REGION="${REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"

if [ -z "$INSTANCIA" ]; then
  printf '\033[31m%s\033[0m\n' "Falta la instancia."
  echo "  $0 <i-xxxxxxxxxxxx>"
  exit 1
fi

command -v session-manager-plugin >/dev/null || {
  printf '\033[31m%s\033[0m\n' "Falta el plugin de Session Manager."
  echo "Sin él la CLI abre la sesión y no sabe hablarla. Instalación:"
  echo "  https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html"
  exit 1
}

printf '\033[36m%s\033[0m\n' "Túnel ${LOCAL} -> ${INSTANCIA}:${REMOTO}. Ctrl-C para cerrarlo."
echo "Mientras esté abierto:  ELECTRUM_DB_URL='postgres://electrum:LA-CLAVE@127.0.0.1:${LOCAL}/electrum'"
echo

exec aws ssm start-session \
  --region "$REGION" \
  --target "$INSTANCIA" \
  --document-name AWS-StartPortForwardingSession \
  --parameters "{\"portNumber\":[\"${REMOTO}\"],\"localPortNumber\":[\"${LOCAL}\"]}"
