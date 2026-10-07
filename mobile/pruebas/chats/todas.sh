#!/bin/sh
# Las pestañas de los chats MONTADAS (auditoría visual del 7-oct, A1): whatsapp/ChatsConWhatsapp.tsx corre de verdad en
# node (react-reconciler, React Native simulado como etiquetas) y la pestaña marcada y la página del deslizador tienen
# que ser siempre la misma: «abre WhatsApp» con el estado llegando tarde, sin red con lo guardado, tocar, deslizar,
# girar el teléfono y que WhatsApp desaparezca. Sin red ni teléfono: todo lo de afuera va simulado.
# CHATS=/ruta/otro-paquete.cjs corre la misma prueba contra otro código (ver construir.cjs).
cd "$(dirname "$0")" || exit 1
if [ -z "$CHATS" ]; then node construir.cjs || exit 1; fi
echo "\n══ pestañas"
timeout 120 node pestanas.cjs
