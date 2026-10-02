# Entrar a AU-RA con Veta Wallet y Genesis ID

Cualquier persona con su **Veta Wallet** (la app Orden Global, o la web de Veta Wallet) y su
**Genesis ID verificado** entra a AU-RA sin contraseña. Si está en el padrón entra como siempre; si
no, entra como **miembro** de la comunidad (nunca como junta) y se le abre su cuenta de miembro la
primera vez. Si tiene la wallet pero no Genesis ID, la wallet la lleva a sacarlo y **al terminar la
devuelve sola a AU-RA** con la entrada completa.

AU-RA nunca ve la contraseña de la wallet, la frase semilla ni los fondos: recibe un **pase** de
Genesis ID que la persona autoriza en su wallet.

## Las piezas y dónde vive cada una

| Pieza | Repositorio y archivo | Despliegue |
|---|---|---|
| App AU-RA (botón, reto, vuelta, pantallas) | ULTRON-APP · `mobile/src/lib/genesis.ts`, `mobile/src/app/pantallas/{Entrar,CrearGenesis,Intro}.tsx` | APK / OTA de AU-RA FP |
| Servidor AU-RA (canje del pase, cuenta de miembro) | ULTRON-APP · `server/genesis.ts`, `server/cuentas.ts`, `server.ts` | aura-fp.onrender.com |
| Vuelta por https (App Link) | ULTRON-APP · `server/enlaces-app.ts` (`/sso`, `/.well-known/assetlinks.json`) | aura-fp.onrender.com |
| App Orden Global (consentimiento, alta de Genesis ID) | express-js-on-vercel · `orden-global-app/src/screens/PaseAura.js`, `src/auraSso.js`, `src/screens/Onboard.js` (Kyc) | APK `com.ordenglobal.app` |
| Web de Veta Wallet (`#sso-aura`) | express-js-on-vercel · `apps-web/veta-wallet/app.js` | app.vetawallet.com |
| Backend de la wallet (`POST /genesis/sso/token`) | express-js-on-vercel · `infra/veta-wallet-backend/lib/genesisPuente.js` (copia vieja: veta-wallet-backend- · `lib/genesisPuente.js`) | Heroku `vetawallet-…` |
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

### (e) Pase vencido, gastado o reto malo

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
| `GENESIS_API_KEY` | backend de la wallet | Clave de la app de la wallet en Genesis. |

## Pruebas

- Servidor: `npx tsx --test tests/genesis-entrar.test.ts` (puerta abierta por omisión, miembro con
  cuenta y apodo, padrón, apartado del padrón, suspendida, `AURA_GENESIS_ABIERTO=0`, pase gastado /
  de otra app / sin reto / sin verificar, topes) y `tests/cuentas.test.ts` (la cuenta de miembro
  contra Postgres de verdad; se salta sin base).
- App: `mobile/pruebas/chat/todas.sh` — `vuelta.cjs` (casos b y c, vuelta tardía, arranque en
  frío con un pedido de 25 minutos) y `sso.cjs`.
- Wallet: `orden-global-app/pruebas/probar-aura-sso.cjs` y
  `apps-web/veta-wallet/pruebas/sso-aura-*.mjs` (express-js-on-vercel).
