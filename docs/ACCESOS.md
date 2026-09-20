# El padrón: quién entra, a qué, y con qué permiso

ULTRON FP y Dr Electrum FP usan el mismo Qwen 3.8 27B, en el mismo nodo, con el mismo cuerpo —cara,
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

| Persona | ULTRON FP | Dr Electrum FP |
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

## Decir quién sos no es serlo

La identificación trae **prueba**, y solo dos cuentan:

- `sesion` — el correo viene de una cookie firmada con el HMAC del servidor. Vale.
- `telegram` — el id llegó por un webhook con el secreto verificado. Vale.
- `nombre` — alguien escribió «José» en un campo de texto. **No vale para nada más que saludarlo.**

Sin esa distinción, cualquiera manda `{"nombre":"José"}` en el cuerpo de una petición y hereda el
sistema. `puedeMandar()` y `puedeEscribir()` rechazan la prueba `nombre` siempre, en las dos
plataformas.

## Las dos puertas

| | ULTRON FP | Dr Electrum FP |
|---|---|---|
| Sesión | `/api/ultron/entrar` (correo de la junta) | la misma, si la persona tiene `electrum` |
| Llave de demo | `ULTRON_MESA_CLAVE` → `x-ultron-mesa` | `ELECTRUM_CLAVE` → `x-electrum-llave` |
| Bot de Telegram | `TELEGRAM_BOT_TOKEN` | `ELECTRUM_BOT_TOKEN` |
| Secreto del webhook | `TELEGRAM_WEBHOOK_SECRET` | `ELECTRUM_WEBHOOK_SECRET` |
| Ruta del webhook | `/api/telegram/webhook` | `/api/electrum/telegram/webhook` |

**La llave de ULTRON no abre Dr Electrum, y al revés.** Está probado, no supuesto.

## Las herramientas

Casi ninguna se comparte, y es a propósito:

| Solo ULTRON | Solo Dr Electrum | Las dos |
|---|---|---|
| taller, bóveda, ejecutor, memoria de junta, canto | catastro, GIS, mapa, expedientes | `calculo_mina`, `metales_spot` |

Cada mano declara en qué plataformas vive (`plataformas: [...]`), el compilador lo exige, y el panel
de Electrum filtra por ese campo. Si alguien agrega una mano de ULTRON al registro equivocado, no
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
