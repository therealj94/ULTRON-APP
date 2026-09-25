# AU-RA FP · app nativa Android (4.0)

Cara a pantalla completa, escucha continua sin palabra clave, **una sola voz** — *AU-RA (Gabriela · ElevenLabs v3)* —,
cámara que identifica lo que hay en la mesa y cerebro Qwen 27B vía el backend de Render. Producto para la junta de
Orden Global (paleta negro + cian `#05E1FF`, UI en español).

## Cómo se construye

GitHub Actions (`.github/workflows/android-apk.yml`) hace `npm ci` → `npm run typecheck` → `expo prebuild` →
`gradlew assembleRelease` (arm64-v8a + armeabi-v7a, Hermes, JS empaquetado) y publica el artefacto `AU-RA-FP-apk`
(`out/AU-RA-FP-<versión>.apk`). Se dispara con cada push a `main` o `cursor/**` que toque `mobile/`, `src/`, `server*`,
o a mano con *Run workflow*. No hay OTA (`expo-updates` se retiró): cada cambio es un APK nuevo.

Instalación: el APK va firmado con la keystore debug del template; si había una versión anterior firmada distinto,
desinstálala primero. Versión: `app.json` `expo.version` = `package.json` `version` (4.0.0), `android.versionCode` 40.

## Backend que usa (`extra.ultronUrl` en `app.json`)

| Ruta | Uso en la app |
| --- | --- |
| `POST /api/turno` | Un turno con el cerebro. Manda `usuario`, `correo`, `historial`, `memoria[]`, `image` opcional y `escena` (string: lo que la cámara local ya interpretó; el servidor lo usa como hecho «ESCENA (cámara local): …» cuando preguntan qué ve o quién está). Responde `reply`, `emocion`, `mode`. |
| `POST /api/turno/stream` | Igual, por SSE (XHR). Eventos: `emocion` (antes del primer delta → la cara reacciona antes que la voz), `delta`, `tools`, `done` (trae `emocion`), `error`. |
| `GET/POST /api/tts` | Voz. `text`, `emocion`, `performance=speak\|sing`. Devuelve `audio/mpeg` + cabecera `X-Ultron-TTS`. Sin parámetro `engine`: una sola voz. |
| `POST /api/cantar` | `{ id }` (jesus, bohemian, ligera, bittersweet, runaway, bruno, waymaker) o `{ letra, titulo? }` → mp3 de AU-RA cantando (hasta ~40 s la primera vez). `GET` devuelve el repertorio. |
| `POST /api/orar` | `{}` o `{ tema }` → mp3 de la oración del día (~3 min, cacheado). Sin tema se usa el estático `/voz/oracion.mp3` si existe. Cara PRAY, HUD «orando». |
| `GET /api/capacidades` | Catálogo real (`Capacidad[]` agrupadas, `vivo` según salud de nodos, voz oficial, canciones, gestos). Se cachea en AsyncStorage para verlo sin red. |
| `POST /api/stt` | Oído en la nube (ElevenLabs Scribe), solo si se elige «Nube» en Ajustes; por defecto el reconocimiento es el del teléfono. |
| `POST /api/vision/analyze` | Nodo de visión: frames bajo demanda («qué ves») y etiquetas de la mesa (cada 60 s con alguien delante; cada 12 s solo en el respaldo sin detección nativa). |
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

- **Cara de anillos (Skia, la de AU-RA desde el 25-sep)** · `src/cara/`: los anillos de siempre dibujados en la GPU
  (`@shopify/react-native-skia` 2.2.12) y movidos en el hilo de la interfaz (`react-native-reanimated` ~4.1 + `react-native-worklets`
  0.5.1, las versiones que fija Expo SDK 54). Diez estados de trabajo, no emociones (`estados.ts`): en espera, escucha,
  piensa, lee, trabaja (el anillo es barra de avance), habla (la voz mueve la boca sin pasar por React), listo (los ojos
  sonríen), te necesita (punto ámbar), sin red (se apaga el color) y dormida. Las 22 caras viejas caen en esos diez.
  Parpadeo al azar, sacadas, respiración y **profundidad al inclinar el teléfono** (giroscopio: cada capa del ojo se
  mueve distinto). Con «menos movimiento» del sistema solo queda el parpadeo. Mismos gestos y llamadas que `UltronFace`.
  `pintar.ts` es el dibujo: el mismo código corre en el teléfono y en `scripts/qa/cara-skia.ts` (CanvasKit en Node).
  `CaraSegura.tsx` la carga con `require` en un `try`: si Skia no carga o el dibujo lanza, vuelve `UltronFace` sola.
  En el menú, **Su cara**: Anillos (por omisión) o Habitación 3D (la sala de antes).
