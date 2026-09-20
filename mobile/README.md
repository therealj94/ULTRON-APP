# ULTRON FP · app nativa Android (4.0)

Cara a pantalla completa, escucha continua sin palabra clave, **una sola voz** — *ULTRON (Gabriela · ElevenLabs v3)* —,
cámara que identifica lo que hay en la mesa y cerebro Qwen 27B vía el backend de Render. Producto para la junta de
Orden Global (paleta negro + cian `#05E1FF`, UI en español).

## Cómo se construye

GitHub Actions (`.github/workflows/android-apk.yml`) hace `npm ci` → `npm run typecheck` → `expo prebuild` →
`gradlew assembleRelease` (arm64-v8a + armeabi-v7a, Hermes, JS empaquetado) y publica el artefacto `ULTRON-FP-apk`
(`out/ULTRON-FP-<versión>.apk`). Se dispara con cada push a `main` o `cursor/**` que toque `mobile/`, `src/`, `server*`,
o a mano con *Run workflow*. No hay OTA (`expo-updates` se retiró): cada cambio es un APK nuevo.

Instalación: el APK va firmado con la keystore debug del template; si había una versión anterior firmada distinto,
desinstálala primero. Versión: `app.json` `expo.version` = `package.json` `version` (4.0.0), `android.versionCode` 40.

## Backend que usa (`extra.ultronUrl` en `app.json`)

| Ruta | Uso en la app |
| --- | --- |
| `POST /api/turno` | Un turno con el cerebro. Manda `usuario`, `correo`, `historial`, `memoria[]` e `image` opcional. Responde `reply`, `emocion`, `mode`. |
| `POST /api/turno/stream` | Igual, por SSE (XHR). Eventos: `emocion` (antes del primer delta → la cara reacciona antes que la voz), `delta`, `tools`, `done` (trae `emocion`), `error`. |
| `GET/POST /api/tts` | Voz. `text`, `emocion`, `performance=speak\|sing`. Devuelve `audio/mpeg` + cabecera `X-Ultron-TTS`. Sin parámetro `engine`: una sola voz. |
| `POST /api/cantar` | `{ id }` (jesus, bohemian, ligera, bittersweet, runaway, bruno, waymaker) o `{ letra, titulo? }` → mp3 de ULTRON cantando (hasta ~40 s la primera vez). `GET` devuelve el repertorio. |
| `POST /api/orar` | `{}` o `{ tema }` → mp3 de la oración del día (~3 min, cacheado). Sin tema se usa el estático `/voz/oracion.mp3` si existe. Cara PRAY, HUD «orando». |
| `GET /api/capacidades` | Catálogo real (`Capacidad[]` agrupadas, `vivo` según salud de nodos, voz oficial, canciones, gestos). Se cachea en AsyncStorage para verlo sin red. |
| `POST /api/stt` | Oído en la nube (ElevenLabs Scribe), solo si se elige «Nube» en Ajustes; por defecto el reconocimiento es el del teléfono. |
| `POST /api/vision/analyze` | Nodo de visión: etiquetas de la mesa cada ~12 s y frames bajo demanda. |
| `POST /api/memoria` | Hechos de largo plazo (`hecho`, `usuario`). **Requiere sesión**: pasa por `api()`, que renueva el token en 401 con las credenciales guardadas. |
| `POST /api/ultron/entrar` · `biometric-login` · `salir` | Sesión de junta (`j.ordonez@` / `m.ordonez@ordenglobal.org`). Cabecera `x-ultron-sesion`. |
| `GET /voz/<id>.mp3` | Clips grabados con la voz oficial (ver banco). |

Contrato de emoción (`src/lib/emocion.ts`, copia de `lib/emocion.ts` del servidor): `neutral, feliz, risa, sorpresa, curioso,
pensando, preocupado, triste, molesto, cansado, carino, orgullo, travieso, canto, oracion` → `FaceState` (`faceForEmocion`;
`oracion` → `PRAY`). El
servidor ya quita la etiqueta `[EMO:x]`; el cliente la pela igual por si acaso.

## Banco de voz (offline)

`scripts/build-voice-bank.mjs` (`npm run voice-bank [API]`) baja los clips cortos de `/voz/<id>.mp3` a `assets/voice/` y
genera `src/lib/voiceBank.ts`:

- **Empaquetados en el APK** (0 ms, sin red; 464 KB): `mmm, je, uy, vale, entendido, dias, tardes, noches, calenta, listos`.
- **Remotos** (canciones, chistes, discurso y clips nuevos): `bruno, bohemian, ligera, bittersweet, runaway, jesus, waymaker, oracion, discurso,
  quien, puedo, chiste1..5, risa1, risa2, mmm2, uy2, aqui, listo, yaya, gracias, hola, despertar, bienvenida, triste, cansado,
  carino, molesto, orgullo, sorpresa`. Antes de sonar se comprueba con `HEAD` que el servidor devuelve audio (los que aún no
  existen devuelven la SPA con 200); si no, se cae a TTS con el texto del clip o no se dice nada (muletillas).
- `PHRASE_TO_CLIP`: frase exacta → clip, para que `speak()` no pague TTS por una frase grabada (saludos de José, «Entendido.»…).

