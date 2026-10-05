# Matriz de superficies — la computadora, el teclado remoto y la voz por superficie

Auditoría 8+ (4-oct), paquete P3: «Matriz separa Linux remoto, Expo, web/PWA y manos Windows locales». Son **cuatro
cosas distintas**, con código, pruebas y riesgos propios. Probar una no acredita las otras: lo verificado en el
escritorio Linux remoto no dice nada del control nativo de Windows, y los tests TypeScript del servidor no acreditan
el `.exe`.

Leyenda de la columna «Sin verificar en aparato»: lo que ninguna prueba automática cubre y queda `unverified` hasta
correr el guion físico de [PRUEBAS-REALES.md](PRUEBAS-REALES.md) (sección 6) con la versión identificada.

## Resumen

| Superficie | Qué es | Quién mueve el ratón/teclado | Pruebas automáticas (en CI) | Estado en aparato físico |
|---|---|---|---|---|
| **Linux remoto** (nodo `agente.py`) | Escritorio Linux (Firefox, LibreOffice) en un contenedor del nodo; AURA trabaja ahí y la persona puede tomar el control | `xdotool` dentro del contenedor, por el árbitro de `agente.py` | `tests/computadora*.test.ts`, `tests/permisos-*.test.ts` (nodo de mentira que habla como `agente.py`); `scripts/nodo-computadora/test_agente.py` **no** está en CI (se corre a mano) | Sin corrida física registrada con el lote nuevo |
| **App Expo** (Android) | El visor dedicado `mobile/src/app/VisorComputadora.tsx` sobre el Linux remoto | La persona, desde el teléfono, vía `/api/computadora/tareas/:id/entrada` | `tests/visor-computadora.test.ts`, `tests/teclado-remoto-lote.test.ts` (lógica pura) y **`mobile/pruebas/visor/` (el componente MONTADO)** en `calidad-movil.yml` | Sin verificar en un Android físico |
| **App Expo** (iOS) | No existe build de iOS: `app.config.js`/`eas.json` no declaran iOS y no hay workflow | — | — | No aplica: en iPhone se usa la web/PWA |
| **Web / PWA** | El mismo visor adaptado al navegador: `src/13-trabajo/VisorEscritorio.tsx` (reutiliza `mobile/src/app/visor.ts` y `mobile/src/lib/entradaRemota.ts`) | La persona, desde el navegador, por la misma ruta de entradas | `tests/aura-web-paneles.test.ts` en Chromium real (`web.yml`, `AURA_EXIGIR_NAVEGADOR=1`) | Chromium de CI sí; **Safari/iPhone y PWA instalada sin verificar** |
| **Manos Windows locales** (`windows/`) | El programa de Windows escribe y opera en la PC de la persona; voz por su propio canal | `SendInput` (Unicode) + UI Automation, en la PC local | `aura-windows.yml` en un runner de Windows: pruebas del núcleo (`windows/tests/Program.cs`), `--native-self-test`, `--desktop-self-test` (Bloc de notas real), `--assistant-self-test` (servidor simulado) e instalador Inno Setup | **Requiere instalador y prueba propia en una PC física**; nada de lo de arriba lo sustituye |

## 1. Linux remoto — el nodo de la computadora (`scripts/nodo-computadora/agente.py`)

**Implementado**

- Tareas con estados `en_cola`, `trabajando`, `pausada`, `confirmar`, `control`, finales `hecha`/`parada`/`sin_pasos`/`fallo`.
  Pagar o comprar: nunca.
- Contrato de entradas (`capacidades` en `/salud`: `pausar`, `confirmar`, `control`, `entrada`, `seguro`): cada entrada
  lleva sesión, cliente, época de control, secuencia y viewport; ACK con `frame_seq`; cubeta de entradas por segundo.
- Control con época ligada al cliente que lo tomó; entrada segura (sin capturas ni registro mientras dura; `/pantalla`
  responde 423).
- `/salud` dice `hash` (huella sha256 de `agente.py`, 16 hex) y `validador`; el servidor lo expone en `/api/build`.
- **noVNC sigue desactivado** (AUR09): `POST /vista` y `GET /vista/permitir` devuelven 410/403 y, con `CERRAR_VNC=1`
  (por omisión), el VNC de la imagen del escritorio se cierra al crearlo y su puerto no se publica. Ningún cliente
  abre noVNC: la única forma de tocar el escritorio es el contrato de entradas, pasando por el árbitro (épocas,
  candado del escritorio, entrada segura). Probado en `test_agente.py::test_novnc_cerrado_y_sin_puerto`.

**Pruebas automáticas**

- `tests/computadora.test.ts`, `tests/computadora-replicas.test.ts`, `tests/permisos-ronda8/9/10.test.ts`,
  `tests/permisos-exactos.test.ts`, `tests/efecto-una-vez.test.ts`: el servidor contra un nodo de mentira con el
  contrato de `agente.py` (control por cliente, «sí» atado a la propuesta exacta, efectos una vez).
