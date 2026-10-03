#!/bin/sh
# La tarjeta de Veta Wallet dentro de AURA: sesión, tarjeta y desbloqueo con huella (lo nativo, simulado);
# y de quién es cada respuesta de Veta y de la cartera cuando cambia la cuenta de AURA (AUR01).
cd "$(dirname "$0")" || exit 1
node construir.cjs || exit 1
fallos=0
for t in veta aislamiento; do
  echo "\n══ $t"
  timeout 120 node "$t.cjs" || fallos=$((fallos + 1))
done
echo "\n$fallos prueba(s) con fallos"
exit $fallos
