# Entrar a AU-RA con Veta Wallet y Genesis ID

Cualquier persona con su **Veta Wallet** (la app Orden Global, o la web de Veta Wallet) y su
**Genesis ID verificado** entra a AU-RA sin contraseña. Si está en el padrón entra como siempre; si
no, entra como **miembro** de la comunidad (nunca como junta) y se le abre su cuenta de miembro la
primera vez. Si tiene la wallet pero no Genesis ID, la wallet la lleva a sacarlo y **al terminar la
devuelve sola a AU-RA** con la entrada completa.

El servidor de AU-RA nunca ve la contraseña de la wallet, la frase semilla ni los fondos: recibe un
**pase** de Genesis ID que la persona autoriza en su wallet. Desde el 5-oct también se entra **con el
correo y la contraseña de Veta Wallet** dentro de la app (caso e: el teléfono habla directo con la wallet)
y, **sin Genesis ID**, como miembro con la sola cuenta de la wallet (caso f).

## Las piezas y dónde vive cada una

| Pieza | Repositorio y archivo | Despliegue |
|---|---|---|
| App AU-RA (botón, reto, vuelta, pantallas, correo y contraseña de la wallet) | ULTRON-APP · `mobile/src/lib/{genesis,entrarConClave}.ts`, `mobile/src/app/pantallas/{Entrar,CrearGenesis,Intro}.tsx` | APK / OTA de AU-RA FP |
| Servidor AU-RA (canje del pase, cuenta de miembro, entrada sin Genesis) | ULTRON-APP · `server/genesis.ts`, `server/veta-entrar.ts`, `server/cuentas.ts`, `server.ts` | aura-fp.onrender.com |
| Vuelta por https (App Link) | ULTRON-APP · `server/enlaces-app.ts` (`/sso`, `/.well-known/assetlinks.json`) | aura-fp.onrender.com |
| App Orden Global (consentimiento, alta de Genesis ID) | express-js-on-vercel · `orden-global-app/src/screens/PaseAura.js`, `src/auraSso.js`, `src/screens/Onboard.js` (Kyc) | APK `com.ordenglobal.app` |
| Web de Veta Wallet (`#sso-aura`) | express-js-on-vercel · `apps-web/veta-wallet/app.js` | app.vetawallet.com |
| Backend de la wallet (`POST /auth/login`, `POST /genesis/sso/token`, `GET /users/userDate`) | express-js-on-vercel · `infra/veta-wallet-backend/lib/genesisPuente.js` (copia vieja: veta-wallet-backend- · `lib/genesisPuente.js`) | Heroku `vetawallet-…` |
| Genesis ID (`/api/v1/sso/token`, `/api/v1/sso/verificar`) | express-js-on-vercel · `genesis-id/` | genesis-id.onrender.com |

> El repo `Ordenglobalfinale` (`apps/veta-wallet-mobile`) **no** es esta wallet: es otra app
> (`com.ordenglobal.vetawallet`, contra `api.genesisid.online`) y no tiene nada del SSO de AU-RA.

## El viaje, salto por salto

1. **AU-RA (teléfono)** — la persona toca «Entrar con Genesis ID». El teléfono inventa un
   `verificador` al azar (32 bytes) y manda solo su huella SHA-256 (`reto`, como PKCE) y un `estado`
   al azar. Guarda `{verificador, estado}` en SecureStore por **30 minutos** (lo mismo que la wallet
   guarda el pedido).
2. **AU-RA → wallet** — abre
   `vetawallet://sso?destino=aura&reto=…&estado=…&vuelta=https://aura-fp.onrender.com/sso`
   (en iOS, sin `vuelta`: vuelve a `ultronfp://sso`). Si la app no está instalada, ver caso (c).
3. **Wallet (PaseAura)** — sin sesión, el enlace espera a que la persona entre. Con sesión, enseña
   «AU-RA quiere usar tu Genesis ID» y qué se comparte (nombre, cumpleaños sin año, correo, chat).
   Nada se acuña sin «Permitir». `vuelta` solo puede ser una de la lista cerrada
   (`ultronfp://sso`, `https://aura-fp.onrender.com/sso`).
