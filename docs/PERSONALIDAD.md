# Personalidad humana ULTRON FP

## Hallazgos
- Cara: `FaceCanvas` ya tiene ~18 `FaceState` (no hace falta reescribir corona/ojos).
- Memoria: JSON en disco (`personMemory`), no MongoDB.
- TTS/números/expresiones verbales: ya existían; se reutilizan.
- Cerebro Orden Global: `/api/orden-global` + tool `query_global_order_brain`.

## Decisiones
1. **emociones → FaceState** vía `faceEmotionMap.ts` (reuso de animaciones).
2. **Caché** = `Map` en memoria (`responseCache.ts`), no Redis (Render starter).
3. **Pausas** en cliente (`vocalize` + `pauseMs` del backend).
4. **Voz emocional**: `instructAddon` a Qwen3-TTS; pitch/rate en Web Speech fallback.

## Archivos
| Archivo | Rol |
|---------|-----|
| `src/server/tts/personalidad.ts` | Rasgos + system block |
| `src/server/tts/emociones.ts` | Niveles, decaimiento, contagio, humanizeReply |
| `src/utils/faceEmotionMap.ts` | Emoción → cara |
| `src/server/tts/responseCache.ts` | Caché personalidad/TTS |
| `GET /api/emociones` | Snapshot emocional |
| `POST /api/emociones/pulse` | Boost manual |
