# 03 — Voz (web)

Una voz, un camino: `hablar()` en `hablar.ts`.

1. **Clip grabado** (`banco.ts`, `public/voz/*.mp3`): 0 ms, sin red. Saludos, reacciones táctiles, risas, canciones.
2. **`POST /api/tts`** con `emocion`: el servidor pone las etiquetas de audio de ElevenLabs v3.
3. **Voz del navegador**: último recurso; avisa en consola.

`cantar()` → clip del repertorio o `POST /api/cantar` (letra libre).
`useOido.ts` → oído continuo (Web Speech) con barge-in: cuando el jefe habla, ULTRON hace fade y calla.
`player.ts` → reproducción con analizador para el lip-sync (`onLip`).

Para grabar clips nuevos: `ELEVENLABS_API_KEY=… node scripts/grabar-banco.mjs <id>` y añadirlos a `BANCO`.
No hay selector de voces: la voz oficial se define en `server/voz.ts` (`ELEVENLABS_VOZ`).