4. **Wallet → backend de la wallet** — `POST /genesis/sso/token` con
   `{ aud: ['aura','pulse2chat'], reto }` y el Bearer de la sesión de la wallet. El backend busca la
   identidad por el correo de la sesión y pide el pase a Genesis con su `X-API-Key` (que nunca baja
   al teléfono).
5. **Backend → Genesis ID** — `POST /api/v1/sso/token {gid, cuenta, aud, reto}`. Genesis exige
   identidad verificada, cuenta vinculada y, para `aura`/`pulse2chat`, **reto obligatorio**.
   Devuelve un pase corto, de un uso por app.
6. **Wallet → AU-RA** — abre `https://aura-fp.onrender.com/sso?pase=…&estado=…` (App Link: Android
   solo se lo da a la APK firmada de AU-RA) o `ultronfp://sso?…`. Si el App Link no está
   verificado, la página `/sso` del servidor ofrece volver con un `intent://` atado al paquete.
   Con error: `?error=<código>&estado=…`.
7. **AU-RA (teléfono)** — acepta la vuelta solo si el `estado` es el del pedido guardado. Manda
   `POST /api/genesis/entrar { pase, verificador }`.
8. **Servidor AU-RA → Genesis ID** — `POST /api/v1/sso/verificar { token, verificador }` con la clave
   de la app `aura`. Genesis comprueba el reto contra el verificador y gasta el pase. El servidor
   exige además `aud` con `aura`, perfil y correo presentes (si no, es la clave mal configurada:
   503), y `perfil.verificada === true` (una identidad bloqueada sale como no verificada).
9. **Servidor AU-RA decide** (`server/genesis.ts`):
   - cuenta suspendida → 403 `SUSPENDIDA`;
   - en el padrón con acceso a AU-RA → sesión como siempre (junta o aprobado);
   - fuera del padrón → sesión de **miembro** (marca `comunidad` firmada en el token, rol
     «Miembro · Genesis ID», cerebro público, sin taller ni Telegram de la organización) y cuenta de
     miembro (`cuentas.cuenta` con `acceso = {}`, el nombre de Genesis y `aprobada_por =
     genesis:<GID>`); su perfil nace con el nombre completo, el cumpleaños y el apodo del primer
     nombre;
   - el padrón lo conoce pero sin AU-RA (p. ej. solo Dr Electrum) → 403 `PENDIENTE` y solicitud
     para aprobar: una sesión de miembro no le abriría la mesa (`sesionAbreAura`);
   - con `AURA_GENESIS_ABIERTO=0`, fuera del padrón solo queda la solicitud (la puerta cerrada de
     antes).
10. **AU-RA (teléfono)** — guarda el token, canjea el mismo pase en el chat (PULSE2CHAT, por su
    lado y una vez) y sigue a la primera vez (perfil, apodo, avatar) o a la mesa.

## Qué pasa en cada caso

### (a) Tiene wallet y Genesis ID

Toca «Entrar con Genesis ID» → «Permitir» en la wallet → vuelve a AU-RA y entra. Si está en el
padrón, con su nivel de siempre; si no, como miembro. Ya no se queda en «Tu acceso está en
revisión».

### (b) Tiene wallet pero no Genesis ID

1. En la wallet, el pase falla con `GID_SIN_IDENTIDAD`. PaseAura no lo devuelve con las manos
   vacías: ofrece «Sacar mi Genesis ID» y **guarda el pedido de AU-RA (mismo reto y estado) 30
   minutos**.
2. La persona hace el trámite (datos, documento, selfie) en la pantalla de verificación de la
   wallet, con el aviso «Volver a AU-RA» siempre a mano.
3. Al terminar:
   - **verificada al momento** → la wallet sigue al «Permitir» con el mismo pedido → vuelve a AU-RA
     con el pase → AU-RA entra sola (a);
   - **en revisión** (lo normal: la aprueba una persona) → vuelve sola a AU-RA con
     `gid-pendiente` → tarjeta «Tu Genesis ID está en verificación; cuando lo aprueben, entras con
     este mismo botón» (no ofrece crear otro).
