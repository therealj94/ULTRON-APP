# Entrega identificable y vuelta atrás coordinada (P5)

Este documento acompaña al paquete P5 de la auditoría externa del 4 de octubre de 2026 (A6, A7 y el contrato de entrega).
Explica cómo identificar qué combinación está corriendo y cómo volver atrás de forma coordinada sin perder trabajo en
curso. **Solo usa comandos y acciones que ya existen en el repositorio o en los servicios que usa.** Lo que no está
automatizado se indica como acción manual. Este documento no reemplaza el ensayo real en staging (gate G7). Ese ensayo
sigue pendiente.

## 1. Qué está corriendo

`GET /api/build` exige la sesión de mesa. Devuelve el manifiesto de entrega (`lib/build.ts`, `manifiestoEntrega`):

| Campo | Qué acredita | Si no se sabe |
|---|---|---|
| `servidor.sha`, `servidor.hora` | Revisión del servidor (`RENDER_GIT_COMMIT`) y hora de arranque del proceso | `desconocido` |
| `web.sha`, `web.hora` | Revisión de la que salió el build web que se sirve (`dist/aura-build.json`, escrito por `scripts/pwa/vite-build-info.ts`) | `desconocido` (por ejemplo, un `dist` anterior a P5) |
| `nodo.estado`, `nodo.hash`, `nodo.validador`, `nodo.capacidades` | Lo que el nodo de la computadora dice en su `/salud`: los primeros 16 hex del sha256 de su `agente.py`, la versión de su validador y sus capacidades | `desconocido` si no contesta; `no_configurado` sin `COMPUTADORA_URL`/`COMPUTADORA_CLAVE` |
| `validadorMinimo`, `nodo.validadorSuficiente` | El validador mínimo que exige el servidor (`VALIDADOR_MIN`) y si el nodo llega a ese mínimo | `null` si no se sabe |
| `esquema` | Versiones de lo que se guarda: `tareas` 1, `indiceTareas` 2 y `misionesComputadora` 1 | — |
| `contratos`, `banderas` | Lo de siempre: contratos entre piezas y banderas no secretas | — |
| `almacen` | Una lectura y una escritura reales del almacén durable (`sondearAlmacen`, con caché de 30 s) | `ok: false` con el motivo |

`GET /api/health` (público) sigue contestando `ok: true` mientras haya servidor. **Ese 200 no prueba que el almacén
esté sano.** Para eso está el campo aparte `almacen: { ok, tipo, comprobado }`.

El manifiesto **no** acredita el APK ni el `updateId` de la OTA que tiene instalada cada teléfono, ni el instalador de
Windows. Eso se anota a mano desde el dispositivo (guion físico, recorrido 1 de la auditoría). Si las piezas no
coinciden con lo esperado, se detiene la aceptación y se explica el desfase.

Para comprobar a mano el hash del nodo, en la máquina del nodo:

```bash
sha256sum /opt/computadora/agente.py | cut -c1-16
```

## 2. Qué datos nuevos deja P5 y cómo los lee una versión anterior

Todo vive en el mismo almacén durable de siempre (`ultron/durable/` en S3 o `data/durable/` en disco). No hay base de
datos nueva ni migración destructiva.

- **Índice de tareas v2** (`tareas/indice/<huella>/lista`): cada entrada puede llevar `fin`. Una versión anterior a P5
  lee `ids[].id` igual que antes e ignora `fin`. Si esa versión escribe el índice, vuelve a recortar a 40 y a dejar
  fuera las tareas activas más viejas. Por eso, **mientras corra una versión anterior, la A7 vuelve a reproducirse.**
  Al volver a P5, el índice se repara solo en una dirección: una tarea leída por su id (`GET /api/trabajos/:id`) se
  vuelve a anotar. Una tarea que la versión vieja sacó del índice y que nadie vuelve a pedir por id sigue sin
  aparecer en la lista hasta que alguien la pida.
- **Misiones durables de la computadora** (`computadora/misiones/…`, `computadora/tareas/…`, `computadora/historial/…`,
  `computadora/seguimiento/…`): una versión anterior a P5 no las lee. Vuelve al comportamiento de antes: solo ve las
  misiones de su propia memoria y contesta 404 a las de otra réplica o de antes del reinicio. Los objetos se quedan; al
  volver a P5 se recuperan con su dueño, su final y sus recibos.
- **Lo que no cambia de forma:** `tareas/<huella>/<id>`, `tareas/pedidos/…`, `computadora-pedidos/…`, `operaciones/…` y
  `turnos/…`. Una versión anterior los sigue leyendo igual.

## 3. Vuelta atrás coordinada, pieza por pieza

El orden importa: se vuelve primero lo que **produce** datos nuevos (servidor) y después lo que los consume.

