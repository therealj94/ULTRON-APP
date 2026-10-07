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
   - **Pantalla completa** abre el visor dedicado, donde se ve y se usa todo el escritorio. Se describe abajo, en «El visor a pantalla completa (AUR09)».
   - **Con el control**, la captura pasa a ser la pantalla de ahora (en la hoja se renueva cada 1,5 s; en el visor, cada ~0,7 s):
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
| Visor completo: contrato de entradas con ACK, frame con su edad, entrada segura (AUR09) | no: el visor usa la acción de antes | `entrada` y `seguro` en `capacidades`: `POST /tareas/{id}/entrada`, `/seguro` y las cabeceras del frame. noVNC cerrado (`/vista`: 410) |
| Captura final con el motor de pago | no | sí (paso `answer` con miniatura) |

Límites honestos:
- Con el motor de pago (Claude), los clics no traen la descripción del elemento. Ahí la confirmación depende de que Claude use la herramienta (se le pide en el prompt del sistema), y la regla de no pagar es la del prompt. El permiso ligado a la operación exacta (abajo) cubre al motor gratis.
- El historial vive en la memoria del servidor de AU-RA: se pierde si el servidor se reinicia.

### Permiso exacto, parar con quietud y finales que no se reabren (AUR02, AUR03, AUR04)

- **Permiso exacto (motor gratis):** el sí se liga a la operación canónica (acción, elemento, destinatarios —correos, @usuarios, teléfonos—, importes, la huella del texto escrito en la página desde que se abrió y el dominio), más tarea, dueño, época, `pregunta_id` y caducidad. Queda reservado y se canjea una vez, dentro del candado del escritorio, recalculando la operación en el punto del efecto: un sí de «enviar a Ana» no envía a Bruno, cambiar el texto o el importe pide otra decisión (que dice lo que cambió), dos workers o un replay no lo canjean dos veces, y un efecto que se corta a medias queda `incierto` (no libera el sí para otro destino; repetirlo se pregunta diciendo que quizá ya se hizo). Cada pregunta trae `propuesta` (huella de lo mostrado); el servidor revisa que el `preguntaId` sea el de ESA tarea y la devuelve con el sí.
- **Permisos exactos (revisión externa, 4-oct):** un sí NUNCA vale por la clase de la acción. El sí a la pregunta libre del modelo (`ask_user_confirmation`, «¿Envío el mensaje a Ana?») ya no cubre ningún toque sensible (antes cubría los de su clase cuyo destino estuviera entre los nombrados; un nombre no es un destino, así que el envío en el chat de Bruno salía): el toque se pregunta con la operación exacta. En el servidor: la app tiene que mandar `propuesta` con su «sí» (sin ella, 409); si la pregunta cambia (otra pregunta u otra propuesta bajo el mismo id) antes del «sí» del chat, ese «sí» no la contesta: se le dice qué pregunta ahora y el siguiente vale; con dos misiones esperando su sí, un «sí» suelto no contesta ninguna.
- **Parar / tomar / devolver en tres estados:** `fenced` (ningún despacho nuevo) → `draining` (un toque ya despachado termina) → `quiescent` (nada en vuelo bajo la época revocada). `/parar` y `/control` esperan como mucho `ESPERA_QUIETUD_S` (5 s) y, si no alcanzó, contestan `draining` con un id (`GET /tareas/{id}/parada/{pid}`); se completan solos al terminar el toque. La tarea queda `parada` solo con quietud; al tomar o devolver el control y al parar se sueltan teclas y botones del ratón. Lo ya despachado queda con su recibo (`hecho` o `incierto`), no como deshecho.
- **Finales:** en el nodo y en el servidor un final no se reabre; una consulta que salió antes del final y llega después no cambia nada ni se avisa.
- **Compatibilidad:** un «sí» tiene que nombrar `pregunta_id` Y la `propuesta` exacta (revisión 4-oct: se quitó el camino que aceptaba el sí solo por `pregunta_id`); un «no» basta con `pregunta_id`. El servidor, además, mira qué pregunta el nodo justo antes de mandar el sí: otra pregunta u otra propuesta bajo el mismo id no se contesta. Con un nodo de antes (sin `propuesta`) el sí no se manda: hay que actualizarlo. El servidor nuevo con el nodo viejo: sin `parada`/`fase` en la respuesta dice «paré» como antes. Orden recomendado: servidor y nodo juntos; si no, primero el servidor (espera 12 s en parar/control, más que los 5 s del nodo; el servidor viejo espera 8 s).

