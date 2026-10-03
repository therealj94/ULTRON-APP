# Su computadora como un agente (plan, su sí, pausa, control, resultado)

José (2-oct): «Tiene que funcionar ya todo: la computadora que tiene el avatar, manejar el proceso; copiemos un poco cómo lo hacen otros: Grok, el agente de ChatGPT».

Este documento dice qué ve la persona, qué hace cada pieza y **qué hay que desplegar en la instancia `aura-computadora`** para que todo funcione. La instalación base de la instancia está en [COMPUTADORA-AGENTES.md](COMPUTADORA-AGENTES.md).

## Lo que ve la persona, paso a paso

1. **Pide algo.** Lo dice en la conversación («entra a bch.hn y dime el dólar») o lo escribe en *Más → Su computadora → ¿Qué quieres que haga?*.
2. **El plan.** AURA arma un plan corto (3 a 6 pasos) antes de empezar:
   - Lo escribe el cerebro en el pedido: `PEDIR_HERRAMIENTA: computadora <misión> PLAN: a | b | c`.
   - Si el cerebro no lo escribe, o si la misión se encargó desde la app, el plan se arma con la instrucción (`planDeMision`).
   - AURA lo dice en una frase («Va. Mi plan: entrar a bch.hn, leer lo que muestra la página y darte el resultado»).
3. **La vista en vivo se abre sola.** Arriba está la captura de lo que ve la computadora. Debajo:
   - lo último que AURA contó;
   - **el plan como lista que se va marcando**: ✓ hecho, ● ahora, Ⅱ en espera, ✕ falló;
   - **el tiempo transcurrido** (⏱ 1:05);
   - lo que hizo, paso a paso. Al tocar un paso se ve su captura.
4. **Los mandos:**
   - **Detener** está siempre.
   - **Pausar / Seguir** y **Tomar el control / Devolver** aparecen solo si el servicio de la instancia ya está actualizado. Si no lo está, la app dice que esos botones llegan con la actualización y que por ahora solo se puede detener. AURA también lo explica si se lo piden en voz.
   - **Con el control**, la captura pasa a ser la pantalla de ahora (se renueva cada 1,5 s):
     - Al tocarla se hace clic en ese punto.
     - Hay un campo para escribir y botones Enter, ↑ y ↓. Lo que la persona escribe no se guarda en los pasos, así que puede poner su contraseña ella misma.
     - Al tocar **Devolver**, el agente sabe que la pantalla cambió y sigue desde ahí.
   - **Por voz:** «para / pausa / sigue tu computadora» → el cerebro pide `PEDIR_HERRAMIENTA: computadora parar|pausar|seguir`.
5. **Su sí antes de algo sensible.** Antes de enviar un formulario, iniciar sesión, publicar o borrar, la computadora se queda quieta y pregunta:
   - En la app aparece la pregunta con **«Sí, hazlo» / «No»**, y la vista se abre aunque la persona la hubiera cerrado.
   - AURA pregunta en voz: «Antes de seguir necesito tu sí. Voy a tocar «Enviar». ¿Lo hago? Dime sí o no.».
   - Si la app está cerrada, llega un aviso al teléfono: «Tu computadora espera tu sí».
   - El «sí» o el «no» dicho en la conversación lo resuelve el servidor (`resolverPreguntaComputadora`), no el modelo. En la voz espera a que el turno se confirme.
   - Sin respuesta en 10 minutos, la tarea se cierra sin hacerlo.
   - **Pagar o comprar: nunca.** El nodo no hace ese toque aunque el modelo lo pida, y tampoco escribe números de tarjeta.
6. **El resultado.** Al terminar, la tarjeta muestra:
   - cómo terminó: Listo, A medias, Detenida o Falló;
   - el tiempo y los pasos;
   - lo que encontró, en texto seleccionable;
   - los **datos** sueltos («Compra: 24.70») en una tabla;
   - los **enlaces** (se abren al tocarlos);
   - la **captura final**;
   - **Compartir**, con la hoja del sistema (desde ahí se copia);
   - **Seguir**, si quedó a medias.

   AURA dice el resultado en voz.