- **Splash**: nativo (logo, `expo-splash-screen`, fade) → splash JS ~1,8 s (marca «AU-RA FP», «powered by ORDEN GLOBAL»,
  cara compacta despertando) → fundido sobre login/escritorio, sin cortes.
- **Cara** (`UltronFace.tsx`, solo RN `Animated`): IDLE, LISTENING, THINKING, SPEAKING, HAPPY, WINK, CONCERNED, ANGRY,
  SLEEPING, STARTLE, CONFUSED, SCAN, YAWNING + **LAUGH, SURPRISED, SAD, TIRED, SING, CURIOUS, PROUD**.
- **Boca** (4.1): protagonista secundaria, cuatro capas solo con transforms/opacity: arco (curva, ancho, inclinación),
  interior oscuro con borde (apertura, redondez, mandíbula que baja), labio apretado y dientes. Formas por emoción:
  sonrisa amplia (HAPPY), «o» de sorpresa (SURPRISED/STARTLE), mueca ladeada (SAD), risa abierta con interior oscuro y
  dientes (LAUGH), labio apretado (ANGRY), boca pequeña serena (PRAY), bostezo (YAWNING), labios de lado (THINKING).
  Al hablar, visemas por `speechLevel`: cerrada (< 0,12), media ancha (< 0,55), abierta redonda; ataque 35 ms, cierre
  90 ms, y la mandíbula baja con la apertura.
- **Tacto**: la cara reacciona sola en el mismo frame del contacto (Animated, sin `setState`): squash del ojo tocado,
  pupilas que saltan al punto, «oh» en la barbilla, sonrisa en la mejilla, cejas arriba en la frente, onda fina en el
  punto tocado y squash leve general. Al arrastrar, los ojos siguen el dedo con retardo elástico y vuelven al centro al
  soltar. Después el padre decide: ojo → guiño de ese ojo · frente → curioso · barbilla → risa · mejilla (frotar) →
  ronroneo · toques seguidos → «ya, ya» (molesto 1,2 s y risa) · mantener → duerme/despierta · borde derecho → menú.
  Vibración ligera (`expo-haptics`).
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

## Cámara y visión (4.1)

AU-RA ve de verdad a la persona **en el teléfono**, sin mandar video a ningún lado:

```
react-native-vision-camera (frontal, 640×480, yuv, sin preview)
   │  frame processor (worklet) · runAtTargetFps(10) · runAsync
   ▼
ML Kit Face Detection ('fast', landmarkMode none, classificationMode all → sonrisa y ojos abiertos)
   │  caras + tamaño/orientación del cuadro → JS (Worklets.createRunOnJS)
   ▼
observacionMlkit() ─► MaquinaEscena (histéresis) ─► Escena ─► onEscena (≤ 1 cada 500 ms, inmediata con eventos)
                                                    └─► mirada EMA ─► onGaze (DeskScreen la aplica ≤ 4 veces/s)
```

- **Componente**: `src/components/CamaraVision.tsx` (sustituye a `GazeCamera`). Props: `enabled`, `dormido`, `grabRef`
  (`takePhoto` bajo demanda → base64 jpeg para «qué ves»), `onEscena`, `onGaze(x, y, activa)`, `onObjects`, `onScene`,
  `onMotor`. Pide el permiso una vez (el mismo `CAMERA` que ya pedía la app).
- **Contrato** (`src/lib/escena.ts`, igual que la web): `Escena { personas, principal: { x, y, tam, mirando, sonrisa,
  sorpresa, ojosCerrados, bocaAbierta, cabeza } | null, eventos[], descripcion, motor: 'mlkit'|'servidor'|'ninguno', ts }`.
  Eventos con histéresis: `llego` (0,6 s de cara), `se_fue` (2 s sin cara), `sonrie`/`deja_de_sonreir` (0,55/0,3),
  `dos_personas` (≥ 2 estable 1 s), `mira`/`aparta_mirada` (|yaw| < 20°, |pitch| < 15°; sale a 28°/22°), `cerca`/`lejos`
  (`tam` 0,45/0,38 y 0,12/0,16). **x va espejado**: x positivo = la persona está hacia la derecha de la pantalla vista de
  frente, que es hacia donde se desplazan las pupilas con `translateX` positivo. **yaw/pitch son relativos a la
  cámara**: `observacionMlkit` descuenta el ángulo con que la cámara ve ese punto del cuadro (`anguloEsperado`, con el
  `fieldOfView` del formato; diagonal en Android), así quien mira la pantalla desde un borde de la mesa cuenta como
  `mira` (con el yaw absoluto |≈22°| nunca disparaba). La **frase va en primera persona** (AU-RA habla): x>0 →
  «a mi izquierda», x<0 → «a mi derecha», «frente a mí» — igual que la web, para no sugerirle al único presente que hay
  alguien a SU lado. ML Kit no da sorpresa ni boca abierta sin landmarks: quedan en 0. `npm run check:escena` prueba
  todo esto sin cámara (espejado, ángulo esperado, histéresis, frases).
