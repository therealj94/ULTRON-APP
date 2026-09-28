#!/bin/bash
# Instala el vigía en la T4 con su configuración. Correr como root desde la raíz del repo:
#   sudo bash scripts/nodo-t4/instalar-vigia.sh
# Es el mismo programa que el de la A10G; cambia /etc/ultron-vigia.json (las capas de la T4).
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m py_compile nodo-a10g/vigia/vigia.py
python3 -c "import json; json.load(open('nodo-t4/vigia.json'))"
install -d -m 0755 /opt/ultron /var/lib/ultron-vigia
install -m 0755 nodo-a10g/vigia/vigia.py /opt/ultron/vigia.py
install -m 0644 nodo-t4/vigia.json /etc/ultron-vigia.json
install -m 0644 nodo-a10g/vigia/ultron-vigia.service nodo-a10g/vigia/ultron-vigia.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ultron-vigia.timer
systemctl start ultron-vigia.service
cat /var/lib/ultron-vigia/resumen.json; echo
