# Avisos con la app cerrada (Firebase Cloud Messaging)

AURA alcanza a la persona aunque AU-RA esté cerrada: la **llama** (pantalla completa, la misma llamada
entrante de un «llámame a las 5 para recordarme…»), le manda **mensajes** y **propuestas** con «Sí» /
«Luego», **recordatorios** y lo que **terminó su computadora**. El canal de acciones
(`/api/app/acciones`) solo llega con la app abierta; esto llega siempre.

Solo **AU-RA** (`link.ordenglobal.ultronfp`). Dr Electrum no lleva Firebase.

## Piezas

| Dónde | Qué |
|---|---|
| `lib/push.ts` | FCM HTTP v1 sin dependencias: JWT RS256 de la cuenta de servicio (node:crypto) → token de acceso (caché hasta 5 min antes de vencer) → `messages:send`. Teléfonos por persona (correo de la sesión; cajón seguro de `lib/misiones.ts`: caché, disco `data/push/` o `ULTRON_PUSH_DIR`, S3 `ultron/push/<huella>.json`), hasta 5. Borra solo los tokens muertos. |
| `server/push.ts` | Rutas y re-exporta los atajos. Montado en `server.ts` (`montarRutasPush`). |
| `lib/boveda.ts` | `firebase_cuenta` → `FIREBASE_SERVICE_ACCOUNT`. |
| `mobile/src/push/logica.ts` | Puro: qué significa cada aviso y cómo se dibuja (notifee). |
| `mobile/src/push/nativo.ts` | Token, registro al entrar / al renovarse, baja al salir, toques. |
| `mobile/src/push/fondo.ts` | `setBackgroundMessageHandler` + `onMessage`, al cargar el módulo. |
| `mobile/index.js` | Entrada nueva (`main`): primero `src/push/fondo`, después la app. |
| `mobile/app.config.js` | Plugins `@react-native-firebase/app` y `/messaging` y `android.googleServicesFile` **solo en la rama AU-RA**. |

## Rutas (todas con la sesión de la mesa; la persona sale de la sesión, nunca del cuerpo)

```
POST /api/push/registrar {token, aparato?, plataforma:'android', app:'aura'} → { ok, dispositivos, configurado }
POST /api/push/quitar    {token? | aparato?}                                → { ok, quitados }
POST /api/push/probar    (solo junta: un `mensaje` de prueba a SUS teléfonos) → { ok, enviados, fallidos }
GET  /api/push/estado                                                       → { configurado, dispositivos }
```

Los tokens nunca vuelven en una respuesta ni se escriben en un log; la credencial tampoco.

## Lo que viaja

Solo datos (`data`, todo texto; FCM no lleva bloque `notification`), `android.priority: HIGH`, `ttl` 60 s
para la llamada y 6 h para lo demás. Siempre: `aura:'push'`, `tipo`, `id`, `para` (seudónimo de la
cuenta, el mismo de `mobile/src/lib/cuenta.ts`), `enviado` (ms).

| tipo | campos | en el teléfono |
|---|---|---|
| `llamada` | `de:'AURA'`, `motivo` | Llamada entrante (categoría llamada, pantalla completa, timbre, Contestar / Rechazar). Contestar abre la conversación con AURA y le pasa el motivo por el camino de los recordatorios (`[[recordatorio]] <motivo>`). Sin contestar: «AURA te llamó». Si llega con más de 90 s de retraso, no suena: queda «AURA te llamó». |
| `mensaje` | `titulo`, `texto`, `abrir?` (`mesa`/`chats`/`ajustes`/`computadora`/`correos`) | Aviso alto; al tocarlo se abre la mesa (o `abrir`) y AURA lo lee. |
| `propuesta` | `id` (el de la iniciativa), `texto`, `pedido` | «Sí»: abre la app, `POST /api/iniciativa/responder {id, respuesta:'si'}` y hace el `pedido` como turno (AURA dice la respuesta). «Luego»: `responder 'luego'` sin abrir la app. |
| `recordatorio` | `texto` | Aviso; al tocarlo, AURA lo dice. |
| `computadora` | `id` (tarea), `texto` | «Terminé en mi computadora: …»; al tocarlo, la vista en vivo de esa tarea. |

