#!/bin/sh
# La recarga sin cierre (emulador, 8-oct: «Player is accessed on the wrong thread» al recargar por la OTA; José, 7-oct:
# la app se cerró ~13 s tras abrir): App.tsx, lib/ota.ts, lib/recarga.ts y lib/avRegistro.ts de verdad, con expo-av y
# expo-updates simulados. Antes de reloadAsync no queda ningún sonido cargado ni <Video> montado, una sola recarga, y
# lo descargado que ya corre no se aplica otra vez.
# SRC=/copia/de/main/mobile/src sh todas.sh corre lo mismo contra otro código (main no trae lib/recarga.ts: falla).
cd "$(dirname "$0")" || exit 1
if [ -n "$SRC" ]; then SALIDA="${SALIDA:-out/recarga-otro.cjs}"; export SALIDA; fi
node construir.cjs || exit 1
RECARGA="$(node -e 'console.log(require("path").resolve(process.argv[1]))' "${SALIDA:-out/recarga.cjs}")" timeout 120 node recarga.cjs
