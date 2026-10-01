#!/usr/bin/env bash
# La computadora de los agentes, en una g6.xlarge (NVIDIA L4, 24 GB) con la AMI oficial
# «Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 24.04)» (driver, Docker y nvidia-container-toolkit).
#
#   sudo COMPUTADORA_CLAVE=<clave larga> [ANTHROPIC_API_KEY=...] [PRECISION=fp8|bf16] bash instalar.sh
#
# Deja tres piezas, todas escuchando solo en 127.0.0.1 (Caddy publica lo necesario con TLS):
#   holo        vLLM + Hcompany/Holo-3.1-9B en :8000 (banderas de la guía de H Company)
#   escritorio  la demo de computer use de Anthropic: Ubuntu + Firefox + LibreOffice, noVNC en :6080
#   computadora este servicio (agente.py) en :8100
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ=/opt/computadora
VLLM_IMAGEN="${VLLM_IMAGEN:-vllm/vllm-openai:v0.30.0}"
ESCRITORIO_IMAGEN="${ESCRITORIO_IMAGEN:-ghcr.io/anthropics/anthropic-quickstarts:computer-use-demo-latest}"
PRECISION="${PRECISION:-fp8}"
[ -n "${COMPUTADORA_CLAVE:-}" ] || { echo "Falta COMPUTADORA_CLAVE"; exit 1; }
mkdir -p "$RAIZ/hf" "$RAIZ/logs"

# 1. Pesos de Holo-3.1-9B (18,8 GB en BF16).
[ -d "$RAIZ/venv" ] || python3 -m venv "$RAIZ/venv"
"$RAIZ/venv/bin/pip" -q install -U pip "huggingface_hub[hf_xet]" fastapi==0.118.0 "uvicorn[standard]==0.37.0" \
  openai==2.3.0 httpx==0.28.1 pillow==11.3.0
"$RAIZ/venv/bin/hf" download Hcompany/Holo-3.1-9B --cache-dir "$RAIZ/hf" >/dev/null

# 2. El modelo, en FP8 (la L4 lo tiene nativo): pesos de ~9,5 GB. En BF16 no cabe: medido el 1-oct-2026,
#    los pesos ocupan 18,2 GB y la caché KV pide 4,1 GB más de los que quedan (CUDA out of memory).
CUANT=(); [ "$PRECISION" = fp8 ] && CUANT=(--quantization fp8)
docker rm -f holo >/dev/null 2>&1 || true
docker run -d --name holo --restart unless-stopped --gpus all --ipc=host \
  -p 127.0.0.1:8000:8000 -v "$RAIZ/hf:/root/.cache/huggingface/hub" -e HF_HUB_OFFLINE=1 \
  "$VLLM_IMAGEN" --model Hcompany/Holo-3.1-9B --served-model-name holo3-1-9b \
  --max-model-len 32768 --gpu-memory-utilization 0.93 --enable-prefix-caching \
  --chat-template-content-format openai --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder --reasoning-parser qwen3 \
  --limit-mm-per-prompt '{"image": 3, "video": 0}' "${CUANT[@]}"

# 3. El escritorio, a 1280x800 (la pantalla de los ejemplos de Holo y de las recomendadas por Claude).
docker rm -f escritorio >/dev/null 2>&1 || true
docker run -d --name escritorio --restart unless-stopped -e WIDTH=1280 -e HEIGHT=800 \
  -p 127.0.0.1:6080:6080 --shm-size 2g "$ESCRITORIO_IMAGEN"

# 4. El servicio de tareas.
install -m 644 "$AQUI/agente.py" "$RAIZ/agente.py"
umask 077
cat > /etc/computadora.env <<ENV
COMPUTADORA_CLAVE=$COMPUTADORA_CLAVE
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
MODELO_URL=http://127.0.0.1:8000/v1
MODELO=holo3-1-9b
ESCRITORIO=escritorio
ENV
umask 022
cat > /etc/systemd/system/computadora.service <<UNIT
[Unit]
Description=Computadora de los agentes (tareas sobre el escritorio propio)
After=docker.service
Requires=docker.service

[Service]
EnvironmentFile=/etc/computadora.env
WorkingDirectory=$RAIZ
ExecStart=$RAIZ/venv/bin/uvicorn agente:app --host 127.0.0.1 --port 8100
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now computadora
systemctl restart computadora
echo "Esperando al modelo (cargar 18,8 GB tarda unos minutos)…"
for i in $(seq 1 120); do
  curl -fsS http://127.0.0.1:8000/v1/models >/dev/null 2>&1 && break
  sleep 5
done
curl -s http://127.0.0.1:8100/salud; echo

# 5. La puerta HTTPS (opcional: DOMINIO=54-85-85-77.sslip.io). Caddy en el host, con la red del host
#    para llegar a 127.0.0.1.
if [ -n "${DOMINIO:-}" ]; then
  install -m 644 "$AQUI/Caddyfile" "$RAIZ/Caddyfile"
  docker rm -f caddy >/dev/null 2>&1 || true
  docker run -d --name caddy --restart unless-stopped --network host -e DOMINIO="$DOMINIO" \
    -v "$RAIZ/Caddyfile:/etc/caddy/Caddyfile:ro" -v caddy_datos:/data caddy:2
fi
