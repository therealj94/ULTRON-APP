#!/bin/bash
# Instala el vigía en la T4 con su configuración. Correr como root desde la raíz del repo:
#   sudo DOMINIO_T4=<ip-con-guiones>.sslip.io bash scripts/nodo-t4/instalar-vigia.sh
# El dominio del nodo no va en el repositorio (es público): se pone al instalar.
# Es el mismo programa que el de la A10G; cambia /etc/ultron-vigia.json (las capas de la T4).
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m py_compile nodo-a10g/vigia/vigia.py
python3 -c "import json; json.load(open('nodo-t4/vigia.json'))"
install -d -m 0755 /opt/ultron /var/lib/ultron-vigia
install -m 0755 nodo-a10g/vigia/vigia.py /opt/ultron/vigia.py
: "${DOMINIO_T4:?Falta DOMINIO_T4 (el dominio TLS del nodo T4, p. ej. <ip-con-guiones>.sslip.io)}"
sed "s/__DOMINIO_T4__/${DOMINIO_T4}/g" nodo-t4/vigia.json > /etc/ultron-vigia.json
chmod 0644 /etc/ultron-vigia.json
install -m 0644 nodo-a10g/vigia/ultron-vigia.service nodo-a10g/vigia/ultron-vigia.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ultron-vigia.timer
systemctl start ultron-vigia.service
cat /var/lib/ultron-vigia/resumen.json; echo
