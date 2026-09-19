# Mejoras al modelo (Qwen 3.8 27B) — sistema de confianza y verificación

Reglas: no se tocó el nodo Qwen (`34.207.148.69:8443`). No se rompió la voz de escritorio
(tonos, 2 frases, "jefe"). No hay secretos en el repo.

No existían `cerebro.js` ni `lib/agente.ts`. El cerebro vive en `server.ts` →
`POST {ULTRON_NODO_URL}/api/chat`. El harness nuevo está en `lib/`.

---

## Fase 1 — System prompt de honestidad

**Archivos:** `lib/prompts/honestidad.ts`, `lib/qwen.ts`, `lib/agente.ts`

`SYSTEM_PROMPT_HONESTO` es el primer bloque de **todas** las llamadas a Qwen
(`/api/turno` y `/api/turno/stream`) vía `construirMensajes()`.

En charla de escritorio se añade `VOZ_ESCRITORIO`: las 2 frases y la etiqueta `[TONO]`
ganan sobre el formato de 4 bloques / 300 palabras. Las reglas 1, 2, 5, 7 y 10 siguen
vigentes (no afirmar que algo funciona sin ejecutarlo; admitir incertidumbre; palabras
prohibidas).

`buildPersonality` refuerza lo mismo en una línea, por si un caller olvida el compositor.

**Test:** `tests/system-prompt.test.ts` — `npx tsx --test tests/system-prompt.test.ts`

---

## Fase 2 — Few-shot de honestidad

**Archivo:** `lib/prompts/few-shot.ts`

Los 5 ejemplos se inyectan **después** del system prompt y **antes** del usuario, solo
cuando `esTareaDeCodigo(mensaje)` (código, tests, anagramas, etc.). Un "hola" no los
lleva: ensuciarían la voz.

**Test:** `tests/few-shot.test.ts`

---

## Fase 3 — Chain of Thought forzado

**Archivo:** `lib/prompts/cot.ts`

`requiereCot()` detecta: traza, complejidad, recursión, paso a paso, debug, analiza,
algoritmo, Big-O. Si hay match, se añade `COT_FORZADO` y se **quita** el override de voz
para que Qwen pueda escribir los 7 pasos.

**Test:** `tests/cot.test.ts`

---

## Fase 4 — Multi-modelo (Qwen + crítico)

**Archivo:** `lib/critico.ts`

- `CRITICA_ACTIVA=true` y `ANTHROPIC_API_KEY` en el entorno. Default: **apagado**
  (cero costo y cero latencia extra en la mesa).
- Sin `@anthropic-ai/sdk`: `fetch` a `https://api.anthropic.com/v1/messages`.
- Modelo: `ANTHROPIC_MODEL` (default `claude-sonnet-4-5`).
- Flujo (`completarTurnoCodigo` en `lib/agente.ts`): Qwen escribe → Claude critica →
  si hay bugs, una corrección de Qwen. Solo en `/api/turno` JSON cuando el mensaje es
  de código. El stream de voz no espera a Claude.

El e2e de anagramas se salta si no hay clave. Costo estimado ~$0.01 por crítica.

**Test:** `tests/critico.test.ts`

---

## Fase 5 — Ejecutor real

**Archivos:** `lib/ejecutor.ts`, `scripts/ejecutor.py`, `POST /api/ejecutar`

No se instaló Docker ni systemd en el nodo Qwen (prohibido tocarlo). Tampoco se asume
Docker en Render.

Orden de backends:

1. `EJECUTOR_URL` → Flask opcional (`scripts/ejecutor.py`, puerto 11436).
2. `EJECUTOR_DOCKER=1` si `docker info` responde: sandbox del prompt (`--network=none`,
   256m, 1 cpu, read-only).
3. `python3` local en `/tmp` con timeout 10s (lo que corre en este entorno).

Auto-ejecuta el Python de la respuesta solo si el usuario dice «ejecuta / corre los
tests / verifica». El endpoint `/api/ejecutar` siempre está (salvo `EJECUTOR_ACTIVO=false`).

El local **no** es un sandbox duro. Para producción: máquina aparte + Docker.

**Test:** `tests/ejecutor.test.ts` (print 1+1, excepción, timeout).

---

## Fase 6 — RAG de snippets verificados

**Archivo:** `lib/rag.ts`

Corpus curado en el repo (`SNIPPETS`, 30 piezas: anagramas, palíndromo, sort, grafos,
normalizar acentos, etc.). Búsqueda léxica por tags. Se inyectan hasta 3 snippets en
tareas de código.

No se levantó Qdrant ni se llamó a OpenAI embeddings: esa infra no está en el stack
actual y fingirla violaría la regla de honestidad. Escalar a Qdrant es el siguiente
paso cuando haya un volumen real de snippets (objetivo 100+).

**Test:** `tests/rag.test.ts`

---

## Fase 7 — Fine-tuning LoRA (no hecho)

Opcional, 1–2 semanas, ~$50–200, y **desplegaría un peso distinto en el nodo Qwen**,
que está prohibido tocar. No se entrenó nada. Cuando la junta lo pida: dataset de
honestidad + Unsloth en un GPU aparte, A/B contra el 27B actual, deploy solo con OK
explícito.

---

## Cómo se arma un mensaje

```
[SYSTEM_PROMPT_HONESTO]
[VOZ_ESCRITORIO]            ← solo charla
[personalidad + HECHOS]
[COT_FORZADO]               ← si requiereCot
[FEW_SHOT_HONESTO]          ← si esTareaDeCodigo
[SNIPPETS VERIFICADOS]      ← si código y hay hits
---
user: <mensaje>
```

Variables (`.env.example`): `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `CRITICA_ACTIVA`,
`EJECUTOR_ACTIVO`, `EJECUTOR_DOCKER`, `EJECUTOR_URL`.

---

## Taller (tareas, canales, mantenimiento)

ULTRON no finge WhatsApp/correo/llamadas. `lib/taller.ts` despacha de verdad o dice qué clave falta.
El resultado se habla **sin pasar por Qwen** (Qwen decía "Hecho" con el envío fallido).

Listo ya: estado de nodos, mantenimiento (re-probar, no SSH al cerebro), pendientes, PDF, código, web.
Con clave: Telegram (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`), WhatsApp/llamada (Twilio + `JEFE_WHATSAPP` / `JEFE_TELEFONO`), correo (Resend + `MAIL_FROM`).

`GET /api/taller` · `GET /api/sistema` · `GET /api/tareas` · `GET /api/taller/archivo/:id`
Menú de la app: sección Taller. Por voz: «cómo está el sistema», «anota que…», «envía por telegram…», «llámame».

