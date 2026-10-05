# Speech Engine: prototipo en paralelo (apagado para todos)

Estado: **prototipo listo en el código, apagado**. Para probarlo hace falta el visto bueno de José en
ElevenLabs (sección 6). La regla acordada: probar en paralelo SIN tocar lo que funciona, detrás de un
interruptor por cuenta (apagado para todos), medir los dos caminos y adoptarlo **solo si gana claro**.

Código: `server/voz-motor.ts` (el adaptador), `server/voz-medidas.ts` (las medidas de los dos caminos),
`scripts/elevenlabs-motor.ts` (el recurso de prueba, no se corre sin permiso), `scripts/voz-comparar-eleven.ts`
(lo que mide ElevenLabs, solo lectura). Pruebas: `tests/voz-motor.test.ts`, `tests/voz-motor-apagado.test.ts`,
`tests/voz-motor-clientes.test.ts`.

---

## 1. Qué es Speech Engine (con fuentes)

Speech Engine es la forma de ElevenLabs de «poner voz a tu propio agente»: ellos hacen el micrófono, el
reconocimiento (Scribe en tiempo real), la detección de turno, la voz y la reproducción; **el servidor del
desarrollador piensa**. La diferencia con lo que tenemos hoy (un agente de ElevenLabs con «LLM propio») es la
conexión con nuestro cerebro:

| | Hoy: agente + «LLM propio» | Speech Engine |
|---|---|---|
| Conexión con el cerebro | Una petición HTTP por turno a `/api/voz/llm` (formato OpenAI, SSE) | **Un WebSocket por llamada**, que abre ElevenLabs hacia nosotros |
| Qué llega por turno | El historial en formato OpenAI | `user_transcript`: todo el historial (`user`/`agent`) y un `event_id` que sube |
| Qué contestamos | Trozos SSE `chat.completion.chunk` | `agent_response` `{content, event_id, is_final}`; el último con `content: ""` e `is_final: true` |
| Interrupción | ElevenLabs corta la petición (al momento de hablarle encima) o la respuesta vuelve recortada en el historial | Llega un `user_transcript` con `event_id` mayor; lo que mandemos con el id viejo se descarta. **No hay un evento «interrupción» aparte** |
| Mantener viva | — | `ping` → `pong` |
| Fin | Cada petición termina | `close` (limpio) o caída del WebSocket |
| Autenticidad | `Authorization: Bearer` (secreto nuestro guardado en ElevenLabs) | Cabecera `X-Elevenlabs-Speech-Engine-Authorization`: JWT **HS256** firmado con el **SHA-256 de nuestra llave de ElevenLabs**; `iss=https://api.elevenlabs.io/convai/speech-engine`, `sub=convai_speech_engine_upstream`, `exp` corto con 60 s de holgura. Opcional: cabeceras propias (`request_headers`, valores fijos, secretos o variables dinámicas) e IP de origen fijas |
| Cliente (web / teléfono) | `@elevenlabs/client` / `@elevenlabs/react-native` con `conversationToken` (WebRTC) | **Lo mismo**: el token sale de `GET /v1/convai/conversation/token?agent_id=seng_…` |
| Relleno de ElevenLabs si tardamos | Sí (`soft_timeout_config`, de respaldo a 4,5 s) | **No existe** en la configuración de Speech Engine |
| LLM de respaldo de ElevenLabs | Existe (lo tenemos apagado: `backup_llm_config: disabled`) | No existe |
| Asentir («ajá») no interrumpe | `interruption_ignore_terms` | **También existe** (`turn.interruption_ignore_terms`) |
| Corte si no contestamos | `cascade_timeout_seconds` (lo tenemos en 12 s) | También existe (2–15 s, por omisión 4 s) |
| Primer mensaje | Lo tiene el agente | No tiene propio: lo pide el cliente (`overrides.agent.firstMessage`) con `overrides.first_message: true` en el recurso |
| Precio | El de los agentes | Publicado: **0,08 USD/min** (ráfaga 0,16), minutos incluidos según el plan; el LLM va aparte (el nuestro ya es nuestro) |