4. En AU-RA la vuelta se atiende aunque llegue tarde:
   - AU-RA abierta en «Entrar» (o con «Crea tu Genesis ID» encima): `escucharVueltaTardia`;
   - AU-RA cerrada por Android mientras tanto: arranque en frío, `retomarSiVolvio` (el pedido
     guardado vive 30 minutos);
   - si la persona vuelve a AU-RA a mano a mitad del trámite, el pedido **no se borra**: cuando la
     wallet termine y vuelva, entra igual. La tarjeta dice «Si estás creando tu Genesis ID en la
     wallet, termina allá: al terminar te trae de vuelta».
5. Si la wallet contesta `sin-gid` (la persona tocó «Ahora no»), AU-RA abre «Crea tu Genesis ID».
   Ahí el botón principal **«Crear mi Genesis ID»** vuelve a pedir el pase por la wallet (así la
   wallet guarda el pedido y la devuelve sola); «Ya tengo mi Genesis ID» hace lo mismo.

### (c) No tiene la wallet instalada

`vetawallet://` no abre nada → `SIN_WALLET`. AU-RA ya no salta sola a una pestaña web: muestra
«No encontramos tu wallet» con:

- **Instalar Orden Global** → Google Play (`market://details?id=com.ordenglobal.app`, o la página
  web de la tienda);
- **Usar Veta Wallet en la web** → la web (`https://app.vetawallet.com/#sso-aura`) en una pestaña
  segura, con el mismo reto y la misma vuelta;
- **Entrar con mi correo** → «Otras formas de entrar» (correo y clave).

Instalada la app, «Intentar de nuevo» sigue como (a) o (b).

### (d) Cuenta nueva que nunca entró a AU-RA

Si su correo de Genesis no está en el padrón: entra como miembro en el primer intento. El servidor
abre su cuenta de miembro (sin acceso en el padrón: sigue siendo miembro aunque se recargue el
padrón) y su perfil con el nombre de Genesis y el apodo del primer nombre; la app la lleva a la
primera vez (apodo, avatar, tema). Las dos escrituras (Postgres y S3) tienen un tope de 1,5 s
para no hacer esperar: si tardan, entra igual y terminan en segundo plano; si fallan, entra igual.
José la puede suspender poniendo `estado = 'suspendida'` en `cuentas.cuenta`: desde ahí la
entrada con Genesis le contesta `SUSPENDIDA`.

### (e) Con su correo y su contraseña de Veta Wallet, sin la app

José, 5-oct, después de probarlo con otra gente: «el log in con veta wallet no deja a otros usuarios,
necesito puedan poner su contraseña y entrar bien como en vetawallet.com». Quien no tenía la app Orden
Global se quedaba entre pestañas. Ahora lo primero de «Entrar» es **«Entrar con tu cuenta de Veta
Wallet»**: correo y contraseña (con el ojito, autocompletar `email`/`password`, «ir» en el teclado),
«¿Olvidaste tu contraseña?» y «¿No tienes cuenta? Créala en Veta Wallet». «Abrir mi wallet» (casos a–c)
queda debajo como alternativa.

Todo lo hace **el teléfono contra el backend de la wallet** (`mobile/src/lib/entrarConClave.ts`, lógica
pura; `entrarConVetaWallet` en `genesis.ts`), igual que la web de la wallet en `#sso-aura`:

1. `nuevoReto()` de siempre (verificador + huella);
2. `POST {WALLET_API}/auth/login {email, password}` → `{token, refreshToken, user}`;
3. `POST {WALLET_API}/genesis/sso/token {aud:['aura','pulse2chat'], reto}` con `Bearer <token>` →
   `{token: <pase>}`. Si contesta `CUENTA_NO_VINCULADA`, se ata (`POST /genesis/vincular`) y se pide UNA vez
   más, como la web;
4. el pase sigue por **el mismo canje** que la vuelta (`canjearPase` → `POST /api/genesis/entrar {pase,
   verificador}`, chat, primera vez o mesa).

- **La contraseña** va del teléfono a la wallet y a nadie más: nunca al servidor de AU-RA, nunca a un
  registro ni a SecureStore; la pantalla la borra de su estado al terminar (también si falló).
- **El token de la wallet** se usa y se suelta. **No** se llama a `/auth/logout`: sube la versión de sesión
  y cerraría TODAS las sesiones de la persona en la wallet. Vence solo (40 min).
