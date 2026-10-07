#!/usr/bin/env bash
#
# ELECTRUM — el nodo de carga: una máquina de usar y apagar para meter lotes grandes (decenas de GB)
# en el cerebro de Dr Electrum.
#
# Por qué una máquina aparte y no el panel ni tu computadora:
#   - El panel importa con un Job de Render de 512 MB a 8 GB de memoria, 64 MB por archivo y 20.000
#     objetos por listado. Con 26 GB se queda corto por los cuatro lados.
#   - Tu computadora tendría que bajar los 26 GB de S3 y empujar el texto por un túnel durante horas.
#   - El nodo del cerebro (A10G) tiene la base y Qwen; cargar ahí le quita memoria y CPU a lo que
#     está en producción, y el OCR de miles de páginas se come los núcleos.
# Este nodo está en la misma región que el cubo (S3 a velocidad de red interna, sin coste de salida),
# no abre ningún puerto, y llega a la base y a los embeddings del cerebro por túneles de SSM, igual
# que cargar.sh. Cuando termina se apaga o se destruye; mientras está apagado solo cuesta el disco.
#
#   ./nodo.sh crear        crea el rol, el grupo sin entrada y la máquina, y la deja preparada
#   ./nodo.sh estado       en qué está (y si terminó de prepararse)
#   ./nodo.sh entrar       abre una consola en el nodo (por SSM, sin llave SSH)
#   ./nodo.sh actualizar   vuelve a mandar el código (HEAD) al nodo
#   ./nodo.sh permisos     vuelve a aplicar la política del rol (tras cambiarla aquí)
#   ./nodo.sh apagar       lo detiene: deja de cobrar la máquina, conserva el disco
#   ./nodo.sh encender     lo vuelve a arrancar
#   ./nodo.sh destruir     lo borra con su disco
#
# Variables: TIPO (m6i.2xlarge), DISCO_GB (200), REGION (us-east-1), CEREBRO (la A10G), SUBRED.
set -euo pipefail

ORDEN="${1:-}"
REGION="${REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
export AWS_DEFAULT_REGION="$REGION"
NOMBRE="electrum-carga"
TIPO="${TIPO:-m6i.2xlarge}"          # 8 vCPU, 32 GB: OCR en paralelo y PDFs enormes en memoria
DISCO_GB="${DISCO_GB:-200}"          # 26 GB bajados + extraídos de zip/rar + páginas rasterizadas
CEREBRO="${CEREBRO:-i-06530893af0dd0638}"
BUCKET="${BUCKET:-electrum-expedientes-548380372606}"
# Los lotes grandes van a su propio cubo: el de trasvase borra todo a los 60 días, y 26 GB que
# costó horas subir tienen que seguir ahí si una carga hay que repetirla.
LOTES="${LOTES:-electrum-lotes-548380372606}"
# Misma zona que el cerebro: el túnel no cruza zonas y no cobra transferencia entre ellas.
SUBRED="${SUBRED:-subnet-0411e35d4107e77a7}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "${AQUI}/../.." && pwd)"
CODIGO_S3="s3://${BUCKET}/nodo-carga/codigo.tar.gz"

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
paso()  { printf '\n\033[36m== %s\033[0m\n' "$*"; }

command -v aws >/dev/null || { rojo "Falta la CLI de AWS."; exit 1; }

instancia() {
  aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=${NOMBRE}" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null | grep -v None || true
}

# El código va por el cubo y no por git: el repositorio es privado y el nodo no tiene (ni debe
# tener) credenciales de GitHub. Se manda lo que está COMETIDO en HEAD, no el árbol de trabajo.
mandar_codigo() {
  local tmp; tmp="$(mktemp)"
  git -C "$RAIZ" archive --format=tar.gz -o "$tmp" HEAD
  aws s3 cp "$tmp" "$CODIGO_S3" --only-show-errors
  rm -f "$tmp"
  echo "  código $(git -C "$RAIZ" rev-parse --short HEAD) en ${CODIGO_S3}"
}

# Corre un comando en el nodo por SSM y devuelve su salida. Solo para cosas sin secretos: la
# salida de SSM queda en el historial de AWS.
en_nodo() {
  local id="$1" cmd="$2" c estado
  c=$(aws ssm send-command --instance-ids "$id" --document-name AWS-RunShellScript \
    --comment "electrum-carga" --parameters "$(python3 -c 'import json,sys; print(json.dumps({"commands":[sys.argv[1]]}))' "$cmd")" \
    --query Command.CommandId --output text)
  for _ in $(seq 1 60); do
    sleep 3
    estado=$(aws ssm get-command-invocation --command-id "$c" --instance-id "$id" --query Status --output text 2>/dev/null || echo Pending)
    case "$estado" in Success|Failed|Cancelled|TimedOut) break;; esac
  done
  aws ssm get-command-invocation --command-id "$c" --instance-id "$id" --query StandardOutputContent --output text
}

