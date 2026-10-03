# AU-RA en iPhone: matriz de capacidades (ruta pública PWA)

Documento maestro, sección 16 (AUR14). En iPhone AU-RA se usa por la **web**: Safari o el icono instalado en
Inicio (PWA). No hay app nativa de iOS publicada; TestFlight, firma, CallKit y audio de fondo nativo quedan
fuera hasta que el dueño lo decida (sección 16, «Frontera nativa y TestFlight»).

**Regla de esta matriz:** el código y las pruebas con dobles **no** son verificación física. Mientras nadie
haya hecho la prueba mínima en un iPhone real y la haya registrado abajo (modelo, iOS, Safari o PWA, red,
build), el estado es **no verificado** y AU-RA no anuncia esa capacidad como soporte completo.

Estados: **verificado** (prueba física registrada y pasó) · **limitado** (pasó con límites conocidos, que se
dicen al usuario) · **no verificado** (sin prueba física registrada).

## Versión de esta matriz

| Campo | Valor |
|---|---|
| Build | el de este commit (`GET /api/build`, con la sesión de la mesa, da la huella; el service worker lleva la suya como `aura-shell-<versión>`) |
| iOS objetivo | 16.4 o posterior (Web Push solo existe desde 16.4 y solo en la web añadida a Inicio) |
| Equipos objetivo | uno de recursos limitados dentro del soporte y uno reciente; además Android y escritorio para no romper lo cruzado |
| Pruebas físicas registradas | **ninguna todavía** |

## La matriz

| Capacidad | Verificación física mínima | Estado | Qué se le dice al usuario si no pasa | Lo que sí está probado sin teléfono |
|---|---|---|---|---|
| Chat y tareas | Safari y PWA: entrar, cerrar y reabrir, recuperar la tarea de la cuenta correcta | no verificado | «Puedes usar AU-RA por el chat; la tarea se recupera al volver a entrar.» No se anuncia soporte completo. | Sesión por cabecera y cookie espejo de iOS (`tests/sesion-cliente-web.test.ts`); el SW nunca guarda `/api` ni respuestas con sesión (`tests/pwa-sw.test.ts`) |
| Micrófono y voz normal | Permitir y denegar el micrófono, con auriculares, interrumpir, volver del segundo plano | no verificado | Texto como alternativa y el límite a la vista: «Si el micrófono no responde, escríbeme.» | Controles separados (callar / colgar / tarea) y la misma lectura de «para» que el teléfono (`tests/controles-voz-web.test.ts`) |
| Modo llamada (conversación en vivo) | Conectar, colgar, silenciar, reconectar y bloquear la pantalla | no verificado | No se promete llamada continua: «Con la pantalla bloqueada la conversación puede cortarse; al volver te digo qué pasó.» | Colgar en cada fase deja cero timers y cero sesiones y suelta el pase una vez (`tests/controles-voz-web.test.ts`); plazos de conexión (`tests/voz-en-vivo-web.test.ts`) |
| Escritorio interactivo (su computadora) | Pantalla completa, teclado del móvil, IME, zoom, control exclusivo | no verificado | No se promociona como escritorio controlable desde iPhone; se ofrece ver el progreso y el resultado. | Contrato de entradas y control exclusivo en servidor (AUR09) |
| Push (avisos con la app cerrada) | Suscripción válida, permiso pedido con un toque, recepción y apertura medidas | no verificado | Se distingue pedir de entregar: «Activé los avisos en este iPhone; todavía no confirmo que lleguen.» Nunca «te aviso» como hecho. | Cifrado para cada navegador, el navegador que cambia de cuenta deja de recibir los avisos de la anterior, aceptado no es entregado (`tests/push-web.test.ts`); el permiso se pide solo tras el toque «Activar» (`src/10-infra/avisosWeb.ts`, sin prueba automática) |
| Archivos | Descargar y abrir, subir lo autorizado, acceso de la cuenta correcta | no verificado | Resultado textual verificado sin fingir que el archivo está listo. | — |
| Actualización | Cambio de SW con un cliente viejo abierto, con una llamada o decisión en curso, y tras salir de la cuenta | no verificado | Si falla: se frena el rollout del SW (interruptor `AURA_SW=0`, ver abajo). | La versión nueva espera el toque «Recargar» y, con una llamada, una decisión o el control en curso, espera a que termine (`tests/pwa-cuenta.test.ts`); al salir se purga lo de la cuenta (`tests/pwa-sw.test.ts`, `tests/pwa-cuenta.test.ts`) |
| Entrar con Genesis ID (callback) | Empezar en el icono, volver en Safari (y al revés), una sola cuenta, nada en la URL | no verificado | «Vuelve al icono de AU-RA para terminar de entrar.» | `/sso` deposita y redirige (303) a `/sso/listo`: el pase no queda en la barra ni en el historial; un solo canje y una sola sesión; la vuelta repetida va a una página neutra (`tests/sso-web.test.ts`) |

## Lo que hace hoy la PWA (código, no promesa)

- **Service worker** (`scripts/pwa/sw-plantilla.js`): guarda solo el shell del build, con clave por versión
  (`aura-shell-<huella>`). La navegación va primero a la red. Nunca toca `/api`, `/sso`, lo que lleva la
  sesión ni respuestas `no-store`/privadas.
- **Purga por logout**: al salir (`guardarTokenMesa('')`) la página borra el seudónimo de los avisos, la memoria
  local por cuenta, la conversación de la pestaña, una entrada con Genesis a medias y el correo recordado, y le
  pide al worker `purgar`: borra todo caché `aura-*` que no sea el shell de esta versión y, del shell, lo que no
  sea el shell (`src/10-infra/purgaPwa.ts`).
- **Actualización segura**: la versión nueva se instala y espera; solo el toque «Recargar» la aplica, y si en
  ese momento hay una conversación en vivo, una decisión abierta o el control de su computadora
  (`src/10-infra/trabajoActivo.ts`), espera a que termine. `controllerchange` solo recarga si lo pidió la
  persona. No hay otra recarga automática en la web.
- **Callbacks**: el retorno de la wallet (`/sso`) no deja el pase en la URL, el historial ni los registros, y
  abrirlo en otro contexto (Safari frente al icono) no duplica la cuenta.
- **Interruptor**: `AURA_SW=0` en el servidor (o `?sinsw` en la dirección) da de baja el worker y borra sus
  cachés en el siguiente arranque.

## Límites conocidos de la plataforma (se dicen, no se esconden)

- Web Push en iPhone solo para la web **añadida a Inicio** (iOS 16.4+) y con permiso pedido tras un toque.
  Que el servidor tenga VAPID no prueba que el aviso llegue.
- Safari y la PWA instalada son almacenes distintos (iOS solo copia las cookies, no `localStorage`): por eso la
  cookie espejo de la sesión y el depósito del callback en el servidor.
- Con la pantalla bloqueada o AU-RA en segundo plano, iOS puede suspender el audio y el micrófono de la web.
  AU-RA no simula escucha ni inventa continuidad: al volver muestra lo que pasó. Una tarea durable sigue en el
  servidor y su resultado se recupera sin lanzar otra.
- Llamadas del sistema (CallKit) y audio persistente fuera de pantalla no existen en WebKit: requieren un spike
  nativo y una decisión del dueño.

## Cómo registrar una prueba física

Añadir una fila por prueba y cambiar el estado de la capacidad solo si pasó:

| Fecha | Capacidad | Modelo | iOS | Safari / PWA | Red | Build | Resultado | Quién |
|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — |
