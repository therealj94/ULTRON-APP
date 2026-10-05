# Pruebas reales en aparatos — voz, llamada, escritorio e iPhone

Lo que las pruebas automáticas no cubren: micrófono, altavoz, red móvil, la computadora de verdad y Safari en un
iPhone. Cada corrida deja anotada **exactamente qué versión se probó**; sin esa identificación el resultado no cuenta.

Reglas: solo cuentas y contactos propios (enviarse a uno mismo o a un segundo número propio); nada de dinero real;
si algo falla, se anota tal cual (hora de Honduras, qué se dijo, qué pasó) y no se repite «hasta que salga».

## 1. Identificar la versión (antes de empezar)

| Pieza | Dónde se lee | Valor probado |
|---|---|---|
| Servidor | `/api/build` (con sesión de mesa) → `servidor.sha`; sin sesión, `/api/health` → `commit` (corto) | |
| Web | `/api/build` → `web.sha` y `web.hora` (de `dist/aura-build.json`) | |
| Esquema y banderas | `/api/build` → `esquema`, `validadorMinimo`, `banderas` (no secretas) y `almacen.ok` | |
| Computadora (nodo) | `/api/build` → `nodo.hash`, `nodo.validador`, `nodo.capacidades` (lo mismo que dice el nodo en `/salud` → `hash`). Comparar con `sha256sum scripts/nodo-computadora/agente.py \| cut -c1-16` del SHA revisado | |
| App Android (APK) | Ajustes de Android → Aplicaciones → AU-RA: versión y versionCode (en `mobile/app.json`; hoy 5.3.0 / 53) | |
| Actualización OTA | Ajustes de AU-RA, al final junto a «Cerrar sesión»: `OTA xxxxxxxx` (primeros 8 del `updateId`) · fecha · `runtime`; «JS de la APK» si no hay OTA | |
| Instalador Windows | Nombre y `Get-FileHash -Algorithm SHA256` del `.exe` del instalador; commit del release que lo publicó | |
| iPhone | Ajustes → General → Información: versión de iOS; Safari o la PWA en pantalla de inicio | |
| Aparato Android | modelo y versión de Android | |

El commit del servidor, el de la web y el de la OTA deben coincidir con el SHA revisado, y el `hash` del nodo con el
de su `agente.py`. Si no coinciden, se para y se anota cuál corre: no se mezclan resultados de versiones distintas.
Las credenciales (claves de mesa, del nodo, de cuentas) nunca se copian en la hoja ni en capturas.

## 2. Voz normal (mesa, teléfono Android)

| # | Qué hacer | Qué debe pasar | Resultado |
|---|---|---|---|
| V1 | Decir «hola, ¿cómo estás?» | Contesta en voz en < 3 s, sin cortar la frase | |
| V2 | Interrumpirla a mitad de una respuesta larga | Calla y escucha; no repite lo ya dicho | |
| V3 | «Investiga los precios del oro de hoy y avísame» | Dice que empezó solo si la tarea existe en Tareas; al terminar llega la notificación | |
| V4 | «Cállate» con un turno en camino | No dice el resto de ese turno | |
| V5 | Pedir un correo a tu propia dirección y decir «sí» | Sale una sola vez; aparece en Enviados | |
| V6 | Pedir un WhatsApp a Ana (número propio) y, antes del «sí», cambiar a Bruno | Pide confirmar a Bruno; el «sí» anterior no manda nada a Bruno | |

## 3. Llamada (conversación en vivo)

| # | Qué hacer | Qué debe pasar | Resultado |
|---|---|---|---|
| L1 | Abrir la conversación en vivo y hablar 2 minutos | Sin cortes; la cara sigue la voz | |
| L2 | Cortar la red (modo avión 5 s) y volver | Se disculpa, retoma con la última frase; no queda sorda | |
| L3 | Colgar | El micrófono vuelve a la mesa sin cerrar la app (sin crash) | |
| L4 | Salir de la sesión con la llamada abierta | La llamada se cierra; al entrar con otra cuenta no se oye nada de la anterior | |

## 4. Escritorio (computadora de AURA)

| # | Qué hacer | Qué debe pasar | Resultado |
|---|---|---|---|
| E1 | «Crea tres documentos: informe.docx, presupuesto.xlsx y carta.pdf» | Solo «completado» si los tres existen, no vacíos y del tipo pedido; si falta uno, dice cuál | |
| E2 | Pedir un archivo y, en la vista en vivo, cerrar sin guardar | Queda «sin comprobar» / parcial, nunca «listo» | |
| E3 | Detener una tarea a mitad | Se detiene; no se relanza sola | |
| E4 | Una pregunta de la computadora («¿confirmo?») contestada desde la app | Solo vale para esa propuesta; si cambió, vuelve a preguntar | |

## 5. iPhone (Safari y la app en pantalla de inicio)

