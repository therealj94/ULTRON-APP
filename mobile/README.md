# ULTRON FP — APK nativo (Expo)

App Android landscape que carga el desk en WebView:

`https://ultron-looi-desk.onrender.com`

## Build APK

```bash
cd mobile
npm install
export EXPO_TOKEN='…'   # https://expo.dev/settings/access-tokens
npx eas build -p android --profile preview --non-interactive
```

El enlace del APK aparece al terminar en Expo.

## Permisos

Al abrir pide **CAMERA** + **RECORD_AUDIO**. La WebView auto-concede captura si el OS ya aprobó.

## Notas

- Icono/splash = logo ULTRON cyan
- Versión app: `1.1.0`
- ElevenLabs / AWS / TTS viven en Render, no en el APK