- `WALLET_API`: `extra.walletApi` si existe; si no, `https://vetawallet-1a2e38ac52b1.herokuapp.com`. No se
  añadió a `app.config.js` a propósito: `extra` entra en la huella (`runtimeVersion: fingerprint`) y la OTA
  dejaría de llegar a las APK instaladas.
- Tope de 15 s por llamada. Mensajes: 401/400 → «Correo o contraseña incorrectos»; 429 (la wallet: 20 cada
  15 min por IP, contando juntos login y recuperación) → «Demasiados intentos; espera 15 minutos»;
  `CORREO_NO_VERIFICADO` → «Confirma tu correo en Veta Wallet»; sin red / tope → «No pude comunicarme con
  Veta Wallet» / «tardó demasiado». Los códigos del puente se traducen con la misma tabla que la web de la
  wallet (`codigoAura`) y caen en los tratos de siempre (`errorDeWallet`): sin Genesis ID → «Crea tu Genesis
  ID», en revisión → su tarjeta… cuando el caso (f) está cerrado; con (f) abierto, entra igual.
- «¿Olvidaste tu contraseña?»: con el correo escrito, `POST {WALLET_API}/auth/recuperarPassword {email}` (lo
  mismo que la web; contesta igual exista o no la cuenta) y la tarjeta «Revisa tu correo». Sin correo, o si
  la wallet no contesta, abre `https://app.vetawallet.com` (sin sesión, su puerta es el login con «¿Olvidaste
  tu contraseña?»). La web de la wallet no tiene una dirección propia para la recuperación (`#recuperar` o
  similar): si se le añade, el enlace puede ir directo.
- «¿No tienes cuenta?»: la web de la wallet con el pedido de AU-RA (`#sso-aura`, caso c): ahí se crea la
  cuenta y vuelve sola.
- Si la persona es **administradora** de la wallet, entrar así reemplaza su sesión de administración en la
  wallet (`isAdmin.js` guarda UNA sesión por administrador; pasa igual al entrar en la web).

**La web de AU-RA (navegador) NO puede hacer esto todavía**: el backend de la wallet solo deja llamarse
desde `www.vetawallet.com`, `vetawallet.com` y `app.vetawallet.com` (`allowedOrigins` en
`infra/veta-wallet-backend/app.js`, ~línea 78), y `https://aura-fp.onrender.com` no está. El teléfono no
tiene ese problema (una app no manda `Origin`). La web sigue con la vuelta por la wallet (casos a–c) hasta
que se añada ese origen en el backend de la wallet (otro repositorio, otro despliegue).

### (f) Solo con Veta Wallet, sin Genesis ID

José, 5-oct: «Que entren solo con Veta Wallet, sin Genesis ID». Después del login del caso (e), el teléfono
**intenta primero el pase de Genesis** (si sale, todo como siempre: conserva los niveles del padrón). Si no
sale porque no tiene Genesis ID (`GID_SIN_IDENTIDAD`), lo tiene en revisión (`GID_PENDIENTE`), no confirmó su
correo (`CORREO_NO_VERIFICADO`), la cuenta sigue sin atar después de atarla, o el pase no está disponible
(404, 5xx, `GENESIS_RED`, sin red), **no se detiene**: manda el token de acceso de la wallet UNA vez a
`POST /api/veta/entrar {token}` (con las cabeceras de aparato de siempre, por `api()`). Nunca la contraseña.
Una clave mala, el freno de la wallet, una identidad rechazada o bloqueada (`GID_NO_DISPONIBLE`) o de otra
persona (`GID_AJENO`, `CUENTA_NO_ATADA`) **no** pasan por aquí desde la app. Ojo (revisión de seguridad del 5-oct):
eso lo filtra la APP; el servidor no consulta Genesis por correo, así que quien llame a `/api/veta/entrar` directo
con un token auténtico de la wallet entra como miembro aunque su Genesis ID esté rechazado. Lo que sí impone el
servidor: el bloqueo de la propia wallet (403 de `/users/userDate`), las suspensiones de AU-RA por la identidad
`veta:` **y por el correo de la wallet** (quien suspendieron por su cuenta de correo o de Genesis no entra por aquí),
`AURA_VETA_ABIERTO`, y los topes:
- por conexión (IPv4, o IPv6 por /64) y por dirección;
- a lo más 4 preguntas a la wallet a la vez, con una cola corta (más allá, 503 «ocupada»);
- un token que la wallet rechazó no se le vuelve a preguntar en 10 minutos (por su huella);
- un 429 de la wallet se dice «ocupada», no «vuelve a entrar».

