# AURA para Windows 1.0

La versión de escritorio de la app AU-RA: **el mismo cerebro (Qwen), las mismas voces (ElevenLabs, una por avatar) y los mismos avatares**, viviendo en un **notch negro arriba al centro de la pantalla** que crece y se encoge como la isla dinámica de Apple. Se le habla, contesta hablando, y hace cosas en la computadora.

## El notch

Silueta negra pegada al borde de arriba, con las «orejas» cóncavas y las esquinas de abajo redondas, y su cámara al centro (como la imagen de referencia). Todo el tamaño sale de tres resortes (ancho, alto, radio): se le cambia el destino a mitad de camino y sigue sin saltos. Cada estado tiene su capa, que se funde y se desliza:

| Estado | Qué se ve |
|---|---|
| Reposo | 236 × 36: el avatar chiquito, la cámara y el punto de conexión. Con el ratón encima crece y muestra su nombre y el micrófono. |
| Escucha | Barras que siguen tu voz, brillo del color del avatar y la **luz naranja** de micrófono abierto. |
| Piensa | Lo que dijiste y tres puntos en ola. |
| Habla | El avatar moviendo la boca con el **nivel real del audio**, el subtítulo de la frase que suena y las barras de su voz. |
| Aviso | Notificaciones en cola: recordatorios, «abriendo Excel», capturas, respuestas con el chat cerrado. |
| Confirma | Lo que no se deshace solo (escribir en otra ventana, bloquear) espera tu «sí» por voz o con el botón, 30 s. |
| Panel | El chat completo, las acciones y el borrador. |

Con un juego o video a pantalla completa se aparta. Con «reducir movimiento» de Windows, salta sin animar.

## Avatares

AU-RA, Claudio y ANT-ONIO son sus **modelos 3D de la app** (`vendor/aura-avatar-suite`) renderizados a hojas de 24 fotogramas por estado: reposo, escucha, piensa, feliz, preocupado y tres aperturas de boca (`scripts/render-avatares.cjs`). El Guardián son sus ojos celestes, dibujados en vivo. Al cambiar de avatar cambian el color, la cara y la voz (la elige el servidor por avatar, igual que en la app).

## Voz

- **Oído:** micrófono a 16 kHz con detector de voz propio (piso de ruido adaptable, 300 ms de antes para no cortar la primera sílaba). La frase va a `/api/stt` del servidor (Whisper/Scribe).
- **Cerebro:** `/api/turno/stream` del mismo servidor, con `x-aura-origen: windows` (turno hablado rápido, sin mover la app del teléfono).
- **Voz:** cada frase se pide a `/api/tts` apenas cierra, mientras el cerebro sigue escribiendo: la primera palabra suena antes de que termine de pensar.
- **Interrumpir:** hablarle mientras habla la calla (su propia voz por el altavoz no cuenta: el umbral sube con su nivel).
- **Manos libres:** al terminar de contestar vuelve a escuchar; si nadie habla en unos segundos, se recoge.
- **«Oye AURA»** (opcional): gramática de pocas frases con el reconocedor de Windows, sin red.

Atajos: **Ctrl+Alt+Espacio** hablar · **Ctrl+Alt+A** chat · **Ctrl+Alt+W** elegir dónde escribir · **Ctrl+Alt+Esc** pausar todo.

## Qué hace («manos»)

Abrir apps (menú Inicio y apps de la Tienda), carpetas y páginas; buscar en internet; **mirar tu pantalla** y explicarla (`/api/vision/analyze`); guardar capturas; volumen, silencio y música; mostrar el escritorio; **recordatorios en el notch**; **redactar documentos** (el cerebro los escribe y quedan en el borrador); **escribir en Word o el Bloc de notas** (confirmado); bloquear el equipo (confirmado); cambiar de avatar; callar y pausar. Nada de consola ni comandos arbitrarios.

Quién decide qué mano, en orden:
1. **Reglas** exactas (`Aura.Windows.Core/Manos.cs`): «abre Excel», «súbele», «recuérdame en 10 minutos…».
2. **Laya ligera** dentro del .exe (`LayaLigera.cs` + pesos generados), sin red, en microsegundos; solo si está segura.
3. **Laya «windows» en el nodo T4** vía `POST /api/windows/intencion` (necesita sesión).
4. Si nadie está seguro, **el cerebro** contesta.

Una mano sin su parámetro («abre» sin decir qué) no se hace: contesta el cerebro.

## Laya Windows

- Datos: `scripts/nodo-t4/laya/modelos/windows/` (22 manos, español catracho/latino e inglés, errores de dictado, negativos parecidos; entrenamiento, validación y prueba separados por plantilla y por valores). `python generador/generar.py` los regenera.
- En el nodo: `windows` está en `NUEVOS` de `scripts/nodo-t4/instalar-laya.sh`; `REENTRENAR=windows bash scripts/nodo-t4/instalar-laya.sh` lo entrena en la T4 y lo sirve en `/v1/windows`. El servidor lo pide con `consultarModelo('windows', …)`.
- En el .exe: `python scripts/nodo-t4/laya/ligera/entrenar_ligera_windows.py` escribe `LayaLigeraModelo.g.cs` y `informe-windows.json`. Las pruebas de C# comprueban que C# da exactamente lo mismo que Python.
- Cifras honestas de la ligera (prueba apartada): exactitud 0,78; con su umbral decide sola el 29 % y acierta el 96 % de lo que decide (la compuerta pedía 97 %: por eso las reglas van antes y lo dudoso sube al nodo o al cerebro). El modelo del nodo se mide al entrenarse allí.

## Empezar

Instalar `AURA-Windows-Setup-1.0.0-x64.exe` (por usuario, sin permisos de administrador). El notch aparece arriba. En **Ajustes**: servidor (`https://aura-fp.onrender.com` por defecto), tu correo y clave de AU-RA → **Entrar**. La clave y la sesión quedan cifradas con DPAPI. Sin sesión, conversar funciona igual (decisión de la junta); memoria, perfil y Laya del nodo necesitan la cuenta.

## Compilar y probar

- Núcleo (corre en cualquier sistema): `dotnet run --project windows/tests/Aura.Windows.Tests.csproj` — reglas, horas de recordatorio, Laya ligera C# = Python, SSE, cortador de frases, resorte.
- App: `./windows/scripts/publish.ps1` en Windows con .NET 10 (también compila en Linux con `EnableWindowsTargeting`, sin poder ejecutarse).
- CI (`.github/workflows/aura-windows.yml`, Windows): pruebas, .exe, **capturas reales de cada estado del notch**, conversación completa contra un servidor AU-RA simulado (`gateway/fixture-aura.mjs`), llamadas, escritura real en el Bloc de notas, instalador, instalar y desinstalar.

## Límites

- Lo probado en CI usa un servidor simulado: no acredita el Qwen, la voz ni el oído de producción, ni un micrófono físico. Eso se prueba en la PC.
- La escritura directa es para Word y el Bloc de notas (UI Automation, con foco verificado). No hay control universal del escritorio.
- Laya del nodo necesita que se entrene y se reinicie el servicio en la T4 (no hay acceso desde aquí).
- Sin firma Authenticode del propietario: SmartScreen puede avisar la primera vez.
- Las llamadas usan el servicio aparte de `windows/gateway` (opcional, configurable en Ajustes).
- `windows/training/` es el candidato anterior de Codex (1/10 en su prueba); queda como historial, reemplazado por Laya «windows» del nodo.
