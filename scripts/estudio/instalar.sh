#!/bin/bash
# instalar.sh — instala el ESTUDIO AU-RA en el nodo T4 (Ubuntu 24.04, driver NVIDIA >= 570).
# Idempotente. Todo vive en /opt/estudio (no toca /opt/voicebox, /opt/ultron-manos, Docker ni drivers).
# Uso:  sudo bash instalar.sh            (tarda ~15 min; descarga ~13 GB)
# Requisitos de disco: deja >= 10 GB libres en / al terminar (el script se detiene si no los hay).
set -euo pipefail
E=/opt/estudio
mkdir -p $E/{bin,envs,repos,hf,logs,trabajo,salida,refs,python,modelos,scripts}
libre_gb() { df -BG --output=avail / | tail -1 | tr -dc 0-9; }
[ "$(libre_gb)" -ge 25 ] || { echo "Hacen falta >= 25 GB libres en / para instalar (hay $(libre_gb))"; exit 1; }

# --- uv + Python 3.11 aislados -------------------------------------------------------------------
[ -x $E/bin/uv ] || curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=$E/bin UV_NO_MODIFY_PATH=1 sh
cat > $E/env.sh <<'EOF'
export PATH=/opt/estudio/bin:$PATH
export UV_CACHE_DIR=/opt/estudio/.uvcache
export UV_PYTHON_INSTALL_DIR=/opt/estudio/python
export UV_LINK_MODE=hardlink
export HF_HOME=/opt/estudio/hf
export HF_HUB_DISABLE_TELEMETRY=1
export TMPDIR=/opt/dlami/nvme/estudio-tmp
EOF
mkdir -p /opt/dlami/nvme/estudio-tmp
. $E/env.sh
uv python install 3.11

# --- ACE-Step 1.5 (MIT) — su propio venv (uv sync) -------------------------------------------------
cd $E/repos
[ -d ACE-Step-1.5 ] || git clone -q https://github.com/ace-step/ACE-Step-1.5
git -C ACE-Step-1.5 checkout -q ca1e85fe9430179831e6bc6be790c332190a3866
(cd ACE-Step-1.5 && uv sync --python 3.11)

# --- Seed-VC (GPL-3.0: sólo como herramienta de servidor, no se distribuye) ---------------------------
[ -d seed-vc ] || git clone -q https://github.com/Plachtaa/seed-vc
git -C seed-vc checkout -q 51383efd921027683c89e5348211d93ff12ac2a8
# --- Dia (Apache-2.0) ---------------------------------------------------------------------------------
[ -d dia ] || git clone -q https://github.com/nari-labs/dia
git -C dia checkout -q 876125e461a03b157ec905b0fe8b57a0f8b9e7a0

# --- entorno "vc": Seed-VC + Demucs + Chatterbox-Turbo + Dia + Resemblyzer + AST -----------------------
cat > $E/nvidia-pins.txt <<'EOF'
nvidia-cublas-cu12==12.8.4.1
nvidia-cuda-cupti-cu12==12.8.90
nvidia-cuda-nvrtc-cu12==12.8.93
nvidia-cuda-runtime-cu12==12.8.90
nvidia-cudnn-cu12==9.10.2.21
nvidia-cufft-cu12==11.3.3.83
nvidia-cufile-cu12==1.13.1.3
nvidia-curand-cu12==10.3.9.90
nvidia-cusolver-cu12==11.7.3.90
nvidia-cusparse-cu12==12.5.8.93
nvidia-cusparselt-cu12==0.7.1
nvidia-nccl-cu12==2.27.5
nvidia-nvjitlink-cu12==12.8.93
nvidia-nvshmem-cu12==3.4.5
nvidia-nvtx-cu12==12.8.90
triton==3.6.0
EOF
[ -x $E/envs/vc/bin/python ] || uv venv --python 3.11 $E/envs/vc
export VIRTUAL_ENV=$E/envs/vc
TORCH="torch==2.10.0+cu128 torchaudio==2.10.0+cu128"
IDX="--index-url https://pypi.org/simple --extra-index-url https://download.pytorch.org/whl/cu128"
uv pip install --index-url https://download.pytorch.org/whl/cu128 $TORCH
uv pip install "numpy==1.26.4" "scipy==1.13.1" "librosa==0.10.2" "huggingface-hub>=0.28.1,<1.0" "munch==4.0.0" \
  "einops==0.8.0" "descript-audio-codec==1.0.0" "pydub==0.25.1" "jiwer==3.0.3" "transformers==4.46.3" soundfile \
  "hydra-core==1.3.2" pyyaml python-dotenv accelerate "demucs==4.1.0" webrtcvad-wheels pyloudnorm $TORCH \
  $IDX --index-strategy unsafe-best-match
