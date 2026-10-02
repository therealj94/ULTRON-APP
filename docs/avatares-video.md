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

Son 17 por avatar, 34 en total, en `mobile/assets/avatares/video/`. Cada uno dura 5 s, mide 720×1280 y va en H.264 sin audio, con *faststart*. Pesa unos 300 KB, y los 34 juntos 10,3 MB. Van en la actualización OTA y funcionan sin red.

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
| `risa` | golpe | emoción `risa`, o cuando lo tocás |
| `sorpresa` | golpe | emoción `sorpresa`, o con el gesto `despertar` |
| `triste` | golpe | emoción `triste` o `preocupado` |
| `celebra` | golpe | emoción `orgullo`, su computadora terminó bien, o dice «¡Lo logramos!», «¡Misión cumplida!», «¡Felicidades!» |
| `asiente` | golpe | una acción de la app salió bien (el «listo» de `hecho`), se envió un mensaje, o dice «Sí», «¡Listo!», «Hecho», «Ya lo envié» |
| `niega` | golpe | una acción salió mal (el «no pude»), su computadora falló, o dice «No puedo…», «Lo siento, no…», «Me temo que no» |
| `duda` | golpe | dice «No te entendí», «¿Me lo repetís?», «¿Cuál de los dos?» |
| `despide` | golpe | colgaste la llamada del avatar (mientras se ve «Llamada terminada»), o dice «¡Adiós!», «Nos vemos», «Hasta luego» |

**El guion** está en `mobile/src/avatares/video/guion.ts` y es puro, probado en Node.

- Entre los fondos gana lo que más se nota: `habla` > `lee` > `piensa` > `teclea` > `escucha` > `reposo`. Leer gana a pensar porque el correo se abre mientras el cerebro piensa; si le preguntás algo con la computadora trabajando, piensa primero.
- Un golpe no se repite antes de 8 s.
- Si el avatar empieza a hablar en medio de un golpe, el golpe sigue hasta 1,8 s y después pasa a `habla`. Los golpes por lo que dice llegan con la frase, así que asiente o niega 1,8 s y sigue hablando.
- Con «reducir movimiento» no hay golpes. Los fondos nuevos sí se ven.
- Dormido (silenciado) no espera: se queda en el reposo.

**Las pistas** están en `mobile/src/avatares/video/pistas.ts`, también puras. Juntan lo que el estado del 3D no cuenta:

- `teclea` lo pone `app/ComputadoraEnVivo.tsx` con el `CompaneroPc` de siempre, que ya se apaga solo si un «termina» se pierde.
- `lee` lo ponen la mesa (`DeskScreen`, `onTools`) y el sonido de hojas de la conversación. Se apaga cuando empieza a contestar, al terminar el turno o al quitarse el sonido, y siempre a los 25 s.
- Los golpes por lo que dice salen de cada frase suya, en la mesa (`ecoMesa`) o en la conversación (`mensajeVoz`), con `golpeDeFrase`. Van de a uno: no otro antes de 8 s, para que una respuesta larga no encadene asiente, celebra y despide. La mayoría de las frases no pide ninguno: «Claro, te explico…» o «No te preocupes…» no hacen nada.
- Un golpe pedido vale 1,5 s. Un cuerpo que aparece después no hace golpes viejos.
- Las fuentes se conectan con el primer cuerpo en video y se sueltan con el último.

**La vista** está en `mobile/src/avatares/video/CuerpoVideo.tsx` y usa dos capas de `expo-av`:

- El clip nuevo arranca invisible y se funde encima en 220 ms cuando ya tiene su primer cuadro.
- Si el primer cuadro tarda más de 700 ms, se funde igual.
- Un golpe avisa 320 ms antes de terminar, para que el fondo que sigue ya esté listo.
- Todos los clips empiezan y terminan en la misma pose, así que cualquier cambio engancha sin salto.
- Los bordes se funden con el color de fondo del avatar.
- Si un video falla, vuelven las fotos durante el resto de la sesión.

## Calidad medida

Las mediciones son PSNR entre cuadros.

