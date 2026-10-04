# Claudio y ANT-ONIO en video

Claudio (el zorro) y ANT-ONIO (la hormiga) se ven en la app como **video animado realista**. El 3D y las fotos quedan de respaldo.

## Dónde se ven

| Lugar | Archivo | Cámara |
|---|---|---|
| La mesa, con el teléfono vertical | `mobile/src/avatar3d/CuerpoMesa.tsx` | cuerpo entero |
| La mesa, con el teléfono horizontal | igual | retrato (cabeza y pecho) |
| La llamada del avatar | `mobile/src/avatar3d/CuerpoLlamada.tsx` | retrato, en el círculo |

AU-RA y Ojos no cambian. La web no tiene a Claudio ni a ANT-ONIO.

## Los clips

Son 17 por avatar, 34 en total, en `mobile/assets/avatares/video/`. Cada uno dura 5 s (120 cuadros a 24 por segundo), mide 720×1280 y va en H.264 sin audio, con *faststart* y un solo cuadro clave. Pesan de 200 a 370 KB, y los 34 juntos 9,3 MB. Van en la actualización OTA y funcionan sin red.

| Clip | Clase | Cuándo |
|---|---|---|
| `reposo` | fondo (bucle) | sin nada que hacer, o dormido |
| `escucha` | fondo | la conversación está abierta y te oye |
| `piensa` | fondo | esperando al cerebro |
| `habla` | fondo | suena su voz |
| `teclea` | fondo | su computadora en la nube trabaja en un encargo (de «empieza» o el primer «paso» hasta «termina») |
| `lee` | fondo | lee un mensaje: en la mesa, el turno usó la herramienta de correo, WhatsApp, Telegram o `leer-chat`; en la conversación, suena el sonido de hojas (`ambiente` con `papel`) |
| `espera` | fondo | 45 s en reposo, despierto y sin nada que hacer: mira alrededor 10 s y vuelve al reposo |
| `saluda` | golpe (una vez) | al aparecer en la mesa, o con el gesto `saludar`, `entrar` o `salir` |
| `senala` | golpe | cuando tocás un atajo de la mesa, o con el gesto `senalar` |
| `risa` | golpe | emoción `risa`, o un toque (ver «Los toques») |
| `sorpresa` | golpe | emoción `sorpresa`, el gesto `despertar`, un toque, o los blasters |
| `triste` | golpe | emoción `triste` o `preocupado` |
| `celebra` | golpe | emoción `orgullo`, su computadora terminó bien, o dice «¡Lo logramos!», «¡Misión cumplida!», «¡Felicidades!» |
| `asiente` | golpe | una acción de la app salió bien (el «listo» de `hecho`), se envió un mensaje, o dice «Sí», «¡Listo!», «Hecho», «Ya lo envié» |
| `niega` | golpe | una acción salió mal (el «no pude»), su computadora falló, dice «No puedo…», «Lo siento, no…», «Me temo que no», o saca el sable de luz (o lo molestan en el descanso) |
| `duda` | golpe | dice «No te entendí», «¿Me lo repetís?», «¿Cuál de los dos?» |
| `despide` | golpe | colgaste la llamada del avatar (mientras se ve «Llamada terminada»), o dice «¡Adiós!», «Nos vemos», «Hasta luego» |

**El guion** está en `mobile/src/avatares/video/guion.ts` y es puro, probado en Node.

- Entre los fondos gana lo que más se nota: `habla` > `lee` > `piensa` > `teclea` > `escucha` > `reposo`. Leer gana a pensar porque el correo se abre mientras el cerebro piensa; si le preguntás algo con la computadora trabajando, piensa primero.
- Un golpe no se repite antes de 8 s.
- Si el avatar empieza a hablar en medio de un golpe, el golpe va a su ritmo 1 s y después pide `habla`; el gesto no se corta: lo termina más rápido hasta el reposo y ahí habla (ver «El cambio de clip»). Los golpes por lo que dice llegan con la frase: asiente o niega y sigue hablando, con la boca en marcha unos 2,4 s después de la frase. Si cuando llega la frase el clip de antes iba por la mitad de su gesto, el golpe no alcanza a verse y se salta: la boca primero. (El recorrido de Windows, que sí corta el golpe, sigue con 1,8 s: `GOLPE_ANTES_DE_HABLAR_MS`; el teléfono usa `GOLPE_ANTES_DE_HABLAR_SIN_CORTE_MS`.)
- Con «reducir movimiento» no hay golpes. Los fondos nuevos sí se ven.
- Dormido (silenciado) no espera: se queda en el reposo.

