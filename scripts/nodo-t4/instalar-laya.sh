#!/usr/bin/env bash
# Laya en el nodo T4 (g4dn.xlarge, 35.175.175.203): los modelos de decisión en un solo servicio.
#   electrum   qué especialistas convoca Dr Electrum (POST /decidir, lo usa lib/laya.ts)
#   mensaje    decisiones sobre cada mensaje de AU-RA / PULSE2CHAT (POST /v1/mensaje)
#   documento  qué es un fragmento de expediente y qué trae (POST /v1/documento)
#   comando    la orden dicha en voz alta: Dr Electrum y las manos de AU-RA (POST /v1/comando)
#   windows    la mano de AURA para Windows que pidió la persona (POST /v1/windows, lo pide el .exe por /api/windows/intencion)
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
#   REENTRENAR=windows bash scripts/nodo-t4/instalar-laya.sh   # solo el del .exe (receta rápida en su modelo.json)
#   Con datos reales de la Escuela en /opt/laya-reales (ver scripts/entrenamiento/README.md) se suman solos.
#   Un modelo reentrenado se promueve solo si no empeora al anterior en las pruebas (FORZAR=1 lo salta).
set -euo pipefail
AQUI="$(cd "$(dirname "$0")/laya" && pwd)"
BASE="${LAYA_BASE:-/opt/laya}"
PUERTO="${LAYA_PUERTO:-8792}"
MODELO="$BASE/modelo-electrum"
NUEVOS=(mensaje documento comando windows)
ENTORNO=/etc/laya-electrum.env

sudo mkdir -p "$BASE" && sudo chown "$(id -u):$(id -g)" "$BASE"
cp "$AQUI"/servidor.py "$AQUI"/entrenar.py "$AQUI"/evaluar.py "$AQUI"/comun.py "$AQUI"/preguntas.json "$BASE"/
rm -rf "$BASE/datos" && cp -r "$AQUI/datos" "$BASE/datos"
rm -rf "$BASE/modelos" && cp -r "$AQUI/modelos" "$BASE/modelos"
cp "$AQUI"/comparar.py "$BASE"/

# Datos REALES revisados en la Escuela (scripts/entrenamiento/exportar.ts), fuera del repositorio
# porque son preguntas de personas: $LAYA_REALES/electrum/train_*.jsonl y $LAYA_REALES/<modelo>/train_*.jsonl.
REALES="${LAYA_REALES:-/opt/laya-reales}"
if [ -d "$REALES/electrum" ]; then cp "$REALES"/electrum/train_*.jsonl "$BASE/datos/" 2>/dev/null && echo "electrum: + datos reales de $REALES/electrum"; fi
for n in "${NUEVOS[@]}"; do
  if [ -d "$REALES/$n" ]; then cp "$REALES/$n"/train_*.jsonl "$BASE/modelos/$n/datos/" 2>/dev/null && echo "$n: + datos reales de $REALES/$n"; fi
done