1. **Antes de empezar**
   - Anota el manifiesto (`GET /api/build`) y la lista de tareas activas de una cuenta de prueba (`GET /api/trabajos`
     con `completo: true`).
   - Anota las misiones vivas de su computadora (`GET /api/computadora`).
   - No vuelvas atrás con una misión que espera un «sí» o con un control incierto (`controles[].estado === 'unknown'`):
     primero resuélvelos o páralos.
2. **Servidor y web** (los dos salen del mismo despliegue de Render: `npm run build` y luego `npm start`)
   - En el panel de Render, elige un despliegue anterior del servicio y usa su acción de volver a ese despliegue
     (rollback). Es una acción del panel, no un comando de este repositorio.
   - La otra opción es revertir el commit en `main` (`git revert <sha>` y push, con la revisión de siempre), y Render
     despliega el resultado.
   - Después, comprueba que `servidor.sha` y `web.sha` de `/api/build` son los esperados. En una versión anterior a P5,
     `/api/build` no trae esos campos: entonces compara `commit`.
3. **Nodo de la computadora** (solo si también cambió)
   - Copia el `agente.py` de la revisión deseada a `/opt/computadora/` y ejecuta `systemctl restart computadora`, como
     indica `scripts/nodo-computadora/instalar.sh`. También sirve volver a correr ese script.
   - El nodo olvida sus tareas al reiniciarse. Las misiones que seguían vivas se cierran con un final honesto: «se
     reinició y perdió la tarea; no sé si alcanzó a terminar». Nunca se cierran como éxito. Por eso conviene reiniciar el
     nodo sin misiones vivas.
   - Comprueba que `nodo.hash` coincide con `sha256sum agente.py | cut -c1-16` y que `nodo.validadorSuficiente` es `true`.
4. **App móvil** (solo si la OTA nueva depende del servidor nuevo)
   - Workflow «OTA (EAS Update)» (`.github/workflows/ota.yml`) con `accion: volver-a-la-apk`. Ejecuta
     `eas update:roll-back-to-embedded` para la huella de runtime de esa APK.
   - Para volver a una OTA anterior concreta, el propio workflow remite a `eas update:republish`.
   - Los clientes viejos siguen funcionando contra el servidor nuevo: `/api/trabajos` sin parámetros devuelve la misma
     forma de siempre y los campos nuevos (`completo`, `siguiente`, `conteo`, `aviso`, `mision.controles`) se ignoran.
5. **Windows**: tiene su propio instalador y su propio camino de publicación. P5 no lo toca.

## 4. Volver a avanzar

Se despliega de nuevo la revisión P5 y se vuelve a comprobar el manifiesto. Las misiones y tareas que se crearon con P5
antes de volver atrás reaparecen con su dueño, su estado y sus recibos. No se vuelve a despachar ninguna tarea al nodo.
Las tareas que la versión anterior sacó del índice se reparan al leerlas por su id (ver el punto 2).

## 5. Lo que este documento NO acredita

- No se ensayó todavía con el backend y el almacén reales de staging, ni con varios hosts. Las pruebas del repositorio
  (`tests/computadora-replicas.test.ts`, `tests/trabajos-indice.test.ts`) usan procesos reales en una sola máquina, con
  S3 y nodo sintéticos.
- No hay alertas automáticas de tarea estancada, `reconciling`/`unknown` prolongado ni desfase de versión. El manifiesto
  y `almacen` dan los datos, pero las alertas siguen pendientes.
- Si una réplica muere, su seguimiento lo retoma otra **cuando alguien consulta** (la app, el panel o una ruta), una vez
  vencido el lease. No hay un proceso que barra las misiones huérfanas al arrancar.

## 6. Inventario de tareas por dueño (A7): lo que operación tiene que saber

La lista de tareas solo dice `completo: true` cuando el inventario del dueño está reconciliado: se recorrió entera su
carpeta `tareas/<huella>/` y el índice tiene todo lo que había (`lib/tareas-durables.ts`, «inventario (A7)»). Para eso
el almacén tiene que poder **listar** (`s3:ListBucket` sobre `ultron/durable/tareas/`).

- **Comprobar el permiso:** `almacen.listado` en la salud (`ok` / `denegado` / `sin-fuente`). Desde la revisión 13 la
  sonda lista UNA clave bajo `tareas/<huella de un dueño sintético>`, la misma forma de prefijo que usa el inventario
  (antes probaba `salud/`, y un permiso acotado por prefijo podía dar «ok» sin servir al inventario). No enseña nada
  de lo listado.
- **Si el listado falla** (p. ej. 403), cada réplica lo recuerda por dueño entre 5 y 15 minutos y no vuelve a pedir el
  LIST en cada lectura; mientras tanto la lista contesta `completo: false`, `reconciliado: false`,
  `inventario.estado: 'error'`, con su aviso. Arreglado el permiso, se reconcilia sola en la siguiente ventana.
