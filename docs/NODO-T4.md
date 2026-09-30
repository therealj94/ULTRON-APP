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

1. En el nodo, desde un clon del repo: `bash scripts/nodo-t4/instalar-laya.sh`. Crea un venv en `/opt/laya` con las versiones fijadas que corren hoy (torch 2.14.0 cu130, transformers 5.17.0, laya 0.3.20), **entrena en la GPU** con `scripts/nodo-t4/laya/datos` si no hay modelo (unos minutos; no hay pesos que copiar; también `mensaje` y `documento` si tienen datos, ver «Varios modelos» abajo), genera la clave en `/etc/laya-electrum.env` (`LAYA_CLAVE`, `LAYA_PUERTO`, `LAYA_MODELO`; root, 600) y deja el servicio systemd `laya-electrum` (usuario `ubuntu`) en `:8792`.
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

**Reentrenar** tras añadir o corregir consultas en `datos/train_*.jsonl` (formato `{"q": "...", "e": ["legal"]}`, reglas en `datos/ESPEC.md`): `REENTRENAR=electrum bash scripts/nodo-t4/instalar-laya.sh` (`REENTRENAR=1` reentrena también `mensaje` y `documento`). La prueba (`test.jsonl`) no se toca para entrenar; `entrenar.py` descarta cualquier consulta de entrenamiento que esté en ella. `bordes.jsonl` es diagnóstico: no se entrena con él (comparte «hola» con el entrenamiento, a propósito). Al reentrenar los números pueden moverse un punto (la GPU no es determinista); `evaluar.py` lo comprueba.

### Varios modelos en el mismo servicio (`mensaje`, `documento`)

El mismo `laya-electrum` sirve más de un modelo ajustado, cada uno con su juego de preguntas noul. Hoy: `electrum` (el de arriba), `mensaje` (sobre cada mensaje de AU-RA y PULSE2CHAT: si hay que razonar, si mueve valor o toca el sistema, ataque, urgente, spam, abuso, estafa, crisis, ánimo y una `tarea_*`; `modelos/mensaje/ESPEC.md`) y `documento` (qué es un fragmento de expediente —un `doc_*`, grupo `tipo`— y qué trae —`req_*`—; `modelos/documento/ESPEC.md`).

    python servidor.py --modelo electrum=/opt/laya/modelo-electrum \
        --modelo mensaje=/opt/laya/modelo-mensaje --modelo documento=/opt/laya/modelo-documento

Un `--modelo DIR` a secas sigue siendo electrum, como antes. `instalar-laya.sh` deja el unit con los tres.

**Cada modelo es una carpeta** `scripts/nodo-t4/laya/modelos/<nombre>/` con `preguntas.json` (una noul por id), `datos/*.jsonl` (`{"q": texto, "e": [ids]}`), su `ESPEC.md` y un `modelo.json`:

    {"nombre": "mensaje",
     "ids": ["razonar", …, "tarea_conversacion", …],      ← orden de las P; = claves de preguntas.json
     "grupos": {"tarea": ["tarea_conversacion", …]},       ← exclusivos: exactamente uno por texto
     "recorte": {"cabeza": 200, "cola": 500},              ← caracteres; igual al entrenar y al servir
     "datos": {"train": ["datos/train_*.jsonl"], "test": ["datos/test_*.jsonl"],
               "bordes": ["datos/bordes_*.jsonl"], "evals": ["datos/evals_aura.jsonl"]}}

Los globs son relativos a la carpeta. Todo conjunto que no sea `train` queda apartado: `entrenar.py` descarta del entrenamiento cualquier texto que aparezca en él (comparando sin tildes, en minúsculas y con los espacios colapsados). Fuera de los grupos, las etiquetas son libres (0..n). `comun.py` lee y valida todo esto y junta todos los errores de los datos antes de fallar (etiqueta desconocida, un grupo con cero o dos, línea sin texto).

**Recorte.** `mensaje` usa el de electrum (200 + 500). `documento`, **450 + 450** (hasta 900 caracteres pasan enteros): en un documento importan las dos puntas por igual, el encabezado dice qué es («RESOLUCIÓN No.…», «CONTRATO DE…») y el final trae firma, sello y plazos; los fragmentos del ESPEC (≤ ~700) entran sin cortar. Cuesta ~200 ms por fragmento largo en la T4 (medido con electrum: 224 ms con 1000 caracteres), aceptable para documentos, que no van en el camino de la voz. `/salud` publica el recorte de cada modelo para que el cliente recorte igual.

