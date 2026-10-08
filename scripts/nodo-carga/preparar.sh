#!/usr/bin/env bash
#
# ELECTRUM — preparación del nodo de carga. Va como user-data: lo corre EC2 una vez, como root, al
# primer arranque. nodo.sh le cambia __BUCKET__ y __REGION__ antes de mandarlo.
#
# Deja: Node 22, la CLI de AWS v2 con el plugin de Session Manager (para los túneles al cerebro),
# GDAL, Tesseract con español e inglés, poppler, 7-Zip y tmux; el código de Electrum en
# /opt/electrum-carga/codigo con sus dependencias, y `cargar-lote` en el PATH.
# Cuando termina bien escribe /opt/electrum-carga/LISTO, que es lo que espera nodo.sh.
set -euo pipefail
exec > >(tee -a /var/log/electrum-carga.log) 2>&1
echo "== preparación $(date -Is)"

export DEBIAN_FRONTEND=noninteractive
BUCKET="__BUCKET__"
LOTES="__LOTES__"
REGION="__REGION__"

apt-get update -q
# 7zip (`7z`) y unar abren .rar y .7z, que el cargador rechaza y en los expedientes aparecen;
# xlrd + openpyxl pasan los .xls viejos a .xlsx; tippecanoe
# hace las teselas vectoriales de las curvas de nivel (curvas-lote).
apt-get install -y -q --no-install-recommends \
  ca-certificates curl unzip xz-utils jq tmux git python3 \
  gdal-bin poppler-utils tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng 7zip unar tippecanoe python3-xlrd python3-openpyxl postgresql-client \
  libreoffice-impress-nogui libreoffice-writer-nogui

# Node 22 del sitio oficial, comprobado contra su suma: el de Ubuntu es viejo y el código pide >=22.
cd /tmp
SUMAS=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt)
NODE_TGZ=$(echo "$SUMAS" | awk '/linux-x64\.tar\.xz$/ {print $2}')
curl -fsSLO "https://nodejs.org/dist/latest-v22.x/${NODE_TGZ}"
echo "$SUMAS" | grep " ${NODE_TGZ}\$" | sha256sum -c -
tar -xJf "$NODE_TGZ" -C /usr/local --strip-components=1
rm -f "$NODE_TGZ"
node --version

# CLI de AWS v2 y el plugin de Session Manager: sin el plugin, `aws ssm start-session` abre la
# sesión y no sabe hablarla, y los túneles al cerebro no levantan.
curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o awscli.zip
unzip -q -o awscli.zip && ./aws/install --update && rm -rf aws awscli.zip
curl -fsSL https://s3.amazonaws.com/session-manager-downloads/plugin/latest/ubuntu_64bit/session-manager-plugin.deb -o smp.deb
dpkg -i smp.deb && rm -f smp.deb

# go-pmtiles, para empaquetar las teselas de los rásteres (teselas-lote). Comprobado contra la suma
# que publica la propia versión.
cat > /usr/local/bin/electrum-carga-pmtiles <<'PMT'
#!/usr/bin/env bash
set -euo pipefail
# go-pmtiles no publica archivo de sumas; GitHub sí da la sha256 de cada archivo de la versión.
ASSET=$(curl -fsSL https://api.github.com/repos/protomaps/go-pmtiles/releases/latest |
  jq -c '[.assets[] | select(.name | test("_Linux_x86_64\\.tar\\.gz$"))][0]')
URL=$(echo "$ASSET" | jq -r .browser_download_url)
SUMA=$(echo "$ASSET" | jq -r '.digest // empty' | sed 's/^sha256://')
[ -n "$SUMA" ] || { echo "GitHub no dio la suma de ${URL}: no lo instalo sin comprobarlo." >&2; exit 1; }
T=$(mktemp -d); cd "$T"
curl -fsSL "$URL" -o pmtiles.tar.gz
echo "${SUMA}  pmtiles.tar.gz" | sha256sum -c -
tar -xzf pmtiles.tar.gz pmtiles && install -m 755 pmtiles /usr/local/bin/pmtiles
cd / && rm -rf "$T"; pmtiles version 2>/dev/null | head -1 || true
PMT
chmod +x /usr/local/bin/electrum-carga-pmtiles
/usr/local/bin/electrum-carga-pmtiles

mkdir -p /opt/electrum-carga /datos
cat > /etc/profile.d/electrum-carga.sh <<PERFIL
export AWS_DEFAULT_REGION=${REGION}
export ELECTRUM_BUCKET=${BUCKET}
export ELECTRUM_LOTES=${LOTES}
PERFIL

# Traer (o volver a traer) el código. Se reemplaza entero: un árbol a medias de dos versiones es
# peor que cualquiera de las dos.
cat > /usr/local/bin/electrum-carga-codigo <<CODIGO
#!/usr/bin/env bash
set -euo pipefail
export AWS_DEFAULT_REGION=${REGION}
NUEVO=/opt/electrum-carga/codigo.nuevo
rm -rf "\$NUEVO" && mkdir -p "\$NUEVO"
aws s3 cp "s3://${BUCKET}/nodo-carga/codigo.tar.gz" - --only-show-errors | tar -xz -C "\$NUEVO"
cd "\$NUEVO"
# Sin scripts de instalación: no hace falta el navegador de Playwright ni compilar sharp para cargar.
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --ignore-scripts --no-audit --no-fund --loglevel=error
rm -rf /opt/electrum-carga/codigo
mv "\$NUEVO" /opt/electrum-carga/codigo
chmod +x /opt/electrum-carga/codigo/scripts/electrum/*.sh /opt/electrum-carga/codigo/scripts/nodo-carga/*.sh
ln -sf /opt/electrum-carga/codigo/scripts/nodo-carga/cargar-lote.sh /usr/local/bin/cargar-lote
ln -sf /opt/electrum-carga/codigo/scripts/nodo-carga/teselas-lote.sh /usr/local/bin/teselas-lote
ln -sf /opt/electrum-carga/codigo/scripts/nodo-carga/curvas-lote.sh /usr/local/bin/curvas-lote
ln -sf /opt/electrum-carga/codigo/scripts/nodo-carga/con-cerebro.sh /usr/local/bin/con-cerebro
ln -sf /opt/electrum-carga/codigo/scripts/nodo-carga/ocr-pendientes.sh /usr/local/bin/ocr-pendientes
echo "código al día"
CODIGO
chmod +x /usr/local/bin/electrum-carga-codigo
/usr/local/bin/electrum-carga-codigo

touch /opt/electrum-carga/LISTO
echo "== listo $(date -Is)"
