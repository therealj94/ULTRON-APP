# Fase 0 de seguridad — entrega

1-oct-2026 · rama de trabajo sobre `claude/ultron-fp-premium-s46jxx` (desde `242c280`).

Cada punto del plan externo se comprobó primero en el código (archivo:línea del commit de partida,
`242c280`). Donde el hallazgo era real se arregló con lo mínimo y con prueba. Nada de esto tocó
Render, los nodos de AWS, ElevenLabs ni Supabase: lo que hay que hacer allí está en «Para José».

| Punto | ¿Real? | Commit |
|---|---|---|
| 0.1 `/server.cjs` y su sourcemap públicos | Sí — ya arreglado antes | `242c280` |
| 0.2 Sin `NODE_ENV`, todo se abre | Sí | `060d102` |
| 0.3 Turnos anónimos llegan al 27B sin censura | Sí | `5af0491` |
| 0.4 Cuerpo de 12 MB antes de la autenticación | Sí | `78f0e7f` |
| 0.5 `EJECUTOR_URL` sin autenticación | Sí (lado cliente; el servicio no está en el repo) | `9498479` |
| 0.6 «Cualquier sesión cuenta como mesa» | Sí | `5af0491` |
| 0.7 IPs reales en `.env.example` | Sí | `e762ccb` |
| 0.9 Lista de rotación | Documento (no se rotó nada) | este archivo |
| 0.10 Ojo por HTTP y TLS sin verificar hacia el nodo | Sí; se documenta (y se tapó una fuga menor) | `a2fc660` |

---

## 0.1 — El código del servidor era público (ya arreglado en `242c280`)

`https://aura-fp.onrender.com/server.cjs` (1,9 MB), `/server.cjs.map` (3,8 MB, con el código fuente
entero) e `/importar-cubo.cjs` respondían 200: el build los escribía en `dist/` y `express.static`
sirve todo `dist/`.

- El build los deja en `build-server/` (fuera de lo servido, en `.gitignore`); `npm start` y la
  importación de Render apuntan ahí.
- Red por si vuelven a caer en `dist/`: antes de `express.static`, 404 a cualquier `.cjs`, `.map`,
  `/server*` e `/importar-cubo*` (`server.ts`, bloque de producción de `startServer`).
- Prueba: `tests/codigo-no-publico.test.ts` contra el servidor compilado.

Qué se pudo ver: el código (que de todos modos está en el repo público) y la forma de la
infraestructura. **Ningún secreto**: el servidor lee todas las llaves de `process.env` y esbuild no
incrusta variables (sin `define`). Se comprobó compilando el bundle y buscando patrones de llaves
(AWS `AKIA…`, Render `rnd_…`, ElevenLabs `sk_…`, Google `AIza…`, Telegram `<id>:AA…`, Tavily,
GitHub, claves privadas): cero coincidencias; 169 lecturas de `process.env`.

---

## 0.2 — Arranque que falla cerrado

**Verificado.** Toda relajación dependía de `NODE_ENV !== 'production'`, así que un servidor sin
`NODE_ENV` (servicio nuevo, variable olvidada, `node build-server/server.cjs` a mano) quedaba abierto:

| Dónde (en `242c280`) | Qué abría |
|---|---|
| `server/seguridad.ts:436` `mesaAutorizada` | la mesa sin sesión: `/api/memoria`, caras, perfil, canal de acciones, Windows… |
| `server/nivel.ts:68` `nivelDePeticion` | **cualquiera era junta**: con el 0.3 eso era un turno anónimo con taller y Telegram de la organización |
| `server/seguridad.ts:629` `plataformaAutorizada` | Dr Electrum entero sin llave |
| `lib/ejecutor.ts:82-88` | `python3` en el propio host, con el usuario del servidor y todas las llaves a la vista |
| `server.ts:3908` `startServer` | Vite en modo middleware: sirve el árbol del repo (fuentes, `data/`) |
| `server/mcp-oauth.ts:56` `basePublica` | anunciaba los endpoints de OAuth en `http` |

