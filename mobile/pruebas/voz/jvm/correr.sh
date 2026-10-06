#!/bin/sh
# Corre Reproductor.kt (modules/aura-voz) en la JVM con un AudioTrack de mentira (falsos/) y un /api/tts/pcm local
# (PruebaReproductor.kt). No hace falta el SDK de Android ni Gradle: solo un JDK y el compilador de Kotlin.
#
#   KOTLINC=/ruta/kotlinc/bin/kotlinc [ANDROID_JAR=/ruta/android.jar] sh mobile/pruebas/voz/jvm/correr.sh
#
# Con ANDROID_JAR, el módulo se compila contra la API de Android de verdad (comprueba que cada llamada existe con esa
# firma) y se corre contra los falsos; sin él, se compila y se corre contra los falsos. Sin kotlinc: avisa y sale bien.
cd "$(dirname "$0")" || exit 1
KOTLINC="${KOTLINC:-$(command -v kotlinc)}"
if [ -z "$KOTLINC" ] || [ ! -x "$KOTLINC" ]; then
  echo "sin kotlinc (KOTLINC=…): no corro el reproductor nativo en la JVM"
  exit 0
fi
OUT="${OUT:-$(mktemp -d)}"
MOD=../../../modules/aura-voz/android/src/main/java/expo/modules/auravoz
mkdir -p "$OUT/falsos" "$OUT/kt" || exit 1
javac -nowarn -d "$OUT/falsos" $(find falsos -name '*.java') || exit 1
if [ -n "$ANDROID_JAR" ]; then
  # Contra la API de Android de verdad: si una llamada no existe con esa firma, no compila.
  mkdir -p "$OUT/api"
  "$KOTLINC" -nowarn -cp "$ANDROID_JAR" -d "$OUT/api" -jvm-target 17 "$MOD/Reproductor.kt" 2>&1 | grep -v '^Picked up JAVA_TOOL_OPTIONS' || true
  [ -f "$OUT/api/expo/modules/auravoz/Reproductor.class" ] || { echo "Reproductor.kt no compila contra $ANDROID_JAR"; exit 1; }
  echo "Reproductor.kt compila contra $(basename "$ANDROID_JAR")"
fi
"$KOTLINC" -nowarn -cp "$OUT/falsos" -d "$OUT/kt" -jvm-target 17 "$MOD/Reproductor.kt" PruebaReproductor.kt 2>&1 | grep -v '^Picked up JAVA_TOOL_OPTIONS' || true
[ -f "$OUT/kt/expo/modules/auravoz/PruebaReproductorKt.class" ] || { echo "no compiló"; exit 1; }
STDLIB="$(dirname "$KOTLINC")/../lib/kotlin-stdlib.jar"
java -Dstdout.encoding=UTF-8 -cp "$OUT/falsos:$OUT/kt:$STDLIB" expo.modules.auravoz.PruebaReproductorKt > "$OUT/salida.txt" 2>&1
r=$?
grep -v '^Picked up JAVA_TOOL_OPTIONS' "$OUT/salida.txt"
exit $r
