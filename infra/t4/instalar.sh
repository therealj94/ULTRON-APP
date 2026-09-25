#!/usr/bin/env bash
#
# Levanta el Sistema 1 en la T4: Laya, BGE-M3, el modelo chico, Docling y la puerta con TLS.
#
#   sudo bash instalar.sh              # la primera vez y cada vez que se cambie algo (idempotente)
#   sudo SILENCIO=0 bash instalar.sh   # imprime también las variables para Render (NO por SSM:
#                                      # la salida de SSM queda guardada con el token dentro)
#
# Requisitos: driver NVIDIA ya instalado (la AMI de Deep Learning lo trae). Docker y el toolkit de
# contenedores de NVIDIA se instalan si faltan (Ubuntu/Debian).
#
# RED: Caddy necesita el 443 abierto en el grupo de seguridad para sacar el certificado (Let's
# Encrypt valida desde internet, así que no se puede limitar a la IP de Render). El token es la
# cerradura. Este script NO toca el grupo de seguridad: eso se decide a mano.
set -euo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$AQUI"

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
paso()  { printf '\n\033[36m== %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { rojo "Corré esto con sudo."; exit 1; }
. /etc/os-release

paso "GPU"
command -v nvidia-smi >/dev/null || { rojo "No hay driver NVIDIA (nvidia-smi). Usá la AMI de Deep Learning o instalá el driver primero."; exit 1; }
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader

paso "Docker"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  case "$ID" in
    ubuntu|debian)
      apt-get update -qq
      apt-get install -y -qq docker.io docker-compose-v2 || apt-get install -y -qq docker.io docker-compose-plugin
      ;;
    *) rojo "Instalá docker y el plugin compose a mano en $PRETTY_NAME y volvé a correr esto."; exit 1 ;;
  esac
  systemctl enable --now docker
fi
docker compose version

paso "Contenedores con GPU (nvidia-container-toolkit)"
if ! docker info 2>/dev/null | grep -qi 'runtimes:.*nvidia'; then
  case "$ID" in
    ubuntu|debian)
      curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
      curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
        | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
        > /etc/apt/sources.list.d/nvidia-container-toolkit.list
      apt-get update -qq
      apt-get install -y -qq nvidia-container-toolkit
      ;;
    *) rojo "Instalá nvidia-container-toolkit a mano en $PRETTY_NAME y volvé a correr esto."; exit 1 ;;
  esac
  nvidia-ctk runtime configure --runtime=docker
  systemctl restart docker
fi
docker run --rm --gpus all ubuntu:24.04 nvidia-smi -L >/dev/null && echo "  los contenedores ven la GPU"

paso "Configuración (.env)"
if [ ! -f .env ]; then
  IMDS_TOKEN=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' || true)
  IP=$(curl -fsS -H "X-aws-ec2-metadata-token: ${IMDS_TOKEN}" http://169.254.169.254/latest/meta-data/public-ipv4 || true)
  [ -n "$IP" ] || { rojo "No pude leer la IP pública del nodo. Copiá .env.example a .env y completalo."; exit 1; }
  umask 077
  {
    echo "T4_DOMINIO=${IP//./-}.sslip.io"
    echo "T4_TOKEN=$(openssl rand -hex 32)"
  } > .env
  echo "  .env creado (solo root lo lee). Dominio: ${IP//./-}.sslip.io"
  echo "  OJO: si el nodo cambia de IP pública (sin IP elástica), hay que rehacer T4_DOMINIO."
else
  echo "  .env ya existía; se respeta"
fi
chmod 600 .env
set -a; . ./.env; set +a
[ "${#T4_TOKEN}" -ge 32 ] || { rojo "T4_TOKEN en .env es demasiado corto (mínimo 32)."; exit 1; }

paso "Levantando (la primera vez baja ~15 GB entre imágenes y modelos)"
docker compose up -d --build
docker compose ps

paso "Esperando a que carguen los modelos"
for i in $(seq 1 120); do
  listos=0
  for s in laya:8000/health embed:80/health chico:8080/health docling:5001/ready; do
    # Sin token: /health de Laya, TEI y llama.cpp es público dentro de la red, y así el token no
    # aparece en la lista de procesos. De docling se mira /ready, que espera a los modelos.
    docker compose exec -T caddy wget -q -O /dev/null "http://${s}" 2>/dev/null && listos=$((listos+1))
  done
  [ "$listos" -eq 4 ] && break
  printf '  %s/4 listos…\r' "$listos"
  sleep 10
done
echo
[ "$listos" -eq 4 ] || { rojo "No todos arrancaron en 20 minutos. Mirá: docker compose logs --tail 80"; exit 1; }
verde "  los cuatro servicios responden"

paso "Prueba de punta a punta por la puerta pública"
bash "$AQUI/probar.sh"

DESTINO=/root/t4-render.env
umask 077
cat > "$DESTINO" <<FIN
# Variables para el servicio de Render (AU-RA y Dr Electrum). Empezá con el clasificador en sombra.
LAYA_URL=https://${T4_DOMINIO}/laya
LAYA_API_KEY=${T4_TOKEN}
CLASIFICADOR_MODO=sombra
EMBED_URL=https://${T4_DOMINIO}/embed
EMBED_API_KEY=${T4_TOKEN}
MODELO_CHICO_URL=https://${T4_DOMINIO}/chico
MODELO_CHICO_API_KEY=${T4_TOKEN}
MODELO_CHICO_NOMBRE=chico
MODELO_CHICO_MODO=activo
DOCLING_URL=https://${T4_DOMINIO}/docling
DOCLING_API_KEY=${T4_TOKEN}
DOCLING_TIMEOUT_MS=620000
FIN
chmod 600 "$DESTINO"
verde "
Listo."
if [ "${SILENCIO:-1}" = "1" ]; then
  echo "Las variables para Render quedaron en ${DESTINO} (solo root). Recogelas con: sudo cat ${DESTINO}"
else
  echo "Poné esto en Render (también quedó en ${DESTINO}):"; echo; cat "$DESTINO"
fi