asegurar_rol() {
  paso "Rol del nodo (${NOMBRE})"
  if ! aws iam get-role --role-name "$NOMBRE" >/dev/null 2>&1; then
    aws iam create-role --role-name "$NOMBRE" --description "Electrum: nodo de carga de lotes" \
      --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
    aws iam attach-role-policy --role-name "$NOMBRE" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
    echo "  creado"
  else
    echo "  ya estaba"
  fi
  # Lo justo: leer los lotes, lo que se subió a entrada/ y el código, publicar teselas (y nada más
  # de la biblioteca), y abrir túneles SOLO al cerebro y solo
  # con los dos documentos de reenvío de puerto. No puede borrar del cubo, ni escribir en la
  # biblioteca, ni abrir una consola en ninguna máquina.
  local cuenta; cuenta=$(aws sts get-caller-identity --query Account --output text)
  aws iam put-role-policy --role-name "$NOMBRE" --policy-name lotes-y-tunel --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::${BUCKET}",
     "Condition": {"StringLike": {"s3:prefix": ["entrada/*", "entrada/", "nodo-carga/*"]}}},
    {"Effect": "Allow", "Action": "s3:GetObject",
     "Resource": ["arn:aws:s3:::${BUCKET}/entrada/*", "arn:aws:s3:::${BUCKET}/nodo-carga/*"]},
    {"Effect": "Allow", "Action": ["s3:ListBucket", "s3:GetObject"],
     "Resource": ["arn:aws:s3:::${LOTES}", "arn:aws:s3:::${LOTES}/*"]},
    {"Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject"],
     "Resource": "arn:aws:s3:::${BUCKET}/biblioteca/teselas/*"},
    {"Effect": "Allow", "Action": "ssm:StartSession",
     "Resource": [
       "arn:aws:ec2:${REGION}:${cuenta}:instance/${CEREBRO}",
       "arn:aws:ssm:${REGION}::document/AWS-StartPortForwardingSession",
       "arn:aws:ssm:${REGION}::document/AWS-StartPortForwardingSessionToRemoteHost"
     ]},
    {"Effect": "Allow", "Action": ["ssm:TerminateSession", "ssm:ResumeSession"],
     "Resource": "arn:aws:ssm:${REGION}:${cuenta}:session/*"}
  ]
}
JSON
)"
  if ! aws iam get-instance-profile --instance-profile-name "$NOMBRE" >/dev/null 2>&1; then
    aws iam create-instance-profile --instance-profile-name "$NOMBRE" >/dev/null
    aws iam add-role-to-instance-profile --instance-profile-name "$NOMBRE" --role-name "$NOMBRE"
  fi
}

asegurar_grupo() {
  local vpc sg
  vpc=$(aws ec2 describe-subnets --subnet-ids "$SUBRED" --query 'Subnets[0].VpcId' --output text)
  sg=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=${NOMBRE}-sin-entrada" "Name=vpc-id,Values=${vpc}" \
    --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null | grep -v None || true)
  if [ -z "$sg" ]; then
    # Sin ninguna regla de entrada: al nodo se entra por SSM, que sale desde dentro.
    sg=$(aws ec2 create-security-group --group-name "${NOMBRE}-sin-entrada" --vpc-id "$vpc" \
      --description "Electrum nodo de carga: sin entrada, se entra por SSM" --query GroupId --output text)
  fi
  echo "$sg"
}