(`lib/ssl-base.ts:55` solo avisa; no relaja nada.)

**Cambio.** `lib/entorno.ts` → `modoDesarrollo()`: verdadero solo con `AURA_DEV=1` o `NODE_ENV=test`;
`NODE_ENV=production` gana siempre (aunque quede `AURA_DEV=1` olvidado en Render). Los seis sitios lo
usan. `npm run dev` pone `AURA_DEV=1`; `.env.example` ya no trae `NODE_ENV=development` (no es una
marca: ahora `development` se porta como producción). Las pruebas que dependen del hueco lo declaran
(`tests/ejecutor.test.ts`, `tests/mcp-oauth.test.ts`).

Archivos: `lib/entorno.ts` (nuevo), `server/seguridad.ts`, `server/nivel.ts`, `lib/ejecutor.ts`,
`server.ts`, `server/mcp-oauth.ts`, `package.json`, `.env.example`, `README.md`.

**Pruebas.**
- `tests/fase0-entorno.test.ts` (5): matriz de `modoDesarrollo`; sin `NODE_ENV` la mesa, la junta,
  Electrum y OAuth quedan cerrados; `production` + `AURA_DEV=1` sigue cerrado; con `AURA_DEV=1` el
  hueco sigue como antes; con llave puesta no hay hueco ni en desarrollo.
- `tests/fase0-servidor.test.ts` arranca **`server.ts` de verdad sin `NODE_ENV`**: `/@vite/client`,
  `/@vite/env` y `/lib/entorno.ts` no salen como código (la sonda se validó a mano: con `AURA_DEV=1`
  `/@vite/client` sí devuelve el cliente de Vite); `/api/memoria`, `/api/sistema`, `/api/taller`,
  `/api/vault/status` dan 401; la salud sin sesión no enseña los nodos.
- `tests/ejecutor.test.ts`: sin marca no corre python en el host; `production` gana a `AURA_DEV=1`.

---

## 0.3 — Turnos anónimos al 27B sin censura

**Verificado.** `exigirMesaODesk` (`server/seguridad.ts:475`) dejaba pasar cualquier ruta de la lista
`RUTAS_CONVERSACION` (`:454`), que incluía `/api/turno` (y, por prefijo, `/api/turno/stream`). Las dos
rutas (`server.ts:3346` y `:3426`) llevan solo `exigirMesaODesk` + `limitar(60)` por IP; sin sesión
`cupoDeMiembro` no aplica y `nivelDePeticion` da `miembro` en producción (en desarrollo, junta). El
turno va al nodo de `ULTRON_NODO_URL` con `ULTRON_NODO_MODELO`, que por omisión es
`orcarouter/Qwen3.8-27B-Uncensored` (`lib/nodo.ts:10`). Es decir: cualquiera con la URL tenía 60
turnos por minuto y por IP en el 27B sin censura del nodo de José. Lo mismo por `/api/voz/agente`
(entraba como «ruta de voz» por el prefijo `/api/voz`), aunque su handler sí exige sesión.

Otros caminos al cerebro, revisados: Telegram (secreto del webhook + lista de chats y usuarios),
`/api/voz/llm/chat/completions` (llave derivada + pase firmado de una sesión), MCP (token), Electrum
(`exigirPlataforma('electrum')`: sesión o llave de la demo `ELECTRUM_CLAVE`; el hueco sin llave era el
del 0.2). `/api/tts`, `/api/stt`, `/api/vision/analyze`, `/api/cantar`, `/api/orar` no llaman al 27B
(voz, oído, ojo/Gemini, repertorio).

