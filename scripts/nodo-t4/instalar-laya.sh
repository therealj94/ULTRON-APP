#!/usr/bin/env bash
# Laya en el nodo T4 (g4dn.xlarge, 35.175.175.203): decide qué especialistas convoca Dr Electrum.
#
# Ajusta Laya multilingüe con los datos de scripts/nodo-t4/laya/datos (en la GPU tarda unos minutos),
# y lo deja como servicio systemd en :8792 con clave. No usa Docker: un venv y un unit, nada más.
# Requisitos: driver NVIDIA y python3 ≥ 3.10 con venv. Cabe junto a lo que ya corre (~1,5 GB de VRAM).
#
# Uso, desde un clon del repo en el nodo:
#   bash scripts/nodo-t4/instalar-laya.sh              # instala, entrena si no hay modelo, arranca
#   REENTRENAR=1 bash scripts/nodo-t4/instalar-laya.sh # vuelve a entrenar (tras cambiar los datos)
set -euo pipefail
AQUI="$(cd "$(dirname "$0")/laya" && pwd)"
BASE="${LAYA_BASE:-/opt/laya}"
PUERTO="${LAYA_PUERTO:-8792}"
MODELO="$BASE/modelo-electrum"
ENTORNO=/etc/laya-electrum.env

sudo mkdir -p "$BASE" && sudo chown "$(id -u):$(id -g)" "$BASE"
cp "$AQUI"/servidor.py "$AQUI"/entrenar.py "$AQUI"/evaluar.py "$AQUI"/preguntas.json "$BASE"/
rm -rf "$BASE/datos" && cp -r "$AQUI/datos" "$BASE/datos"

if [ ! -x "$BASE/venv/bin/python" ]; then
  python3 -m venv "$BASE/venv"
fi
"$BASE/venv/bin/pip" install -q --upgrade pip
# Las versiones que corren en el nodo (pip freeze del 26-09-2026). Sin fijarlas, reinstalar trae otro
# torch/transformers y el mismo checkpoint puede dar otras probabilidades. torch 2.14.0 de PyPI es cu130.
"$BASE/venv/bin/pip" install -q "torch==2.14.0" "laya==0.3.20" "transformers==5.17.0" "tokenizers==0.23.2" \
  "huggingface_hub==1.33.0" "safetensors==0.8.0" "numpy==2.5.3"
"$BASE/venv/bin/python" -c 'import torch; assert torch.cuda.is_available(), "torch no ve la GPU"; print("GPU:", torch.cuda.get_device_name(0))'

if [ ! -f "$MODELO/model.safetensors" ] || [ "${REENTRENAR:-0}" = 1 ]; then
  echo "Entrenando (la primera vez baja el modelo base, ~1,3 GB)…"
  (cd "$BASE" && venv/bin/python entrenar.py --datos datos --salida "$MODELO.nuevo" --device cuda)
  rm -rf "$MODELO" && mv "$MODELO.nuevo" "$MODELO"
fi

# Se reescribe en cada corrida con el puerto y el modelo de esta; la clave se conserva salvo que se pase LAYA_CLAVE.
CLAVE="${LAYA_CLAVE:-$(sudo sed -n 's/^LAYA_CLAVE=//p' "$ENTORNO" 2>/dev/null || true)}"
CLAVE="${CLAVE:-$(openssl rand -hex 24)}"
printf 'LAYA_CLAVE=%s\nLAYA_PUERTO=%s\nLAYA_MODELO=%s\n' "$CLAVE" "$PUERTO" "$MODELO" | sudo tee "$ENTORNO" >/dev/null
sudo chmod 600 "$ENTORNO"

sudo tee /etc/systemd/system/laya-electrum.service >/dev/null <<UNIT
[Unit]
Description=Laya · decisiones de Dr Electrum (:${PUERTO})
After=network-online.target

[Service]
EnvironmentFile=${ENTORNO}
WorkingDirectory=${BASE}
ExecStart=${BASE}/venv/bin/python ${BASE}/servidor.py
Restart=always
RestartSec=5
User=$(id -un)

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now laya-electrum
sudo systemctl restart laya-electrum

echo "Esperando a Laya…"
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PUERTO}/salud" >/dev/null 2>&1; then echo "laya listo en :${PUERTO}"; break; fi
  sleep 3
done
CLAVE="$(sudo sed -n 's/^LAYA_CLAVE=//p' "$ENTORNO")"
curl -fsS -H "Authorization: Bearer ${CLAVE}" -H 'content-type: application/json' \
  -d '{"texto":"¿Cuándo vence la concesión Quebrada Seca?"}' "http://127.0.0.1:${PUERTO}/decidir"; echo
echo
echo "El :${PUERTO} NO se abre en el security group: Laya sale por el Caddy de Voicebox con TLS."
echo "  /opt/voicebox/caddy/Caddyfile, antes de @autorizado:  handle_path /laya/* { reverse_proxy 127.0.0.1:${PUERTO} }"
echo "En Render (aura-fp y ultron-looi-desk): ULTRON_LAYA_URL=https://35-175-175-203.sslip.io/laya"
echo "  ULTRON_LAYA_CLAVE=<LAYA_CLAVE de ${ENTORNO}>  ULTRON_LAYA_TIMEOUT_MS=1000"
echo "Evaluar: cd ${BASE} && venv/bin/python evaluar.py --modelo ${MODELO} --tabla datos/test-tabla.jsonl --bordes datos/bordes-tabla.jsonl"
