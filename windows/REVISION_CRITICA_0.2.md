# AURA Windows 0.2 — revisión crítica y entrega

## Dictamen

La preview inicial era una base técnica compilable, pero su diseño y manejo de estados no justificaban llamarla producto terminado. Esta revisión corrige defectos concretos y prepara una versión local más coherente. Sigue siendo una preview: el asistente integral con modelo Windows entrenado, chat, escritura en otras apps y comunicaciones no está completo.

## Cambios implementados

| Hallazgo | Consecuencia | Corrección 0.2 |
|---|---|---|
| Notch de 420 × 92 DIP con demasiados controles | Ocupación excesiva del escritorio | Notch cerrado 286 × 78; panel expandido 480 DIP; límites del área útil |
| Editor, acciones y controles en una sola columna extensa | Sobrecarga y desplazamiento | Pestañas Acciones/Borrador con estado compartido |
| Botones sin estilo de interacción consistente | Diseño genérico y foco poco claro | Plantillas redondeadas, contraste, estados hover, foco y deshabilitado |
| Nombres internos como OpenCalculator visibles | Lenguaje técnico para el usuario | Descripción natural en español |
| Modificar texto no invalidaba propuesta anterior | Ejecutar una orden distinta de la que el usuario acaba de escribir | TextChanged cancela aprobación y pide preparar de nuevo |
| Confirmación visible después de vencer | Parecía disponible aunque ya no lo estaba | Cuenta regresiva y retirada automática al caducar |
| Sin botón de cancelar propuesta | Control insuficiente | Cancelación explícita y Escape |
| Borrador perdido silenciosamente al salir | Pérdida de trabajo | Diálogo guardar/descartar/cancelar |
| Preparar otro borrador sustituía el anterior | Pérdida de texto sin advertencia | Confirmación adicional de reemplazo |
| Pausa durante diálogo de guardar | Posible escritura posterior a la pausa | Revalidación de pausa tras cerrar el diálogo |
| Escucha sin límite total fijo | Micrófono activo más tiempo del esperado | Límite total de 20 segundos y parada visible |
| UI seguía ofreciendo copiar/guardar en pausa | Acciones que parecían no responder | Botones deshabilitados y control único Pausar/Reanudar |
| Validador de propuesta aceptaba valores de enum desconocidos | Contrato menos estricto | Lista de tipos definidos y validación de argumentos antes de proponer/ejecutar |
| Texto claro sobre botón menta detectado en la primera captura | Contraste insuficiente | Texto oscuro en botones primarios; corregida herencia de estilos |
| Pausa quedaba fuera del área visible en la primera captura | Dificultad para detener acciones | Confirmación y controles de pausa fijos fuera del área desplazable |
| Sin evidencia visual de WPF | Riesgo de evaluar solo el código XAML | Render nativo de cuatro estados en Windows CI y revisión de las imágenes |

## Separación del producto

Solo se editan `windows/` y `.github/workflows/aura-windows.yml`. El modelo `windows_command_v1` mantiene datos, nombres de clases y salida separados. No se reentrenan ni se despliegan modelos de las apps. No se fusiona el PR automáticamente.

## Qué hace hoy

Abrir herramientas permitidas de Windows; abrir Documentos y Configuración; buscar en el navegador; abrir URLs HTTPS con restricciones; preparar texto proporcionado por el usuario; editar, copiar y guardar archivos nuevos; transcribir una intervención si Windows tiene reconocimiento español disponible; pausar y cancelar propuestas.

No se llama chat inteligente a un parser. No se llama generación de documentos a copiar un texto recibido. No se llama avatar 3D al rostro vectorial. El reconocimiento de voz proviene de Windows, no de un modelo propio entrenado.

## Uso

