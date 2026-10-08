#!/usr/bin/env bash
#
# ELECTRUM — las curvas de nivel de un lote (un shapefile de líneas con su cota) como teselas
# vectoriales para el mapa. Se corre EN el nodo de carga, como root:
#
#   curvas-lote <lote>                         busca el shapefile de curvas dentro del lote
#   curvas-lote <lote> --shp ruta/al/archivo.shp
#
# Por qué así y no por el cargador: las curvas de 20 m de todo el país son un millón de líneas y
# 2,4 GB. En la base no sirven para contestar nada y leídas de una pieza tumban la carga. Como
# teselas vectoriales (PMTiles) el mapa pide solo el pedazo que mira, y cada línea sigue siendo una
# línea con su cota: se dibuja nítida a cualquier zoom y se rotula.
#
# De lejos (zoom 10 a 12) solo van las maestras, cada 100 m; desde el 13, todas. Sin eso, a escala
# de departamento las curvas son un manchón y las teselas pesan lo que no se puede bajar.
#
# Deja el .pmtiles y su entrada del índice en /datos/<lote>/teselas/, al lado de las hojas: se
# publican juntas con `teselas-lote <lote> --publicar`.
set -euo pipefail

LOTE=""; SHP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --shp) SHP="${2:?--shp necesita una ruta}"; shift ;;
    -*) echo "No conozco ${1}." >&2; exit 1 ;;
    *) LOTE="$1" ;;
  esac
  shift
done
[ -n "$LOTE" ] || { echo "  curvas-lote <lote> [--shp archivo.shp]"; exit 1; }
for h in ogrinfo ogr2ogr tippecanoe python3; do command -v "$h" >/dev/null || { echo "Falta ${h} (apt install tippecanoe gdal-bin)."; exit 1; }; done

export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
LOTES="${ELECTRUM_LOTES:-electrum-lotes-548380372606}"
case "$LOTE" in s3://*) ORIGEN="${LOTE%/}/" ;; *) ORIGEN="s3://${LOTES}/${LOTE%/}/" ;; esac
NOMBRE="$(basename "${ORIGEN%/}")"
DIR="/datos/${NOMBRE}"; ORIG="${DIR}/original"; SAL="${DIR}/teselas"; TRAB="${SAL}/trabajo"
mkdir -p "$ORIG" "$SAL/entradas" "$TRAB"

if [ -z "$SHP" ]; then
  # Solo las piezas de shapefiles que se llaman «curvas»: no hace falta bajar el lote entero.
  aws s3 sync "$ORIGEN" "$ORIG" --only-show-errors --exclude '*' \
    --include '*[Cc][Uu][Rr][Vv][Aa]*.shp' --include '*[Cc][Uu][Rr][Vv][Aa]*.dbf' \
    --include '*[Cc][Uu][Rr][Vv][Aa]*.shx' --include '*[Cc][Uu][Rr][Vv][Aa]*.prj' --include '*[Cc][Uu][Rr][Vv][Aa]*.cpg' \
    --include '*[Cc][Uu][Rr][Vv][Aa]*.txt'
  SHP=$(find "$ORIG" -type f -iname '*curva*.shp' -printf '%s\t%p\n' | sort -rn | head -1 | cut -f2-)
fi
[ -n "$SHP" ] && [ -f "$SHP" ] || { echo "No encontré un shapefile de curvas en el lote."; exit 1; }
CAPA="$(basename "${SHP%.*}")"
echo "Curvas: ${SHP#"$ORIG"/} ($(du -h "$SHP" | cut -f1))"

# La cota: el primer campo numérico que se llame como se suele llamar.
CAMPO=$(ogrinfo -so -al "$SHP" | python3 -c '
import re, sys
campos = re.findall(r"^(\w+): (Real|Integer|Integer64)", sys.stdin.read(), re.M)
for c, _ in campos:
    if re.fullmatch(r"(?i)elev(ation)?|cota|altura|alt|z|contour|curva|elevacion", c):
        print(c); break')
[ -n "$CAMPO" ] || { echo "No sé qué campo es la cota. Campos: $(ogrinfo -so -al "$SHP" | grep -E '^\w+: ' | tr '\n' ' ')"; exit 1; }
echo "Cota en el campo ${CAMPO}"

CLAVE="$(python3 -c "import re,unicodedata,sys; t=unicodedata.normalize('NFKD',sys.argv[1]).encode('ascii','ignore').decode().lower(); print(re.sub(r'-+','-',re.sub(r'[^a-z0-9]+','-',t)).strip('-')[:60])" "${NOMBRE}-${CAPA}")"
PM="${SAL}/${CLAVE}.pmtiles"
if [ -s "$PM" ] && [ -s "${SAL}/entradas/${CLAVE}.json" ]; then echo "Ya estaba: ${PM}"; exit 0; fi

SEQ="${TRAB}/${CLAVE}.geojsons"
echo "1/2 Leyendo las líneas (un millón tarda unos minutos)…"
# A WGS 84 y con lo justo: la cota entera y si es maestra. Todo lo demás del .dbf sobra en el mapa.
ogr2ogr -f GeoJSONSeq "$SEQ" "$SHP" -t_srs EPSG:4326 -lco RS=NO -dialect SQLite \
  -sql "SELECT geometry, CAST(ROUND(\"${CAMPO}\") AS INTEGER) AS cota, (CAST(ROUND(\"${CAMPO}\") AS INTEGER) % 100 = 0) AS maestra FROM \"${CAPA}\""

echo "2/2 Teselas vectoriales (zoom 10 a 14)…"
tippecanoe -o "$PM" --force -l curvas -n "Curvas de nivel" -Z 10 -z 14 -P \
  -y cota -y maestra \
  -j '{"curvas": ["any", [">=", "$zoom", 13], ["==", "maestra", 1]]}' \
  --no-tile-size-limit --simplification=2 --quiet "$SEQ"
rm -f "$SEQ"

python3 - "$SHP" "$CLAVE" "$NOMBRE" "${SHP#"$ORIG"/}" "${SAL}/entradas/${CLAVE}.json" <<'PY'
import json, re, subprocess, sys
shp, clave, lote, rel, sal = sys.argv[1:]
info = subprocess.run(['ogrinfo', '-so', '-al', shp], capture_output=True, text=True).stdout
m = re.search(r'Extent: \(([-\d.]+), ([-\d.]+)\) - \(([-\d.]+), ([-\d.]+)\)', info)
n = re.search(r'Feature Count: (\d+)', info)
json.dump({
    'clave': clave,
    'nombre': 'Curvas de nivel cada 20 m (todo el país)',
    'fuente': f'{lote}: {rel}',
    'grupo': 'Relieve',
    'encuadre': [round(float(m.group(i)), 5) for i in (1, 2, 3, 4)],
    'zoomMax': 14,
    'vector': {'capa': 'curvas', 'color': '#E8C38A', 'etiqueta': 'cota', 'maestra': 'maestra'},
    'notas': f'{int(n.group(1)):,} líneas. Desde lejos solo las maestras (cada 100 m); desde el zoom 13, todas.'.replace(',', '.'),
}, open(sal, 'w'), ensure_ascii=False, indent=1)
PY
echo "Listo: ${PM} ($(du -h "$PM" | cut -f1)). Se publica con: teselas-lote ${LOTE} --publicar"
