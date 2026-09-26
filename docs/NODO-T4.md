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

## Laya: quién contesta en Dr Electrum (`:8792`)

[Laya](https://huggingface.co/convaiinnovations/laya) (Convai, Apache 2.0) no escribe: contesta preguntas cerradas con una probabilidad calibrada, en decenas de milisegundos. Aquí decide **qué especialistas convoca Dr Electrum** (0, 1 o 2 de los ocho), que hasta ahora salía de contar palabras (`convocar()`): «¿cuándo vence la concesión Quebrada Seca?» traía al ambiental por la palabra *quebrada*.

1. En el nodo, desde un clon del repo: `bash scripts/nodo-t4/instalar-laya.sh`. Crea un venv en `/opt/laya` con las versiones fijadas que corren hoy (torch 2.14.0 cu130, transformers 5.17.0, laya 0.3.20), **entrena en la GPU** con `scripts/nodo-t4/laya/datos` si no hay modelo (unos minutos; no hay pesos que copiar), genera la clave en `/etc/laya-electrum.env` (`LAYA_CLAVE`, `LAYA_PUERTO`, `LAYA_MODELO`; root, 600) y deja el servicio systemd `laya-electrum` (usuario `ubuntu`) en `:8792`.
2. TLS: el `:8792` no se abre en el security group. Laya sale por el Caddy de Voicebox (`443`, `/opt/voicebox/caddy/Caddyfile`), con `handle_path /laya/* { reverse_proxy 127.0.0.1:8792 }` antes de `@autorizado`. `/laya/decidir` exige la clave; `/laya/salud` es público y dice umbral, fecha de los pesos (`entrenado`) y recorte.
3. En Render (`aura-fp` y `ultron-looi-desk`): `ULTRON_LAYA_URL=https://35-175-175-203.sslip.io/laya`, `ULTRON_LAYA_CLAVE=` (la de `/etc/laya-electrum.env`) y `ULTRON_LAYA_TIMEOUT_MS=1000`. `lib/laya.ts` ignora cualquier URL `http://` que no sea local: el texto del usuario y la clave no viajan sin cifrar.
4. `turnoElectrum` llama a `decidirPanel()`: los especialistas que el usuario nombra («pásame al geólogo») van primero, el resto lo decide Laya, y si así no queda nadie decide la tabla. Si Laya no está configurado, tarda más que `ULTRON_LAYA_TIMEOUT_MS` o falla, se usa la tabla de siempre y no se reintenta durante 5 s, que se duplican con cada fallo seguido hasta 2 min (un acierto lo pone en cero).
5. Lo que se manda: si el mensaje pasa de 700 caracteres, los 200 primeros + « … » + los 500 últimos (lo mismo hace `servidor.py`, y por tanto `evaluar.py`). Ver abajo por qué.

**Resultado sobre la prueba apartada** (260 consultas escritas aparte, ninguna vista al entrenar; modelo del 26-09-2026 15:32 UTC, temperatura 2,93, umbral 0,50, elegidos en las 81 de validación):

| | exacto | principal | F1 | precisión | recall | «nadie» bien |
|---|---|---|---|---|---|---|
| tabla de palabras (`convocar`) | 59,2 % | 68,1 % | 0,761 | 0,763 | 0,760 | 89,4 % |
| Laya solo | 75,8 % | 76,2 % | 0,875 | 0,889 | 0,861 | 93,6 % |
| Laya + nombrados primero | 76,9 % | 76,2 % | 0,881 | 0,890 | 0,872 | 93,6 % |
| **+ la tabla si Laya no pone a nadie (lo que corre)** | **78,1 %** | **77,3 %** | **0,890** | 0,881 | 0,899 | 87,2 % |

*Exacto*: el panel entero coincide con el etiquetado. *Principal*: acierta al primero. *«Nadie» bien*: de las consultas que no necesitan especialista (saludos, uso de la app), cuántas deja sin panel.

Por especialista (precisión / recall / F1), tabla → lo que corre: geólogo 0,76/0,74/0,75 → 0,94/0,83/0,88 · minas 0,59/0,68/0,63 → 0,82/0,91/0,86 · civil 0,85/0,92/0,88 → 0,95/0,95/0,95 · metalurgista 0,68/0,88/0,77 → 0,79/0,94/0,86 · geomática 0,86/0,71/0,78 → 0,86/0,89/0,87 · ambiental 0,67/0,79/0,73 → 0,88/0,90/0,89 · legal 0,85/0,85/0,85 → 0,92/0,85/0,89 · economista 0,92/0,53/0,68 → 0,91/0,93/0,92.

**Calibración** (2.080 pares consulta × especialista): Brier 0,031, ECE 0,016. Cuando dice 0,9–1,0 acierta el 92 %; por debajo de 0,1, el 1,3 % eran sí. El umbral no es delicado: entre 0,4 y 0,6 el exacto se mueve entre 76,9 % y 78,1 % (diagnóstico; el umbral se elige en validación, no aquí).

**Casos difíciles** (`datos/bordes.jsonl`, 48; aciertos de lo que corre / de la tabla): 41/48 · 33/48. Saludos y cortos 13/13 · 13/13 · inglés 8/9 · 5/9 · faltas de ortografía 5/7 · 5/7 · nombres de concesiones 7/8 · 4/8 · varias especialidades 5/7 · 5/7 · textos largos 3/4 · 1/4. Contra `evals/electrum.jsonl` (el especialista principal de 49 casos; `npx tsx scripts/evals/sin-modelo.ts --laya-panel`): 46/49; la tabla da 49/49, pero se ajustó sobre esos mismos casos. Donde todavía falla: el *segundo* especialista en preguntas de dos temas (lo ve con P 0,2–0,4, bajo el umbral: «¿se traslapa y quién tiene prelación?» da solo legal), inglés técnico de relaves («tailings dam freeboard») y dictado con muchas faltas («q metodo de esplotacion»). Es lo primero a reforzar en `train_*.jsonl`, junto con preguntas técnicas cortas de definición («¿qué es un skarn?», «¿qué EPSG uso para Honduras?»), donde Laya no convoca a nadie. Por eso, cuando Laya no pone a nadie decide la tabla: en validación +3 paneles bien y 0 mal, en la prueba +6 y −3, en los casos difíciles +3 y 0, en `evals/electrum.jsonl` +4 y 0. Lo que cuesta: tres consultas sin tema técnico reciben especialista por una palabra («Resumime el expediente de La Represa» → legal), de ahí el 87,2 % de «nadie» bien. Se probó también completar el segundo especialista con la tabla y bajar el umbral del segundo a 0,35: ninguno mejora en validación.

**Textos largos.** El modelo se ajustó con consultas de menos de 230 caracteres y tarda más cuanto más largo el texto (en la T4: 67 ms con 20 caracteres, 96 ms con 200, 224 ms con 1000, 394 ms con 2000). Antes se cortaba a los 2000 primeros: con 2.500 caracteres de contexto delante de cada consulta de la prueba, el panel acertaba el 12 %, porque la pregunta, que en un dictado va al final, se perdía. Con 200 del principio y 500 del final acierta el 51 % (55 % si la pregunta va al principio), tarda ~160 ms, y el tiempo del nodo queda acotado.

**Latencia** (26-09-2026): el modelo, 66–67 ms (p50/p95) con una consulta normal. En el nodo, directo al `:8792`, 75/76 ms; por Caddy con TLS nuevo, 103/103 ms. Desde fuera de AWS, 60 llamadas: conexión nueva cada vez 195/368 ms (p50/p95), conexión reutilizada 108/115 ms; `lib/laya.ts` mantiene la conexión 60 s. Diez llamadas a la vez: todas 200, la última en ~1 s (el modelo atiende de una en una). Render está en Oregón y la T4 en Virginia (~70 ms de ida y vuelta), así que en frío se esperan ~300–400 ms: de ahí `ULTRON_LAYA_TIMEOUT_MS=1000`. Si falla, se paga como mucho esa espera una vez; el turno nunca se cae.

**Qué se ve en producción.** Cada turno de Electrum con Laya configurado deja en su traza un paso `laya_panel`: verde con el panel, las tres probabilidades más altas y los ms del modelo (o «laya → nadie, tabla → …» si decidió la tabla porque Laya no puso a nadie); rojo con el motivo (`tiempo agotado`, `red`, `http 401`, `en pausa`…) si cayó a la tabla. En `/api/cognitivo/resumen` (mando) sale como `porHerramienta.laya_panel` con usos y fallos: la tasa de caída a la tabla. `estadoLaya()` y `saludLaya()` (en `lib/laya.ts`) dan lo mismo para una ruta de salud.

**Servicio.** Mensajes raros no lo tumban: cuerpo vacío o > 16 KB → 413, no JSON o `Content-Length` inválido → 400, un fallo del modelo → 500 con JSON (se registra el tipo de error, nunca el texto), y un cliente que anuncia un cuerpo y no lo manda se corta a los 10 s. Un emoji partido (sustituto UTF-16 suelto) tumbaba la petición con 502 y ponía a Laya en pausa: ahora se limpia en los dos lados. Memoria: ~1,6 GB de RSS (runtime de CUDA y torch; estable tras horas) y 1,6 GB de VRAM.

**Evaluar** (en el nodo, junto al servicio; ~1,5 GB de VRAM más durante un minuto):

    cd /opt/laya && venv/bin/python evaluar.py --modelo modelo-electrum --tabla datos/test-tabla.jsonl --bordes datos/bordes-tabla.jsonl

`test-tabla.jsonl` y `bordes-tabla.jsonl` llevan ya lo que decide la tabla; si cambia `convocar()`, regenerarlos desde el repo: `cd scripts/nodo-t4/laya && npx tsx tabla.mjs ../../../server/electrum/especialistas.ts datos/test.jsonl > datos/test-tabla.jsonl` (igual con `bordes`). Imprime las cifras de arriba: exacto, F1, por especialista, calibración, sensibilidad al umbral y los casos difíciles uno por uno. No pasar lotes grandes de textos largos por la GPU compartida: una prueba de 2.000 textos de 3.000 caracteres la tuvo al 100 % y con 12 GB ocupados, junto a Voicebox.

**Reentrenar** tras añadir o corregir consultas en `datos/train_*.jsonl` (formato `{"q": "...", "e": ["legal"]}`, reglas en `datos/ESPEC.md`): `REENTRENAR=1 bash scripts/nodo-t4/instalar-laya.sh`. La prueba (`test.jsonl`) no se toca para entrenar; `entrenar.py` descarta cualquier consulta de entrenamiento que esté en ella. `bordes.jsonl` es diagnóstico: no se entrena con él (comparte «hola» con el entrenamiento, a propósito). Al reentrenar los números pueden moverse un punto (la GPU no es determinista); `evaluar.py` lo comprueba.

**No confundir** con el clasificador del turno (`lib/cognitivo/clasificador.ts`, `LAYA_URL`/`LAYA_API_KEY`, `laya-serve` de `infra/t4/`): ese es otro servicio, hoy no desplegado en la T4, y en Render no hay `LAYA_URL`, así que el clasificador decide con reglas.

**Siguiente:** las mismas piezas sirven para las compuertas de AU-RA (¿esto pide acción o solo conversación?, ¿necesita buscar en la web?) con otro `preguntas.json` y sus datos.

## Si no se va a usar

Apagarla (`stop`, no `terminate`, el disco se conserva). Quitar `ULTRON_TTS_URL`/`CHATTERBOX_URL` de Render para que `/api/health` no la sondee.

## Qwen (g5.xlarge, `34.207.148.69`)

Responde en 0,4 s el calentado y 2,8–6,4 s un turno completo con harness. No necesita nada por ahora. Lo que sí necesita el sistema alrededor: la clave AWS de Render (memoria S3) estaba borrada en IAM; ver `docs/ENTREGA-4.0.md` § Pendientes.