**Las pistas** están en `mobile/src/avatares/video/pistas.ts`, también puras. Juntan lo que el estado del 3D no cuenta:

- `teclea` lo pone `app/ComputadoraEnVivo.tsx` con el `CompaneroPc` de siempre, que ya se apaga solo si un «termina» se pierde.
- `lee` lo ponen la mesa (`DeskScreen`, `onTools`) y el sonido de hojas de la conversación. Se apaga cuando empieza a contestar, al terminar el turno o al quitarse el sonido, y siempre a los 25 s.
- Los golpes por lo que dice salen de cada frase suya, en la mesa (`ecoMesa`) o en la conversación (`mensajeVoz`), con `golpeDeFrase`. Van de a uno: no otro antes de 8 s, para que una respuesta larga no encadene asiente, celebra y despide. La mayoría de las frases no pide ninguno: «Claro, te explico…» o «No te preocupes…» no hacen nada.
- Un golpe pedido vale 1,5 s. Un cuerpo que aparece después no hace golpes viejos.
- Las fuentes se conectan con el primer cuerpo en video y se sueltan con el último.

**La vista** está en `mobile/src/avatares/video/CuerpoVideo.tsx` y usa dos capas de `expo-av`. Solo ejecuta lo que decide la mezcla (`transicion.ts`, abajo):

- Cada clip se monta quieto (`shouldPlay={false}`, sin `positionMillis`) y se pone en marcha o cambia de ritmo con la API del reproductor (`playAsync`, `setRateAsync`). Las props de estado no cambian nunca después de montar, así que expo-av no las vuelve a aplicar a mitad de un clip.
- Un golpe avisa 900 ms antes de terminar, para que el fondo que sigue se cargue mientras el golpe llega al reposo.
- Los bordes se funden con el color de fondo del avatar.
- Si un video falla, vuelven las fotos durante el resto de la sesión.

## Los toques

Tocarlos hace cosas, y no siempre la misma. Va en `mobile/src/avatares/video/efectos/`, por fuera del cuerpo en video: `CuerpoVideo.tsx`, `guion.ts` y los clips no cambian.

| Archivo | Qué hace |
|---|---|
| `toques.ts` | El motor, puro: cuenta los toques, decide la reacción, el descanso y lo sutil. Usa reloj y azar inyectables |
| `escena.ts` | Los datos y la geometría, puros. Dónde va el sable en cada encuadre, cómo se blande, por dónde vuelan los disparos, la sacudida, los sonidos y la vibración |
| `espadaJedi.ts`, `blasters.ts`, `pintar.ts`, `pincel.ts` | El dibujo con Skia. Es un worklet que graba un SkPicture por cuadro en el hilo de la interfaz |
| `CapaEfectos.tsx` | La capa: envuelve al video, pinta encima, programa sonidos y vibración, y sacude la pantalla |

**Lo que pasa**

- **Un toque**: una onda de luz donde cayó el dedo, del color del avatar. A veces viene un golpe del video, variado por zona:
  - en la cabeza: se ríe, duda, se sorprende o asiente;
  - en el cuerpo: se ríe, celebra, se sorprende o saluda.

  Nunca repite el golpe anterior ni pide uno que el guion no haría (8 s). Tampoco pide más de uno cada 2,6 s, así tocar seguido no encadena fundidos. La voz es la de siempre: el `onTap` de la mesa.
- **Cuatro toques en 2,2 s** (la misma ventana del «ya, ya» de la mesa): saca el **sable de luz** o empiezan los **blasters**.
  - Claudio prefiere el sable (70 %) y ANT-ONIO los blasters (70 %). Nunca sale tres veces seguidas lo mismo.
  - Con el sable el video hace `niega`, que no mueve las manos, así el sable sigue en la mano. Con los blasters hace `sorpresa`.
  - La mesa dice una frase corta de molesto. Con el sable es una de `annoy` («Oye… ¿qué haces?», «Ya, ya. Con cuidado.»); con los blasters, una de `angry` («¡Basta! Pium, pium, pium.»). Son las frases de siempre de `voice-lines.json` y salen de la caché de audio después de la primera vez. Esa ráfaga llama a `onRafaga` (`DeskScreen.onRafagaVideo`) en vez del `onTap` del cuarto toque.
