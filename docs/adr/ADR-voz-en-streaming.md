# ADR — Voz en streaming en la app: PCM por /api/tts/pcm y AudioTrack nativo, con expo-av de respaldo

- **Estado:** aceptada (6-oct-2026, app 5.5.0), revisable con la evidencia de «Qué la cambiaría».
- **Alcance:** la voz de la mesa en la app Android (`speak` y el locutor por frases `StreamSpeaker` de
  `mobile/src/lib/tts.ts`). Esto es una decisión sobre código y pruebas sin teléfono: las latencias de abajo son
  simuladas (ElevenLabs falso, AudioTrack falso); no acredita lo que pase en un teléfono de verdad.

## Problema

Hasta 5.4, cada frase se bajaba ENTERA a disco (`FileSystem.downloadAsync` sobre `/api/tts`, que además pide los
tiempos por letra a ElevenLabs con `/with-timestamps` y espera la síntesis completa) y recién entonces sonaba con
expo-av. El primer sonido esperaba: síntesis completa de la primera frase + descarga + `createAsync` + el primer
aviso de expo-av. La primera frase ya va con el modelo rápido (`ELEVENLABS_MODELO_PRIMERA`), pero el archivo entero
sigue en el camino crítico, y cada frase siguiente arranca con un hueco (otro `createAsync` y otro play).

## Decisión

1. **Servidor — `/api/tts/pcm`** (`server/voz-pcm.ts`, `abrirVozPcm` en `server/voz.ts`). La MISMA locución que
   `/api/tts` (misma voz por avatar e idioma, modelo de `modeloDeLocucion`, guion, vecinos y tono: `pedidoEleven`),
   pedida a ElevenLabs por `/stream` con `output_format=pcm_22050` (`ELEVENLABS_PCM_HZ`: 16000/22050/24000) y
   reenviada tal cual llega, en trozos (chunked). Cabeceras: `Content-Type: audio/pcm` (16 bits little-endian mono,
   sin cabecera WAV) y `X-Ultron-Pcm-Hz`. No se cambian voces ni agentes de ElevenLabs.
   - Mismas puertas que `/api/tts/stream`: ruta de voz abierta exacta (`RUTAS_SIN_CEREBRO`), cupo `limitar(60,
     60_000, 'voz')` compartido, minutos de ElevenLabs del miembro (`anotarVoz`; sin minutos → Voicebox).
   - Caché propia (la clave lleva el formato: un MP3 no se sirve como PCM), en memoria y en S3 para las frases
     conocidas, igual que la de siempre. **Solo se guarda lo que llegó entero**; lo privado no se guarda.
   - Si ElevenLabs se corta a media frase, la conexión se **rompe** (`res.destroy`) en vez de cerrarse bien: un PCM
     crudo no tiene largo y un final limpio lo haría pasar por entero.
   - Si ElevenLabs no abre: Voicebox (WAV) pasado a PCM con su frecuencia. Sin voz: 503 (JSON).
2. **Módulo nativo `mobile/modules/aura-voz`** (Kotlin, mismo molde que `aura-mic`/`aura-camara`, sin
   dependencias). `Reproductor.kt` baja cada frase (HttpURLConnection, cabeceras de sesión de `sessionHeaders`) y la
   escribe en UN `AudioTrack` en `MODE_STREAM` mientras llega:
   - empieza a sonar con **150 ms** de audio juntado (`setStartThresholdInFrames` en Android 12+; en anteriores el
     búfer de ~100 ms se llena con el prebúfer);
   - **cola sin hueco**: la frase siguiente, si ya está soltada y con prebúfer, se escribe detrás de la anterior en la
     misma pista;
   - escrituras **no bloqueantes** (un corte nunca queda trabado dentro de `write`); `cancelar`/`parar` hacen
     `pause()+flush()` y sueltan la pista en el acto;
   - avisos a JS por `onVoz`: `listo` (prebúfer), `sonando` (la cabeza de la pista entró en la frase: el comienzo
     real), `posicion` (~30/s: ms por los **cuadros que sonaron**, y el volumen RMS de ese bloque de 20 ms),
     `bajado` (duración), `termino` (`cortada`/`truncada`) y `error` (solo si NADA de la frase llegó a la pista:
     `red`/`http`/`formato`/`pista`);
   - atributos `USAGE_MEDIA + CONTENT_TYPE_SPEECH`: el mismo flujo (`STREAM_MUSIC`) por el que sonaba expo-av, así el
     volumen, la salida y la cancelación de eco del oído Turbo (`aura-mic` con `VOICE_COMMUNICATION` +
     `AcousticEchoCanceler`) ven la voz igual que antes; foco de audio transitorio «puede agachar».
