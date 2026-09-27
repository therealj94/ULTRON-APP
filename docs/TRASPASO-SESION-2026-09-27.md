# Traspaso a una sesión nueva — 27-09-2026

Pegá en la sesión nueva la sección **«Prompt para la sesión nueva»** (al final). Todo lo de arriba es
el contexto que ese prompt resume. No hay claves en este archivo.

---

## 0. Antes de abrir la sesión nueva (lo hace José)

1. **AWS**: la clave que tenía esta sesión dejó de valer (`InvalidClientTokenId`). Cargá la nueva en
   las variables del entorno de Claude Code (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
   `AWS_REGION=us-east-1`).
   - Si rotaste la del usuario IAM `jose`, revisá también Render: `aura-fp` y `ultron-looi-desk`
     tienen `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (memoria S3 de AU-RA). Si era la misma
     clave, actualizala ahí también o AU-RA pierde la memoria.
2. **Render**: `RENDER_API_KEY` en el entorno (la actual funciona).
3. **Repos en la sesión**: `therealj94/ULTRON-APP`, `therealj94/express-js-on-vercel` y
   **`therealj94/veta-wallet-backend-`** (esta sesión no pudo agregarlo: el sistema lo bloqueó; en la
   nueva, adjuntalo al crearla o autorizalo explícitamente).
4. **ElevenLabs**: quedan 7 créditos. Si querés el spot de Ordenex con voz premium, cargá créditos.

---

## 1. Estado de todo lo que quedó hecho

### Dr Electrum (repo ULTRON-APP, desplegado en Render)
- PR #32 (Laya decide el panel) y **PR #40** (artículo 48, ley ambiental, cargador que acepta inglés,
  documentación) **mergeados** en `main`. Render despliega `main` solo.
- **Laya** en la T4 (`i-02653feadc919d3a4`, 35.175.175.203), servicio `laya-electrum` en `:8792`,
  publicado con TLS por el Caddy de Voicebox: `https://35-175-175-203.sslip.io/laya`.
  - Render (`aura-fp` y `ultron-looi-desk`): `ULTRON_LAYA_URL` y `ULTRON_LAYA_CLAVE` (rotada el 26-09).
  - Prueba apartada: híbrido 76,9 % exacto, tabla 57,3 %.
  - Otra sesión amplió Laya a tres modelos (`electrum`, `mensaje`, `documento`); no pisar su trabajo.
- **Base de Electrum** (Postgres + PostGIS + pgvector) en el nodo del cerebro
  (`i-06530893af0dd0638`, g5.xlarge, 34.207.148.69, IP NO elástica):
  - Render `ultron-looi-desk` la usa con `ELECTRUM_DB_URL` =
    `…@34-207-148-69.sslip.io:5432/electrum?sslmode=verify-full&sslrootcert=/etc/secrets/electrum-db-ca.pem`
    y el archivo secreto `electrum-db-ca.pem` (certificado público del nodo, hasta 2036).
  - `pg_hba`: `hostssl electrum electrum 74.220.48.0/24 scram-sha-256`. SG: 5432 solo desde
    `74.220.48.0/24` (regla `sgr-03db89e3f278f7a21`).
  - Contenido: **92 documentos, 6004 fragmentos (todos con vector), 1079 concesiones, 99 yacimientos
    DEFOMIN**. Incluye Ley de Minería + reforma 109-2019 + reglamentos, Ley del Ambiente, SINEIA,
    Ley de Aguas, Ley Forestal, Convenio 169, estudio JICA-MMAJ Vol. 2-6, informe La Lola.
  - La cadena de conexión completa está en el nodo, en `/root/electrum-db-url` (solo root).
- **Embeddings BGE-M3**: contenedor `embed` en la **GPU del cerebro**, `172.31.23.34:8794` (solo IP
  privada). SG 8794 solo desde la T4 (`172.31.19.170/32`, regla `sgr-0af61442e031b96a4`). Publicado
  con clave por el Caddy de la T4 en `https://35-175-175-203.sslip.io/embed`. Render
  `ultron-looi-desk`: `EMBED_URL` y `EMBED_API_KEY`.
- Documentación al día en `docs/ELECTRUM.md` y `docs/NODO-T4.md`.

