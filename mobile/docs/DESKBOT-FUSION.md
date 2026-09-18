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
