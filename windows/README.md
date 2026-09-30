# AURA para Windows 1.2

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

## Música, correo y agenda (1.2)

- **Lo que suena, como la isla de Apple:** cualquier app que se anuncie a Windows (Spotify, YouTube Music, Chrome/Edge con YouTube, el reproductor) aparece en el notch: en reposo, su portada y unas barritas; al cambiar de canción, una tarjeta con portada, canción, artista, progreso y ⏮ ⏯ ⏭. «¿Qué está sonando?», «pon Bad Bunny en Spotify», «ponme salsa en YouTube Music». Pausa/siguiente usan el control multimedia de Windows (y las teclas si no hay). Sin cuentas ni claves. Elegir y reproducir UNA canción exacta necesitaría la API de Spotify con su inicio de sesión: por ahora abre la búsqueda.
- **Correo (Gmail, Yahoo, iCloud, IMAP):** con una **contraseña de aplicación**, revisa cada minuto y avisa en el notch de cada correo nuevo («Correo de Karla · La junta se movió…», con botón Leer). «Léeme mis correos», «¿tengo correos nuevos?», «resume mis correos» (este último manda el texto al cerebro). Solo lee: nada se marca como leído ni se borra. Outlook.com ya no acepta contraseñas por IMAP (pide inicio de sesión moderno): pendiente.
- **Agenda:** con la «dirección secreta en formato iCal» de Google Calendar (u Outlook, iCloud) avisa **10 min antes** de cada evento y contesta «¿qué tengo hoy/mañana?», «¿cuál es mi próxima reunión?». Entiende zonas horarias, eventos de todo el día y repeticiones comunes.
- **Fluidez medida:** el CI pasa el notch real por todos sus estados midiendo cada fotograma; falla si hay tirones (p95 > 100 ms) o si dibujar la silueta cuesta más de 8 ms. El brillo ahora entra y sale suave y, apagado, no se dibuja.

## Nativo (1.1)

- **Leer la pantalla sin mandar imágenes:** el texto real de la ventana de trabajo con UI Automation y, si trae poco, el **OCR de Windows**, todo en este equipo. Al cerebro va solo el texto (con la pregunta); sin red, AURA lo lee ella misma. Los campos de contraseña nunca se leen.
- **Pulsar por nombre:** «dale a Guardar», «abre la pestaña Insertar», «haz clic en Aceptar» con UI Automation (Invocar / Seleccionar / Expandir / Alternar), sin mover el ratón ni adivinar por la imagen. «Qué botones hay» los lee. Si el nombre suena a algo con efecto (Enviar, Eliminar, Pagar, Instalar…), primero pregunta.
- **Ventanas:** «cambia a Chrome» (si no está abierta, la abre), minimizar, maximizar, restaurar; «cierra esta ventana» pide el «sí» y la app pregunta si guardar.
- **El equipo:** hora, fecha, batería, espacio en disco, red y memoria, contestados al instante y sin internet.
- **Portapapeles:** «lee lo que copié» (aquí) o «resume / traduce / corrige lo que copié» (con el cerebro).
- **Archivos:** «abre la última descarga», «abre el archivo del contrato» (Descargas, Escritorio, Documentos y OneDrive). Un programa o instalador espera el «sí».
- **Voz y oído de Windows:** si el servidor no contesta, habla con las voces de Windows (por el mismo altavoz: la boca se mueve igual) y oye con el dictado de Windows. En Ajustes se pueden dejar siempre así.

Lo único que sigue necesitando el servidor es el **cerebro** (Qwen): las respuestas abiertas y redactar. Todo lo demás funciona sin internet.

## Qué hace («manos»)

