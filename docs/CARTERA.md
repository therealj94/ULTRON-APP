# Cartera de Veta Wallet y pagos por PULSE2CHAT en AU-RA

José (2-oct): «Se tiene que poder ver Veta Wallet: los saldos, y poder pagar por PULSE2CHAT. Organizar esto
porque es token, y ORIGEN; la contraseña es igual que Veta Wallet; tienen que estar conectados.»

El modelo es el de AURA para Windows (`windows/centro/src/pulse/pagar.ts`, `windows/centro/src/vistas/cartera.ts`,
`windows/src/Aura.Windows.Core/Cartera.cs`, `windows/src/Aura.Windows/Manos/Cartera.cs`). Los principios no cambian.

## Reglas de seguridad

- **AURA nunca mueve dinero** y nunca pide, ve ni guarda contraseñas o llaves. AU-RA no tiene la sesión de
  la wallet ni la necesita.
- **La cartera solo se lee.** Se usa la dirección **pública** de la persona (0x + 40 hex) contra el RPC público
  de la cadena de Orden Global (`https://rpc.ordenglobal-rpc.com/`, red 5550). Con ella solo se ven saldos.
- **Si no se pudo leer, no se contesta.** Un token que no se pudo leer sale como «no se pudo leer», nunca como
  cero (la misma regla de `veta-wallet-backend/lib/saldos.js`).
- **La dirección de quien recibe sale de su ficha en PULSE2CHAT** (`/ficha` del relevo, campo `addr`). No hay
  dónde escribirla a mano: ahí es donde la gente se equivoca y pierde el dinero. Si la ficha no la tiene, se dice.
- **El pago se firma en Veta Wallet** (la app o la web) con la contraseña de la persona. AU-RA solo abre el
  envío ya llenado; si no se confirma allá, no pasa nada.
- **El comprobante va después del pago, nunca antes.** AU-RA mira la cadena hasta ver la transacción y recién
  entonces llama a `POST /pago` del relevo con el hash; el relevo vuelve a comprobarlo contra la cadena. Un
  mismo hash nunca prueba dos pagos.
- **Por voz, AURA solo prepara.** «Mándale 5 ORIGEN a Ana» abre la hoja de enviar llenada; la persona revisa,
  confirma y firma. No hay camino por el que AURA ejecute un pago.

## Qué hace cada pieza

| Pieza | Dónde | Qué hace |
|---|---|---|
| Lógica pura | `mobile/src/cartera/logica.ts` | Tokens y contratos de la red, precios (como Windows), cantidad (`montoValido`, texto exacto, sin flotantes), dirección, enlaces a la wallet (`enlaceApp`, `enlaceWeb`, `leerEnlacePagar`), lote de saldos, búsqueda del envío en los bloques, comprobación de un comprobante, cómo se dice. Sin React Native: la comparten la app, el servidor y las pruebas. |
| Red (solo lectura) | `mobile/src/cartera/red.ts` | `leerSaldos` (30 s de caché; precios 5 min), `bloqueActual`, `buscarEnvioEnRed` (60 bloques por vuelta; la cadena hace uno cada ~10 s), `verificarComprobante`. Usa el `fetch` global o uno inyectado. |
| Vigía del pago | `mobile/src/cartera/vigia.ts` | Anota el bloque al abrir la wallet, mira la cadena cada 6 s (al volver a AU-RA, ya), publica el comprobante, tope de 15 min (+10 con «seguir mirando»), cancelar, reintentar el comprobante, retomar tras un cierre de Android. Un pago a la vez. |
| Tu cartera conectada | `mobile/src/cartera/conexion.ts` | La dirección propia: la guardada → la de tu ficha de PULSE2CHAT (el chat y la wallet son la misma cuenta) → la del perfil del servidor → pegarla a mano. La sube al perfil (`cartera`) para que AURA la sepa. |
| Estado y apertura | `mobile/src/cartera/estado.ts` | Qué hoja está abierta, el vigía con sus piezas reales (cadena, relevo, llavero) y cómo se abre Veta Wallet (app, o web si no está). |
| Hojas | `mobile/src/cartera/HojaCartera.tsx`, `HojaPagar.tsx`, `HojasCartera.tsx` | «Cartera» y «Enviar dinero», montadas una vez en la raíz (`app/AppAura.tsx`). `HojasCartera` además atiende las manos de voz y retoma pagos. |
| Tarjeta del hilo | `mobile/src/cartera/TarjetaPago.tsx` (desde `pulse/ui/Burbuja.tsx`) | El mensaje de tipo `pago`: cantidad, nota, «Ver en OrdenScan» y la verificación en la cadena hecha por el propio teléfono. |
| Accesos | `pulse/PantallaConversacion.tsx` (botón de moneda en la cabecera), `components/DeskMenu.tsx` (fila «Cartera») | |
| Relevo | `mobile/src/pulse/relevo.ts` `pago()` | `POST /pago` firmado `{ para, monto, moneda, hash, nota }`, el mismo contrato de Windows. |
| Perfil | `lib/perfil-persona.ts` | Campo `cartera` (validado 0x + 40 hex; vacío lo borra). |
| Herramienta de AURA | `lib/cartera.ts`, `lib/harness.ts` (`cartera`), `server.ts` | `PEDIR_HERRAMIENTA: cartera [token]`: lee los saldos con la dirección guardada en el perfil (solo con sesión). |
| Manos de voz | `lib/manos-app.ts`, `lib/acciones-app.ts`, `mobile/src/nucleo/contrato.ts` | `{"tipo":"cartera"}` abre la hoja; `{"tipo":"pagar","con","monto","moneda"}` abre el chat y la hoja de enviar llenada (solo a un contacto sin dudas; solo si el teléfono declaró la mano). |
| Wallet móvil | `ordenglobalfinale/apps/veta-wallet-mobile` (rama `claude/aura-pagar-s46jxx`) | `vetawallet://pagar?…` abre «Enviar» llenado, con dirección, cantidad y moneda fijas, y vuelve a AU-RA. |