En un teléfono compartido, un aviso cuyo `para` no es de quien está registrado no se enseña. Cada aviso
se enseña una sola vez (por tipo e id).

## Desde el servidor

```ts
import { llamarPorPush, avisarPush, proponerPorPush, recordarPorPush, avisarComputadoraPorPush, enviarPush, pushConfigurado } from './server/push';

await llamarPorPush(correo, { motivo: 'Llegó el correo del banco que esperabas' });
await avisarPush(correo, { titulo: 'AURA', texto: '…', abrir: 'mesa' });
await proponerPorPush(correo, { id: propuesta.id, texto: propuesta.texto, pedido: propuesta.pedido });
await recordarPorPush(correo, 'Tomar la pastilla');
await avisarComputadoraPorPush(correo, tareaId, 'El tipo de cambio de hoy es 24.70');
// Todas → { enviados, fallidos, quitados, configurado, detalle? }. Nunca lanzan.
```

## Puesta en marcha

1. **Render (aura-fp):** `FIREBASE_SERVICE_ACCOUNT` = el JSON entero de la cuenta de servicio (Firebase
   console → Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada). Vale en una
   línea o en base64. Ya está puesta.
2. **Firebase console:** la API «Firebase Cloud Messaging API (V1)» habilitada en el proyecto `aura-fp`
   (viene habilitada en proyectos nuevos). Nada más: no hace falta la clave de servidor heredada.
3. **APK nueva:** el nativo cambió (Firebase); una OTA no lo trae. La APK de AU-RA 5.2.0 sale del flujo
   `android-apk.yml` como siempre (el `google-services.json` está en el repo; el prebuild lo copia).
4. **Permiso de avisos** (Android 13+): la app lo pide al entrar si falta. Para que la llamada abra la
   pantalla completa con el teléfono bloqueado, Android 14+ exige «Notificaciones a pantalla completa»
   permitido para AU-RA (Ajustes del teléfono → Apps → AU-RA FP).

## Probar

Con la APK nueva instalada y la sesión abierta una vez (registra el teléfono):

```
curl -X GET  https://aura-fp.onrender.com/api/push/estado  -H 'x-ultron-sesion: <token>'
curl -X POST https://aura-fp.onrender.com/api/push/probar  -H 'x-ultron-sesion: <token>'
```

Luego cerrar la app (deslizarla fuera de recientes) y volver a probar: el aviso llega igual.
Pruebas automáticas: `node --test --import tsx tests/push.test.ts`.

## Pendiente

- **Quién llama a los atajos:** `iniciativa.alProponer` (propuestas), el círculo / cerebro continuo
  (llamadas y mensajes), `alAvisarApp` de la computadora cuando el canal de acciones no entregó
  (`.entregada === false`) y los recordatorios del servidor. Se cablean en `server.ts`.
- **Mensajes de PULSE2CHAT con la app cerrada:** el relevo vive en otro repositorio. Para avisar, el relevo
  tendría que llamar a un endpoint del servidor de AU-RA protegido con un secreto compartido (p. ej.
  `POST /api/push/relevo {para: correo, de, vista}` con `x-relevo-secreto`) que haga
  `avisarPush(correo, { titulo: de, texto: 'Mensaje nuevo', abrir: 'chats' })`, **sin el contenido**
  (los mensajes van cifrados de punta a punta). Ese endpoint no existe todavía.
- La llamada usa el mensaje de los recordatorios (`[[recordatorio]] <motivo>`): AURA la abre como «te
  llamo para recordarte…». Una marca propia (`[[llamada_aura]]`) pediría tocar `lib/manos-app.ts` y
  `compa/llamadaCiclo.ts`.
