# ULTRON DESK — 9 planes de mejora (criterio ≥ 8)

Fecha: 2026-09-17  
Regla: cada plan tiene problema, score hoy, herramienta externa (adoptar ≠ fusionar repo), solución, pasos, aceptación.  
Si el plan no llega a 8 de **calidad de plan** (completo, medible, con dueño técnico), se reescribe.  
No se fusiona AILIS / VRM / Live2D encima de FaceCanvas. Esa cara ya es el activo.

Fuentes usadas en la investigación:
- OpenLive (VAD+STT+TTS+barge-in+visión on-device)
- LiveKit Agents (sesión de voz, adaptive interrupt)
- Qwen3-TTS streaming / WS (~97–110 ms first packet)
- @ricky0123/vad-web (Silero VAD en browser)
- Mem0 / Letta / Zep-Graphiti (memoria; **no** sustituyen `/saber` del FP)
- gold-api.com `/price/{XAU,XAG}`

---

## Plan 1 — Presencia y UI (cara primero)

**Hoy: 6.5.** Ojos buenos, cockpit encima.

**No fusionar:** AILIS, Meuxe, Open-LLM-VTuber. Traen VRM/Live2D y otra religión visual.

**Adoptar ideas:**
- Meuxe “mini mode”: cara full bleed, chat al hover.
- OpenVoiceUI: face plugin, no 15 pantallas.

**Solución:**
1. Default = FaceCanvas 100% viewport, dock un handle de 8 px.
2. Flag `ULTRON_UI=lite`. Modales fuera del bundle lite: AWS, Android blueprint, biometric, tutorial lore, Global Order theater, harness modal, Playwright modal (la web va al turno).
3. Quedan: cara, dock (mic, texto, 6 chips), VoicePicker (3), Settings mínimo (speaker/mic/borrar).
4. Boot ≤ 2 s: ojos + health silencioso + “José. Listo.”

**Aceptación 8:** screenshot de arranque sin tag GUARDIAN ni muro; un extraño entiende “hay alguien”.  
**Score del plan: 8.5**

---

## Plan 2 — Voz en sesión (el plan más caro)

**Hoy: 3.5.** WAV de 4.3 s. Sin barge-in sobre Qwen-TTS.

**No meter LiveKit Cloud** (otra factura). Sí copiar el *pipeline*.

**Adoptar:**
| Pieza | Repo / lib | Uso |
|---|---|---|
| Sesión + interrupt | livekit/agents (patrón, no hosting) | cancel TTS + flush cola |
| VAD browser | `@ricky0123/vad-web` Silero | barge-in local 200 ms |
| Loop local referencia | katipally/openlive | VAD→STT→TTS→stop |
| First packet | camelCase12/qwen3-tts-streaming o vllm-omni WS | PCM chunks |
| Nodo nuestro | `35.175.175.203:8790` hoy `/synthesize` WAV | añadir `/ws/stream` o `/synthesize?stream=1` |

**Solución (dos tramos):**
- **2A (desk, esta semana):** sesión abierta 25 s; Silero VAD corta `Audio` + abort fetch TTS; no esperar WAV para poner SPEAKING (SPEAKING al primer byte).
- **2B (nodo T4):** parchear el servidor 8790 con stream PCM 24 kHz (código de `qwen3-tts-streaming`). Desk reproduce con `AudioWorklet`. Meta: TTFA < 800 ms en Wi-Fi junta.

ElevenLabs solo si 8790 cae. Nunca en el hot path.

**Aceptación 8:** 8 turnos sin tocar pantalla; interrupt corta en < 300 ms; TTFA p50 < 1.5 s.  
**Score del plan: 8.5** (2B es el riesgo; 2A solo sería 7 — por eso 2A+2B van juntos.)

---

## Plan 3 — Ver en el mismo turno

**Hoy: 3.** Gaze ≠ visión. `/ver` existe y no entra al hilo.

**Adoptar idea, no repo:** OpenLive “camera frame rides each turn”.

**Solución:**
1. Si el user dice “qué ves / leé esto / foto / precio en la imagen” O hay `image` en el payload → el frame JPEG del `<video>` stealth viaja en `POST /api/turno`.
2. BFF llama manos `/ver` **antes** de Qwen. El texto entra en HECHOS.
3. Si `/ver` falla: “no vi la imagen”. Cero Gemini inventando oficina.
4. Upload/galería = mismo campo `image`, no `VisionMediaAnalyzerModal`.

**Aceptación 8:** ticket con número → el número sale en la frase; sin imagen → no describe una oficina.  
**Score del plan: 8**

---

## Plan 4 — Memoria corta y larga

**Hoy: 2.** FP `memoria: mongo` + `/saber` 401. JSON de Render se borra.

**No sustituir FP con Mem0 cloud** (datos de junta fuera). Mem0/Letta/Zep son *modelo mental*.

**Solución:**
| Capa | Dónde | TTL |
|---|---|---|
| Corta | últimos 12 turnos en el POST turno (ya) | sesión |
| Larga junta | Ultron FP `/saber` con la cookie de `/api/ultron/entrar` | permanente |
| Larga local fallback | `localStorage` + `/api/memoria` | hasta redeploy |
| Extractor | “recuerda que X” y hechos de oro/villa/nombre | inmediato |

