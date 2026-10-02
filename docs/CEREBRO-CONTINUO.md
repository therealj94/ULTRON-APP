# Cerebro continuo de AU-RA

José (2-oct): «armar bien su cerebro corto y largo para que no se pierda… debo sentir que sabe, que
recuerda, sabe algo que quedó a medias… sabe todo de mí… conecta con mi familia… que revise los mensajes,
los organice y vea cuál es importante, qué contestar».

La memoria corta de siempre (`lib/memoria.ts`, 120 turnos; `lib/memoria-miembro.ts`, 60) sigue igual. Esta
capa nueva vive al lado y no la toca.

| Módulo | Qué hace | Dónde se guarda (S3 / disco) |
|---|---|---|
| `lib/episodios.ts` | Resume cada tramo de conversación (16 turnos o una pausa de más de 30 min) en un episodio: resumen de 3–6 líneas, temas, personas, abiertos, emoción. Busca por palabras (BM25 + lo reciente) y por significado si hay `EMBED_URL`. Hasta 500 por persona; los meses viejos se compactan en un resumen por mes. | `ultron/episodios/<huella>.json`, el tramo en curso en `ultron/episodios-tramo/` · `ULTRON_EPISODIOS_DIR` |
| `lib/abiertos.ts` | Lo que quedó a medias: promesas de AU-RA, lo que la persona dijo que haría, preguntas sin resolver, borradores sin mandar, misiones. Junta repetidos; lo que no es importante caduca a los 7 días (los borradores a 1). | `ultron/abiertos/` · `ULTRON_ABIERTOS_DIR` |
| `lib/conocer-persona.ts` | Datos de la persona por categoría (familia, trabajo, metas, gustos, salud, rutinas, fechas, personas, otros), cada uno con fecha, confianza y fuente. Nunca guarda secretos. Se pueden corregir y borrar. `queNoSe` da lo que falta saber, una pregunta a la vez. | `ultron/conocer/` · `ULTRON_CONOCER_DIR` |
| `lib/circulo.ts` | Su gente: nombre, relación, canales y permisos. Resuelve «mi esposa», «Ana» o «mi hijo Beto». Herramienta `circulo`. | `ultron/circulo/` · `ULTRON_CIRCULO_DIR` |
| `lib/triaje.ts` | Revisa WhatsApp y correo, los ordena (urgente, importante, normal, ruido), detecta la intención (pregunta, dinero, familia, trabajo, publicidad, grupo, estafa) y sugiere respuestas que quedan como borrador. Herramienta `triaje`. | No guarda nada |
| `lib/cerebro-comun.ts` | Lo que usan todos: `clavePersona`, el cajón seguro por persona, la llamada corta al modelo, los textos y el filtro de secretos. | |
| `server/cerebro-continuo.ts` | Las rutas. | |

**De quién es lo guardado:** `clavePersona(x)`. Una persona del padrón con acceso a AU-RA queda como
`junta:<id>`, llegue por su correo o por su id de Telegram, así que José es el mismo en el teléfono, la web y
Telegram. Cualquier otra persona queda por su correo.

**Regla de S3** (la misma de `PerfilNoDisponible` y `lib/memoria-miembro.ts`): si S3 no deja leer, no se
sube nada. Las lecturas devuelven `{ ok: false }` y las escrituras lanzan `CajonNoDisponible`, que las rutas
convierten en 503. Los turnos que llegan mientras S3 está caído esperan en memoria y se juntan con lo
guardado cuando S3 vuelve.

**El modelo:** se usa una sola llamada por tramo, en segundo plano. La hace `preguntarModelo` en el espacio
común del nodo, con tope de 45 s, y si el nodo no está pasa al modelo chico. Esa llamada devuelve el
episodio, los abiertos (y los que se cerraron, por id) y los datos de la persona. Sin modelo, las reglas
resumen el tramo para que no se pierda. Además, en cada turno corren reglas baratas sobre abiertos y datos.

## Cómo conectarlo (server.ts, prompt-turno.ts, harness.ts)

En `server.ts`, con la persona del turno: `const personaCerebro = duenoComputadora` (`correoApp || quienMem`).

1. **Después de cada turno, sin esperar.** Va donde se guarda la respuesta de AU-RA. En la voz, dentro de
   `retener.recordar`, igual que `recordarSegunNivel`:
   ```ts
   void anotarTurnos(personaCerebro, [
     { rol: 'user', texto: message, t: tTurno },
     { rol: 'ultron', texto: reply },
   ], { nombre });
   ```
   Al arrancar el servidor: `iniciarBarridoPausas();`.
   Al abrir la app o al sonar la llamada (`calentarCerebro`): `void precargarCerebro(persona); void precargarCirculo(persona);`.
   Los bloques también se cargan solos en el primer turno, aunque ese turno todavía sale sin ellos.