### Sitio ordenglobal.org (repo express-js-on-vercel)
- Portada nueva (rama `claude/ordenglobal-improvements-h4v9tx`, commit `7215d0d7`) **publicada** en
  Amplify (`d2rweubccyt73x`, rama `main`) y verificada en vivo en español e inglés: logo animado,
  precio ORIGEN, último bloque, videos 200, sin errores de consola. Caché de una semana en
  `/assets/*.svg` y `/assets/medios/**`, CSP igual.
- Vuelta atrás: desplegar el commit anterior de la misma rama con `desplegar.py`.

### Otros
- Subida de documentos a Electrum: página `subir-expedientes.html` (vence 02-10-2026), sube a
  `s3://electrum-expedientes-548380372606/entrada/`.
- Pedido de cupo de IPs elásticas a 15 en us-east-1: **PENDING** (id
  `6885d1beb1334f4b8e7b074bc5e2efc7uQaeS3GQ`). Las 10 IPs actuales están en uso (6 instancias,
  4 de balanceadores `ogb-testnet-rpc` y `OrdenKapital`): no liberar ninguna.

---

## 2. Pendientes, en orden, con lo que hay que hacer

1. **IP elástica para el nodo del cerebro** (cuando AWS apruebe el cupo). Corta Qwen, la base y los
   embeddings unos minutos: avisar antes.
   1. `aws ec2 allocate-address` → IP nueva X.
   2. Regenerar el certificado de Postgres (`/etc/postgresql/16/main/tls/server.crt`, dueño
      postgres, key 600) con SAN para `34-207-148-69.sslip.io`, `X-con-guiones.sslip.io`, las dos IPs
      públicas y `172.31.23.34`; `pg_reload_conf()`; subir el certificado nuevo al archivo secreto
      `electrum-db-ca.pem` de `ultron-looi-desk`.
   3. Asociar X a `i-06530893af0dd0638`.
   4. Render: `ULTRON_NODO_URL` y `QWEN_ENDPOINT_URL` (`https://X:8443`) en **los dos** servicios;
      `ELECTRUM_DB_URL` con host `X-con-guiones.sslip.io` en `ultron-looi-desk` (traer la URL del nodo
      cifrada, nunca mostrarla). Redesplegar ambos.
   5. Verificar: `GET https://aura-fp.onrender.com/api/nodo/listo` y un job de Render en
      `ultron-looi-desk` que cuente concesiones con esa URL.
   6. Actualizar las referencias a 34.207.148.69 en el repo (`.env.example`, `AREAS.md`,
      `docs/NODO-T4.md`, `src/10-infra/secretos.ts`, `src/10-infra/README.md`, `docs/ELECTRUM.md`) en un PR.
2. **Veta Wallet** (repo `veta-wallet-backend-`):
   - Las 2 recargas atascadas **nunca llegaron a la cadena**: `0xF549bed434F05A5aEd3d632fcD202A6a5549F30E`
     y `0x53513A256782408373479C0a0Cfd1FCC6462f9fc` tienen nonce 0 y saldo 0 en Polygon, Amoy,
     Ethereum, Base, Arbitrum, BSC y la cadena OG (chainId 5550). Lo pendiente vive en la base del
     backend.
   - Hacer: ubicar en el backend las 2 recargas y la dirección de la tesorería; ver saldo de la
     tesorería (necesita ≥ 207 USD); configurar un RPC de Polygon con historial (p. ej.
     `https://polygon-bor-rpc.publicnode.com` o un proveedor con archivo); reintentar las recargas
     cuando José fondee. **Fondear lo hace José.**
   - Después: **bloques B y C del plan de la tarjeta** (el plan está en ese repo).
3. **Spot de Ordenex en inglés**: borrador en `express-js-on-vercel`, rama `claude/ordenglobal-improvements-h4v9tx`, `sitio-ordenglobal/borradores/` (32 s, voz Kokoro `am_michael`, textos en pantalla en
   inglés con Manrope; el README de esa carpeta explica cómo se hizo). Si José lo
   aprueba: subir `assets/medios/ordenex-spot-en.mp4` (+ póster), en `construir-portada.py` (inglés)
   apuntar el video al `-en` y quitar «in Spanish», reconstruir y desplegar como la portada.
