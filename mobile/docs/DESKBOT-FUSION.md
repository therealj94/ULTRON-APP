# DeskBot (RON) → ULTRON FP — decisiones de fusión

Repo investigado: https://github.com/well-it-wasnt-me/RON (DeskBot)

## Qué es DeskBot
Robot de escritorio **Python 3.12 + Raspberry Pi**: cara en TFT GC9A01, servos, Whisper/Piper,
openWakeWord, bus de eventos asyncio, LLM OpenAI/Ollama. Hardware detrás de protocols
(`Display`, `Microphone`, `LLM`, `EventBus`).

## Qué tomamos (adaptado a React Native)
| Idea DeskBot / LOOI | Cómo quedó en ULTRON FP |
|---|---|
| **Diseño de cara**: dos ojos-anillo luminosos sobre negro, párpados para emociones, boca en arco | `UltronFace.tsx`: anillos cian, párpados superior/inferior, cejas (con asimetría para «curioso»), boca arco/abierta, glifos por modo. Solo RN `Animated` (sin Skia/Reanimated). |
| **VAD de energía** (`EnergyActivityDetector`) | `speechCloud.ts`: umbral adaptativo, cierre de frase por silencio → 1 STT por frase. Es el respaldo; por defecto se usa el reconocedor nativo del teléfono (`speechNative.ts`). |
| **Interacción táctil** (toques en la cara) | Zonas reales (ojo, frente, mejilla, boca, barbilla), arrastre = mirada, frotar = ronroneo, toques seguidos = «ya, ya», mantener = dormir/despertar. |
| Sin wake word obligatoria | No hay «hey ULTRON». Saluda al abrir y conversa de continuo; en Sleep despierta al hablarle o tocarlo. |

## Qué NO reutilizamos
| Idea DeskBot | Por qué no |
|---|---|
| Face engine Python → SPI TFT | No aplica a RN; se adaptó el *diseño*, no el código. |
| `InMemoryEventBus` + orquestación asyncio | Flujo RN ya es reactivo (callbacks/hooks). |
| Whisper + Piper on-device | Módulos ASR nativos fallaron en EAS; STT nativo de Android o Scribe en servidor. |
| openWakeWord / Porcupine | Dependencias ONNX nativas; además se pidió quitar la wake word. |
| Ollama / OpenAI | Regla: no tocar el nodo Qwen 27B. |

## Historial corto
- **3.0 (2026-09-18)** — la app pasó de WebView a nativa: `/api/turno`, `/api/tts`, `/api/stt`, `/api/vision/analyze`;
  watchdog de mic con reinicio duro; cámara con frame bajo demanda y comentario proactivo; sacudida.
- **3.1** — landscape desde el manifest; oído nativo; `/api/turno/stream` + `StreamSpeaker` (habla la primera oración
  mientras Qwen escribe); memoria de largo plazo local + servidor; zonas de toque.

## 4.0 — auditoría y qué se cambió

| Hallazgo | Decisión |
| --- | --- |
| `VOICE_BANK = {}`: el «banco offline» no existía; todo tocaba la red. | Banco real: `scripts/build-voice-bank.mjs` baja los clips cortos de `/voz/` a `assets/voice` (10 clips, 464 KB) y genera `voiceBank.ts` con `VOICE_BANK` (require) + `REMOTE_CLIPS` + `CLIP_TEXT` + `PHRASE_TO_CLIP`. Nunca referencia un asset que no exista. |
| Regex sin anclas secuestraban frases («para mañana…» callaba, «experiencia» reía, «encantado» cantaba, «dame opciones» abría el menú…). | Una tabla priorizada en `intenciones.ts` con `^…$`/`\b`, gags solo con < 6 palabras y verbo al inicio. `check-intenciones.mjs` lo verifica (71 casos). |
| Clips remotos sin `onStart/onEnd`: el mic seguía abierto y ULTRON se transcribía a sí mismo durante 30–60 s de canción. | Todo audio pasa por `playSource()` con `onAudioStart/onEnd`; `speakClip`, `speakUrl`, `speakSong` pausan el mic y `settle()` lo devuelve. |
| Todos los «canta <género>» iban al mismo clip; `SONGS/detectGenre` muertos. | `POST /api/cantar`: ids del repertorio o letra propia por género (`GENEROS`). Cara SING, sin rellenos. |
| «Entrar solo al escritorio» siempre fallaba. | Entra en modo local si el servidor no responde o si el miembro ya se validó en el teléfono; la sesión se renueva sola al volver la red. |
| Selector «ElevenLabs Flash / Qwen3-TTS / Auto» era un placebo. | Retirado. Una voz: *ULTRON (Gabriela · ElevenLabs v3)*, con botón «Probar voz». |
| Dos rellenos competían (`tools` vs. ack a 1,8 s). | Un solo «mmm» local del banco si el cerebro tarda > 0,7 s; el evento SSE `emocion` lo cancela y mueve la cara antes del audio. |
| `rememberFact` sin `usuario`; `/api/memoria` exige sesión. | Manda `usuario` por `api()` (renueva token en 401). |
| `micMuted` en closures viejos. | `micMutedRef` + `settle()/idleStatus()`. |
| OTA sin canal; llamadas a `expo-navigation-bar` que solo avisaban. | `expo-updates` fuera (paquete y config); solo `setVisibilityAsync('hidden')`. |
| Entrevista CONOCER arrancaba sola en cada arranque, sin salida. | Opcional (menú / «quiero conocerte»); sale con «luego», «salir», «ya». |
| Código muerto (voiceActs `who`, `SONG_HINT`, FAQ inalcanzable, `getTtsEngine/lastTtsEngine/isSpeaking`, `loadChatLog`, estilo `logo`, `ultron-logo.jpg`, `eas-cli`, dos generadores de mirada errante). | Eliminado. Un solo generador de mirada en `DeskScreen` (se pausa con dedo, toque o persona en cámara). |
| Versiones 3.1.0/31 vs 3.0.0. | 4.0.0 / versionCode 40 en ambos. |

**4.0.1**: emoción `oracion` → cara `PRAY`; `POST /api/orar` («Orar por el día» en el menú, HUD «orando»);
Way Maker (`waymaker`) en el repertorio; lip-sync real por envolvente silábica sincronizada a `positionMillis`
(`lipsync.ts`; expo-av no da metering al reproducir) para TTS, clips, canciones y oración; el catálogo pinta grupos nuevos.

**Nuevo en 4.0**: splash nativo → splash JS con marca y cara despertando → fundido; catálogo «Qué puede hacer ULTRON»
(`/api/capacidades`, caché offline, ejemplos tocables); caras LAUGH, SURPRISED, SAD, TIRED, SING, CURIOUS, PROUD;
emoción del servidor → cara → `/api/tts?emocion=`; `expo-haptics` en toques; iconos y splash regenerados con Pillow
(`scripts/make-assets.py`).

## Latencias de referencia (servidor local con env de producción, 3.x)
STT nativo ~0,3 s tras callar · primer delta de Qwen ~0,6 s · TTS 0,3 s en caché / 1,3 s primera vez · clips del banco 0 ms.
