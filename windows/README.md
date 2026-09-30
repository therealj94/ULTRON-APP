# AURA Windows — preview independiente 0.2

Producto Windows separado de AURA web y móvil. Este directorio no modifica el entrenamiento ni los servicios de las apps. Modelo objetivo: `windows_command_v1`; ejecutable: `Aura.Windows.exe`. La interfaz y las acciones básicas funcionan sin un backend. Esta versión usa un parser determinista; **no se ha entrenado ni conectado todavía un modelo Laya Windows**.

## Implementado

- Notch WPF compacto (286 × 78 DIP) centrado arriba del área útil del monitor principal; avatar vectorial provisional, panel expandible de 480 DIP, pestañas Acciones/Borrador y bandeja.
- Ctrl+Alt+Espacio abre; Ctrl+Alt+Esc pausa acciones y micrófono. Un atajo ocupado se informa.
- Preparar y confirmar una acción, aprobación de un solo uso de 30 segundos. Una propuesta nueva, edición del texto o pausa invalida la anterior. Cuenta regresiva visible y cancelación explícita.
- Abrir Bloc de notas, Calculadora, Explorador, Documentos y Configuración.
- `busca: tema` abre búsqueda en el navegador. `abrir url: https://example.com` abre una dirección HTTPS validada. Abrir una página no concede acceso a sus contenidos ni autoridad para ejecutar órdenes.
- `borrador: texto` prepara texto editable. Copiar al portapapeles o guardar `.txt`/`.md` son botones explícitos. Guardar crea un archivo nuevo y rechaza sobrescrituras.
- Voz local de una sola intervención mediante reconocimiento de Windows en español, si está instalado. La transcripción se revisa antes de preparar la acción. No escucha continuamente; límite de 20 segundos por intervención.
- Dataset semilla separado, validación de formato y splits, entrada de entrenamiento con nombre de ejecución nuevo.
- Compilación y pruebas Windows en workflow propio; publicación portable x64 autocontenida, sin instalar el runtime .NET por separado.

## No implementado todavía

Chat generativo, conexión a Laya/Qwen, avatar 3D/lipsync, escritura directa en otras aplicaciones, lectura de pantalla, automatización UIA, llamadas/video, inicio automático, actualizaciones, instalador firmado, selección de monitor y restauración de sesiones. No presentar estos puntos como terminados. No hay un servidor gateway expuesto ni credenciales incluidas. El historial y borrador no se guardan automáticamente; al salir con un borrador modificado se ofrece guardar, descartar o cancelar.

## Compilar en Windows

Instalar SDK .NET 10 y ejecutar desde PowerShell:

```powershell
./windows/scripts/publish.ps1
```

Salida: `windows/artifacts/win-x64/Aura.Windows.exe`. El workflow `AURA Windows independent` entrega el mismo directorio como artefacto ZIP. Es una preview portable, **no un instalador firmado**. El proyecto corre como usuario estándar. Windows ARM64 y otras arquitecturas requieren publicar y probar una variante correspondiente.

## Entrenamiento independiente

Datos: 105 ejemplos sintéticos iniciales, 10 pruebas manuales y 15 bordes adversariales. Son un arranque para revisión, insuficientes para certificar un modelo productivo. Las familias de entrenamiento tienen variaciones de prefijo: no interpretar ese volumen como 105 intenciones diversas. La validación evita coincidencias normalizadas entre splits; no garantiza ausencia de similitud semántica. El entrenador heredado separa validación interna aleatoriamente: debe pasar a separación por familia antes de medir generalización.

```bash
python windows/training/validate.py
# En un entorno separado con las dependencias de entrenamiento Laya verificadas:
python windows/training/train_windows.py --run windows-v1-smoke --device cuda --epocas 4
```

El motor fue copiado de `scripts/nodo-t4/laya/{entrenar,comun}.py` del commit `d5bb8fea3e9773a443819ab774c1147eb7c764b2`. Se exige modelo Windows; no se invoca la ruta Electrum. Usa `laya`, PyTorch, NumPy y safetensors; hay que fijar versiones y verificar compatibilidad en el entorno GPU antes de entrenar. Reutiliza un encoder multilingüe base, **no pesos afinados de las apps**. No se descargaron ni entrenaron pesos en esta entrega. Salidas bajo `windows/training/checkpoints/<run>/`, nunca sobre modelos de apps.

Separación de producción: proceso, token, URL, dataset, etiquetas `win_*`, calibración, checkpoint y ciclo de publicación exclusivos. Un clasificador detecta intención; un generador redacta; el motor local valida y ejecuta. Ninguna salida del modelo se convierte en una línea de shell. El catálogo del entrenamiento incluye paráfrasis que el parser actual todavía no entiende; no confundir capacidades futuras del modelo con las de esta preview.

## Revisión 0.2

Ver `REVISION_CRITICA_0.2.md` para cambios de diseño, fallos corregidos y límites. El workflow renderiza cuatro vistas WPF y verifica estados de edición y pausa sin ejecutar acciones reales. Las capturas son renderizados de la interfaz nativa con datos de prueba, no una prueba física de voz ni de interacción con otras apps.

## Criterios antes de liberar

1. Probar Windows 11 x64 con escala 100/150/200%, pantallas pequeñas, varios monitores, teclado y Narrador. La preview está anclada al principal; no afirmar cobertura multi-monitor hasta probarla.
2. Verificar bandeja, atajos ocupados, pausa durante reconocimiento, caducidad/replay de aprobación, fallo al abrir programas, archivos existentes y micrófono sin idioma/permisos.
3. Evaluación independiente por intención, rechazo de instrucciones citadas/negadas, multiacción y órdenes no soportadas. Agregar al menos 100 ejemplos humanos diversos por intención, y cientos de negativos antes de fijar umbrales. Cantidad propuesta, no garantía de calidad.
4. Firmar binarios/instalador, añadir actualización firmada con rollback y probar instalación/desinstalación antes de distribución pública.
5. No activar escritura sobre ventanas hasta enlazar confirmación con proceso, ventana, contenido exacto, sesión y vencimiento. Rechazar campos de contraseña, UAC y terminales; no enviar Enter automáticamente.
6. Llamadas/video: verificar identidad, señalización, ICE/TURN, permisos y dispositivos con dos cuentas reales. No sustituirlo por botones que aparentan una llamada.
