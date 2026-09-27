# El padrón: quién entra, a qué, y con qué permiso

AU-RA FP y Dr Electrum FP usan el mismo Qwen 3.8 27B, en el mismo nodo, con el mismo cuerpo —cara,
voz, oído, ojos, harness—. **No comparten nada más.** Cerebros distintos, memorias distintas,
herramientas casi todas distintas y **gente distinta**. Entrar a una no es entrar a la otra.

Todo eso se decide en un solo archivo: `lib/acceso.ts`. Si algún día hay duda sobre quién puede
hacer qué, la respuesta está ahí y en ningún otro sitio.

## Los tres niveles

| Nivel | Qué puede | Qué NO |
|---|---|---|
| `lee` | Preguntar, mirar el mapa, calcular, su propia memoria | No carga nada al cerebro ni toca el sistema |
| `escribe` | Lo anterior **+ alimentar el cerebro**: shapefiles, expedientes, hechos | No redespliega, no hace mantenimiento, no corre el ejecutor |
| `mando` | Todo, incluido el sistema y el padrón | — |

Quien no aparece en una plataforma, **no existe** para esa plataforma. No hay invitado, no hay
público y no hay hueco de desarrollo encendido en producción.

## Cómo está hoy

| Persona | AU-RA FP | Dr Electrum FP |
|---|---|---|
| José | mando | mando |
| Medardo | mando | mando |
| Carlos | consulta | — |
| Mayra | consulta | — |

## Agregar o quitar gente sin desplegar

Se toca la variable `ULTRON_PADRON` en Render. Una persona por línea, cinco columnas:

```
id | nombre | correos | telegram | accesos
```

```
perez   | Ing. Pérez     | perez@mina.hn | 778899 | electrum=escribe
cliente | Minera Andina  |               | 991122 | electrum=lee
jose    |                |               | 5273354540 |
```

La tercera línea es lo importante de entender: **una columna vacía funde, no borra.** Ahí se le
agrega un Telegram a José sin repetirle los correos ni arriesgarse a dejarlo fuera con un dedazo.

Quitarle el mando a alguien es cambiar una palabra:

```
medardo | | | | ultron=lee electrum=lee
```

También acepta un array JSON, si empieza por `[`.

## Cuentas desde la web: pedir acceso, olvidé y cambiar la contraseña

Las dos webs (AU-RA FP y Dr Electrum FP) tienen, en la pantalla de entrada, **«¿Olvidaste tu
contraseña?»** y **«Solicitar acceso»**, y con la sesión abierta, **Cambiar contraseña** (en AU-RA,
en el panel de acceso; en Dr Electrum, el botón **Cuenta** de la barra, con el mapa abierto).

- **Pedir acceso.** La persona deja nombre, correo y para qué lo quiere. Al aprobador
  (`CUENTAS_APROBADOR`, por defecto `j.ordonez@ordenglobal.org`) le llega un correo con el enlace
  «Revisar la solicitud»; entra con su sesión y elige **Consulta, Trabajo o Mando**, o rechaza. La
  persona recibe un enlace (72 h, un solo uso) para crear su contraseña. Nadie entra sin esa
  aprobación, y solo el aprobador ve la lista (tener mando no alcanza).
- **Olvidé.** Manda un enlace de 30 minutos y un solo uso, SOLO a un correo que esté exacto en el
  padrón o en una cuenta aprobada. La respuesta es la misma exista o no el correo.
- **Cambiar.** Pide la actual. Al cambiarla o recuperarla, las sesiones abiertas antes se cierran
  (en este servicio al instante, en el otro en menos de un minuto) y llega un aviso por correo.

Dónde vive: esquema `cuentas` en Postgres (`CUENTAS_DB_URL`, o la cognitiva, o la de Dr Electrum),
compartido por los dos servicios para que la clave sea una sola. Las claves se guardan con scrypt;
los enlaces, como huella SHA-256. **Quien se hace clave aquí entra con esa y solo con esa**; quien
todavía no, sigue entrando con la del cerebro remoto (`ULTRON_REMOTE_URL`), que no se toca porque
abre otras cosas de Orden Global.

Los correos salen por Amazon SES desde `no-responder@ordenglobal.org` (`CORREO_REMITENTE`), con las
llaves de AWS del servicio; el usuario IAM necesita `ses:SendEmail` para ese remitente. Los enlaces
apuntan siempre a la dirección pública de cada plataforma (`CUENTAS_ORIGEN`, o `PUBLIC_BASE` en
Dr Electrum), nunca a la que diga la petición.

Una cuenta aprobada se suma al padrón sin pisar a nadie: si el correo ya era de alguien, solo gana
las plataformas que no tenía. Y un correo de afuera no pasa por uno de la casa: `j.ordonez@gmail.com`
no es José (el parecido por buzón vale solo entre dominios de Orden Global).

