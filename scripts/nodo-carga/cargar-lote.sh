#!/usr/bin/env bash
#
# ELECTRUM — carga un lote entero desde el nodo de carga. Se corre EN el nodo, como root, dentro
# de tmux (una carga de 26 GB son horas y una consola de SSM se corta):
#
#   cargar-lote <lote>                    el lote está en s3://electrum-lotes-…/<lote>/
#   cargar-lote s3://cubo/entrada/x/      o cualquier prefijo entero (p. ej. el de trasvase)
#
# En orden, y cada paso se puede relanzar sin repetir lo hecho:
#   1. Baja el lote a /datos/<lote>/original con `aws s3 sync` (relanzar continúa).
#   2. Inventario por tipo de archivo: lo primero que hay que mirar de 26 GB que no conocés.
#   3. Prepara una copia de trabajo (enlaces duros, no ocupa) en /datos/<lote>/listo: abre los zip
#      que no son shapefiles y los .rar/.7z, y aparta lo que el cargador no puede o no debe tragar
#      —shapefiles de más de 300 MB y rásteres— en /datos/<lote>/aparte con la razón.
#   4. Ensayo (--seco): cuánto entra, cuánto es escaneo sin texto, y a qué carpeta va cada cosa.
#   5. OCR en paralelo de los escaneos, con todos los núcleos. Cada escaneo leído se carga como su
#      .txt (con sus páginas) y el PDF sin texto se aparta, para que no entre dos veces.
#      Con HASTA_OCR=1 termina aquí, sin clave y sin tocar la base.
#   6. Abre dos túneles al cerebro por SSM: la base (5432) y los embeddings (TEI, 8794).
#   7. La carga de verdad. Lo ya cargado se salta por la huella de su contenido.
#   8. Vectores de lo que haya quedado sin vector.
#
# Variables: ELECTRUM_CLAVE_DB (si no, la pregunta), QUIEN, SI=1 (no pregunta antes de cargar),
#            ENSAYO=0 (salta el ensayo si ya se hizo), HASTA_OCR=1, CEREBRO, EMBED_HOST, HILOS.
set -euo pipefail

LOTE="${1:-}"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
LOTES="${ELECTRUM_LOTES:-electrum-lotes-548380372606}"
CEREBRO="${CEREBRO:-i-06530893af0dd0638}"
# TEI escucha solo en la IP privada del cerebro (docs/NODO-T4.md, «Embeddings BGE-M3»).
EMBED_HOST="${EMBED_HOST:-172.31.23.34}"
EMBED_PUERTO="${EMBED_PUERTO:-8794}"
P_DB=55432
P_EMBED=58794
HILOS="${HILOS:-$(nproc)}"
QUIEN="${QUIEN:-nodo-carga}"
CODIGO=/opt/electrum-carga/codigo
TSX="${CODIGO}/node_modules/.bin/tsx"
# Un PDF de cientos de MB se abre entero en memoria: con el tope por defecto de Node se cae.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=24576}"
export AWS_DEFAULT_REGION="$REGION"

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
paso()  { printf '\n\033[36m== %s\033[0m\n' "$*"; }
peso()  { numfmt --to=iec --suffix=B "$1"; }

[ -n "$LOTE" ] || { rojo "Falta el lote."; echo "  cargar-lote <lote>   (s3://${LOTES}/<lote>/)"; exit 1; }
[ "$(id -u)" = 0 ] || { rojo "Corré esto como root (sudo -i)."; exit 1; }
[ -x "$TSX" ] || { rojo "No está el código en ${CODIGO}. ¿Terminó la preparación? tail /var/log/electrum-carga.log"; exit 1; }
[ -n "${TMUX:-}${STY:-}" ] || echo "Aviso: no estás dentro de tmux. Si se corta la consola, se corta la carga (tmux new -s carga)."

case "$LOTE" in
  s3://*) ORIGEN="${LOTE%/}/" ;;
  *)      ORIGEN="s3://${LOTES}/${LOTE%/}/" ;;
