# Una voz

AU-RA habla con **Voicebox** (motor Kokoro), en el servidor propio de AU-RA (`VOICEBOX_URL`,
llave en `VOICEBOX_CLAVE`, cabecera `X-Voz-Clave`).

- AU-RA: perfil «AU-RA · Kokoro Dora» (`VOICEBOX_PERFIL_AURA`).
- Dr Electrum: perfil «Electrum · Kokoro Alex» (`VOICEBOX_PERFIL_ELECTRUM`).
- Oído: Whisper `turbo` en el mismo servidor (`POST /transcribe`).

No hay voz de respaldo: si Voicebox no contesta, AU-RA calla y el texto queda en pantalla.

Expresiones (solo AU-RA): el cerebro escribe `[risa]`, `[suspiro]`, `[mmm]`… (lista en
`lib/expresiones.ts`). El servidor devuelve `reply` para leer (sin ellas) y `voz` para decir (con
ellas); `/api/tts` parte el texto, dice los trozos con Voicebox y pega la toma grabada con la voz de
Dora (`server/empalme.ts`, WAV en `server/expresiones/`). En Dr Electrum se quitan sin sonar.