Lo que promete sobre la latencia es poco y sin cifras: «usar WebSockets significa mantener una sola conexión
en vez de abrir una conexión HTTP por turno, **lo que puede** mejorar la latencia» (guía de Twilio + LLM propio).

Fuentes (leídas el 5-oct-2026):

- Skill oficial: https://github.com/elevenlabs/skills/tree/main/speech-engine (`SKILL.md`, `references/javascript-sdk-reference.md`, `references/installation.md`)
- Visión general: https://elevenlabs.io/docs/overview/capabilities/speech-engine
- Protocolo del WebSocket (mensajes, JWT, interrupción por `event_id`): https://elevenlabs.io/docs/api-reference/speech-engine/speech-engine-upstream
- SDK de JavaScript (callbacks, `AbortSignal`, formato del cable): https://elevenlabs.io/docs/eleven-api/resources/libraries/speech-engine/javascript-sdk-reference
- Guía rápida (token del cliente con el id `seng_…`, WebRTC): https://elevenlabs.io/docs/eleven-api/guides/cookbooks/speech-engine
- Crear el recurso (todas las opciones: `turn`, `asr`, `tts`, `cascade_timeout_seconds`, `request_headers` con secretos y variables dinámicas, `overrides`): https://elevenlabs.io/docs/api-reference/speech-engine/create
- IP de origen fijas: https://elevenlabs.io/docs/eleven-api/resources/ip-allowlisting
- La frase sobre latencia: https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/custom-llm-integration
- Conversaciones (aceptan id de agente o `seng_…`; cada turno trae `conversation_turn_metrics`, `interrupted`, `ignored_as_backchannel`): https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/list y https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get
- Precio: https://elevenlabs.io/pricing/api
- Cómo verifica el JWT su SDK (`@elevenlabs/elevenlabs-js` 2.70.0, `wrapper/speech-engine/SpeechEngineResource.js`): mismo algoritmo, con la llave de residencia sin su sufijo `_residency_xx`.

### Lo que esto cambia del análisis previo

- **«Eventos de interrupción fiables»: casi no.** No hay evento de interrupción: la señal es un `event_id`
  nuevo, que llega cuando la persona **termina** su frase nueva. Hoy, en cambio, ElevenLabs corta la petición
  HTTP en cuanto le hablan encima, y nuestro cerebro se suelta antes. Lo que sí gana Speech Engine es una señal
  sin ambigüedad (el id nuevo) y que lo viejo se descarta solo. Por eso medimos interrupciones en los dos.
- **Relleno y asentir**: asentir sigue existiendo del lado de ElevenLabs; el relleno de ElevenLabs no, pero el
  nuestro (el «puente» del servidor, `server/voz-agente.ts`) ya era el principal y se reutiliza tal cual.
- **Cerebro de respaldo**: ya era nuestro (el respaldo del cerebro vive en el servidor); el de ElevenLabs lo
  teníamos apagado. No se pierde nada.
- **Clientes**: los mismos SDK y el mismo WebRTC. Solo se añadió la primera frase y el vínculo (sección 3).

## 2. Qué cambia y qué no

Con el interruptor **apagado** (como queda para todos): **nada**. `/api/voz/agente` pide el token del agente de
siempre y contesta lo mismo, campo por campo; `/api/voz/llm` saca el mismo stream byte a byte; las opciones al
SDK de la web y del teléfono son las mismas y no hay peticiones nuevas. Lo prueban
`tests/voz-motor-apagado.test.ts` (pasa igual en `main` antes del prototipo y después) y las pruebas «apagado»
de `tests/voz-motor-clientes.test.ts`. Sin `AURA_MOTOR_VOZ=speech-engine` el servidor ni siquiera escucha el
WebSocket.

Lo único que corre siempre es la **medida** de cada turno (solo tiempos y banderas, en memoria del proceso; no
escribe nada en la respuesta). Solo con el motor encendido se guarda también en S3 (para que un redespliegue a
mitad de la prueba no la borre). Así hay línea base del camino de siempre.

Con el interruptor **encendido** para una cuenta (y el motor encendido en el servidor y un recurso para ese
avatar e idioma): esa cuenta abre la llamada con el recurso de Speech Engine; todas las demás, igual que siempre.

## 3. Qué se reimplementó y qué se reutiliza

