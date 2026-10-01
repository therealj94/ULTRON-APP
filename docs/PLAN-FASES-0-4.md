# Plan AURA, fases 0 a 4

Este plan es para el agente que va a implementar. Al terminar cada fase, otro agente audita el trabajo antes de seguir con la siguiente.

Repo: `therealj94/ULTRON-APP`. Rama: `ccr-a300ded3-ru9biy`. A `main` solo se llega por PR con CI en verde.

## Reglas que no se rompen

1. **Commits**
   - Trabaja solo en `ccr-a300ded3-ru9biy`.
   - Ningún identificador de modelo va en commits, PRs ni comentarios de código.
   - Cada commit termina con:
     ```
     Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
     Claude-Session: https://claude.ai/code/session_01SSJeyuY9Zf9WXmA2uFVe5k
     ```
2. **Secretos:** nunca pidas secretos por chat ni los escribas en el repo. Van en Render, en GitHub Secrets o en el nodo (`/etc/...`).
3. **Dinero:** AURA **nunca mueve dinero**. Un envío se firma siempre **dentro de Veta Wallet**, nunca en AURA.
4. **Nodo de producción (A10G `i-06530893af0dd0638`)**
   - Antes de tocarlo hace falta OK del usuario.
   - Respalda en `/root/*.respaldo-<fecha>` antes de editar.
   - No reinicies la instancia.
5. **Borrar o apagar recursos** (T4, archivos, ramas) requiere confirmación del usuario.
6. **Coucou (MIT):** se puede adaptar código con atribución. Nunca usar Mochi: ni el nombre, ni el icono, ni los sonidos, ni las imágenes.
7. **Cómo se valida cada fase**
   - `npm test` en la raíz: hoy pasan 1222.
   - `windows/tests`: hoy hay 315 aserciones.
   - `npm test` en `windows/centro`.
   - CI `aura-windows.yml` en verde.
   - Ningún test se salta ni se desactiva.
8. **Al cerrar cada fase**
   - Escribe `docs/entregas/FASE-N.md` con: qué cambió (archivos), cómo se probó (salida de los tests), qué quedó pendiente y qué números se midieron.
   - Ese archivo es lo que se audita.

---

## Fase 0: Seguridad (hoy, antes de cualquier demo)

**Hallazgo verificado:** `https://aura-fp.onrender.com/server.cjs` (1,9 MB) y `server.cjs.map` (3,8 MB) son públicos. La causa es que `server.ts:3688` sirve todo `dist/` con `express.static`, y el build (`package.json:8`) escribe ahí el servidor y su sourcemap.

| # | Tarea | Dónde | Criterio de hecho |
|---|---|---|---|
| 0.1 | Dejar de servir el código del servidor | Opción A: cambiar el build para que el servidor salga a `build-server/` en vez de `dist/`, y ajustar `start` y el Dockerfile o la config de Render. Opción B: un middleware antes de `express.static` que responda 404 a `/*.cjs`, `/*.map` y `/importar-cubo*`. **Prefiere A**, y añade B como red de seguridad. | `curl -I /server.cjs` y `/server.cjs.map` responden 404 en prod. Hay un test nuevo que lo cubre. |
| 0.2 | Arranque seguro | `server.ts:3650`: si `NODE_ENV` no es `production` hoy se abre todo. Hay que fallar cerrado: en Render, si falta `NODE_ENV`, se comporta como producción. El modo dev se pide de forma explícita (`AURA_DEV=1`). | Test: sin `NODE_ENV` no hay rutas abiertas. |
| 0.3 | Turnos anónimos | Los turnos anónimos no pueden llegar al modelo Uncensored. | Test. |
| 0.4 | Límite de cuerpo | El JSON de 12 MB se acepta antes de la autenticación. Baja el límite global (≈1 MB) y sube solo en las rutas autenticadas que lo necesitan. | Test: 413 sin sesión. |
| 0.5 | `EJECUTOR_URL` sin autenticación | Añadir el secreto compartido (mismo patrón que `x-ultron-secreto`). | Test. |
| 0.6 | Mesa | Que una sesión cualquiera ya no cuente como «mesa». Revisa `exigirMesaODesk`. | Test. |
| 0.7 | `.env.example` tiene IPs reales | Reemplazarlas por marcadores. | `grep` no encuentra IPs. |
| 0.8 | Clave escrita en el código de Genesis | `gidp_veta-wallet_…` en `genesis-id/src/auth/aplicaciones.ts:205` (otro repo). Moverla a una variable de entorno. **La rotación la hace el usuario**: déjale los pasos escritos. | Ya no aparece en el código. |
| 0.9 | Rotar secretos expuestos | El código público pudo filtrar nombres de rutas y la lógica de auth. Escribe la lista de qué rotar (secreto del nodo, `ELEVENLABS_*`, Genesis) y los pasos. **No lo hagas tú**: lo hace el usuario. | Lista en `FASE-0.md`. |
| 0.10 | Ojo por HTTP y TLS inseguro hacia el nodo | Documentar en `FASE-0.md` y proponer el arreglo. No tocar el nodo sin OK. | Documentado. |