**Cambio.** `/api/turno` sale de la lista: un turno pide sesión de AU-RA o la clave de la mesa. El
401 lleva `code: 'sesion_requerida'`, que el teléfono ya usa para renovar su token con la clave
guardada (`mobile/src/lib/api.ts`, y si el stream da 401 cae al JSON, que sí renueva) y que la web
convierte en «Entrá» (`src/04-cerebro/turno.ts`, `src/App.tsx`). La app de Windows y el script de
latencia ya mandan sesión. La lista queda de **coincidencia exacta** (`/api/tts`, `/api/tts/stream`,
`/api/voz`, `/api/stt`, `/api/vision/analyze`, `/api/cantar`, `/api/orar`, `/api/diag`), así
`/api/voz/agente` ya no entra por ser «de voz».

Se mantiene la decisión de la junta del 19-sep para lo que NO piensa (oír, ver, la voz, el canto),
con límite por IP: la web sin sesión puede decir «Entrá» en voz alta.

Archivos: `server/seguridad.ts`, `server/seguridad.test.ts` (la prueba que afirmaba que `/api/turno`
pasaba sin sesión ahora afirma lo contrario), `tests/seguridad-turno.test.ts` (comentario),
`tests/expresiones-turno.test.ts` (entra con la clave de la mesa).

**Pruebas** (`tests/fase0-servidor.test.ts`, servidor real sin `NODE_ENV` y un nodo falso que anota
cada mensaje): sin sesión `/api/turno` y `/api/turno/stream` dan 401 `sesion_requerida` y el nodo no
recibe nada; `/api/voz/agente` da 401; un token inventado da 401; con sesión de la junta del padrón y
con sesión de un miembro de la comunidad, el turno sí llega al nodo (200).

---

## 0.4 — Límite del cuerpo

**Verificado.** `server.ts:203-204`: `express.json({ limit: '12mb' })` para todas las rutas, antes
de cualquier autenticación.

**Cambio.** Tope general de **1 MB**. Suben a **12 MB** solo las rutas que llevan foto, PDF o audio,
y solo si la petición ya trae su credencial en las cabeceras (se decide antes de leer el cuerpo):

- AU-RA (sesión de AU-RA o clave de mesa): `/api/turno`, `/api/turno/stream` (foto/PDF en el turno),
  `/api/vision/analyze` (hasta 3 MB de base64), `/api/stt` (el teléfono manda el audio dos veces).
- Dr Electrum (sesión o llave de la demo): `/api/electrum/ver`, `/oir`, `/informe` (mapa de hasta
  6 MB), `/area/analizar`, `/area/informe`, `/muestras/cargar`, `/satelite/cargar`.
- `/api/electrum/subir` y `/api/electrum/biblioteca/texto/:id` siguen con su `express.raw` de 64 MB
  (no pasan por el lector de JSON).

Sin credencial, un cuerpo grande se corta con 413 «Lo que mandaste es demasiado grande» sin llegar a
la ruta. Archivo: `server.ts`.

**Pruebas** (`tests/fase0-servidor.test.ts`): sin sesión, ~2 MB dan 413 en visión, oído, turno y
memoria; con sesión la visión los recibe y se los pasa al ojo (200) y el oído los procesa (no 413);
`/api/memoria` sigue con 1 MB aunque haya sesión; una foto chica sin sesión sigue pasando.

---

## 0.5 — Ejecutor remoto sin autenticación

**Verificado.** `lib/ejecutor.ts:239-243` (`ejecutarRemoto`) hacía `POST ${EJECUTOR_URL}/ejecutar`
solo con `Content-Type`. El servicio **no está en el repo**: `scripts/ejecutor.py` existe solo en el
commit `cfc1cef` de una rama vieja (Flask, sin ninguna autenticación). No sé qué corre hoy en el host
del sandbox, ni si `EJECUTOR_URL` está puesta en Render.

**Cambio.** Con `EJECUTOR_SECRETO` puesto, cada llamada lleva `x-ejecutor-secreto` (mismo patrón que
`x-ultron-secreto` al nodo, variable aparte). Sin la variable no se manda nada (compatible).
Archivos: `lib/ejecutor.ts` (`cabecerasEjecutor`), `.env.example`.

