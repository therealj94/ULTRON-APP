# Voces conocidas: quién habla (dueño y círculo cercano)

Código: `lib/voces-motor.ts` (motor en un proceso hijo, sherpa-onnx-node, modelo 3D-Speaker CAM++ fijado por sha256),
`lib/voces-miembro.ts` (lo guardado, por cuenta), `server/voces-rutas.ts` (rutas), `server/modo-invitado.ts` (el corte
del modo invitado), `mobile/src/voces/*` (teléfono), `mobile/src/lib/privadoLocal.ts` (lo que el teléfono resuelve solo).

## Qué se guarda

Solo números (hasta 8 juegos de 192 por persona), la relación y la frase de consentimiento. Nunca audio: se procesa en
memoria y se descarta. Todo es por cuenta (el correo sale de la sesión firmada). «Olvida la voz de Ana», «olvida mi voz»
y «olvida todas las voces» borran de verdad, también con dos instancias del servidor a la vez (despliegue sin cortes):
cada cambio vuelve a leer S3 bajo el candado de la cuenta y guarda con la condición del ETag leído; la caché vence a los
30 s (lo mismo para las caras).

## Cómo se usa en el turno

- El teléfono (oído **Turbo**) entrega el audio de cada frase al cerrarse; la identificación corre en paralelo y el turno
  de ESA frase la espera como mucho 350 ms.
- Cuando la voz es de alguien del círculo (no de la dueña), el turno lleva `quienHabla: { id }` (validado en el servidor
  contra las voces guardadas de esa cuenta) y el servidor arma el turno en **modo invitado**: sin memoria, perfil, hilo,
  correos, mensajes, contactos, tareas, borradores ni herramientas privadas, y sin los nombres guardados de la escena
  (caras y voces). Frase corta justo después de otra voz del círculo: `{ id, reciente: true }`, igual.

## Con la voz de la dueña guardada: lo privado solo si se confirma que es ella (revisión 7)

Regla: «ningún dato privado para invitados». Con reconocer voces activo **y** la voz de la dueña guardada, un turno
hablado lleva lo privado SOLO si:

1. su voz quedó identificada en ESA frase, o
2. **continuidad**: su voz se identificó hace menos de 20 s y desde entonces no se oyó ninguna otra voz (conocida o no)
   —así su «sí» o «dale» corto sigue sirviendo—; o su cara (relación «yo», confirmada por 2 votos) se vio hace menos de
   10 s y no se oyó ninguna otra voz en los últimos 20 s.

Todo lo demás va con `quienHabla: { incierta: true }` (una frase dudosa, una muy corta sin continuidad, la consulta que
tardó más de 350 ms, un 503 de `/api/voces/quien`) o `{ desconocida: true }` (frase larga que no es de nadie guardado), y
el servidor contesta en modo invitado. Con `incierta` no se antepone «Te respondo en modo invitado»: si lo pedido
necesitaba algo privado (o era un «sí» corto a algo pendiente), AU-RA dice «No reconocí tu voz; dímelo con una frase un
poco más larga».

En el servidor tampoco se da por dueña lo que no se puede comprobar: un `quienHabla: { id }` que no se puede verificar
(el cajón de voces tarda más de 800 ms, S3 falla, el id ya no está) es invitado, no dueña.

Lo que el teléfono resuelve sin el servidor y toca lo privado («¿qué sabes de mí?», «recuerda que…», «olvida lo que sabes
de mí», «conóceme», «aprende mi voz», «olvida la voz de Ana», «¿a quién conoces?», «cierra sesión», el nombre en el
saludo) pasa por la misma decisión (`mobile/src/lib/privadoLocal.ts`): lo que lee va al servidor (modo invitado), lo que
escribe se niega con una frase corta.

Sin la voz de la dueña guardada (o con reconocer voces apagado), la sesión firmada del teléfono es la dueña, como antes:
solo frena lo que se sabe de otra voz del círculo. Lo escrito en la pantalla (sin frase oída) también es la sesión.

## Lo que NO lleva identidad de voz (y por eso es la dueña, por su sesión)

Estos caminos están autenticados con la sesión de la dueña y **no** tienen identificación de voz: el servidor los trata
como la dueña.

- La **conversación de voz en vivo** (WebRTC con ElevenLabs, `/api/voz/llm`): el audio no pasa por el oído Turbo, así que
  no hay frase que identificar.
- La app de **Windows**, la **web** y **Telegram** (texto o voz por esos canales).

**Riesgo residual (con la voz de la dueña guardada):** quien tenga en la mano el teléfono desbloqueado de la dueña y abra
la conversación en vivo, o use su sesión de la web, Windows o Telegram, recibe lo privado como si fuera ella. La
protección por voz cubre la mesa del teléfono con el oído Turbo; para lo demás, la barrera es la sesión (bloqueo del
teléfono, cerrar sesión en aparatos compartidos).

## Límites conocidos (decisión de producto)

- Solo con el oído Turbo: el reconocedor de Google del teléfono no entrega audio y la conversación en vivo (WebRTC con
  ElevenLabs) tampoco.
- Si el teléfono no pudo leer la lista de voces guardadas (sin red al entrar), no sabe que la dueña tiene su voz guardada
  y la sesión manda hasta que la lista cargue.
- El umbral (0,6) y el margen (0,1) se ajustan con `ULTRON_VOCES_UMBRAL` y `ULTRON_VOCES_MARGEN` si en el teléfono real
  confunde voces parecidas. `ULTRON_VOCES=0` lo apaga.
