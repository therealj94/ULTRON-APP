#!/usr/bin/env bash
#
# ELECTRUM — pasa por reconocimiento óptico los documentos que el cargador no pudo leer.
#
#   ./ocr.sh para-ocr.txt [destino]
#
# El cargador deja en `para-ocr.txt` los que rechazó: escaneos sin capa de texto, y PDFs que sí
# tienen capa de texto pero ilegible —letras sueltas o una codificación de fuente propia—. Los dos
# casos se arreglan igual: se rasteriza la página y se lee la imagen.
#
# El resultado es un .txt con las páginas separadas, al lado del original y sin tocarlo. Se vuelve
# a pasar el cargador sobre la carpeta de salida y entra como cualquier otro documento, citable con
# su número de página.
#
# Tarda: una ley de cien páginas son unos minutos. Se hace UNA vez.
set -euo pipefail

LISTA="${1:-para-ocr.txt}"
DESTINO="${2:-$(dirname "$LISTA")/ocr}"
IDIOMA="${IDIOMA:-spa}"
DPI="${DPI:-300}"

command -v tesseract >/dev/null || { echo "Falta tesseract (apt install tesseract-ocr tesseract-ocr-spa)"; exit 1; }
command -v pdftoppm  >/dev/null || { echo "Falta pdftoppm (apt install poppler-utils)"; exit 1; }
[ -f "$LISTA" ] || { echo "No encuentro $LISTA"; exit 1; }

mkdir -p "$DESTINO"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

TOTAL=$(grep -c . "$LISTA" || echo 0)
N=0
while IFS= read -r ARCHIVO; do
  [ -n "$ARCHIVO" ] || continue
  N=$((N + 1))
  NOMBRE="$(basename "$ARCHIVO")"
  SALIDA="$DESTINO/${NOMBRE%.*}.txt"
  printf '▸ [%d/%d] %.55s … ' "$N" "$TOTAL" "$NOMBRE"

  if [ -f "$SALIDA" ]; then echo "ya estaba"; continue; fi
  if [ ! -f "$ARCHIVO" ]; then echo "no existe"; continue; fi

  rm -f "$TMP"/p-*.png
  pdftoppm -r "$DPI" -png "$ARCHIVO" "$TMP/p" 2>/dev/null || { echo "no pude rasterizarlo"; continue; }
  PAGS=$(ls "$TMP"/p-*.png 2>/dev/null | wc -l)
  [ "$PAGS" -gt 0 ] || { echo "no salió ninguna página"; continue; }

  # Se guarda TEXTO, no un PDF con capa invisible.
  #
  # Tesseract sabe escribir un PDF con su propia capa de texto, pero esa capa usa una fuente y una
  # codificación que nuestro lector de PDF no interpreta: el archivo salía «sin texto» otra vez y
  # el OCR no servía de nada. El texto plano no tiene ese problema y además es lo único que se
  # guarda al final.
  #
  # Las páginas se separan con un salto de página (\f), que es la marca por la que el troceador
  # reparte los fragmentos. Sin eso, una ley de cien páginas se cita entera como «página 1» y la
  # cita deja de poder comprobarse, que es para lo único que existe una cita.
  : > "$TMP/todo.txt"
  HECHAS=0
  for IMG in "$TMP"/p-*.png; do
    if tesseract "$IMG" "${IMG%.png}" -l "$IDIOMA" --dpi "$DPI" >/dev/null 2>&1 && [ -f "${IMG%.png}.txt" ]; then
      cat "${IMG%.png}.txt" >> "$TMP/todo.txt"
      HECHAS=$((HECHAS + 1))
    fi
    printf '\f' >> "$TMP/todo.txt"
  done
  [ "$HECHAS" -gt 0 ] || { echo "el OCR no devolvió nada"; continue; }
  mv "$TMP/todo.txt" "$SALIDA"

  echo "$HECHAS/$PAGS páginas"
done < "$LISTA"

echo
echo "Listo. Los reconocidos están en $DESTINO."
echo "Ahora: npx tsx scripts/electrum/aprender.ts --seco $DESTINO"
