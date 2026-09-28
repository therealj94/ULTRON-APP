#!/bin/bash
# Instala el vigía y el motor en el nodo A10G. Correr como root desde esta carpeta:
#   sudo bash instalar.sh
set -euo pipefail
cd "$(dirname "$0")"
python3 -m unittest probar_vigia >/dev/null
python3 -m py_compile vigia.py ../ultron-motor.py
install -d -m 0755 /opt/ultron
install -m 0755 vigia.py /opt/ultron/vigia.py
if ! cmp -s ../ultron-motor.py /opt/ultron/ultron-motor.py; then
  if [ -f /opt/ultron/ultron-motor.py ]; then
    cp /opt/ultron/ultron-motor.py "/opt/ultron/ultron-motor.py.bak-$(date +%Y%m%d%H%M)"
  fi
  install -m 0755 ../ultron-motor.py /opt/ultron/ultron-motor.py
  # En un nodo nuevo la unidad del motor (con su secreto y su certificado) se instala aparte.
  if systemctl cat ultron-motor >/dev/null 2>&1; then
    systemctl restart ultron-motor
  else
    echo "aviso: no hay unidad ultron-motor; el motor quedó copiado pero no arrancado"
  fi
fi
install -m 0644 ultron-vigia.service ultron-vigia.timer /etc/systemd/system/
install -d -m 0755 /var/lib/ultron-vigia
systemctl daemon-reload
systemctl enable --now ultron-vigia.timer
systemctl start ultron-vigia.service
cat /var/lib/ultron-vigia/resumen.json; echo