### El visor a pantalla completa (AUR09)

**Lo que ve y hace la persona.** En la hoja de su computadora, con una tarea en marcha, aparece **Pantalla completa**. Abre el visor: una pantalla propia (`mobile/src/app/VisorComputadora.tsx`), no el modo de pantalla completa de toda la app.
- **Cerrarlo** (‹ o el «atrás» de Android) vuelve al chat. La tarea sigue, y si la persona tenía el control lo sigue teniendo.
- **Reabrirlo** encuentra la misma sesión (`mobile/src/app/visor.ts`): el mismo control, su secuencia, el zoom y el encuadre.
- **AURA nunca lo abre sola** ni lo reabre con cada avance. Mientras está abierto, la hoja tampoco se abre encima. Si la tarea pide el sí de la persona, la pregunta sale en el visor mismo, con «Sí, hazlo» y «No».

**Arriba hay una barra fija y discreta:**
- volver al chat;
- el modo: «AURA controla», «Solicitando control», «Tú controlas» o «Sin conexión»;
- el entorno (Linux · Firefox), la conexión, la antigüedad de la imagen (amarilla a más de 2 s) y la tarea;
- los mandos: Tomar el control / Devolver, Pausar / Seguir, Cancelar (pide confirmación), Ajustar / Zoom y 🔒 Segura.

**En medio está el escritorio.** Toda la conversión de coordenadas está en una sola capa probada (`mobile/src/lib/entradaRemota.ts`). La vista guarda el zoom y el centro en píxeles **lógicos** del escritorio. Por eso rotar, abrir el teclado o cambiar de tamaño no desalinea ningún toque.

| Gesto | Con el control | Sin el control |
|---|---|---|
| Tocar | Clic. Espera 250 ms por si es un doble toque | Nada (dice «toma el control») |
| Doble toque | Doble clic | Acerca o ajusta la vista |
| Toque largo | Clic derecho | — |
| Mantener y mover | Arrastre | — |
| Mover un dedo | Baja o sube la página. Nunca es un clic | Mueve la vista |
| Dos dedos | Zoom y pan de la vista. Nunca tocan el escritorio | Igual |

**Abajo, con el control, va el teclado:**
- Un campo donde la persona escribe con el teclado del teléfono, con su IME: acentos, dictado y emoji. Se manda el **texto final** con ➤, o con la tecla de retorno, que además da Enter. Nunca van tecla por tecla ni en doble (keydown + texto).
- Las teclas Esc, Tab, ⌫, Supr, las flechas y ⏎.
- Ctrl, Shift y Alt, que se arman para la tecla siguiente.
- ⇞ y ⇟ para subir y bajar sin gestos. Junto con Tab, Enter y las flechas, son la ruta para quien no puede hacer gestos precisos.
- Cada botón tiene su etiqueta para el lector de pantalla.

**Combinaciones permitidas** (la misma lista en la app, el servidor y el nodo):
- Ctrl + A, C, V, X, Z, Y, F, L, R, T o W;
- Ctrl + flechas, Inicio, Fin, Borrar, Supr, Enter o Tab;
- Shift + flechas, Tab o Enter;
- Ctrl+Shift + Z, T, Tab o flechas;
- Alt + ← o →.

Nada que salga del navegador: ni Super, ni Ctrl+Alt, ni Alt+F4, ni Ctrl+Q. Los modificadores se sueltan:
- al salir de la app;
- al perder la red;
- al cambiar el control;
- ante un error;
- al cerrar el visor.

**El contrato de entradas.** Va en `POST /api/computadora/tareas/:id/entrada` y en el nodo en `POST /tareas/{id}/entrada`.

Cada evento lleva:
- `remoteSessionId` (el id de la tarea);
- `clientId`;
- `controlEpoch`;
- `inputSequence`;
- `viewportRevision`;
- un `type` validado: `pointer` (click, doble, derecho o arrastre, en píxeles lógicos), `scroll` (−10…10 pasos), `key` (de la lista blanca), `text_commit` (1–500, compuesto en NFC, sin controles ni saltos) o `release_all`.

El servidor:
- no toma la identidad del cuerpo. El `clientId` del visor se liga a la sesión autenticada: el nodo recibe `sha256(correo | token de la sesión | clientId)`. El mismo id desde otra sesión es otro cliente;
- revisa que la tarea sea de esa persona, el tamaño (4 KB) y la forma;
- con un repetido, devuelve el mismo ACK sin ir al nodo; una secuencia vieja no pasa.

