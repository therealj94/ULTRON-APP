#!/bin/sh
# El visor de la computadora MONTADO (auditoría 8+, P3/A3): app/VisorComputadora.tsx corre de verdad en node
# (react-reconciler, React Native simulado como etiquetas) contra un /api/computadora falso con la imagen de después
# demorada 50/500/1500 ms. Escribe por los manejadores reales del componente y mira lo que llega al nodo.
# Construye el paquete para node y corre la prueba. Sin red ni teléfono: todo lo de afuera va simulado.
# VISOR=/ruta/otro-paquete.cjs corre la misma prueba contra otro código (ver construir.cjs).
cd "$(dirname "$0")" || exit 1
if [ -z "$VISOR" ]; then node construir.cjs || exit 1; fi
echo "\n══ lote"
timeout 180 node lote.cjs
