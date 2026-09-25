# Arquitectura cognitiva de AU-RA FP y Dr Electrum FP

Qwen piensa. El clasificador decide rápido. La memoria recuerda. Los agentes se especializan. Las
herramientas actúan. **El motor de reglas controla.** La traza observa. Las personas autorizan lo
crítico.

Las dos plataformas comparten estas piezas (código en `lib/cognitivo/`), pero cada una tiene sus
datos, su gente y sus permisos: el despliegue de Dr Electrum nunca ve las trazas ni la cola de la
junta, y al revés, aunque usen la misma base.

## Fase 1 — Traza y evaluación (hecho)

**Traza de cada turno** (`lib/cognitivo/traza.ts`). Cada turno de las dos plataformas, por la web,
la APK o Telegram, deja un registro con:

- la pregunta;
- quién preguntó y con qué nivel;
- la clasificación;
- el especialista que contestó;
- cada herramienta con sus argumentos, si salió bien y cuánto tardó;
- los documentos consultados;
- lo que decidieron las reglas;
- el modelo y los tokens;
- la respuesta, el tiempo total y los errores.

Cómo se construye:

- **Anotar desde cualquier nivel.** La traza viaja con el turno (AsyncLocalStorage), así que el
  bucle de herramientas o la llamada al modelo anotan sin recibirla como parámetro.
- **Nada de secretos.** Las claves pegadas en el chat (AWS, Render, ElevenLabs, GitHub, bots de
  Telegram, URLs con contraseña) se tapan antes de guardar.
- **Guardar nunca frena ni rompe un turno.**
- **Dónde se guarda:**
  - Postgres (`COGNITIVO_DB_URL`, o la base de Electrum si no hay otra), en el esquema `cognitivo`.
  - Sin base, archivos JSONL en `data/cognitivo/`, que se pierden al redesplegar.

**Opinión de la persona.** Después de cada respuesta, la web pregunta «¿Te sirvió? 👍 👎». Es la
señal de calidad más barata y más honesta que hay.

**Cadena de auditoría** (`lib/cognitivo/auditoria.ts`). Cada decisión queda en una cadena firmada
con HMAC, en la que cada registro firma al anterior:

- bloqueos;
- solicitudes;
- firmas;
- ejecuciones.

Si se cambia o se borra un registro, `verificarCadena()` dice cuál fue el primero roto. La clave es
`AUDITORIA_SECRETO`; en producción conviene una propia, que no viva en la misma base.

**Evaluación** (`evals/`, `lib/cognitivo/evaluacion.ts`):

- **Los casos.** 153, escritos a mano a partir de preguntas reales: 82 de AU-RA y 71 de Electrum.
  - Áreas de AU-RA: Orden Global, mercado, taller, honestidad, seguridad y conversación.
  - Áreas de Electrum: legal, geología, GIS, los demás especialistas, herramientas, honestidad y
    seguridad.
- **Qué fija cada caso.** Qué debe mencionar y qué *no* puede decir: una cifra inventada, un
  secreto, «soy ULTRON». También qué herramienta o especialista le toca y qué decidirían las
  reglas.
- **Sin modelo, en `npm test`.** Revisa el enrutado a especialistas, el despacho del taller y las
  reglas contra `evals/linea-base.json`. La prueba falla si algo baja.
- **Con modelo, contra un servidor vivo:**

  ```
  EVAL_SESION=<token> npx tsx scripts/evals/correr.ts --url <servidor> --plataforma ultron \
    --nivel mando --salida evals/informes --anterior evals/informes/<anterior>.json
  ```

  Escribe un informe (JSON y Markdown) y sale con 1 si la versión nueva es peor que la anterior.
  En seguridad y honestidad no se tolera ni una regresión.
- **Lo que ya encontró y se arregló:**
  - «recuérdame…» no se anotaba: el patrón decía `recu[eé]dame`.
  - «Ley General de Minería… caducidad» iba al geólogo.
  - Los empates entre especialistas se resolvían por el orden de la lista.
  - «en lempiras», en plural, no pedía el tipo de cambio.

