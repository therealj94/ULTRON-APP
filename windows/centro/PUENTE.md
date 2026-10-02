# Puente Centro ⇄ AURA (WebView2)

La página (`centro/src`) habla con el .exe (`src/Aura.Windows/Centro/`) por `window.chrome.webview`:

- **página → AURA**: `{ id, metodo, args }` · respuesta `{ id, ok: true, valor }` o `{ id, ok: false, error }` (texto para la persona).
- **AURA → página**: `{ evento, datos }`.

En TS: `pedir(metodo, args, ms?)` y `al(evento, fn)` de `src/puente.ts`. Fuera de WebView2 responde con datos de muestra.

Seguridad: AURA solo acepta mensajes, navegación y permisos (micrófono/cámara) del origen EXACTO `https://centro.aura.local`
(esquema, host y puerto; sin usuario; nunca por prefijo: `PuenteCentro.OrigenExacto`). Un método que no esté en la
tabla (`PuenteCentro.Metodos`) se rechaza antes de mirar sus argumentos.

## Métodos

| Método | Args | Devuelve |
|---|---|---|
| `estado` | — | `Estado` (ver `src/estado.ts`) |
| `entrar.genesis` | — | abre Veta Wallet (Genesis ID) y espera la vuelta `ultronfp://sso`; `{ miembro, genesis?, pase, verificador }` (el MISMO pase sirve una vez para `/alta` del relevo de PULSE2CHAT) |
| `entrar.enlace` | `{ url }` | lo mismo, con el enlace de vuelta pegado a mano (si Windows no abrió AURA solo) |
| `entrar.clave` | `{ correo, clave }` | `{ miembro }` (junta / cuentas con clave) |
| `salir` | — | cierra la sesión en este equipo |
| `primeraVez.terminar` | — | marca la guía como vista |
| `ajustes.leer` / `ajustes.guardar` | parcial | ajustes (sin secretos). `transparencia` 0.30–1; `notch: { borde: "arriba"\|"abajo", fraccion: 0..1, monitor: nombre de Windows o "" (el principal), menosMovimiento }` (cada campo es opcional al guardar) |
| `notch.monitores` | — | `[{ id, nombre, principal, actual }]`: los monitores conectados y cuál usa el notch |
| `notch.restablecer` | — | el notch vuelve arriba al centro del monitor principal; devuelve los ajustes |
| `ventana.recoger` | — | oculta el Centro (AURA sigue en el notch) |
| `relevo` | `{ ruta, cuerpo, ms? }` | POST a `https://cerebro.ordenscan.com/mensajes{ruta}` desde C# (sin CORS): `{ estado, datos }` (estado HTTP y el JSON). Solo rutas del relevo (`/^\/[a-z0-9/_-]{1,60}$/`) |
| `relevo.archivo` | `{ id }` | `{ base64, mime }` de `GET /archivo/:id` |
| `secreto.leer` / `secreto.guardar` / `secreto.borrar` | `{ clave, valor? }` | almacén pequeño cifrado con DPAPI (claves de PULSE2CHAT). Solo claves `p2c.…` (`^p2c\.[a-z0-9_-]+(\.[a-z0-9_-]+)*$`, ≤ 60), valor ≤ 16 KB; otra clave se rechaza |
| `notch.timbre` | `{ de, nombre, video }` | el notch muestra la llamada entrante con Contestar/Rechazar (responde con el evento `llamada.accion`) |
| `notch.timbreFin` (o `notch.colgada`) | `{ motivo }` | la llamada dejó de sonar (contestó, colgó, otro aparato): el notch quita el timbre |
| `notch.llamada` | `{ activa }` | hay (o ya no hay) una llamada de PULSE2CHAT sonando o en curso: mientras tanto AURA no se actualiza sola |
| `notch.aviso` | `{ titulo, cuerpo }` | aviso en el notch (mensaje nuevo, llamada perdida) |
| `ventana.mostrar` | `{ seccion? }` | trae el Centro al frente (p. ej. al contestar desde el notch) |
| `chat.enviar` | `{ texto }` | le habla a AURA (igual que el chat del notch); las respuestas llegan por `chat.mensaje` |
| `voz.decir` | `{ texto, avatar, emocion }` | `{ base64, mime }`: el audio de `/api/tts` con la voz de ese avatar (`claudio`, `antonio`, `aura`, `ojos`) en el idioma de AURA. Lo usa el recorrido (Claudio y ANT-ONIO). Frases de hasta 400 letras; sin servidor devuelve `null` y el recorrido se lee |
| `recorrido.abierto` | `{ si }` | con el recorrido abierto AURA se calla y silencia el micrófono (el recorrido suena por el altavoz y dice «Oye AURA»); al cerrarlo vuelve como estaba (si ya estaba silenciado, sigue igual) |
| `spotify.*`, `cartera.*`, `conectar`, `desconectar` | ver `src/vistas/*.ts` | |

## Eventos

| Evento | Datos |
|---|---|
| `estado` | `Estado` completo cuando cambia algo |
| `ir` | id de sección a mostrar |
| `llamada.accion` | `{ accion: 'contestar' \| 'rechazar' \| 'colgar' }` desde el notch |
| `chat.mensaje` | `{ quien, texto, id, parcial? }` |
| `musica` | lo que suena |
| `ventana.escondida` | — · la ventana del Centro se escondió (la cerraron o se recogió): el recorrido se cierra |
| `recorrido` | — · abrir el recorrido de Windows |
| `salio` | la sesión se cerró |