- **`conteo.recortadas`:** terminadas que siguen existiendo pero que el tope del historial (las 200 terminadas más
  recientes) ya no lista. No hacen la lista incompleta; la ruta lo dice en `aviso`. No es un fallo.
- **`inventario.estado: 'revertido'`:** operación revirtió la reconciliación de ese dueño (§7). La lista dice
  `completo: false`, `reconciliado: false` y un aviso («se revirtió por decisión de mantenimiento… puede faltar alguna»),
  y no se vuelve a reconciliar hasta que operación la reactive. No es un fallo del almacén.

### Tareas legadas cuya reserva se borró (quedan «sin verificar» para siempre)

Una tarea creada antes de A7 no guarda dentro la huella de su dueño. El inventario solo la adopta si la reserva de su
pedido (`tareas/pedidos/<huella>/<requestId>`, escrita en la misma creación) apunta a ese id. Si esa reserva ya no existe
—el caso típico: una regla de ciclo de vida del cubo (p. ej. expirar a los 30 días, ver `lib/durable.ts`) que borró
`tareas/pedidos/…` pero no el objeto de la tarea, o lo borró antes— el objeto queda **sin verificar**:

- no se adopta ni se cuenta, y el índice de ese dueño **nunca** se marca reconciliado: su lista dirá siempre
  `completo: false` con `inventario.estado: 'sin-verificar'` y el aviso «puede faltar alguna»;
- el recorrido entero (LIST de su carpeta y una lectura por objeto fuera del índice) se repite cada 15 minutos
  mientras alguien consulte la lista.

Cómo detectarlo: `diagnosticarInventarioTareas(correo)` (función de operación, solo lee) devuelve `sinVerificar > 0`; o
el índice (`tareas/indice/<huella>/lista`) trae `pase.fin` con `pase.sinVerificar > 0` y sin `inventario`.

Acción recomendada, en este orden:

1. **Que no vuelva a pasar:** la regla de ciclo de vida no puede borrar las reservas antes que las tareas. Lo más
   simple es que `tareas/` entero (objetos, `pedidos/` e `indice/`) tenga la misma regla, o excluir `tareas/pedidos/`
   de la expiración. Nunca expirar `tareas/pedidos/` sola.
2. **Para los objetos que ya quedaron sin reserva**, elige una:
   - **Cuarentena (recomendada si no se puede demostrar de quién son):** copia cada objeto sin verificar a
     `tareas-cuarentena/<huella>/<id>` (fuera de la carpeta del dueño) y después bórralo de `tareas/<huella>/`. El
     siguiente recorrido termina sin dudas y el dueño queda reconciliado. La tarea no se pierde (sigue en la cuarentena)
     pero deja de verse; si después se demuestra que era suya, se devuelve a su carpeta y se vuelve a anotar su reserva.
   - **Restaurar la reserva (solo con prueba independiente de que es de ese dueño,** p. ej. registros del servidor de esa
     fecha): escribe `tareas/pedidos/<huella>/<requestId>` = `{ "id": "<id>" }` con el `requestId` que trae el objeto.
     El siguiente recorrido (pasados como mucho 15 minutos) la adopta. Que el objeto esté en la carpeta de esa huella NO
     es prueba suficiente: es justo lo que A7 no da por bueno.
   - **Aceptarlo:** si son pocas y viejas, se puede dejar así. La lista sigue siendo honesta (`completo: false` con su
     aviso), con el coste del recorrido cada 15 minutos.
3. No uses `AURA_RECONCILIAR_TAREAS=off` para «arreglarlo»: apaga el inventario para todos y la lista dice
   `completo: false` siempre; no fabrica la garantía.

## 7. Revertir la reconciliación del inventario de un dueño (A7) y volver a activarla

Para cuando lo que agregó la reconciliación de un dueño no debía estar en su lista. Son funciones de operación de
`lib/tareas-durables.ts`; no hay ruta HTTP. Se ejecutan a mano desde una consola del servidor que tenga las mismas
variables del almacén (`ULTRON_MEMORIA_BUCKET` y las credenciales `AWS_*`, o `ULTRON_DURABLE_DIR` en disco), por
ejemplo:

```bash
npx tsx -e "import('./lib/tareas-durables').then((m) => m.revertirReconciliacionTareas('correo@dueño')).then((r) => console.log(r))"
```

**Qué hace `revertirReconciliacionTareas(correo)`** (revisión externa sobre a46b496: «el historial puede quedar incompleto
o reaparecer una tarea recuperada»):

- Quita del índice **solo** las entradas que agregó el inventario (`rec`), cuya tarea **ya terminó** y que **no tuvieron
  actividad** desde que se recuperaron: el objeto de la tarea no cambió (`actualizada`) después de recuperarse (`rt`; en
  las entradas de a46b496, que no traen `rt`, se toma el inicio de su ronda, que es anterior: se conserva de más, nunca
  de menos). Una entrada sin objeto también sale.