**Auditoría:**
- `curl` a prod: `/server.cjs` y `.map` en 404.
- Tests nuevos en verde.
- El diff no rompe el arranque en Render (revisar el log del deploy).

---

## Fase 1: Voz (semanas 1–2)

**Decisión:** AURA Windows conversa por **ElevenLabs Agents con nuestro cerebro como LLM propio**, el mismo camino que ya usa el teléfono (`server/voz-agente.ts`).
- Voz: Eleven v4 Turbo (`server/eleven.ts:28`).
- Rutas que ya existen:
  - `POST /api/voz/agente` emite el pase.
  - `POST /api/voz/agente/cerrar`.
  - `POST /api/voz/llm[/v1]/chat/completions` es el LLM propio, en SSE estilo OpenAI.

ElevenLabs se encarga de transcribir, detectar el fin de turno, manejar interrupciones y hablar. Nosotros seguimos haciendo el cerebro, las manos y la guarda.

No se usan modelos voz-a-voz (OpenAI Realtime, Gemini Live): reemplazarían nuestro cerebro.

| # | Tarea | Dónde | Criterio de hecho |
|---|---|---|---|
| 1.1 | Origen `windows` en el agente de voz | `server/voz-agente.ts`: que el pase acepte `origen:'windows'` y que el turno inyecte `instruccionWindows(idioma)` (`server/windows-rutas.ts`) para que el cerebro emita `⟦hacer: …⟧`. Mantener los cupos (`MAX_CONVERSACIONES`, `CUPO_TURNOS_MIN`) y `precalentarSistema`. | Test en `tests/` con un nodo falso: el turno de Windows lleva la instrucción y el marcador llega intacto en el SSE. |
| 1.2 | Cliente de voz en Windows | Nuevo `windows/src/Aura.Windows/Voz/AgenteVoz.cs`: pide el pase al servidor, abre el WebSocket de conversación de ElevenLabs (`wss://api.us.elevenlabs.io/...`, con el token que firmó el servidor; **la API key nunca va al cliente**), manda el micrófono en PCM 16 kHz y reproduce el audio que vuelve con `Altavoz`. | Conversación de 5 turnos sin cortes. |
| 1.3 | Manos dentro de la voz | El texto que llega del agente pasa por `FiltroAcciones` (`Aura.Windows.Core/Acciones.cs`). La orden se ejecuta con `HacerOrdenDelCerebro` y la guarda `Coherente`. El marcador **no se pronuncia**: el servidor lo quita del texto que va a TTS y lo manda aparte. Elige el mecanismo, por ejemplo un evento propio o una client tool del agente, y justifícalo en `FASE-1.md`. | «Pon bachata en Spotify» suena bachata. «Cierra el bloc de notas» cierra. Nada de eso se dice en voz alta. |
| 1.4 | Despertar con «hey AURA» | Reemplazar SAPI en `Voz/Despertador.cs` por openWakeWord (modelo ONNX local, Apache-2.0) con un modelo «hey aura». Si no hay modelo entrenado, usar el más cercano y dejar documentado cómo entrenarlo. «Apágate» y «deja de escuchar» siguen silenciando. | Medir en 10 minutos de ruido de oficina: cero despertares falsos, y despierta en ≥ 9 de 10 intentos. |
| 1.5 | Respaldo | Si no hay internet o ElevenLabs falla, volver al camino actual (`Oido.cs` + Whisper + `/stream`). Ajuste para elegir: `Ajustes.VozMotor = "agente" \| "local"`. | Prueba cortando la red: AURA sigue respondiendo por el camino local. |
| 1.6 | Región US | `server/eleven.ts:32` usa `api.elevenlabs.io`. Hacerlo configurable (`ELEVEN_API`, por defecto `https://api.us.elevenlabs.io/v1`). | Test. |
| 1.7 | Medición | Registrar en `aura.log` estos tiempos: fin de habla → primer token del cerebro → primer audio. | Mediana de primer audio < 1,5 s en 20 turnos. Los números van en `FASE-1.md`. |

