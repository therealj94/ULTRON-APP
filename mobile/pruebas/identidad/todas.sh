#!/bin/sh
# De quién es cada cosa en un teléfono compartido (auditoría A02–A07, A13, A19, A24): token,
# perfil, recordatorios, chat (sin envío en claro), la barrera de la OTA y cuándo se aplica. Y de la
# auditoría del 3-oct: el reintento y el intento de entrar son de quien los empezó (AUTH01, AUTH03), el
# alta tardía del chat no revive tras salir (AUTH02) y cómo cierra el turno en stream (VOICE01, VOICE02). Y de la
# revisión 9: el visor de la computadora de A (abierto, lo escrito, el lote pendiente) no queda para B.
# Construye el paquete para node y corre cada prueba. Sin relevo ni servidor: todo lo de afuera va simulado.
# IDENTIDAD=/ruta/otro-paquete.cjs corre las mismas pruebas contra otro código (ver construir.cjs).
cd "$(dirname "$0")" || exit 1
node construir.cjs || exit 1
fallos=0
for t in sesion perfil recordatorios ota chat cifrado intento alta turno tardia visor; do
  echo "\n══ $t"
  timeout 120 node "$t.cjs" || fallos=$((fallos + 1))
done
echo "\n$fallos prueba(s) con fallos"
exit $fallos