El servidor (`server/veta-entrar.ts`, montado en `server.ts` junto a Genesis):

1. `GET {AURA_WALLET_API}/users/userDate` con `Authorization: Bearer <token>` (10 s). La wallet comprueba la
   firma, que la cuenta exista y no esté borrada, la versión de sesión (revocación), que la dirección del
   token sea la de la cuenta y que Genesis no la tenga bloqueada. Solo un 200 con correo cuenta;
2. lee la carga del JWT sin comprobar la firma (la acaba de comprobar la wallet): `address` y `verify`;
3. **suelta el token**: no se guarda, no se registra (ni recortado), no se reenvía, no hay `/auth/logout`;
4. abre una sesión de **miembro** como la de Genesis abierto (comunidad, cerebro público, sin taller ni
   Telegram de la organización), con rol **«Miembro · Veta Wallet»** e identidad **`veta:<dirección>`** —la
   dirección EVM en minúsculas—, **nunca el correo**: el correo de una wallet puede estar sin confirmar, y con
   él cualquiera se quedaría con la cuenta de AU-RA de otra persona. Por eso **nunca** da nivel de junta ni
   del padrón aunque el correo coincida (la junta entra con «correo y clave» o con Genesis ID). La cuenta de
   miembro (`cuentas.cuenta`, `correo = veta:…`, `aprobada_por = veta:…`) y el perfil (solo el apodo: el
   nombre de la wallet no está verificado y no sale como «Genesis compartió contigo») se abren con el mismo
   tope de 1,5 s;
5. topes: 10 cada 15 min por conexión y 10 cada 15 min por dirección (contado después de que la wallet
   confirme el token: antes, cualquiera podría agotarle el cupo a otra dirección con un token inventado).
   Suspendida (`estado = 'suspendida'` en `cuentas.cuenta` para `veta:…`) → 403 `SUSPENDIDA`;
   `AURA_VETA_ABIERTO=0` → 403 `VETA_CERRADO` (y la app dice lo de Genesis, como antes); la wallet con 401 →
   401 `TOKEN_INVALIDO`; con 403 → `BLOQUEADA`; caída → 503 `WALLET_CAIDA`.

El chat PULSE2CHAT **no** se conecta por aquí (su alta pide un pase de Genesis ID): la app entra igual, sin
decir nada roto, y la pantalla de chats ofrece conectarlo después. Lo que hoy se ata a un correo (la
iniciativa de «personas recientes», borradores de correo/WhatsApp del dueño) no aplica a estas sesiones.

**Nota de seguridad.** AU-RA ve el token de acceso de la wallet durante UNA llamada y lo descarta. Con ese
token, durante sus 40 minutos, se puede operar la wallet de la persona; por eso no se guarda ni se registra.
El arreglo limpio es un **pase de la wallet con destino AU-RA**: un endpoint pequeño en el backend de la
wallet que firme `{address, email, aud:'aura', reto, exp}` con un secreto compartido con AU-RA (o con su
clave privada), para que AU-RA nunca vea un token que abre la wallet. No se hizo porque desplegar el backend
de la wallet necesita a José: la app de Heroku `vetawallet` corre un commit que no está en
`express-js-on-vercel`, así que no está claro cuál es la fuente de verdad.

### (g) Pase vencido, gastado o reto malo

Nada de esto cambió con la puerta abierta:

