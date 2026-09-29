# Laya «comando»: la orden de pantalla que se dijo en voz alta

Cada frase que oye el micrófono abierto de Dr Electrum (y que las reglas rápidas de
`src-electrum/panel/comandos.ts` no reconocieron) pasa por aquí. Una sola etiqueta del grupo
`accion`: la orden de pantalla, o `ninguna` si es una pregunta o conversación, que entonces va al
cerebro como consulta.

Reglas de etiquetado:

- Una orden con un NOMBRE propio («acércate a Los Almendros», «ficha de El Tule») es `ninguna`: la
  resuelve el cerebro, que sabe buscar y volar. Las órdenes de ficha (`ficha_pdf`, `mapa_geologico`,
  `timelapse`, `analizar`) son sobre la concesión ABIERTA («esta», «la abierta»).
- Una pregunta que usa palabras de orden («¿qué hay más arriba?», «¿cuál es la siguiente en
  vencer?») es `ninguna`.
- Dos órdenes en una frase: la primera.
- Mover (desplazar) no es rotar (girar): «a la derecha» es `mover_derecha`; «gira a la derecha»,
  `rotar_derecha`.

Datos: `generador/generar.py` escribe `train_a.jsonl` y `test.jsonl` (otras plantillas, otra
semilla). `bordes.jsonl` es a mano y solo diagnóstico.