4. **Laya**: 92 consultas nuevas en `scripts/nodo-t4/laya/datos/train_e.jsonl` (rama
   `claude/laya-dr-electrum-3t7z74`, commit `df7ddcf`, **sin PR**). Reentrenado aparte en
   `/opt/laya/modelo-electrum.e`: el geólogo sube en recall (0,83→0,86) pero baja en precisión
   (0,94→0,86) y los saludos cortos caen de 13/13 a 11/13. **No se cambió el modelo.** Siguiente
   intento: sumar saludos y mensajes cortos en inglés («Hi», «Thanks», «ok») y bajar el peso del
   geólogo; reentrenar a otra carpeta, evaluar con `evaluar.py --tabla datos/test-tabla.jsonl
   --bordes datos/bordes-tabla.jsonl`, y solo cambiar si mejora todo. Borrar `/opt/laya/datos-e`
   y `/opt/laya/modelo-electrum.e` si se descarta.
5. **Probar Dr Electrum en la app** con preguntas reales (José o con una sesión de prueba):
   «¿Se puede minar en un área protegida?», «¿Qué encontró JICA en Vueltas del Río?», «¿Qué
   categoría ambiental tiene una mina de oro?», «¿Cuándo vence la concesión Quebrada Seca?» (solo
   Legal Minero).
6. **Al final: rotar claves** de AWS, Render y Heroku (la de AWS ya parece rotada). También rotar la
   de Laya (`/etc/laya-electrum.env` + `ULTRON_LAYA_CLAVE` en Render) y la de embeddings (Caddyfile
   de la T4 + `EMBED_API_KEY`) si se quiere dejar todo limpio.

---

## 3. Cómo trabajar (lecciones de esta sesión)

- Acceso a los nodos: **SSM** (`aws ssm send-command`, documento `AWS-RunShellScript`), sin SSH.
- **Secretos**: nunca imprimirlos. Para traer uno del nodo: generar un par RSA efímero local, mandar
  la pública, el nodo cifra con `openssl pkeyutl` y devuelve base64; descifrar local, usar y borrar.
  Para Render: `PUT /v1/services/{id}/env-vars/{key}` de a una, con `-o /dev/null`.
- El sistema de permisos frena acciones de producción (leer la base, escribir secretos, publicar,
  mergear) si José no las autoriza **explícitamente en su mensaje**. Pedir la autorización con una
  frase concreta y esperar.
- Otra sesión trabaja en la T4 (modelo `chico`, Laya `mensaje`/`documento`): mirar
  `nvidia-smi` y `pgrep -af entrenar.py` antes de usar la GPU.
- OCR: `tesseract` en paralelo con `OMP_THREAD_LIMIT=1` (si no, 13 min por página). Leyes con capa de
  texto: `pdftotext` (el lector del cargador pierde páginas).
- Cargar documentos: túnel SSM al 5432 del cerebro + `npx tsx scripts/electrum/aprender.ts --seco`
  primero, y después sin `--seco`, con `EMBED_URL`/`EMBED_API_KEY` para que indexe los vectores.

---

## Prompt para la sesión nueva

```
Contexto: soy José (Orden Global / Veta Wallet). Vengo de otra sesión; el traspaso completo está en
docs/TRASPASO-SESION-2026-09-27.md (repo ULTRON-APP, rama claude/laya-dr-electrum-3t7z74). Leelo primero.
Revisá que existan las credenciales mirando solo los nombres (env | cut -d= -f1 | grep -iE "aws|render")
y que la de AWS funcione (aws sts get-caller-identity). Nunca muestres valores.

Te autorizo para esta sesión a: usar SSM en la T4 y en el nodo del cerebro, traer secretos cifrados
sin mostrarlos, cargar variables en Render de a una, leer y escribir la base de Electrum por túnel
SSM, y abrir PRs. Mergear y publicar en producción me lo preguntás antes.

Hacé en este orden, verificando cada paso y reportando salidas:
1. Veta Wallet (repo veta-wallet-backend-): encontrá las 2 recargas atascadas y la tesorería,
   decime el saldo y cuánto falta para llegar a 207 USD, dejá configurado un RPC de Polygon con
   historial y el reintento listo para cuando yo fondee. Después leé el plan de la tarjeta y
   proponeme cómo ejecutar los bloques B y C.
2. IP elástica del cerebro: revisá si AWS aprobó el cupo (pedido 6885d1beb1334f4b8e7b074bc5e2efc7uQaeS3GQ);
   si sí, avisame antes del corte y seguí el punto 1 de «Pendientes» del traspaso.
3. Laya: segundo intento de reentrenamiento según el punto 4 del traspaso.
4. Lo que quede, y al final dame la lista para rotar claves.
```