uv pip install --no-deps resemblyzer==0.1.4 typing "chatterbox-tts==0.1.6" $E/repos/dia
# perth (marca de agua de Chatterbox) importa pkg_resources, que setuptools>=81 ya no trae:
# sin él PerthImplicitWatermarker queda en None y Chatterbox-Turbo no arranca.
uv pip install "setuptools<81"
uv pip install s3tokenizer "conformer==0.3.2" "diffusers==0.29.0" "resemble-perth>=1.0.1" omegaconf \
  "protobuf>=6.31.1,<7" "numpy==1.26.4" "transformers==4.46.3" $TORCH $(cat $E/nvidia-pins.txt) \
  $IDX --index-strategy first-index
$E/envs/vc/bin/python -c "from chatterbox.tts_turbo import ChatterboxTurboTTS; import dia.model, demucs.api, resemblyzer; print('imports ok')"

# --- pesos ------------------------------------------------------------------------------------------
$E/envs/vc/bin/python - <<'EOF'
import os
from huggingface_hub import snapshot_download, hf_hub_download
ACE = "/opt/estudio/repos/ACE-Step-1.5/checkpoints"
# ACE-Step: DiT turbo + VAE + codificador de texto + LM 0.6B (el LM 1.7B no cabe junto a Voicebox)
snapshot_download("ACE-Step/Ace-Step1.5", local_dir=ACE,
                  allow_patterns=["acestep-v15-turbo/*", "vae/*", "Qwen3-Embedding-0.6B/*", "config.json", "README.md"])
snapshot_download("ACE-Step/acestep-5Hz-lm-0.6B", local_dir=ACE + "/acestep-5Hz-lm-0.6B")
os.chdir("/opt/estudio/repos/seed-vc")
for f in ["DiT_seed_v2_uvit_whisper_base_f0_44k_bigvgan_pruned_ft_ema_v2.pth", "config_dit_mel_seed_uvit_whisper_base_f0_44k.yml",
          "DiT_seed_v2_uvit_whisper_small_wavenet_bigvgan_pruned.pth", "config_dit_mel_seed_uvit_whisper_small_wavenet.yml"]:
    hf_hub_download("Plachta/Seed-VC", f, cache_dir="./checkpoints")
hf_hub_download("lj1995/VoiceConversionWebUI", "rmvpe.pt", cache_dir="./checkpoints")
hf_hub_download("funasr/campplus", "campplus_cn_common.bin", cache_dir="./checkpoints")
for m in ["nvidia/bigvgan_v2_44khz_128band_512x", "nvidia/bigvgan_v2_22khz_80band_256x"]:
    for f in ["config.json", "bigvgan_generator.pt"]:
        hf_hub_download(m, f)
snapshot_download("openai/whisper-small", allow_patterns=["*.json", "*.txt", "model.safetensors"])
# Whisper propio del estudio (WER con Voicebox parado)
snapshot_download("openai/whisper-large-v3-turbo", allow_patterns=["*.json", "*.txt", "model.safetensors"])
snapshot_download("ResembleAI/chatterbox-turbo", allow_patterns=["t3_turbo_v1.safetensors", "t3_turbo_v1.yaml",
                  "s3gen_meanflow.safetensors", "ve.safetensors", "conds.pt", "*.json", "merges.txt"])
snapshot_download("MIT/ast-finetuned-audioset-10-10-0.4593", allow_patterns=["*.json", "model.safetensors"])
import demucs.api
demucs.api.Separator(model="htdemucs", device="cpu")
import dac
dac.utils.download()  # códec DAC 44 kHz que usa Dia
print("pesos ok")
EOF

# --- Dia 1.6B en fp16 --------------------------------------------------------------------------------
# Nari publica sólo fp32 (6.4 GB).  Convertir en el nodo necesita ~10 GB de RAM: con Voicebox en marcha
# NO es seguro.  Hazlo en otra máquina (dia16_convertir.py) y copia el resultado a $E/modelos/:
#     $E/modelos/dia-1.6b-0626-fp16/{config.json, dia-1.6b-0626-fp16.safetensors}
[ -f $E/modelos/dia-1.6b-0626-fp16/dia-1.6b-0626-fp16.safetensors ] || \
  echo "AVISO: falta Dia fp16 en $E/modelos/dia-1.6b-0626-fp16 (ver scripts/estudio/dia16_convertir.py)"

# --- limpieza de cachés -------------------------------------------------------------------------------
uv cache clean >/dev/null 2>&1 || true
rm -rf /root/.cache/pip
echo "Instalado. /opt/estudio ocupa $(du -sh $E | cut -f1); libres en /: $(libre_gb) GB"
[ "$(libre_gb)" -ge 10 ] || echo "ATENCIÓN: menos de 10 GB libres en /"
