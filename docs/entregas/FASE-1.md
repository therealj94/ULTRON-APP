# Fase 1: voz en vivo para AURA Windows

Plan: `docs/PLAN-FASES-0-4.md`. Rama: `ccr-a300ded3-ru9biy`.

## Resumen

AURA para Windows ya puede conversar en vivo con el agente de ElevenLabs, igual que la llamada del teléfono. El cerebro sigue siendo el nuestro. Las manos de la PC siguen pasando por las reglas y por la guarda.

Si la voz en vivo no abre (sin sesión, sin red o sin minutos), AURA sigue con el oído de siempre durante 10 minutos y avisa.

Faltan dos cosas:
- **«Hey AURA» con openWakeWord (1.4).** Necesita entrenar un modelo en GPU.
- **Medir en tu PC (1.7).** El registro ya anota los tiempos, pero hay que probarlo con micrófono real.

## Estado por tarea

| # | Tarea | Estado | Dónde |
|---|---|---|---|
| 1.1 | Origen `windows` en el agente de voz | ✅ | `server/voz-agente.ts`: el pase lleva `origen` y `aparato`, y el turno manda `origen: 'windows'`, así el cerebro recibe `instruccionWindows`. Windows sin aparato recibe 400. |
| 1.2 | Cliente de voz | ✅ | `windows/src/Aura.Windows/Voz/AgenteVoz.cs`: WebSocket con URL firmada de un solo uso. Micrófono PCM 16 kHz en bloques de 50 ms. Reproduce PCM o μ-law, maneja ping/pong y las interrupciones. La API key nunca llega al cliente. |
| 1.3 | Manos dentro de la voz | ✅ | Servidor: `lib/ordenes-pc.ts` quita `⟦hacer⟧` del texto y de la voz mientras llega. La orden va por `event: pc` al canal del .exe con `retener.hacer`, o sea solo cuando el turno se confirma. Windows: `CanalPc` lee el canal; `NotchWindow.Agente.cs` ejecuta las reglas al instante, pasa la guarda `Coherente` y evita repetidas con `HechasRecientes`. |
| 1.4 | «Hey AURA» con openWakeWord | ✅ (v3) | Modelo propio `Modelos/hey_aura.onnx`, entrenado en la T4. Motor `PalabraClave` en C#, idéntico a la referencia de Python. Corre **junto** con SAPI y cualquiera de los dos la despierta. Umbral 0,9: 67 % «oye aura», 90 % «hey aura», 0 % parecidas, ~0,56 falsas por hora. Detalle en `Modelos/LEEME.md`. |
| 1.5 | Respaldo | ✅ | Ajuste `VozMotor` = `agente` \| `local`, en el Centro → Voz → «Cómo conversa». Si en vivo falla, usa el oído local 10 min (2 min si se cortó a mitad). |
| 1.6 | Región de ElevenLabs | ✅ (configurable) | `ELEVEN_API_BASE` en Render, por ejemplo `https://api.us.elevenlabs.io`. Por omisión sigue la de siempre: no la cambié sin poder probar la región con la cuenta real. |
| 1.7 | Medición | 🟡 | `aura.log` registra: «conversación abierta en X ms», «primera voz a los X ms de entender tu frase», cada frase oída y cada orden. El servidor ya registraba una línea por turno (`[voz] turno …`). Falta medir 20 turnos reales en tu PC. |

## Cómo funciona

1. Despiertas a AURA con «Oye AURA», la tecla o el micrófono del notch.
2. El .exe pide `POST /api/voz/agente` con `transporte: websocket`, `x-aura-origen: windows` y `x-aura-aparato: win-…`. Recibe la URL firmada y el pase.
3. Abre el WebSocket y manda el pase como variable dinámica. ElevenLabs llama a `/api/voz/llm` con ese pase en cada turno.
4. Cuando ElevenLabs entiende tu frase (`user_transcript`), las reglas de la PC la ejecutan al instante si la reconocen («abre la calculadora»).
5. El cerebro contesta. Si pide manos, `⟦hacer: …⟧` no suena: va por el canal cuando el turno se confirma. Si las reglas ya lo hicieron, no se repite.
6. La conversación se cuelga sola:
   - después de 60 s sin hablar (3 min con «siempre»);
   - con «apágate» o «deja de escuchar»;
   - al tocar el micrófono del notch;
   - al escribirle en el chat.

