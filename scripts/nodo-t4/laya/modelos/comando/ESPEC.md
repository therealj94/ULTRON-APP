# Laya «comando»: la orden que se dijo en voz alta

Un modelo COMPARTIDO por dos productos, con dos grupos exclusivos (exactamente una etiqueta de cada
grupo por frase). Cada producto lee el suyo:

- **`accion`** (Dr Electrum): la orden de pantalla de su mapa, o `ninguna` si es una pregunta o
  conversación, que entonces va al cerebro como consulta. Cada frase que oye el micrófono abierto de
  Dr Electrum (y que las reglas rápidas de `src-electrum/panel/comandos.ts` no reconocieron) pasa por
  aquí. AU-RA también lee de este grupo `callar` y `cerrar` (lib/acciones-app.ts, `DE_LAYA`).
- **`app`** (AU-RA): la MANO de AURA en la app, o `app_ninguna`: `app_recordar`,
  `app_llamar_recordar` («llámame a las 5 para recordarme…»), `app_listar_recordatorios`,
  `app_cancelar_recordatorio`, `app_llamar`, `app_videollamar`, `app_colgar`, `app_leer`,
  `app_responder`, `app_buscar_chats`, `app_silenciar_chat`, `app_idioma`, `app_perfil`,
  `app_presencia` (pantalla completa / al lado / chiquita) y `app_buscar_internet`. Laya decide QUÉ
  mano; a quién, a qué hora o qué texto lo sacan las reglas o el cerebro (lib/manos-app.ts).

Reglas de etiquetado de `accion`:

- Una orden con un NOMBRE propio («acércate a Los Almendros», «ficha de El Tule») es `ninguna`: la
  resuelve el cerebro, que sabe buscar y volar. Las órdenes de ficha (`ficha_pdf`, `mapa_geologico`,
  `timelapse`, `analizar`) son sobre la concesión ABIERTA («esta», «la abierta»).
- Una pregunta que usa palabras de orden («¿qué hay más arriba?», «¿cuál es la siguiente en
  vencer?») es `ninguna`.
- Dos órdenes en una frase: la primera.
- Mover (desplazar) no es rotar (girar): «a la derecha» es `mover_derecha`; «gira a la derecha»,
  `rotar_derecha`.

Reglas de etiquetado de `app`:

- Lo que se CUENTA no es orden: «mi mamá me llamó ayer», «Beto me dijo que venía» → `app_ninguna`.
- Pedir un dato de memoria no es un recordatorio: «recuérdame quién ganó el mundial» → `app_ninguna`.
- «llámame» + nombre es el apodo (`app_perfil`); «llámame a X» es llamar a X por mí (`app_llamar`);
  «llámame» solo es la llamada de Twilio del taller (`app_ninguna`); «llámame a las 5 para…» es
  `app_llamar_recordar`.
- Modismos: «ponte las pilas» → `app_ninguna`; «cuelga la ropa» → `app_ninguna`.
- «cállate» es `accion: callar` y `app_ninguna` (AU-RA lo lee del grupo accion).
- «busca en mis chats…» es `app_buscar_chats`; «busca en internet…», `app_buscar_internet`.
- Las frases de Electrum de pantalla completa / mitad llevan `app_presencia`; «busca en internet…»,
  `app_buscar_internet`; el resto, `app_ninguna`.

Datos:

- `generador/generar.py` escribe `train_a.jsonl` y `test.jsonl` de Electrum (otras plantillas, otra
  semilla) con su etiqueta del grupo `app` (se añade al escribir: las frases no cambiaron).
- `generador/generar_aura.py` escribe `train_aura.jsonl` y `test_aura.jsonl` de AU-RA: habla catracha,
  inglés, errores de dictado («bideollamada», «llama mi mamá», «q»), y negativos que se parecen.
- `bordes.jsonl` y `bordes_aura.jsonl` son a mano y solo diagnóstico.
- La prueba que decide la promoción es `test.jsonl` (la de siempre); `test_aura.jsonl` va en «evals»
  y se informa aparte (con un checkpoint viejo no hay con qué compararla).

La compuerta (comparar.py): este modelo no tiene etiquetas sueltas, así que se decide por la
exactitud de CADA grupo que ya tenía el modelo anterior (`accion` no puede bajar más de 0,01); el
grupo nuevo (`app`) se muestra y no frena. evaluar.py recorta las etiquetas que un checkpoint viejo no
conoce, para poder medirlo con los datos nuevos.

## Reentrenar (en el nodo T4, con GPU)

En esta máquina no: no hay torch ni GPU, el modelo base pesa ~1,3 GB y son ~5.100 frases × 56
preguntas por época. En la T4 son minutos:

```
cd <clon del repo> && git pull
REENTRENAR=comando bash scripts/nodo-t4/instalar-laya.sh
```

Eso copia los datos a /opt/laya, entrena `modelos/comando` con `--device cuda`, y promueve el nuevo
solo si la compuerta lo aprueba (si no, queda en /opt/laya/modelo-comando.rechazado). Para ver las
cifras antes/después a mano:

```
cd /opt/laya
venv/bin/python evaluar.py --modelo modelo-comando.anterior --modelo-dir modelos/comando --json /tmp/antes.json
venv/bin/python evaluar.py --modelo modelo-comando --modelo-dir modelos/comando --errores 20 --json /tmp/despues.json
venv/bin/python comparar.py /tmp/antes.json /tmp/despues.json
```

Y lo que ya cubren las reglas rápidas de AU-RA sobre los mismos datos (sin Laya, en milisegundos):

```
cd scripts/nodo-t4/laya
npx tsx reglas-comando-aura.mjs modelos/comando/datos/test_aura.jsonl modelos/comando/datos/bordes_aura.jsonl
```
