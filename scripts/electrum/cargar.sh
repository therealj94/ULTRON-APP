#!/usr/bin/env bash
#
# ELECTRUM — mete una carpeta de expedientes en el cerebro, de un solo comando.
#
#   ./cargar.sh /ruta/a/los/expedientes
#   ./cargar.sh s3://electrum-expedientes-548380372606/entrada/
#
# Los documentos NO salen de tu máquina. El cerebro no guarda el PDF: le saca el texto, lo trocea
# con su página y tira el binario. Por el cable va texto extraído, no expedientes, y por eso una
# carpeta de gigabytes se convierte en decenas de megabytes de base.
#
# Lo que hace, en orden:
#   1. Abre un túnel a la base del nodo por SSM. No abre ningún puerto a internet.
#   2. Ensaya sin escribir nada y te dice qué entraría de verdad: cuántos documentos, cuánto texto,
#      y sobre todo cuántos son escaneos sin capa de texto que hay que pasar por OCR antes.
#   3. Te pregunta. Y si decís que sí, carga.
#
# Se puede cortar y relanzar las veces que haga falta: cada documento lleva la huella de su
# contenido y lo ya cargado se salta sin volver a abrirlo.
#
# La clave de la base está en el nodo, en /root/electrum-db-url. Se pide aquí y no se guarda en
# ningún sitio: pasarla por SSM la dejaría en el historial de AWS para siempre.
set -euo pipefail

CARPETA="${1:-}"
INSTANCIA="${INSTANCIA:-i-06530893af0dd0638}"
PUERTO="${PUERTO:-55432}"
REGION="${REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "${AQUI}/../.." && pwd)"

rojo()  { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
paso()  { printf '\n\033[36m== %s\033[0m\n' "$*"; }

[ -n "$CARPETA" ] || {
  rojo "Falta la carpeta."
  echo "  $0 /ruta/a/los/expedientes"
  echo "  $0 s3://electrum-expedientes-548380372606/entrada/"
  exit 1
}

# Un prefijo de S3 vale igual que una carpeta: se baja primero a un directorio de trabajo y a
# partir de ahí es el mismo camino. Se usa `sync` para que relanzarlo continúe en vez de volver a
# bajarlo todo, que con gigabytes es la diferencia entre minutos y una tarde.
BAJADO=""
case "$CARPETA" in
  s3://*)
    BAJADO="${DESTINO:-$HOME/electrum-expedientes}"
    paso "Bajando de S3 a ${BAJADO}"
    mkdir -p "$BAJADO"
    aws s3 sync "$CARPETA" "$BAJADO" --only-show-errors
    CARPETA="$BAJADO"
    N=$(find "$CARPETA" -type f | wc -l)
    [ "$N" -gt 0 ] || { rojo "No bajó ningún archivo. ¿Está vacío el prefijo?"; exit 1; }
    echo "  ${N} archivos, $(du -sh "$CARPETA" | cut -f1)"
    ;;
esac

[ -d "$CARPETA" ] || { rojo "No existe la carpeta: $CARPETA"; exit 1; }
command -v aws >/dev/null || { rojo "Falta la CLI de AWS."; exit 1; }
command -v session-manager-plugin >/dev/null || {
  rojo "Falta el plugin de Session Manager."
  echo "Sin él la CLI abre la sesión y no sabe hablarla:"
  echo "  https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html"
  exit 1
}

paso "La clave de la base"
echo "Está en el nodo. Si no la tenés a mano, en otra terminal:"
echo "  aws ssm start-session --target ${INSTANCIA} --region ${REGION}"
echo "  sudo cat /root/electrum-db-url"
echo
if [ -n "${ELECTRUM_CLAVE_DB:-}" ]; then
  CLAVE="$ELECTRUM_CLAVE_DB"
  echo "  (tomada de ELECTRUM_CLAVE_DB)"
else
  # -s para que no se vea al teclearla ni quede en la captura de pantalla de nadie.
  read -rsp "  Clave del usuario electrum: " CLAVE
  echo
fi
[ -n "$CLAVE" ] || { rojo "Sin clave no hay base."; exit 1; }

paso "Abriendo el túnel"
aws ssm start-session --region "$REGION" --target "$INSTANCIA" \
  --document-name AWS-StartPortForwardingSession \
  --parameters "{\"portNumber\":[\"5432\"],\"localPortNumber\":[\"${PUERTO}\"]}" \
  > /tmp/electrum-tunel.log 2>&1 &
TUNEL=$!
# El túnel se cierra pase lo que pase: un Ctrl-C a mitad de carga no puede dejarlo colgado.
trap 'kill "$TUNEL" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 30); do
  sleep 1
  if (exec 3<>/dev/tcp/127.0.0.1/"${PUERTO}") 2>/dev/null; then exec 3<&- 3>&-; break; fi
done
if ! (exec 3<>/dev/tcp/127.0.0.1/"${PUERTO}") 2>/dev/null; then
  rojo "El túnel no levantó. El detalle:"
  tail -5 /tmp/electrum-tunel.log
  exit 1
fi
exec 3<&- 3>&-
echo "  abierto en 127.0.0.1:${PUERTO}"

export ELECTRUM_DB_URL="postgres://electrum:${CLAVE}@127.0.0.1:${PUERTO}/electrum"

paso "Ensayo: qué entraría de verdad (no escribe nada)"
cd "$RAIZ"
npx tsx scripts/electrum/aprender.ts --seco "$CARPETA"

echo
read -rp "¿Cargo? [s/N] " SI
case "$SI" in
  s|S|si|SI|sí|Sí) ;;
  *) echo "No cargué nada."; exit 0;;
esac

paso "Cargando"
npx tsx scripts/electrum/aprender.ts --quien "${USER:-jose}" "$CARPETA"

verde "
Listo. Se puede relanzar cuando quieras: lo ya cargado se salta solo."