- Una recuperada que **sigue activa** (no terminó) es trabajo vivo: **se queda**, sin la marca `rec`, aunque nadie la
  haya tocado. Volver a esconderla es justo el fallo que A7 arregló.
- Una recuperada que después avanzó, terminó o se canceló **ya es historial propio**: se queda, sin la marca `rec`.
- Una entrada cuyo objeto no se pudo leer se queda tal cual (`pendientes`): nunca se quita a ciegas.
- Devuelve al índice lo que el tope del historial sacó del índice de antes al agregar lo recuperado (del respaldo
  `tareas/indice-respaldo/<huella>/antes-de-inventario-v1`, solo si el objeto existe y es de ese dueño) y recorta otra
  vez.
- `conteo.recortadas`: lo que contó el inventario (`dr`) son las terminadas que su recorte sacó del índice de antes. Las
  que vuelven dejan de contarse **una sola vez** (antes se descontaban dos veces y la cuenta bajaba con cada ciclo de
  reactivar y revertir). Las que no pueden volver se siguen contando. Se suma lo que el recorte saque ahora. Ejemplo:
  con 10 recortadas de antes y 5 tareas perdidas, al reconciliar quedan 15 y al revertir vuelven a quedar 10, en cada
  ciclo.
- **Sin el respaldo** (se borró o nunca se escribió), no vuelve nada de lo recortado: esas terminadas siguen contadas en
  `conteo.recortadas` (la lista lo avisa) y el resultado trae `sinRespaldo: true` (y un aviso en el registro). El
  historial no se pierde en silencio.
- **Un dueño sin índice ni respaldo** (por ejemplo, un correo mal escrito) no tiene nada que revertir: no se escribe nada
  (ni la marca `revertido`, que lo dejaría bloqueado) y el resultado trae `sinIndice: true`. Revisa el correo.
- Todo en una sola fusión CAS sobre el índice actual: lo que se creó, cambió o anotó después de la reconciliación (o
  durante la reversión) se queda.
- Deja en el índice la marca `revertido` (`{ gen, t, quitadas, conservadas, restauradas, pendientes, … }`). Como vive en
  el índice y no en la memoria de una réplica, **ninguna réplica vuelve a reconciliar a ese dueño ni le agrega nada**,
  aunque `AURA_RECONCILIAR_TAREAS` siga en `agregar` (una réplica que estaba a mitad de recorrido tampoco: su escritura
  se descarta). Ya no hace falta apagar el interruptor antes.
- Devuelve `{ ok, quitadas, conservadas, restauradas, pendientes, ya }` (más `sinIndice` o `sinRespaldo` cuando
  aplican). Es idempotente y reanudable: si
  `pendientes > 0`, se repite cuando el almacén conteste; si no queda nada, no escribe (`ya: true`).
- **Nunca borra objetos** de tareas ni el respaldo.

**Volver a activarla:**

- Un dueño: `reactivarReconciliacionTareas(correo)` quita la marca `revertido`. En su siguiente lectura de la lista se
  vuelve a inventariar y se agrega lo que falte, con su propio respaldo (`…-v1-r<n>` tras la reversión número n), así
  que se puede volver a revertir.
- Todos los revertidos a la vez: subir `AURA_RECONCILIAR_TAREAS_GENERACION` (entero, 1 por omisión) en el servicio y
  redesplegar. Una reversión hecha en la generación N solo bloquea mientras la vigente sea ≤ N. Lo que se revierta en la
  generación nueva queda bloqueado hasta la siguiente.

**Límites:**

- La regla de actividad mira la `actualizada` del objeto. Leer una tarea no es actividad. Pero una tarea quitada que
  alguien abre por su id (`GET /api/trabajos/:id`) vuelve a anotarse como siempre (es uso, no inventario).
- Si una tarea quitada cambia justo entre la lectura de la reversión y su escritura, se vuelve a anotar al comprobarla
  inmediatamente después. Si cambia más tarde, sigue fuera de la lista hasta que alguien la abra por su id.
- Un servidor anterior a esta revisión conserva la marca `revertido` al escribir el índice, pero no la respeta: si corre
  con `AURA_RECONCILIAR_TAREAS=agregar`, puede volver a agregar lo revertido. Durante un despliegue mixto, deja esas
  réplicas con `AURA_RECONCILIAR_TAREAS=off`.
- `conteo.recortadas` es una cuenta, no una lista de ids. Si alguien borra a mano el objeto de una terminada recortada
  que no pudo volver, la cuenta puede quedar con una de más hasta que se reactive y se vuelva a inventariar. El código nunca
  borra objetos de tareas.