esac
NOMBRE="$(basename "${ORIGEN%/}")"
DIR="/datos/${NOMBRE}"
ORIG="${DIR}/original"; LISTO="${DIR}/listo"; APARTE="${DIR}/aparte"; OCR="${DIR}/ocr"; INF="${DIR}/informe"
mkdir -p "$ORIG" "$APARTE" "$OCR" "$INF"

# ── 1 ──────────────────────────────────────────────────────────────────────────────────────────
paso "1. Bajando ${ORIGEN}"
aws s3 sync "$ORIGEN" "$ORIG" --only-show-errors
N=$(find "$ORIG" -type f | wc -l)
[ "$N" -gt 0 ] || { rojo "No bajó nada. ¿Está bien el lote? aws s3 ls s3://${LOTES}/"; exit 1; }
echo "  ${N} archivos, $(du -sh "$ORIG" | cut -f1)"

# ── 2 ──────────────────────────────────────────────────────────────────────────────────────────
paso "2. Inventario"
find "$ORIG" -type f -printf '%s\t%f\n' | awk -F'\t' '
  { n=$2; e=(n ~ /\./) ? tolower(n) : "(sin extensión)"; sub(/.*\./, ".", e); c[e]++; b[e]+=$1 }
  END { for (e in c) printf "%12d\t%6d\t%s\n", b[e], c[e], e }' | sort -rn |
  while IFS=$'\t' read -r b c e; do printf '  %-18s %6s archivos  %8s\n' "$e" "$c" "$(peso "$b")"; done | tee "${INF}/inventario.txt"

# ── 3 ──────────────────────────────────────────────────────────────────────────────────────────
paso "3. Copia de trabajo"
# Se rehace entera cada vez: con enlaces duros es instantáneo y no ocupa disco, y así lo apartado o
# abierto en una corrida anterior no se mezcla con un lote que cambió en el cubo.
# «aparte» también: son enlaces a los mismos originales y se vuelven a decidir.
rm -rf "$LISTO" "$APARTE"
mkdir -p "$APARTE"
cp -al "$ORIG" "$LISTO"
: > "${INF}/aparte.txt"
# El texto del OCR de un escaneo, en la misma subcarpeta relativa que el original: dos
# «resolucion.pdf» de expedientes distintos no pueden pisarse el uno al otro.
txt_de() { local rel="${1#"$LISTO"/}"; echo "${OCR}/${rel%.*}.txt"; }
apartar() {  # apartar <archivo> <razón>
  local rel="${1#"$LISTO"/}"
  mkdir -p "${APARTE}/$(dirname "$rel")"
  mv -f "$1" "${APARTE}/${rel}"
  printf '%s\t%s\n' "$rel" "$2" >> "${INF}/aparte.txt"
}

# Abrir un comprimido nunca toca lo que ya estaba: cada intento saca en un directorio NUEVO (fuera
# de la copia de trabajo, para que el find que la recorre no lo vea a medias) y solo si sacó algo se
# pone en su sitio. Antes se sacaba directo en «x/» y, si fallaba, se hacía rm -rf «x/»: una carpeta
# «x/» que venía en el lote junto a un «x.rar» roto desaparecía entera.
sacar_unrar() { command -v unrar >/dev/null && (cd "$2" && unrar x -o+ -idq "$1" ./); }
sacar_7z()    { 7z x -y -bso0 -bsp0 -o"$2" "$1"; }
sacar_unar()  { unar -q -f -D -o "$2" "$1"; }
sacar_zip()   { unzip -q -n "$1" -d "$2"; }
abrir() {  # abrir <comprimido> <sacador>...: 0 si alguno lo abrió y quedó en «<comprimido sin extensión>/»
  local z="$1" dest="${1%.*}" tmp s; shift
  for s in "$@"; do
    tmp="$(mktemp -d "${DIR}/abriendo.XXXXXX")"
    if "$s" "$z" "$tmp" >/dev/null 2>&1 && [ -n "$(ls -A "$tmp")" ]; then
      # Si ya había una carpeta con ese nombre, lo sacado se suma sin pisar nada de lo suyo.
      if [ -e "$dest" ]; then cp -aln "$tmp"/. "$dest"/ 2>/dev/null || true; rm -rf "$tmp"
      else mv "$tmp" "$dest"; fi
      return 0
    fi
    rm -rf "$tmp"
  done
  return 1
}
rm -rf "${DIR}"/abriendo.*   # restos de una corrida que se cortó a mitad de abrir algo