- **Una secuencia a la vez.** Los toques durante el sable o los blasters solo hacen la onda. Después vienen 12 s de descanso: otra ráfaga en ese rato solo lo molesta (onda naranja y `niega`, o `duda` si ya negó).
- **El blaster o el sable de la mesa** (el comando de voz «blaster» o «sable de luz», o el enojo de muchos toques: `attack` de DeskScreen) también se ven en el video. Usan el sonido que ya puso la mesa y no se encima con otra secuencia.

**El sable**

- Dura 3,2 s:
  1. aparece la empuñadura metálica en la mano;
  2. la hoja crece con un destello;
  3. amaga hacia afuera, da un tajo grande cruzando el cuerpo y vuelve;
  4. lo sostiene con un temblor de pulso;
  5. se apaga y la empuñadura se va.
- La hoja va en cuatro capas: un resplandor ancho y difuso, el brillo, el color y un núcleo casi blanco. Detrás deja una estela en abanico que se apaga hacia lo más viejo. El plasma parpadea apenas.
- El de Claudio es verde, como su corona. El de ANT-ONIO es azul, como los ribetes de la chaqueta.
- Suena `saber` al encenderse y `whoosh` en cada tajo y al apagarse. Vibra medio al encender y suave en los tajos.

**Los blasters**

- Son 8 disparos en 2,6 s, de borde a borde y alternando lados.
- Cada uno sale con un fogonazo y cruza como un trazo rojo con resplandor, estela y núcleo claro. Revienta en el borde de enfrente con un destello, un anillo de choque y chispas que saltan hacia adentro y caen.
- Cada impacto sacude la pantalla hasta 3,5 px.
- Suena `blaster` y vibra suave con cada disparo.

**Dónde va el sable.** `AGARRES` (`escena.ts`) dice dónde está la mano en el cuadro del video (0..1 sobre 720×1280), medido en la foto base y en `niega`. `encuadrar` (el mismo de CuerpoVideo) lo lleva a la caja en pantalla, así queda en la mano en cualquier tamaño.

| Lugar | Claudio | ANT-ONIO |
|---|---|---|
| Mesa vertical (cuerpo entero) | mano derecha de la pantalla (0,78; 0,71) | mano izquierda (0,24; 0,87) |
| Mesa acostada (retrato) | la mano queda bajo el borde: el sable entra desde abajo a la derecha | lo mismo, a la izquierda |
| Llamada (círculo) | entra más cerca del centro, para que no lo corte el círculo | ídem |

**Según el estado**

| Estado | Qué hace |
|---|---|
| Tranquilo en la mesa | Todo: sonidos, vibración, golpes, frase y la secuencia entera |
| Habla, oye a la persona, piensa, duerme | Sutil: onda chica, sin sonido, sin golpes, sin frase. La ráfaga es una versión chica y corta (1,4 a 1,7 s), sin sacudida |
| Conversación o llamada abierta | Sutil, aunque la ráfaga haya empezado tranquila |
| La llamada del avatar (el círculo) | Siempre sutil y recortado al círculo. El toque lo sigue recibiendo la cara: el doble toque silencia como siempre. `CuerpoLlamada` solo lo mira en la fase de captura y devuelve `false` |
| «Reducir movimiento» | Quieto: el sable aparece y se va con un fundido, sin blandir, sin estela ni temblor. Los disparos son trazos quietos que aparecen y se van despacio. No hay sacudida, y los golpes ya los quita el guion |
| Tapado (otra pantalla, la llamada encima) o desmontado | Se corta: ningún reloj, sonido ni animación queda programado |

Lo sutil se decide por cómo estaba al **empezar** la ráfaga. El primer toque puede hacerlo hablar (la frase del toque de la mesa), y eso no le quita el sable al cuarto.

Los sonidos son los de `lib/sfx.ts`: respetan el ajuste «sonidos» y no suenan en una llamada. El interruptor de silencio del iPhone no se puede leer sin un módulo nativo nuevo: la app ya reproduce sus efectos con `playsInSilentModeIOS`. La vibración es de `expo-haptics`. Nada toca el micrófono ni la voz.

**Rendimiento.**

