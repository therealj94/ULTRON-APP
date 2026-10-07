#!/usr/bin/env bash
# LA PRUEBA EN EL EMULADOR: AU-RA FP publicada + la OTA de producción, contra https://aura-fp.onrender.com.
#
# Corre DENTRO de reactivecircus/android-emulator-runner (.github/workflows/emulador-android.yml), con el emulador
# ya encendido y `adb` apuntándole. Instala la APK del Release, la deja traer la OTA (abrir → esperar → reabrir),
# entra con la cuenta de PRUEBA (si están los secretos y cuenta-prueba.mjs dijo que es segura) y corre los
# escenarios por el chat de la mesa (texto, nunca el micrófono). Lo que ve lo lee de la pantalla
# (transcripcion.mjs sobre `maestro hierarchy`).
#
# Evidencia en $EVIDENCIA: capturas/ (una por paso), video/ (trozos de <3 min), logcat-app.txt (solo la app),
# datos/ (lo leído en cada paso) y resultados.tsv (escenario, PASA|FALLA|OMITIDO, detalle) para el resumen.
#
# LO QUE NUNCA SALE EN LA EVIDENCIA (el repositorio es público y los artefactos se pueden bajar): ni el correo ni
# la clave de la cuenta de prueba. Durante la entrada no hay capturas ni grabación, el registro de Maestro de esos
# pasos no se sube y todo lo de texto pasa por `enmascarar`.
#
# Entorno: EVIDENCIA, APK_AURA (ruta del .apk), CUENTA_SEGURA (true|false), CUENTA_MOTIVO, OTA_ESPERADA (updateId
# de la OTA publicada para el runtime de esa APK, o vacío) y, solo si hay cuenta, AURA_PRUEBA_CORREO/CLAVE.
set -uo pipefail

PKG="link.ordenglobal.ultronfp"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLUJOS="$AQUI/flujos"
EVID="${EVIDENCIA:?falta EVIDENCIA}"
APK="${APK_AURA:?falta APK_AURA}"
TMP="${RUNNER_TEMP:-/tmp}/emulador"
mkdir -p "$EVID/capturas" "$EVID/video" "$EVID/datos" "$TMP/jerarquia" "$TMP/maestro"
RES="$EVID/resultados.tsv"
: > "$RES"
: > "$TMP/enviados.txt"
: > "$TMP/pids.txt"
PASO=0
DRIVER=""          # vacío = la primera llamada a Maestro instala su driver; después, --no-reinstall-driver
LOGCAT="$TMP/logcat.txt"

export MAESTRO_CLI_NO_ANALYTICS=1 MAESTRO_DISABLE_UPDATE_CHECK=1 MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
export MAESTRO_DRIVER_STARTUP_TIMEOUT=180000

# ── utilidades ──────────────────────────────────────────────────────────────────────────────────────────

# Quita el correo (y su parte antes de la @) y la clave de la cuenta de prueba de cualquier texto.
enmascarar() {
  perl -pe 'BEGIN { $c = lc($ENV{AURA_PRUEBA_CORREO} // ""); $k = $ENV{AURA_PRUEBA_CLAVE} // ""; ($l) = split /@/, $c; $l //= ""; }
            if ($k ne "") { s/\Q$k\E/***/g }
            if ($c ne "") { s/\Q$c\E/<correo-de-prueba>/gi }
            if (length($l) >= 3) { s/\Q$l\E/<usuario-de-prueba>/gi }'
}

registrar() { # escenario estado detalle
  local detalle
  detalle="$(printf '%s' "$3" | tr '\t\n\r' '   ' | enmascarar)"
  printf '%s\t%s\t%s\n' "$1" "$2" "$detalle" >> "$RES"
  echo "::group::[$2] $1"; echo "$detalle"; echo "::endgroup::"
}

captura() { # nombre
  PASO=$((PASO + 1))
  local f
  f="$EVID/capturas/$(printf '%02d' "$PASO")-$1.png"
  adb exec-out screencap -p > "$f" 2>/dev/null || true
  [ -s "$f" ] || rm -f "$f"
}

anotar_pid() { adb shell pidof "$PKG" 2>/dev/null | tr -d '\r' | tr ' ' '\n' | grep -E '^[0-9]+$' >> "$TMP/pids.txt" || true; }

lanzar() {
  adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 > /dev/null 2>&1
  sleep 3
  anotar_pid
}

enfocada() { adb shell dumpsys window 2>/dev/null | grep -E "mCurrentFocus|mFocusedApp" | grep -q "$PKG"; }

