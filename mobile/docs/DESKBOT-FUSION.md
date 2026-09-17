# DeskBot (RON) → ULTRON FP — decisiones de fusión

Repo investigado: https://github.com/well-it-wasnt-me/RON (DeskBot)

## Qué es DeskBot
Robot de escritorio **Python 3.12 + Raspberry Pi**: cara en TFT GC9A01, servos, Whisper/Piper,
openWakeWord, bus de eventos asyncio, LLM OpenAI/Ollama. Hardware detrás de protocols
(`Display`, `Microphone`, `LLM`, `EventBus`).

## Qué NO reutilizamos (rompería / cambiaría demasiado)
| Idea DeskBot | Por qué no |
|---|---|
| Reemplazar FaceCanvas / UltronFace por Face engine de DeskBot | Renderer Python→SPI TFT; no es React Native ni Canvas web. Reescritura total. |
| Portar `InMemoryEventBus` + orquestación completa | App nativa ya tiene flujo desk; un bus Python no aplica. |
| Whisper+Piper on-device | Stack Pi; en Android EAS ya fallaron módulos ASR nativos. |
| openWakeWord / Porcupine | Dependencias nativas/ONNX; riesgo de build EAS y cambio de arquitectura. |
| Sustituir Qwen AWS por Ollama/OpenAI | Regla explícita: no tocar nodo Qwen 27B. |

## Qué SÍ tomamos (mejora incremental)
1. **VAD de energía antes de STT** (idea de `EnergyActivityDetector` de DeskBot):
   no enviar chunks silenciosos a `/api/stt/transcribe` → menos lag, menos costo, mic más fluido.
2. Mantener estética negro+cian y backend Express + Qwen.

## Estado
- Fusión completa DeskBot como base: **rechazada**.
- Mejora VAD en mic siempre-on: **aplicada** en `mobile/src/lib/speech.ts`.