**Se reutiliza, sin copiar**: cada `user_transcript` se vuelve una petición INTERNA a la misma ruta del LLM
propio (`montarVozAgente` ahora la devuelve), con el historial en formato OpenAI y el pase. Así pasan por el
mismo sitio, sin una línea duplicada:

- el pase firmado y la sesión viva, el nivel (junta/miembro), los cupos por persona y los minutos de voz;
- el mismo cerebro (`turnoVozEnVivo` de `server.ts`): **solo consulta, sin mando**; lo sensible no se ejecuta
  desde la voz (queda propuesta para aprobar), y la **vista autorizada** («No usarlo») la arma el cerebro con
  su memoria — el historial de ElevenLabs no le llega, solo la última frase;
- el reintento que se engancha (idempotencia del turno), el turno especulativo (las acciones esperan su
  confirmación y una frase a medias no hace nada), la memoria que espera al turno siguiente;
- la frase de espera si el cerebro tarda (el puente a ~3 s y sus seguimientos), el sonido de fondo de las
  tareas, el perdón tras cortar algo largo, las frases de fallo y el cerebro de respaldo.

**Lo nuevo (solo el idioma de Speech Engine)**, en `server/voz-motor.ts`:

- **Autenticidad** como dice la documentación: el JWT HS256 (firma con `timingSafeEqual`, `alg`, `iss`, `sub`,
  `exp`, `iat`, holgura de 60 s, llave de residencia sin sufijo) **y** una segunda llave nuestra en
  `X-Aura-Motor` (secreto «aura-motor» guardado en ElevenLabs, derivado de `ULTRON_SESION_SECRETO`), como el
  `Bearer` de hoy. Sin las dos, el WebSocket no se abre.
- **Quién habla**: el pase viaja como hoy, como variable dinámica en la cabecera `X-Pase` (la documentación de
  `request_headers` acepta variables dinámicas). Si ElevenLabs no la reenviara, el teléfono ata la conversación
  a su pase con su sesión (`POST /api/voz/motor/vincular`); sin pase en 6 s, se cuelga sin pensar. Además, la
  cuenta del pase tiene que tener el interruptor: un pase de otra cuenta no entra por el motor.
- **Interrupción**: un `event_id` nuevo mientras el turno anterior sigue saliendo suelta ese turno (la ruta
  corta su cerebro igual que cuando ElevenLabs corta la petición) y nada más sale con el id viejo; se anota
  como interrupción **nativa**. El mismo `event_id` otra vez no es otro turno.
- **Asentir**: «ajá», «mjm», «sí, sí»… (la misma lista que los agentes) mientras AURA habla no corta el
  cerebro: lo que falta sigue saliendo con el id nuevo, **desde donde la persona dejó de oír** (sin repetir lo
  oído). Fuera de una respuesta en curso, «sí» es un turno normal (para confirmar acciones).
- **Fallos**: si la ruta contesta con error, una frase y la llamada sigue (freno: «dame un segundito…»; otro:
  «se me cortó…»); sin permiso (pase vencido o sesión cerrada), se cuelga, como hoy.
- **WebSocket de servidor propio** (RFC 6455, solo texto, sin compresión, máx. 4 MB por mensaje): sin
  dependencias nuevas; probado contra el cliente WebSocket de undici (incluye mensajes de más de 64 KB).
- **Clientes**: si `/api/voz/agente` trae `motor: 'speech-engine'`, la web (`src/03-voz/enVivo.ts`) y el
  teléfono (`mobile/src/compa/sesionVoz.ts`, `permiso.ts`, `VozProvider.tsx`, `ModoConversacion.tsx`) le piden
  al SDK la primera frase (`overrides.agent.firstMessage`, la misma que dicen hoy los agentes) y atan la
  conversación al pase al conectar. Sin ese campo, nada cambia.

**Diferencias que quedan (honestas)**:

- La frase de espera usa los mismos tiempos que con el agente (pensados para no pisar el relleno de ElevenLabs,
  que en Speech Engine no existe). Funciona igual; solo que no hay un segundo relleno de respaldo.
- El cerebro de un turno interrumpido se suelta cuando llega la frase nueva entera, no al primer sonido.
- El `.exe` de Windows (WebSocket con URL firmada) sigue siempre por el agente.

