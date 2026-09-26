# Una voz

AU-RA habla con **Voicebox** (motor Kokoro), en el servidor propio de AU-RA (`VOICEBOX_URL`,
llave en `VOICEBOX_CLAVE`, cabecera `X-Voz-Clave`).

- AU-RA: perfil «AU-RA · Kokoro Dora» (`VOICEBOX_PERFIL_AURA`).
- Dr Electrum: perfil «Electrum · Kokoro Alex» (`VOICEBOX_PERFIL_ELECTRUM`).
- Oído: Whisper `turbo` en el mismo servidor (`POST /transcribe`).

No hay voz de respaldo: si Voicebox no contesta, AU-RA calla y el texto queda en pantalla.
