#!/bin/sh
# Los sonidos de trabajo (José, 6-oct: «si está haciendo o pensando algo que se escuchen cosas como eso del teclado,
# tanto con el avatar como en la llamada») con el código real (compa/trabajoMesa, compa/ambiente, compa/sonidosTrabajo,
# compa/ambienteSonido, lib/ambienteAjuste) y lo nativo simulado (expo-av, el disco, /api/movil/config); de paso, el
# silencio del micrófono con hora (8 h) y la gracia del segundo plano (lib/silencioMesa, lib/appDelante).
# SRC=/copia/de/main/mobile/src sh todas.sh corre lo mismo contra otro código (main no trae nada de esto: falla).
cd "$(dirname "$0")" || exit 1
if [ -n "$SRC" ]; then SALIDA="${SALIDA:-out/sonidos-otro.cjs}"; export SALIDA; fi
node construir.cjs || exit 1
SON="$(node -e 'console.log(require("path").resolve(process.argv[1]))' "${SALIDA:-out/sonidos.cjs}")" timeout 120 node sonidos.cjs