**Pruebas** (`tests/ejecutor.test.ts`, sandbox falso): con la variable llega la cabecera exacta y el
secreto no vuelve en la respuesta; sin ella no se inventa ninguna cabecera.

**Para José (despliegue, en este orden):**
1. Generar el secreto: `openssl rand -hex 32`.
2. En el host del sandbox, hacer que el servicio lo exija ANTES de leer el código. Si es el Flask de
   `cfc1cef`, al principio de `ejecutar()`:
   ```python
   import hmac
   SECRETO = os.environ.get('EJECUTOR_SECRETO', '')
   # …dentro de ejecutar(), primera línea:
   dado = request.headers.get('x-ejecutor-secreto', '')
   if not SECRETO or not hmac.compare_digest(dado.encode(), SECRETO.encode()):
       return jsonify({'error': 'no autorizado', 'ok': False}), 401
   ```
   y poner `EJECUTOR_SECRETO=…` en su entorno (unidad de systemd o `.env` del servicio, permisos 600).
   Mejor aún: que escuche solo en la red privada/security group con la IP de salida de Render, y por
   https (si va por http, el secreto viaja en claro igual que hoy la clave del ojo; ver 0.10).
3. En Render (cada servicio que tenga `EJECUTOR_URL`): `EJECUTOR_SECRETO=<el mismo>`.
4. Comprobar: `curl -s -o /dev/null -w '%{http_code}' -X POST $EJECUTOR_URL/ejecutar -H 'Content-Type: application/json' -d '{"codigo":"print(1)"}'` → 401; desde la mesa, «ejecuta print(1)» con mando → funciona.
5. Si `EJECUTOR_URL` no está puesta en Render, no hace falta nada (en producción sin sandbox el
   ejecutor dice «sin sandbox» y no corre nada).

---

## 0.6 — «Cualquier sesión cuenta como mesa»

**Verificado.** `server/seguridad.ts:432`: `mesaAutorizada` devolvía `true` con cualquier sesión
firmada válida. La sesión es una sola para las dos plataformas (mismo formato y firma; el propio
código lo dice en `server.ts:1464`: «AU-RA (donde cualquier sesión abre la mesa)»). Si los dos
servicios comparten `ULTRON_SESION_SECRETO`, una sesión de Dr Electrum —un **código temporal** de la
demo (`codigo-N@temporal.drelectrum`) o una persona del padrón **solo con Electrum**— abría en AU-RA
la mesa, los turnos del 27B, la memoria y la conversación de voz. Además el cerebro remoto
(`/entrar` de `ULTRON_REMOTE_URL`) le daba sesión de AU-RA a quien conociera, sin mirar el padrón.

Quién usa `exigirMesaODesk`: `/api/turno`, `/api/turno/stream`, `/api/vision/analyze`, `/api/tts`,
`/api/tts/stream`, `/api/voz`, `/api/orar`, `/api/cantar`, `/api/stt` (`server.ts`) y
`/api/voz/agente`, `/api/voz/agente/cerrar` (`server/voz-agente.ts`). `mesaAutorizada` además está
detrás de `exigirMesa` (memoria, caras, perfil, acciones y contexto de la app, Windows) y `exigirJunta`.

**Cambio.** `sesionAbreAura(correo)`: abre la mesa quien está en el padrón **con** acceso a AU-RA (la
junta y quien se aprobó) o quien **no** está en el padrón (el miembro de la comunidad que entró con
Genesis ID o por el cerebro remoto, que `server/nivel.ts` ya trata como miembro). No la abre quien el
padrón conoce y deja fuera de AU-RA, ni un código temporal. `mesaAutorizada` lo usa, así que vale para
todas las puertas de arriba. El cerebro remoto ya no le da sesión de AU-RA a quien el padrón deja
fuera (403 `SIN_ACCESO`, el mismo mensaje que la cuenta propia).

