#!/usr/bin/env bash
#
# ELECTRUM — convierte los rásteres de un lote (hojas cartográficas, mapas escaneados y
# georreferenciados) en teselas PMTiles para el mapa de Dr Electrum. Se corre EN el nodo de carga,
# como root, después de que el lote terminó de subir:
#
#   teselas-lote <lote>                                  convierte, no publica nada
#   teselas-lote <lote> --mosaico "HOJAS CARTOGRAFICAS"  todo lo de esa carpeta, una sola capa
#   teselas-lote <lote> --publicar                       sube a biblioteca/teselas/ y al índice
#
# Por qué así:
#   - El cargador aparta los rásteres: no van a la base sino como teselas, que el mapa lee a tramos
#     desde el cubo (server/electrum/teselas.ts). Es el mismo camino que los mapas de JICA y
#     Sentinel-2: un .pmtiles por capa y una entrada en biblioteca/teselas/indice.json.
#   - Cincuenta hojas 1:50 000 como cincuenta capas sueltas llenan el control de capas; con
#     --mosaico se cosen en una sola, que es como se miran: el mapa entero, no hoja por hoja.
#   - Convertir y publicar van separados a propósito. La conversión se puede repetir y mirar con
#     calma; publicar toca el índice que ve todo el mundo, y se hace una vez, con copia del anterior.
#
# Cada ráster pasa por: ¿tiene georreferencia? → ¿es una imagen de 8 bits? (un modelo de elevación
# en float no es un mapa, se aparta) → a Web Mercator con transparencia fuera del marco → teselas
# WebP hasta ZOOM_MAX (15 por defecto: más fino no se lee en una hoja 1:50 000 y el archivo crece
# cuatro veces por nivel) → PMTiles.
#
# Variables: ZOOM_MAX (15), CALIDAD (85), GRUPO (sección del control de capas).
set -euo pipefail

LOTE=""; PUBLICAR=0; MOSAICOS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --publicar) PUBLICAR=1 ;;
    --mosaico)  MOSAICOS+=("${2:?--mosaico necesita el nombre de una carpeta}"); shift ;;
    -*) echo "No conozco ${1}." >&2; exit 1 ;;
    *)  LOTE="$1" ;;
  esac
  shift
done

REGION="${AWS_DEFAULT_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="$REGION"
BUCKET="${ELECTRUM_BUCKET:-electrum-expedientes-548380372606}"
LOTES="${ELECTRUM_LOTES:-electrum-lotes-548380372606}"
ZOOM_MAX="${ZOOM_MAX:-15}"
CALIDAD="${CALIDAD:-85}"
PMTILES="${PMTILES:-/usr/local/bin/pmtiles}"

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
paso()  { printf '\n\033[36m== %s\033[0m\n' "$*"; }

[ -n "$LOTE" ] || { rojo "Falta el lote."; echo "  teselas-lote <lote> [--mosaico <carpeta>]... [--publicar]"; exit 1; }
for h in gdalinfo gdalwarp gdal_translate gdaladdo python3; do command -v "$h" >/dev/null || { rojo "Falta ${h}."; exit 1; }; done
[ -x "$PMTILES" ] || { rojo "Falta ${PMTILES} (go-pmtiles). Lo instala preparar.sh; en un nodo viejo: electrum-carga-pmtiles"; exit 1; }

case "$LOTE" in
  s3://*) ORIGEN="${LOTE%/}/" ;;
  *)      ORIGEN="s3://${LOTES}/${LOTE%/}/" ;;
esac
NOMBRE="$(basename "${ORIGEN%/}")"
DIR="/datos/${NOMBRE}"
ORIG="${DIR}/original"; SAL="${DIR}/teselas"; TRAB="${SAL}/trabajo"; INF="${DIR}/informe"
mkdir -p "$ORIG" "$SAL/entradas" "$TRAB" "$INF"
GRUPO="${GRUPO:-Mapas del ${NOMBRE}}"