**Costo esperado:** $0,08 por minuto de conversación ($0,16 en ráfaga). El LLM es el nuestro y no se cobra aparte.

**Auditoría:**
- Video o log de una conversación con acciones.
- Medianas de latencia.
- Prueba de corte de red.
- La API key no aparece en el binario ni en el tráfico del cliente.

---

## Fase 2: Cerebro (semanas 2–3, en paralelo con la 1)

**Hoy:**
- `llama.cpp` en la A10G con Qwen3.8-27B Q4_K_M, draft-mtp y 4 slots.
- Precalentado del system prompt: el prefill bajó de 6,5 s a 0,4–0,6 s.
- Cadena: Render → `ultron-motor` → `ollama-proxy-ndjson` (:11434) → `llama-server` (:8080).

| # | Tarea | Dónde | Criterio de hecho |
|---|---|---|---|
| 2.1 | Prueba con vLLM en la misma A10G, **en otro puerto** (:8081), sin parar `llama-server`. **Pide OK del usuario antes de empezar.** | Cuantización AWQ/GPTQ de 4 bits que quepa en 24 GB, con `--enable-prefix-caching` y **sin MTP**: MTP con caché de prefijo baja la precisión (vLLM #43559 y #54360). Guía: https://recipes.vllm.ai/Qwen/Qwen3.8-27B | Servicio systemd aparte (`vllm-prueba`), con respaldos hechos. |
| 2.2 | Comparación A/B | `scripts/nodo-a10g/ab-cerebro.py`: 50 turnos reales anonimizados contra cada motor. Medir primer token, tokens/s, uso de VRAM y la tasa de `⟦hacer⟧` correctos según los checks de `windows/tests`. | Tabla en `FASE-2.md`. vLLM solo gana si el primer token sale < 0,5 s, va a ≥ 25 tok/s y la tasa de acciones no baja. |
| 2.3 | Cambio de motor, solo si gana | Apuntar el proxy a :8081 con una variable y dejar llama.cpp listo para volver atrás. **Hace falta OK del usuario.** | Vuelta atrás probada en < 1 min. |
| 2.4 | Modelo pequeño para órdenes cortas (opcional) | Un Qwen pequeño responde solo los turnos que son una orden simple y ya resuelta por reglas. El resto va al 27B. | Medido en la A/B. |

**No hacer:**
- No usar SageMaker: cuesta más y arranca en frío.
- No apagar llama.cpp hasta que vLLM gane.

**Auditoría:**
- Tabla A/B con los datos crudos.
- Respaldos en `/root`.
- Prod sigue igual si vLLM no ganó.

---

## Fase 3: Producto (semanas 3–5)

| # | Tarea | Dónde | Criterio de hecho |
|---|---|---|---|
| 3.1 | Dirección de Veta Wallet sin pegarla | Genesis `/sso/verificar` ya devuelve `perfil.apps:[{app, direccion}]`, pero `server/genesis.ts:100` lo descarta. Extraer la dirección de `veta-wallet` (validar `0x[0-9a-fA-F]{40}`), guardarla en el perfil y exponerla a `windows/centro/src/vistas/cartera.ts`. Dejar el portapapeles como respaldo. | Al entrar con Genesis, la cartera muestra los saldos sin pedir nada. Hay test. |
| 3.2 | Enviar ORIGEN y otros tokens, firmando en Veta Wallet | En el repo `express-js-on-vercel`, rama `claude/aura-5-ecosistema`, archivo `apps-web/veta-wallet/app.js`: nueva ruta `#enviar?to=&monto=&token=&ref=`. Ahí la persona revisa y firma, y al terminar la wallet vuelve a `ultronfp://tx?hash=&estado=&ref=`. AURA solo arma el enlace, recibe el hash y lo **verifica en cadena** antes de decir «enviado». | AURA nunca firma ni tiene claves. Un hash falso o de otra transacción se rechaza. Hay test. |
| 3.3 | Microsoft Store (MSIX) | Empaquetar con MSIX junto al instalador Inno actual. La Store firma el paquete, así que no aparece el aviso de SmartScreen. Añadir un job en `.github/workflows/aura-windows.yml`. Crear la cuenta de partner y enviar el paquete lo hace el usuario: déjale los pasos. Revisar que funcionen la OTA, el loopback OAuth (`127.0.0.1:43821`), el registro de `ultronfp://` y UIA dentro de MSIX. Ajustar donde haga falta. | El `.msix` se genera en CI. Hay una lista de lo que cambia dentro de MSIX. |
| 3.4 | Funciones rápidas | «¿Qué puedo hacer?» (lista hablada y en el Centro); «Buenos días» (agenda, clima y saldos); alertas de precio (umbral → aviso en el notch); leer PDF al soltarlo (extender `LeerArchivo` en `NotchWindow.Soltar.cs`). | Cada una con test en `windows/tests`. |

**Auditoría:**
- La cartera se llena sola.
- Un envío de prueba en testnet o con un monto mínimo, firmado en la wallet.
- MSIX generado en CI.

---

## Fase 4: Pulido (continuo)

| # | Tarea | Criterio de hecho |
|---|---|---|
| 4.1 | El Centro se congela | Manejar `CoreWebView2.ProcessFailed` y `RenderProcessUnresponsive`: recargar solo, sin perder la sesión. Probar con un bucle infinito inyectado. |
| 4.2 | Jerga técnica en la web | Quitar «ejecutor», «nodo», «slot» y similares de lo que ve la persona. Revisar con grep las cadenas de UI. |
| 4.3 | La T4 llamada «APAGADA» sigue encendida | Instancia `i-02653feadc919d3a4`, ≈ $380/mes. **Pedir confirmación al usuario** y luego detenerla (stop, no terminate). |
| 4.4 | Latencia real de punta a punta | Tablero simple en `/api/windows/salud` con las medianas de la fase 1.7. |
| 4.5 | Animaciones y diseño | Revisar la lista del diagnóstico: https://claude.ai/code/artifact/b4271b17-585b-4790-848e-ec24568e0e06 |

---

## Orden si hay que elegir

0 → 1 → 3.1 y 3.2 (Veta Wallet) → 2 → 3.3 y 3.4 → 4.

## Fuentes

- ElevenLabs Agents, precios: https://thunderphone.com/guides/elevenlabs-agents-pricing
- Comparativa de voz 2026: https://futureagi.com/blog/best-voice-ai-may-2026/
- Benchmark Cartesia, Deepgram y ElevenLabs: https://dev.to/mrzitoun/benchmarking-real-time-voice-ai-apis-cartesia-vs-deepgram-vs-elevenlabs-2026-2n8c
- vLLM Qwen3.8-27B: https://recipes.vllm.ai/Qwen/Qwen3.8-27B. Bugs: https://github.com/vllm-project/vllm/issues/43559 y https://github.com/vllm-project/vllm/issues/54360
