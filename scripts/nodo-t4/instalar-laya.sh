#!/usr/bin/env bash
# Laya en el nodo T4 (g4dn.xlarge, 35.175.175.203): los modelos de decisión en un solo servicio.
#   electrum   qué especialistas convoca Dr Electrum (POST /decidir, lo usa lib/laya.ts)
#   mensaje    decisiones sobre cada mensaje de AU-RA / PULSE2CHAT (POST /v1/mensaje)
#   documento  qué es un fragmento de expediente y qué trae (POST /v1/documento)
#
# Ajusta Laya multilingüe con los datos de scripts/nodo-t4/laya/datos (electrum) y de
# scripts/nodo-t4/laya/modelos/<nombre>/datos (en la GPU tarda unos minutos cada uno), y lo deja como
# servicio systemd en :8792 con clave. No usa Docker: un venv y un unit, nada más.
# Requisitos: driver NVIDIA y python3 ≥ 3.12 con venv (numpy 2.5.3, fijado abajo, no existe para 3.11). Cabe junto a lo que ya corre: ~1,6 GB de VRAM
# el primer modelo y ~0,5 GB cada uno más (la tabla de embeddings, que no se entrena, se comparte).
#
# Uso, desde un clon del repo en el nodo:
#   bash scripts/nodo-t4/instalar-laya.sh                      # instala, entrena lo que no tenga modelo, arranca
#   REENTRENAR=1 bash scripts/nodo-t4/instalar-laya.sh         # vuelve a entrenar los tres (tras cambiar los datos)
#   REENTRENAR=mensaje bash scripts/nodo-t4/instalar-laya.sh   # solo ese (o «electrum», o «mensaje,documento»)
set -euo pipefail
AQUI="$(cd "$(dirname "$0")/laya" && pwd)"
BASE="${LAYA_BASE:-/opt/laya}"
PUERTO="${LAYA_PUERTO:-8792}"
MODELO="$BASE/modelo-electrum"
NUEVOS=(mensaje documento)
ENTORNO=/etc/laya-electrum.env

sudo mkdir -p "$BASE" && sudo chown "$(id -u):$(id -g)" "$BASE"
cp "$AQUI"/servidor.py "$AQUI"/entrenar.py "$AQUI"/evaluar.py "$AQUI"/comun.py "$AQUI"/preguntas.json "$BASE"/
rm -rf "$BASE/datos" && cp -r "$AQUI/datos" "$BASE/datos"
rm -rf "$BASE/modelos" && cp -r "$AQUI/modelos" "$BASE/modelos"

if [ ! -x "$BASE/venv/bin/python" ]; then
  python3 -m venv "$BASE/venv"
fi
"$BASE/venv/bin/pip" install -q --upgrade pip
# Las versiones que corren en el nodo (pip freeze del 26-09-2026). Sin fijarlas, reinstalar trae otro
# torch/transformers y el mismo checkpoint puede dar otras probabilidades. torch 2.14.0 de PyPI es cu130.
"$BASE/venv/bin/pip" install -q "torch==2.14.0" "laya==0.3.20" "transformers==5.17.0" "tokenizers==0.23.2" \
  "huggingface_hub==1.33.0" "safetensors==0.8.0" "numpy==2.5.3"
"$BASE/venv/bin/python" -c 'import torch; assert torch.cuda.is_available(), "torch no ve la GPU"; print("GPU:", torch.cuda.get_device_name(0))'

# ¿Toca reentrenar este modelo? REENTRENAR=1 (o «todos») son todos; si no, una lista con comas.
reentrenar() { local r="${REENTRENAR:-0}"; [ "$r" = 1 ] || [ "$r" = todos ] || [[ ",$r," == *",$1,"* ]]; }

if [ ! -f "$MODELO/model.safetensors" ] || reentrenar electrum; then
  echo "Entrenando electrum (la primera vez baja el modelo base, ~1,3 GB)…"
  (cd "$BASE" && venv/bin/python entrenar.py --datos datos --salida "$MODELO.nuevo" --device cuda)
  rm -rf "$MODELO" && mv "$MODELO.nuevo" "$MODELO"
fi

