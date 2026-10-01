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

Son 9 por avatar, 18 en total, en `mobile/assets/avatares/video/`. Cada uno dura 5 s, mide 720×1280 y va en H.264 sin audio, con *faststart*. Pesa unos 300 KB, y los 18 juntos 5,3 MB. Van en la actualización OTA y funcionan sin red.

| Clip | Clase | Cuándo |
|---|---|---|
| `reposo` | fondo (bucle) | sin nada que hacer, o dormido |
| `escucha` | fondo | la conversación está abierta y te oye |
| `piensa` | fondo | esperando al cerebro |
| `habla` | fondo | suena su voz |
| `saluda` | golpe (una vez) | al aparecer en la mesa, o con el gesto `saludar`, `entrar` o `salir` |
| `senala` | golpe | cuando tocás un atajo de la mesa, o con el gesto `senalar` |
| `risa` | golpe | emoción `risa`, o cuando lo tocás |
| `sorpresa` | golpe | emoción `sorpresa`, o con el gesto `despertar` |
| `triste` | golpe | emoción `triste` o `preocupado` |

**El guion** está en `mobile/src/avatares/video/guion.ts` y es puro, probado en Node.

- Un golpe no se repite antes de 8 s.
- Si el avatar empieza a hablar en medio de un golpe, el golpe sigue hasta 1,8 s y después pasa a `habla`.
- Con «reducir movimiento» no hay golpes.

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
| Costura del bucle (primer cuadro contra último) | 36,4 a 39,5 dB en los 18 clips | Invisible; a mitad de un clip, el mismo cuadro da unos 18 dB |
| Inicio de cada clip contra inicio del reposo | 37 a 39 dB | Todos parten de la misma pose |
| Compresión (CRF 29) contra el original | 42,5 dB | |

## Cómo se hicieron

Se hicieron en ElevenLabs, en el flujo «Claudio y ANT-ONIO» (`XTd06qsdi9FFs8nh8yHk`).

1. **Fotos base 9:16**, 720×1280. Se generaron con GPT Image 2 a partir de las referencias de José: el zorro de lentes y suéter con corona, y la hormiga de lentes y chaqueta AU-RA.
2. **Cada clip** se generó con Gemini Omni Flash 1.1:
   - 9:16, 720p, 5 s;
   - la foto base como **primer y último cuadro**;
   - un texto que describe solo el movimiento y termina con «Locked static camera… starts and ends in exactly the same pose… plain dark charcoal background».
3. **Compresión**, con un ffmpeg cualquiera:

   ```
   ffmpeg -i original.mp4 -an -c:v libx264 -profile:v main -level 3.1 -pix_fmt yuv420p \
     -crf 29 -preset slow -g 48 -movflags +faststart mobile/assets/avatares/video/<avatar>-<clip>.mp4
   ```

Para agregar o rehacer un clip:

1. Generalo con la misma foto base como primer y último cuadro.
2. Comprimilo con el comando de arriba.
3. Agregalo a `CLIPS_VIDEO` (en `guion.ts`) y a `clips.ts`.
4. Corré la prueba, que revisa que estén los 18 archivos, su peso, el *faststart* y que `clips.ts` los pida:

   ```
   cd mobile && npx tsx src/avatares/pruebas/video.prueba.mjs
   ```

Costo: unos US$9,2 por 18 clips (US$0,51 cada uno). Hubo que reintentar dos clips: el modelo los cortó dos veces y salieron al tercer intento, con el texto reformulado.
