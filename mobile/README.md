# ULTRON FP · app nativa Android

Cara a pantalla completa, escucha continua sin palabra clave, una sola voz neural (ElevenLabs Flash, voz "ULTRON"), cámara que identifica lo que hay en la mesa y cerebro Qwen 27B vía el backend de Render.

## Cómo se construye

GitHub Actions (`.github/workflows/android-apk.yml`) hace `expo prebuild` + `gradlew assembleRelease` y publica el artefacto `ULTRON-FP-apk` (APK release, Hermes, JS empaquetado). Se dispara con cada push a `main` o `cursor/**` que toque `mobile/`, o a mano con *Run workflow*.

Instalación: el APK va firmado con la keystore debug del template; si había una versión anterior firmada distinto (EAS), desinstálala primero.

## Backend que usa (`extra.ultronUrl` en `app.json`)

| Ruta | Uso |
| --- | --- |
| `POST /api/turno` | Un turno con el cerebro (Qwen). Manda `usuario`, `historial` y `image` opcional. |
| `GET/POST /api/tts` | Voz. `engine=fast` = ElevenLabs Flash con caché; `performance=sing` = canto. Fallback nodo Qwen3-TTS. |
| `POST /api/stt` | Oído: ElevenLabs Scribe. |
| `POST /api/vision/analyze` | Nodo de visión (Playwright/ojo). |
| `POST /api/memoria` | Hechos de largo plazo. |
| `POST /api/ultron/entrar` · `biometric-login` | Login de junta (j.ordonez@ / m.ordonez@ordenglobal.org). |

## Frases grabadas

`voice-lines.json` lista saludos, reacciones y avisos fijos. `npm run voice-bank [API]` las sintetiza una vez con la voz oficial y genera `assets/voice/*.mp3` + `src/lib/voiceBank.ts`; la app las reproduce a 0 ms y sin red. Si cambias una frase en el JSON o en `DeskScreen`, vuelve a correr el script.

## Estructura

- `App.tsx` — boot → login (vertical) → escritorio (horizontal), permisos, OTA.
- `src/screens/LoginScreen.tsx` — la cara mira los campos; huella; clave remota con regla offline segura.
- `src/screens/DeskScreen.tsx` — orquesta voz, tacto, sacudida, visión, menú.
- `src/components/UltronFace.tsx` — anillos LOOI, párpados/cejas/boca, blaster, sable.
- `src/components/GazeCamera.tsx` — cámara frontal invisible; etiquetas cada ~6.5 s; frame bajo demanda.
- `src/components/DeskMenu.tsx` — menú lateral (deslizar desde la derecha).
- `src/lib/speech.ts` — VAD por energía, cierre por silencio, watchdog con reinicio duro.
- `src/lib/tts.ts` — pipeline por oraciones, precarga de la siguiente, nunca voz del sistema.

## Desarrollo

```bash
npm ci
npm run typecheck
npx expo prebuild -p android --no-install && cd android && ./gradlew assembleRelease
```
