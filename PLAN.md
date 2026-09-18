# ULTRON DESK — Plan maestro (no se lanza hasta cerrar cada fase)

Estado: **FASE C EN CURSO · A/B parcheados · no production launch**
Repo: `therealj94/ULTRON-APP`
Cara/desk: Render `ultron-looi-desk` (`srv-dalojou1egvs73fb7lfg`)
Cerebro: Ultron FP `https://ultron.ordenglobal.link` + Qwen 3.8 27B (g5) + manos Playwright/visión (`34.229.88.165:8787`)
Dueño: José · Orden Global
Regla de oro: **la cara no razona, no inventa, no dice Qwen/Playwright/AWS si no lo llamó.**

---

## 0. Qué estamos construyendo

Desktop assistant de junta (kiosk horizontal en el teléfono).
No se mueve. No es Looi-clon de orugas.
Sí debe empatar o ganar a Looi en: cara viva, voz continua, presencia, memoria, visión dentro del turno, tools reales, utilidad de Orden Global.

Promesa de producto:
1. Se ve vivo (ojos, gaze, idle, voz).
2. Hace trabajo de verdad (web+screenshot, visión, oro/plata, bóveda, repos, pendientes, docs).
3. Es divertido sin ser un videojuego (1–2 gags, no 15 modales).
4. Nunca rellena un dato que no vio.

---

## 1. Principios (innegociables)

1. Un solo cerebro: Ultron FP / Qwen 27B. La app es cara + mic + cámara + dock.
2. Harness en servidor. Regex en el client solo para gags locales (wink, vaso, sleep).
3. Tool-first: si el usuario pide un dato, se corre el tool ANTES de hablar.
4. Si el tool falla o no trae el número, se dice “no está”. Cero invención.
5. Stream de verdad: tokens + eventos `face` / `tool` / `foto`.
6. Voz de sesión, no de botón de un disparo.
7. Memoria persistente del FP. Borrar chat borra memoria de esa conversación.
8. No se publica / no se “lanza” una fase si su checklist está en rojo.
9. Prohibido: `Math.random()` de confidence, `latencyMs` falso, User-Agent que dice Playwright, model label “Qwen” si corrió Gemini.
10. Tono: corto, útil, hondureño-ejecutivo. No “Doctrina ALFA-770” en cada frase.

---

## 2. Arquitectura objetivo

```
[FaceCanvas + Behavior Engine local]
[Voice session: STT stream / TTS stream / barge-in]
[Gaze / frame opcional]
        │  POST /api/turno  (SSE/NDJSON)
        ▼
[BFF server.ts — delgado]
        │
        ├─ Ultron FP  /salud /chat /herramientas
        ├─ Qwen 8443  (si el FP no está)
        ├─ Manos 8787 /mirar /foto /ver /sandbox
        └─ ElevenLabs (bóveda)
```

Carpetas nuevas (se parte App.tsx):

```
src/face/       FaceCanvas, behavior engine, states
src/voice/      stt, tts, session, barge-in
src/agent/      client del turno, historial, tool events
src/dock/       un ToolPanel + 6 acciones
src/session/    user, memoria local cache
server/
  turno.ts      proxy stream
  tools.ts      adapters (ojo, vision, gold, vault)
  honest.ts     labels reales de modelo/nodo
```

Se elimina o se convierte en flag `funMode` (off por default):
blaster combat, corona de modos, doctrinas fake, “AWS Playwright Worker”, biometric teatro.

---

## 3. Fases (se hacen EN ORDEN)

Cada fase termina con: código en `main`, checklist verde, prueba en desk + FP, **sin deploy público de “ya está”**.
Render `ultron-looi-desk` se usa como **preview interno** a partir de la Fase C, no como launch.

### FASE A — Verdad y cimientos
Objetivo: el repo deja de mentir y se puede construir encima.

Trabajo:
- README real (qué es, qué no es, cómo corre, qué env vars).
- `.env.example` con nombres honestos + `ULTRON_FP_URL`, `ULTRON_OJO_URL`, `ULTRON_OJO_CLAVE`, `QWEN_ENDPOINT_URL`, `ULTRON_NODO_SECRETO`.
- Quitar labels falsos en `server.ts` (`Qwen 27B Enterprise`, `latencyMs: 34`, nodo AWS Playwright).
- `/api/playwright/scrape` o se conecta a manos `/mirar`+`/foto` o se llama `/api/web/leer`.
- `/api/qwen/chat` deja de existir como cerebro. Queda `/api/turno`.
- `qwenHarness.ts` client se borra o queda solo como detector de gags locales.
- Log de “qué modelo contestó de verdad”.