**Eco:** el micrófono de Windows no cancela el eco. Mientras AURA habla, lo que entra más bajo que su voz se manda como silencio. Así su propia voz no la interrumpe, pero tú sí puedes interrumpirla si hablas cerca y más fuerte.

## Arreglos de la auditoría que entran aquí

- **Web, «En vivo» con un turno en camino:** el turno ya no habla encima del agente (`src/App.tsx`).
- **Web, error en «En vivo»:** cuelga la sesión, y nunca quedan dos micrófonos abiertos (`src/03-voz/enVivo.ts`).
- **Turno especulativo y memoria:** la frase a medias que se reemplaza no queda en la memoria; un turno interrumpido por otra frase sí se guarda (`continuaLaFrase`).
- **Oído local en cuarto ruidoso:** aprende el ruido constante, y una frase de 25 s sin pausa se tira en vez de ir al transcriptor (`Aura.Windows.Core/DetectorVoz.cs`).

## Pruebas

- **Servidor:** `npm test` en la raíz. Los números de la corrida final están en el PR. Pruebas nuevas:
  - `tests/voz-agente.test.ts`:
    - URL firmada y pase de Windows; sin aparato, 400.
    - La marca no suena y la orden llega tras confirmar.
    - Solo marca → «Listo.».
    - Una frase a medias no hace nada.
    - El teléfono no se toca.
    - La memoria del turno especulativo.
  - `tests/ordenes-pc.test.ts`: el filtro y el canal solo al aparato.
  - `tests/aura-app-extremo.test.ts`, de punta a punta con el servidor compilado: la instrucción de Windows llega al cerebro en la voz, la orden llega al canal del .exe y no al teléfono.
  - `tests/voz-en-vivo-web.test.ts`: un error cuelga la sesión.
- **Windows:** `windows/tests` pasa 336 checks (antes 315). Los nuevos cubren:
  - el protocolo del agente: inicio, audio, μ-law, frase, respuesta, corrección, interrupción y ping;
  - el canal SSE: solo `event: pc`;
  - `HechasRecientes`;
  - `DetectorVoz` con ruido constante y con voz.
- **Compilación:** `Aura.Windows` compila en Linux con `-p:EnableWindowsTargeting=true` (0 errores). La CI de Windows hace el build real y el instalador.
- **Centro:** `npm test` 25/25.

## Pendiente y decisiones que te tocan

1. **«Hey AURA» (1.4), siguiente versión.**
   - El registro anota qué motor la despertó (modelo propio o Windows) y con qué puntuación. Con eso se ve si el umbral 0,9 está bien en tu PC.
   - Para la v4 conviene grabar unas 50 veces «oye aura» con voces reales (la tuya y las del equipo) y agregarlas a los positivos.
   - **Licencia:** los dos modelos base de openWakeWord son CC BY-NC-SA (no comercial). Hay que revisarlo antes de distribuir AURA comercialmente.
2. **Región de ElevenLabs en EE. UU.** Probar `ELEVEN_API_BASE=https://api.us.elevenlabs.io` en Render. Si ElevenLabs falla, se borra la variable.
3. **Prueba real en tu PC:**
   - 20 turnos con acciones («pon bachata en Spotify», «cierra el bloc de notas», «apágate»);
   - 10 min de ruido de oficina;
   - una prueba sin red.
   - Los números salen en `aura.log`, en el Centro → Registro.
4. **Configuración del agente en ElevenLabs.** El de Windows usa el mismo agente que el teléfono (`AGENTES` en `voz-agente.ts`). Si el formato de salida del agente es μ-law 8 kHz (telefonía), el .exe lo decodifica, pero se oye peor. Conviene `pcm_16000` o más.