El nodo es el árbitro:
- solo acepta al cliente que tomó el control, en su época;
- una secuencia nueva sale, una repetida devuelve el mismo ACK sin tocar, una vieja da 409;
- para entradas con coordenadas, solo las del viewport que se está mostrando;
- limita el ritmo (cubeta de 30, 15 por segundo);
- lo revisa todo otra vez con el candado del escritorio, en el mismo paso en que despacha;
- si algo falla a medias, suelta teclas y botones y responde `incierta`.

Hay un ACK por evento: `{secuencia, estado, ts, frame_seq, epoca}`. Tras reconectar, la app no reenvía lo que no se confirmó: descarta la cola, manda `release_all` con una secuencia nueva y espera una imagen nueva.

El control con `clientId` queda ligado a ese cliente. Si otra sesión de la misma persona lo toma, se abre otra época y el cliente anterior queda cercado. `expectedControlEpoch` es opcional: si el control ya cambió, el nodo responde 409 y no cambia nada. Pausar con la persona al mando ya no cambia la época. Cuando la persona tiene el control, «Seguir» por voz devuelve el control por el traspaso normal.

**Frescura.** `GET …/pantalla` devuelve `{imagen, frame}`. El `frame` lleva:
- secuencia;
- hora del nodo;
- tamaño lógico;
- revisión del viewport;
- época;
- `privado`;
- `edadMs` al salir del servidor.

La app le suma lo que tardó en llegar, sin usar la hora del teléfono. A más de 2 s lo avisa. Lo riesgoso (clics, Enter, Supr, Borrar, combinaciones) espera una imagen de ahora en estos casos:
- la imagen es vieja;
- después de tomar el control, reconectar o un cambio de pantalla, hasta resincronizar;
- después de cada entrada confirmada, hasta llegar una imagen posterior.

Bajar, escribir, Tab y las flechas no esperan.

Con el control, la imagen se pide cada ~0,7 s (antes, 1,5 s). Nunca hay dos pedidos a la vez: la siguiente sale cuando llega la anterior, nunca antes de 250 ms. Además se pide una justo después de cada ACK. Con AURA al mando, cada 2 s. El límite del servidor para la pantalla pasó a 240 por minuto. Con zoom se pide a 1280 de ancho; si no, a 960.

**Entrada segura (🔒 Segura).** Es para contraseñas y datos sensibles. Solo la activa quien tiene el control. Mientras dura:
- el agente no toca nada, porque el control es de la persona;
- el modelo no mira la pantalla: el ciclo no pasa a la captura y las capturas de los pasos se saltan;
- lo que escribe la persona no se anota, ni siquiera su largo;
- su pantalla sale marcada `privado` y nada la guarda (ni el nodo, ni el servidor, ni la app);
- `GET /pantalla` del nodo responde 423;
- devolver el control o «Seguir» responden 409.

Para **terminar** hace falta una imagen pedida después de lo último que escribió la persona. El visor la pide sola y manda su `frameSeq`; con una imagen vieja, el nodo responde 409. Al terminar, el modelo recibe solo una nota: «la persona escribió algo privado; no lo leas ni lo repitas». Para que AURA siga, hay que devolverle el control a propósito.

Probado con un secreto sintético: no aparece en los pasos, el resumen, las notas ni los mensajes del modelo, ni en lo que escribe el servidor (ni en la tarea, la misión o los avisos). Ninguna captura del modelo se hizo en modo seguro.

Límite honesto: el modo seguro no vuelve invisible al sitio que recibe la contraseña. Y si la contraseña queda **visible** en la página (un «mostrar contraseña»), la primera captura que el modelo vea después de devolver el control puede mostrarla.

**noVNC está cerrado.**
- `POST /vista` responde 410 y `/vista/permitir` siempre responde 403. Con `view_only=0` aceptaba clics y teclas por fuera del árbitro, y `view_only` solo lo respeta el cliente.
- El escritorio ya no publica el puerto 6080, ni en `agente.py` ni en `instalar.sh`.
- Al crear cada escritorio se intenta cerrar el x11vnc sin clave y el noVNC de la imagen de la demo (`CERRAR_VNC=1`, por omisión). Esto no está verificado en el nodo real: si la imagen los vuelve a lanzar, solo se alcanzan desde el host, por la red interna de docker.
- No queda ningún puerto ni contraseña fija expuestos. Caddy solo publica `/api/*`, con la clave.