7. **Historial.** Abajo están sus misiones recientes (hasta 10). Al tocar una se abre su tarjeta, aunque la instancia ya haya olvidado la tarea (la olvida tras una hora).

## Robustez

| Situación | Qué pasa |
|---|---|
| El nodo no contesta al encargar | Se reintenta una vez (1,5 s). Un 4xx no se reintenta. Si falla, AURA lo dice con honestidad y ofrece intentarlo en un momento. |
| Deja de contestar a media tarea | Tras 5 consultas fallidas: «Mi computadora no me contesta; sigo intentando». Si vuelve: «ya me contesta; sigo». A los 2 minutos sin respuesta se cierra con un final honesto («dejó de contestarme a mitad de la tarea; no sé si alcanzó a terminar») y se ofrece seguir. |
| El nodo se reinició (404) | Se cierra enseguida con el mismo tipo de final y se ofrece seguir. |
| Se acabaron los pasos | La misión sigue sola hasta 3 tareas más desde donde quedó la pantalla. Después: «No alcancé a terminar… ¿Sigo?». Un «sí» (voz) o el botón **Seguir** la continúan (hasta 2 veces). |
| Lleva más de 15 min trabajando | Se para y se dice dónde quedó, con «¿Sigo?». El tiempo en pausa, con el control o esperando su sí no cuenta. |
| La app pierde avisos | La vista y la raíz preguntan el estado. Si una tarea terminó o se quedó quieta, el tecleo se apaga. Sin noticias, se apaga a los 6 min (32 min si está quieta). La vista dice «No me llega lo que hace tu computadora. Sigo intentando…». |

## Qué soporta cada versión del servicio

El servidor lee `capacidades` en `GET /salud` del nodo y solo ofrece lo que el nodo sabe hacer.

| | agente.py desplegado hoy | agente.py de este cambio |
|---|---|---|
| Encargar, seguir pasos, capturas, parar | sí | sí |
| Plan, tiempo, tarjeta del resultado, historial, reintentos | sí (los hace el servidor) | sí |
| Estados `pausada`, `confirmar`, `control` | no | sí |
| Pausar / Seguir | no: la app solo ofrece Detener y lo explica | `POST /tareas/{id}/pausar`, `/reanudar` |
| Pedir su sí antes de algo sensible | no: solo la regla del prompt («para y dilo») | herramienta `ask_user_confirmation` (Holo y Claude), más una revisión propia de cada clic del motor gratis: los clics en «Enviar», «Iniciar sesión», «Publicar», «Borrar»… piden el sí aunque el modelo no lo pregunte |
| Nunca pagar | solo la regla del prompt | además, el clic en «Pagar», «Comprar», «Checkout», «Add to cart»… no se hace, y escribir un número de tarjeta tampoco |
| Tomar el control / Devolver | no (noVNC no se publica) | `POST /tareas/{id}/control`, `/accion` (clic en [0, 1000], escribir, teclas permitidas, bajar) y `GET /tareas/{id}/pantalla` (JPEG). Todo por la misma API con clave, sin publicar noVNC |
| Captura final con el motor de pago | no | sí (paso `answer` con miniatura) |

Límites honestos:
- Con el motor de pago (Claude), los clics no traen la descripción del elemento. Ahí la confirmación depende de que Claude use la herramienta (se le pide en el prompt del sistema), y la regla de no pagar es la del prompt. El permiso ligado a la operación exacta (abajo) cubre al motor gratis.
- El historial vive en la memoria del servidor de AU-RA: se pierde si el servidor se reinicia.

### Permiso exacto, parar con quietud y finales que no se reabren (AUR02, AUR03, AUR04)