Abrir apps (menú Inicio y apps de la Tienda), carpetas, páginas y archivos; buscar en internet; **leer tu pantalla** y explicarla (nativo, ver arriba); pulsar controles por nombre; manejar ventanas; hora, batería, disco y red; guardar capturas; volumen, silencio y música; mostrar el escritorio; **recordatorios en el notch**; **redactar documentos** (el cerebro los escribe y quedan en el borrador); **escribir en Word o el Bloc de notas** (confirmado); bloquear el equipo (confirmado); cambiar de avatar; callar y pausar. Nada de consola ni comandos arbitrarios.

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
- 31 manos desde la 1.2 (música, correo y agenda se suman a pulsar, qué hay, ventanas, información, portapapeles y archivos). **El modelo del nodo hay que reentrenarlo con `windows`** para que las conozca.
- La ligera NUNCA decide sola lo que tiene efecto o molesta si se equivoca (avatar, captura, bloquear, escribir, pulsar, ventanas, pausa, escritorio, silencio): eso solo por reglas exactas o Laya del nodo.
- Cifras honestas de la ligera (prueba apartada): exactitud 0,73; con su umbral decide sola el 27 % y acierta el 94 % de lo que decide (la compuerta pedía 97 %: por eso las reglas van antes y lo dudoso sube al nodo o al cerebro). El modelo del nodo se mide al entrenarse allí.

## Empezar

Instalar `AURA-Windows-Setup-1.0.0-x64.exe` (por usuario, sin permisos de administrador). El notch aparece arriba. En **Ajustes**: servidor (`https://aura-fp.onrender.com` por defecto), tu correo y clave de AU-RA → **Entrar**. La clave y la sesión quedan cifradas con DPAPI. Sin sesión, conversar funciona igual (decisión de la junta); memoria, perfil y Laya del nodo necesitan la cuenta.

## Compilar y probar

- Núcleo (corre en cualquier sistema): `dotnet run --project windows/tests/Aura.Windows.Tests.csproj` — 198 comprobaciones (incluye el lector iCal): reglas, casos de la auditoría, horas de recordatorio, confirmaciones, Laya ligera C# = Python, SSE, cortador de frases, resorte.
- App: `./windows/scripts/publish.ps1` en Windows con .NET 10 (también compila en Linux con `EnableWindowsTargeting`, sin poder ejecutarse).
- CI (`.github/workflows/aura-windows.yml`, Windows): pruebas, .exe, **capturas reales de cada estado del notch**, conversación completa contra un servidor AU-RA simulado (`gateway/fixture-aura.mjs`), **prueba nativa** (UI Automation leyendo el Bloc de notas, OCR de Windows, controles por nombre, ventanas, información del equipo, voz de Windows), llamadas, escritura real en el Bloc de notas, instalador, instalar y desinstalar.

## Auditoría (1.1)

Una revisión independiente del código 1.0 encontró y se corrigió:
- Reintento tras 401 sin tope de tiempo y respuestas no-JSON que dejaban el notch en «pensando»: un solo reloj, errores claros y la UI se limpia con cualquier fallo.
- Ráfaga de logins con una clave vieja: una renovación a la vez, pausa de 2 min tras un fallo y Laya del nodo nunca renueva.
- «Sí, pero mejor no» confirmaba: ahora solo un sí limpio confirma y cualquier «no» cancela.
- Escribir en Word justo después de un borrador fallaba porque el panel tenía el foco: AURA devuelve el foco a tu ventana y el panel no lo roba al confirmar.
- Ajustes pisaba recordatorios y el token: solo se copian los campos editados.
- Micrófono abierto de más, frases vacías en bucle, la palabra de activación disparada por su propia voz, avisos que pisaban lo que decías, parpadeo entre frases y movimiento reducido: corregidos.
- Horas: «12 de la noche», «1 de la noche» y «de dos horas a las 5»; «no me dejes olvidar» ya crea el recordatorio.
- Conversación tomada por orden («vamos a hablar…», «show me how…», «pon atención», «la canción anterior era mejor»): los verbos ambiguos solo abren algo conocido y las órdenes van ancladas al imperativo.

## Límites

- Lo probado en CI usa un servidor simulado: no acredita el Qwen, la voz ni el oído de producción, ni un micrófono físico. Eso se prueba en la PC.
- La escritura directa es para Word y el Bloc de notas (UI Automation, con foco verificado). No hay control universal del escritorio.
- Laya del nodo necesita que se entrene y se reinicie el servicio en la T4 (no hay acceso desde aquí).
- Sin firma Authenticode del propietario: SmartScreen puede avisar la primera vez.
- Las llamadas usan el servicio aparte de `windows/gateway` (opcional, configurable en Ajustes).
- `windows/training/` es el candidato anterior de Codex (1/10 en su prueba); queda como historial, reemplazado por Laya «windows» del nodo.
