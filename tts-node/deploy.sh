#!/usr/bin/env bash
# Despliegue Qwen3-TTS en la T4 existente (NO en A10G ni Playwright).
# Instancia: i-02653feadc919d3a4  g4dn.xlarge  "aura-gpu-T4-APAGADA"
#
# Pasos manuales (la API key de jose está en cuarentena CompromisedKey):
# 1) Desde consola AWS (root u otro user): StartInstances i-02653feadc919d3a4
# 2) Abrir SG sg-0b55186eab43ac7cb puerto TCP 8790 desde Render / 0.0.0.0
# 3) SSH/SSM a la instancia y correr este script

set -euo pipefail
cd "$(dirname "$0")"

python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -U qwen-tts fastapi uvicorn soundfile numpy torch --extra-index-url https://download.pytorch.org/whl/cu124

export ULTRON_TTS_CLAVE="${ULTRON_TTS_CLAVE:-cambiar-esta-clave}"
export ULTRON_TTS_MODEL="${ULTRON_TTS_MODEL:-Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign}"
export ULTRON_TTS_PORT="${ULTRON_TTS_PORT:-8790}"

echo "[ultron-tts] modelo=$ULTRON_TTS_MODEL puerto=$ULTRON_TTS_PORT"
exec python server.py
