# Laya «comando»: la orden que se dijo en voz alta

Un modelo COMPARTIDO por dos productos, con dos grupos exclusivos (exactamente una etiqueta de cada
grupo por frase). Cada producto lee el suyo:

- **`accion`** (Dr Electrum): la orden de pantalla de su mapa, o `ninguna` si es una pregunta o
  conversación, que entonces va al cerebro como consulta. Cada frase que oye el micrófono abierto de
  Dr Electrum (y que las reglas rápidas de `src-electrum/panel/comandos.ts` no reconocieron) pasa por
  aquí. AU-RA lee el grupo `app` y, con un checkpoint viejo, `callar` y `cerrar` de este (lib/acciones-app.ts, `DE_LAYA_ACCION`).
- **`app`** (AU-RA): la MANO de AURA en la app, o `app_ninguna`. Sale del código (lib/acciones-app.ts,
  lib/manos-app.ts, la herramienta web y la mesa), nada inventado:
  · navegar y la pantalla: `app_atras`, `app_abrir` (mesa, chats, ajustes, perfil), `app_tema`,
    `app_avatar` (AU-RA, Claudio, ANT-ONIO, Guardián), `app_presencia` (pantalla completa / al lado /
    chiquita), `app_callar` (cállate, interrumpir), `app_hablar` (vuelve a hablar), `app_camara`
    (encender/apagar la visión), `app_ayuda` (tutorial, qué puede hacer), `app_idioma`;
  · chats: `app_abrir_chat`, `app_redactar` (mensaje nuevo), `app_enviar` y `app_descartar` (el «sí,
    envíalo» / «bórralo» de un borrador), `app_leer`, `app_responder`, `app_buscar_chats`,
    `app_silenciar_chat`;
  · llamadas y recordatorios: `app_llamar`, `app_videollamar`, `app_colgar`, `app_recordar`,
    `app_llamar_recordar` («llámame a las 5 para recordarme…»), `app_listar_recordatorios`,
    `app_cancelar_recordatorio`;
  · `app_perfil` (apodo, dónde vive, cumpleaños…) y `app_buscar_internet`.
  Laya decide QUÉ mano; a quién, a qué hora o qué texto lo sacan las reglas o el cerebro. NO existen en
  el código (y no tienen etiqueta): abrir otra app del teléfono, mover/rotar/acercar el avatar por voz.

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
- «cállate» es `accion: callar` y `app_callar` (cada producto lo lee de su grupo); «cierra esto» es
  `accion: cerrar` y `app_atras`.
- «sí, envíalo» es `app_enviar` y «bórralo», `app_descartar`; un «sí» o un «cancela» sueltos son
  `app_ninguna` (lo decide la regla con el borrador delante, nunca Laya).
- Preguntas y relatos con palabras de mano son `app_ninguna`: «¿hablas inglés?», «estoy viendo una
  película en pantalla completa», «los ajustes de precio subieron», «mi sobrino se llama Antonio».
- Inglés igual que español: «go back», «dark mode», «call my mom», «remind me at 5 to…».
- «busca en mis chats…» es `app_buscar_chats`; «busca en internet…», `app_buscar_internet`.
- Las frases de Electrum de pantalla completa / mitad llevan `app_presencia`; «busca en internet…»,
  `app_buscar_internet`; el resto, `app_ninguna`.

Datos:

- `generador/generar.py` escribe `train_a.jsonl` y `test.jsonl` de Electrum (otras plantillas, otra
  semilla) con su etiqueta del grupo `app` (se añade al escribir: las frases no cambian; callar → app_callar,
  cerrar → app_atras, «apaga la cámara» → app_camara, «abre el chat» → app_abrir…).
- `generador/generar_app.py` escribe `train_app.jsonl`, `val_app.jsonl` y `test_app.jsonl` de AU-RA:
  TODAS las manos en español catracho/latino e inglés (`l`: es/en), con muletillas, cortesía, errores
  de dictado («bideollamada», «pantaya», «q», «u», «gonna») y negativos que se parecen. SIN FUGAS por
  construcción: cada plantilla (`t`) y cada relleno (contactos, horas, tareas, temas) va a un solo
  conjunto, y lo casi igual (4-gramas, Jaccard ≥ 0,8) se quita del entrenamiento. Reemplaza a
  generar_aura.py.
- `bordes.jsonl` y `bordes_aura.jsonl` son a mano y solo diagnóstico.
- La prueba que decide la promoción es `test.jsonl` (Electrum, grupo `accion`) Y `test_app.jsonl` (en
  «evals», grupo `app`); `val_app.jsonl` se aparta (entrenar.py no la usa para ajustar).

Laya LIGERA (`../../ligera/entrenar_ligera.py`): el grupo `app` destilado en un clasificador lineal que
corre dentro del servidor de AU-RA (lib/laya-ligera.ts), sin red, en ~0,05–0,3 ms. Se entrena en CPU en
segundos con estos mismos datos y tiene su propia compuerta (precisión de lo que se ejecutaría ≥ 0,97
en test_app). El camino rápido va reglas → Laya ligera → Laya del nodo → cerebro; ver
`evaluar-camino-rapido.mjs` para medirlo de punta a punta.

La compuerta (comparar.py): este modelo no tiene etiquetas sueltas, así que se decide por la
exactitud de CADA grupo que ya tenía el modelo anterior, en `test` y en `evals` (ninguno puede bajar más
de 0,01), y además el nuevo tiene que acertar al menos el 85 % del grupo `app` en `test_app.jsonl`
(`--minimo evals:app=0.85`, lo pasa instalar-laya.sh): lo que AU-RA ejecuta sin cerebro no entra flojo
aunque el anterior fuera peor. evaluar.py recorta las etiquetas que un checkpoint viejo no conoce (una
fila cuya mano nueva no conoce le cuenta como fallo en ese grupo, no como error de datos).

## Reentrenar (en el nodo T4, con GPU)

En una máquina sin GPU no: medido en CPU (4 núcleos), una predicción completa tarda ~17,6 s y un paso de
entrenamiento de 8 filas ~3,2 s; con ~9.400 frases × 68 preguntas son ~640.000 filas por época (días).
En la T4 son minutos:

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

Y el camino rápido de AU-RA de punta a punta sobre los mismos datos (reglas, y reglas + Laya ligera):

```
cd scripts/nodo-t4/laya
npx tsx evaluar-camino-rapido.mjs            # test_app + test + bordes_aura, por etiqueta e idioma
```