3. **La mesa — `tts.ts` + `sonidoVivo.ts`.** `SonidoVivo` tiene la misma cara que un `Audio.Sound`
   (`setOnPlaybackStatusUpdate`/`playAsync`/`stopAsync`/`unloadAsync`), así `playPrepared`, `registroVoz`,
   `cuandoSuene`/`onSuena`, `fraccionSonando`, la generación, `cancel`, `reemplazar`, `done`/`fin` y el turno
   especulativo no cambian. La frase se encola al prepararla (con `esperar`: baja ya, suena con `playAsync`); cuando
   la que suena empieza a sonar por el nativo, la preparada detrás se **encadena** (`soltar`). Todo lo que la
   invalida (cancelar, reemplazar, otra locución) la cancela en el nativo; `CorteIO` cancela de lo último a lo
   primero para que lo encadenado no arranque un instante al callar lo que suena. La boca sale del volumen real que
   suena (`nivelDeRms`); `onAudioBajado` es el `listo`.
   - Van por el camino de siempre: canto, oraciones, lo privado (va por POST), el relleno (`hastaQue`: su corte
     gana mientras se BAJA) y lo que ya está en la caché de archivos (saludos y «un momento» precalentados).
   - **Respaldo sin perder la frase:** si el nativo falla antes de sonar, esa misma frase se pide por `/api/tts` y
     suena con expo-av con los mismos avisos; lo encadenado detrás no se suelta (no se pisan).
4. **Guardas** (`lib/guardiaVoz.ts`, como la cámara nativa): el binario trae el módulo (si no, el de siempre: APK
   vieja con este JS por OTA); interruptor remoto **`AURA_VOZ_STREAM=0`** en `/api/movil/config`; ajuste local «Voz
   en vivo (nueva)» (encendido por omisión); guardia contra cierres (marca «arrancando» escrita y esperada antes de
   la primera frase nativa; si la app muere así, 7 días apagada; dos cierres con ella andando en 3 días, 3 días); y
   **fallo en sesión**: si el módulo truena (`pista`, error interno o del puente), el servidor no tiene la ruta
   (404/405) o manda otra cosa, o fallan dos frases seguidas antes de sonar, queda apagado hasta reabrir la app y se
   reporta por `/api/diag`. Hasta leer lo guardado al arrancar, el camino de siempre.

## Por qué

- El primer sonido deja de esperar el archivo entero: con ElevenLabs soltando 1,5 s de voz en ~0,9 s, el teléfono
  empieza a sonar a los **~130 ms** contra **~920 ms** bajando la frase entera (`tests/voz-pcm.test.ts`, «MEDIDA», con
  HTTP de verdad y el mismo prebúfer que el nativo). En la mesa simulada (`pruebas/oido/vozvivo.cjs`), `onSuena` pasa
  de 520 a 288 ms para la misma frase. El Kotlin corrido en la JVM (`pruebas/voz/jvm`) suena a los ~280 ms con la
  frase bajada entera a los ~480 ms.
- Entre frases no hay hueco: la segunda suena en el mismo aviso en que termina la primera (misma pista).
- PCM y no MP3: AudioTrack lo escribe sin decodificar (MediaCodec por trozos sería otra máquina de estados en
  Kotlin), la posición sale exacta de los cuadros (bytes/2/hz) y el volumen por bloque se mide sin decodificar.
  Costo: 44 KB/s a 22 kHz contra 12 KB/s del MP3 de 96 kb/s; una frase de 7 s son ~300 KB.
- Un módulo propio pequeño (dos archivos, sin dependencias) en vez de una librería de streaming de audio: el contrato
  que la mesa necesita (cola sin hueco, cancelar inmediato, eventos de posición/volumen, el mismo flujo de audio que
  el eco) es corto y se prueba entero sin teléfono.

## Objeción más fuerte

«Perder los tiempos por letra de `/with-timestamps` empeora la boca: hoy cada letra tiene su visema.» Es real: por el
camino nuevo la boca abre y cierra con el **volumen real** del audio (pausas de verdad, no una envolvente
inventada), pero sin visemas por letra. ElevenLabs tiene `/stream/with-timestamps` (JSON por líneas con audio en
base64 y alineación), que daría las dos cosas; no se hizo aquí porque obliga a un formato propio entre servidor y
teléfono (el nativo tendría que separar audio de tiempos) y el pedido era reenviar tal cual. Si la boca se nota peor
en el teléfono, ese es el siguiente paso (ver «Qué la cambiaría»), o apagar con `AURA_VOZ_STREAM=0`.

