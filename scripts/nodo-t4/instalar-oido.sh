#!/usr/bin/env bash
# Oído local de AU-RA en el nodo T4 (g4dn.xlarge, 35.175.175.203).
# Levanta faster-whisper (large-v3, int8_float16) con API compatible OpenAI en :8791.
# Requisitos: driver NVIDIA + docker + nvidia-container-toolkit (ya presentes si el nodo corrió Chatterbox/Qwen-TTS).
# Uso en el nodo:  bash instalar-oido.sh   (idempotente)
set -euo pipefail
PUERTO="${PUERTO:-8791}"
MODELO="${MODELO:-Systran/faster-whisper-large-v3}"
CLAVE="${ULTRON_STT_CLAVE:-}"

docker rm -f ultron-oido >/dev/null 2>&1 || true
docker run -d --name ultron-oido --restart unless-stopped --gpus all \
  -p "${PUERTO}:8000" \
  -v ultron-oido-modelos:/root/.cache/huggingface \
  -e WHISPER__MODEL="${MODELO}" \
  -e WHISPER__COMPUTE_TYPE=int8_float16 \
  -e WHISPER__INFERENCE_DEVICE=cuda \
  -e DEFAULT_LANGUAGE=es \
  ${CLAVE:+-e API_KEY="${CLAVE}"} \
  ghcr.io/speaches-ai/speaches:latest-cuda

echo "Esperando al modelo (la primera vez baja ~3 GB)…"
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PUERTO}/health" >/dev/null 2>&1; then echo "oído listo en :${PUERTO}"; break; fi
  sleep 5
done
echo "Prueba: curl -F model=${MODELO} -F language=es -F file=@voz.wav http://127.0.0.1:${PUERTO}/v1/audio/transcriptions"
echo "En Render: ULTRON_STT_URL=http://35.175.175.203:${PUERTO}  ULTRON_STT_MODELO=${MODELO}${CLAVE:+  ULTRON_STT_CLAVE=***}"
echo "Abrir el puerto ${PUERTO} en el security group solo para la IP de salida de Render."
