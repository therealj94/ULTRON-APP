# Nodo T4 (`35.175.175.203`, g4dn.xlarge): qué hacer con él

**Estado que pude comprobar (20-sep-2026):** la instancia está **encendida** (arrancó el 17-sep) con etiqueta «aura-gpu-T4-APAGADA (voz movida a ElevenLabs 5-sep)». Render la sondea en `:8790/salud` y responde 200, así que algo corre ahí (probablemente el servidor Qwen3-TTS viejo). No pude entrar a mirar qué hay dentro: el acceso por SSM fue bloqueado por permisos de esta sesión. Chatterbox (`:4123`) no responde desde fuera.

**Costo:** unos 380 USD al mes encendida las 24 h. Hoy no aporta nada al producto: la voz es ElevenLabs.

## Recomendación: convertirla en el **oído local** de AU-RA

Lo que más se usa por minuto en AU-RA es el oído (cada frase que decís pasa por Scribe de ElevenLabs, que cobra por minuto y tarda 0,4–0,6 s). Un T4 con **faster-whisper large-v3** transcribe español en ~0,3 s, gratis por minuto, y sirve también para las notas de voz de Telegram.

1. En el nodo: `bash scripts/nodo-t4/instalar-oido.sh` (Docker con GPU; deja `ultron-oido` en `:8791`, API compatible OpenAI `/v1/audio/transcriptions`).
2. Security group: abrir `8791` solo a la IP de salida de Render.
3. En Render: `ULTRON_STT_URL=http://35.175.175.203:8791` (+ `ULTRON_STT_CLAVE` si se puso `API_KEY`).
4. El servidor ya lo usa primero (`lib/oido.ts` → `transcribirLocal`); si el nodo no responde en 12 s, cae a Scribe sin que nadie lo note.

Opcional en el mismo nodo (cabe en 16 GB): **respaldo de voz** con Kokoro o Chatterbox en `:8790` compatible con `POST /decir|/tts|/synthesize {texto}` (el servidor ya intenta esas tres rutas si ElevenLabs cae). Solo vale la pena si ElevenLabs falla seguido; hoy no.

## Si no se va a usar

Apagarla (`stop`, no `terminate`, el disco se conserva). Quitar `ULTRON_TTS_URL`/`CHATTERBOX_URL` de Render para que `/api/health` no la sondee.

## Qwen (g5.xlarge, `34.207.148.69`)

Responde en 0,4 s el calentado y 2,8–6,4 s un turno completo con harness. No necesita nada por ahora. Lo que sí necesita el sistema alrededor: la clave AWS de Render (memoria S3) estaba borrada en IAM; ver `docs/ENTREGA-4.0.md` § Pendientes.
