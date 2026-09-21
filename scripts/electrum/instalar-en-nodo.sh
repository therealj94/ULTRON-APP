#!/usr/bin/env bash
#
# ELECTRUM — instala el catastro en un nodo de EC2 sin tener llave SSH.
#
# El nodo del cerebro no tiene el 22 abierto, así que a esa máquina no se entra por ssh ni se le
# copian archivos con scp: se entra por SSM, que va por la API de AWS y no necesita puerto abierto.
# Esto empaqueta el instalador y el esquema, los manda, los ejecuta y te trae la salida.
#
#   ./instalar-en-nodo.sh i-06530893af0dd0638
#   REGION=us-east-1 ./instalar-en-nodo.sh i-06530893af0dd0638
#
# LA CLAVE NO VIAJA NI SE IMPRIME. La salida de un comando de SSM queda guardada en el historial de
# AWS y cualquiera con ssm:GetCommandInvocation la puede leer meses después, así que la clave se
# genera EN el nodo y se queda en /root/electrum-db-url, que solo root abre. Se recoge entrando:
#
#   aws ssm start-session --target <instancia>
#   sudo cat /root/electrum-db-url
#
set -euo pipefail

INSTANCIA="${1:-}"
REGION="${REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
paso()  { printf '\n\033[36m== %s\033[0m\n' "$*"; }

if [ -z "$INSTANCIA" ]; then
  rojo "Falta la instancia."
  echo "  $0 <i-xxxxxxxxxxxx>"
  echo
  echo "Para ver cuáles hay:"
  echo "  aws ec2 describe-instances --query 'Reservations[].Instances[].{id:InstanceId,nombre:Tags[?Key==\`Name\`]|[0].Value}' --output table"
  exit 1
fi

command -v aws >/dev/null || { rojo "No tenés la CLI de AWS instalada."; exit 1; }
for f in instalar-postgis.sh esquema.sql; do
  [ -f "${AQUI}/${f}" ] || { rojo "No encuentro ${f} junto a este script."; exit 1; }
done

paso "Comprobando credenciales"
aws sts get-caller-identity --region "$REGION" --query 'Arn' --output text

paso "Comprobando que el nodo esté en SSM"
# Sin el agente en marcha no hay por dónde entrar, y conviene saberlo antes de mandar nada.
PING=$(aws ssm describe-instance-information --region "$REGION" \
  --filters "Key=InstanceIds,Values=${INSTANCIA}" \
  --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || echo "None")
if [ "$PING" != "Online" ]; then
  rojo "El nodo no responde en SSM (estado: ${PING})."
  echo "Necesita el agente corriendo y un perfil de instancia con AmazonSSMManagedInstanceCore."
  exit 1
fi
echo "  en línea"

paso "Empaquetando y enviando"
# Van en base64 para que ni las comillas ni los acentos del esquema se rompan por el camino.
B_SH=$(base64 -w0 < "${AQUI}/instalar-postgis.sh")
B_SQL=$(base64 -w0 < "${AQUI}/esquema.sql")

LEER=$(cat <<GUION
set -e
mkdir -p /opt/electrum-instalacion
cd /opt/electrum-instalacion
echo '${B_SH}' | base64 -d > instalar-postgis.sh
echo '${B_SQL}' | base64 -d > esquema.sql
chmod +x instalar-postgis.sh
SILENCIO=1 bash instalar-postgis.sh
GUION
)

CMD=$(aws ssm send-command --region "$REGION" \
  --instance-ids "$INSTANCIA" \
  --document-name AWS-RunShellScript \
  --comment "Electrum: PostgreSQL + PostGIS" \
  --timeout-seconds 1800 \
  --parameters "$(printf '{"commands":[%s],"executionTimeout":["1800"]}' "$(printf '%s' "$LEER" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")" \
  --query 'Command.CommandId' --output text)
echo "  comando ${CMD}"

paso "Esperando (instalar PostGIS tarda unos minutos)"
ESTADO=Pending
for _ in $(seq 1 120); do
  sleep 10
  ESTADO=$(aws ssm get-command-invocation --region "$REGION" --command-id "$CMD" \
    --instance-id "$INSTANCIA" --query 'Status' --output text 2>/dev/null || echo Pending)
  printf '.'
  case "$ESTADO" in Success|Failed|Cancelled|TimedOut) break;; esac
done
echo

aws ssm get-command-invocation --region "$REGION" --command-id "$CMD" \
  --instance-id "$INSTANCIA" --query 'StandardOutputContent' --output text || true

if [ "$ESTADO" != "Success" ]; then
  rojo "Terminó en ${ESTADO}. El error:"
  aws ssm get-command-invocation --region "$REGION" --command-id "$CMD" \
    --instance-id "$INSTANCIA" --query 'StandardErrorContent' --output text || true
  exit 1
fi

verde "
Instalado."
cat <<GUIA

Falta recoger la cadena de conexión, que a propósito no viaja por SSM:

  aws ssm start-session --target ${INSTANCIA} --region ${REGION}
  sudo cat /root/electrum-db-url

Cambiale <ip-o-dns-del-nodo> por la IP del nodo y ponela en Render como ELECTRUM_DB_URL.

Y falta decidir la red: la base escucha SOLO en localhost. Para que Render llegue hay que abrir el
puerto a SUS IPs de salida y a ninguna más — están en el panel de Render, en Connect → Outbound.
Nunca 0.0.0.0/0: un catastro completo abierto a internet es, tarde o temprano, un catastro regalado.
GUIA
