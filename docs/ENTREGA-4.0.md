# ULTRON FP 4.0 — qué se hizo y por qué

Fecha: 19 de septiembre de 2026. Rama: `claude/ultron-fp-premium-s46jxx`.

## Resumen

ULTRON pasó de una cara buena con muchas pantallas de utilería a un asistente con **una voz humana, catorce emociones que se ven y se oyen, un catálogo real de lo que sabe hacer y una superficie de ataque cerrada**. Se borraron 2.900 líneas de teatro y se añadieron contratos compartidos (emoción, capacidades, voz) para que web, APK y servidor evolucionen sin romperse entre sí.

## 1. Seguridad (primero, porque una demo con un agujero no es demo)

| Problema | Causa | Arreglo |
|---|---|---|
| Ejecución de Python sin login en el host de Render | `puedeCambiarSistema(null) === true`; `/api/turno` abierto; ejecutor local por defecto | Mando solo con identidad verificada (sesión firmada o Telegram). Ejecutor en producción solo con sandbox (`EJECUTOR_URL` o Docker). Código del modelo se ejecuta solo si alguien con mando lo pidió de forma explícita. |
| Borrar o envenenar memoria sin sesión | `/api/memoria` en la lista abierta; `body.memoria[]` se guardaba a largo plazo | `POST /api/memoria` exige sesión. Los hechos del cliente solo entran con sesión. |
| Escalada por body (Carlos → José con un campo) | `resolverQuien` priorizaba el body sobre la sesión | `quienVerificado()`: la identidad sale del token o de Telegram; el body solo nombra sin sesión y nunca escala. |
| TLS apagado para todo el proceso | `NODE_TLS_REJECT_UNAUTHORIZED=0` | Dispatcher `undici` con `rejectUnauthorized:false` solo para el host del nodo Qwen. |
| SSRF en captura de página y en el harness | URL sin `urlPublica` | Toda URL pasa por `urlPublica`; se cubren IPv6 ULA, mapeadas, `0/8`, CGNAT. |
| Rate limit evadible | clave con `x-forwarded-for` y `usuario` | Clave `req.ip` + ruta; poda del mapa. |
| Rutas que exponían Render, GitHub, estado inventado, WS sin auth | utilería de modales | Eliminadas: `/api/cloud/status`, `/api/github/status`, `/api/render/services|deploys|deploy/:id`, `/api/vault/elevenlabs/synthesize`, `/api/orden-global`, `/api/qwen/chat`, `/ws`. |
| Fotos y notas de voz de Telegram al chat global | `telegramFoto/Voz` sin `chatId` | Vuelven al chat que las pidió. |
| Hechos privados al pool de junta por mencionar «mina» | promoción por palabra clave | Solo lo que se pide guardar «para la junta» de forma explícita. |

Decisión respetada: `/api/turno`, `/api/tts`, `/api/stt`, `/api/vision/analyze` y `/api/cantar` siguen abiertos con rate limit por IP, como decidió la junta el 19-sep para que la APK no quede muda tras un redespliegue. Con sesión se gana memoria propia, bóveda y mando. Recomendación pendiente: fijar `ULTRON_SESION_SECRETO` en Render (hoy la firma reutiliza el secreto del nodo) y rotar las claves compartidas en chat.

## 2. Voz