**Web.** `src/` no tiene un visor de la computadora: no se inventó uno ahora. Si se hace, debe usar la lógica pura de `mobile/src/lib/entradaRemota.ts` (no depende de React Native) y las mismas rutas.

**Compatibilidad y orden de despliegue.** Los campos nuevos son opcionales y, si faltan, el comportamiento sigue siendo seguro:

| Combinación | Qué pasa |
|---|---|
| Nodo nuevo + servidor viejo | El servidor viejo toma el control sin `clientId` y usa `/accion`, como siempre. Ignora las capacidades `entrada` y `seguro` y las cabeceras del frame. Nunca usó `/vista`. |
| Servidor nuevo + nodo viejo | Sin `entrada`, `/entrada` y `/seguro` responden 501 y el visor usa la acción de antes (clic en [0, 1000], escribir, teclas de antes, bajar). `frame` llega en `null`. |
| App vieja + servidor y nodo nuevos | La app toma el control sin `clientId` (el nodo lo liga a «sin cliente») y `/accion` sigue funcionando. Un visor nuevo que recupere el control la cerca. |
| App nueva + servidor viejo | El servidor no anuncia `entrada` y el visor usa la acción de antes. |

**Orden recomendado:**
1. Desplegar el nodo (`agente.py`).
2. Desplegar el servidor.
3. Publicar la app (va por OTA: no hay dependencias nativas nuevas, solo React Native y lo que ya estaba).

Cualquier otro orden también funciona. El servidor guarda las capacidades del nodo un minuto, así que el visor completo aparece como mucho un minuto después de desplegar el nodo.

Variables nuevas en `/etc/computadora.env` (opcionales):
- `ENTRADAS_POR_S` (15) y `ENTRADAS_RAFAGA` (30): el ritmo de las entradas.
- `CERRAR_VNC` (1): cerrar el VNC de la imagen al crear el escritorio.

**Medido sin el nodo real** (scratchpad, PIL 12 sobre una pantalla sintética de 1280x800 parecida a una página): preparar cada imagen tarda 20 ms de mediana y 33 ms en el p95 a 960 de ancho, y 10 ms / 14 ms a 1280 (no reescala). Pesa unos 110 KB en JPEG (147 KB en base64) a 960, y unos 150 KB (200 KB) a 1280. A una imagen cada 0,7 s son unos 210 KB/s con datos móviles.

**Sin verificar** hasta probarlo en el nodo, en un iPhone o Android real y en la red:
- lo que tarda la captura `import -window root` dentro de docker y la latencia de punta a punta;
- si el JPEG en un `Image` de React Native parpadea al cambiar cada 0,7 s;
- el teclado del Modal en Android de pantalla completa;
- la composición de IME con teclados reales (chino, japonés, dictado);
- el emoji con `xdotool type` en Firefox;
- el arrastre en páginas reales;
- que la imagen de la demo no vuelva a lanzar x11vnc.

## Desplegar el servicio nuevo en la instancia

No necesita paquetes nuevos (`re` es de la biblioteca estándar), ni cambios en Caddy (todo va por `/api/*`) ni en el escritorio.

```bash
# Desde el repositorio, con acceso a aura-computadora (<IP del nodo>; usuario ubuntu de la AMI, o por SSM):
scp scripts/nodo-computadora/agente.py ubuntu@<IP del nodo>:/tmp/agente.py
ssh ubuntu@<IP del nodo> 'sudo install -m 644 /tmp/agente.py /opt/computadora/agente.py && sudo systemctl restart computadora'

# Comprobar: debe listar las capacidades.
curl -s https://<ip-con-guiones>.sslip.io/api/salud
# → {"ok": true, "motores": ["holo"], ..., "capacidades": ["pausar", "confirmar", "control", "entrada", "seguro"]}
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
- `npx tsx --test tests/visor-computadora.test.ts`: el visor, sin teléfono. Prueba la capa de coordenadas (zoom, pan, rotación y teclado), los gestos, el teclado (IME y combinaciones, con la misma lista que el servidor), la frescura y la sesión (secuencia, ACK y que nada se reproduzca al reconectar).
- `cd mobile && npx tsx src/compa/pruebas/compa.prueba.mjs` y `npx tsx pruebas/mesa/mesa.prueba.mjs`: la lógica y la vista de la app.
