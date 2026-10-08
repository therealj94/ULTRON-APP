#!/bin/sh
# La hoja «Por confirmar» de las caras y las voces MONTADA (tanda F1): caras/HojaConsentimiento.tsx corre de verdad en node
# (react-reconciler, React Native simulado como etiquetas) contra un /api/caras y /api/voces falsos. Toca la insignia, la
# hoja de confirmar («Sí, guardar» / «Borrar») y el aviso de una vez al abrir la mesa por los manejadores reales.
# Sin red ni teléfono: todo lo de afuera va simulado.
cd "$(dirname "$0")" || exit 1
if [ -z "$CONSENTIMIENTO" ]; then node construir.cjs || exit 1; fi
echo "\n══ por confirmar"
timeout 120 node consentimiento.cjs