| # | Qué hacer | Qué debe pasar | Resultado |
|---|---|---|---|
| I1 | Abrir `aura-fp.onrender.com` sin sesión | Solo «Entrar a AU-RA» con Veta Wallet; sin mesa ni micrófono | |
| I2 | Entrar con Veta Wallet | Vuelve a AU-RA con la sesión puesta (sin «dirección no válida») | |
| I3 | Escribir algo, cerrar sesión antes de que conteste, entrar con otra cuenta | La respuesta de la primera no aparece ni se oye | |
| I4 | Hablarle con el micrófono | Pide permiso una vez; oye y contesta | |
| I5 | Activar avisos y tocar uno con la app cerrada | Abre la pantalla del aviso (Tareas o la conversación) | |

## 6. Guion físico de la auditoría 8+ (4-oct, sección 4)

Ocho recorridos con la entrega identificada (tabla 1). Cada fila se marca en **una** columna: `pass` (se vio lo
esperado), `fail` (se anota qué se vio, con hora) o `unverified` (no se corrió o faltó el aparato). Un fallo se anota a
la primera y se conserva aunque después se arregle; no se repite hasta conseguir una captura bonita. Entorno mínimo:
staging aislado con almacén durable desechable y dos procesos de servidor, un nodo identificado, un Android físico, un
iPhone con Safari/PWA, una PC Windows y dos cuentas de prueba A/B con datos sintéticos. Lo que necesite un proveedor
pagado o un envío real requiere autorización específica (servicio, cuenta, destino propio y tope de gasto). Veta, solo
en sandbox autorizado; nunca una transferencia real.

Qué superficie es cada cosa: [MATRIZ-SUPERFICIES.md](MATRIZ-SUPERFICIES.md). La computadora remota (Linux) y las manos
de Windows se marcan por separado.

### 6.1 Identidad de entrega

| # | Pasos exactos | Qué registrar | pass | fail | unverified |
|---|---|---|---|---|---|
| G1 | Con sesión de mesa, abrir `/api/build` y guardar el JSON completo (sin cabeceras ni cookies) | `servidor.sha`, `web.sha`, `esquema`, `validadorMinimo`, `banderas`, `almacen.ok` | | | |
| G2 | Leer `nodo` del mismo JSON y el `hash` de `/salud` del nodo; calcular el sha256 (16 hex) de `agente.py` del SHA revisado | `nodo.hash`, `nodo.validador` (≥ `validadorMinimo`), `nodo.capacidades` (incluye `entrada`, `seguro`) | | | |
| G3 | En el Android: Ajustes del sistema (versión/versionCode) y Ajustes de AU-RA (línea OTA) | versión, versionCode, `OTA xxxxxxxx` (updateId) y runtime, o «JS de la APK» | | | |
| G4 | En la PC: hash del instalador antes de instalar; versión del `.exe` instalado (Propiedades → Detalles) | SHA256 del instalador, versión `2.0.N`, commit del release | | | |
| G5 | En el iPhone: versión de iOS y modo (Safari o PWA instalada) | iOS x.y, modo | | | |
| G6 | Comparar todo con el SHA revisado | coinciden sí/no; si no, se para aquí y se explica el desfase | | | |

### 6.2 Recorridos

