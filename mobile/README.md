# ULTRON FP — APK nativo (Expo)

App Android en landscape que carga el escritorio LOOI en WebView:

`https://ultron-looi-desk.onrender.com`

## Requisitos
1. Cuenta Expo
2. Token EAS / login (`eas login`)
3. `eas.json` listo (perfil `preview` → APK)

## Build APK
```bash
cd mobile
npm install
npx eas-cli login
# pegar EXPO_TOKEN o usar login interactivo
npx eas init   # genera projectId → pegarlo en app.json extra.eas.projectId
npx eas build -p android --profile preview
```

El enlace de descarga del APK aparece al terminar el build en Expo.

## Notas
- Orientación forzada: landscape
- Permisos: cámara + micrófono
- La API key de ElevenLabs vive en Render, no en el APK