**Rutas nuevas** (misma clave Bearer que `/decidir`):

- `POST /v1/<nombre>` con `{"texto": "…"}` →
  `{"p": {id: P}, "etiquetas": [ids sueltos ≥ su umbral, de mayor a menor P], "grupos": {grupo: id ganador}, "umbrales": {id: u}, "ms": n}`.
  Los grupos se deciden por argmax (sin umbral); `umbrales` trae solo los de las etiquetas sueltas. Texto vacío → todo vacío y `ms: 0`.
- Con `{"textos": [...]}` (hasta 32) → `{"resultados": [{"p", "etiquetas", "grupos"}, …], "umbrales": {…}, "ms": n}`, en el mismo orden.
- `"preguntas": [ids]` (opcional) calcula solo esas (menos cómputo: una fila por pregunta). Si se pide un miembro de un grupo va el grupo entero, porque el ganador es el argmax de todos.
- `/v1/electrum` también existe (sin el tope de dos ni la tabla); `/decidir` sigue exactamente igual y es lo que usa `lib/laya.ts`.
- Errores: los de siempre (401 sin clave, 413 cuerpo vacío o > 16 KB, 400 no JSON, 500 si falla el modelo, sin registrar el texto; corte a los 10 s del cliente que no manda el cuerpo). Un lote puede pesar hasta 64 KB; más de 32 textos → 413. `texto`/`textos`/`preguntas` de otro tipo o ids desconocidos → 400. Modelo que no existe → 404; configurado pero no cargado → 503.

**Si un modelo no carga** (sin checkpoint, checkpoint roto, sin memoria), el servicio arranca con los demás y `GET /salud` lo dice en `modelos.<nombre>` (`{"ok": false, "error": "…"}`). `/salud` es el de siempre para electrum más el campo `modelos` con, por cada uno, `ok`, `ids`, `grupos`, `recorte: [cabeza, cola]`, `umbrales`, `entrenado` y `device`. Si el que falla es electrum, `/salud` da 503 y `/decidir` 503: `lib/laya.ts` cae a la tabla como con cualquier fallo.

**GPU compartida.** Un solo cerrojo para todos los modelos, tomado por pasada (hasta 64 filas texto × pregunta y ~6000 tokens) y por orden de llegada: nunca hay dos pasadas de Laya a la vez en la T4 (memoria acotada, la voz no compite con tres modelos), y un `/decidir` de Electrum espera como mucho la pasada en curso, no un lote de 32 documentos entero. Medido en CPU (la T4 es decenas de veces más rápida): con un lote de 32 fragmentos de 900 caracteres en marcha, un `/decidir` tardó 5,6 s en lugar de esperar los 125 s del lote; con el tope solo de filas eran 17 s. La tabla de embeddings (197M de los 322M parámetros) no se entrena, así que es idéntica en los tres checkpoints y se carga una sola vez: cada modelo más cuesta ~0,5 GB de VRAM en lugar de ~1,3 GB.

**Entrenar y umbrales.** `entrenar.py --modelo-dir modelos/<nombre>` (sin `--modelo-dir`, electrum exactamente como antes). Validación: un 10 % (al menos 40, nunca más de un cuarto) estratificado por el ganador del grupo y la etiqueta suelta más rara de cada texto, reproducible con `--semilla`. Temperatura como electrum. Luego un umbral **por etiqueta**: primero el global que maximiza el F1 micro de las sueltas; después, para cada etiqueta, el que maximiza su F1 en validación, mezclado con el global en proporción a sus positivos, `u = (n·u_propio + 10·u_global) / (n + 10)`, recortado a [0,2; 0,8], y el global a secas con menos de 3 positivos. Así una etiqueta con 40 positivos usa sobre todo el suyo y una con 3 (crisis, ataque…) casi el global: con tan pocos casos el «mejor» umbral es ruido. Se guarda en `cfg['decisor']` del checkpoint (ids, grupos, umbrales, umbral global, recorte, métricas de validación con los dos criterios, detalle de cada umbral); el de electrum sigue en `cfg['electrum']`.

