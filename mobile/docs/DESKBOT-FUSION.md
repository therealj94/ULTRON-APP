# DeskBot (RON) → ULTRON FP — decisiones de fusión

Repo investigado: https://github.com/well-it-wasnt-me/RON (DeskBot)

## Qué es DeskBot
Robot de escritorio **Python 3.12 + Raspberry Pi**: cara en TFT GC9A01, servos, Whisper/Piper,
openWakeWord, bus de eventos asyncio, LLM OpenAI/Ollama. Hardware detrás de protocols
(`Display`, `Microphone`, `LLM`, `EventBus`).

## Qué tomamos (adaptado a React Native)
| Idea DeskBot / LOOI | Cómo quedó en ULTRON FP |
|---|---|
| **Diseño de cara**: dos ojos-anillo luminosos sobre negro, párpados para emociones, boca en arco | `UltronFace.tsx` reescrito: anillos cian, párpados superior/inferior animados (enojo, sonrisa, sueño), cejas, boca arco/abierta al hablar, glifos por modo (Mining ⚙⛏, Gold ✦, Creative ✎, Analytical ♛⌕, Strategic ♞♚, Guardian ⛨⚿, Explorer ⌖). Solo RN `Animated` (sin Skia/Reanimated: rompen EAS). |
| **VAD de energía** (`EnergyActivityDetector`) | `speech.ts`: umbral adaptativo sobre ruido de fondo, cierre de frase a 700 ms de silencio → 1 STT por frase. Antes: chunks fijos de 2.4 s que cortaban palabras. |
| **Interacción táctil** (toques en la cara) | Toque → guiño/reacción; toques repetidos → molestia → enojo + **blaster** de broma (haces rojos desde los ojos); pulsación larga → cariño. |
| Sin wake word obligatoria | Se eliminó «hey ULTRON». La app saluda al abrir y conversa de continuo. En Sleep despierta al hablarle o tocarlo. |

## Qué NO reutilizamos
| Idea DeskBot | Por qué no |
|---|---|
| Face engine Python → SPI TFT | No aplica a RN; se adaptó el *diseño*, no el código. |
| `InMemoryEventBus` + orquestación asyncio | Flujo RN ya es reactivo (callbacks/hooks). |
| Whisper + Piper on-device | Módulos ASR nativos fallaron en EAS; STT sigue en servidor (ElevenLabs Scribe). |
| openWakeWord / Porcupine | Dependencias ONNX nativas; además el usuario pidió quitar la wake word. |
| Ollama / OpenAI | Regla: no tocar el nodo Qwen 27B. |

## Latencia (medida en producción, 2026-09-18)
- Chat Qwen 27B: **2.4 s**.
- TTS Qwen3-TTS en T4: **~12 s por frase** → causa principal del "tarda mil años" y de la voz "sensual"
  (VoiceDesign *warm low pitch, slow measured pace*).
- Cambio: la app pide `engine=fast` → **ElevenLabs Flash v2.5** (~0.5 s), voz `ultron` (profesional).
  El nodo T4 sigue disponible para la web (`engine=auto`). No se tocó el nodo Qwen 27B.
- Pipeline por frases: la 1ª frase suena mientras se sintetizan las siguientes; acks («Un momento.») precargados
  si el cerebro tarda > 1.4 s.
- El mic ya no se pausa durante la síntesis, solo durante la reproducción real de audio.

## Revisión 3.0 (2026-09-18) — sobre la rama `main` nativa
Diagnóstico aplicado a la app que hoy despliega Render/GitHub Actions:
- **Backend `main` había retirado `/api/qwen/chat`, `/api/tts/synthesize`, `/api/stt/transcribe`** → la app 2.3.0
  quedó sin cerebro, sin voz y sin oído. La app 3.0 habla con `/api/turno`, `/api/tts`, `/api/stt`, `/api/vision/analyze`.
- **Servidor** (sin romper la filosofía "honesto" de `main`): `/api/stt` nuevo (Scribe, ~0.4 s); `/api/tts` con
  ElevenLabs Flash + caché LRU (~0.35 s, `X-Ultron-TTS`), canto con Multilingual v2, fallback al nodo T4;
  `/api/turno` con personalidad, nombre del miembro y hechos verificables de Orden Global (se quitaron las
  "doctrinas" inventadas también del cliente). Login normaliza `mjoseenamorado1994@gmail.com → j.ordonez@`.