crear() {
  local ya; ya=$(instancia)
  if [ -n "$ya" ]; then
    rojo "Ya hay un nodo de carga: ${ya}. './nodo.sh estado' o './nodo.sh destruir'."
    exit 1
  fi
  paso "Credenciales"
  aws sts get-caller-identity --query Arn --output text

  asegurar_rol
  paso "Grupo de seguridad"
  local sg; sg=$(asegurar_grupo); echo "  ${sg}"
  paso "Código"
  mandar_codigo

  paso "Lanzando ${TIPO} con ${DISCO_GB} GB"
  local ami datos id
  ami=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
    --query Parameter.Value --output text)
  datos="$(mktemp)"
  sed "s|__BUCKET__|${BUCKET}|g; s|__LOTES__|${LOTES}|g; s|__REGION__|${REGION}|g" "${AQUI}/preparar.sh" > "$datos"
  # Un perfil recién creado tarda unos segundos en verse desde EC2: se reintenta en vez de fallar.
  for intento in 1 2 3 4 5 6; do
    if id=$(aws ec2 run-instances --image-id "$ami" --instance-type "$TIPO" --subnet-id "$SUBRED" \
        --security-group-ids "$sg" --associate-public-ip-address \
        --iam-instance-profile "Name=${NOMBRE}" \
        --metadata-options HttpTokens=required,HttpEndpoint=enabled \
        --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":${DISCO_GB},\"VolumeType\":\"gp3\",\"Iops\":6000,\"Throughput\":400,\"DeleteOnTermination\":true,\"Encrypted\":true}}]" \
        --user-data "file://${datos}" \
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${NOMBRE}},{Key=Proyecto,Value=electrum}]" \
                             "ResourceType=volume,Tags=[{Key=Name,Value=${NOMBRE}},{Key=Proyecto,Value=electrum}]" \
        --query 'Instances[0].InstanceId' --output text 2>/tmp/electrum-carga-err); then
      break
    fi
    grep -q "Invalid IAM Instance Profile\|iamInstanceProfile" /tmp/electrum-carga-err || { cat /tmp/electrum-carga-err; exit 1; }
    echo "  el perfil todavía no se ve, reintento (${intento})…"; sleep 10
  done
  rm -f "$datos"
  [ -n "${id:-}" ] || { rojo "No pude lanzarlo."; exit 1; }
  echo "  ${id}"

  paso "Esperando a que se prepare (Node, GDAL, Tesseract, el código: unos 5 minutos)"
  for _ in $(seq 1 90); do
    sleep 10
    if [ "$(aws ssm describe-instance-information --filters "Key=InstanceIds,Values=${id}" \
          --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null)" = "Online" ] &&
       [ "$(en_nodo "$id" 'test -f /opt/electrum-carga/LISTO && echo si || echo no' | tr -d '[:space:]')" = "si" ]; then
      verde "
Nodo listo: ${id}"
      siguiente
      return
    fi
    printf '.'
  done
  rojo "
No terminó de prepararse a tiempo. Mirá el registro: ./nodo.sh entrar  y  sudo tail -50 /var/log/electrum-carga.log"
}

siguiente() {
  cat <<GUIA

Siguiente:
  1. Subí el lote al cubo desde donde estén los archivos (se puede cortar y relanzar):
       aws s3 sync /ruta/a/los/26gb s3://${LOTES}/<lote>/
  2. Entrá al nodo y cargalo:
       ./nodo.sh entrar
       sudo -i
       tmux new -s carga          # para que un corte de la consola no corte la carga
       cargar-lote <lote>
  3. Al terminar:  ./nodo.sh apagar   (o destruir)
GUIA
}

ID=""
requiere() { ID=$(instancia); [ -n "$ID" ] || { rojo "No hay nodo de carga. './nodo.sh crear'."; exit 1; }; }

case "$ORDEN" in
  crear) crear ;;
  estado)
    requiere
    aws ec2 describe-instances --instance-ids "$ID" \
      --query 'Reservations[0].Instances[0].{id:InstanceId,estado:State.Name,tipo:InstanceType,arranque:LaunchTime}' --output table
    if [ "$(aws ec2 describe-instances --instance-ids "$ID" --query 'Reservations[0].Instances[0].State.Name' --output text)" = running ]; then
      en_nodo "$ID" 'test -f /opt/electrum-carga/LISTO && echo "preparado: sí" || echo "preparado: todavía no"; df -h /datos 2>/dev/null | tail -1; ls /datos 2>/dev/null | sed "s/^/lote: /"'
    fi
    ;;
  entrar)
    requiere
    command -v session-manager-plugin >/dev/null || {
      rojo "Falta el plugin de Session Manager:"
      echo "  https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html"
      exit 1
    }
    exec aws ssm start-session --target "$ID"
    ;;
  actualizar)
    requiere
    mandar_codigo
    en_nodo "$ID" '/usr/local/bin/electrum-carga-codigo 2>&1 | tail -3'
    ;;
  permisos) asegurar_rol ;;
  apagar)   requiere; aws ec2 stop-instances --instance-ids "$ID" --query 'StoppingInstances[0].CurrentState.Name' --output text ;;
  encender) requiere; aws ec2 start-instances --instance-ids "$ID" --query 'StartingInstances[0].CurrentState.Name' --output text ;;
  destruir)
    requiere
    read -rp "Borrar ${ID} y su disco (lo bajado y el OCR hecho se pierden; lo cargado en el cerebro queda). Escribí 'borrar': " SI
    [ "$SI" = borrar ] || { echo "No borré nada."; exit 0; }
    aws ec2 terminate-instances --instance-ids "$ID" --query 'TerminatingInstances[0].CurrentState.Name' --output text
    ;;
  *)
    sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