- **Permiso exacto (motor gratis):** el sí se liga a la operación canónica (acción, elemento, destinatarios —correos, @usuarios, teléfonos—, importes, la huella del texto escrito en la página desde que se abrió y el dominio), más tarea, dueño, época, `pregunta_id` y caducidad. Queda reservado y se canjea una vez, dentro del candado del escritorio, recalculando la operación en el punto del efecto: un sí de «enviar a Ana» no envía a Bruno, cambiar el texto o el importe pide otra decisión (que dice lo que cambió), dos workers o un replay no lo canjean dos veces, y un efecto que se corta a medias queda `incierto` (no libera el sí para otro destino; repetirlo se pregunta diciendo que quizá ya se hizo). Cada pregunta trae `propuesta` (huella de lo mostrado); el servidor revisa que el `preguntaId` sea el de ESA tarea y la devuelve con el sí.
- **Parar / tomar / devolver en tres estados:** `fenced` (ningún despacho nuevo) → `draining` (un toque ya despachado termina) → `quiescent` (nada en vuelo bajo la época revocada). `/parar` y `/control` esperan como mucho `ESPERA_QUIETUD_S` (5 s) y, si no alcanzó, contestan `draining` con un id (`GET /tareas/{id}/parada/{pid}`); se completan solos al terminar el toque. La tarea queda `parada` solo con quietud; al tomar o devolver el control y al parar se sueltan teclas y botones del ratón. Lo ya despachado queda con su recibo (`hecho` o `incierto`), no como deshecho.
- **Finales:** en el nodo y en el servidor un final no se reabre; una consulta que salió antes del final y llega después no cambia nada ni se avisa.
- **Compatibilidad:** el nodo nuevo no exige campos nuevos (sin `propuesta` acepta el sí por `pregunta_id`, como antes). El servidor nuevo con el nodo viejo: sin `parada`/`fase` en la respuesta dice «paré» como antes. Orden recomendado: servidor y nodo juntos; si no, primero el servidor (espera 12 s en parar/control, más que los 5 s del nodo; el servidor viejo espera 8 s).

## Desplegar el servicio nuevo en la instancia

No necesita paquetes nuevos (`re` es de la biblioteca estándar), ni cambios en Caddy (todo va por `/api/*`) ni en el escritorio.

```bash
# Desde el repositorio, con acceso a aura-computadora (54.85.85.77; usuario ubuntu de la AMI, o por SSM):
scp scripts/nodo-computadora/agente.py ubuntu@54.85.85.77:/tmp/agente.py
ssh ubuntu@54.85.85.77 'sudo install -m 644 /tmp/agente.py /opt/computadora/agente.py && sudo systemctl restart computadora'

# Comprobar: debe listar las capacidades.
curl -s https://54-85-85-77.sslip.io/api/salud
# → {"ok": true, "motores": ["holo"], ..., "capacidades": ["pausar", "confirmar", "control"]}
```

También vale correr de nuevo `instalar.sh`, que copia `agente.py` y reinicia el servicio. Al reiniciar, las tareas en curso se pierden: el servidor de AU-RA las cierra con un final honesto (404 → «se reinició y perdió la tarea»). El servidor guarda las capacidades un minuto, así que la app ofrece los botones nuevos como mucho un minuto después.

Variables opcionales en `/etc/computadora.env`:
- `ESPERA_CONFIRMACION_S`: cuánto espera su sí. Por omisión, 600.
- `PAUSA_MAX_S`: cuánto puede durar una pausa o el control. Por omisión, 1800.
- `PERMISO_VALE_S`: cuánto vale un sí antes de canjearse. Por omisión, 120.
- `ESPERA_QUIETUD_S`: lo más que parar, pausar o tomar/devolver el control esperan al toque en vuelo antes de contestar `draining`. Por omisión, 5.

## Pruebas

- `python3 -m unittest scripts/nodo-computadora/test_agente.py`: pausa, control, el sí, nunca pagar y el ciclo del motor gratis. No necesita FastAPI ni GPU: usa módulos de mentira.
- `npx tsx --test tests/computadora.test.ts tests/acciones-app.test.ts`: el servidor contra un nodo falso como el agente.py nuevo (y como el viejo).
- `cd mobile && npx tsx src/compa/pruebas/compa.prueba.mjs` y `npx tsx pruebas/mesa/mesa.prueba.mjs`: la lógica y la vista de la app.