- **Orientación**: VisionCamera no asigna `targetRotation` al `ImageAnalysis` del frame processor, así que ML Kit
  endereza el cuadro respecto a la rotación de pantalla que había al crear la cámara. Si la pantalla gira después
  (180° dentro del lock LANDSCAPE, o el lock aterriza tras montar), `CamaraVision` lo detecta
  (`onPreviewOrientationChanged` + `expo-screen-orientation`) y remonta `<Camera>` (`key`) para que la referencia sea la
  actual; sin eso las pupilas mirarían al lado contrario.
- **Eventos**: `llego`, `se_fue`, `sonrie`, `deja_de_sonreir`, `dos_personas`, `mira`, `aparta_mirada`, `cerca`,
  `lejos`. **No existe `saluda`**: en la web lo medía el tracker óptico (movimiento lateral alto y repetido) y ML Kit
  en modo `fast`, sin landmarks ni contornos, no da nada con qué detectarlo. `dos_personas` tiene histéresis de
  entrada (1 s) y de **salida** (`dosPersonasOffMs` 1,5 s: una segunda cara que parpadea en el borde no repite el
  evento). Un cuadro perdido no vacía `principal`: se congela la última cara hasta `seFueMs` (2 s), así la frase no
  dice «No veo a nadie ahora.» con `personas: 1`. Y el rato con la cámara apagada (cara dormida) cuenta como
  DESCONOCIDO, no como ausencia (`huecoMuestreoMs`): las marcas de tiempo se corren por la duración del hueco.
- **Reacciones** (`DeskScreen`): los ojos siguen a la persona; con alguien mirando la cara se ilumina un poco
  (`attention`); `llego` tras > 60 s sin interacción → saludo con clip local (`hola`/`aqui`) y cara HAPPY (si dormía,
  despierta); `sonrie` → sonrisa breve; `dos_personas` → CURIOUS + «¿y quién te acompaña?» una vez por sesión; `se_fue`
  → nada inmediato. La `descripcion` viaja en cada turno como `escena`; «qué ves» sin frame responde con ella.
- **Batería**: detector pausado en background (`isActive=false`); con la cara en SLEEPING la cámara **solo se enciende
  2,5 s cada 12 s** (`isActive` alternado: sensor e ISP apagados el resto; dentro de la ventana ML Kit a 2 fps y
  `procesar(obs, { inmediato: true })`, así una cara en un cuadro ya cuenta como llegada). Coste real: ≈ 20 % de la
  cámara encendida más un arranque de sesión por ciclo. Nada de `setState` a alta frecuencia: mirada, atención y
  escena por refs con umbral, y el lip-sync entra a la cara por `speechLevelSource` (suscripción → Animated, cero
  renders; los nodos derivados de la cara van en un `useMemo`).
- **Respaldo** (`motor: 'servidor'`): si vision-camera no está en el APK, el plugin no carga, no hay cámara frontal,
  el frame processor no entrega cuadros en 9 s o la cámara falla (`permission|device|system|session|frame-processor|unknown`),
  se cae solo al modo anterior (expo-camera 1×1 px, una foto cada 12 s a `/api/vision/analyze`, 30 s si duerme). Los
  errores `session/*` (cámara ocupada por otra app) **también** caen al respaldo: con la cara dormida el watchdog está
  desarmado, así que esperar a que CameraX reabra dejaría la app ciega sin aviso. Los demás códigos (`capture/*`,
  `format/*`, `parameter/*`) solo se loguean y rearman el watchdog. `DETECCION_NATIVA=false` en `CamaraVision.tsx` fuerza el respaldo
  **en runtime**, pero NO evita compilar lo nativo (entra por autolinking): si Gradle fallara por vision-camera, la
  contingencia real es quitar las tres dependencias de `package.json`, el plugin de `app.json` y el plugin de
  `babel.config.js`. Sin permiso se emite una sola vez `{ motor: 'ninguno', descripcion: 'La cámara está apagada.' }`.
  El campo `escena` del turno acepta la última escena según la cadencia real del motor y del modo
  (`escenaFresca` importa las constantes de `CamaraVision`): ML Kit despierto < 12 s, ML Kit dormido < 24 s
  (2× `DORMIDO_PERIODO_MS`), servidor < 30 s despierto y < 75 s dormido (2,5× su cadencia).