- Cada cuadro se dibuja en el hilo de la interfaz y React no se re-renderiza durante la animación.
- El lienzo solo está montado mientras hay algo que pintar, más 3 s.
- Quieto no gasta: el cuadro solo se vuelve a grabar cuando cambia un tiempo.
- La capa no toma el dedo: todo va con `pointerEvents="none"`, y el toque sigue siendo del Pressable de CuerpoMesa.
- No hay saltos de diseño: la capa es absoluta.
- Si el dibujo falla, los efectos se apagan por el resto de la sesión, el avatar sigue igual y queda una miga.

**Pruebas**

```
cd mobile && npx tsx src/avatares/pruebas/efectos.prueba.mjs   # el motor y la escena (en calidad-movil.yml)
npx tsx scripts/qa/efectos-avatar.ts [dirSalida] [dirCuadros]   # el dibujo con CanvasKit sobre cuadros reales
```

`efectos-avatar.ts` pinta, con el mismo `pintar.ts` del teléfono, cada caso sobre un cuadro real del clip (`dirCuadros`: PNG `<avatar>-<clip>.png` de 720×1280). Saca una hoja, los cuadros de la animación cada 40 ms y comprobaciones de píxeles: el núcleo blanco, el resplandor del color de cada uno, la empuñadura en la mano, el disparo rojo y nada de estela con «reducir movimiento».

## El cambio de clip (sin saltos)

José vio que el avatar «glitchea» al cambiar de gesto (4-oct). Esto es lo que había y lo que se cambió.

### Lo que había (medido)

Las medidas son la diferencia media por píxel (0-255) en 360×640, contra la foto base (el cuadro 0 del reposo). Entre dos codificaciones de la misma foto da 1,1 a 1,4: ese es el piso del ruido.

1. **Las puntas de los clips están bien.** El primer y el último cuadro de los 34 están en la foto base: 1,05 a 1,62 (SSIM 0,97 a 0,99). Encuadre, escala, brillo y color iguales en todos (brillo ±0,05).
2. **El medio de cada clip, no.** De 0,5 s a 4,2 s cada uno hace su gesto y se aparta de la foto base: 7 a 20 (el máximo de cada clip). Por ejemplo, `piensa` (la mano en el mentón) 14,7; `escucha` (la cámara se acerca) 14,1; `celebra` 20,5. Entre dos cuadros seguidos del mismo clip hay 0,5 a 5.
3. **El reproductor cambiaba en cualquier momento.** El clip nuevo entraba desde su cuadro 0 apenas cargaba, con un fundido lineal de 220 ms. Si el viejo iba por la mitad, durante el fundido se veían dos zorros encimados: 10 a 15 de diferencia en los casos de la evidencia. Un golpe que se cortaba a 1,8 s para hablar: 7 a 16,7. **Esto era el glitch.**
4. **Carreras en las capas** (`CuerpoVideo.tsx` de antes):
   - `onReadyForDisplay` de expo-av en Android llega al cargar (`VideoView.java`, en `onLoadSuccess`), antes del primer cuadro. Cuando la capa nueva iba abajo, se ponía entera y la de arriba se desvanecía: si el primer cuadro todavía no estaba, se veía el fondo por un instante.
   - Si no avisaba en 2,5 s, se fundía igual, aunque la capa estuviera vacía.
   - Un pedido en medio de un fundido ponía la capa vieja a 0 de golpe: un fogonazo del fondo.
5. **La costura de los bucles.** Los últimos cuadros de cada fondo están casi quietos (0,02 a 0,3 entre cuadros) y al volver al cuadro 0 había un salto de 1,2 a 1,6. Es textura: el final del GOP comprimido contra el cuadro clave nuevo.
6. **El «bombeo» de los cuadros clave.** Cada 2 s (cuadros 48 y 96) la textura saltaba. En los momentos quietos se nota: hasta 17 veces el salto normal en `claudio-duda` y 11 en `antonio-sorpresa`.

### Lo que se cambió

**La mezcla**, en `mobile/src/avatares/video/transicion.ts`, es pura y está probada:

- **Cambia solo en el reposo.** `reposos.ts` dice, para cada clip, cuánto dura su reposo del principio y desde dónde empieza el del final (a ≤ 2,5 de su cuadro 0). Por ejemplo, `claudio-piensa` está en reposo hasta 0,42 s y desde 4,46 s.
  - Si el clip de ahora está en reposo, el nuevo entra ya.
  - Si no, el de ahora termina su gesto hasta el reposo. Mientras tanto, el nuevo se carga quieto en su cuadro 0 y arranca justo al llegar.
  - Termina a su ritmo si no hay apuro. Si lo hay, acelera para llegar a tiempo: un fondo nuevo, hasta 2× para llegar en ~2 s; un golpe o hablar, hasta 2,5× para llegar en ~0,9 s.
  - Al llegar vuelve a su ritmo.
