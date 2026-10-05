#!/bin/sh
# Construye el código del chat para node y corre todas las pruebas. RELEVO_PY= apunta a una copia
# local de infra/mensajes/servidor.py (por omisión, la del repo express-js-on-vercel).
cd "$(dirname "$0")" || exit 1
node construir.cjs || exit 1
fallos=0
for t in llavero carrera veneno rendimiento nombre sso vuelta clave cifrado senal voz formato; do
  echo "\n══ $t"
  timeout 180 node "$t.cjs" || fallos=$((fallos + 1))
done
echo "\n$fallos prueba(s) con fallos"
exit $fallos
