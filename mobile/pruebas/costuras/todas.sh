#!/bin/sh
# Las costuras entre frentes (bus + chat + compañera + llamadas, con el relevo REAL y lo nativo
# simulado). Construye el paquete para node y corre cada prueba. RELEVO_PY= apunta a una copia local
# de infra/mensajes/servidor.py (por omisión, la del repo express-js-on-vercel); sin él, se saltan.
# COSTURAS=/ruta/otro-paquete.cjs corre las mismas pruebas contra otro código (ver construir.cjs).
cd "$(dirname "$0")" || exit 1
node construir.cjs || exit 1
fallos=0
for t in envio contactos llamada cabeceras sesion; do
  echo "\n══ $t"
  timeout 180 node "$t.cjs" || fallos=$((fallos + 1))
done
echo "\n$fallos prueba(s) con fallos"
exit $fallos