- **Una voz, un camino:** `server/voz.ts`. ElevenLabs v3 en modo diálogo con la voz Gabriela (`ELEVENLABS_VOZ`), nodo TTS local como respaldo, y nada más. Se borraron: selector de tres voces que siempre devolvía Luna, `elevenlabs.ts` que llamaba a ElevenLabs con una clave en el navegador, seis presets sin uso, el parámetro `engine` que el servidor ignoraba y el nombre «Chatterbox/Qwen3-TTS» en la UI.
- **Expresividad:** la emoción del turno se traduce a etiquetas de audio (`[laughs]`, `[sighs]`, `[whispers]`, `[surprised]`, `[tired]`, `[mischievously]`…). «je je» escrito se vuelve risa real; «mmm» se vuelve pausa de pensar. En canto no se fija idioma (con `language_code` v3 lee la letra en vez de cantarla).
- **Canto:** `POST /api/cantar` con `id` del repertorio, `pedido` en lenguaje natural o `letra` libre (caché en disco por hash). Repertorio: *Quiero conocer a Jesús* (Generación 12), Bohemian Rhapsody, De música ligera, Bitter Sweet Symphony, Runaway, Die With A Smile. La canción de prueba está grabada en `public/voz/jesus.mp3` (fragmento corto del coro por derechos de autor; el sistema canta cualquier letra que se le pase).
- **Banco de clips:** 18 clips nuevos grabados con la voz oficial (`scripts/grabar-banco.mjs`): saludos, risas, «ya, ya», sorpresa, cariño, cansancio, tristeza, molestia, orgullo, despertar, bienvenida. Las reacciones táctiles suenan en 0 ms, sin red.
- **Verificación:** `POST /api/tts` con `emocion=risa` devuelve `eleven_v3_conversational` con la etiqueta de risa; el clip cantado se transcribe de vuelta palabra por palabra con Scribe; medidas de sostenidos de tono en el canto frente al habla (más tramos estables). El oído final es humano: los clips de comparación se entregan aparte.

## 3. Personalidad

`buildPersonality()` reescrita: doce reglas, no sesenta. ULTRON es alguien, no algo. Piensa antes de hablar, se ríe, se sorprende, se frustra con honestidad, cuida. Abre cada respuesta con `[EMO:x]` (contrato `lib/emocion.ts`); el servidor la extrae y la devuelve en `emocion` (JSON y SSE, evento `emocion` antes del primer texto). Reloj de Honduras, tono por modo, acceso mando/consulta explícito. Una sola fuente de hechos de Orden Global (`src/05-cerebro-og/conocimiento.ts`); se borraron las otras dos que se contradecían.

El **harness** ahora corre también en el stream (antes la APK podía leer «PEDIR_HERRAMIENTA» en voz alta): el servidor retiene la última frase, corre la herramienta, vuelve a preguntar y manda `replace` si hace falta.

## 4. Cara y gestos

**Web** (`src/02-cara/`, motor reescrito de 2.405 a 1.600 líneas más `dibujo.ts` y `funPack.ts`): 19 estados (nuevos LAUGH, SURPRISED, SAD, TIRED, SING), capa de expresión por emoción que se mezcla sobre cualquier cara incluso mientras habla, risa visible con rebote rítmico, sorpresa con dilatación instantánea, tristeza con cejas internas, cansancio con párpados pesados, canto con brillos que suben de la boca y anillo de voz. Partículas ambientales que respiran con la cara, halo, despertar de ojos al arrancar. Mapa táctil humano: ojo = guiño, frente = curioso, mejilla = ronroneo, barbilla = risa, toques repetidos = «ya, ya» juguetón, mantener = dormir/despertar, arrastrar = los ojos siguen el dedo. Blasters, sable, visor y coronas de modo quedan detrás de `funMode` (apagado por defecto, activable en Ajustes).

**APK** (`mobile/`): mismos estados nuevos en `Animated` puro, zonas táctiles, seguimiento del dedo, hápticos, y la emoción del SSE mueve la cara antes de que llegue el audio.

## 5. Ajustes con catálogo

`lib/capacidades.ts` → `GET /api/capacidades`: 34 tarjetas en seis grupos (herramientas, voz y oído, personalidad, gestos y tacto, canales, memoria), cada una con ejemplos clicables y estado vivo/caído medido contra la salud real. Se pinta en Ajustes → «Qué puede hacer» (web) y en el menú de la APK, con caché para verlo sin red.

## 6. Pantalla de inicio

