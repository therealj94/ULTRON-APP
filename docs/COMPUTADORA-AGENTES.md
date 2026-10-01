# La computadora de los agentes

Cada avatar de AU-RA tiene su propia computadora en la nube: un escritorio Ubuntu con Firefox y LibreOffice que maneja un modelo de *computer use*. Se usa para tareas de pantalla: entrar a un sitio y buscar dentro, comparar páginas, llenar un formulario, sacar datos de una tabla.

## Piezas (todo armado con proyectos que ya existen)

| Pieza | Qué es | De dónde sale |
|---|---|---|
| GPU | `g6.xlarge` (NVIDIA L4, 24 GB), `aura-computadora`, IP elástica 54.85.85.77 | AMI oficial *Deep Learning Base OSS Nvidia Driver GPU (Ubuntu 24.04)* |
| Modelo gratis | Hcompany/Holo-3.1-9B (Apache 2.0) en vLLM 0.30, FP8 | Banderas de la guía de H Company («Local inference») |
| Escritorio | Ubuntu + Xvfb + VNC + noVNC + Firefox + LibreOffice, 1280×800 | Imagen de la demo oficial de *computer use* de Anthropic |
| Ciclo del agente | `scripts/nodo-computadora/agente.py` | Guía de Holo («Core concepts», «Function calling») y documentación de *computer use* de Claude |
| Puerta | Caddy con TLS (`https://54-85-85-77.sslip.io/api`), clave Bearer | `scripts/nodo-computadora/Caddyfile` |

Instalación en el nodo: `sudo COMPUTADORA_CLAVE=... DOMINIO=54-85-85-77.sslip.io bash scripts/nodo-computadora/instalar.sh`.

## Lo medido (1-oct-2026)

- **Holo-3.1-9B en BF16 no cabe en la L4.** Los pesos ocupan 18,2 GB y la caché KV pedía 4,1 GB más (CUDA out of memory). En FP8 (nativo en la L4), el modelo ocupa 10,8 GB y quedan unos 200 000 tokens de caché.
- **La imagen `vllm/vllm-openai:v0.30.0-cu129` viene rota** (torchvision no corresponde a su torch). La principal, `v0.30.0` (CUDA 13), sí funciona.
- **Tarea real:** «Abre el navegador, entra a es.wikipedia.org y dime en qué fecha nació Francisco Morazán».
  - Resultado: 11 pasos en 80 s, unos 5 s por paso.
  - Respuesta correcta (3 de octubre de 1792), comprobada con la captura final.

## Cómo la usa el cerebro

- El modelo pide `PEDIR_HERRAMIENTA: computadora <la tarea entera>` (`lib/harness.ts`). Solo se le ofrece si el servidor tiene `COMPUTADORA_URL` y `COMPUTADORA_CLAVE`, y la ficha de manos (`lib/manos-ficha.ts`) solo la nombra en ese caso.
- `server/computadora.ts` encarga la tarea y espera 20 s si se está hablando (la voz da 45 s al turno) o 50 s si se escribe (el teléfono corta el SSE a los 70 s).
  - Si termina, contesta con el resultado.
  - Si no, dice que la está haciendo, sigue mirando la tarea y la cuenta en el turno siguiente, una sola vez.
- Solo para alguien con sesión: la tarea es de esa persona, y solo ella la ve.
- Ajustes del teléfono → «Su computadora»: Gratis (Holo) o Claude (`computer_toolset_20260801`, de pago). Si se elige Claude y el nodo no tiene `ANTHROPIC_API_KEY`, la tarea la hace la gratis y se dice.
- App: `GET /api/computadora`, `GET /api/computadora/tareas/:id` (con la captura de cada paso) y `POST /api/computadora/tareas/:id/parar`.

## Seguridad

- La vista en vivo (noVNC), con la que se puede tomar el control del escritorio, no se publica: queda en 127.0.0.1:6080. Lo que hizo el agente se mira con las capturas de cada paso, que piden la clave.
- El escritorio es un contenedor aparte, sin sesiones ni contraseñas de nadie. La instrucción del modelo le prohíbe pagar, comprar o poner contraseñas, y si algo lo bloquea lo dice.
- Cada dueño trabaja en un escritorio limpio: si la tarea es de otra persona que la anterior, el contenedor se borra y se crea de nuevo (comprobado: el segundo dueño solo vio las pestañas de bienvenida de Firefox). El nodo recibe una huella, nunca el correo.
- Una tarea a la vez; las demás esperan su turno. Las terminadas se olvidan tras una hora (máximo 100 en memoria).