2. **Los bloques del prompt.** Antes de `piezasDelTurno`, con `compacto` igual al de la voz:
   ```ts
   const bloqueCerebro = [bloqueAbiertos(personaCerebro, compacto), bloqueEpisodios(personaCerebro, message, compacto)].filter(Boolean).join('\n\n');
   const conocer = bloqueConocer(personaCerebro, compacto, { nombre, conPregunta: !compacto });
   ```
   En `server/prompt-turno.ts`, agregar a `PiezasTurno` `bloqueCerebro?: string` y `conocer?: string`:
   - `bloqueCerebro` va en `contexto` (el mensaje del turno), justo después de `p.bloquePerfil`, porque
     cambia con la consulta.
   - `conocer` va en lo fijo, `const fijo = \`${cabeza}${memoria}${p.conocer ? '\n\n' + p.conocer : ''}${app}\``,
     pero no en `firma`. Así, aprender un dato no rehace el system a media conversación; entra cuando se
     rehace el fijo (30 min o `CONGELAR_MAX_NUEVOS`).
   - Topes: voz 600 + 350 + 450 caracteres; texto 1500 + 900 + 1200 (`TOPE_EPISODIOS`, `TOPE_ABIERTOS`,
     `TOPE_CONOCER`).
3. **Las rutas.** Junto a `montarRutasWhatsapp`:
   `montarRutasCerebroContinuo(app, { exigirMesa, limitar, sesionDe: (req) => sesionDe(req) });`
4. **Las herramientas** en `lib/harness.ts`:
   - Agregar `'circulo' | 'triaje'` a `HerramientaHarness` y a la expresión `RE`.
   - En `instruccionHarness`: `INSTRUCCION_CIRCULO` cuando hay sesión, e `INSTRUCCION_TRIAJE` cuando
     `conWhatsapp` es verdadero (solo el dueño del WhatsApp).
   - En los runners: `circulo?: (arg) => Promise<string>` y `triaje?: …`, despachados como `correo`
     (`ped.arg.trim() || 'listar'` y `|| 'revisar'`).
   - En `server.ts`, junto a `correo`/`whatsapp` (cerca de la línea 3297):
     `circulo: (arg) => correrCirculo(dueno, arg, ambito), triaje: (arg) => correrTriaje(dueno, arg, ambito)`.
     El borrador de `circulo` es el de `server/whatsapp.ts` y lo resuelve el `resolverBorradorWhatsapp`
     que ya existe, con el mismo `dueno` y `ambito`.

## Rutas (todas por la sesión)

- `GET /api/cerebro/episodios?n=`
- `GET /api/cerebro/abiertos`, y `POST /api/cerebro/abiertos/:id/cerrar {estado?: 'hecho'|'descartado'}`
- `GET /api/cerebro/conocer`, que devuelve `{ categorias: [{id, nombre, datos}], total, faltan }`, y `DELETE /api/cerebro/conocer/:id`
- `GET /api/circulo`, que devuelve `{ personas, puede }`; `POST /api/circulo`, que agrega, o cambia si trae `id`; y `DELETE /api/circulo/:id`.
  El permiso `permisos.recordatorios: 'permitido'` solo se puede dar aquí, José desde su app. La herramienta no puede.
- `GET /api/triaje?canal=todo|whatsapp|correo`, solo para quien cumple `whatsappPermitido`.

## Lo que se puede de verdad desde el servidor

- **WhatsApp a la familia:** sí, si su WhatsApp personal está vinculado (`WHATSAPP_PUENTE_URL`,
  `WHATSAPP_PUENTE_CLAVE`, `WHATSAPP_DUENOS`). Siempre deja un borrador y se manda con su «sí». La
  excepción son los recordatorios a alguien a quien José dio permiso permanente: esos salen sin preguntar,
  hasta 3 por día por persona.
- **Llamar a alguien del círculo:** no. WhatsApp no deja llamar desde un dispositivo vinculado. La llamada
  de Twilio (`lib/canales.ts` `llamada`) solo marca a `JEFE_TELEFONO`, el propio José, y además necesita
  `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` y `TWILIO_VOICE_FROM`. `circulo llamar` lo dice así y ofrece
  la app.
- **PULSE2CHAT:** lo hace la app del teléfono (acciones de la app). No hay una API del servidor.
- **Mandar a una hora:** el servidor no programa envíos. Si dice que sí, el mensaje sale en ese momento.
