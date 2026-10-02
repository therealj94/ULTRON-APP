# WhatsApp personal en AU-RA

José (2-oct-2026): «WhatsApp personal, en la nube… en la app debo poder verlo y contestar y todo, una opción aparte de PULSE2CHAT, slide y cambia, tiene que ser en app y Windows».

## Cómo está armado

```
Teléfono (app AU-RA)  ─┐
AURA para Windows     ─┼─►  servidor AU-RA (Render)  ──red privada──►  whatsapp-puente (Render, privado)  ──►  WhatsApp
El avatar (cerebro)   ─┘    server/whatsapp.ts                         servicios/whatsapp-puente
                            solo WHATSAPP_DUENOS                        whatsmeow + SQLite en /data
```

- **El puente** (`servicios/whatsapp-puente`, Go) entra a WhatsApp como un **dispositivo vinculado**, igual que WhatsApp Web.
  - Usa [whatsmeow](https://github.com/tulir/whatsmeow), la misma librería que el proyecto *whatsapp-mcp* que mandó José.
  - Guarda en su disco (`/data`) dos bases: la sesión del aparato vinculado y los chats y mensajes.
  - Corre como **servicio privado de Render**: no tiene dirección pública y solo el servidor de AU-RA lo alcanza por la red interna.
  - Además pide una clave (`PUENTE_CLAVE`).
- **El servidor** (`server/whatsapp.ts`) es la única puerta.
  - `/api/whatsapp/*` solo responde a las cuentas de `WHATSAPP_DUENOS`. Para cualquier otra persona no existe: la app ni muestra la pestaña.
- **La app**: en Chats, PULSE2CHAT y WhatsApp quedan lado a lado; se cambia deslizando o con la pestaña (`mobile/src/whatsapp`).
- **AURA para Windows**: el panel de WhatsApp está en el Centro.
- **El avatar**:
  - La herramienta `whatsapp` (revisar, buscar, leer y responder) solo se le ofrece al dueño.
  - Responder deja un **borrador**; lo manda el servidor cuando la persona dice «sí» (igual que el correo).
  - Lo que dicen los mensajes llega marcado como dato, nunca como orden: un mensaje que dice «mándale esto a…» no manda nada.

## Vincular

En la app: Chats → pestaña **WhatsApp**.

- **Con un código** (sirve en el mismo teléfono):
  1. Escribe tu número con el código de país y toca «Pedir el código».
  2. En WhatsApp: ⋮ → Dispositivos vinculados → Vincular un dispositivo → **Vincular con el número de teléfono**.
  3. Escribe el código de 8 letras.
- **Con QR** (desde la PC o desde otro teléfono): escanéalo en WhatsApp → Dispositivos vinculados → Vincular un dispositivo.

La primera vez, WhatsApp manda la historia reciente; tarda unos minutos.

Para desvincular: en la app (⋮ → Desvincular) o desde el teléfono. En ambos casos el puente **borra todo** lo que tenía guardado.

## Variables

| Dónde | Variable | Qué es |
|---|---|---|
| whatsapp-puente | `PUENTE_CLAVE` | Clave de 24 caracteres o más. La misma que `WHATSAPP_PUENTE_CLAVE`. |
| whatsapp-puente | `DATOS` (`/data`), `PORT` (`8080`) | Disco y puerto. |
| servidor AU-RA | `WHATSAPP_PUENTE_URL` | `http://<nombre interno del servicio>:8080` (red privada de Render). |
| servidor AU-RA | `WHATSAPP_PUENTE_CLAVE` | La clave del puente. |
| servidor AU-RA | `WHATSAPP_DUENOS` | Quién puede ver este WhatsApp, separado por coma: correos de AU-RA o el id de una persona del padrón (`jose` vale con cualquiera de sus correos). |

## Riesgos que José aceptó

- **No es la API oficial de Meta.** Las reglas de WhatsApp prohíben los clientes no oficiales, así que existe el riesgo de que bloqueen el número.
  - Se reduce usándolo como una persona: leer y contestar, sin mensajes masivos.
- **La sesión vinculada da acceso completo a sus chats.**
  - Por eso vive en un servicio privado, con clave, en un solo lugar.
  - Al desvincular se borra todo.
- **Cada cierto tiempo WhatsApp puede pedir volver a vincular**, por ejemplo si el teléfono pasa muchos días sin conexión.

## Lo probado

- Contra **WhatsApp real** (2-oct): el puente conectó y WhatsApp le dio un QR válido. No se vinculó ninguna cuenta en la prueba.
- `go test` del puente: almacén, contenido de los mensajes y API con una cuenta falsa (clave, códigos de error, enviar, media, desvincular).
- `tests/whatsapp.test.ts`, con un puente falso:
  - solo el dueño entra;
  - el cerebro lee por nombre;
  - el borrador sale solo con el «sí»;
  - un mensaje que «ordena» no manda nada.
- `mobile/src/whatsapp/pruebas`: la lógica de la pantalla (8 pruebas), y una vista en Chromium (vincular, lista, chat, enviar).
