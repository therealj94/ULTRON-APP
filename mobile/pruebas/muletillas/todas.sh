#!/bin/sh
# Las muletillas de la mesa con el código real (lib/speech + el oído Turbo, lib/muletillas*, lib/sfx, lib/tts) y lo
# nativo simulado: los clips con la voz de cada avatar, el micrófono con el cancelador de eco, el «mjm» que no alarga
# la frase ni llega a Turbo, el texto limpio, la interrupción intacta y el interruptor del servidor (AURA_ASENTIR=0).
# SRC=/copia/de/main/mobile/src sh todas.sh corre lo mismo contra otro código (main no trae las muletillas: falla).
cd "$(dirname "$0")" || exit 1
if [ -n "$SRC" ]; then SALIDA="${SALIDA:-out/muletillas-otro.cjs}"; export SALIDA; fi
node construir.cjs || exit 1
MUL="$(node -e 'console.log(require("path").resolve(process.argv[1]))' "${SALIDA:-out/muletillas.cjs}")" timeout 120 node conversacion.cjs
