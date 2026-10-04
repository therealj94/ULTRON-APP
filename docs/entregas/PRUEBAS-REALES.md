# Pruebas reales en aparatos — voz, llamada, escritorio e iPhone

Lo que las pruebas automáticas no cubren: micrófono, altavoz, red móvil, la computadora de verdad y Safari en un
iPhone. Cada corrida deja anotada **exactamente qué versión se probó**; sin esa identificación el resultado no cuenta.

Reglas: solo cuentas y contactos propios (enviarse a uno mismo o a un segundo número propio); nada de dinero real;
si algo falla, se anota tal cual (hora de Honduras, qué se dijo, qué pasó) y no se repite «hasta que salga».

## 1. Identificar la versión (antes de empezar)

| Pieza | Dónde se lee | Valor probado |
|---|---|---|
| Servidor y web | `https://aura-fp.onrender.com/api/health` → `commit` | |
| App Android (APK) | Ajustes de Android → Aplicaciones → AU-RA: versión (hoy 5.3.0, versionCode 53) | |
| Actualización OTA | Ajustes de AU-RA, al final junto a «Cerrar sesión»: `OTA xxxxxxxx · fecha · runtime xxxxxxxx` | |
| Computadora (nodo) | `md5sum /opt/computadora/agente.py` en el nodo (por SSM) | |
| iPhone | Ajustes → General → Información: versión de iOS; Safari o la app en pantalla de inicio | |
| Aparato Android | modelo y versión de Android | |

El commit del servidor, el de la web y el de la OTA deben coincidir con el SHA revisado. Si no coinciden, se para y
se anota cuál corre.

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

## 6. Cierre

Anotar al final: quién probó, aparatos, hora de inicio y fin, versión (tabla 1), y la lista de casos que fallaron con
lo que se vio. Un caso no corrido se anota como «no probado», nunca como «bien».