Prueba:
- Un curl a `/api/health` dice fp/qwen/ojo vivos o muertos, sin teatro.
- Grep del repo: cero `Math.random()` en confidence, cero `Playwright-AWS-Node`.

Criterio de salida: código honesto.

### FASE B — Cara Looi (experiencia desde el boot)
Objetivo: al abrir la app, se siente un ser, no un dashboard.

Boot (6–8 s máximo):
1. Negro + dos ojos que despiertan.
2. Chequeo silencioso: FP / ojo / voz. Si algo falta, un ojo CONCERNED y texto chico “web off” — no un muro de logs.
3. Saludo corto con nombre si hay sesión: “José. Listo.”
4. Entra IDLE vivo (parpadeo autónomo, respiración de pupilas).

Cara:
- Estados: IDLE, LISTENING, THINKING, SPEAKING, HAPPY, CONCERNED, SLEEP.
- Gaze de cámara (ya hay `faceTracker`) mueve los ojos.
- 45 s sin rostro → SLEEP. Vuelve el rostro → wake + “Aquí.”
- Gags locales (máx 2 en default): wink al tap de un ojo, vaso si dice “toma agua”.
- Blasters / visor / corona: flag `funMode`, apagado.

UI de inicio:
- Cero dock abierto.
- Un campo de voz + un campo de texto escondido al tap.
- Burbuja del último turno, no HUD militar.

Prueba:
- Abrir app sin internet: cara vive, dice “sin cerebro” y no inventa precios.
- Abrir con internet: saludo + idle.

Criterio de salida: un extraño entiende que hay alguien en la mesa.

### FASE C — Un turno de verdad (texto)
Objetivo: escribir “precio del oro” y obtener el spot real, no una frase.

- `POST /api/turno` stream NDJSON:
  `{t:"face", v:"THINKING"}`
  `{t:"tool", name:"buscar_web", estado:"run"}`
  `{t:"tool", name:"buscar_web", estado:"ok", extracto:"..."}`
  `{t:"foto", url:"/ojo/foto/id"}`
  `{t:"text", v:"..."}`
  `{t:"done", modelo:"qwen-27b", ms:1820}`
- Client consume el stream, mueve cara, pinta texto, muestra foto si viene.
- Historial de 8–12 turnos en el payload.
- System prompt corto de Orden Global + “no inventes”.
- Harness del FP forzado para oro / plata / lempira / cmsbio / url / imagen.

Prueba obligatoria:
1. “precio del oro hoy”
2. “precio de la plata”
3. “CMSBIO lempira a dólar, abrí la página y screenshot”
4. “qué ves” + foto
5. “hola” (sin tool)

Si 1–3 inventan: fase en rojo.

Criterio de salida: 5/5 sin invención.

### FASE D — Voz a la par de Looi
Objetivo: hablar sin apretar cada vez, interrumpir, oír voz buena.

- Sesión: primer tap / “Ultron” abre canal. El mic sigue vivo.
- STT: Web Speech interim v1; upgrade a stream server si el browser falla en Android.
- TTS: ElevenLabs **streaming** (no esperar MP3 entero). Fallback speechSynthesis.
- Barge-in: voz del user corta TTS + abort del turno.
- Cara SPEAKING sigue amplitud del audio.
- No cerrar sesión a los 3 s. Timeout 20–30 s de silencio → IDLE, no “fin de producto”.

Prueba:
- Diálogo de 8 turnos seguidos sin tocar la pantalla.
- Cortar a Ultron a mitad de frase: se calla y escucha.
- Latencia percibida < 2.5 s en español con ElevenLabs.

Criterio de salida: se puede trabajar con las manos ocupadas.

### FASE E — Visión dentro del turno
Objetivo: como Looi, ver es parte de hablar.

- Cámara siempre disponible (permiso una vez).
- “qué hay aquí” manda el frame actual al turno (`image`).
- Upload / galería / 3-2-1 foto: el resultado entra al **mismo** hilo, no a un modal isla.
- Descripción la hace manos `/ver` o el VLM del FP. Si falla, “no vi la imagen”.
- Auto-purga: sí se borra el frame del BFF después del turno; no se finge ISO.