- **Nunca muestra una capa que no dibuja.** El fundido arranca cuando la posición del clip nuevo avanzó 60 ms en marcha, no con `onReadyForDisplay`. Dura 260 ms, con curva suave, siempre sobre la vieja entera.
- **Los pedidos que llegan a destiempo:**
  - Uno que llega en medio de un fundido espera a que termine.
  - Uno que llega mientras el nuevo carga, o mientras arranca invisible, lo reemplaza: nadie lo vio.
  - Lo que se ve no se vuelve a montar.
- **Si un clip no arranca:** si no carga o no dibuja en 2,5 s, se monta otra vez. Si tampoco, se queda el de antes; si era un golpe, el guion no se queda esperando.
- **«Reducir movimiento»:** nunca acelera. Si empezó a hablar y el reposo queda a más de 1,5 s, funde ahí mismo, más lento (450 ms).

**Los clips**, rehechos con `mobile/scripts/avatares-video/procesar.py` a partir de los originales (guardados fuera del repo):

- **La cola.** Los últimos 8 cuadros (1/3 s) se funden con curva suave hacia el cuadro 0 del mismo clip. El último cuadro queda en la foto base: el bucle cierra sin salto y cada golpe termina exactamente en reposo. El cuadro 0 no se toca.
- **Un solo cuadro clave** (el 0): sin bombeo a mitad del clip. Ya no hace falta buscar dentro de un clip, porque siempre arranca en el 0.
- **x264 sin dejar derivar los cuadros quietos** (`fast-pskip=0:dct-decimate=0:deadzone-inter=6:deadzone-intra=6`).
- Todo en YUV, sin pasar por RGB: brillo igual (±0,02). Contra el original dan 44 a 45 dB de media (mínimo 40,1).

### Antes y después

| Medida | Antes | Después |
|---|---|---|
| Diferencia de pose durante el fundido de un cambio (casos de la evidencia) | 10,2 a 15,0 | 1,7 a 2,3 (piso del ruido) |
| Cambios fuera del reposo, en 3 min de pedidos al azar (prueba) | casi todos | 0 (con «reducir movimiento», solo al empezar a hablar lejos del reposo) |
| Primer / último cuadro contra la foto base | 1,05–1,34 / 1,22–1,62 | 1,13–1,43 / 0,84–1,47 |
| Costura del bucle (fondos) | 1,21–1,62 (37,7–39,3 dB) | 0,84–1,13 (39,3–40,2 dB) |
| Costura del bucle, solo forma (90×160) | 0,84–1,25 | 0,43–0,62 |
| Bombeo de los cuadros clave a mitad del clip | hasta 17× el salto normal | ninguno (un solo cuadro clave) |
| Peso de los 34 | 10,3 MB | 9,3 MB |
| Habla después de un golpe | a 1,8 s, cortando el gesto | ~2,4 s, con el gesto terminado (acelerado) |
| Habla desde un fondo a la mitad | en cuanto cargaba (~0,3 s), con salto | al llegar al reposo: ~0,9 s (máximo ~1,8 s) |

Lo que queda de la costura es la textura nueva del cuadro clave (~40 dB entre dos cuadros), del orden del ruido de compresión. Bajarlo pediría archivos más pesados.

Las medidas, la evidencia (tiras PNG antes/después, MP4 lado a lado y GIF) y los originales se generaron fuera del repo con los scripts de `mobile/scripts/avatares-video/`:

```
pip install numpy pillow scikit-image imageio-ffmpeg
python mobile/scripts/avatares-video/medir.py <carpeta> medidas.json     # puntas, costura, deriva, encuadre
python mobile/scripts/avatares-video/procesar.py <originales> mobile/assets/avatares/video 29
python mobile/scripts/avatares-video/reposos.py mobile/assets/avatares/video mobile/src/avatares/video/reposos.ts 2.5
```

Al rehacer un clip, hay que correr también `reposos.py`. La prueba revisa que la tabla tenga los 34 clips y que la duración de cada MP4 coincida con ella.

### Lo que solo se ve en el teléfono

