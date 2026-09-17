#!/usr/bin/env bash
# Arranca i-02653feadc919d3a4 (g4dn T4) y reporta ULTRON_TTS_URL.
# NO toca A10G (27B) ni Playwright.
set -euo pipefail

INSTANCE_ID="${ULTRON_TTS_INSTANCE_ID:-i-02653feadc919d3a4}"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
PORT="${ULTRON_TTS_PORT:-8790}"

if [[ -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  echo "Faltan AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (rotar si estuvo en cuarentena)." >&2
  exit 1
fi

echo "[tts] StartInstances $INSTANCE_ID ($REGION)"
aws ec2 start-instances --instance-ids "$INSTANCE_ID" --region "$REGION" >/dev/null

echo "[tts] Esperando running + IP pública…"
for i in $(seq 1 40); do
  STATE=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --region "$REGION" \
    --query 'Reservations[0].Instances[0].State.Name' --output text)
  IP=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --region "$REGION" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
  echo "  intento $i: state=$STATE ip=$IP"
  if [[ "$STATE" == "running" && "$IP" != "None" && -n "$IP" ]]; then
    echo
    echo "ULTRON_TTS_URL=http://${IP}:${PORT}"
    echo "Pon esa variable + ULTRON_TTS_CLAVE en Render, luego en la T4: bash tts-node/deploy.sh"
    echo "Salud: curl -H \"x-ultron-tts-clave: \$ULTRON_TTS_CLAVE\" http://${IP}:${PORT}/salud"
    exit 0
  fi
  sleep 5
done

echo "[tts] Timeout esperando IP" >&2
exit 2