Prueba:
- Subir un ticket / etiqueta con precio → lee el número que está en la foto.
- Mentir está prohibido (el bug original).

Criterio de salida: visión + texto en un solo cerebro.

### FASE F — Dock útil (6 tools, no 15 modales)
Default dock (swipe):

1. Web — URL o “buscá X” → Playwright real + screenshot
2. Ver — cámara / archivo
3. Mercado — XAU / XAG / AUKA / HNL
4. Casa — estado FP, nodos, bóveda (listar, no dump de secrets)
5. Memoria — qué recuerda de José / pendientes
6. Ajustes — voz, funMode, lite/pro, borrar conversación+memoria

WhatsApp / correo: solo si la bóveda tiene conector y hay permiso de junta **que despacha de verdad**. Si no, no aparecen.

Orden Global: no doctrinas de ficción. Panel = repos + pendientes + docs + gold + contratos reales del FP.

Criterio de salida: cada botón del dock produce un resultado comprobable.

### FASE G — Memoria y personalidad
- Onboarding corto: nombre, cómo te hablo, qué priorizás (oro, repos, junta).
- Memoria FP: hechos (“José está en Tegus”, “villa Roatán 70%”).
- Prompt de persona editable (como Looi) pero con guardrail: no contradice tools.
- Saludo diario con un hecho real (oro / pendiente), no poesía vacía.
- Delete conversación = `olvidarConversacion`.

Criterio de salida: al día siguiente te llama por nombre y no inventa un saldo.

### FASE H — Pulido de obra (experiencia completa)
- Service worker + cache bust de JS de cara.
- Landscape lock kiosk.
- Batería / wifi reales del device, no `energy: 85` fake (o se quita).
- Errores humanos: “ojo caído”, “Qwen ocupado, reintento”.
- Tutorial de 4 cards, no 19 KB de lore.
- Accesibilidad mínima: tap grande, contraste, no depender solo del mic.
- Peso: code-split FaceCanvas; no cargar 15 modales al boot.
- Lista de ~40 micro-acciones de cara (no 1200): blink variants, look-left while thinking, nod on grant, flinch on error, sleep breathe, wink, sip, startle on clap/loud. Calidad > cantidad.
- FunMode pack separado (blasters, visor) para no ensuciar el default.

Criterio de salida: boot < 2 s JS útil, primera frase < 3 s si el nodo está caliente.

### FASE I — Preview interno, no launch
- Deploy a `ultron-looi-desk` como preview.
- Checklist de aceptación José (abajo).
- Solo entonces se habla de “lanzar”.

---

## 4. Checklist de aceptación (José)

- [ ] Boot: ojos, saludo, idle. Cero muro de sistema.
- [ ] “precio del oro” → spot real + fuente.
- [ ] “precio de la plata” → XAG real. Cero invención.
- [ ] “lempira a dólar” → cifra de página abierta + screenshot visible.
- [ ] Foto con número / texto → lo lee, no inventa blockchain.
- [ ] 8 turnos de voz sin tocar.
- [ ] Interrupt funciona.
- [ ] “abrí la bóveda” lista cajas, no recita marketing.
- [ ] Borrar chat borra memoria de esa charla.
- [ ] Sin red: cara viva + “sin cerebro”. No precios inventados.
- [ ] Logs /salud: modelo y nodo reales.

---

## 5. Qué se necesita de José (bloqueadores)

1. Confirmar que el cerebro oficial es `https://ultron.ordenglobal.link` (sí, salvo que diga otra URL).
2. Clave de ojo (`ULTRON_OJO_CLAVE`) y secreto de nodo en env de `ultron-looi-desk`, no en el front.
3. ElevenLabs: voz elegida (id) para el default.
4. Si WhatsApp/correo van en v1 o se posponen (recomiendo posponer).
5. FunMode on/off por default (recomiendo off).
6. No rotar el PAT hasta cerrar el plan; avisame si lo revocás.

No hace falta más hardware. No hace falta otro EC2.

---

## 6. Orden de ejecución inmediata

Ahora: Fase A (verdad) → Fase B (boot/cara) → Fase C (turno real).
No se toca voz streaming ni dock bonito hasta que C pase las 5 pruebas.

---

## 7. Fuera de alcance (a propósito)

- Orugas / BLE / robot físico.
- 1200 acciones el día uno.
- Cyber Ultron paralelo.
- Doctrinas geopolíticas de ficción.
- Combate láser en el producto que usa José para trabajar.
- Segundo harness en el client.