**Reentrenar** tras tocar los datos: `REENTRENAR=mensaje bash scripts/nodo-t4/instalar-laya.sh` (o `documento`, `electrum`, `mensaje,documento`; `REENTRENAR=1` son los tres). Sin `REENTRENAR` se entrena solo lo que no tiene checkpoint y sí tiene `preguntas.json` y `datos/train_*.jsonl`. Si el entrenamiento de un modelo nuevo falla, se avisa, se deja su checkpoint anterior y electrum se instala igual.

**Evaluar** (en el nodo):

    cd /opt/laya && venv/bin/python evaluar.py --modelo modelo-mensaje --modelo-dir modelos/mensaje --errores 30

Imprime, por conjunto (test y evals): «todas bien» (el conjunto entero de etiquetas igual al etiquetado), exactitud de cada grupo, F1 micro y macro de las sueltas, precisión/recall/F1/soporte por etiqueta, lo mismo con un solo umbral global (diagnóstico), calibración (Brier, ECE y tabla de fiabilidad) y, en bordes, cada fallo con las P de lo que difiere y el resumen por tipo (`c`). `--json` guarda todo.

**Contra las reglas de AU-RA** (`mensaje`): `reglas-mensaje.mjs` corre `clasificarConReglas(q, 'ultron')` de `lib/cognitivo/clasificador.ts` y lo traduce a etiquetas: `tarea_*` ← `tarea`, `razonar` ← `requiereQwen`, `mueve_valor` ← riesgo 90 (`MUEVE_VALOR`), `toca_sistema` ← riesgo 85 sin inyección (`TOCA_SISTEMA`; con inyección el 85 es ambiguo y esa fila no cuenta para `toca_sistema`), `ataque` ← `inyeccion`. Spam, abuso, estafa, crisis, urgente, molesto y triste no tienen regla. Desde el repo:

    cd scripts/nodo-t4/laya
    npx tsx reglas-mensaje.mjs modelos/mensaje/datos/test_*.jsonl > /tmp/test-reglas.jsonl
    npx tsx reglas-mensaje.mjs modelos/mensaje/datos/evals_aura.jsonl > /tmp/evals-reglas.jsonl
    python evaluar.py --modelo … --modelo-dir modelos/mensaje --test /tmp/test-reglas.jsonl --evals /tmp/evals-reglas.jsonl

y `evaluar.py` añade la columna de las reglas por etiqueta y «todas bien»/grupo `tarea` de reglas y modelo contados solo en lo que las reglas cubren.

**El clasificador del turno** (`lib/cognitivo/clasificador.ts`) ya no habla con `laya-serve` de `infra/t4/` (`LAYA_URL`): con `CLASIFICADOR_MODO=sombra` o `laya` pregunta a `/v1/mensaje` de este mismo servicio por `lib/laya.ts` (`ULTRON_LAYA_URL`/`ULTRON_LAYA_CLAVE`); por omisión (`reglas`) sigue decidiendo con reglas.

### `comando`: las manos de AU-RA, en español e inglés (y Laya ligera)

`modelos/comando` es compartido: Electrum lee su grupo `accion`; AU-RA, su grupo `app` (28 manos
sacadas del código: navegar, abrir pantalla, tema, avatar, callar/volver a hablar, cámara, ayuda,
chats, llamar, recordatorios, perfil, idioma, internet; `modelos/comando/ESPEC.md`). Los datos de
AU-RA salen de `generador/generar_app.py` (bilingüe, sin fugas entre entrenamiento, validación y
prueba) y se revisan sin GPU con `python revisar_datos.py modelos/comando`.

El camino rápido de AU-RA (`lib/acciones-app.ts`, `ordenRapida`) va **reglas → Laya ligera → este
modelo → cerebro**. Laya ligera (`lib/laya-ligera.ts`) es el grupo `app` destilado en un clasificador
lineal que corre dentro del servidor, sin red (~0,05 ms de mediana); se entrena en CPU en segundos con
`python scripts/nodo-t4/laya/ligera/entrenar_ligera.py` (con su compuerta) y se despliega con el
servidor (OTA de Render: no toca el nodo). El Laya del nodo solo se consulta si la ligera duda.

**Desplegar el `comando` nuevo en el nodo** (lo hace una persona; entrenar en CPU no es viable: una
predicción tarda ~17 s y una época serían días):

    cd <clon del repo en la T4> && git fetch origin && git checkout <rama> && git pull
    REENTRENAR=comando bash scripts/nodo-t4/instalar-laya.sh