# Cierres de la app en el logcat hasta ahora: excepción Java, cierre nativo o ANR.
cierres() {
  local java nativo anr
  java=$(grep -A3 "FATAL EXCEPTION" "$LOGCAT" 2>/dev/null | grep -c "Process: $PKG")
  nativo=$(grep -c ">>> $PKG <<<" "$LOGCAT" 2>/dev/null)
  anr=$(grep -c "ANR in $PKG" "$LOGCAT" 2>/dev/null)
  echo $(( ${java:-0} + ${nativo:-0} + ${anr:-0} ))
}

ocultar_teclado() {
  if adb shell dumpsys input_method 2>/dev/null | grep -qE "mInputShown=true|mIsInputViewShown=true"; then
    adb shell input keyevent 4
    sleep 1
  fi
}

# maestro_flujo <nombre-de-registro> <secreto:si|no> <flujo.yaml> [-e K=V …]
# El registro de los flujos con secreto se queda fuera de la evidencia; del resto se guarda (enmascarado).
maestro_flujo() {
  local nombre="$1" secreto="$2" flujo="$3"
  shift 3
  local log="$TMP/maestro/$PASO-$nombre.log" rc
  timeout 420 maestro test $DRIVER --test-output-dir "$TMP/maestro/$PASO-$nombre" "$@" "$FLUJOS/$flujo" > "$log" 2>&1
  rc=$?
  DRIVER="--no-reinstall-driver"
  if [ "$secreto" = "no" ]; then
    enmascarar < "$log" > "$EVID/datos/maestro-$(printf '%02d' "$PASO")-$nombre.log"
  fi
  if [ $rc -ne 0 ]; then
    echo "::warning::Maestro «$nombre» terminó con código $rc"
    # Lo que dijo Maestro al fallar, sin las líneas que llevan lo escrito (el correo o la clave).
    grep -vE "Input text|inputText" "$log" | tail -n 25 | enmascarar
  fi
  return $rc
}

jerarquia() { # nombre → imprime la ruta del JSON (sin enmascarar: solo para leer aquí)
  local out="$TMP/jerarquia/$1.json"
  timeout 120 maestro hierarchy --no-reinstall-driver > "$out" 2> "$out.err" || true
  echo "$out"
}

enviar() { # mensaje
  printf '%s\n' "$1" >> "$TMP/enviados.txt"
  maestro_flujo "enviar" no enviar.yaml -e "MENSAJE=$1"
}

# esperar_respuesta <mensaje> <nombre> [tope_s] [patrón]: lee la pantalla hasta que lo que el avatar dijo después
# de <mensaje> esté y no cambie (o, con <patrón>, hasta que aparezca). Deja datos/<nombre>.json y una captura.
esperar_respuesta() {
  local msg="$1" nombre="$2" tope="${3:-150}" patron="${4:-}"
  local fin=$((SECONDS + tope)) previo="" r="$TMP/$nombre.json" j="" resp pens
  ocultar_teclado
  sleep 4
  echo '{}' > "$r"
  while [ $SECONDS -lt $fin ]; do
    j=$(jerarquia "$nombre")
    node "$AQUI/transcripcion.mjs" respuesta "$j" "$msg" "$TMP/enviados.txt" > "$r.nuevo" 2>> "$TMP/transcripcion.err" && mv "$r.nuevo" "$r"
    resp=$(jq -r '.respuesta // ""' "$r" 2>/dev/null)
    pens=$(jq -r '.pensando // false' "$r" 2>/dev/null)
    if [ -n "$patron" ]; then
      if jq -r '[.todoDespues // "", ((.textos // []) | map(select(.rol != "usuario") | .texto) | join(" "))] | join(" ")' "$r" | grep -qiE "$patron"; then break; fi
    elif [ -n "$resp" ] && [ "$pens" != "true" ]; then
      [ "$resp" = "$previo" ] && break
      previo="$resp"
    fi
    sleep 3
  done
  enmascarar < "$r" > "$EVID/datos/$nombre.json"
  [ -n "$j" ] && enmascarar < "$j" > "$EVID/datos/$nombre.jerarquia.json"
  captura "$nombre"
}

# ¿Queda tiempo para otro escenario? (el paso del emulador tiene su tope; el resumen y la evidencia van después)
LIMITE_S="${LIMITE_S:-840}"
hay_tiempo() { # titulo
  if [ $SECONDS -lt "$LIMITE_S" ]; then return 0; fi
  registrar "$1" OMITIDO "Sin tiempo: el paso del emulador llegó a su tope (${LIMITE_S} s de prueba) antes de este escenario."
  return 1
}

