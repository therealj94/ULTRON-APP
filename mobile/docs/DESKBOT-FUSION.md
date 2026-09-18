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
