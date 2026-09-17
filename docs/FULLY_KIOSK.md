# Fully Kiosk Browser — ULTRON FP (Android tablet / desk robot)

## Objetivo
Pantalla completa horizontal, sin chrome del navegador, reinicio automático y micrófono/cámara permitidos.

## Instalación rápida
1. Instala **Fully Kiosk Browser** (Plus recomendado) desde Play Store.
2. Abre Fully → Settings → **Web Content Settings** → Start URL:
   `https://TU-DOMINIO-RENDER/`
3. **Fullscreen Mode** → ON
4. **Force Screen Orientation** → Landscape
5. **Desktop Mode** → ON (viewport kiosk)
6. **Enable JavaScript**, **Enable Cookies**, **Enable WebRTC** → ON (mic + cámara)
7. **Auto Reload** after idle (opcional) → 30–60 min
8. Settings → **Other Settings** → Disable pull-to-refresh / zoom gestures

## PWA alternativa (Chrome Android)
1. Abre la URL en Chrome.
2. Menú → **Añadir a pantalla de inicio** / Instalar app.
3. La app usa `display: fullscreen` + `orientation: landscape`.

## Checklist de secretos (Render)
Configura en el servicio (nunca en el cliente):
- `ULTRON_NODO_URL` = `https://34.207.148.69:8443`
- `ULTRON_NODO_SECRETO`
- `ULTRON_NODO_INSECURE_TLS=1` (certificado del motor en IP)
- `ULTRON_OJO_URL` = `http://34.229.88.165:8787`
- `ULTRON_OJO_CLAVE`
- `GITHUB_PAT`, `RENDER_API_KEY`, `AWS_*`, `ELEVENLABS_API_KEY`, `GEMINI_API_KEY` (opcionales)

## Notas
- El service worker cachea el shell; las rutas `/api/*` y `/ws` siempre van a red.
- Si el micrófono no abre: Fully → Settings → Web Content → Camera/Mic permission → Allow.