| Medida | Resultado | Referencia |
|---|---|---|
| Costura del bucle (primer cuadro contra último) | 36,4 a 39,5 dB en los 18 primeros; 36,7 a 39,5 dB en los 16 nuevos (35,8 a 37,8 dB ya comprimidos) | Invisible; a mitad de un clip, el mismo cuadro da unos 18 dB |
| Inicio de cada clip contra inicio del reposo | 37 a 39 dB; 36,4 a 37,0 dB en los nuevos | Todos parten de la misma pose |
| Compresión (CRF 29) contra el original | 42,5 dB | |
| Salto mayor entre dos cuadros seguidos (los nuevos) | 22 a 30 dB | Sin cortes: el peor es `celebra`, que mueve rápido los brazos, y se reparte parejo en todo el gesto |

La costura de cada clip nuevo, ya comprimido:

| Clip | Claudio | ANT-ONIO |
|---|---|---|
| `teclea` | 282 KB · 37,1 dB | 297 KB · 35,8 dB |
| `lee` | 290 KB · 37,1 dB | 289 KB · 37,2 dB |
| `espera` | 330 KB · 37,4 dB | 305 KB · 36,7 dB |
| `celebra` | 369 KB · 36,8 dB | 394 KB · 36,1 dB |
| `asiente` | 277 KB · 37,8 dB | 277 KB · 37,3 dB |
| `niega` | 305 KB · 37,5 dB | 277 KB · 36,2 dB |
| `duda` | 317 KB · 37,7 dB | 286 KB · 36,4 dB |
| `despide` | 280 KB · 36,9 dB | 298 KB · 37,3 dB |

## Cómo se hicieron

Se hicieron en ElevenLabs, en el flujo «Claudio y ANT-ONIO» (`XTd06qsdi9FFs8nh8yHk`).

1. **Fotos base 9:16**, 720×1280. Se generaron con GPT Image 2 a partir de las referencias de José: el zorro de lentes y suéter con corona, y la hormiga de lentes y chaqueta AU-RA.
2. **Cada clip** se generó con Gemini Omni Flash 1.1:
   - 9:16, 720p, 5 s;
   - la foto base como **primer y último cuadro**: el nodo de imagen de Claudio es `Ilbk4aSr3fMUiZHtt2j2` y el de ANT-ONIO, `jMHDg3OumqReBU7Sm2Mv`, conectados a los puertos `start_frame` y `end_frame`;
   - un texto que describe solo el movimiento y termina con «Locked static camera… starts and ends in exactly the same pose… plain dark charcoal background».

   Cada nodo lleva el nombre de su archivo (`claudio-teclea`, `antonio-lee`…). Ojo: si el nodo se crea con la foto conectada desde el principio, la toma como referencia (`images`) y no como primer y último cuadro. Hay que crearlo sin conectar, conectar los dos puertos a mano y poner 9:16 y 5 s, porque viene en 16:9 y 10 s y costaría el doble.
3. **Compresión**, con un ffmpeg cualquiera:

   ```
   ffmpeg -i original.mp4 -an -c:v libx264 -profile:v main -level 3.1 -pix_fmt yuv420p \
     -crf 29 -preset slow -g 48 -movflags +faststart mobile/assets/avatares/video/<avatar>-<clip>.mp4
   ```

Para agregar o rehacer un clip:

1. Generalo con la misma foto base como primer y último cuadro.
2. Comprimilo con el comando de arriba.
3. Agregalo a `CLIPS_VIDEO` (en `guion.ts`) y a `clips.ts`.
4. Corré la prueba, que revisa que estén los 34 archivos, su peso, el *faststart* y que `clips.ts` los pida:

   ```
   cd mobile && npx tsx src/avatares/pruebas/video.prueba.mjs
   ```

Antes de meter un clip, revisalo: tres o cuatro cuadros a la vista (el personaje correcto, el fondo carbón liso, la misma pose al principio y al final) y la costura medida. Si el primer cuadro no es la foto base, la costura baja a unos 22 dB aunque a la vista parezca igual.

Costo:

- Los 18 primeros: unos US$9,2 (US$0,51 cada uno). Hubo que reintentar dos clips: el modelo los cortó dos veces y salieron al tercer intento, con el texto reformulado.
- Los 16 nuevos (2-oct): US$8,68, o sea 17 generaciones de US$0,51. Hubo que reintentar uno, `claudio-teclea`: en el primer intento el clip no arrancó en la foto base (costura 22 dB). Salió al segundo intento, con el texto reformulado.
