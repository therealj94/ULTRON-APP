# ADR — Muletillas al escuchar («mjm», «ajá», «ya», «okey») en la mesa de voz del teléfono

- **Estado:** aceptada (6-oct-2026), encendida por omisión solo en Android con cancelación de eco; revisable con lo que
  diga un teléfono de verdad (ver «Qué la cambiaría»).
- **Contexto:** José, 6-oct: «las muletillas agregarlas» / «que no se sepa que es AI». La lógica ya existía
  (`mobile/src/lib/asentir.ts`, apagada y sin conectar) porque, mientras la persona habla, el oído Turbo abre el
  micrófono SIN cancelación de eco: un «mjm» por la bocina alargaba el silencio que cierra la frase y Turbo lo
  escribía como si lo dijera la persona. Esta decisión es sobre código y pruebas sin teléfono: no acredita cómo suena
  ni el comportamiento del cancelador en un equipo real.

## Decisión

1. **El micrófono de escucha** sigue con la fuente de DICTADO (`VOICE_RECOGNITION`) y, con las muletillas encendidas,
   lleva pegado el `AcousticEchoCanceler` del teléfono (fuente nueva `reconocimiento_eco` en `modules/aura-mic`, sin
   supresor de ruido ni modo llamada). No se usa `VOICE_COMMUNICATION` al escuchar: está documentado que en el
   Samsung de José ese modo «tardaba en oír» (`lib/storage.ts`, «Interrumpir hablando» quedó apagado por omisión por
   eso). El módulo dice si el cancelador quedó **activo** en la grabación de ahora (`ecoActivo()`); sin eso, ninguna
   muletilla.
2. **El tramo del «mjm» se ignora** (`turboMotor.ignorarTramo`): mientras suena (duración del clip + 200 ms), el oído
   no lo cuenta como voz, no mide con él el ruido del cuarto y a Turbo le manda silencio del mismo largo. Ese rato
   cuenta como silencio: la frase se cierra exactamente cuando se habría cerrado sin él. Si la persona retoma encima
   (su voz pasa clara por encima de lo que se cuela: 8 dB sobre el umbral y a no más de 6 dB de su propia voz), el
   tramo se corta y su voz sigue normal.
3. **Cuándo:** ≥ 7 s hablando, pausa de 350–750 ms a media idea (coma o palabra colgante; con el sondeo del fin de
   turno, solo `incompleto`), y solo si el clip entero acaba antes del silencio que cerraría la frase. Uno cada 10 s,
   dos por frase, nunca dos iguales seguidos, nunca en temas delicados, con AU-RA hablando o pensando, en llamada,
   con el micrófono silenciado o fuera de la mesa.
4. **Cómo suena:** por el canal de efectos (`lib/sfx.ts`, volumen 0,35), nunca por la voz de AU-RA: no pausa el
   micrófono, no entra en «AU-RA hablando» ni en `lib/interrupcion.ts`, no queda en lo dicho ni mueve la boca. Si AU-RA
   empieza a hablar, el clip se calla.
5. **El audio es la misma voz del avatar:** no hay clips en la APK; la primera vez se piden por `GET /api/tts` (la ruta
   de siempre, voz del avatar e idioma de ahora; no se crea ni modifica ninguna voz de ElevenLabs) y se guardan en el
   disco del teléfono por avatar e idioma (`documentDirectory/asentir-v1/`). Solo se guardan si los hizo ElevenLabs
   (no la voz de respaldo) y si duran menos de 1 s.
6. **Lo que se coló:** solo si el tramo se cortó, la palabra queda anotada y `quitarDelFinal` la saca del texto final
   (y de los parciales y la especulada). Si sonó entero, a Turbo le llegó silencio y no se toca nada: un «ya» de la
   persona queda.
7. **Encendido:** por omisión solo Android + micrófono crudo + cancelador disponible. iOS, nunca (no hay micrófono
   crudo con el que ignorar el tramo, y reproducir con el micrófono abierto puede cambiar la sesión de audio y cortar
   la grabación; no hay prueba en un iPhone que diga lo contrario). Los oídos «Teléfono» y «Nube», tampoco.

## Riesgos

- **El cancelador pegado a la fuente de dictado puede no hacer nada** en algunos teléfonos (su referencia de la bocina
  depende del fabricante) o, en otros, empeorar un poco el reconocimiento. El tramo ignorado cubre lo primero; lo
  segundo solo se ve en el teléfono: si pasa, se apaga (abajo) y el micrófono vuelve a la fuente de siempre.
- **La persona retoma muy bajito encima del «mjm»:** queda por debajo del umbral del tramo y sus primeros ~100–300 ms
  se tratan como silencio. El «mjm» cae a media idea y la frase nunca se cierra dentro del tramo (el clip tiene que
  acabar antes del cierre), así que lo peor es una sílaba mal oída, no una frase partida.
- **Cómo suena:** la voz puede leer «Mjm.» como algo que no es un murmullo. Lo que dura más de 1 s se descarta solo;
  lo que dure menos y suene raro solo se oye en el teléfono.
- **Costo:** 4 palabras por avatar e idioma, una vez (cuentan en la voz de ElevenLabs del miembro como cualquier
  frase).

## Cómo apagarlo

- **Para todos, sin APK:** `AURA_ASENTIR=0` en el servidor (`server/movil-config.ts`, `GET /api/movil/config`). El
  teléfono lo lee al entrar a la mesa y cada 10 min; apaga las muletillas y devuelve el micrófono a la fuente de
  dictado sin cancelador.
- **Una persona:** Ajustes → Voz y oído → «Muletillas al escuchar» (`aura.asentir` en el teléfono).
- **Del todo, en código:** `decidirAsentir` en `mobile/src/lib/asentir.ts`.

## Pruebas

- `tests/asentir.test.ts`: las reglas (cuándo, cuánto, el cierre, el sondeo, la decisión de encendido, los textos).
- `tests/muletillas.test.ts`: la orquesta con el oído Turbo real y la bocina que se cuela al micrófono; incluye lo de
  antes (sin el tramo, la frase se cerraba 300 ms más tarde y el «mjm» le llegaba a Turbo).
- `mobile/pruebas/muletillas/todas.sh`: de punta a punta con la fachada del oído, los clips por avatar, el canal de
  efectos, la interrupción intacta y el interruptor del servidor.
- `tests/movil-config.test.ts`: `AURA_ASENTIR`.

## Qué la cambiaría

Una prueba en un teléfono real que muestre que el «mjm» se cuela pese al cancelador (subir `margenTramoDb` o apagar
por omisión), que el cancelador en dictado empeora el reconocimiento (sacar la capa 1 y quedarse con el tramo, o
apagar), o que en un iPhone reproducir con el micrófono abierto no corta la grabación (abrir iOS con el reconocedor
del teléfono, sin tramo, lo que exigiría otra forma de no oír el «mjm»).