# Los modelos nuevos solo se entrenan si tienen preguntas y datos. Si su entrenamiento falla (datos
# mal etiquetados, por ejemplo) se avisa y se sigue: electrum se instala igual y el checkpoint
# anterior, si había, queda como estaba.
for n in "${NUEVOS[@]}"; do
  dir="$BASE/modelo-$n"
  if ! ls "$BASE/modelos/$n"/datos/train_*.jsonl >/dev/null 2>&1 || [ ! -f "$BASE/modelos/$n/preguntas.json" ]; then
    echo "AVISO: $n sin preguntas.json o sin datos/train_*.jsonl; no se entrena"
    continue
  fi
  if [ ! -f "$dir/model.safetensors" ] || reentrenar "$n"; then
    echo "Entrenando $n…"
    if (cd "$BASE" && venv/bin/python entrenar.py --modelo-dir "modelos/$n" --salida "$dir.nuevo" --device cuda); then
      rm -rf "$dir" && mv "$dir.nuevo" "$dir"
    else
      echo "AVISO: falló el entrenamiento de $n; se deja el checkpoint anterior (si lo hay)"
      rm -rf "$dir.nuevo"
    fi
  fi
done

# Se reescribe en cada corrida con el puerto y el modelo de esta; la clave se conserva salvo que se pase LAYA_CLAVE.
CLAVE="${LAYA_CLAVE:-$(sudo sed -n 's/^LAYA_CLAVE=//p' "$ENTORNO" 2>/dev/null || true)}"
CLAVE="${CLAVE:-$(openssl rand -hex 24)}"
printf 'LAYA_CLAVE=%s\nLAYA_PUERTO=%s\nLAYA_MODELO=%s\n' "$CLAVE" "$PUERTO" "$MODELO" | sudo tee "$ENTORNO" >/dev/null
sudo chmod 600 "$ENTORNO"

# Los tres --modelo siempre: uno sin checkpoint no impide arrancar, sale en /salud como no cargado.
MODELOS="--modelo electrum=${MODELO}"
for n in "${NUEVOS[@]}"; do MODELOS="$MODELOS --modelo $n=$BASE/modelo-$n"; done

sudo tee /etc/systemd/system/laya-electrum.service >/dev/null <<UNIT
[Unit]
Description=Laya · decisiones de Dr Electrum, mensajes y documentos (:${PUERTO})
After=network-online.target

[Service]
EnvironmentFile=${ENTORNO}
WorkingDirectory=${BASE}
ExecStart=${BASE}/venv/bin/python ${BASE}/servidor.py ${MODELOS}
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
for i in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${PUERTO}/salud" >/dev/null 2>&1; then echo "laya listo en :${PUERTO}"; break; fi
  sleep 3
done
curl -sS "http://127.0.0.1:${PUERTO}/salud" | "$BASE/venv/bin/python" -c \
  'import json,sys; d=json.load(sys.stdin); [print(f"  {n}: " + ("cargado · " + str(m["entrenado"]) if m["ok"] else "NO cargado · " + m["error"])) for n, m in d.get("modelos", {}).items()]'
CLAVE="$(sudo sed -n 's/^LAYA_CLAVE=//p' "$ENTORNO")"
curl -fsS -H "Authorization: Bearer ${CLAVE}" -H 'content-type: application/json' \
  -d '{"texto":"¿Cuándo vence la concesión Quebrada Seca?"}' "http://127.0.0.1:${PUERTO}/decidir"; echo
curl -sS -H "Authorization: Bearer ${CLAVE}" -H 'content-type: application/json' \
  -d '{"texto":"¿a cómo está el oro hoy?"}' "http://127.0.0.1:${PUERTO}/v1/mensaje"; echo
curl -sS -H "Authorization: Bearer ${CLAVE}" -H 'content-type: application/json' \
  -d '{"texto":"RESOLUCIÓN No. 123-2024 INHGEOMIN … Comuníquese. Firma y sello."}' "http://127.0.0.1:${PUERTO}/v1/documento"; echo
echo
echo "El :${PUERTO} NO se abre en el security group: Laya sale por el Caddy de Voicebox con TLS."
echo "  /opt/voicebox/caddy/Caddyfile, antes de @autorizado:  handle_path /laya/* { reverse_proxy 127.0.0.1:${PUERTO} }"
echo "En Render (aura-fp y ultron-looi-desk): ULTRON_LAYA_URL=https://35-175-175-203.sslip.io/laya"
echo "  ULTRON_LAYA_CLAVE=<LAYA_CLAVE de ${ENTORNO}>  ULTRON_LAYA_TIMEOUT_MS=1000"
echo "Evaluar: cd ${BASE} && venv/bin/python evaluar.py --modelo ${MODELO} --tabla datos/test-tabla.jsonl --bordes datos/bordes-tabla.jsonl"
for n in "${NUEVOS[@]}"; do
  echo "         cd ${BASE} && venv/bin/python evaluar.py --modelo ${BASE}/modelo-$n --modelo-dir modelos/$n --errores 20"
done
