# Laya «windows»: la mano de AURA para Windows

Un grupo exclusivo, `win`: exactamente una etiqueta por frase. La lee el servidor AU-RA en
`POST /api/windows/intencion` (server/windows-rutas.ts) para el .exe de `windows/`.

Etiquetas (salen del código del .exe, `windows/src/Aura.Windows.Core/Manos.cs`):

- `win_ninguna`: conversación, pregunta, algo que se cuenta o una negación → va al cerebro.
- Abrir: `win_abrir_app` (aplicación instalada), `win_abrir_carpeta` (Documentos, Descargas…), `win_abrir_web` (un sitio concreto), `win_buscar_web` (un tema en internet).
- Texto: `win_escribir` (escribir o pegar en la ventana activa, Word o Bloc de notas), `win_redactar` (componer un documento nuevo en el borrador).
- Pantalla: `win_ver_pantalla` (mirar y explicar), `win_captura` (guardar un screenshot).
- Sonido: `win_volumen_subir`, `win_volumen_bajar`, `win_silenciar`, `win_multimedia_pausa`, `win_multimedia_siguiente` (también la anterior).
- Tiempo: `win_recordar` (recordatorio o temporizador en el notch).
- AURA: `win_callar` (que deje de hablar), `win_pausa` (detener todas las acciones), `win_abrir_chat`, `win_ocultar`, `win_avatar`.
- Sistema: `win_escritorio` (mostrar el escritorio), `win_bloquear`.

Reglas de etiquetado:

- Lo que se CUENTA no es orden: «ayer abrí Word y se trabó» → `win_ninguna`.
- Preguntar CÓMO se hace algo no es hacerlo: «¿cómo hago una captura?» → `win_ninguna`.
- Preguntar si AURA recuerda un dato no es un recordatorio: «¿te acuerdas de…?» → `win_ninguna`.
- Una negación («no abras nada») → `win_ninguna`.
- `win_escribir` lleva texto literal o «escríbelo»; `win_redactar` pide que AURA componga.
- `win_callar` es la voz de AURA; `win_multimedia_pausa` es la música; `win_pausa` son todas las acciones.
- Dos órdenes en una frase: la primera.

Laya decide QUÉ mano; qué app, qué texto o a qué hora lo sacan las reglas del .exe. Escribir en otra
ventana y bloquear siempre esperan el «sí».

Datos: `generador/generar.py` (determinista). Entrenamiento `datos/train_a.jsonl`; validación
`datos/val.jsonl` (la usa la Laya ligera); prueba `datos/test.jsonl` con plantillas y valores que el
entrenamiento no vio; bordes escritos a mano en `datos/bordes.jsonl`.