- `scripts/nodo-computadora/test_agente.py` (104 casos, sin escritorio ni GPU): `python3 -m unittest
  scripts/nodo-computadora/test_agente.py`. **No corre en ningún workflow**: hay que correrlo a mano en cada entrega.

**Sin verificar en aparato**

- El escritorio real del nodo con `xdotool`: IME, acentos, emoji (`café ☕` llega como texto Unicode por `xdotool type`),
  atajos, selección y scroll en Firefox/LibreOffice.
- Que el nodo desplegado sea el del SHA revisado (comparar `hash` de `/salud` con el sha256 de `agente.py` del commit).
- Latencia input→imagen con red real (objetivo inicial p95 ≤ 500 ms, todavía no un resultado).

## 2. App Expo — Android (`mobile/`)

**Implementado**

- Visor a pantalla propia (Modal; no el fullscreen de toda la app), abierto solo por la persona desde la tarea;
  cerrar vuelve al chat **sin parar la tarea ni devolver el control** (`cerrar()` pausa el lote y manda `release_all`,
  nunca `/parar`).
- Una capa de coordenadas (zoom, pan, rotación), gestos (toque/doble/largo/arrastre/scroll), teclas especiales y
  Ctrl/Shift/Alt con lista blanca.
- **Lote de teclado (A3, P3)** en `mobile/src/lib/entradaRemota.ts` (`LoteTeclado`, `confirmarEscritura`): cada evento
  espera su ACK; el Enter y lo que sigue a un Enter esperan la imagen de después (la guarda de frame fresco no se
  quita); rechazo, corte de red, app en segundo plano, cambio de control o cierre de la vista **pausan**; lo incierto
  (ACK perdido) espera a que la persona diga «Sí llegó» / «No llegó»; el campo no se vacía hasta conocer el resultado
  y ofrece «Seguir», «Editar» y «Descartar».
- Con un servicio viejo (sin `entrada`), la acción de antes; lo no aplicado vuelve al campo.

**Pruebas automáticas** (todas en `calidad-movil.yml`, que también gatea APK y OTA)

- `tests/visor-computadora.test.ts`: coordenadas, gestos, frescura, épocas (lógica pura).
- `tests/teclado-remoto-lote.test.ts`: el lote contra una sesión con ACK y frames demorados (lógica pura).
- **`mobile/pruebas/visor/lote.cjs`** (`sh pruebas/visor/todas.sh`): **el componente montado**. `VisorComputadora.tsx`
  corre de verdad (React con `react-reconciler`, primitivos de React Native como etiquetas) contra un
  `/api/computadora` falso cuya imagen de después tarda 50/500/1500 ms. Escribe `café ☕`+Enter y pega `uno\ndos` por
  `onChangeText`/`onSubmitEditing`/`onPress` reales; comprueba una sola vez y en orden, campo intacto hasta la
  confirmación, rechazo→pausa con «Seguir/Editar/Descartar», corte de red, segundo plano, cambio de control y ACK
  perdido sin envío automático al volver, y cierre de la vista sin `/parar`. Contra el código de antes de P3
  (`1bc4ab6`) falla 11 de 12 (el Enter se perdía).
- Arneses de identidad, costuras, chat, llamadas, etc. (`mobile/pruebas/*`), ajenos al visor.

**Sin verificar en aparato**

- Teclado real de Android (Gboard u otro): composición IME, autocorrección, dictado, emoji del teclado, teclado físico
  Bluetooth; `onSubmitEditing` del botón «enviar» del IME.
- Rotar y redimensionar con el teclado abierto (Android a veces no achica el Modal; el visor suma la altura del teclado).
- Red móvil real: corte, cambio Wi-Fi/datos, bloqueo de pantalla a mitad del lote.
- El arnés montado simula React Native: no prueba el render nativo, el `PanResponder` ni el `TextInput` nativo.

## 3. App Expo — iOS

No hay app de iOS: no hay configuración `ios` en `mobile/app.config.js`/`eas.json` ni workflow que la compile. En
iPhone, AURA es la web/PWA (sección 4). No se anuncia control remoto desde una app de iPhone.

## 4. Web / PWA (`src/`)

**Implementado**

- `src/13-trabajo/VisorEscritorio.tsx`: el mismo visor como diálogo a toda la ventana (no un iframe, no una captura, no
  el fullscreen de la app), abierto desde la tarea («Abrir el escritorio»), con tomar/devolver control, pausar,
  cancelar (pregunta), entrada segura, ratón (clic, doble, derecho, arrastre, rueda), teclas especiales de la lista
  blanca y el campo con el mismo lote de teclado (reutiliza `visor.ts` y `entradaRemota.ts`). Al salir de la cuenta,
  `olvidarVisor()` tira sesiones y lo pendiente.