# Lo mismo que acepta el servidor: [a-z0-9-], empieza por letra o número, como mucho 81.
slug() {
  python3 - "$1" <<'PY'
import re, sys, unicodedata
t = unicodedata.normalize('NFKD', sys.argv[1]).encode('ascii', 'ignore').decode().lower()
print(re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', t)).strip('-')[:60] or 'mapa')
PY
}

# ── 1 ──────────────────────────────────────────────────────────────────────────────────────────
paso "1. Rásteres de ${ORIGEN}"
# Solo los rásteres y lo que los georreferencia (.tfw, .aux.xml, .prj al lado): no hace falta bajar
# los 26 GB para esto. Si cargar-lote ya bajó el lote, sync no vuelve a bajar nada.
aws s3 sync "$ORIGEN" "$ORIG" --only-show-errors --exclude '*' \
  --include '*.tif' --include '*.TIF' --include '*.tiff' --include '*.TIFF' --include '*.jp2' --include '*.JP2' \
  --include '*.img' --include '*.IMG' --include '*.tfw' --include '*.TFW' --include '*.tifw' --include '*.j2w' \
  --include '*.aux.xml' --include '*.AUX.XML' --include '*.prj' --include '*.PRJ' --include '*.ovr'
mapfile -d '' RASTERES < <(find "$ORIG" -type f \( -iname '*.tif' -o -iname '*.tiff' -o -iname '*.jp2' -o -iname '*.img' \) -print0 | sort -z)
echo "  ${#RASTERES[@]} rásteres"
[ "${#RASTERES[@]}" -gt 0 ] || { echo "  No hay rásteres en el lote."; exit 0; }

# ── 2 ──────────────────────────────────────────────────────────────────────────────────────────
paso "2. Revisión: georreferencia y tipo"
: > "${INF}/teselas-apartados.txt"
BUENOS=()
for r in "${RASTERES[@]}"; do
  rel="${r#"$ORIG"/}"
  motivo=$(gdalinfo -json "$r" 2>/dev/null | python3 -c '
import json, sys
try: i = json.load(sys.stdin)
except Exception: print("GDAL no lo abre"); sys.exit()
if not (i.get("coordinateSystem") or {}).get("wkt") or "geoTransform" not in i:
    print("sin georreferencia: hay que georreferenciarlo antes (QGIS)"); sys.exit()
tipos = {b.get("type") for b in i.get("bands", [])}
if tipos != {"Byte"}:
    print("no es imagen de 8 bits (%s): ¿modelo de elevación? El relieve ya sale de Terrarium" % ",".join(sorted(t for t in tipos if t)))
' || echo "GDAL no lo abre")
  if [ -n "$motivo" ]; then
    printf '%s\t%s\n' "$rel" "$motivo" >> "${INF}/teselas-apartados.txt"
    echo "  ✗ ${rel}: ${motivo}"
  else
    BUENOS+=("$r")
  fi
done
echo "  ${#BUENOS[@]} se convierten; $(grep -c . "${INF}/teselas-apartados.txt" || true) apartados (${INF}/teselas-apartados.txt)"
[ "${#BUENOS[@]}" -gt 0 ] || exit 0

# Resolución de ZOOM_MAX en metros de Web Mercator: 156543,03 m por píxel en zoom 0.
RES_MIN=$(python3 -c "print(156543.03392804097 / 2 ** ${ZOOM_MAX})")

# Cualquier ráster a Web Mercator, RGB(A) de 8 bits, con transparencia donde no hay mapa.
a_mercator() {  # a_mercator <entrada> <salida.tif>
  local ent="$1" sal="$2" vrt="${2%.tif}.in.vrt" bandas alfa paleta res tr=()
  read -r bandas alfa paleta < <(gdalinfo -json "$ent" | python3 -c '
import json, sys
b = json.load(sys.stdin)["bands"]
print(len(b), int(b[-1].get("colorInterpretation") == "Alpha"), int("colorTable" in b[0]))')
  # Gris → tres veces la misma banda; paleta → sus colores; color con alfa → tal cual.
  if [ "$paleta" = 1 ]; then gdal_translate -q -of VRT -expand rgb "$ent" "$vrt"
  elif [ "$bandas" -lt 3 ]; then gdal_translate -q -of VRT -b 1 -b 1 -b 1 "$ent" "$vrt"
  elif [ "$alfa" = 1 ]; then gdal_translate -q -of VRT -b 1 -b 2 -b 3 -b "$bandas" "$ent" "$vrt"
  else gdal_translate -q -of VRT -b 1 -b 2 -b 3 "$ent" "$vrt"; fi
  # No más fino que ZOOM_MAX: una hoja escaneada a 600 ppp pediría zoom 18 y pesaría 16 veces más.
  gdalwarp -q -overwrite -of VRT -t_srs EPSG:3857 "$vrt" "${2%.tif}.prueba.vrt"
  res=$(gdalinfo -json "${2%.tif}.prueba.vrt" | python3 -c 'import json, sys; print(abs(json.load(sys.stdin)["geoTransform"][1]))')
  rm -f "${2%.tif}.prueba.vrt"
  if python3 -c "import sys; sys.exit(0 if float('${res:-0}') < ${RES_MIN} else 1)"; then tr=(-tr "$RES_MIN" "$RES_MIN" -tap); fi
  local remuestreo=bilinear; [ "$paleta" = 1 ] && remuestreo=near   # un mapa de clases no se promedia
  local alfa_sal=(-dstalpha); [ "$alfa" = 1 ] && alfa_sal=()          # si ya trae alfa, se usa ese
  gdalwarp -q -overwrite -t_srs EPSG:3857 "${tr[@]}" -r "$remuestreo" "${alfa_sal[@]}" \
    -multi -wo NUM_THREADS=ALL_CPUS -co TILED=YES -co COMPRESS=DEFLATE -co BIGTIFF=IF_SAFER "$vrt" "$sal"
  rm -f "$vrt"
}

# Un ráster ya en Mercator → .pmtiles, y su entrada para el índice.
a_pmtiles() {  # a_pmtiles <mercator.tif|vrt> <clave> <nombre> <fuente>
  local src="$1" clave="$2" nom="$3" fuente="$4" mb="${TRAB}/$2.mbtiles" pm="${SAL}/$2.pmtiles"
  rm -f "$mb" "$pm"
  gdal_translate -q -of MBTILES -co TILE_FORMAT=WEBP -co QUALITY="$CALIDAD" -co ZOOM_LEVEL_STRATEGY=UPPER "$src" "$mb"
  # Seis niveles hacia afuera: desde la hoja de cerca hasta verla dentro del departamento.
  gdaladdo -q -r average "$mb" 2 4 8 16 32 64
  "$PMTILES" convert "$mb" "$pm" >/dev/null 2>&1
  python3 - "$mb" "$src" "$clave" "$nom" "$fuente" "$GRUPO" "${SAL}/entradas/$2.json" <<'PY'
import json, sqlite3, subprocess, sys
mb, src, clave, nom, fuente, grupo, sal = sys.argv[1:]
meta = dict(sqlite3.connect(mb).execute('select name, value from metadata').fetchall())
info = json.loads(subprocess.run(['gdalinfo', '-json', src], capture_output=True, text=True, check=True).stdout)
xs, ys = zip(*info['wgs84Extent']['coordinates'][0])
json.dump({
    'clave': clave, 'nombre': nom, 'fuente': fuente, 'grupo': grupo,
    'encuadre': [round(min(xs), 5), round(min(ys), 5), round(max(xs), 5), round(max(ys), 5)],
    'zoomMax': int(meta.get('maxzoom', 15)),
    'notas': 'Convertido por el nodo de carga con la georreferencia del archivo original; sin revisión manual.',
}, open(sal, 'w'), ensure_ascii=False, indent=1)
PY
  rm -f "$mb"
  echo "  ✓ ${clave}.pmtiles $(du -h "$pm" | cut -f1)"
}

# ── 3 ──────────────────────────────────────────────────────────────────────────────────────────
paso "3. Conversión (zoom máximo ${ZOOM_MAX})"
PREF="$(slug "$NOMBRE")"
declare -A EN_MOSAICO=()
for carpeta in "${MOSAICOS[@]}"; do
  clave="${PREF}-$(slug "$carpeta")"
  piezas=()
  for r in "${BUENOS[@]}"; do
    case "/${r#"$ORIG"/}" in */"$carpeta"/*) piezas+=("$r"); EN_MOSAICO["$r"]=1 ;; esac
  done
  [ "${#piezas[@]}" -gt 0 ] || { echo "  – ${carpeta}: ningún ráster dentro"; continue; }
  if [ -s "${SAL}/${clave}.pmtiles" ] && [ -s "${SAL}/entradas/${clave}.json" ]; then echo "  = ${clave} ya estaba"; continue; fi
  echo "  ${carpeta}: ${#piezas[@]} piezas en un mosaico"
  hechas=()
  for r in "${piezas[@]}"; do
    m="${TRAB}/$(slug "${r#"$ORIG"/}").tif"
    [ -s "$m" ] || a_mercator "$r" "$m"
    hechas+=("$m")
  done
  gdalbuildvrt -q -overwrite "${TRAB}/${clave}.vrt" "${hechas[@]}"
  a_pmtiles "${TRAB}/${clave}.vrt" "$clave" "${carpeta} (${#piezas[@]} hojas, ${NOMBRE})" "${NOMBRE}: ${carpeta}"
  rm -f "${hechas[@]}" "${TRAB}/${clave}.vrt"
done

for r in "${BUENOS[@]}"; do
  [ -z "${EN_MOSAICO[$r]:-}" ] || continue
  rel="${r#"$ORIG"/}"
  clave="${PREF}-$(slug "${rel%.*}")"
  if [ -s "${SAL}/${clave}.pmtiles" ] && [ -s "${SAL}/entradas/${clave}.json" ]; then echo "  = ${clave} ya estaba"; continue; fi
  m="${TRAB}/${clave}.tif"
  a_mercator "$r" "$m"
  a_pmtiles "$m" "$clave" "$(basename "${rel%.*}")" "${NOMBRE}: ${rel}"
  rm -f "$m"
done

echo "  listos en ${SAL}: $(find "$SAL" -maxdepth 1 -name '*.pmtiles' | wc -l) archivos, $(du -sh --apparent-size "$SAL" --exclude=trabajo | cut -f1)"

# ── 4 ──────────────────────────────────────────────────────────────────────────────────────────
if [ "$PUBLICAR" != 1 ]; then
  echo
  OPC=""; for c in "${MOSAICOS[@]}"; do OPC+="--mosaico \"${c}\" "; done
  echo "No publiqué nada. Para que aparezcan en el mapa:  teselas-lote \"${LOTE}\" ${OPC}--publicar"
  exit 0
fi

paso "4. Publicando en s3://${BUCKET}/biblioteca/teselas/"
for pm in "${SAL}"/*.pmtiles; do
  aws s3 cp "$pm" "s3://${BUCKET}/biblioteca/teselas/$(basename "$pm")" --only-show-errors \
    --content-type application/octet-stream
  echo "  ↑ $(basename "$pm")"
done

# El índice se fusiona, no se pisa: lo que ya estaba (JICA, Sentinel-2, el mapa base) se queda, y
# una capa de este lote que ya estaba se reemplaza por la nueva. Antes, copia del anterior.
SELLO=$(date -u +%Y%m%dT%H%M%SZ)
aws s3 cp "s3://${BUCKET}/biblioteca/teselas/indice.json" "${SAL}/indice.antes-${SELLO}.json" --only-show-errors
aws s3 cp "${SAL}/indice.antes-${SELLO}.json" "s3://${BUCKET}/biblioteca/teselas/indice.antes-${SELLO}.json" --only-show-errors
python3 - "${SAL}/indice.antes-${SELLO}.json" "${SAL}/indice.json" "${SAL}"/entradas/*.json <<'PY'
import json, sys
antes, sal, *entradas = sys.argv[1:]
ind = json.load(open(antes))
nuevas = [json.load(open(e)) for e in entradas]
claves = {n['clave'] for n in nuevas}
ind['rasters'] = [r for r in ind.get('rasters', []) if r.get('clave') not in claves] + nuevas
json.dump(ind, open(sal, 'w'), ensure_ascii=False, indent=1)
print(f"  índice: {len(ind['rasters'])} capas ({len(nuevas)} de este lote)")
PY
aws s3 cp "${SAL}/indice.json" "s3://${BUCKET}/biblioteca/teselas/indice.json" --only-show-errors \
  --content-type application/json

verde "
Publicado. Dr Electrum relee el índice cada 5 minutos: las capas salen en el control de capas,
sección «${GRUPO}». Para volver atrás: copiar indice.antes-${SELLO}.json sobre indice.json en el cubo."