- **Una sola voz** (ElevenLabs *Daniel*, id `ultron`); 45 frases fijas grabadas en `assets/voice` (0 ms, offline).
- **Micrófono**: el watchdog antes llamaba `enableAlwaysOnMic()` que retornaba sin hacer nada si el bucle
  seguía "vivo" pero colgado → ahora `restartMic()` mata el bucle por token y arranca otro.
- **Acks**: `say()` ya no corta el «Un momento» a medias; espera a que termine antes de la respuesta.
- **Saludo**: el modo Conocer ya no interrumpe el saludo (arrancaba a 1.2 s con `stopSpeaking()`).
- **Cámara**: frame fresco bajo demanda para «¿qué ves?» (va al cerebro con la imagen) y comentario
  proactivo si la escena cambia y hay calma (máx. 1 cada 2 min).
- **Sacudida** (acelerómetro, idea de `main`) → sobresalto con frase grabada.
- **Login**: la cara compacta mira los campos; sin servidor solo entra si la clave coincide con la última validada.
- **Latencia medida (servidor local con env de producción)**: STT 0.36–0.55 s · Qwen 0.8–2.2 s · TTS 0.35 s (caché 2 ms).
- **CI**: `assembleRelease` (JS empaquetado, Hermes) en vez de `assembleDebug` (que carga el bundle de Metro).

## 3.1 — diagnóstico del APK de `main` y qué se cambió

**Lo que había instalado (main, 18-sep 14:00):** `App.tsx` era un `WebView` a la mesa web. Por eso se veía vertical
(`orientation: portrait`), el mic dependía de Web Speech dentro del WebView, no había cámara nativa, ni menú, ni
reacciones táctiles, ni ajustes. Las funciones "que no funcionaban" no existían en ese binario.

**Decisiones 3.1**

| Problema | Decisión |
| --- | --- |
| Vertical | `orientation: landscape` en manifest (la mesa arranca horizontal antes del JS) + `lockAsync` con reintento; login gira a vertical. |
| Mic tarda / no oye | Oído nativo (`expo-speech-recognition`, Google SpeechRecognizer continuo, sin beep). Parciales en vivo, final ~0.3 s. El pipeline grabación+Scribe queda como respaldo y como opción en Ajustes. |
| Respuesta lenta | `POST /api/turno/stream` (SSE) + `StreamSpeaker`: habla la primera oración mientras Qwen sigue escribiendo. 83 frases fijas grabadas con la voz oficial (0 ms). |
| "De dónde sale la voz" | Ajustes → Voz: ElevenLabs Flash / nodo Qwen3-TTS local / auto. `GET /api/tts?engine=`. Mismo timbre, motor distinto, para comparar. |
| Sabe poco de Orden Global | `ORDEN_GLOBAL_HECHOS` ampliado (Genesis Core, sistemas, herramientas reales). Sin ficción. |
| Sin internet | `buscarWeb` (DuckDuckGo lite) + lectura de la primera fuente → HECHOS. Se activa con «busca / investiga / noticias de…». |
| Memoria | Largo plazo local (AsyncStorage) + servidor; la app manda `memoria[]` en cada turno. «recuerda…», «qué recuerdas», «olvida todo». |
| Toques iguales | Zonas (ojos, frente, boca), doble toque, cosquillas (5 toques rápidos), enojo acumulado → blaster, mantener → ronroneo. SFX: purr, giggle, wink, boing, whoosh. |

**Medidas (servidor local con env de producción):** `engine=eleven` 1.3 s primera vez / 0.3 s en caché; `engine=qwen`
8.7 s (WAV). Stream: primer delta de Qwen ~0.6 s. Búsqueda web + lectura + Qwen: 4.4 s.

## 3.2 — ULTRON para el jefe (tonos, gestos lentos, canto fijo)

Spec de Medardo integrada sin tocar lo que ya funcionaba (oído nativo, stream, búsqueda, memoria, ajustes).