veredicto() { # escenario titulo datos1 [datos2]
  local esc="$1" titulo="$2" v estado detalle
  v=$(node "$AQUI/transcripcion.mjs" veredicto "$esc" "$3" "${4:-}")
  estado=$(printf '%s' "$v" | jq -r '.estado // "FALLA"')
  detalle=$(printf '%s' "$v" | jq -r '.detalle // .error // "sin detalle"')
  registrar "$titulo" "$estado" "$detalle"
}

grabar_inicio() {
  touch "$TMP/grabando"
  (
    i=0
    while [ -f "$TMP/grabando" ]; do
      i=$((i + 1))
      adb shell screenrecord --time-limit 170 --bit-rate 3000000 "/sdcard/grabacion-$(printf '%02d' "$i").mp4" > /dev/null 2>&1 || sleep 2
    done
  ) &
  GRABANDO=$!
}

grabar_fin() {
  [ -f "$TMP/grabando" ] || return 0
  rm -f "$TMP/grabando"
  adb shell pkill -INT screenrecord > /dev/null 2>&1 || true
  sleep 4
  wait "${GRABANDO:-0}" 2> /dev/null || true
  for f in $(adb shell ls /sdcard/ 2>/dev/null | tr -d '\r' | grep -E '^grabacion-[0-9]+\.mp4$'); do
    adb pull "/sdcard/$f" "$EVID/video/$f" > /dev/null 2>&1 || true
  done
  adb shell rm -f /sdcard/grabacion-*.mp4 > /dev/null 2>&1 || true
}

terminar() {
  grabar_fin
  [ -n "${SEGUIR_PIDS:-}" ] && kill "$SEGUIR_PIDS" 2> /dev/null
  sleep 1
  [ -n "${LOGCAT_PID:-}" ] && kill "$LOGCAT_PID" 2> /dev/null
  # Solo la app: las líneas de sus procesos, más los cierres y las actualizaciones por aire.
  local pids
  pids=$(sort -u "$TMP/pids.txt" | paste -sd' ' -)
  awk -v pids=" $pids " -v pkg="$PKG" '
    { if (index(pids, " " $3 " ") > 0 || index($0, pkg) > 0 || $0 ~ /AndroidRuntime|FATAL EXCEPTION|dev\.expo\.updates|ReactNativeJS/) print }
  ' "$LOGCAT" 2> /dev/null | enmascarar > "$EVID/logcat-app.txt"
  grep -E "dev\.expo\.updates" "$LOGCAT" 2> /dev/null | enmascarar > "$EVID/datos/expo-updates.txt"
}
trap terminar EXIT

# ── 0. el emulador y la APK ───────────────────────────────────────────────────────────────────────────────

adb logcat -c || true
adb logcat -v threadtime > "$LOGCAT" 2>&1 &
LOGCAT_PID=$!
( while true; do anotar_pid; sleep 5; done ) &
SEGUIR_PIDS=$!

ABIS=$(adb shell getprop ro.product.cpu.abilist | tr -d '\r')
echo "ABIs del emulador: $ABIS"
APK_ABIS=$(unzip -l "$APK" | grep -oE 'lib/[^/]+/' | sort -u | sed 's#lib/##; s#/##' | paste -sd',' -)
echo "ABIs de la APK: ${APK_ABIS:-ninguna (solo JS)}"
printf 'emulador\t%s\napk\t%s\n' "$ABIS" "${APK_ABIS:-}" > "$EVID/datos/abis.tsv"

if ! SALIDA=$(adb install -r -g "$APK" 2>&1); then
  echo "$SALIDA" | tail -n 5
  registrar "0 · Instalar la APK" FALLA "adb install falló: $(echo "$SALIDA" | grep -oE 'INSTALL_[A-Z_]+' | head -n1) (emulador: $ABIS; APK: ${APK_ABIS:-?})"
  exit 1
fi
registrar "0 · Instalar la APK" PASA "Instalada ($(basename "$APK")); emulador $ABIS, APK $APK_ABIS (ARM traducido en x86_64)."

# ── 0. abrir, dejar que traiga la OTA de producción y reabrir ──────────────────────────────────────────────

if [ "${CUENTA_SEGURA:-false}" != "true" ]; then
  # Sin cuenta no se escribe nada privado: se graba desde la apertura.
  grabar_inicio
fi
lanzar
sleep 45
captura "primer-arranque"
adb shell am force-stop "$PKG"
sleep 2
lanzar
sleep 20
captura "segundo-arranque"
# La actualización que la app guardó y carga (expo-updates: «Stored update found: ID = …»), frente a la publicada.
OTA_CARGADA=$(grep -oE 'Stored update found: ID = [0-9a-fA-F-]+' "$LOGCAT" | tail -n 1 | awk '{print $NF}')
if [ -z "$OTA_CARGADA" ]; then
  OTA_VISTA="no (la app sigue con el JS de la APK)"