## 4. Cómo encenderlo para UNA cuenta

1. Hecho lo de la sección 6 (con permiso de José), en Render: `AURA_MOTOR_VOZ=speech-engine` y
   `ELEVENLABS_SPEECH_ENGINE_AURA_ES=seng_…` (uno por avatar e idioma que se quiera probar; sin el de un avatar,
   ese avatar sigue por el agente). Redesplegar.
2. Con la sesión de José (mando), añadir su cuenta al interruptor (se relee cada minuto, sin redesplegar):

   ```
   POST /api/interruptores   { "motorVozCuentas": ["jose@…"] }
   ```

   Para volver al agente: `{ "motorVozCuentas": [] }`. Para apagar todo de golpe: quitar `AURA_MOTOR_VOZ`.
3. Abrir la llamada en la app o la web con AU-RA en español: `/api/voz/agente` contesta `motor: 'speech-engine'`.

## 5. La prueba A/B y la regla de decisión

**Qué se mide (los dos caminos, los mismos campos, en el mismo sitio)** — `GET /api/voz/comparacion` (solo
mando; `?desde=…&hasta=…` en ISO):

- `primerTexto` p50/p95: desde que llega el turno hasta que el primer texto sale hacia la voz (la frase de
  espera cuenta, es lo primero que se oye) · `cerebro` p50/p95: hasta lo primero del cerebro;
- interrupciones `nativas` / `inferidas`, `repetidos`, `asentimientos`, `respaldos`, `errores`, `tardes`,
  `cortados`, `puentes`, y cuántas conversaciones;
- `veredicto`: la regla de abajo, ya calculada.

**Lo que el servidor no ve** (la red, el reconocimiento y la voz de ElevenLabs, que es justo donde Speech
Engine podría ganar): `scripts/voz-comparar-eleven.ts` (solo lectura) resume las métricas por turno que
ElevenLabs guarda en cada conversación, más `interrupted` e `ignored_as_backchannel`:

```
ELEVENLABS_API_KEY=… npx tsx scripts/voz-comparar-eleven.ts --agente agent_6801m3qbvv83fzgvg42eev85m8m5 --motor seng_… --desde 2026-10-07T15:00:00Z
```

**Procedimiento** (la guía de muestras de la auditoría: **≥ 20 turnos por camino y por red**):

1. Misma persona, mismo teléfono, mismo avatar (AU-RA, español), mismo guion de preguntas para los dos caminos:
   10 preguntas cortas de charla, 6 que usan herramienta (precio, búsqueda, cálculo), 4 de las manos del
   teléfono (recordatorio, llamada: comprobar que piden su «sí»).
2. Por cada red (wifi de casa y datos móviles): etiquetarla (`POST /api/voz/comparacion/red {"red":"wifi"}`).
3. En bloques alternos A-B-A-B (para que la hora no sesgue): bloque A con la cuenta fuera del interruptor
   (agente), bloque B dentro (Speech Engine); cada bloque ~10 turnos, hasta ≥ 20 por camino en esa red.
4. En cada camino y red, **5 interrupciones a propósito** (hablarle encima a mitad de una respuesta larga) y
   **5 asentimientos** («ajá», «mjm») mientras habla. Anotar si alguna vez repitió algo o se quedó callada.
5. Al terminar: `GET /api/voz/comparacion` y el script de arriba con la misma ventana de tiempo.

**Regla de decisión** (la acordada): se adopta **solo si**

- hay ≥ 20 turnos por camino en cada red;
- el primer audio es **mejor en p50 Y en p95** en las dos redes (nuestro `primerTexto` y las métricas de
  ElevenLabs de punta a punta);
- detecta **al menos las mismas** interrupciones (con las mismas 5 a propósito) y no corta por un «ajá»;
- **sin regresiones**: ni más errores, ni más turnos tarde, ni repeticiones, ni más respaldos (en proporción),
  y nada raro de oído (saludo, frases de espera, cortes).

Si no gana claro, se queda el agente y el prototipo se apaga (sin tocar nada más).

## 6. Lo que hay que hacer en ElevenLabs — **REQUIERE EL VISTO BUENO DE JOSÉ**

