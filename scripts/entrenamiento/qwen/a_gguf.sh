#!/usr/bin/env bash
# El adaptador LoRA (salida de entrenar_lora.py) → GGUF, para cargarlo en llama-server con --lora.
#
#   bash a_gguf.sh <dir del adaptador> <dir HF del modelo base> [salida.gguf]
#
# El base tiene que ser el MISMO modelo (mismos pesos) que sirve llama-server; si no, el adaptador
# no corresponde y degrada al modelo. Usa convert_lora_to_gguf.py de llama.cpp (se baja solo lo justo).
# Verificado el 29-09-2026 con un adaptador de Qwen3-0.6B (392 tensores, 20 MB en f16).
set -euo pipefail
ADAPTADOR="${1:?falta el directorio del adaptador}"
BASE="${2:?falta el directorio HF del modelo base}"
SALIDA="${3:-$ADAPTADOR/lora-electrum.gguf}"
LLAMA="${LLAMA_CPP:-$HOME/llama.cpp-convertir}"
PY="${PYTHON:-python3}"

if [ ! -f "$LLAMA/convert_lora_to_gguf.py" ]; then
  git clone -q --depth 1 --filter=blob:none --sparse https://github.com/ggml-org/llama.cpp "$LLAMA"
  (cd "$LLAMA" && git sparse-checkout set --no-cone '/convert_lora_to_gguf.py' '/convert_hf_to_gguf.py' '/gguf-py/' '/conversion/')
fi
"$PY" -m pip install -q -e "$LLAMA/gguf-py" sentencepiece
(cd "$LLAMA" && "$PY" convert_lora_to_gguf.py --base "$BASE" --outfile "$SALIDA" --outtype f16 "$ADAPTADOR")
echo "Listo: $SALIDA"
echo "En el nodo: llama-server ... --lora $SALIDA   (o --lora-scaled $SALIDA 0.5 para probar a media fuerza)"