## Fase 2 — Motor de reglas y aprobación humana (hecho)

**Reglas fuera del modelo** (`lib/cognitivo/politica.ts`). Cada herramienta declara su efecto:

- `lectura`
- `escritura`
- `externo`
- `sistema`
- `critico`

Antes de ejecutarla, quien la corre llama a `autorizar()`: el bucle de Dr Electrum, el taller de
AU-RA, el ejecutor de código y el redespliegue. Se evalúan todas las reglas y gana la más
restrictiva. Una regla que se rompe al evaluarse cuenta como bloqueo.

| Regla | Qué hace |
|---|---|
| `sin-identidad-no-cambia` | Sin sesión o Telegram comprobado no se escribe ni se cambia nada. Un nombre escrito no prueba. |
| `escritura-requiere-nivel` | Consulta solo mira. |
| `sistema-requiere-mando` | Redespliegue, ejecutor y mantenimiento: mando con prueba. |
| `critico-siempre-humano` | Emitir, transferir o firmar: dos firmas de mando, y quien lo pidió no cuenta. |
| `kyc-antes-de-mover-valor` | Sin KYC aprobado no se mueve valor, ni con toda la junta firmando. |
| `emision-exige-firmas-de-junta` | Emitir un activo exige las firmas de la junta completas. |
| `riesgo-alto-a-revision` | Riesgo ≥ 80 del clasificador: escribir o enviar pasa por una persona. |
| `externo-a-terceros-a-revision` | Enviar algo fuera de la junta lo aprueba una persona. |
| `ritmo-de-envios` | 30 envíos por hora identificado, 5 sin sesión. |

**Cola de aprobación** (`lib/cognitivo/aprobaciones.ts`):

- **Se congela la acción.** Queda la herramienta, los argumentos y una huella sha256.
- **La ejecuta el servidor.** Cuando se completan las firmas, corre lo congelado; el modelo no
  vuelve a intervenir.
- **Cuatro ojos.** Quien pide no firma lo suyo. Una sola negativa la rechaza.
- **Vence a las 24 h** (`APROBACION_HORAS`).
- **Se vuelven a pasar las reglas antes de ejecutar.** Si el KYC dejó de estar aprobado, no corre.
  Si alguien tocó los argumentos en la base, la huella no cuadra y tampoco corre.

Dónde se firma:

- **Telegram:** `/solicitudes`, `/aprobar <id> [nota]`, `/rechazar <id> [nota]`.
- **Web:** Ajustes → Control.

A quién le llega el aviso de una solicitud nueva:

- AU-RA: el grupo de la junta.
- Dr Electrum: el Telegram de cada persona con mando.

**Rutas** (`server/cognitivo.ts`; cada despliegue sirve solo lo suyo):

| Ruta | Quién | Para qué |
|---|---|---|
| `GET /api/cognitivo/trazas`, `/resumen`, `/auditoria`, `/auditoria/verificar` | mando | Leer trazas, números y auditoría. |
| `GET /api/cognitivo/trazas/:id` | mando o quien preguntó | Ver una traza. |
| `POST /api/cognitivo/trazas/:id/opinion` | quien preguntó | Dejar su opinión. |
| `GET /api/cognitivo/aprobaciones`, `POST /api/cognitivo/aprobaciones/:id` | mando | Ver y firmar solicitudes. |
| `GET /api/cognitivo/reglas` | cualquiera con acceso | Ver las reglas vigentes. |
| `POST /api/cognitivo/reglas/probar` | mando | «¿Qué pasaría si…?», sin ejecutar nada. |

## Variables nuevas

| Variable | Para qué | Si falta |
|---|---|---|
| `COGNITIVO_DB_URL` | Postgres para trazas, auditoría, cola y entidades | Usa `ELECTRUM_DB_URL`; sin ninguna, archivos locales |
| `COGNITIVO_DIR` | Carpeta de los archivos JSONL | `data/cognitivo/` |
| `AUDITORIA_SECRETO` | Clave HMAC de la cadena | Usa el secreto de sesión |
| `APROBACION_HORAS` | Plazo de una solicitud | 24 |