**Voz.** Una sola (Daniel, la misma de las 70 frases grabadas), ajustada a "seca": `stability 0.62`, `style 0.05`,
`speaker_boost off`. Sin efectos. Responde en el idioma en que le hablan (`language_code` en TTS, regla en el prompt).

**Tonos (A).** Qwen abre cada respuesta con `[TONO]` (IDLE, BURLA, CANSADO, ENOJO_JUEGO, ENOJO_REAL, TRISTE, ESTRES,
EUFORIA, FOCUS). El servidor lo extrae (`extraerTono`) y lo emite como evento SSE `tono` antes del primer `delta`; la
app lo usa para cara + voz. `TONOS` en `server/desk.ts` y `TONES` en `mobile/src/config.ts` (semitonos / wpm):

| Tono | Pitch | wpm | Cómo se hace |
| --- | --- | --- | --- |
| IDLE | 0 | 150 | base |
| BURLA | −1 | 145 | pausa 0.4 s en la app antes del audio + `rate 0.944` |
| CANSADO | −2 | 125 | `rate 0.891` + `speed` ElevenLabs para el tempo |
| ENOJO_JUEGO | 0 | 140 | frase ancla en el prompt |
| ENOJO_REAL | −2 | 130 | cara ANGRY sostenida |
| TRISTE | −3 | 120 | `rate 0.841` |
| ESTRÉS | 0 | 155 | temblor sutil en la cara |
| EUFORIA | +1 | 160 | `rate 1.059` |
| FOCUS | 0 | 150 | "Hecho." |

Pitch = `rate = 2^(st/12)` en expo-av con `shouldCorrectPitch: false`; el tempo lo compensa `speed` de ElevenLabs
(`elevenSpeedFor`). Las frases grabadas son IDLE y se reproducen con la misma `rate`.

**Sonidos (B).** `tap` 130 ms click blando · `wink` tic 110 ms · `purr` 1.75 s con fade · `wake` uptone 240 ms.
`playSfx` no encima dos (ventana por duración) y `silenceSfx()` los apaga durante el canto. Se quitaron giggle/boing/whoosh.

**Gestos (C).** `UltronFace` pasó de `Pressable` a `PanResponder` y expone `onTouchStart/Move/End` con coordenadas −1..1.
El escritorio decide: 1 toque → blink 0.4 s + squash 7 Hz (`pokeSeq`) · ojo → `winkSide` 1.4–1.8 s + SMILE, sin habla ·
2 toques (<1.4 s) → wake + LISTENING · 3 → CURIOSITY 2.6 s + "Aquí estoy. ¿En qué te ayudo?" · 4 → PURR 3.2 s + purr ·
hold 0.8 s → FOCUS 3.4 s · deslizar → mirada lerp (spring lento). `holdFace()` sostiene 1.2–3.4 s. Transiciones a 420 ms.
El menú ahora solo abre desde el borde derecho. Ya no hay enojo/blaster por toques (solo por voz: «dispara», «sable»).

**Canto (D).** `mobile/src/lib/sing.ts`: cuatro ganchos con letra e idioma fijos, tomas en `assets/sing/*.mp3`
generadas con `eleven_v3` (`[singing softly, a cappella, in tune]`, 9.8–13.9 s) vía `scripts/build-sing-takes.mjs`.
Solo con «canta»: sin nombre/«la mía» → EN · «dramática»/«la larga» → EN · «ligera»/«la suave» → ES · «piano»/«la íntima» → EN.
Otra canción → «Solo tengo esos cuatro ganchos, jefe.» Sin toma → «Me falta la toma de canto, jefe.» Durante el canto la boca
sigue el nivel, sin SFX, y si el jefe habla (parcial con palabras fuera de la letra) se corta. Al terminar: SMILE 1.5 s +
frase DESPUÉS_CANTO. «Para» = silencio sin comentario. «Sigo/sigue» repite el último gancho. Qwen tiene prohibido cantar o
nombrar artistas/discos; los géneros improvisados anteriores se quitaron.

**Trato.** `tratoPara`/`tratoFor`: Medardo = «jefe» (saludo, botones de canto, «Hecho, jefe.»); José sigue siendo José.
