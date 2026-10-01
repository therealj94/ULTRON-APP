#!/usr/bin/env bash
# Oído de respaldo de AU-RA en la T4: Whisper large-v3-turbo (faster-whisper) en la GPU, en 127.0.0.1:17495.
# Reemplaza al Whisper de Voicebox (4,7 GB de VRAM → 1,2 GB; 0,79 s → 0,33 s, medido el 1-oct-2026).
# Caddy lo publica en /transcribe con la misma X-Voz-Clave de Voicebox: en Render no cambia nada.
#
# Uso en el nodo, desde un clon del repo:  sudo OIDO_CLAVE=<la X-Voz-Clave de Voicebox> bash scripts/nodo-t4/instalar-oido.sh
# (idempotente; sin OIDO_CLAVE reutiliza la de /etc/oido.env si ya existe)
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ=/opt/oido
PUERTO="${OIDO_PUERTO:-17495}"

if [ -z "${OIDO_CLAVE:-}" ] && [ -f /etc/oido.env ]; then
  OIDO_CLAVE="$(grep -E '^OIDO_CLAVE=' /etc/oido.env | cut -d= -f2-)"
fi
[ -n "${OIDO_CLAVE:-}" ] || { echo "Falta OIDO_CLAVE (la X-Voz-Clave que ya usa Render)"; exit 1; }

mkdir -p "$RAIZ/modelos"
[ -d "$RAIZ/venv" ] || python3 -m venv "$RAIZ/venv"
"$RAIZ/venv/bin/pip" -q install --upgrade pip
# Las versiones que se midieron en la T4. av 16+ quitó `metadata_errors`, que faster-whisper 1.2.1 usa.
"$RAIZ/venv/bin/pip" -q install faster-whisper==1.2.1 ctranslate2==4.8.2 av==15.1.0 \
  nvidia-cublas-cu12==12.9.2.10 nvidia-cudnn-cu12==9.27.0.42
install -m 644 "$AQUI/oido/servidor.py" "$RAIZ/servidor.py"
chown -R ubuntu:ubuntu "$RAIZ"

SP="$("$RAIZ/venv/bin/python" -c 'import site; print(site.getsitepackages()[0])')"
umask 077
cat > /etc/oido.env <<ENV
OIDO_CLAVE=$OIDO_CLAVE
OIDO_PUERTO=$PUERTO
OIDO_MODELO=large-v3-turbo
OIDO_RAIZ=$RAIZ/modelos
LD_LIBRARY_PATH=$SP/nvidia/cublas/lib:$SP/nvidia/cudnn/lib
ENV
umask 022

cat > /etc/systemd/system/oido.service <<UNIT
[Unit]
Description=Oído de respaldo de AU-RA · Whisper large-v3-turbo en la GPU (:$PUERTO)
After=network.target

[Service]
User=ubuntu
EnvironmentFile=/etc/oido.env
WorkingDirectory=$RAIZ
ExecStart=$RAIZ/venv/bin/python $RAIZ/servidor.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now oido
systemctl restart oido
echo "Esperando al modelo (la primera vez baja ~1,6 GB)…"
for i in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:$PUERTO/health" >/dev/null 2>&1; then echo "oído listo en 127.0.0.1:$PUERTO"; exit 0; fi
  sleep 2
done
echo "El oído no contestó: journalctl -u oido -n 50"; exit 1