Pasos: mapear el contrato real de `/saber` (GET 401 = existe); login desk→FP una vez; proxy `/api/memoria` = FP si hay sesión, si no local. Borrar chat = olvidar conversación FP.

**Aceptación 8:** apagar el teléfono, volver, “¿cómo me llamo?” usa el hecho; redeploy no borra si FP está up.  
**Score del plan: 8** (el 8 depende de documentar el schema de `/saber` en el primer spike de 1 día).

---

## Plan 5 — Personalidad y tono

**Hoy: 4.** Voces 3 OK. Copy de “junta / cañones / despacho”.

**Adoptar:** Looi personality prompt (corto, editable). No 1200 acciones.

**Solución:**
- System prompt único 12 líneas: español hondureño corto, no inventa, te tutea, 1 gag máx.
- Pack de cara: 40 microgestos (blink, look, nod, flinch, sleep, wink, sip). Lista versionada en `src/face/gestos.ts`.
- Voces ya definidas: Marco default trabajo; Luna; Looi play.
- Prohibido en strings de UI: “Doctrina”, “Alfa-1”, “nodo AWS Playwright”, “triple A”.

**Aceptación 8:** grep limpio de esas frases; saludo ≤ 4 palabras; Looi voice no recita infra.  
**Score del plan: 8**

---

## Plan 6 — Honestidad de producto

**Hoy: 6.** Health y spot ya no mienten. Los modales sí.

**Solución:**
- `/api/health` es la fuente de verdad (ya).
- Cada label de modelo/nodo sale de health, nunca hardcoded.
- Quitar o `410` rutas teatro: `/api/orden-global` doctrinas fake, vault latencyMs, vision heuristic.
- README = este archivo + PLAN.md. Nada de “Enterprise Intelligence Core”.

**Aceptación 8:** grep `Playwright-AWS|Alfa-1|latencyMs: 3|Heuristic` = 0 en server + App.  
**Score del plan: 8.5**

---

## Plan 7 — Utilidad dura (donde ya ganamos a Looi)

**Hoy: 8.5 en metales.** No tocar lo que funciona. Ampliar igual.

**Keep:** `https://api.gold-api.com/price/XAU|XAG` cache 30 s; `open.er-api.com` HNL 60 s.

**Sumar (solo si hay dato real):**
- AUKA / gram 22k = spot × factor documentado (no inventar L/g).
- Playwright + screenshot **solo** con URL o “abrí la página”.
- Dock chips: Oro, Plata, Lempira, Ver, Web, Casa.
- Fallo de API = “no está”, nunca un número viejo sin timestamp.

**Aceptación 8:** las 5 pruebas C en verde + chip Oro < 400 ms.  
**Score del plan: 8.5**

---

## Plan 8 — Arquitectura / craft

**Hoy: 4.** App.tsx dios + FaceCanvas 2.3k + server 900.

**No reescribir en Electron/AILIS.** Partir in-place.

**Solución de carpetas:**
```
src/face/        FaceCanvas, gestos, gaze
src/voice/       session, vad, ttsPlayer
src/agent/       turno client, historial
src/dock/        DockDrawer flaco
src/session/     user, memoria cache
server/turno.ts  tools + qwen
server/tts.ts
server/memoria.ts
```
Regla: un PR por carpeta. App.tsx < 400 líneas al final.

**Aceptación 8:** App.tsx < 500; FaceCanvas no importa Express; tests smoke de `/api/turno` y `/api/health` en CI (script node).  
**Score del plan: 8**

---

## Plan 9 — Fun pack separado + criterio de “obra”

**Hoy: fun mezclado = juguete.**

**Solución:**
- `funMode` default **off** en producto de junta; on solo si José lo pide (ya dijo on — entonces pack cargado lazy, no en el critical path).
- Bundle `fun.ts`: blasters, visor, saber. Code-split.
- 40 gestos default ≠ 1200 de Looi. Calidad: idle 45 s se siente vivo.
- Launch freeze: no se dice 9 de producto hasta planes 2, 3, 4 en aceptación.

**Aceptación 8:** Lighthouse-ish: JS útil boot < 2 s en 4G; fun no se descarga si off.  
**Score del plan: 8**

---

## Orden de ejecución (no en paralelo caótico)

```
6 honestidad (1 día, grep)
1 UI lite (2 días)
7 utilidad chips (1 día)     ← ya casi 8
5 tono + grep copy (1 día)
8 split App (3 días, en ramas)
3 visión en turno (2 días)
4 /saber (2 días, bloquea login FP)
2A VAD+abort (2 días)
2B stream T4 (3–5 días, el más duro)
9 fun lazy + freeze
```

Bloqueadores que hay que pedir a José solo si 4 se traba: cookie/sesión FP para `/saber`.

## Score de este documento

Primera pasada tenía el Plan 2 solo con “usar ElevenLabs stream” = 6. Reescrito con VAD local + parche al nodo 8790 + meta numérica = 8.5.  
Plan 4 sin contrato `/saber` = 7. Reescrito con fallback local + spike de schema = 8.

**Documento: 8.5.**  
**Producto hoy: 4.5–5.5.**  
Los planes no suben el producto solos; suben cuando se cierran las aceptaciones en ese orden.
