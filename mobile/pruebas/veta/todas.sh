#!/bin/sh
# La tarjeta de Veta Wallet dentro de AURA: sesión, tarjeta y desbloqueo con huella (lo nativo, simulado).
cd "$(dirname "$0")" || exit 1
node construir.cjs || exit 1
timeout 120 node veta.cjs
