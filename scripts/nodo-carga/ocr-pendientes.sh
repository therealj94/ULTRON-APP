#!/usr/bin/env bash
#
# ELECTRUM — OCR de lo que quedó con poco texto en un lote ya cargado. Se corre EN el nodo de carga:
#
#   con-cerebro tsx scripts/electrum/mejorar-lote.ts --listar s3://<cubo>/<lote>/ > /root/pendientes.tsv
#   ocr-pendientes <lote> /root/pendientes.tsv
#   con-cerebro tsx scripts/electrum/mejorar-lote.ts --cargar-ocr /root/pendientes.tsv /datos/<lote>/ocr-mejora
#
# Un PDF va directo al OCR (ocr.sh: cada página rasterizada y leída, con sus saltos de página). Una
# presentación o un Word (.pptx, .ppt, .docx, .doc) se pasa antes a PDF con LibreOffice: muchas
# diapositivas son fotos de un mapa o de una tabla, y el lector de .pptx solo ve el texto escrito.
# Las hojas de cálculo y los .txt se saltan: ahí no hay imágenes que leer.
set -euo pipefail

LOTE="${1:?cargar lote}"; LISTA="${2:?y la lista de --listar}"
NOMBRE="$(basename "${LOTE%/}")"
ORIG="/datos/${NOMBRE}/original"; SAL="/datos/${NOMBRE}/ocr-mejora"; TMP="/datos/${NOMBRE}/ocr-mejora-tmp"
CODIGO=/opt/electrum-carga/codigo
HILOS="${HILOS:-$(nproc)}"
mkdir -p "$SAL" "$TMP"
command -v soffice >/dev/null || { echo "Falta LibreOffice (apt install libreoffice-impress libreoffice-writer)."; exit 1; }

leer_uno() {  # leer_uno <ruta relativa dentro del lote>
  local rel="$1" ent="${ORIG}/$1" sal="${SAL}/${1%.*}.txt" pdf lista
  [ -s "$sal" ] && { echo "= ${rel}"; return; }
  [ -f "$ent" ] || { echo "✗ ${rel} (no está el original)"; return; }
  mkdir -p "$(dirname "$sal")"
  case "${rel,,}" in
    *.pdf) pdf="$ent" ;;
    *.pptx|*.ppt|*.docx|*.doc)
      # Un perfil de LibreOffice por proceso: dos conversiones a la vez con el mismo perfil se traban.
      local perfil; perfil="$(mktemp -d "${TMP}/perfil-XXXX")"
      timeout 600 soffice -env:UserInstallation="file://${perfil}" --headless --convert-to pdf --outdir "$perfil" "$ent" >/dev/null 2>&1 || true
      pdf="$(find "$perfil" -maxdepth 1 -name '*.pdf' | head -1)"
      [ -n "$pdf" ] || { echo "✗ ${rel} (LibreOffice no lo convirtió)"; rm -rf "$perfil"; return; } ;;
    *) echo "– ${rel} (no es imagen: se salta)"; return ;;
  esac
  lista="$(mktemp "${TMP}/lista-XXXX")"; printf '%s\n' "$pdf" > "$lista"
  OMP_THREAD_LIMIT=1 bash "${CODIGO}/scripts/electrum/ocr.sh" "$lista" "$(dirname "$sal")" >/dev/null 2>&1 || true
  # ocr.sh nombra la salida por el PDF; si vino de una conversión, se lleva al nombre del original.
  local hecho; hecho="$(dirname "$sal")/$(basename "${pdf%.*}").txt"
  [ "$hecho" = "$sal" ] || { [ -f "$hecho" ] && mv -f "$hecho" "$sal"; }
  rm -f "$lista"; [ "$pdf" = "$ent" ] || rm -rf "$(dirname "$pdf")"
  if [ -s "$sal" ]; then echo "✓ ${rel} ($(wc -c < "$sal") caracteres)"; else echo "✗ ${rel} (el OCR no sacó nada)"; fi
}
export -f leer_uno; export ORIG SAL TMP CODIGO

cut -f3 "$LISTA" | tr '\n' '\0' | xargs -0 -P "$HILOS" -I{} bash -c 'leer_uno "$1"' _ {}
rm -rf "$TMP"
echo "Listo: $(find "$SAL" -name '*.txt' | wc -l) textos en ${SAL}."