elif [ -n "${OTA_ESPERADA:-}" ] && [ "$(echo "$OTA_CARGADA" | tr 'A-F' 'a-f')" = "$(echo "$OTA_ESPERADA" | tr 'A-F' 'a-f')" ]; then
  OTA_VISTA="sí, la publicada ($OTA_CARGADA)"
else
  OTA_VISTA="otra: $OTA_CARGADA"
fi

ANTES=$(cierres)
if maestro_flujo "abrir" no abrir.yaml && enfocada; then
  captura "entrada"
  registrar "0 · La app abre (sin cuenta)" PASA "Abre y llega a la entrada. OTA publicada: ${OTA_ESPERADA:-(sin ficha)}; la que carga la app: $OTA_VISTA. Cierres: $(( $(cierres) - ANTES ))."
else
  captura "entrada-fallo"
  registrar "0 · La app abre (sin cuenta)" FALLA "No llegó a la entrada (o la app no está delante). OTA que carga: $OTA_VISTA. Cierres en el logcat: $(cierres)."
fi

# ── sin cuenta segura: lo que necesita entrar se salta, diciendo por qué ─────────────────────────────────────

if [ "${CUENTA_SEGURA:-false}" != "true" ]; then
  # Lo que sí se puede sin cuenta: llegar al formulario de correo y clave (sin escribir nada).
  if maestro_flujo "entrada-sin-escribir" no entrada-sin-escribir.yaml; then
    captura "formulario-de-entrada"
    registrar "0 · El formulario de correo y clave (sin escribir)" PASA "«Otras formas de entrar» → «Otra cuenta»: el campo del correo, el de la clave y «Entrar» están donde los busca la entrada con cuenta."
  else
    captura "formulario-de-entrada-fallo"
    registrar "0 · El formulario de correo y clave (sin escribir)" FALLA "No se llegó al formulario de correo y clave (ver datos/maestro-*-entrada-sin-escribir.log)."
  fi
  MOTIVO="${CUENTA_MOTIVO:-Faltan los secretos AURA_PRUEBA_CORREO / AURA_PRUEBA_CLAVE.}"
  for e in "1 · Abre, entra y la mesa se ve" "2 · Cambiar a Claudio pide confirmación" "3 · La misma pregunta dos veces" "4 · «¿me oyes?» no se come la pregunta" "5 · La cámara aguanta 20 s"; do
    registrar "$e" OMITIDO "Sin cuenta de prueba segura: $MOTIVO"
  done
  if [ "$(cierres)" -gt 0 ]; then registrar "Cierres de la app" FALLA "El logcat tiene $(cierres) cierre(s) de la app (FATAL EXCEPTION / nativo / ANR)."; fi
  exit 0
fi

# ── 1. entrar con la cuenta de prueba (sin capturas ni grabación) ─────────────────────────────────────────

ANTES=$(cierres)
ENTRO=no
if MAESTRO_CORREO_PRUEBA="$AURA_PRUEBA_CORREO" maestro_flujo "entrar-correo" si entrar-correo.yaml; then
  ocultar_teclado
  if MAESTRO_CLAVE_PRUEBA="$AURA_PRUEBA_CLAVE" maestro_flujo "entrar-clave" si entrar-clave.yaml; then ENTRO=si; fi
