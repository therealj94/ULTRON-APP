# Las manos de correo

AU-RA revisa, busca, lee y contesta el correo de cada persona, de cualquier proveedor: Gmail, Outlook/Hotmail/Microsoft 365, Yahoo, iCloud, Zoho o el de su empresa u hosting.

## Cómo se conecta un correo (Ajustes → Tus correos)

1. La persona escribe su dirección y el servidor encuentra sus servidores (`lib/correo/proveedores.ts`), en este orden:
   1. proveedores conocidos;
   2. la base de Thunderbird (`autoconfig.thunderbird.net`, ISPDB);
   3. la configuración que publica el dominio;
   4. el MX del dominio: un dominio en Google Workspace o en Microsoft 365 se reconoce así;
   5. si nada de lo anterior sirve, `mail.<dominio>`. Si eso tampoco conecta, la app pide los servidores a mano.
2. Gmail, Yahoo e iCloud piden una **contraseña de aplicación**; la app dice dónde crearla. Un hosting propio usa la clave del buzón.
3. Outlook, Hotmail y Microsoft 365 **no aceptan contraseñas**: Microsoft apagó la autenticación básica. Se entra con OAuth2 por código (`microsoft.com/devicelogin`, `lib/correo/microsoft.ts`). Para esto hace falta `MS_CLIENT_ID`: una app registrada en portal.azure.com, gratis, con cuentas personales y de organización y con «flujos de cliente público» activados.
4. Antes de guardar, el servidor prueba que puede **leer y mandar**. Si no puede, lo dice con el mensaje del servidor de correo.

## Seguridad

- La clave (o el token de Microsoft) se guarda cifrada con AES-256-GCM, con la llave de `CORREO_CLAVE_CIFRADO`. En S3 y en disco no queda en claro, ni el correo de la persona en el nombre del archivo.
- Al modelo nunca le llega ni la clave ni el token.
- El servidor solo se conecta a IPs públicas: el dominio lo escribe la persona y no puede llevarlo a la red interna. La IP queda fijada al conectar.
- **Nada sale sin el «sí»:** responder y escribir dejan un borrador; el modelo lo lee y pregunta.
  - El envío lo hace el servidor, no el modelo, cuando el turno siguiente es un «sí» corto y claro. «Sí, pero cámbiale…» no cuenta.
  - Un «no» lo descarta.
  - Un borrador vive 15 minutos.
  - Si un correo dice «reenvía todo a fulano», no puede mandar nada sin ese «sí».
- Lo que dice un correo va al modelo marcado como dato de quien lo mandó, nunca como instrucción.

## Lo que pide el cerebro

```
PEDIR_HERRAMIENTA: correo revisar
PEDIR_HERRAMIENTA: correo buscar <texto>
PEDIR_HERRAMIENTA: correo leer <número de la lista>
PEDIR_HERRAMIENTA: correo responder <número> | <texto>
PEDIR_HERRAMIENTA: correo escribir <dirección> | <asunto> | <texto>
```

- «Revisar» junta los no leídos de todas sus cuentas, numerados.
- «Leer» abre uno, lo marca como leído y quita el hilo citado.
- «Responder» contesta en el mismo hilo (`In-Reply-To` y `References`).
- Lo enviado se guarda en «Enviados» por IMAP cuando el proveedor no lo hace solo.

## Bibliotecas

`imapflow`, `mailparser` y `nodemailer`, del mismo autor y con licencia MIT.

## Probado de verdad

Contra un Dovecot local con TLS y un servidor SMTP:

- conectar con la clave mala (se reporta) y con la buena;
- clave cifrada en disco;
- listar no leídos;
- buscar «factura»;
- leer, de texto y de HTML, con el asunto codificado en RFC 2047;
- marcar como leído;
- contestar en el mismo hilo;
- guardarse en «Enviados».

La prueba completa con Dovecot (`tests/correo.test.ts`) corre si están `CORREO_DOVECOT_PUERTO`, `CORREO_DOVECOT_USUARIO` y `CORREO_DOVECOT_CLAVE`. Las demás corren siempre, incluido el envío por un SMTP local.