Entrena en la GPU y promueve el nuevo solo si ningún grupo baja más de 0,01 en `test` (Electrum) ni en
`evals` (`test_app.jsonl`, AU-RA) y si el grupo `app` acierta ≥ 0,85 en `test_app.jsonl`; si no, queda
en `/opt/laya/modelo-comando.rechazado` y sigue el anterior. Después, verificar:

    curl -s http://127.0.0.1:8792/salud | python3 -m json.tool | grep -A6 '"comando"'     # ok, 68 ids, entrenado hoy
    cd /opt/laya && venv/bin/python evaluar.py --modelo modelo-comando --modelo-dir modelos/comando --errores 20
    CLAVE=$(sudo sed -n 's/^LAYA_CLAVE=//p' /etc/laya-electrum.env)
    curl -s -H "Authorization: Bearer $CLAVE" -H 'content-type: application/json' -d '{"texto":"switch me to claudio"}' http://127.0.0.1:8792/v1/comando

y que el último dé `"grupos": {"accion": "ninguna", "app": "app_avatar"}`. En Render no hay nada que
cambiar (mismas variables); `lib/acciones-app.ts` ya lee el grupo `app` y, si el checkpoint es viejo,
sigue con `callar`/`cerrar` de `accion`.

**Siguiente:** entrenar `mensaje` y `documento` en la GPU con los datos completos, medirlos (`evaluar.py`, `mensaje` contra las reglas) y, con esas cifras, decidir si `CLASIFICADOR_MODO` pasa de `reglas` a `sombra`.

## Embeddings BGE-M3: en la GPU del cerebro, publicados por el Caddy de la T4

La búsqueda por significado de Dr Electrum (`lib/cognitivo/embeddings.ts`, `server/electrum/vectores.ts`) usa BGE-M3 (1024 dimensiones). **No corre en la T4**: su GPU está llena (Voicebox, Laya y `chico` ocupan ~14,5 de 15 GB) y en CPU iba a 0,7 fragmentos por segundo y saturaba la máquina. Corre en la A10G del nodo del cerebro, que estaba ociosa:

```bash
# en el nodo del cerebro (i-06530893af0dd0638), escucha SOLO en su IP privada
sudo docker run -d --name embed --restart unless-stopped --gpus all -p 172.31.23.34:8794:80 -v embed-modelos:/data \
  ghcr.io/huggingface/text-embeddings-inference:86-1.9.4 --model-id BAAI/bge-m3 --max-client-batch-size 32 --max-batch-tokens 4096
```

- ~1,5 GB de VRAM, 67 ms por consulta. Indexar los 3706 fragmentos tardó unos minutos (38/s).
- Security group: `8794` abierto **solo desde la IP privada de la T4** (`172.31.19.170/32`, regla `sgr-0af61442e031b96a4`). No se expone a internet.
- En `/opt/voicebox/caddy/Caddyfile` de la T4, antes del bloque de Laya, una ruta que exige la clave y reenvía por la red privada:

  ```
  @embed {
  	path /embed/*
  	header Authorization "Bearer <EMBED_API_KEY>"
  }
  handle @embed {
  	uri strip_prefix /embed
  	reverse_proxy 172.31.23.34:8794
  }
  ```

  Sin la clave, `/embed/*` cae en el `respond 403` del final. TEI no lleva `--api-key` a propósito: imprime sus argumentos al arrancar.
- En Render (`ultron-looi-desk`): `EMBED_URL=https://35-175-175-203.sslip.io/embed` y `EMBED_API_KEY` (la misma de la ruta). Lo que ya estaba cargado se indexa con `scripts/cognitivo/indexar-vectores.ts`; lo que se sube después se indexa solo.
- Si el servicio cae, la búsqueda vuelve sola a texto completo (interruptor en `lib/cognitivo/interruptor.ts`): Electrum no se rompe, busca peor.

## Si no se va a usar

Apagarla (`stop`, no `terminate`, el disco se conserva). Quitar `ULTRON_TTS_URL`/`CHATTERBOX_URL` de Render para que `/api/health` no la sondee.

## Qwen (g5.xlarge, `34.207.148.69`)

Responde en 0,4 s el calentado y 2,8–6,4 s un turno completo con harness. No necesita nada por ahora. Lo que sí necesita el sistema alrededor: la clave AWS de Render (memoria S3) estaba borrada en IAM; ver `docs/ENTREGA-4.0.md` § Pendientes.