| # | Recorrido | Pasos exactos | Qué debe pasar / qué registrar | pass | fail | unverified |
|---|---|---|---|---|---|---|
| R1 | Primer resultado útil | Cuenta nueva (A). Pedir «compara tres opciones de X con fuentes». Omitir conexiones opcionales. Volver del panel al chat; cerrar y reabrir la app; buscar la misma tarea | La misma tarea y su resultado tras reabrir; si falta una fuente, dice cuál. Registrar id de tarea y **tiempo hasta valor útil** (objetivo inicial ~5 min, no una promesa) | | | |
| R2a | Voz normal | 20 turnos: escuchar/responder, interrumpir a mitad, «cállate», mute (si se anuncia), cerrar y abrir otra vez | Audio audible; la primera intención tras interrumpir se atiende; indicador de micrófono correcto; sin audio residual. Registrar aparato, red, frío/caliente | | | |
| R2b | Voz con fallos de sistema | Permiso de micrófono denegado y luego concedido tarde; llamada entrante del sistema; cambio Bluetooth/auriculares/altavoz; cortar red; Wi-Fi↔datos; bloquear/desbloquear; salir de A y entrar B | Desconexión natural no deja «hablando» ni añade respuestas de la sesión cerrada; nada de A se oye con B | | | |
| R2c | Llamada (por separado) | 10 sesiones de llamada por combinación crítica, con los mismos cortes de R2b | Igual que R2b; registrar duración y motivo de cada fin | | | |
| R3a | Computadora: lote de teclado | Abrir el escritorio desde la tarea, «Tomar el control». Escribir `café ☕` y Enter del teclado. Pegar `uno` salto `dos` y tocar ➤ | En el editor del escritorio: `café ☕`, salto, `uno`, salto, `dos`, **una vez y en orden**. El campo no se vacía hasta que llega. Registrar superficie (Android/web/PWA), teclado (IME, físico) | | | |
| R3b | Computadora: composición y gestos | Acentos y emoji del teclado del aparato, dictado, teclado físico; scroll, selección (arrastre), atajos permitidos (Ctrl+C/V/A/L/F) | Llega el texto compuesto final, sin duplicados; atajos fuera de la lista se rechazan | | | |
| R3c | Computadora: rotar y frame demorado | Repetir R3a rotando/redimensionando a mitad y con red lenta (frame tardío) | Coordenadas alineadas; el Enter espera la imagen nueva («espera la imagen de ahora antes del Enter») | | | |
| R3d | Computadora: rechazo y corte | A mitad del pegado: modo avión 5 s (o app a segundo plano, o tomar el control desde otro aparato) y volver | Se pausa; **nada sale solo al volver**; «Seguir», «Editar» y «Descartar» hacen lo suyo; un ACK perdido pregunta «¿llegó?» y no repite el Enter sin respuesta | | | |
| R3e | Computadora: devolver y parar | Devolver el control; tomarlo otra vez; «Volver al chat» con el control; luego «Cancelar» la tarea con AURA activa | Devolver exige imagen fresca; volver al chat **no** cancela la tarea ni suelta el control; tras parar y ACK `quiescent`, ninguna entrada del agente | | | |
| R3f | Manos Windows locales | Con el instalador de G4: escribir por voz/texto en Bloc de notas, Word, navegador y WhatsApp de escritorio; probar un campo de contraseña y cambiar de ventana a mitad | Escribe una vez, sin Enter ni Tab; se niega en contraseña; se detiene al cambiar de ventana y dice cuánto alcanzó | | | |
| R4 | Memoria e iniciativa | Guardar un dato sintético, corregirlo, marcar «No usarlo»; comprobar chat, voz, propuesta proactiva y otro aparato tras reiniciar. Crear un aviso sustentado en una fuente, resolver el asunto antes del envío y desconectar la fuente | El dato corregido/vetado no aparece en ninguna superficie; no sale un aviso obsoleto como si se hubiese revalidado | | | |
| R5 | Conectores y resultado | Búsqueda con resultado, búsqueda vacía válida, timeout y autorización caducada. Con autorización expresa: un envío a cuenta propia; simular respuesta perdida y reconciliar | Los cuatro casos se distinguen; el envío sale una vez. Registrar `operationId`, recibo del proveedor y estado comprobado (no solo «aceptado») | | | |
| R6 | PWA y actualización | Safari e instalación en inicio: login, salida, sesión A/B, voz, notificación y apertura del destino correcto. Offline. Actualizar con una tarea y un audio activos | Offline dice la limitación y al volver recupera la tarea; actualizar no duplica trabajo ni reanuda audio de otra sesión | | | |
| R7 | Recuperación y reversión | Crear y operar una tarea alternando dos réplicas; matar un proceso durante el trabajo y otro tras un efecto con ACK perdido. Revertir a la versión anterior con los datos nuevos y volver a avanzar (ver [ROLLBACK-COORDINADO.md](ROLLBACK-COORDINADO.md)) | Misma identidad, propietario, estado, controles y recibo; nada despachado dos veces; documentar el comando no basta | | | |

## 7. Muestras y umbrales (del MASTER, se conservan)

| Qué | Muestra mínima | Umbral / objetivo inicial (todavía no resultados) |
|---|---|---|
| Aceptación por candidato | ≥ 30 escenarios de los cinco recorridos × 10 repeticiones de **cada** escenario = ≥ 300 ejecuciones controladas, con los fallos nuevos del informe | Parciales, desconocidos, timeouts y fallos cuentan en el denominador |
| Voz física | Smoke: 20 turnos normales y 10 sesiones de llamada por combinación crítica. Percentiles: ≥ 100 turnos comparables por estrato | Primer audio útil p95 ≤ 4 s; detener audio local p95 ≤ 300 ms. No mezclar frío/caliente ni redes distintas |
| Escritorio | ≥ 100 eventos representativos por aparato y 20 transferencias de control (10 durante actividad del agente) | Input→efecto visible p95 ≤ 500 ms en red de referencia |
| Trabajo durable | Las corridas de R7 | ACK durable y control local cancelable p95 ≤ 1 s; recuperación p95 ≤ 60 s |
| Red de referencia | Medir RTT antes de cada bloque | RTT ≤ 100 ms estable; ensayar también pérdida, RTT alto y offline. La seguridad no se degrada con la red |

Las muestras pequeñas no acreditan un p95 estable ni satisfacción poblacional. Una sola combinación de aparatos sirve
para encontrar fallos, no para acreditar las demás.

## 8. Cierre

Anotar al final: quién probó, aparatos, hora de inicio y fin, versión (tabla 1 y 6.1), y la lista de casos que fallaron
con lo que se vio. Un caso no corrido se anota como `unverified` («no probado»), nunca como `pass` («bien»).