## Decir quién sos no es serlo

La identificación trae **prueba**, y solo dos cuentan:

- `sesion` — el correo viene de una cookie firmada con el HMAC del servidor. Vale.
- `telegram` — el id llegó por un webhook con el secreto verificado. Vale.
- `nombre` — alguien escribió «José» en un campo de texto. **No vale para nada más que saludarlo.**

Sin esa distinción, cualquiera manda `{"nombre":"José"}` en el cuerpo de una petición y hereda el
sistema. `puedeMandar()` y `puedeEscribir()` rechazan la prueba `nombre` siempre, en las dos
plataformas.

## Las dos puertas

| | AU-RA FP | Dr Electrum FP |
|---|---|---|
| Sesión | `/api/ultron/entrar` (correo de la junta) | la misma, si la persona tiene `electrum` |
| Llave de demo | `ULTRON_MESA_CLAVE` → `x-ultron-mesa` | `ELECTRUM_CLAVE` → `x-electrum-llave` |
| Bot de Telegram | `TELEGRAM_BOT_TOKEN` | `ELECTRUM_BOT_TOKEN` |
| Secreto del webhook | `TELEGRAM_WEBHOOK_SECRET` | `ELECTRUM_WEBHOOK_SECRET` |
| Ruta del webhook | `/api/telegram/webhook` | `/api/electrum/telegram/webhook` |

**La llave de AU-RA no abre Dr Electrum, y al revés.** Está probado, no supuesto.

## Las herramientas

Casi ninguna se comparte, y es a propósito:

| Solo AU-RA | Solo Dr Electrum | Las dos |
|---|---|---|
| taller, bóveda, ejecutor, memoria de junta, canto | catastro, GIS, mapa, expedientes | `calculo_mina`, `metales_spot` |

Cada mano declara en qué plataformas vive (`plataformas: [...]`), el compilador lo exige, y el panel
de Electrum filtra por ese campo. Si alguien agrega una mano de AU-RA al registro equivocado, no
llega al modelo.

Las dos compartidas pasan una prueba concreta: **¿es literalmente el mismo hecho del mundo para los
dos cerebros?** El oro es el mismo oro y la aritmética de mina no cambia según quién pregunte. Si la
respuesta depende de la plataforma, no se comparte.

## El bot de Dr Electrum FP

Cuenta de Telegram aparte, con su propio hilo de conversación: lo que se habla con el Doctor no
aparece en el chat de la junta.

El nivel de acceso decide algo concreto, no decorativo:

- **`escribe` o `mando`** — mandale un `.zip` de shapefiles, un KML o un PDF y **entra al cerebro**:
  la capa queda en el mapa medida sobre el elipsoide, el expediente queda citable con su página.
- **`lee`** — el archivo se lee para ese turno y se olvida. Es la diferencia entre enseñarle algo y
  prestárselo un momento.

Para abrir una sala de demostración se ponen los ids de chat en `ELECTRUM_TELEGRAM_CHATS`. Ahí Dr
Electrum atiende a quien esté dentro, siempre con nivel de consulta. **Vacío por defecto**, y alguien
del padrón a quien no se le dio Electrum tampoco entra por esa sala: que se le dijera que no pesa más
que una puerta abierta.

## Códigos de acceso temporal (Dr Electrum)

Para que alguien pruebe Dr Electrum sin cuenta. El aprobador (`CUENTAS_APROBADOR`) los crea en
**Cuenta → Códigos**, con el mapa abierto: 1, 5 o 24 horas (no hay más), nivel Consulta o Trabajo
(nunca Mando) y, si quiere, para quién. El invitado entra en «Tengo un código de acceso».

- **Nunca se repite.** Cada código es nuevo y al azar (`DE-XXXX-XXXX-XXXX`, unos 59 bits). En la
  base se guarda solo su huella SHA-256 y los últimos 4 caracteres para reconocerlo: el código
  entero se ve UNA vez, al crearlo.
- **Al vencer lo saca del todo.** La sesión que abre lleva la hora de vencimiento firmada y el
  servidor la rechaza desde ese segundo (también desde el caché en memoria). Además, al vencer o
  al revocarse, toda sesión de ese código queda marcada como inválida y el código sale del padrón.
  La pantalla del invitado muestra la cuenta regresiva y se cierra sola con el aviso.
- **Revocar** lo corta al instante.
- Solo en Dr Electrum: en AU-RA cualquier sesión abre la mesa de la junta, y los dos servicios
  firman con secretos distintos, así que una sesión de invitado de Electrum no vale en AU-RA.
- La llave de demostración fija (`ELECTRUM_CLAVE`) sigue funcionando en el mismo campo; lo que
  tiene forma de código entra como código.