## El flujo de un pago

1. En el chat con Ana, la persona toca la moneda de la cabecera (o le dice a AURA «mándale 5 ORIGEN a Ana»).
2. La hoja busca la dirección de Ana en su ficha de PULSE2CHAT y la propia (cartera conectada). Sin la de Ana:
   «Ana todavía no tiene su dirección de Veta Wallet a la vista…», y no se puede seguir. Sin la propia:
   «Conectar mi cartera».
3. Elige moneda (ORIGEN y las publicadas primero; «Más monedas» para las otras nueve) y cantidad
   (`montoValido`: «2,5» = 2.5, «1,000» = mil, hasta 18 decimales). Ve cuánto tiene de esa moneda.
4. Resumen: cuánto, a quién, la dirección completa de Ana (de su ficha) y desde qué cartera.
5. «Confirmar y abrir Veta Wallet»: el vigía anota el bloque actual y se abre
   `vetawallet://pagar?a=<Ana>&m=5&s=ORIGEN&vuelta=ultronfp://pago`. Si la app no está, la web
   `https://app.vetawallet.com/#pagar?a=…&m=5&s=ORIGEN` (la de Windows). Mientras espera, la hoja ofrece abrirlo
   en la web por si la app instalada todavía no entiende el enlace.
6. En Veta Wallet la persona revisa y firma con su contraseña.
7. Al volver, AU-RA mira la cadena desde el bloque anotado + 1: una transacción **de su dirección**, a **la de
   Ana**, por **esa cantidad exacta** (ORIGEN: `value`; token: `transfer(Ana, cantidad)` al contrato del token).
8. La ve → `POST /pago` con el hash → el relevo la comprueba → el comprobante aparece en el hilo como tarjeta;
   la tarjeta la vuelve a mirar en la cadena y dice «Verificado en la cadena de Orden Global».
9. Si en 15 min no aparece: «No vi el envío… si no lo firmaste, no se movió nada» (seguir mirando o cerrar). Si
   el relevo no acepta el comprobante: se dice, con el hash, y se puede reintentar.

## Por voz

- «¿Cuánto tengo en mi wallet?», «¿cuánto ORIGEN tengo?» → el cerebro pide `PEDIR_HERRAMIENTA: cartera`
  (o `cartera ORIGEN`). El servidor lee el perfil, consulta la cadena y devuelve el HECHO
  («Tienes unos 1,321 dólares: 1,520.4 ORIGEN, 0.12 AUKA.»). Sin dirección guardada, AURA dice cómo conectarla.
- «Enséñame mi wallet» → `{"tipo":"cartera"}` abre la hoja.
- «Mándale 5 ORIGEN a Ana» → `{"tipo":"pagar","con":"Ana","monto":"5","moneda":"ORIGEN"}`. El servidor solo lo
  deja pasar si «Ana» es UN contacto (cambia el nombre por su correo); la app abre el chat y la hoja llenada.

## Precios

Como en Windows (Cartera.cs): ORIGEN = onza de oro ÷ 31,1035 ÷ 55; AUKA = onza de oro; AGKA = onza de plata
(CoinGecko `pax-gold` y `kinesis-silver`); precios fijos de la wallet para AGRO, AIT, SOL, REST, LOVE, POLITICAL,
ASL, AUBEX, HARV e IBS; los demás «sin precio». Ojo: `veta-wallet-backend/lib/origenPrice.js` fijó desde el
12-ago-2026 un precio de 0,01 USD por ORIGEN para los caminos de dinero de la wallet; el valor que muestran
AU-RA y Windows es una **referencia** al oro (así se rotula), no la cotización de la wallet.

## Lo que falta fuera de este repositorio

- **La app de la wallet que la gente tiene instalada** (Orden Global / Veta Wallet de producción, la que ya atiende
  `vetawallet://sso` y `vetawallet://genesis`) tiene que atender `vetawallet://pagar?a=…&m=…&s=…&vuelta=ultronfp://pago`
  con su envío real: abrir «Enviar» con esos tres valores fijos, firmar con la contraseña y, al terminar o cancelar,
  abrir la `vuelta` (solo si es exactamente `ultronfp://pago`). La regla de lectura está en
  `ordenglobalfinale/apps/veta-wallet-mobile/src/enlacePagar.js` (y en `logica.ts` `leerEnlacePagar`). Mientras no
  lo haga, AU-RA ofrece la web (`#pagar`), que ya funciona.
- **El relevo** (`/pago`, `/ficha`) ya existe y lo usa Windows; no cambia.

## Pruebas

- `tests/cartera.test.ts`: cantidad y dirección, enlaces (el de la web idéntico al de Windows), saldos con un RPC
  falso (errores ≠ cero, caché, sin precio), búsqueda del envío, comprobación del comprobante, el vigía con una
  cadena falsa (bloques después de abrir, un hash una sola vez, tope, cancelar, reintentar, retomar), el perfil, la
  herramienta `cartera` y las manos `cartera`/`pagar`.
- `ordenglobalfinale/apps/veta-wallet-mobile`: `node src/enlacePagar.test.mjs`.