fi
# Lo que Maestro guardó de la entrada lleva lo escrito: fuera, aunque nunca se suba.
rm -rf "$TMP"/maestro/*entrar-*
if [ "$ENTRO" != si ]; then
  # Sin captura ni grabación: la pantalla de entrada enseña el correo.
  registrar "1 · Abre, entra y la mesa se ve" FALLA "No pudo entrar con la cuenta de prueba (el motivo, sin datos de la cuenta, está en el registro del paso)."
  for e in "2 · Cambiar a Claudio pide confirmación" "3 · La misma pregunta dos veces" "4 · «¿me oyes?» no se come la pregunta" "5 · La cámara aguanta 20 s"; do
    registrar "$e" OMITIDO "No se pudo entrar (escenario 1)."
  done
  adb shell am force-stop "$PKG" || true
  exit 1
fi
maestro_flujo "primera-vez" no primera-vez.yaml || true
captura "despues-de-entrar"
maestro_flujo "mesa" no mesa.yaml || true
grabar_inicio
captura "mesa"
j=$(jerarquia "mesa")
node "$AQUI/transcripcion.mjs" leer "$j" "$TMP/enviados.txt" > "$TMP/mesa.json" 2>/dev/null || echo '{}' > "$TMP/mesa.json"
enmascarar < "$TMP/mesa.json" > "$EVID/datos/mesa.json"
N=$(( $(cierres) - ANTES ))
if [ "$N" -gt 0 ]; then
  registrar "1 · Abre, entra y la mesa se ve" FALLA "Entró, pero el logcat tiene $N cierre(s) de la app."
else
  veredicto 1 "1 · Abre, entra y la mesa se ve" "$TMP/mesa.json"
fi
if ! jq -e '.chat == true' "$TMP/mesa.json" > /dev/null 2>&1; then
  for e in "2 · Cambiar a Claudio pide confirmación" "3 · La misma pregunta dos veces" "4 · «¿me oyes?» no se come la pregunta" "5 · La cámara aguanta 20 s"; do
    registrar "$e" OMITIDO "La mesa no quedó lista para escribir (escenario 1)."
  done
  exit 1
fi

# ── 2. «Necesito que cambies a Claudio»: pregunta y no cambia; «no, quédate»: sigue AU-RA ───────────────────

M1="Necesito que cambies a Claudio"
M2="no, quédate"
if hay_tiempo "2 · Cambiar a Claudio pide confirmación"; then
  enviar "$M1"
  esperar_respuesta "$M1" "e2-cambiar-a-claudio" 90
  enviar "$M2"
  esperar_respuesta "$M2" "e2-no-quedate" 90
  veredicto 2 "2 · Cambiar a Claudio pide confirmación" "$TMP/e2-cambiar-a-claudio.json" "$TMP/e2-no-quedate.json"
fi

# ── 3. la misma pregunta dos veces seguidas: no el mismo párrafo, nunca «ya te lo dije» ───────────────────────

P="¿Qué hora es en Honduras?"
if hay_tiempo "3 · La misma pregunta dos veces"; then
  enviar "$P"
  esperar_respuesta "$P" "e3-primera" 90
  enviar "$P"
  esperar_respuesta "$P" "e3-segunda" 90
  veredicto 3 "3 · La misma pregunta dos veces" "$TMP/e3-primera.json" "$TMP/e3-segunda.json"
fi

# ── 4. una pregunta de verdad y enseguida «¿me oyes?»: la pregunta tiene su respuesta ─────────────────────────

Q="¿Cuál es la capital de Honduras?"
if hay_tiempo "4 · «¿me oyes?» no se come la pregunta"; then
  printf '%s\n%s\n' "$Q" "¿me oyes?" >> "$TMP/enviados.txt"
  maestro_flujo "enviar-dos" no enviar-dos.yaml -e "MENSAJE=$Q" -e "MENSAJE2=¿me oyes?"
  esperar_respuesta "$Q" "e4-pregunta-y-me-oyes" 120 "tegucigalpa"
  veredicto 4 "4 · «¿me oyes?» no se come la pregunta" "$TMP/e4-pregunta-y-me-oyes.json"
fi

# ── 5. la cámara (escena virtual) abre y no se congela ni se cierra en 20 s ──────────────────────────────────

ANTES=$(cierres)
if ! hay_tiempo "5 · La cámara aguanta 20 s"; then
  :
elif maestro_flujo "camara-abrir" no camara-abrir.yaml; then
  captura "e5-camara-0s"
  sleep 10
  F10=no; enfocada && F10=si
  captura "e5-camara-10s"
  sleep 10
  F20=no; enfocada && F20=si
  captura "e5-camara-20s"
  SIGUE=no
  maestro_flujo "camara-sigue" no camara-sigue.yaml && SIGUE=si
  N=$(( $(cierres) - ANTES ))
  if [ "$N" -eq 0 ] && [ "$F10" = si ] && [ "$F20" = si ] && [ "$SIGUE" = si ]; then
    registrar "5 · La cámara aguanta 20 s" PASA "La vista de la cámara siguió abierta y la app delante a los 10 s y a los 20 s, sin cierres ni ANR."
  else
    registrar "5 · La cámara aguanta 20 s" FALLA "Delante a los 10 s: $F10; a los 20 s: $F20; vista abierta al final: $SIGUE; cierres/ANR: $N."
  fi
else
  captura "e5-camara-fallo"
  registrar "5 · La cámara aguanta 20 s" FALLA "No se pudo abrir la vista de la cámara (ver la captura y datos/maestro-*-camara-abrir.log)."
fi

if [ "$(cierres)" -gt 0 ]; then registrar "Cierres de la app" FALLA "El logcat tiene $(cierres) cierre(s) de la app (FATAL EXCEPTION / nativo / ANR)."; fi
exit 0
