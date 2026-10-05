# Registro de pruebas reales — 5-oct-2026 (ronda sobre 8b9e9ca)

Guion: [PRUEBAS-REALES.md](PRUEBAS-REALES.md). Aquí solo va lo que **se ejecutó de verdad**, con su versión y su
resultado. Lo que necesita un aparato, una cuenta o una autorización que no tuve queda **bloqueado**, con lo que hace
falta exactamente. Nada bloqueado se da por probado.

Cuatro palabras, cuatro cosas distintas:

- **corregido**: el arreglo está en el código, con una prueba que falla antes y pasa después;
- **publicado**: está en producción (servidor/web en Render, OTA en EAS, instalador en el Release, nodo en AWS);
- **recibido**: el aparato de la persona corre esa versión (`/api/build` → `clientes[].recibido`, con su sesión);
- **probado**: alguien lo hizo funcionar en el aparato o el sistema real y anotó el resultado.

## 1. Versiones en el momento de las pruebas

| Pieza | Valor | Cómo se leyó |
|---|---|---|
| Servidor y web (producción) | `8b9e9ca` | `GET /api/health` → `commit`; `GET /aura-build.json` → `sha 8b9e9ca5…` |
| Almacén | S3, `ok: true`, `listado: ok` | `/api/health` → `almacen` |
| Nodo de la computadora (AWS, i-003312caae1c8d629) | `hash bab229b8bc6fe7b6`, validador 12, capacidades `pausar, confirmar, control, entrada, seguro` | `/salud` del nodo (por SSM); igual a `sha256sum agente.py` de `8b9e9ca` |
| Modelo del nodo | `holo3-1-9b` (motor `holo`) | `/salud` → `modelos` |
| OTA publicada (ultron, producción) | runtime `95771e02…`, androidUpdateId `01a10c8e-3c90-7be7-b9ac-cf0adf87e2f2` | `ota-aura.json` del Release `aura-ota` |
| APK | 5.3.0 (Release v5.3.0) | Release |
| Windows | 2.0.184 (según el revisor) | Release `aura-windows` |

Las correcciones de esta ronda (PR y SHA al final del informe de entrega) se publican después de estas pruebas; las
del nodo se prueban otra vez tras desplegarlo (sección 4).

## 2. Ejecutadas

| # | Prueba (guion) | Sistema real | Versión | Resultado | Estado |
|---|---|---|---|---|---|
| E1 | «Crea tres documentos: informe.docx, presupuesto.xlsx y carta.pdf» | Nodo AWS, motor holo, dueño sintético | nodo `bab229b8` | **No lo logró**: 31 pasos en 372 s, terminó `sin_pasos`. Lo bueno: **no dijo «completado»**. Lo malo: tampoco dijo qué archivos faltaban (`archivos: null`). → Se corrigió en esta ronda: el nodo revisa el espacio de trabajo también al quedarse sin pasos y el final dice «Ya quedó: … Falta: …» (prueba en `test_agente.py` y `tests/computadora-sin-pasos.test.ts`). La capacidad del modelo para hacer los tres documentos sigue siendo baja | probado (falla de capacidad, honesto) |
| E3 | Detener una tarea a mitad | Nodo AWS | nodo `bab229b8` | **Pasa**: `parar` en 173 ms con fase `quiescent` y nada en vuelo; 30 s después sigue `parada` (no se relanzó) y el nodo queda libre. El paso que el modelo estaba pensando al parar quedó anotado como **no hecho** (`hecho: false`): no tocó el escritorio | probado |
| E4 | Un «sí» que no es de la propuesta mostrada | Nodo AWS | nodo `bab229b8` | **Pasa**: «sí» sin `propuesta` → 409; «sí» con otra `propuesta` → 409 | probado |
| I1 | Abrir `aura-fp.onrender.com` sin sesión | Producción, Chromium con perfil iPhone 14 (**emulado, no un iPhone**) | web `8b9e9ca` | **Pasa**: solo «Entrar con Veta Wallet» y «Soy de la junta: entrar con correo y clave»; sin mesa ni micrófono; manifiesto PWA y service worker presentes; 0 errores de página; carga 9,1 s (servidor frío) | probado en emulación |
| G1 (parcial) | Identidad de entrega sin sesión | Producción | `8b9e9ca` | `commit`, `almacen.ok`, `listado: ok`, `aura-build.json` coinciden | probado (sin sesión: falta `clientes`) |
| G2 | Nodo contra el SHA revisado | Nodo AWS | `bab229b8` | `hash` del nodo = sha256 (16 hex) de `agente.py` en `8b9e9ca` | probado |

## 3. Bloqueadas (qué hace falta exactamente)

| # | Prueba | Por qué no la hice | Qué necesito |
|---|---|---|---|
| G3, G6 | Recepción por aparato (`clientes`, `recibido`) | `/api/build` con `clientes` exige la sesión de la cuenta; no uso ni fabrico sesiones ajenas | Que José abra AU-RA en su Android y en la web/PWA con su cuenta (tras el despliegue de esta ronda) y me pase el JSON de `/api/build` (sin cabeceras), o que lo mire él: cada aparato debe decir `recibido: sí` |
| V1–V6, R2a | Voz normal en el teléfono (20 turnos, interrumpir, «cállate») | Requiere un teléfono, micrófono y una persona hablando | José con su Android: el guion de la sección 2 de PRUEBAS-REALES.md; anotar aparato, red y frío/caliente |
| L1–L4, R2b, R2c | Llamada en vivo, modo avión, colgar, salir con la llamada abierta | Igual: aparato físico y red real | José: sección 3 del guion (10 sesiones por combinación) |
| V5, V6, R5 (envío) | Correo y WhatsApp reales a cuenta propia | Envíos reales: necesitan autorización expresa de José para su propia cuenta | La autorización y que José confirme el recibo en su bandeja / su WhatsApp |
| R3a–R3e | Tomar el control del escritorio desde el teléfono (teclado, IME, rotar, modo avión) | Necesita la app con sesión en un aparato táctil | José desde la app (Android) y la PWA |
| R3f, G4 | Manos de Windows (Bloc de notas, Word, contraseña) | Necesita una PC con Windows e instalar el `.exe` | José en su PC: hash del instalador, versión instalada y el guion R3f |
| I2–I5, G5, R6 | iPhone real (Veta Wallet, micrófono, avisos, PWA instalada) | No hay iPhone en este entorno; la emulación no prueba Safari, permisos ni avisos | Un iPhone con la PWA instalada; versión de iOS |
| R1 | Primer resultado útil con cuenta nueva | Crear cuentas en producción requiere la aprobación de José | Una cuenta de prueba aprobada por José |
| R4 | Memoria e iniciativa entre aparatos | Necesita la cuenta y dos aparatos | José, tras R1 |
| R7 | Recuperación y reversión en producción (dos réplicas, matar procesos) | Render corre 1 réplica; matar procesos y revertir datos en producción necesita confirmación | Autorización para hacerlo en una ventana tranquila; mientras, cubierto por pruebas automáticas (`tests/trabajos-indice.test.ts`, 35 casos, con S3 sintético) |
| Speech Engine A/B | Comparar los dos caminos de voz | Necesita crear el recurso en ElevenLabs y minutos pagados; leer métricas de ElevenLabs desde aquí pide aprobación | Decidido sin adoptar (docs/voz/SPEECH-ENGINE.md); se reabre solo con el visto bueno de José |

## 4. Después del despliegue de esta ronda

Se anota aquí al desplegar: SHA en producción, hash del nodo y la repetición de E1 con la revisión de archivos.
