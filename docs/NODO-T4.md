# Nodo T4 (`35.175.175.203`, g4dn.xlarge): qué hacer con él

**Estado que pude comprobar (20-sep-2026):** la instancia está **encendida** (arrancó el 17-sep) con etiqueta «aura-gpu-T4-APAGADA (voz movida a ElevenLabs 5-sep)». Render la sondea en `:8790/salud` y responde 200, así que algo corre ahí (probablemente el servidor Qwen3-TTS viejo). No pude entrar a mirar qué hay dentro: el acceso por SSM fue bloqueado por permisos de esta sesión. Chatterbox (`:4123`) no responde desde fuera.

**Costo:** unos 380 USD al mes encendida las 24 h. Hoy no aporta nada al producto: la voz es ElevenLabs.

## Recomendación: convertirla en el **oído local** de ULTRON

Lo que más se usa por minuto en ULTRON es el oído (cada frase que decís pasa por Scribe de ElevenLabs, que cobra por minuto y tarda 0,4–0,6 s). Un T4 con **faster-whisper large-v3** transcribe español en ~0,3 s, gratis por minuto, y sirve también para las notas de voz de Telegram.

1. En el nodo: `bash scripts/nodo-t4/instalar-oido.sh` (Docker con GPU; deja `ultron-oido` en `:8791`, API compatible OpenAI `/v1/audio/transcriptions`).
2. Security group: abrir `8791` solo a la IP de salida de Render.
3. En Render: `ULTRON_STT_URL=http://35.175.175.203:8791` (+ `ULTRON_STT_CLAVE` si se puso `API_KEY`).
4. El servidor ya lo usa primero (`lib/oido.ts` → `transcribirLocal`); si el nodo no responde en 12 s, cae a Scribe sin que nadie lo note.

Opcional en el mismo nodo (cabe en 16 GB): **respaldo de voz** con Kokoro o Chatterbox en `:8790` compatible con `POST /decir|/tts|/synthesize {texto}` (el servidor ya intenta esas tres rutas si ElevenLabs cae). Solo vale la pena si ElevenLabs falla seguido; hoy no.

## Laya: quién contesta en Dr Electrum (`:8792`)

[Laya](https://huggingface.co/convaiinnovations/laya) (Convai, Apache 2.0) no escribe: contesta preguntas cerradas con una probabilidad calibrada, en decenas de milisegundos. Aquí decide **qué especialistas convoca Dr Electrum** (0, 1 o 2 de los ocho), que hasta ahora salía de contar palabras (`convocar()`): «¿cuándo vence la concesión Quebrada Seca?» traía al ambiental por la palabra *quebrada*.

1. En el nodo, desde un clon del repo: `bash scripts/nodo-t4/instalar-laya.sh`. Crea un venv en `/opt/laya`, **entrena en la GPU** con `scripts/nodo-t4/laya/datos` (unos minutos; no hay pesos que copiar), genera la clave en `/etc/laya-electrum.env` y deja el servicio `laya-electrum` en `:8792`.
2. Security group: abrir `8792` solo a la IP de salida de Render.
3. En Render: `ULTRON_LAYA_URL=http://35.175.175.203:8792` y `ULTRON_LAYA_CLAVE=` (la de `/etc/laya-electrum.env`).
4. `turnoElectrum` llama a `decidirPanel()`: los especialistas que el usuario nombra («pásame al geólogo») van primero, el resto lo decide Laya. Si Laya no está configurado, tarda más de 800 ms o falla, se usa la tabla de siempre y no se reintenta durante 60 s.

**Resultado sobre la prueba apartada** (260 consultas escritas aparte, ninguna vista al entrenar):

| | exacto | principal | F1 | precisión | recall | «nadie» bien |
|---|---|---|---|---|---|---|
| tabla de palabras (`convocar`) | 57,3 % | 66,5 % | 0,745 | 0,744 | 0,747 | 89,4 % |
| Laya solo | 73,1 % | 72,7 % | 0,863 | 0,862 | 0,865 | 87,2 % |
| **Laya + nombrados primero (lo que corre)** | **74,2 %** | **73,1 %** | **0,869** | 0,863 | 0,875 | 87,2 % |

*Exacto*: el panel entero coincide con el etiquetado. *Principal*: acierta al primero. *«Nadie» bien*: de las consultas que no necesitan especialista (saludos, uso de la app), cuántas deja sin panel. Entrenado 4 épocas sobre 733 consultas (81 de validación para calibrar la temperatura, 2,69, y el umbral, 0,40). Donde más falla todavía: consultas en inglés técnico mezclado («haul road cycle time», «tailings dam freeboard») y drones/fotogrametría, que confunde con minas; son lo primero a reforzar en los datos. Al reentrenar en el nodo los números pueden moverse un punto (la GPU no es determinista); `evaluar.py` lo comprueba.

**Reentrenar** tras añadir o corregir consultas en `datos/train_*.jsonl` (formato `{"q": "...", "e": ["legal"]}`, reglas en `datos/ESPEC.md`): `REENTRENAR=1 bash scripts/nodo-t4/instalar-laya.sh`. La prueba (`test.jsonl`) no se toca para entrenar; `entrenar.py` descarta cualquier consulta de entrenamiento que esté en ella.

**Siguiente:** las mismas piezas sirven para las compuertas de AU-RA (¿esto pide acción o solo conversación?, ¿necesita buscar en la web?) con otro `preguntas.json` y sus datos.

## Si no se va a usar

Apagarla (`stop`, no `terminate`, el disco se conserva). Quitar `ULTRON_TTS_URL`/`CHATTERBOX_URL` de Render para que `/api/health` no la sondee.

## Qwen (g5.xlarge, `34.207.148.69`)

Responde en 0,4 s el calentado y 2,8–6,4 s un turno completo con harness. No necesita nada por ahora. Lo que sí necesita el sistema alrededor: la clave AWS de Render (memoria S3) estaba borrada en IAM; ver `docs/ENTREGA-4.0.md` § Pendientes.
