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
  - `WHATSAPP_ABIERTO=0` lo cierra: vuelve a ser solo de `WHATSAPP_DUENOS`.
- **La clave de cada cuenta** (`claveCuentaWhatsapp`): el servidor la saca de la sesión y la manda al puente en la cabecera `X-Cuenta`.
  - Para los demás: `HMAC-SHA256(WHATSAPP_CUENTA_SECRETO, persona del padrón o correo)`, 40 cifras hexadecimales. Los varios correos de una misma persona del padrón dan el mismo WhatsApp.
  - El puente **nunca ve el correo**: solo esa clave, que usa de nombre de carpeta (solo acepta `legado` o hexadecimal; nada de `..` ni `/`).
- **Aislamiento en el puente**:
  - Toda ruta (salvo `/salud`) va por la cuenta de la cabecera. Sin ella, o con una mal formada: `400 SIN_CUENTA`. Con una que no está: `412 SIN_VINCULAR`. En ningún caso se toca otra cuenta.
  - Solo `/vincular` crea una cuenta (su carpeta). `/estado` de una cuenta que nunca vinculó dice `registrada: false` sin crear nada.
  - El candado de envíos (que el mismo mensaje no salga dos veces, AUR13) es por cuenta.
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
  - Antes de decir que no, se sueltan las vinculaciones abandonadas (sin sesión y sin vinculación en curso).
  - Las ya vinculadas nunca se sacan; si bajas el tope por debajo de las que hay, siguen todas y no entra ninguna nueva.
- **A pedido**: al arrancar solo se reconectan las cuentas con sesión; una carpeta sin sesión (vinculación a medias, o desvinculada desde el teléfono) se borra.
- **Envíos por cuenta**: 20 por minuto y 200 por hora (los dueños comparten el de `legado`: es un solo número). Pasado el tope no sale nada y se dice por qué (`429 whatsapp_limite_envios` en la app; «NO lo mandé…» al avatar).

## Variables

| Dónde | Variable | Qué es |
|---|---|---|
| whatsapp-puente | `PUENTE_CLAVE` | Clave de 24 caracteres o más. La misma que `WHATSAPP_PUENTE_CLAVE`. |
| whatsapp-puente | `DATOS` (`/data`), `PORT` (`8080`) | Disco y puerto. |
| whatsapp-puente | `WHATSAPP_MAX_CUENTAS` (`25`) | Cuántas cuentas caben en el puente. |
| servidor AU-RA | `WHATSAPP_PUENTE_URL` | `http://<nombre interno del servicio>:8080` (red privada de Render). |
| servidor AU-RA | `WHATSAPP_PUENTE_CLAVE` | La clave del puente. |
| servidor AU-RA | `WHATSAPP_DUENOS` | Las cuentas que usan el WhatsApp de antes (`legado`, el de José), separadas por coma: correos de AU-RA o el id de una persona del padrón (`jose` vale con cualquiera de sus correos). |
| servidor AU-RA | `WHATSAPP_ABIERTO` | Por omisión abierto: toda cuenta de AU-RA puede agregar el suyo. `0`: solo `WHATSAPP_DUENOS`. |
| servidor AU-RA | `WHATSAPP_CUENTA_SECRETO` | Con qué se firma la clave de cada cuenta. Si falta, la clave del puente. **Fíjala antes de que vincule la primera persona** (24+ caracteres al azar) y no la cambies: con otra, cada cuenta llega a una carpeta vacía (su WhatsApp viejo queda huérfano en el disco hasta borrarlo a mano). Si no la fijas, no cambies `WHATSAPP_PUENTE_CLAVE` por lo mismo. |

## Render

- **Orden del despliegue**: da igual cuál va primero. Un servidor nuevo con el puente de antes solo deja pasar a los dueños (`legado`): para las demás cuentas pregunta a `/salud` si el puente separa cuentas (`maxCuentas`) y, si no, contesta `503 PUENTE_VIEJO` sin mandarle nada (el puente de antes ignoraba `X-Cuenta` y le habría dado a cualquiera el WhatsApp de José).

- **Disco del puente**: cada cuenta guarda su historia reciente (lo que manda WhatsApp al vincular), miniaturas y fotos de perfil. Calcula unos **50–300 MB por cuenta** (más con grupos muy activos). Para 25 cuentas, un disco de **10 GB** deja margen; 5 GB alcanza si son pocas cuentas.
- **Memoria del puente**: unos **20–40 MB por cuenta conectada** (cliente de whatsmeow, llaves y estado de la app), más picos al llegar la historia. Para 25 cuentas, **1 GB de RAM** (plan Standard); con pocas cuentas, 512 MB.
- Un servicio con disco no hace despliegues sin corte: Render apaga el viejo antes de arrancar el nuevo, así que la migración a `cuentas/legado` corre con las bases cerradas.

## Privacidad

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
- `tests/whatsapp.test.ts`, con un puente falso que exige `X-Cuenta`:
  - José (dueño) va siempre por `legado`; otra cuenta va por su clave y no ve nada de José;
  - toda cuenta que abre AU-RA puede agregar el suyo; `WHATSAPP_ABIERTO=0` lo cierra; un código temporal nunca;
  - la clave: estable, sin el correo, la misma para los correos de una persona, distinta con otro secreto;
  - `CUPO_LLENO` honesto; la herramienta del cerebro solo vinculada; borrador + «sí» de SU cuenta; el tope de envíos por cuenta;
  - el cerebro lee por nombre; el borrador sale solo con el «sí»; un mensaje que «ordena» no manda nada;
  - quien nunca agregó su WhatsApp no recibe avisos de «desconectado».
- `mobile/src/whatsapp/pruebas`: la lógica de la pantalla, «Agregar mi WhatsApp» (quién lo ve, la pestaña y Ajustes), la tarjeta de consentimiento, el código para copiar y `CUPO_LLENO`.
- `windows/centro/test/whatsapp.test.mjs`: sin aceptar, abrir el panel no pide el QR.