- Solo con la capacidad `entrada`: un servicio viejo se ve, pero no se toca desde la web.

**Pruebas automáticas**

- `tests/aura-web-paneles.test.ts` en Chromium real (`web.yml`, obligatorio con `AURA_EXIGIR_NAVEGADOR=1`): «abrir el
  escritorio desde la tarea, tomar el control, escribir «café ☕» + Enter (llega una vez y en orden), ratón, rueda,
  devolver el control y volver al chat sin cancelar», y «teclas físicas de la lista blanca, la rueda en pasos».
- `tests/pwa-sw.test.ts`, `tests/pwa-cuenta.test.ts`: service worker y cuenta de la PWA.

**Sin verificar en aparato**

- **Safari de iPhone y la PWA instalada en pantalla de inicio**: teclado de iOS (composición, autocorrección, dictado),
  `beforeinput`/IME de WebKit, scroll táctil, rotación, volver de segundo plano. Ninguna prueba corre WebKit.
- Firefox de escritorio y Safari de macOS.
- Android Chrome físico (teclado virtual sobre el diálogo).

## 5. Manos Windows locales (`windows/`)

Otra superficie: la PC **de la persona**, no el escritorio Linux remoto. No se ofrece control nativo de Windows por
haber probado el Linux remoto, ni al revés.

**Implementado**

- **Escritura** (`windows/src/Aura.Windows/Manos/Escritura.cs`): escribe donde está el cursor en cualquier app con
  `SendInput` Unicode, como una persona. Fija el control con el foco por **UI Automation** (`AutomationElement.FocusedElement`:
  proceso, RuntimeId, AutomationId, `IsPassword`); si no puede fijarlo, pide el «sí». Nunca escribe en un campo de
  contraseña ni en AURA misma; si cambia la ventana o el control a mitad (o el campo se vuelve de contraseña), se
  detiene y dice cuánto alcanzó. **Escribir no es enviar**: nunca aprieta Enter ni Tab (un salto es Mayús+Enter,
  `PlanEscritura`).
- Otras manos: `Teclado.cs` (atajos por `SendInput`), `Controles.cs`/`Pantalla.cs` (UI Automation), ventanas, apps,
  archivos, sistema.
- **Voz** (`windows/src/Aura.Windows/Voz/AgenteVoz.cs`): conversación con el agente de ElevenLabs por
  `ClientWebSocket`; micrófono con **NAudio** `WaveInEvent` (bloques de 50 ms, cola acotada de ~1 s que tira lo más
  viejo) y salida `WaveOutEvent` con búfer corto (3 s) y `ColaBoca` con generación: al interrumpir o mandar callar se
  tira lo pendiente y nunca suena audio viejo. Sin cancelación de eco, lo que entra más bajo que su voz se manda como
  silencio. Cerebro: `/api/voz/llm`.
- Instalador por usuario (Inno Setup, `windows/installer/Aura.Windows.iss`), compilado en CI; firma solo si hay
  certificado (si no, SmartScreen avisa).

**Pruebas automáticas** (`aura-windows.yml`, runner de Windows; **no** las de `npm test`)

- `windows/tests/Program.cs`: núcleo (p. ej. `PlanEscritura`: sin Tab ni controles, un salto = un Mayús+Enter, Enter
  suelto no es seguro; detector de voz).
- `--native-self-test`: UI Automation, OCR, controles, ventanas, información del sistema y la voz de Windows.
- `--desktop-self-test`: escribe en un **Bloc de notas real** en el runner aislado.
- `--assistant-self-test` y `--gateway-self-test`: contra servidores simulados (`windows/gateway/fixture-*.mjs`), no
  producción.
- `tests/windows-rutas.test.ts` y `tests/voz-agente.test.ts` prueban **rutas del servidor** que usa el `.exe`; no
  acreditan `SendInput`, UI Automation, NAudio ni el WebSocket de voz.

**Sin verificar en aparato**

- Instalar el instalador del SHA revisado en una PC física (identificar su SHA; no instalar un artefacto viejo con el
  mismo nombre) y correr su propia prueba: Word, navegador, WhatsApp de escritorio, ventanas elevadas (UAC), IME de
  Windows y distribuciones de teclado no inglesas.
- Micrófono y altavoz reales, Bluetooth/auriculares, eco del cuarto, red real con ElevenLabs.
- Comportamiento con SmartScreen y sin firma.

## Lo que no cambia en ninguna superficie

Épocas de control, quietud antes de entregar el control, entrada segura y privacidad (sin capturas ni registro),
noVNC cerrado y nada que salte el árbitro. La puntuación se da por superficie con su propia evidencia; un caso no
corrido es `unverified`, nunca `pass`.
