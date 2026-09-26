# 03 — Voz (web)

Una voz, un camino: `hablar()` en `hablar.ts`.

1. **Clip grabado** (`banco.ts`, `public/voz/*.mp3`): 0 ms, sin red. Saludos, reacciones táctiles, risas, canciones.
2. **`POST /api/tts`** con `emocion`: el servidor habla con Voicebox (perfil «AU-RA · Kokoro Dora») y devuelve WAV.
3. **Silencio** si el servidor no da voz: el texto queda en la burbuja. No hay voz del navegador de respaldo.

`cantar()` → clip del repertorio o `POST /api/cantar` (una letra libre se dice: Kokoro no canta).
`useOido.ts` → oído continuo (Web Speech) con barge-in: cuando el jefe habla, AU-RA hace fade y calla.
`player.ts` → reproducción con analizador para el lip-sync (`onLip`).

Para regrabar los clips hablados con la voz de Voicebox:
`VOICEBOX_URL=… VOICEBOX_CLAVE=… npx tsx scripts/grabar-banco.ts [ids…] [--force]` (las canciones no se tocan).
No hay selector de voces: el perfil se define en `server/voz.ts` (`VOICEBOX_PERFIL_AURA`).