El generado nunca hace `require()` de un archivo que no exista: si una descarga falla el clip queda solo remoto y `tsc`
sigue pasando. Si cambias una frase fija, edita `CLIPS` en el script y vuelve a correrlo.

## Órdenes locales vs. cerebro

`src/lib/intenciones.ts` es la única tabla de órdenes (anclas `^…$`, `\b`, gags solo con frase corta que empieza por el
verbo). Todo lo que no encaja va al cerebro. `npm run check:intenciones` comprueba que «para mañana…», «experiencia»,
«encantado», «quiero saber más del oro», «dame opciones», «la visión de la empresa», «ahora», etc. van al cerebro y que
las órdenes reales (`canta 1`, `ríete`, `modo gold`, `luego` en la entrevista…) siguen funcionando.

La entrevista «Conocer» es **opcional**: solo arranca desde el menú o con «quiero conocerte» / «modo conocer», y se sale con
«luego», «salir», «ya».

## Arranque, cara y tacto

- **Splash**: nativo (logo, `expo-splash-screen`, fade) → splash JS ~1,8 s (marca «ULTRON FP», «powered by ORDEN GLOBAL»,
  cara compacta despertando) → fundido sobre login/escritorio, sin cortes.
- **Cara** (`UltronFace.tsx`, solo RN `Animated`): IDLE, LISTENING, THINKING, SPEAKING, HAPPY, WINK, CONCERNED, ANGRY,
  SLEEPING, STARTLE, CONFUSED, SCAN, YAWNING + **LAUGH, SURPRISED, SAD, TIRED, SING, CURIOUS, PROUD**.
- **Tacto**: ojo → guiño de ese ojo · frente → curioso · barbilla → risa · mejilla (frotar) → ronroneo · toques seguidos →
  «ya, ya» (molesto 1,2 s y risa) · mantener → duerme/despierta · arrastrar → los ojos siguen el dedo · borde derecho →
  menú. Vibración ligera (`expo-haptics`).
- **Pensando**: cara THINKING y un solo «mmm» del banco (local) si el cerebro tarda > 0,7 s. Sin rellenos de red.
- **Cantar**: `/api/cantar`, cara SING, mic pausado, sin rellenos. Géneros con letra propia (`GENEROS`) también se cantan.
- **Orar**: «ora», «oración», «hacé una oración», «orá por el día», «bendice el día», «reza», «oremos», «ora por <tema>» →
  `/api/orar`, cara **PRAY** (ojos cerrados suaves, cejas relajadas, sonrisa mínima, respiración muy lenta, la boca sigue
  el audio; los ojos se abren despacio al terminar), mic pausado, HUD «orando». Botón «Orar por el día» en el menú.
- **Lip-sync** (`src/lib/lipsync.ts`): expo-av no expone metering en reproducción (ni Android ni iOS; `metering` solo
  existe al grabar), así que la boca se mueve con una envolvente sincronizada a `positionMillis` (estado cada 50 ms,
  interpolado a 20 Hz en JS): con texto conocido (frases TTS, clips del banco) sílabas reales repartidas sobre la duración
  real, con pausas en la puntuación; sin texto o si el ritmo no cuadra (canciones, oración, clips largos) pulsos
  deterministas con silencios (≈ 3,2–4,5/s). `tts.ts` emite el nivel (`setSpeechLevelListener`), `DeskScreen` lo pasa como
  `speechLevel` y `UltronFace` abre la boca en SPEAKING/SING/LAUGH/PRAY; si no llega nivel en 0,7 s hay un bucle de respaldo.

## Menú (deslizar desde el borde derecho)

Escuchar/Ver, **Qué puede hacer ULTRON** (catálogo agrupado con punto verde/gris por `vivo`, ejemplos que se mandan como
orden al tocarlos, nombre de la voz y «Probar voz»), presencia, modo, acciones, búsqueda, cantar (repertorio + géneros),
recordar, escribir una orden, ajustes (oído, comentarios de cámara, SFX, memoria), cerrar sesión.

## Estructura

- `App.tsx` — splash nativo → splash JS → login (vertical) → escritorio (horizontal); permisos.
- `src/screens/LoginScreen.tsx` — huella, clave remota; «Entrar solo al escritorio» funciona sin servidor (modo local).
- `src/screens/DeskScreen.tsx` — orquesta órdenes, voz, emoción, tacto, sacudida, visión, menú.
- `src/components/UltronFace.tsx` · `DeskMenu.tsx` · `GazeCamera.tsx`.
- `src/lib/api.ts` (cliente + renovación de sesión) · `tts.ts` (banco → clips → TTS → canto) · `emocion.ts` ·
  `intenciones.ts` · `capacidades.ts` · `knowledge.ts` · `speech.ts` (+ `speechNative.ts`, `speechCloud.ts`) · `storage.ts` · `sfx.ts`.
- `scripts/build-voice-bank.mjs` · `scripts/check-intenciones.mjs` · `scripts/make-assets.py` (icono, adaptive icon, splash
  con Pillow a partir de `assets/logo-source.png`).

## Desarrollo

```bash
npm ci
npm run typecheck
npm run check:intenciones
npm run voice-bank            # solo si cambian los clips
npx expo config --type prebuild > /dev/null   # valida app.json
npx expo prebuild -p android --no-install && cd android && ./gradlew assembleRelease
```