## Riesgos y cómo se cubren

- **El nativo cierra la app** → guardia contra cierres (7 días apagada en ese teléfono) + interruptor remoto.
- **Eco / interrupción hablando:** se usa el mismo uso de audio que expo-av, pero un AudioTrack propio podría tener
  otra latencia de salida que el AEC del teléfono maneje distinto. No medido en hardware. Si «oír encima» empeora,
  `AURA_VOZ_STREAM=0` lo devuelve a lo de antes al momento. La interrupción sigue cortando: `stopSpeaking` → `parar()`
  (pausa + vaciar), y lo que alcanzó a oír sale de la posición real del nativo.
- **Red lenta a media frase** → underrun (silencio) hasta que llegue más; si se corta, suena lo que llegó y termina
  `truncada` (no se repite por el otro camino, se oiría dos veces).
- **Cancelar lo encadenado cuando ya está escrito detrás de la que suena** → la pista se calla y la que sonaba pierde
  como mucho su último búfer (~100 ms, normalmente el silencio del final).
- **Dispositivos que reinician la cabeza al drenar o no la mueven** → el reloj del reproductor da la frase por
  terminada (cabeza en 0, quieta 400 ms o pasado el tiempo esperado).
- **Datos móviles:** PCM pesa ~3,5× el MP3 por segundo de voz.
- **La duración** solo se sabe al terminar de bajar: hasta entonces `fraccionSonando` cae a la estimación por tiempo
  (`RegistroVoz.cortar`), como ya hacía sin posición.

## Cómo apagarlo

- **Para todos, sin APK nueva:** `AURA_VOZ_STREAM=0` en el servidor (Render). Los teléfonos lo leen al arrancar, al
  volver al frente (si pasó 1 min) y cada 10 min con la app delante; desde ese momento cada frase vuelve a bajarse
  entera y a sonar con expo-av. Volver a encenderla: quitar la variable.
- **En un teléfono:** Ajustes → La mesa → «Voz en vivo (nueva)».
- **Solo:** si truena en una sesión, se apaga hasta reabrir la app; si cerró la app, 7 días.
- `/api/tts` y `/api/tts/stream` no cambiaron: la mesa web y las APK anteriores siguen igual.

## Pruebas

- `tests/voz-pcm.test.ts` (servidor, ElevenLabs falso, HTTP real): trozos antes del final, voz/modelo/formato, caché
  solo de lo entero, corte a media frase rompe la conexión y no se guarda, privado sin caché, Voicebox de respaldo
  en PCM, minutos del miembro, puertas y montaje en `server.ts`, y la medida contra bajar entera.
- `tests/movil-config.test.ts`: `AURA_VOZ_STREAM`.
- `mobile/pruebas/voz/nativa.prueba.mjs`: lo puro (camino, eventos, boca, fallos), `SonidoVivo`/central con un
  puente simulado, y los contratos del puente leídos del código (eventos y campos Kotlin ↔ JS, cabecera y ruta
  ↔ servidor, atributos de audio, autolinking como los otros módulos, manifiesto aceptable para
  `scripts/qa/comprobar-apk.mjs`, versión).
- `mobile/pruebas/oido/vozvivo.cjs` (en `oido/todas.sh`): el `tts.ts` real con el nativo simulado — camino, cola sin
  hueco, contrato de `StreamSpeaker`, respaldo, fallo en sesión, guardia, boca.
- `mobile/pruebas/voz/jvm/correr.sh`: `Reproductor.kt` real en la JVM con un `AudioTrack` falso y un servidor que
  suelta el PCM despacio (prebúfer, orden de avisos, sin hueco, esperar/soltar/cancelar/parar, 404/formato/red,
  truncada, cabeza a cero). Necesita `kotlinc` (y opcionalmente `android.jar` para compilar contra la API real).

## Lo que no se pudo verificar aquí

Sin SDK de Android ni teléfono: no se compiló con Gradle ni se instaló la APK (el módulo compila con `kotlinc` contra
`android.jar` de la API 35 y unos stubs con las firmas de `expo-modules-core`); no se midió la latencia real de salida
de AudioTrack, ni el comportamiento del AEC con «oír encima», ni el foco de audio con otras apps, ni en Bluetooth.

## Qué la cambiaría

- Medición en teléfono de `onSuena` (traza del turno) con y sin `AURA_VOZ_STREAM`, y de cortes falsos por eco.
- Si la boca sin visemas se nota: `/stream/with-timestamps` con un marco propio audio/tiempos.
- Si los datos móviles pesan: Opus/MP3 por trozos con MediaCodec en el nativo.
