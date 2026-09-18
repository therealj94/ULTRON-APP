# ULTRON-APP por áreas

Código de producto bajo `src/01-…`–`src/10-…`. El servidor (`server.ts`) sigue en la raíz hasta el paso de `08-servicios`.

| # | Área | Qué vive ahí | Estado |
|---|---|---|---|
| 01 | diseño | tokens, tipografía, color negro+#05E1FF | tokens.ts creado |
| 02 | cara | gestos, FaceCanvas | `gestos.ts` movido |
| 03 | voz | player, elevenlabs, barge-in | pendiente |
| 04 | cerebro | turno, harness, personalidad | pendiente |
| 05 | cerebro-og | bóveda, cadena 5550, skills OG | pendiente |
| 06 | manos | tools (playwright, gold, foto) | pendiente |
| 07 | pantallas | modales extraídos de App.tsx | pendiente |
| 08 | servicios | server.ts, desk.ts, /api | pendiente |
| 09 | estado | session, memoria | pendiente |
| 10 | infra | .env loader, secretos, actions | pendiente |

Regla: un archivo por commit de movimiento. No tocar el nodo Qwen `34.207.148.69:8443`.