Clientes revisados: el teléfono, la web y la app de Windows mandan siempre `x-ultron-sesion`; nadie
usa `x-ultron-mesa` hoy (queda para un aparato de la junta sin login). Pasan sin cambios las suites
`app-rutas`, `caras-rutas`, `windows-rutas`, `nivel-miembro`, `sesiones-seguras`, `voz-agente`,
`voz-miembro`, `genesis-entrar` y `cuentas`.

**Pruebas** (`tests/fase0-servidor.test.ts`): con la sesión de un código temporal y con la de una
persona solo de Electrum, `/api/turno` da 401 (el nodo no recibe nada), `/api/memoria` da 401 y
`/api/voz/agente` da 401. La junta del padrón y el miembro de la comunidad siguen entrando (0.3).

---

## 0.7 — IPs reales en los ejemplos

**Verificado.** `.env.example` traía las IPs públicas del nodo Qwen (`ULTRON_NODO_URL`,
`QWEN_ENDPOINT_URL`), del ojo (`ULTRON_OJO_URL`, `PLAYWRIGHT_NODE_URL`), la T4 en forma sslip.io
(`VOICEBOX_URL` y el comentario de Laya) y el id del servicio de Render. También estaban en
`infra/t4/.env.example`, `AREAS.md`, `docs/` (`NODO-T4.md`, `ELECTRUM.md`, `ENTREGA-4.0.md`,
`historial/`), `src/10-infra/README.md`, el README de pulse2chat, los mensajes de
`scripts/nodo-t4/instalar-{laya,oido}.sh`, como valor por omisión del cliente web
(`src/10-infra/secretos.ts`, que iría en el JavaScript público) y como dato de una prueba.

**Cambio.** Ejemplos con direcciones `.example` y vacíos; marcadores `<ip-qwen>`, `<ip-t4>`,
`<ip-ojo>`, `<ip-…-con-guiones>.sslip.io`, `<ip-privada-…>` en la documentación; el cliente web sin
dirección por omisión; la prueba de Laya con una IP de documentación (203.0.113.9).

Quedan a propósito: `scripts/nodo-t4/vigia.json` (configuración que se instala tal cual en la T4: el
SNI de su sonda), las IPs de salida de Render Oregon en `docs/ELECTRUM.md` (son de Render y públicas)
y los ids de reglas de security group (no sirven sin credenciales de AWS). **Las IPs siguen en el
historial de git** (y el repo es público): quitarlas de HEAD reduce el mapa a la vista, no lo borra.
Lo que protege de verdad es que cada puerto exija secreto y esté cerrado por security group.

**Prueba** (`tests/fase0-ejemplos.test.ts`): ningún `.env.example` del repo (raíz, `infra/t4`,
`windows/gateway`) trae una IPv4 real, ni con puntos ni con guiones de sslip.io/nip.io (se admiten
127.0.0.1, 0.0.0.0 y los rangos de documentación del RFC 5737). Con el `.env.example` viejo falla.

---

## 0.9 — Lista de rotación (no se rotó nada)

Contexto: el bundle que se sirvió (0.1) no tenía secretos (se leen de `process.env`), y el código
fuente es público en GitHub de todos modos. Lo que sí pudo exponerse es: (a) lo que viaja en claro
por HTTP, (b) lo que quedó en el historial de git, (c) lo que se pegó en chats durante el desarrollo
(`SECURITY.md` ya lo pedía). El orden va por riesgo.

**Prioridad 1 — expuesto de verdad**

