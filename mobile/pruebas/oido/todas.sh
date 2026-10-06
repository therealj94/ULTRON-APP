#!/bin/sh
# El oído de la app con el código real (lib/speech*, compa/duenoAudio, compa/sesion, compa/animo) y lo
# nativo simulado: la secuencia que José probó en la APK 5.1 (mesa → chats → doble toque → mesa), el
# reconocedor que falla al arrancar, el `end` tardío de un abort() y [latencia]: cuándo empieza a sonar
# la respuesta de la mesa según lo que tarde el cerebro (y si suena «déjame ver»), LA LLAMADA DEL AVATAR
# de punta a punta (mesa habla → «llámame» → suena → contestar → hablar → minimizar → chats → volver →
# colgar → la compañera entra caminando → la mesa vuelve a escuchar; el recordatorio que llama; el
# «¿sigues ahí?»), [minutos]: lo conectado en una llamada típica, y [locutor]: el locutor por frases
# (VOZ-01 «Sí.» no atasca, VOZ-03 cancelar es cancelar, la traza mide cuando el reproductor confirma) y
# [vozvivo]: la voz en streaming (5.5) con el reproductor nativo simulado (camino, cola sin hueco, respaldo, boca).
# SRC=/copia/de/main/mobile/src sh todas.sh corre las mismas pruebas contra otro código (y falla con main).
cd "$(dirname "$0")" || exit 1
if [ -n "$SRC" ]; then SALIDA="${SALIDA:-out/oido-otro.cjs}"; export SALIDA; fi
node construir.cjs || exit 1
fallos=0
OIDO="$(node -e 'console.log(require("path").resolve(process.argv[1]))' "${SALIDA:-out/oido.cjs}")" timeout 300 node secuencia.cjs || fallos=1
echo
OIDO="$(node -e 'console.log(require("path").resolve(process.argv[1]))' "${SALIDA:-out/oido.cjs}")" timeout 120 node latencia.cjs || fallos=1
echo
OIDO="$(node -e 'console.log(require("path").resolve(process.argv[1]))' "${SALIDA:-out/oido.cjs}")" timeout 120 node minutos.cjs || fallos=1
echo
OIDO="$(node -e 'console.log(require("path").resolve(process.argv[1]))' "${SALIDA:-out/oido.cjs}")" timeout 120 node locutor.cjs || fallos=1
echo
OIDO="$(node -e 'console.log(require("path").resolve(process.argv[1]))' "${SALIDA:-out/oido.cjs}")" timeout 120 node vozvivo.cjs || fallos=1
exit $fallos
