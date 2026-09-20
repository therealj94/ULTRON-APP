# ULTRON FP por áreas

Cada área tiene un dueño de archivo claro. Cambiar una no obliga a tocar otra: se comunican por tres contratos.

## Contratos (cámbialos con cuidado; están en `lib/`)
1. **Emoción** — `lib/emocion.ts`. El 27B abre con `[EMO:x]`; el servidor devuelve `emocion`; la cara web y la APK la traducen a gestos; `server/voz.ts` la traduce a etiquetas de audio.
2. **Capacidades** — `lib/capacidades.ts` → `GET /api/capacidades`. Lo que ve el usuario en Ajustes (web) y en el menú (APK). Marca vivo/caído desde la salud real.
3. **Voz** — `server/voz.ts` → `POST /api/tts` (`text`, `emocion`, `performance`) y `POST /api/cantar` (`id` | `pedido` | `letra`). Una voz, un camino.

## Áreas

| # | Área | Archivos | Estado |
|---|---|---|---|
| 01 | Diseño | `src/01-diseno/tokens.ts`, `src/index.css` | negro + `#05E1FF`, Rajdhani + IBM Plex Mono |
| 02 | Cara web | `src/02-cara/{FaceCanvas,dibujo,funPack,emocion,gestos}.ts(x)` | 19 estados, capa de expresión por emoción, mapa táctil humano, fun pack tras `funMode` |
| 03 | Voz web | `src/03-voz/{hablar,banco,player,speech,useOido}.ts` | clips → `/api/tts` → navegador; barge-in |
| 04 | Cerebro (cliente) | `src/04-cerebro/{turno,intenciones,grabFrame}.ts` | stream SSE con `emocion`; tabla de intenciones locales con límites de palabra |
| 05 | Cerebro OG | `src/05-cerebro-og/conocimiento.ts` | única fuente de hechos de Orden Global (perfil `genesis`) |
| 05b | Cerebro de Minas | `src/08-cerebro-minas/conocimiento.ts`, `lib/minas/*` | minería general + cálculos y padrón de concesiones (perfil `minas`, demo) |
| 05c | Perfiles | `lib/perfiles/*`, `lib/cerebro.ts` | qué cerebro carga el binario según `ULTRON_PERFIL`; mismo cuerpo, otra plataforma |
| 06 | Manos | `src/06-manos/web.ts` | búsqueda y lectura web (la usa el servidor) |
| 07 | Pantallas | `src/07-pantallas/*` | Arranque, Ajustes + Capacidades, Dock, Acceso, Bóveda, Cámara, Fotos, VisionOverlay |
| 08 | Servidor | `server.ts`, `server/{voz,desk,seguridad,habla}.ts`, `lib/*` | turno JSON y SSE con harness, voz, canto, capacidades, memoria, Telegram, taller |
| 09 | Estado | `src/09-estado/memoria.ts`, `src/10-infra/sesionCliente.ts` | memoria local + sesión |
| 10 | Infra | `.github/workflows/{web,android-apk}.yml`, `.env.example`, `scripts/` | CI web y APK; grabación del banco de voz |
| APK | `mobile/` | ver `mobile/README.md` | misma voz, mismos contratos |

## Reglas
- La identidad sale de la sesión firmada o del id de Telegram verificado. El cuerpo de la petición no escala privilegios.
- `/api/turno`, `/api/tts`, `/api/stt`, `/api/vision/analyze` y `/api/cantar` conversan sin sesión con rate limit por IP (decisión de la junta para que la APK no quede muda). Memoria, bóveda, ejecutor y redespliegue exigen sesión.
- El ejecutor de Python solo corre con sandbox (`EJECUTOR_URL` o `EJECUTOR_DOCKER=1`) en producción.
- El nodo Qwen `34.207.148.69:8443` no se toca; su TLS autofirmado se acepta solo para ese host.
- Un clip grabado antes que una síntesis; una síntesis antes que la voz del navegador; nunca silencio sin aviso.