| Secreto | Por qué | Cómo rotar |
|---|---|---|
| API key de Render (`rnd_…`, termina en `…diq`) | Está en el historial público: commit `6e1d1d7` (primer commit), quitada en `f30e529` | Render → Account Settings → API Keys: revocarla (si sigue viva) y crear otra; poner la nueva en `RENDER_API_KEY` de los servicios que redespliegan por voz |
| AWS Access Key ID `AKIA…6HB` | En el historial público (`6e1d1d7` … `97d722f`, UI vieja). No se encontró la Secret Access Key en el historial | IAM → Users → Security credentials: confirmar que está **desactivada y borrada**; si no, desactivarla ya y revisar CloudTrail. (La `AKIAX7LQ…F5N` de `ENTREGA-4.0.md` ya no existía en IAM) |
| `ULTRON_OJO_CLAVE` | Viaja en claro por HTTP en cada llamada al ojo (`X-Ojo-Clave`, `lib/vision.ts:55`) | Generar otra (`openssl rand -hex 32`), ponerla en el servicio del ojo y en Render a la vez. Rotarla de nuevo cuando el ojo vaya por https (0.10) |
| `ULTRON_STT_CLAVE` (si se usa) | `ULTRON_STT_URL` va por `http://<ip-t4>:8791` (docs/NODO-T4.md) | Igual: otra en la T4 y en Render; mejor pasar el oído detrás del Caddy https de la T4 |
| Todo lo que se haya pegado en chats | `SECURITY.md` | Rotar según la tabla de abajo |

**Prioridad 2 — higiene (no hay evidencia de fuga, pero dan mando o cuestan dinero)**

| Variable | Dónde se cambia | Notas |
|---|---|---|
| `ULTRON_NODO_SECRETO` | Render (cada servicio) **y** el nodo: `ULTRON_MOTOR_SECRETO` de `ultron-motor.py` (y el proxy si lo exige) | Cambiar los dos a la vez o los turnos caen; probar `/api/nodo/listo` |
| `ULTRON_SESION_SECRETO` | Render | Cierra **todas** las sesiones (el teléfono vuelve a entrar solo con la clave guardada; quien entró con Genesis toca el botón otra vez) y mata los tokens de MCP. Después **correr `scripts/elevenlabs-agentes.ts`** con el secreto nuevo: la llave del «LLM propio» de ElevenLabs se deriva de él. Recomendado: **un secreto distinto por servicio** (AU-RA y Electrum), así una sesión de una plataforma ni siquiera verifica en la otra (refuerza el 0.6) |
| `ELEVENLABS_API_KEY` / `XI_API_KEY` | ElevenLabs → Developers → API Keys | Los ids de agente y de voz no son secretos |
| `GENESIS_API_KEY`, `GENESIS_API_KEY_AURA` | Panel de Genesis | Probar «Entrar con Genesis ID» |
| `ULTRON_MESA_CLAVE`, `ELECTRUM_CLAVE` | Render | Avisar a quien enseña la demo de Electrum |
| `TELEGRAM_BOT_TOKEN`, `ELECTRUM_BOT_TOKEN` | @BotFather → `/revoke` | El webhook se registra al arrancar |
| `TELEGRAM_WEBHOOK_SECRET`, `ELECTRUM_WEBHOOK_SECRET` | Render | Se re-registra el webhook al arrancar con el nuevo |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (S3) | IAM: crear la nueva, ponerla en Render, borrar la vieja | Política mínima: solo el bucket de memoria/expedientes |
| `ELECTRUM_DB_URL`, `CUENTAS_DB_URL` | `ALTER ROLE … PASSWORD` en Postgres + Render | |
| `GEMINI_API_KEY`, `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`, `RESEND_API_KEY`, `TWILIO_*`, `DOCLING_API_KEY`, `EMBED_API_KEY`, `MODELO_CHICO_API_KEY`, `ULTRON_LAYA_CLAVE`, `VOICEBOX_CLAVE`, `T4_TOKEN`, `CAMPANA_IMAP_CLAVE`, `MCP_TOKEN`, `AUDITORIA_SECRETO`, `EVAL_LLAVE` | Panel de cada proveedor / `.env` de la T4 + Render | Los servicios de la T4 detrás de Caddy exigen además el portador `T4_TOKEN` |
| `EJECUTOR_SECRETO` (nuevo, 0.5) | Host del sandbox + Render | Crear, no rotar |

Después de rotar: revisar que nada quedó en logs de Render (los registros no imprimen llaves, pero un
error viejo podría) y borrar las llaves viejas, no solo dejar de usarlas.

---

## 0.10 — El ojo por HTTP y el TLS sin verificar hacia el nodo