| Qué | Quién lo frena | Qué ve la persona |
|---|---|---|
| Vuelta con otro `estado` | el teléfono | se ignora; la espera sigue |
| Pase gastado (`USADO`), vencido, de otra app (`OTRA_APP`) | Genesis → 401 | «El pase no es válido o ya se usó. Vuelve a tocar «Entrar con Genesis ID».» |
| Verificador que no es el del reto (`RETO`), o pase de aura sin reto | Genesis → 401 | igual que arriba |
| Pase sin `aud` o sin `aura` | servidor AU-RA → 401 | igual que arriba |
| Sin verificador | servidor AU-RA → 400 (ni pregunta a Genesis) | «Falta el pase de Genesis ID.» |
| Identidad sin verificar o bloqueada | servidor AU-RA → 401 `SIN_VERIFICAR` | tarjeta «Tu Genesis ID está en verificación» |
| Genesis caído / clave de AU-RA sin `gid.perfil` o `gid.correo` | servidor AU-RA → 503 | «Genesis ID no respondió» (culpa nuestra, se registra) |
| Demasiados intentos | servidor (12 cada 15 min) / wallet | «Demasiados intentos» |

En ninguno de estos casos se abre sesión ni cuenta de miembro.

## Variables de entorno

| Variable | Dónde | Para qué |
|---|---|---|
| `GENESIS_API_KEY_AURA` (o `GENESIS_API_KEY`) | aura-fp | Clave de la app `aura` en Genesis, con alcances `gid.perfil`, `gid.correo` (y `gid.cumple` para el cumpleaños). Sin ella, el botón dice que no está configurado. |
| `GENESIS_URL` | aura-fp | Por omisión `https://genesis-id.onrender.com`. |
| `AURA_GENESIS_ABIERTO` | aura-fp | **Nuevo comportamiento por omisión: abierto.** `0` / `false` / `no` vuelve a la puerta cerrada (solo padrón + solicitud). `1` sigue valiendo. |
| `CUENTAS_DB_URL` (o la cognitiva / Electrum) | aura-fp | Base donde se abre la cuenta de miembro. Sin base, el miembro entra igual (sin fila). |
| `AURA_WALLET_WEB` | aura-fp | Web de la wallet (por omisión `https://app.vetawallet.com`). |
| `ANDROID_CERT_SHA256` | aura-fp | Huella del certificado de la APK para el App Link de la vuelta https. |
| `AURA_WALLET_API` | aura-fp | Backend de Veta Wallet al que se le pregunta si un token vale (`/users/userDate`, caso f). Por omisión `https://vetawallet-1a2e38ac52b1.herokuapp.com`. |
| `AURA_VETA_ABIERTO` | aura-fp | Entrada solo con Veta Wallet, sin Genesis ID (caso f). **Abierta por omisión**; `0` / `false` / `no` la cierra. |
| `GENESIS_API_KEY` | backend de la wallet | Clave de la app de la wallet en Genesis. |

## Pruebas

- Servidor: `npx tsx --test tests/genesis-entrar.test.ts` (puerta abierta por omisión, miembro con
  cuenta y apodo, padrón, apartado del padrón, suspendida, `AURA_GENESIS_ABIERTO=0`, pase gastado /
  de otra app / sin reto / sin verificar, topes) y `tests/cuentas.test.ts` (la cuenta de miembro
  contra Postgres de verdad; se salta sin base).
- Servidor, caso f: `npx tsx --test tests/veta-entrar.test.ts` (token auténtico → miembro `veta:<dirección>`;
  401 de la wallet; correo del padrón por aquí sigue miembro; el token no sale en la consola ni en lo
  guardado; `AURA_VETA_ABIERTO=0`; suspendida, bloqueada, wallet caída; topes por conexión y por dirección).
- App: `mobile/pruebas/chat/todas.sh` — `vuelta.cjs` (casos b y c, vuelta tardía, arranque en
  frío con un pedido de 25 minutos), `sso.cjs` y `clave.cjs` (casos e y f por el `genesis.ts` real: login,
  pase, canje de siempre; sin Genesis ID el token va una vez a `/api/veta/entrar`; la contraseña nunca llega
  a AU-RA). Y `npx tsx src/lib/pruebas/entrarConClave.prueba.mjs` (la lógica pura con un fetch de mentira:
  401, 429, sin Genesis, correo sin confirmar, sin atar, red, tope de 15 s, recuperación).
- Wallet: `orden-global-app/pruebas/probar-aura-sso.cjs` y
  `apps-web/veta-wallet/pruebas/sso-aura-*.mjs` (express-js-on-vercel).