Nada de esto se hizo. No se tocó ningún agente, voz, número ni base de conocimiento, ni se llamó a ninguna
API de ElevenLabs que cree o cambie algo. Lo que hace falta, todo NUEVO y aparte:

1. **Un secreto nuevo** «aura-motor» en los secretos de ElevenLabs, con el valor
   `secretoDerivado('elevenlabs-motor-v1')` (se deriva del `ULTRON_SESION_SECRETO` de Render; nunca se imprime).
2. **Un recurso de Speech Engine nuevo**, solo para la prueba (AU-RA, español): `POST /v1/speech-engine` con

   ```json
   {
     "name": "AU-RA FP · prueba Speech Engine (aura, es)",
     "speech_engine": {
       "ws_url": "wss://aura-fp.onrender.com/api/voz/motor",
       "request_headers": {
         "X-Aura-Motor": { "secret_id": "<id del secreto aura-motor>" },
         "X-Pase": { "variable_name": "pase" }
       }
     },
     "overrides": { "first_message": true },
     "language": "es",
     "tts": { "model_id": "<el mismo del agente de AU-RA es>", "voice_id": "<la misma del agente de AU-RA es>" },
     "asr": { "provider": "scribe_realtime", "quality": "high", "keywords": ["<PALABRAS_ASR de scripts/elevenlabs-agentes.ts>"] },
     "turn": {
       "turn_model": "<el mismo del agente>",
       "turn_eagerness": "eager",
       "speculative_turn": true,
       "interruption_ignore_terms": ["ajá", "sí", "ok", "okay", "mhm", "claro", "ya", "exacto", "ah ok", "vale"],
       "interruption_ignore_term_languages": ["es"],
       "merge_with_default_ignore_terms": true
     },
     "vad": { "background_voice_detection": true },
     "conversation": { "max_duration_seconds": 1200 },
     "cascade_timeout_seconds": 12
   }
   ```

   `scripts/elevenlabs-motor.ts` arma exactamente esto copiando la voz y los modelos del agente de siempre
   (lectura). Sin `--crear` solo lo imprime (el secreto tapado); con `--crear` crea el secreto y el recurso.
   **No se corrió.**
3. En Render: `AURA_MOTOR_VOZ=speech-engine` y `ELEVENLABS_SPEECH_ENGINE_AURA_ES=<el seng_… creado>`.
4. Uso pagado: las llamadas de prueba gastan minutos de Speech Engine (0,08 USD/min según la página de precios;
   los ≥ 40 turnos de Speech Engine (20 por red) son unos 10–15 minutos). También requiere su visto bueno.
5. Por verificar en la primera llamada (no se puede antes sin crear el recurso): que ElevenLabs reenvía
   `X-Pase` (si no, entra el vínculo del teléfono, ya hecho) y que el JWT trae `iat` (su SDK lo exige; el
   nuestro también).

## 7. Qué se espera ganar (evaluación honesta)

- **Latencia: poca y no segura.** Lo que se ahorra es abrir la petición HTTP de cada turno entre ElevenLabs y
  Render (con conexión reutilizada, unas decenas de ms; en frío, quizá 100–300 ms). El tiempo grande de un turno
  es el cerebro (cientos de ms a segundos) y la voz, que no cambian: son los mismos. ElevenLabs no da cifras
  («puede» mejorar). Esperable: **0–0,3 s en p50**, a medir.
- **Interrupciones: no mejores, quizá un poco más tarde** para soltar el cerebro (al final de la frase nueva,
  no al primer sonido). Lo que se oye se corta igual (eso lo hace ElevenLabs en los dos). La señal es más
  limpia (id nuevo, lo viejo se descarta solo), y ElevenLabs marca `interrupted` en los dos caminos.
- **Pérdidas**: ninguna funcional (asentir existe; relleno y respaldo eran nuestros). Se pierde el relleno de
  respaldo de ElevenLabs (raro que suene: el nuestro va antes). Se gana una pieza más que mantener (el
  WebSocket y el adaptador).
- Conclusión previa: **probablemente empate técnico**; el A/B dirá si los ~0,1–0,3 s existen en la red del
  teléfono. Si no gana claro en p50 y p95, se queda el agente.