**Verificado (documentar, no tocar los nodos):**

1. **Ojo en http plano.** `ULTRON_OJO_URL=http://<ip-ojo>:8787` (así venía en `.env.example`).
   `lib/vision.ts:55` (`/ver`) y `capturaPagina` (`/mirar`, `/foto`) mandan por ahí la clave
   `X-Ojo-Clave`, las fotos que manda la gente (mesa, documentos, PDF) y lo que devuelve el ojo.
   Riesgo: cualquiera en el camino (o con una IP de Render compartida) lee la clave y las imágenes y
   puede cambiar la respuesta («lo que se ve») que luego lee el cerebro. Con la clave, usa el ojo
   (Playwright abre URLs: es un navegador remoto a su servicio).
   *Fuga menor tapada en `a2fc660`:* `/api/vision/analyze` (que contesta sin sesión) devolvía en
   `via` la URL del ojo (`http://<ip-ojo>:8787/ver`); ahora dice «el ojo del nodo de visión», como ya
   hacía Dr Electrum (prueba con un ojo falso en `tests/fase0-servidor.test.ts`).
2. **`ULTRON_NODO_INSECURE_TLS=1`** (`lib/nodo.ts:13-16`): hacia el nodo Qwen se usa
   `rejectUnauthorized: false` (solo para ese host, no global). Hay cifrado pero **no hay
   autenticación del servidor**: un intermediario puede hacerse pasar por el nodo, quedarse con
   `x-ultron-secreto` (`ULTRON_NODO_SECRETO`) en la primera llamada, leer cada prompt (memoria,
   perfil, documentos de la junta) y contestar lo que quiera en boca de AU-RA.

**Propuesta concreta (en orden de esfuerzo):**

- **A. Fijar el certificado del nodo (sin tocar el nodo).** El motor ya sirve TLS con
  `/etc/ultron-motor/cert.pem`. Copiar ese certificado (es público) a Render como archivo secreto
  (`/etc/secrets/nodo-ca.pem`, igual que ya se hace con `electrum-db-ca.pem` para Postgres) y, en
  `lib/nodo.ts`, cambiar el dispatcher a `new UndiciAgent({ connect: { ca: fs.readFileSync(process.env.ULTRON_NODO_CA) } })`
  cuando `ULTRON_NODO_CA` esté puesto, y borrar `ULTRON_NODO_INSECURE_TLS`. Requisito: que el
  certificado lleve en el SAN la IP o el nombre con que se llama (`IP:<ip-qwen>` o
  `DNS:<ip-qwen-con-guiones>.sslip.io`); si no, regenerarlo una vez con ese SAN (eso sí es tocar el
  nodo). Es un cambio de ~5 líneas que puedo dejar hecho en otra tanda.
- **B. Certificado de verdad con sslip.io + Let's Encrypt.** Poner Caddy delante del motor y del ojo
  en sus nodos, como ya está en la T4 (`infra/t4/Caddyfile`): `https://<ip-qwen-con-guiones>.sslip.io`
  → motor en `127.0.0.1:8443`; `https://<ip-ojo-con-guiones>.sslip.io` → ojo en `127.0.0.1:8787`.
  Cerrar 8443/8787 al mundo (solo 443, y por security group solo la salida de Render). Luego en Render:
  `ULTRON_NODO_URL=https://<ip-qwen-con-guiones>.sslip.io`, `ULTRON_OJO_URL=https://<ip-ojo-con-guiones>.sslip.io`,
  quitar `ULTRON_NODO_INSECURE_TLS`, y **rotar** `ULTRON_NODO_SECRETO` y `ULTRON_OJO_CLAVE` (las
  viejas viajaron sin autenticar / en claro). Ojo: sslip.io depende de la IP; con IP elástica no
  cambia.
- **C.** En cualquiera de los dos: que el código se niegue a mandar `X-Ojo-Clave` a un `http://` que
  no sea local (como ya hace `lib/laya.ts` con Laya) una vez el ojo esté en https.

