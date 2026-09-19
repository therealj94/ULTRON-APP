# 04 — Cerebro (cliente)

- `turno.ts`: `pedirTurnoStream()` consume `POST /api/turno/stream` (eventos `tools`, `emocion`, `delta`, `replace`, `done`) y cae a `pedirTurno()` si no hay SSE.
- `intenciones.ts`: tabla única de lo que se resuelve sin cerebro (callar, cantar, chiste, quién sos, emociones, modos, dormir, foto, recordar, Genesis). Límites de palabra y frases cortas: lo demás va al 27B.
- `grabFrame.ts`: frame de la cámara para «qué ves».

El LLM sigue en el nodo Qwen (`ULTRON_NODO_URL`). La personalidad vive en `server/desk.ts`; la emoción en `lib/emocion.ts`.