# Promover un modelo recién entrenado SOLO si no empeora al que está sirviendo, medidos los dos sobre
# las mismas pruebas apartadas (comparar.py). FORZAR=1 lo promueve igual (la primera vez no hay con qué
# comparar). El rechazado queda en <dir>.rechazado para mirarlo.
promover() {  # promover <dir actual> <dir nuevo> <argumentos de evaluar.py…>
  local actual="$1" nuevo="$2"; shift 2
  if [ "${FORZAR:-0}" = 1 ]; then
    rm -rf "$actual" && mv "$nuevo" "$actual"; return 0
  fi
  if [ ! -f "$actual/model.safetensors" ]; then
    # La primera vez no hay con qué comparar, pero un mínimo (MINIMO_COMPARAR) se exige igual: el nuevo
    # se compara consigo mismo, así solo cuenta el mínimo.
    if [ -n "${MINIMO_COMPARAR:-}" ]; then
      (cd "$BASE" && venv/bin/python evaluar.py --modelo "$nuevo" "$@" --json "$nuevo.nuevo.json" >/dev/null)
      if ! (cd "$BASE" && venv/bin/python comparar.py "$nuevo.nuevo.json" "$nuevo.nuevo.json" ${MINIMO_COMPARAR}); then
        rm -rf "$actual.rechazado" && mv "$nuevo" "$actual.rechazado"
        echo "AVISO: el primer $(basename "$actual") no llega al mínimo; no se instala (quedó en $actual.rechazado; FORZAR=1 lo instala igual)"
        return 0
      fi
    fi
    rm -rf "$actual" && mv "$nuevo" "$actual"; return 0
  fi
  (cd "$BASE" && venv/bin/python evaluar.py --modelo "$actual" "$@" --json "$nuevo.viejo.json" >/dev/null \
     && venv/bin/python evaluar.py --modelo "$nuevo" "$@" --json "$nuevo.nuevo.json" >/dev/null)
  # MINIMO_COMPARAR: lo que el nuevo tiene que alcanzar aunque el anterior fuera peor (ver el bucle de abajo).
  if (cd "$BASE" && venv/bin/python comparar.py "$nuevo.viejo.json" "$nuevo.nuevo.json" ${MINIMO_COMPARAR:-}); then
    rm -rf "$actual.anterior" && mv "$actual" "$actual.anterior" && mv "$nuevo" "$actual"
  else
    rm -rf "$actual.rechazado" && mv "$nuevo" "$actual.rechazado"
    echo "AVISO: el nuevo $(basename "$actual") no se promueve; sigue el anterior (el nuevo quedó en $actual.rechazado)"
  fi
}

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
  promover "$MODELO" "$MODELO.nuevo" --tabla datos/test-tabla.jsonl --bordes datos/bordes-tabla.jsonl
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
      # «comando»: las manos de AU-RA (grupo app) se ejecutan sin esperar al cerebro; el nuevo no entra
      # si en la prueba de AU-RA (evals = test_app.jsonl, español e inglés) acierta menos del 85 %.
      minimo=""; [ "$n" = comando ] && minimo="--minimo evals:app=0.85"
      # «windows»: el .exe ejecuta la mano que diga Laya cuando va segura; en su prueba apartada
      # (español e inglés, 31 manos) tiene que acertar al menos el 90 % para entrar.
      [ "$n" = windows ] && minimo="--minimo test:win=0.90"
      MINIMO_COMPARAR="$minimo" promover "$dir" "$dir.nuevo" --modelo-dir "modelos/$n"
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
# «comando», grupo app de AU-RA: una orden en inglés tiene que dar app_avatar (y accion ninguna).
curl -sS -H "Authorization: Bearer ${CLAVE}" -H 'content-type: application/json' \
  -d '{"texto":"switch me to claudio"}' "http://127.0.0.1:${PUERTO}/v1/comando"; echo
echo
echo "El :${PUERTO} NO se abre en el security group: Laya sale por el Caddy de Voicebox con TLS."
echo "  /opt/voicebox/caddy/Caddyfile, antes de @autorizado:  handle_path /laya/* { reverse_proxy 127.0.0.1:${PUERTO} }"
echo "En Render (aura-fp y ultron-looi-desk): ULTRON_LAYA_URL=https://35-175-175-203.sslip.io/laya"
echo "  ULTRON_LAYA_CLAVE=<LAYA_CLAVE de ${ENTORNO}>  ULTRON_LAYA_TIMEOUT_MS=1000"
echo "Evaluar: cd ${BASE} && venv/bin/python evaluar.py --modelo ${MODELO} --tabla datos/test-tabla.jsonl --bordes datos/bordes-tabla.jsonl"
for n in "${NUEVOS[@]}"; do
  echo "         cd ${BASE} && venv/bin/python evaluar.py --modelo ${BASE}/modelo-$n --modelo-dir modelos/$n --errores 20"
done