---

## Para José

**Antes o junto con el despliegue de esta rama**
1. Render, AU-RA (`aura-fp` / `ultron-looi-desk`): confirmar `NODE_ENV=production` (ahora sin ella el
   servidor igual se porta como producción, pero así queda explícito) y que **no** haya `AURA_DEV`.
2. Confirmar que `ULTRON_SESION_SECRETO` está fijo en Render: con él, el token del teléfono no muere
   en un redespliegue, que era el motivo de dejar `/api/turno` abierto (decisión del 19-sep). Ahora un
   turno sin sesión da 401; el teléfono renueva solo con la clave guardada.
3. Comportamiento nuevo que se nota: la web sin sesión ya no conversa (abre «Entrar»; la voz, el oído
   y la foto siguen). Si se quiere una demo pública de AU-RA, que sea con una cuenta o con
   `ULTRON_MESA_CLAVE` en un aparato concreto, no abierta.
4. Render: el comando de arranque debe ser `npm start` (o `node build-server/server.cjs`), por el 0.1.

**Variables nuevas**
- `EJECUTOR_SECRETO` (0.5): solo si hay `EJECUTOR_URL`; pasos arriba.
- `AURA_DEV=1`: solo en tu máquina (ya lo pone `npm run dev`). Nunca en Render.

**Rotación:** la tabla del 0.9, empezando por la prioridad 1 (llave de Render y llave de AWS del
historial, clave del ojo).

**Pendiente de decidir:** el TLS hacia el nodo y el ojo (0.10, propuesta A o B); si oír, ver y la voz
deben seguir abiertos sin sesión (hoy no despiertan al 27B pero gastan ElevenLabs/Gemini/el ojo con
límite por IP); si un miembro que entró por Genesis debe perder la mesa cuando se cierre
`AURA_GENESIS_ABIERTO` (hoy su sesión vale hasta vencer, 14 días).

---

## Cómo se probó

Antes de cada commit: `npx tsc --noEmit` limpio y las suites tocadas y relacionadas con
`npx tsx --test tests/<archivo>.test.ts`.

Pruebas nuevas o cambiadas (último pase, en el commit final):

```
tests/fase0-entorno.test.ts     # pass 5   # fail 0
tests/fase0-servidor.test.ts    # pass 6   # fail 0   (server.ts real, sin NODE_ENV)
tests/fase0-ejemplos.test.ts    # pass 2   # fail 0
tests/ejecutor.test.ts          # pass 10  # fail 0
server/seguridad.test.ts        # pass 6   # fail 0
tests/electrum-laya.test.ts     # pass 19  # fail 0
tests/mcp-oauth.test.ts         # pass 7   # fail 0
```

### Suite completa

`npm run build` y luego `npm test` (todas las suites, `--test-concurrency=1`), sobre el código final:

```
# tests 1348
# suites 29
# pass 1291
# fail 0
# skipped 57     (las que piden una base Postgres de pruebas o claves externas; mismas 57 que antes)
# duration_ms 311864
```

Notas honestas sobre las corridas:
- Una corrida anterior del mismo código dio 4 fallos que no son de esta rama: (1) `aura-app-extremo`
  «la llamada del avatar» depende de la hora (corrió a las 23:53 de Honduras y el texto dijo «mañana a
  las 12:03 a. m.»; sola, a otra hora, pasa 23/23); (2) `sesiones-seguras` usa los puertos fijos 7812 y
  7813, y en la máquina había un servidor huérfano de OTRA sesión escuchando en 7813 (de
  `/home/user/ULTRON-APP`, padre ya muerto): el «reinicio» de la prueba hablaba con ese servidor. Con
  una copia temporal de la prueba en otro puerto, pasa 11/11. Ese huérfano puede volver a
  enmascarar o romper esa prueba mientras siga vivo.
- La corrida de la suite completa sobre `060d102` (solo 0.2) también dio 0 fallos (1340 pruebas).
