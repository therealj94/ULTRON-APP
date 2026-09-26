# 08 — Servicios

El servidor vive en la raíz (`server.ts`) y en `server/`:

- `server/voz.ts` — hablar (Voicebox, Kokoro), cantar, texto para la boca, caché (la única voz).
- `server/desk.ts` — identidad de la junta y personalidad.
- `lib/oido.ts` — oído: Whisper en Voicebox, Gemini de reserva.
- `server/seguridad.ts` — sesión firmada, rate limit, `urlPublica`.
- `server/habla.ts` — cifras a palabras, limpieza para la boca.
- `lib/` — memoria S3, Telegram, taller, PDF, visión, harness, ejecutor, capacidades, emoción.

Rutas: ver README raíz y `SECURITY.md`.