# Un .exe autoextraíble (WinRAR/7-Zip SFX) es un comprimido con un arranque de Windows delante. A veces
# es la única copia sana: en lote-1 el .rar de los planes de explotación de El Chaparro venía roto y
# el .exe con el mismo nombre traía los diez .docx enteros. Si abre, manda sobre el .rar gemelo.
# 7z lo reconoce pero no descomprime ese RAR («Unsupported Method») ni unar lo abre: el que puede es
# unrar (multiverse, preparar.sh). Se prueba unrar y, si no está o no puede, 7z.
# Solo si 7z dice que ES un comprimido: «7z l» lista también un ejecutable normal (lo abre como PE),
# y un Setup.exe cualquiera se «descomprimía» en sus recursos y se llevaba por delante su .rar gemelo.
# (La lista se guarda antes de mirarla: con pipefail, el grep -q que corta pronto dejaba a 7z con
# SIGPIPE y la tubería entera «fallaba» justo cuando sí era un comprimido.)
while IFS= read -r -d '' z; do
  tipo="$(7z l -slt "$z" 2>/dev/null || true)"
  grep -qE '^Type = (Rar|Rar5|7z|Zip)$' <<< "$tipo" || continue
  if abrir "$z" sacar_unrar sacar_7z; then
    rm -f "$z"
    for gemelo in "${z%.*}".rar "${z%.*}".RAR; do [ -f "$gemelo" ] && rm -f "$gemelo"; done
  fi
done < <(find "$LISTO" -type f -iname '*.exe' -print0)

# Comprimidos dentro de comprimidos: hasta tres vueltas.
for vuelta in 1 2 3; do
  abiertos=0
  while IFS= read -r -d '' z; do
    # Un zip que es SOLO un shapefile (sus piezas, nada más) el cargador lo lee así. Cualquier otro
    # zip es una carpeta empaquetada y se abre, aunque traiga un .shp: antes bastaba un .shp dentro
    # para no abrirlo, y los PDF, Word y Excel que venían con él no entraban nunca. Las piezas que
    # quedan sueltas al abrirlo las vuelve a juntar el cargador (juntarShapefiles).
    contenido="$(unzip -Z1 "$z" 2>/dev/null || true)"
    if grep -qi '\.shp$' <<< "$contenido" && ! grep -qviE '(/|\.(shp|dbf|shx|prj|cpg|sbn|sbx|qpj|qmd|xml))$' <<< "$contenido"; then continue; fi
    if abrir "$z" sacar_zip; then rm -f "$z"; abiertos=$((abiertos + 1))
    else apartar "$z" "zip roto o cifrado"; fi
  done < <(find "$LISTO" -type f -iname '*.zip' -print0)
  while IFS= read -r -d '' z; do
    # El 7z de Ubuntu no trae el códec de RAR: unrar primero (el único que abre todo RAR), luego 7z y unar.
    if abrir "$z" sacar_unrar sacar_7z sacar_unar; then rm -f "$z"; abiertos=$((abiertos + 1))
    else apartar "$z" "rar/7z roto o cifrado"; fi
  done < <(find "$LISTO" -type f \( -iname '*.rar' -o -iname '*.7z' \) -print0)
  [ "$abiertos" -gt 0 ] || break
  echo "  vuelta ${vuelta}: ${abiertos} comprimidos abiertos"
done

# Excel viejo (.xls, binario de Office 97): el lector entiende .xlsx, así que se convierte hoja por
# hoja, con sus valores. Sin esto, las planillas de ensayos y presupuestos de los proyectos no entraban.
while IFS= read -r -d '' x; do
  if python3 - "$x" "${x%.*}.xlsx" <<'PY' >/dev/null 2>&1
import sys, xlrd, openpyxl
src, dst = sys.argv[1:]
lib = xlrd.open_workbook(src)
nuevo = openpyxl.Workbook()
nuevo.remove(nuevo.active)
for h in lib.sheets():
    hoja = nuevo.create_sheet(title=(h.name or 'Hoja')[:31])
    for r in range(h.nrows):
        hoja.append(h.row_values(r))