- **Nativo**: `react-native-vision-camera 4.7.3` (última 4.x; la 5.x exige Nitro Modules) + `react-native-vision-camera-face-detector
  1.10.2` (última 1.x, peer `vision-camera >= 4`) + `react-native-worklets-core 1.6.3`. Plugin en `app.json`
  (`cameraPermissionText` en español, `enableFrameProcessors: true`) y `react-native-worklets-core/plugin` en
  `babel.config.js`. En devDependencies: `@expo/config-plugins 54.0.5` (Expo 54 ya no lo deja hoisted y el plugin de
  vision-camera lo requiere) y los tres plugins de Babel 7 que el plugin de worklets-core carga por nombre y Expo 54 ya
  no trae (`@babel/plugin-proposal-optional-chaining`, `@babel/plugin-proposal-nullish-coalescing-operator`,
  `@babel/plugin-transform-template-literals`); sin ellos `expo export`/Metro falla en `CamaraVision.tsx`. El modelo
  de ML Kit va empaquetado (≈ 16 MB más de APK). Verificado: `tsc`, `expo config`, `expo export -p android` (bundle
  Hermes OK) y `expo prebuild -p android --clean` (manifest con `CAMERA`, `VisionCamera_enableFrameProcessors=true`,
  autolinking con los tres módulos); falta compilar con Gradle en CI.

## Menú (deslizar desde el borde derecho)

Escuchar/Ver, **Qué puede hacer AU-RA** (catálogo agrupado con punto verde/gris por `vivo`, ejemplos que se mandan como
orden al tocarlos, nombre de la voz y «Probar voz»), presencia, modo, acciones, búsqueda, cantar (repertorio + géneros),
recordar, escribir una orden, ajustes (oído, comentarios de cámara, SFX, memoria), cerrar sesión.

## Estructura

- `App.tsx` — splash nativo → splash JS → login (vertical) → escritorio (horizontal); permisos.
- `src/screens/LoginScreen.tsx` — huella, clave remota; «Entrar solo al escritorio» funciona sin servidor (modo local).
- `src/screens/DeskScreen.tsx` — orquesta órdenes, voz, emoción, tacto, sacudida, visión, menú.
- `src/cara/` — la cara de anillos en Skia: `estados.ts` (puro, probado en `tests/cara-skia.test.ts`), `pintar.ts`,
  `CaraSkia.tsx`, `CaraSegura.tsx`.
- `src/components/UltronFace.tsx` · `DeskMenu.tsx` · `CamaraVision.tsx` (detección facial nativa + respaldo servidor).
- `src/lib/api.ts` (cliente + renovación de sesión) · `tts.ts` (banco → clips → TTS → canto) · `emocion.ts` · `escena.ts`
  (contrato de visión, puro) · `intenciones.ts` · `capacidades.ts` · `knowledge.ts` · `speech.ts` (+ `speechNative.ts`,
  `speechCloud.ts`) · `storage.ts` · `sfx.ts` · `lipsync.ts`.
- `scripts/build-voice-bank.mjs` · `scripts/check-intenciones.mjs` · `scripts/check-escena.mjs` · `scripts/make-assets.py`
  (icono, adaptive icon, splash con Pillow a partir de `assets/logo-source.png`).

## Desarrollo

```bash
npm ci
npm run typecheck
# la cara de anillos pintada con Skia de verdad (CanvasKit), con comprobación de píxeles; desde la raíz:
#   npx tsx scripts/qa/cara-skia.ts [dirSalida]
npm run check:intenciones
npm run check:escena          # contrato de visión (espejado, histéresis, frases)
npm run voice-bank            # solo si cambian los clips
npx expo config --type prebuild > /dev/null   # valida app.json
npx expo prebuild -p android --no-install && cd android && ./gradlew assembleRelease
```
