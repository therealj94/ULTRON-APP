# ULTRON FP — Native Android (Expo)

App **nativa** React Native + Expo. **No usa WebView.**

## Stack
- Expo SDK 54 + React Native
- Face: `@shopify/react-native-skia`
- Mic: `expo-speech-recognition`
- Cámara: `expo-camera`
- TTS: `expo-av` + `/api/tts/synthesize` (fallback `expo-speech`)
- Credenciales: `expo-secure-store`
- Memoria / chat offline: AsyncStorage + pack local

## Build APK
```bash
cd mobile
npx eas-cli build -p android --profile preview --non-interactive
```

## Pantallas
1. Boot nativo (permisos + health)
2. Login José/Medardo
3. Desk: cara Skia, voz, texto, visión, sleep/stay/explore
4. Ajustes