nuevo.save(dst)
PY
  then rm -f "$x"; else apartar "$x" "Excel .xls que no se pudo convertir"; fi
done < <(find "$LISTO" -type f -iname '*.xls' -print0)

# Formatos de oficina que el cargador no lee pero LibreOffice sí: páginas web guardadas (el texto de
# un artículo o de un chat de WhatsApp Web), diagramas de Visio, hojas SYLK y documentos de
# OpenOffice. Van a PDF (o a .xlsx las hojas) con su mismo nombre; los «_files/» de una página
# guardada son su JavaScript y su CSS y no se tocan.
oficina() {  # oficina <archivo> <formato destino>
  local f="$1" perfil hecho
  perfil="$(mktemp -d)"
  timeout 600 soffice -env:UserInstallation="file://${perfil}" --headless --convert-to "$2" --outdir "${perfil}/sal" "$f" >/dev/null 2>&1 || true
  hecho="$(find "${perfil}/sal" -maxdepth 1 -type f 2>/dev/null | head -1)"
  if [ -n "$hecho" ] && [ -s "$hecho" ]; then mv -f "$hecho" "${f%.*}.${2%%:*}"; rm -f "$f"
  else apartar "$f" "LibreOffice no pudo convertirlo a ${2%%:*}"; fi
  rm -rf "$perfil"
}
while IFS= read -r -d '' f; do
  case "${f,,}" in */*_files/*) continue ;; esac
  case "${f,,}" in
    *.slk|*.ods) oficina "$f" xlsx ;;
    *) oficina "$f" pdf ;;
  esac
done < <(find "$LISTO" -type f \( -iname '*.html' -o -iname '*.htm' -o -iname '*.vsdx' -o -iname '*.vsd' \
     -o -iname '*.slk' -o -iname '*.ods' -o -iname '*.odt' -o -iname '*.odp' -o -iname '*.wpd' \) -print0)

# Archivos de bloqueo de Office («~$Nota.docx»): quedan cuando alguien tenía el archivo abierto al
# copiar la carpeta. No son documentos; fallaban como .docx ilegibles.
find "$LISTO" -type f -name '~$*' -delete

# El cargador lee un shapefile entero en memoria; por encima de 300 MB tumba la carga (fueron las
# curvas de nivel de todo el país). Eso es relieve, no catastro: se sirve como teselas.
while IFS= read -r -d '' shp; do
  base="${shp%.*}"
  for pieza in "$base".*; do apartar "$pieza" "shapefile de más de 300 MB: partirlo con ogr2ogr o servirlo como teselas"; done
done < <(find "$LISTO" -type f -iname '*.shp' -size +300M -print0)

# Rásteres: no van a la base sino a biblioteca/teselas/ como PMTiles (server/electrum/teselas.ts).
while IFS= read -r -d '' r; do apartar "$r" "ráster: va como PMTiles a biblioteca/teselas/"; done \
  < <(find "$LISTO" -type f \( -iname '*.tif' -o -iname '*.tiff' -o -iname '*.img' -o -iname '*.ecw' \
       -o -iname '*.jp2' -o -iname '*.sid' -o -iname '*.vrt' -o -iname '*.ovr' \) -print0)

# Escaneos que ya se leyeron en una corrida anterior: entra el .txt, no el PDF sin texto.
# escaneos.txt acumula todos los ensayos: uno nuevo ya no ve los que se apartaron antes.
apartar_leidos() {
  [ -s "${INF}/escaneos.txt" ] || return 0
  local f t
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    t="$(txt_de "$f")"
    if [ -f "$f" ] && [ -s "$t" ]; then apartar "$f" "escaneo: entra su OCR, ${t#"$OCR"/}"; fi
  done < "${INF}/escaneos.txt"
}
apartar_leidos

APARTADOS=$(grep -c . "${INF}/aparte.txt" || true)
echo "  listos $(find "$LISTO" -type f | wc -l) archivos; apartados ${APARTADOS} (razones en ${INF}/aparte.txt)"

cd "$INF"   # el cargador deja aquí para-ocr.txt

# ── 4 ──────────────────────────────────────────────────────────────────────────────────────────
if [ "${ENSAYO:-1}" != 0 ]; then
  paso "4. Ensayo: qué entraría (no escribe nada)"
  "$TSX" "${CODIGO}/scripts/electrum/aprender.ts" --seco --carpetas "$LISTO" 2>&1 | tee "${INF}/ensayo.log" | grep -E '^(──|[0-9]|El cerebro|La lista)' || true
  echo "  detalle en ${INF}/ensayo.log"
  if [ -s "${INF}/para-ocr.txt" ]; then
    touch "${INF}/escaneos.txt"
    sort -u "${INF}/para-ocr.txt" "${INF}/escaneos.txt" > "${INF}/escaneos.nuevo"
    mv "${INF}/escaneos.nuevo" "${INF}/escaneos.txt"
    rm -f "${INF}/para-ocr.txt"
  fi
fi

# ── 5 ──────────────────────────────────────────────────────────────────────────────────────────
ocr_uno() {  # ocr_uno <pdf>: lee un escaneo y deja su .txt donde lo busca txt_de
  local t lista; t="$(txt_de "$1")"; lista="$(mktemp)"
  mkdir -p "$(dirname "$t")"; printf '%s\n' "$1" > "$lista"
  OMP_THREAD_LIMIT=1 bash "${CODIGO}/scripts/electrum/ocr.sh" "$lista" "$(dirname "$t")" >/dev/null 2>&1 || true
  rm -f "$lista"
  if [ -s "$t" ]; then echo "  ✓ ${1#"$LISTO"/}"; else echo "  ✗ ${1#"$LISTO"/} (el OCR no sacó nada)"; fi
}
if [ -s "${INF}/escaneos.txt" ]; then
  : > "${INF}/ocr-pendiente.txt"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if [ -f "$f" ] && [ ! -s "$(txt_de "$f")" ]; then echo "$f" >> "${INF}/ocr-pendiente.txt"; fi
  done < "${INF}/escaneos.txt"
  FALTAN=$(grep -c . "${INF}/ocr-pendiente.txt" || true)
  if [ "$FALTAN" -gt 0 ]; then
    paso "5. OCR de ${FALTAN} escaneos con ${HILOS} hilos"
    # Un tesseract por núcleo y cada uno con un solo hilo: así rinde más que pocos con muchos.
    export -f ocr_uno txt_de; export LISTO OCR CODIGO
    tr '\n' '\0' < "${INF}/ocr-pendiente.txt" | xargs -0 -P "$HILOS" -I{} bash -c 'ocr_uno "$1"' _ {} | tee "${INF}/ocr.log"
  fi
  # Los escaneos ya leídos salen de la copia de trabajo: entran por su .txt.
  apartar_leidos
fi


# Con HASTA_OCR=1 se queda aquí: todo bajado, ordenado y leído (lo largo), sin tocar la base.
# Así el OCR de miles de páginas avanza mientras se consigue la clave; después, relanzar sin la
# variable (y ENSAYO=0) carga en minutos.
if [ "${HASTA_OCR:-0}" = 1 ]; then
  verde "
Listo hasta el OCR. Lo que entraría: ${INF}/ensayo.log. Para cargar:  ENSAYO=0 cargar-lote ${LOTE}"
  exit 0
fi

# ── 6 ──────────────────────────────────────────────────────────────────────────────────────────
paso "6. Túneles al cerebro (${CEREBRO})"
if [ -n "${ELECTRUM_CLAVE_DB:-}" ]; then
  CLAVE="$ELECTRUM_CLAVE_DB"
elif [ -r /root/.electrum/db-url ]; then
  # Llegó cifrada con la llave de este nodo (solo él la descifra) y vive aquí, 600, sin pasar en
  # claro por el historial de SSM. Se usa la clave tal cual va en la URL, con su codificación.
  CLAVE=$(python3 -c 'from urllib.parse import urlsplit; print(urlsplit(open("/root/.electrum/db-url").read().strip()).password or "")')
  echo "  clave tomada de /root/.electrum/db-url"
else
  echo "La clave está en el cerebro, en /root/electrum-db-url. No viaja por aquí a propósito."
  read -rsp "  Clave del usuario electrum: " CLAVE; echo
fi
[ -n "$CLAVE" ] || { rojo "Sin clave no hay base."; exit 1; }

PIDS=()
cerrar() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cerrar EXIT INT TERM
aws ssm start-session --target "$CEREBRO" --document-name AWS-StartPortForwardingSession \
  --parameters "{\"portNumber\":[\"5432\"],\"localPortNumber\":[\"${P_DB}\"]}" > "${INF}/tunel-db.log" 2>&1 &
PIDS+=($!)
aws ssm start-session --target "$CEREBRO" --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"${EMBED_HOST}\"],\"portNumber\":[\"${EMBED_PUERTO}\"],\"localPortNumber\":[\"${P_EMBED}\"]}" \
  > "${INF}/tunel-embed.log" 2>&1 &
PIDS+=($!)

abierto() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
for _ in $(seq 1 30); do abierto "$P_DB" && break; sleep 1; done
abierto "$P_DB" || { rojo "El túnel a la base no levantó:"; tail -5 "${INF}/tunel-db.log"; exit 1; }
export ELECTRUM_DB_URL="postgres://electrum:${CLAVE}@127.0.0.1:${P_DB}/electrum"
echo "  base en 127.0.0.1:${P_DB}"

for _ in $(seq 1 15); do abierto "$P_EMBED" && break; sleep 1; done
if curl -fsS -m 20 -H 'Content-Type: application/json' -d '{"inputs":["prueba"]}' "http://127.0.0.1:${P_EMBED}/embed" >/dev/null 2>&1; then
  export EMBED_URL="http://127.0.0.1:${P_EMBED}"
  echo "  embeddings en ${EMBED_URL}"
else
  # Sin embeddings la carga sigue: el texto entra y se busca por palabras; los vectores se
  # rellenan después con scripts/cognitivo/indexar-vectores.ts.
  unset EMBED_URL
  echo "  embeddings NO responden (¿TEI apagado en el cerebro?). Cargo sin vectores; se rellenan luego."
fi


# ── 7 ──────────────────────────────────────────────────────────────────────────────────────────
if [ "${SI:-0}" != 1 ]; then
  echo
  read -rp "¿Cargo ${NOMBRE} en el cerebro? [s/N] " R
  case "$R" in s|S|si|SI|sí|Sí) ;; *) echo "No cargué nada. Lo bajado y el OCR quedan en ${DIR}."; exit 0;; esac
fi
paso "7. Cargando"
FUENTES=("$LISTO")
[ -n "$(find "$OCR" -name '*.txt' -print -quit)" ] && FUENTES+=("$OCR")
# Cada archivo a su carpeta del panel (la misma estructura que en el disco de quien lo subió) y
# con su original anotado en el cubo de lotes.
# El filtro de la pantalla no puede tapar al cargador: si él falló, la carga falló. El estado se
# recoge con «|| rc=$?»: con set -e y pipefail, una tubería que falla corta el script ANTES de llegar
# a mirar PIPESTATUS, y el aviso de abajo no salía nunca.
rc=0
"$TSX" "${CODIGO}/scripts/electrum/aprender.ts" --quien "$QUIEN" --carpetas --original "$ORIG" --origen "$ORIGEN" "${FUENTES[@]}" 2>&1 | tee "${INF}/carga.log" | { grep -E '^(▸|[0-9]|Cruzando|El catastro|Catastro|Los traslapes)|fallos seguidos' || true; } || rc=$?
if [ "$rc" != 0 ]; then
  rojo "El cargador terminó con error: no se cargó todo. Detalle en ${INF}/carga.log"
  exit 1
fi

# ── 8 ──────────────────────────────────────────────────────────────────────────────────────────
if [ -n "${EMBED_URL:-}" ]; then
  paso "8. Vectores pendientes"
  "$TSX" "${CODIGO}/scripts/cognitivo/indexar-vectores.ts" 2>&1 | tee "${INF}/vectores.log" | tail -3
fi

verde "
Lote ${NOMBRE} cargado. Registros en ${INF}:
  inventario.txt  ensayo.log  carga.log  aparte.txt (lo que NO entró y por qué)
Se puede relanzar: lo ya cargado se salta solo (ENSAYO=0 para no repetir el ensayo)."
