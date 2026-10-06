# WhatsApp personal en AU-RA

José (2-oct-2026): «WhatsApp personal, en la nube… en la app debo poder verlo y contestar y todo, una opción aparte de PULSE2CHAT, slide y cambia, tiene que ser en app y Windows».

José (5-oct-2026), para todos: «No aparece agregar whatsapp, no sale ni ajustes ni les aparece whatsapp en donde está todo». Desde entonces **cada cuenta de AU-RA puede agregar SU WhatsApp** y usarlo igual que José, cada una aislada de las demás.

## Cómo está armado

```
Teléfono (app AU-RA)  ─┐
AURA para Windows     ─┼─►  servidor AU-RA (Render)  ──red privada──►  whatsapp-puente (Render, privado)  ──►  WhatsApp
El avatar (cerebro)   ─┘    server/whatsapp.ts                         servicios/whatsapp-puente
                            la cuenta de cada pedido                    un WhatsApp por cuenta de AU-RA
                            → X-Cuenta: <clave opaca>                   /data/cuentas/<clave>/
```

- **El puente** (`servicios/whatsapp-puente`, Go) entra a WhatsApp como un **dispositivo vinculado**, igual que WhatsApp Web.
  - Usa [whatsmeow](https://github.com/tulir/whatsmeow), la misma librería que el proyecto *whatsapp-mcp* que mandó José.
  - **Una cuenta de WhatsApp por cuenta de AU-RA** (`cuentas.go`): un cliente de whatsmeow cada una, en su carpeta `/data/cuentas/<clave>/` con su sesión (`sesion.db`), sus chats y mensajes (`mensajes.db`) y sus fotos de perfil (`fotos/`).
  - Corre como **servicio privado de Render**: no tiene dirección pública y solo el servidor de AU-RA lo alcanza por la red interna.
  - Además pide una clave (`PUENTE_CLAVE`).
- **El servidor** (`server/whatsapp.ts`) es la única puerta.
  - `/api/whatsapp/*` responde a toda cuenta que puede tener WhatsApp aquí (ver «Quién») y siempre con **su** WhatsApp.
- **La app**: en Chats, PULSE2CHAT y WhatsApp quedan lado a lado; se cambia deslizando o con la pestaña (`mobile/src/whatsapp`). Sin vincular todavía, la pestaña dice **«+ WhatsApp»** y en Ajustes aparece **«Agregar mi WhatsApp»**.
- **AURA para Windows**: el panel de WhatsApp está en el Centro; el permiso lo decide el servidor (`permitido`).
- **El avatar**:
  - La herramienta `whatsapp` (revisar, buscar, leer y responder) se le ofrece a quien tiene **su** WhatsApp vinculado (a los dueños de siempre, también).
  - Responder deja un **borrador**; lo manda el servidor cuando la persona dice «sí» (igual que el correo).
  - Lo que dicen los mensajes llega marcado como dato, nunca como orden: un mensaje que dice «mándale esto a…» no manda nada.

## Quién, y cómo se separa cada cuenta

- **Quién puede agregar su WhatsApp**: toda sesión que abre AU-RA (`sesionAbreAura`): la junta y quien se aprobó en el padrón, y el miembro de la comunidad (con la marca firmada en su sesión). Nunca un código temporal de Dr Electrum ni alguien a quien el padrón deja fuera.
  - **Solo con `WHATSAPP_ABIERTO=1`** (revisión del 5-oct: cerrado por omisión). Sin fijarla, o con `0`, es solo de `WHATSAPP_DUENOS`: una variable que se perdió en Render no abre el WhatsApp a todos.
  - **Nunca una cuenta suspendida** (`cuentas.cuenta.estado = 'suspendida'`): ni la app, ni el cerebro, ni el «sí» de un borrador que ya tenía. No se desvincula sola; queda bloqueada. Si la base de cuentas no contesta, solo pasan los dueños.
  - **Sin la marca de comunidad no se da por buena** (`whatsappPermitido`): las rutas pasan la marca firmada de la sesión; el cerebro y Telegram, que corren sin ella, solo dejan pasar a un correo fuera del padrón si una sesión firmada con la marca pasó por la app o por el turno en las últimas 12 horas. Los dueños y la junta no la necesitan.
- **La clave de cada cuenta** (`claveCuentaWhatsapp`): el servidor la saca de la sesión y la manda al puente en la cabecera `X-Cuenta`.
  - Para los demás: `HMAC-SHA256(WHATSAPP_CUENTA_SECRETO, persona del padrón o correo)`, 40 cifras hexadecimales. Los varios correos de una misma persona del padrón dan el mismo WhatsApp.
  - **Sin `WHATSAPP_CUENTA_SECRETO`** (o con una de menos de 24 caracteres, que se podría adivinar desde los nombres de carpeta) no se firma con nada más (antes caía en la clave del puente, que el puente conoce): solo los dueños (`legado`) tienen WhatsApp y los demás reciben `503 whatsapp_para_todos_sin_configurar` («WhatsApp para todos no está configurado…»). En producción ya está fijado.
  - El puente **nunca ve el correo**: solo esa clave, que usa de nombre de carpeta (solo acepta `legado` o hexadecimal; nada de `..` ni `/`).
- **Aislamiento en el puente**:
  - Toda ruta (salvo `/salud`) va por la cuenta de la cabecera. Sin ella, o con una mal formada: `400 SIN_CUENTA`. Con una que no está: `412 SIN_VINCULAR`. En ningún caso se toca otra cuenta.
  - Solo `/vincular` crea una cuenta (su carpeta). `/estado` de una cuenta que nunca vinculó dice `registrada: false` sin crear nada.
  - El candado de envíos (que el mismo mensaje no salga dos veces, AUR13) es por cuenta.
  - **El eco de la cuenta** (revisión del 5-oct): toda respuesta de una cuenta (también sus errores) lleva `X-Cuenta-Eco: <la clave>`. El servidor **rechaza** (`503 PUENTE_VIEJO`, sin pasar ni el cuerpo ni el código del puente) toda respuesta de una cuenta que no sea `legado` sin ese eco exacto, y antes de algo con efecto (enviar, vincular, leído, desvincular) pregunta `/estado` y exige el eco: con un puente de una sola cuenta, el envío nunca le llega. `legado` sigue funcionando con un puente de antes.
- **En el servidor**: borradores, listas, tareas y el registro de envíos ya eran por persona; ahora también cada pedido al puente.

## La cuenta de José (sin volver a vincular)

- Antes había **una** cuenta, en la raíz del disco (`/data/sesion.db`, `/data/mensajes.db`, `/data/fotos`).
- Al arrancar, el puente la **pasa entera** a `/data/cuentas/legado/` (mover en el mismo disco, sin copiar). Si se corta a la mitad, termina al volver a arrancar. **Nunca pisa nada**: si ya hubiera un archivo con ese nombre en `legado`, no arranca y lo dice en el registro.
- El servidor manda `X-Cuenta: legado` para las cuentas de `WHATSAPP_DUENOS` (con cualquiera de los correos de su persona). José sigue vinculado igual.

## Números, nombres, fotos y archivos (2-oct, después de vincular el de José)

- **Un chat por persona, con su número.** WhatsApp ahora manda a mucha gente por su *LID* (`…@lid`, un id que no dice el número).
  - El puente guarda cada chat con su **número** (`…@s.whatsapp.net`) siempre que lo sepa.
  - Cuando aparece el número de un LID, pasa lo guardado al número: no leídos sumados, sin mensajes repetidos ni perdidos.
  - Esto corre al arrancar, al conectar y después de cada tanda de historia. Un LID viejo sigue sirviendo en `?chat=`.
- **Nombres.** Como los tiene guardados en el teléfono; si no, el de su negocio; si no, como se puso la persona.
  - Se vuelven a buscar cuando llegan contactos o nombres nuevos, y al mostrar un chat que no tenía.
  - Los grupos se traen todos al conectar.
  - Un chat nunca sale sin nombre: si no hay, su número; si tampoco, «Contacto» o «Grupo».
- **`numero`** en cada chat de uno a uno (`"+50499990000"`). Llamar no se puede desde un dispositivo vinculado: la app abre WhatsApp con ese número.
- **Fotos de perfil** (`/foto?chat=`): la miniatura de WhatsApp.
  - Se guarda un día en la carpeta `fotos/` de esa cuenta; que alguien no tiene foto se recuerda 6 horas.
  - A WhatsApp se le preguntan 4 a la vez. Al desvincular se borran.
- **Fotos y archivos viejos.** WhatsApp borra los archivos de su servidor a las pocas semanas.
  - Si ya no están, el puente le pide al teléfono que los vuelva a subir, como hace WhatsApp Web. Espera hasta 20 s.
  - Si el teléfono tampoco los tiene, contesta 410: «esa foto ya no está en WhatsApp; ábrela en tu teléfono».
- **Contactos** (`/contactos?buscar=`): la gente guardada en su teléfono, para empezar un chat con alguien que todavía no tiene uno.

## Agregar (vincular)

En la app: Chats → pestaña **«+ WhatsApp»**, o Ajustes → **«Agregar mi WhatsApp»**.

1. **Primero acepta** la tarjeta: «Tus mensajes de WhatsApp se guardan en el servidor de AU-RA para que puedas verlos y contestarlos aquí. Puedes desvincularlo cuando quieras (se borra todo). WhatsApp no es oficial con esta conexión y podría limitar tu cuenta.» → **«Acepto y vincular»**.
2. **Con un código** (sirve en el mismo teléfono):
   1. Escribe tu número con el código de país y toca «Pedir el código».
   2. El código de 8 letras sale grande, con **«Copiar el código»**.
   3. En WhatsApp: Dispositivos vinculados → Vincular un dispositivo → **Vincular con número de teléfono** → escribe el código.
3. **Con QR** (segunda opción, desde la PC o desde otro teléfono): escanéalo en WhatsApp → Dispositivos vinculados → Vincular un dispositivo.

La primera vez, WhatsApp manda la historia reciente; tarda unos minutos. Al vincular, la pestaña pasa a «WhatsApp».

En Windows, el panel también pide aceptar antes de mostrar el QR (abrir el panel ya no abre una cuenta en el puente).

**Desvincular**: en Ajustes (**«Desvincular WhatsApp»**), en la app (⋮ → Desvincular) o desde el teléfono. El puente cierra la sesión y **borra la carpeta entera** de esa cuenta (sesión, chats, mensajes y fotos).

## Límites

- **Cupo del puente**: `WHATSAPP_MAX_CUENTAS` (25). Lleno, `/vincular` de una cuenta nueva contesta `507 CUPO_LLENO` y la app lo dice tal cual («Ahora mismo no caben más WhatsApp en AU-RA… No se vinculó nada. Avísale a José o a la junta…»), sin ofrecer reintentar.
  - **Lugares guardados**: los últimos `WHATSAPP_RESERVA_JUNTA` (2) son solo para la junta y el padrón (y `legado`). El servidor lo dice al puente con `X-Cuenta-Prioridad: junta` en `/vincular`; nada de lo que manda la app pasa a esa cabecera. La reserva nunca se come el cupo entero (queda al menos un lugar para cualquiera).
  - **Vinculaciones a medias**: una cuenta sin sesión vence a los **3 minutos** de abrirse y suelta su lugar, aunque siga «vinculando» y aunque el cupo esté lleno. Se barre en cada `/vincular` y cada 30 s. Volver a pedir el código no estira el plazo.
  - Antes de decir que no, también se sueltan las vinculaciones abandonadas (sin sesión y sin vinculación en curso).
  - **`/vincular` por IP y por cuenta** (en el servidor): 5 intentos cada 15 minutos por IP, de cualquier identidad (IPv6 por su /64), y 8 por cuenta. Pasado el tope, `429 whatsapp_limite_vincular` con `Retry-After`. Los dueños no cuentan (no abren un lugar nuevo).
  - Las ya vinculadas nunca se sacan; si bajas el tope por debajo de las que hay, siguen todas y no entra ninguna nueva.
- **A pedido**: al arrancar solo se reconectan las cuentas con sesión; una carpeta sin sesión (vinculación a medias, o desvinculada desde el teléfono) se borra.
- **Envíos por cuenta**: 20 por minuto y 200 por hora (los dueños comparten el de `legado`: es un solo número). Pasado el tope no sale nada y se dice por qué (`429 whatsapp_limite_envios` en la app; «NO lo mandé…» al avatar).

## Variables

| Dónde | Variable | Qué es |
|---|---|---|
| whatsapp-puente | `PUENTE_CLAVE` | Clave de 24 caracteres o más. La misma que `WHATSAPP_PUENTE_CLAVE`. **Sin ella, o más corta, el puente no arranca** (`configDelEntorno`). |
| whatsapp-puente | `DATOS` (`/data`), `PORT` (`8080`) | Disco y puerto. |
| whatsapp-puente | `WHATSAPP_MAX_CUENTAS` (`25`) | Cuántas cuentas caben en el puente. |
| whatsapp-puente | `WHATSAPP_RESERVA_JUNTA` (`2`) | De esas, cuántas solo para la junta y el padrón (`X-Cuenta-Prioridad: junta`, que pone solo el servidor). |
| whatsapp-puente | `NIVEL_LOG` (`INFO`) | El registro del puente. El de whatsmeow va siempre en `WARN`: en `INFO` escribe números vinculados y JIDs. |
| servidor AU-RA | `WHATSAPP_PUENTE_URL` | `http://<nombre interno del servicio>:8080` (red privada de Render). |
| servidor AU-RA | `WHATSAPP_PUENTE_CLAVE` | La clave del puente. |
| servidor AU-RA | `WHATSAPP_DUENOS` | Las cuentas que usan el WhatsApp de antes (`legado`, el de José), separadas por coma: correos de AU-RA o el id de una persona del padrón (`jose` vale con cualquiera de sus correos). |
| servidor AU-RA | `WHATSAPP_ABIERTO` | `1`: toda cuenta de AU-RA puede agregar el suyo. **Sin fijarla (o `0`): solo `WHATSAPP_DUENOS`** (cerrado por omisión desde el 5-oct). |
| servidor AU-RA | `WHATSAPP_CUENTA_SECRETO` | Con qué se firma la clave de cada cuenta. **Sin ella (o con menos de 24 caracteres) solo los dueños tienen WhatsApp** (ya no se usa la clave del puente). Fíjala antes de que vincule la primera persona (24+ caracteres al azar) y no la cambies: con otra, cada cuenta llega a una carpeta vacía (su WhatsApp viejo queda huérfano en el disco hasta borrarlo a mano). |

## Render

- **Orden del despliegue**: despliega primero el puente. Un servidor nuevo con el puente de antes solo deja pasar a los dueños (`legado`): para las demás cuentas pregunta a `/salud` si el puente separa cuentas (`maxCuentas`) y, si no, contesta `503 PUENTE_VIEJO` sin mandarle nada (el puente de antes ignoraba `X-Cuenta` y le habría dado a cualquiera el WhatsApp de José). Y aunque `/salud` diga que sí, toda respuesta sin el eco de su cuenta (`X-Cuenta-Eco`) se rechaza: un servidor nuevo con un puente multicuenta de antes del eco también deja pasar solo a `legado` hasta actualizar el puente. Un servidor de antes con este puente funciona igual (el eco es una cabecera de más).

### Volver el puente a una versión anterior (no lo hagas después de la migración)

- **Devolver el puente a la versión de una sola cuenta después de que migró a `cuentas/legado` no es seguro** para las cuentas que no son `legado`: el puente de antes ignora `X-Cuenta`. El guardia del eco las bloquea (`503 PUENTE_VIEJO`: nadie ve ni manda nada desde el WhatsApp de otro), así que esas cuentas se quedan sin WhatsApp hasta volver a la versión nueva. Y el puente de antes no encuentra la sesión de José (está en `/data/cuentas/legado/`, no en la raíz): José aparece sin vincular.
- Si hace falta volver atrás por un error del servidor, vuelve **solo el servidor**; deja el puente nuevo.
- **Si con el puente de antes se volvió a vincular a José** (quedó una sesión nueva en la raíz, `/data/sesion.db`) y luego se vuelve al puente nuevo, `migrarLegado` **no arranca**: «no migré la cuenta de antes: ya hay sesion.db en …/cuentas/legado (no piso nada; revísalo a mano)». Para arreglarlo:
  1. Decide cuál sesión vale: la de la raíz es la que José vinculó al último (el «AU-RA» más reciente en Dispositivos vinculados de su teléfono).
  2. Desde el Shell de Render del puente, aparta la vieja **fuera de `cuentas/`**: `mv /data/cuentas/legado /data/legado-apartado-$(date +%F)`.
  3. Reinicia el puente: pasa los archivos de la raíz a `cuentas/legado` sin volver a vincular. Comprueba que José ve sus chats.
  4. En el teléfono de José, Dispositivos vinculados: quita el «AU-RA» viejo que sobra. Luego borra `/data/legado-apartado-…`.
  - Si prefieres quedarte con la de `cuentas/legado`, haz lo contrario: borra de la raíz `sesion.db*`, `mensajes.db*` y `fotos/`, reinicia, y quita del teléfono el «AU-RA» que se vinculó con el puente de antes.

- **Disco del puente**: cada cuenta guarda su historia reciente (lo que manda WhatsApp al vincular), miniaturas y fotos de perfil. Calcula unos **50–300 MB por cuenta** (más con grupos muy activos). Para 25 cuentas, un disco de **10 GB** deja margen; 5 GB alcanza si son pocas cuentas.
- **Memoria del puente**: unos **20–40 MB por cuenta conectada** (cliente de whatsmeow, llaves y estado de la app), más picos al llegar la historia. Para 25 cuentas, **1 GB de RAM** (plan Standard); con pocas cuentas, 512 MB.
- Un servicio con disco no hace despliegues sin corte: Render apaga el viejo antes de arrancar el nuevo, así que la migración a `cuentas/legado` corre con las bases cerradas.

## Runbook (operación)

**Antes de desplegar esta versión** (revisión del 5-oct):

1. En el servidor de AU-RA, **fija `WHATSAPP_ABIERTO=1`** si quieres que todas las cuentas sigan pudiendo agregar su WhatsApp. Sin ella, desde esta versión solo los dueños lo tienen (las demás ven «Esta cuenta no puede tener WhatsApp aquí»; nada se borra: al volver a abrirlo, su WhatsApp sigue ahí).
2. Comprueba que `WHATSAPP_CUENTA_SECRETO` existe y tiene **24 caracteres o más**. **Nunca la cambies** para «arreglar» algo: cambia la carpeta de cada cuenta (su WhatsApp queda huérfano). Si falta o es corta, los que no son dueños reciben `503 whatsapp_para_todos_sin_configurar`.
3. Despliega **primero el puente**, después el servidor. Comprueba en el registro del puente que arrancó (`escuchando en :8080`); si dice «falta PUENTE_CLAVE», no arrancó: fíjala (24+).

**Qué hacer cuando…**

| Ves | Qué es | Qué hacer |
|---|---|---|
| `503 PUENTE_VIEJO` o en el registro del servidor «el puente contestó sin el eco de la cuenta» | El puente no devuelve `X-Cuenta-Eco` (es una versión de antes, o algo en medio quitó la cabecera). El servidor no le pasa nada de otra cuenta a nadie; `legado` sigue. | Despliega el puente actual. No toques el servidor. Se arregla solo: el servidor vuelve a preguntar `/salud` cada 30 s. |
| `507 CUPO_LLENO` | El puente tiene todas las cuentas que caben (las a medias ya se soltaron: vencen a los 3 min). | Sube `WHATSAPP_MAX_CUENTAS` (y el disco/RAM, ver «Render»). La junta todavía entra si queda reserva (`WHATSAPP_RESERVA_JUNTA`). |
| `429 whatsapp_limite_vincular` | 5 intentos por IP o 8 por cuenta en 15 min. | Esperar lo que dice `Retry-After`. Si es una oficina con muchas personas tras una IP, que esperen unos minutos; el tope está en `TOPES_VINCULAR` (`server/whatsapp.ts`). |
| Una cuenta abusa o hay que cortarla ya | — | **Suspéndela** en la base de cuentas (`estado = 'suspendida'`): en ≤ 30 s no usa WhatsApp (ni app, ni avatar, ni el «sí» de un borrador). Su sesión en el puente sigue; para borrarla, que desvincule, o quita «AU-RA» de Dispositivos vinculados en su teléfono (sin sesión, el barrido del puente borra su carpeta en menos de un minuto). |
| Hay que cerrar WhatsApp a todos menos los dueños | — | Quita `WHATSAPP_ABIERTO` (o ponla en `0`) y reinicia el servidor. Nada se desvincula. |
| Sospecha de que se filtró `WHATSAPP_PUENTE_CLAVE` | Quien tenga la clave **y** llegue a la red privada podría pedir cualquier carpeta. | Cambia a la vez `PUENTE_CLAVE` (puente) y `WHATSAPP_PUENTE_CLAVE` (servidor). No hace falta volver a vincular. |
| Sospecha de que se filtró `WHATSAPP_CUENTA_SECRETO` | Con ella y el disco del puente se sabría de quién es cada carpeta. | No la cambies sin plan: cada cuenta tendría que volver a vincular. Pon `WHATSAPP_ABIERTO=0`, avisa a las personas y, si se decide rotar, borra las carpetas viejas de `/data/cuentas/` (salvo `legado`) después del cambio. |

**Registro**: el puente nombra cada cuenta por los primeros 8 caracteres de su clave y nunca escribe mensajes; whatsmeow va en `WARN`. No subas `NIVEL_LOG` a `DEBUG` en producción.

## Privacidad

- **Registro**: el de whatsmeow va en `WARN` (en `INFO` escribe el número vinculado y JIDs); el del puente nombra cada cuenta por los primeros 8 caracteres de su clave.
- **Cachés**: `/api/whatsapp/media` y `/api/whatsapp/foto` van con `Cache-Control: private, no-store` (ninguna caché intermedia ni compartida) y `nosniff`; lo que no es imagen, audio o video (y un SVG) va con `Content-Disposition: attachment` (sin nombre de archivo: nada de lo que manda el remitente llega a la cabecera). La app guarda las fotos y archivos en `caché/whatsapp/<seudónimo de la cuenta>/` y al salir (o al entrar otra persona en el teléfono) borra lo de las demás cuentas (`alCambiarCuenta`).

- Los mensajes de cada persona se guardan **en el disco del puente**, en su carpeta, y solo salen por la API con clave hacia el servidor, que los da solo a esa cuenta.
- El puente no sabe de quién es cada carpeta (solo la clave opaca). En el registro sale con los primeros 8 caracteres de la clave, nunca entera ni con el correo.
- Al desvincular se borra todo lo de esa cuenta. Antes de vincular, la persona acepta la tarjeta que dice exactamente eso y el riesgo.

## Riesgos aceptados

- **No es la API oficial de Meta.** Las reglas de WhatsApp prohíben los clientes no oficiales, así que existe el riesgo de que limiten o bloqueen un número.
  - Se reduce usándolo como una persona: leer y contestar, sin mensajes masivos (de ahí el tope de envíos por cuenta).
  - Cada persona lo acepta en la tarjeta antes de vincular.
- **La sesión vinculada da acceso completo a sus chats.**
  - Por eso vive en un servicio privado, con clave, cada cuenta en su carpeta.
  - Al desvincular se borra todo.
- **Cada cierto tiempo WhatsApp puede pedir volver a vincular**, por ejemplo si el teléfono pasa muchos días sin conexión.

## Lo probado

- Contra **WhatsApp real** (2-oct): el puente conectó y WhatsApp le dio un QR válido. No se vinculó ninguna cuenta en la prueba.
- `go test` del puente:
  - almacén, contenido de los mensajes (también fotos de álbum y notas de video) y API con una cuenta falsa (clave, códigos de error, enviar, media, desvincular);
  - LID → número sin repetir ni perder mensajes, nombres que nunca salen vacíos, `/foto` (200/404/412) y la caché de fotos;
  - la cuenta con el almacén real de whatsmeow, sin red: LID, nombres, orden y lo que llega en vivo;
  - **varias cuentas**: sin cabecera o con una mal formada nada se toca; una cuenta no ve chats, mensajes, búsquedas ni envíos de otra; desvincular borra solo su carpeta; `CUPO_LLENO` sin crear carpeta (y el lugar de una vinculación abandonada se libera); la cuenta de antes pasa a `legado` y sigue vinculada (y la migración no pisa nada); al arrancar solo se cargan las vinculadas.
  - **revisión de seguridad** (`seguridad_test.go`): el eco de la cuenta en toda respuesta (también 412 y `/vincular`), ninguno sin cuenta ni en `/salud`; una vinculación a medias vence a los 3 minutos aunque el cupo esté lleno (en `/vincular` y en el barrido) y pedir otro código no estira el plazo; los lugares guardados para la junta; whatsmeow sin `INFO`; sin `PUENTE_CLAVE` (o corta) no arranca.
- `tests/whatsapp.test.ts`, con un puente falso que exige `X-Cuenta`:
  - José (dueño) va siempre por `legado`; otra cuenta va por su clave y no ve nada de José;
  - toda cuenta que abre AU-RA puede agregar el suyo; `WHATSAPP_ABIERTO=0` lo cierra; un código temporal nunca;
  - la clave: estable, sin el correo, la misma para los correos de una persona, distinta con otro secreto;
  - `CUPO_LLENO` honesto; la herramienta del cerebro solo vinculada; borrador + «sí» de SU cuenta; el tope de envíos por cuenta;
  - el cerebro lee por nombre; el borrador sale solo con el «sí»; un mensaje que «ordena» no manda nada;
  - quien nunca agregó su WhatsApp no recibe avisos de «desconectado».
- `tests/whatsapp-seguridad.test.ts`: un puente sin eco (o con el de otra cuenta) no le pasa nada a otra cuenta y el envío ni le llega (José sigue igual); `/vincular` por IP (IPv6 por /64) y por cuenta; la prioridad de la junta la pone solo el servidor; una cuenta suspendida no usa WhatsApp; sin la marca de comunidad no pasa; sin `WHATSAPP_ABIERTO=1` solo los dueños; sin `WHATSAPP_CUENTA_SECRETO` (o corta) solo los dueños; `private, no-store` y `attachment`.
- `mobile/src/whatsapp/pruebas`: el caché por cuenta y su limpieza al salir; la lógica de la pantalla, «Agregar mi WhatsApp» (quién lo ve, la pestaña y Ajustes), la tarjeta de consentimiento, el código para copiar y `CUPO_LLENO`.
- `windows/centro/test/whatsapp.test.mjs`: sin aceptar, abrir el panel no pide el QR.