Web: `Arranque.tsx` (ojos que despiertan detrás del wordmark «ULTRON FP · powered by ORDEN GLOBAL», estado del cerebro, mínimo 1,9 s, fundido). APK: splash nativo regenerado (logo, wordmark, «POWERED BY ORDEN GLOBAL» en cian) más splash JS con la cara despertando, icono adaptativo con zona segura.

## 7. Arquitectura

- `App.tsx`: 1.414 → 470 líneas. Una función `decir()`, una cola de frases para el stream, una tabla de intenciones locales con límites de palabra (`intenciones.ts`), un hook de oído (`useOido.ts`).
- Borrado: 12 modales muertos (AWS, Android blueprint, GlobalOrderBrain, Playwright modal, VisionAnalyzer, Tutorial, BackendBridge, AgenticHarness, ElevenLabsVoice, Biometric, Permission, VoicePicker), `exporter.ts`, `qwenHarness.ts`, `elevenlabs.ts`, `voces.ts`, `barge.ts`, `metadata.json`, tipos muertos, dependencias `ws`, `@google/genai`.
- `server.ts`: 1.600 → 1.230 líneas; `dotenv` importado; `bun.lock` ilegible reemplazado por `package-lock.json`.
- Móvil: intérprete de comandos unificado (23 secuestros de frases normales corregidos y comprobados por script), banco de voz real, selector placebo eliminado, OTA sin canal eliminado, `eas-cli` fuera, versión 4.0.0 / 40 en `app.json` y `package.json`.
- Bundle web: 515 KB → 377 KB.
- Documentación: README, AREAS, SECURITY, README por área, `mobile/README.md`. Planes viejos en `docs/historial/`.

## 8. Pruebas

- `npm test`: 88 tests (14 nuevos: emoción, expresividad de voz, repertorio, escalada de identidad, intenciones locales). `tsc` limpio en raíz y en `mobile/`. `vite build` OK. `expo config --type prebuild` OK.
- Smoke con nodo Qwen simulado: `/api/turno` devuelve `emocion`; el stream emite `emocion` → `delta` → (`replace`) → `done` con harness; un anónimo con bloque Python no ejecuta nada; `POST /api/memoria` y `/api/ejecutar` sin sesión → 401; rutas de utilería → 404; `/api/tts` con `emocion=risa` → audio v3; `/api/cantar` por clip y por letra libre → audio.
- No probado aquí: un turno contra el Qwen real (el nodo no es alcanzable desde este entorno; se prueba al desplegar) y el APK en un teléfono (se compila en Actions).

## 9. CI

`web.yml` (tests + tsc + build en cada push) y `android-apk.yml` (APK release; dispara en `main`, `cursor/**`, `claude/**`, solo cuando cambia `mobile/`).

## 10. Pendientes que dependen de José

1. Fijar `ULTRON_SESION_SECRETO` en Render y rotar Render/AWS/GitHub/ElevenLabs.
2. Si se quiere el ejecutor en producción: `EJECUTOR_URL` a un sandbox aparte (o Docker).
3. La instancia T4 (`35.175.175.203`, g4dn) sigue encendida con etiqueta «APAGADA»; si Chatterbox/Qwen-TTS ya no se usan, apagarla ahorra unos 380 USD al mes.
4. Escuchar los clips de voz entregados y decir si Gabriela sigue siendo la voz o se cambia el `ELEVENLABS_VOZ` (el resto del sistema no cambia).
5. Dar permiso `music_generation` a la key de ElevenLabs si se quiere canto con acompañamiento (Eleven Music) además del canto a capela.


---

# Ronda 2 (20-sep-2026): producción real, oración, Way Maker, canto, oído local

## Qué se encontró al probar contra Qwen en Render
1. **Un saludo disparaba una búsqueda web.** `esPreguntaExterna` mandaba a internet cualquier pregunta de más de 18 caracteres. Ahora los saludos, las preguntas sobre ULTRON («¿cómo amaneciste?») y los temas que ya viven en el cerebro de Orden Global (5550, ORIGEN, Próspera, junta…) no se buscan; el 27B pide web por el harness solo si le falta.
2. **El 27B le contaba a la junta problemas de infraestructura** («la clave de AWS sigue rechazada») en vez de contestar como persona. Las líneas MEMORIA/ACCESO pasaron a «contexto interno: no lo menciones»; la persona ganó dos reglas: «cómo estás» se contesta en una frase humana, y lo que está en el cerebro OG se cuenta con soltura, sin «no tengo acceso».
3. **La memoria S3 está caída en producción.** Render tiene una clave AWS (`AKIAX7LQ…F5N`) que ya no existe en IAM; el objeto `ultron/memoria-junta.json` no se escribe desde el 19-sep 19:19 UTC. Intenté actualizar las variables en Render y la sesión no tiene permiso para escribir secretos. **Pendiente de José** (dos minutos): en Render → `ultron-looi-desk` → Environment, poner `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` de una clave activa (`…NKETY5QP` o la que se generó ayer) y añadir `ULTRON_SESION_SECRETO` (cualquier cadena larga aleatoria).
4. **`cómo está el sistema` decía «qwen no responde»** aunque respondía: la sonda del taller y del centinela usaban `fetch` global, y al acotar el TLS inseguro al nodo se quedaron sin el certificado. Ahora todo acceso al nodo pasa por `lib/nodo.ts` (`fetchNodo`, `saludNodo`).
5. Emociones en el turno real: `sorpresa`, `pensando`, `preocupado`, `neutral` llegaron bien; latencia 2,8–6,4 s con harness, 0,3 s en dato directo.

## Voz
- **«Quiero conocer a Jesús» regrabada** con instrucciones de canto (balada lenta, vocales alargadas, dos pasadas y un susurro final): 41 s, 17 tramos de nota sostenida frente a 7 de la toma anterior, transcripción de vuelta exacta.
- **«Way Maker» (Sinach)** en inglés, misma receta, 44 s. `canta way maker`, `cantá algo en inglés`.
- **Oración del día** (texto propio de ULTRON, 2 min 50 s, termina en Amén): bendice el día, la junta por nombre, Orden Global, Honduras, los mineros; pide cambiar vidas y hablar de Jesús. `POST /api/orar` la sirve como clip; con `{ tema }` genera una oración corta por ese tema (caché por hash). Emoción nueva `oracion` en el contrato.
- El oído prueba primero un **nodo local** (`ULTRON_STT_URL`, API Whisper compatible) y cae a Scribe.

## Cara
- **Web:** estado `PRAY`: párpados que se cierran en 0,8 s con micro-temblor, cejas relajadas, sonrisa serena, respiración lenta, halo cálido, la boca sigue el audio mientras ora, los ojos se abren despacio al terminar. Lip-sync endurecido: ataque rápido, mandíbula que baja con el volumen, viseme sintético solo si el audio no trae señal en 1,5 s. El audio se desbloquea al primer toque y el saludo de arranque espera a ese toque («Tocame para escucharme»).
- **APK:** `PRAY` con párpados suaves, cabeza levemente inclinada, respiración lenta. Lip-sync real por envolvente silábica sincronizada a la posición del audio (expo-av no expone medidor en reproducción): frases, clips, canciones y oración; nunca habla con la boca cerrada. Sección «Orar» en el menú, Way Maker en el repertorio.

## Nodo T4
No pude entrar a verlo (SSM bloqueado en esta sesión). Propuesta y script listos en `docs/NODO-T4.md` y `scripts/nodo-t4/instalar-oido.sh`: convertirlo en el oído local de ULTRON con faster-whisper large-v3 (0,3 s, sin costo por minuto); el servidor ya lo usa si `ULTRON_STT_URL` está definido. Si no se va a usar, apagarlo.