- Cuánto tarda en cargar un clip (se supuso 120-370 ms) y que `playAsync` desde quieto arranque sin saltar el primer cuadro.
- Que `setRateAsync` a 2-2,5× se vea fluido en el Samsung de José (ExoPlayer salta cuadros si no da abasto).
- Que el bucle de ExoPlayer (`REPEAT_MODE_ALL`) no meta una pausa en la costura.

## Calidad de los clips generados

Las mediciones de cuando se generaron, en PSNR entre cuadros, con los originales:

| Medida | Resultado | Referencia |
|---|---|---|
| Costura del bucle (primer cuadro contra último) | 36,4 a 39,5 dB en los 18 primeros; 36,7 a 39,5 dB en los 16 nuevos (35,8 a 37,8 dB ya comprimidos) | A mitad de un clip, el mismo cuadro da unos 18 dB |
| Inicio de cada clip contra inicio del reposo | 37 a 39 dB; 36,4 a 37,0 dB en los nuevos | Todos parten de la misma pose |
| Salto mayor entre dos cuadros seguidos (los nuevos) | 22 a 30 dB | Sin cortes: el peor es `celebra`, que mueve rápido los brazos, y se reparte parejo en todo el gesto |

## Cómo se hicieron

Se hicieron en ElevenLabs, en el flujo «Claudio y ANT-ONIO» (`XTd06qsdi9FFs8nh8yHk`).

1. **Fotos base 9:16**, 720×1280. Se generaron con GPT Image 2 a partir de las referencias de José: el zorro de lentes y suéter con corona, y la hormiga de lentes y chaqueta AU-RA.
2. **Cada clip** se generó con Gemini Omni Flash 1.1:
   - 9:16, 720p, 5 s;
   - la foto base como **primer y último cuadro**: el nodo de imagen de Claudio es `Ilbk4aSr3fMUiZHtt2j2` y el de ANT-ONIO, `jMHDg3OumqReBU7Sm2Mv`, conectados a los puertos `start_frame` y `end_frame`;
   - un texto que describe solo el movimiento y termina con «Locked static camera… starts and ends in exactly the same pose… plain dark charcoal background».

   Cada nodo lleva el nombre de su archivo (`claudio-teclea`, `antonio-lee`…). Ojo: si el nodo se crea con la foto conectada desde el principio, la toma como referencia (`images`) y no como primer y último cuadro. Hay que crearlo sin conectar, conectar los dos puertos a mano y poner 9:16 y 5 s, porque viene en 16:9 y 10 s y costaría el doble.
3. **Compresión.** Desde el 4-oct se hace con `mobile/scripts/avatares-video/procesar.py`, que también pone la cola hacia la foto base y deja un solo cuadro clave (ver «El cambio de clip»). Antes se usaba esto:

   ```
   ffmpeg -i original.mp4 -an -c:v libx264 -profile:v main -level 3.1 -pix_fmt yuv420p \
     -crf 29 -preset slow -g 48 -movflags +faststart mobile/assets/avatares/video/<avatar>-<clip>.mp4
   ```

Para agregar o rehacer un clip:

1. Generalo con la misma foto base como primer y último cuadro.
2. Guardá el original fuera del repo y procesalo con `procesar.py <originales> mobile/assets/avatares/video 29 <avatar>-<clip>.mp4`.
3. Agregalo a `CLIPS_VIDEO` (en `guion.ts`) y a `clips.ts`.
4. Volvé a generar `reposos.ts` con `reposos.py`.
5. Corré la prueba, que revisa que estén los 34 archivos, su peso, el *faststart*, que `clips.ts` los pida y que `reposos.ts` coincida con cada MP4:

   ```
   cd mobile && npx tsx src/avatares/pruebas/video.prueba.mjs
   ```

Antes de meter un clip, revisalo: tres o cuatro cuadros a la vista (el personaje correcto, el fondo carbón liso, la misma pose al principio y al final) y la costura medida. Si el primer cuadro no es la foto base, la costura baja a unos 22 dB aunque a la vista parezca igual.

Costo:

- Los 18 primeros: unos US$9,2 (US$0,51 cada uno). Hubo que reintentar dos clips: el modelo los cortó dos veces y salieron al tercer intento, con el texto reformulado.
- Los 16 nuevos (2-oct): US$8,68, o sea 17 generaciones de US$0,51. Hubo que reintentar uno, `claudio-teclea`: en el primer intento el clip no arrancó en la foto base (costura 22 dB). Salió al segundo intento, con el texto reformulado.