1. Descargar `AURA-Windows-x64-preview` desde la ejecución Windows del PR #85 y extraer el ZIP.
2. Ejecutar `Aura.Windows.exe` en Windows x64. No requiere instalar el runtime .NET; el binario incluye sus dependencias. La compilación es portable y no está firmada para distribución pública.
3. Tocar la cara de AURA o Ctrl+Alt+Espacio para desplegar el panel.
4. Elegir una acción o escribir `abre documentos`, `busca: clima en Roatán` o `borrador: tu texto`.
5. Revisar la propuesta y confirmar antes de que caduque. Editar el texto exige una nueva propuesta.
6. Usar Borrador para editar, copiar o guardar. Si un archivo ya existe, elegir otro nombre; no se sobrescribe.
7. Ctrl+Alt+Esc pausa propuestas y micrófono. No revierte acciones completadas ni cierra programas abiertos.

## Pruebas y límites de la evidencia

Las pruebas de núcleo verifican rechazo de negaciones, citas, shell y multiacciones; URL permitida/rechazada; aprobación de un solo uso, vencimiento, reemplazo y pausa; tipos y argumentos inválidos. El render WPF verifica que la vista se construye, que editar cancela la aprobación y que pausa deshabilita controles. Usa datos de prueba y nunca ejecuta acciones del sistema.

Las pruebas de CI no reemplazan revisión física de micrófono, Narrador, DPI mixto, monitor desconectado ni interacción con aplicaciones instaladas. Las capturas deben revisarse visualmente antes de distribuir. El destino actual sigue siendo el monitor principal; selector de monitor pendiente. Alto contraste del sistema y movimiento reducido requieren evaluación adicional.

## Pendientes que impiden llamar terminado al producto completo

- Entrenar y evaluar un checkpoint Windows. Los datos actuales son solo 130 ejemplos semilla; no acreditan precisión.
- Endpoint de inferencia y autenticación independientes; no se debe reutilizar el modelo productivo de las apps.
- Generador para conversación y documentos, con cancelación y sesiones correctas.
- Escritura sobre aplicaciones mediante UIA, objetivo estable y controles protegidos rechazados.
- Avatar final de marca, animaciones y lipsync sincronizado con audio real.
- Identidad, señalización, ICE/TURN y pruebas entre cuentas para llamadas/video.
- Instalador firmado, actualización verificada, recuperación y desinstalación.

Estos puntos requieren implementación y pruebas adicionales; no se resuelven con una mejora estética ni con un plan. Para completar las integraciones se necesita disponer de los contratos/endpoints de Windows y un entorno de inferencia/entrenamiento configurado. Las credenciales deben establecerse como secretos del servidor, no incluirse en este documento ni en el cliente.

## Evidencia verificada de esta revisión

- Código evaluado: `32d91324ab395345128f94584a578069a8aef114`.
- Ejecución: https://github.com/therealj94/ULTRON-APP/actions/runs/36686236608
- 30 comprobaciones C# aprobadas; validación de datos Python aprobada; render WPF con verificaciones de edición y pausa aprobado.
- Se inspeccionaron visualmente las vistas de acciones, borrador y pausa. Se corrigieron contraste y posición de controles a partir de la primera tanda de capturas; la segunda muestra confirmación y pausa visibles y texto oscuro en botones principales.
- El notch cerrado también se renderizó. Avatar vectorial provisional; no es el avatar 3D final.
- Ejecutable portable: artefacto `AURA-Windows-x64-preview`, ID `11083094366`, ZIP de 71,423,692 bytes. El entorno no permite adjuntar directamente ese binario por su límite de transferencia; descargar desde el workflow.
- SHA256 del ejecutable reportado por CI: `6173BC5653A8B520E2039DAFBAEE27AAF91C8AC0ECB8E0B00AFB49E5D1E9C2ED`.
- SHA256 del ZIP reportado por GitHub: `9ec0070266e485f728ef75ce325f14623a999cfb16c2de3564dc37feb8ff5572`.
- Capturas: `AURA-Windows-design-review`, ID `11083189030`.
- Retención de estos artefactos en GitHub: hasta el 14 de octubre de 2026, según el workflow. Código y documentos permanecen en PR #85; se puede recompilar.
- No se probó ejecución física con micrófono ni se entrenaron pesos. No se afirma cobertura integral del producto.
