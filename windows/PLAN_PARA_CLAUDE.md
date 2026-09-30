# AURA Windows: especificación y plan de continuación para Claude

Fecha: 30 de septiembre de 2026. Responsable de producto: Medardo.

## Decisión de producto

AURA Windows es un asistente de escritorio independiente de AURA web, Android e iOS. Tendrá su propio ejecutable, catálogo de acciones, entrenamiento, permisos, instalación y publicación. Compartir marca o permitir una cuenta común no significa compartir el modelo de órdenes. No cambiar las apps para hacer funcionar Windows.

La experiencia buscada es un notch pequeño arriba, centrado, con la cara de AURA. Al tocarlo, usar el atajo o hablar, se abre una conversación y una propuesta de trabajo. Debe poder preparar documentos, abrir herramientas y, en fases posteriores, operar interfaces, llamar y participar en videollamadas. La cara debe expresar el estado real: disponible, escuchando, pensando, pendiente de confirmación, trabajando, pausado y error.

## Punto de partida entregado

La implementación está bajo `windows/`, rama `codex/aura-windows-native`, PR #85. Ningún archivo funcional de web/móvil ha sido editado. El workflow nuevo está en `.github/workflows/aura-windows.yml`.

| Componente | Estado real |
|---|---|
| Ventana WPF, notch, avatar vectorial | Implementado; avatar provisional |
| Bandeja y atajos de abrir/pausa | Implementado |
| Acciones básicas, borradores y guardado | Implementado, catálogo pequeño |
| Voz Windows en español | Código integrado; requiere recognizer local; pendiente prueba con micrófono físico |
| Entrenamiento específico | Dataset semilla + validador + entrada aislada; sin pesos entrenados |
| Interpretación offline | Parser exacto, no Laya |
| Chat generativo / asistente de documentos | Pendiente conexión y desarrollo |
| Acciones UIA y escritura sobre apps | Pendiente |
| Llamadas y video | Pendiente integración y pruebas con cuentas |
| Instalador, firma y actualizaciones | Pendiente; primera salida es portable x64 |

Esta tabla delimita la preview; no convertir una función del roadmap en una afirmación de funcionamiento actual.

## Arquitectura objetivo

1. **Aura.Windows**, proceso de usuario estándar: interfaz, avatar, captura de voz activada por el usuario, diálogo de confirmación y estado de ejecución.
2. **Aura.Windows.Core**, biblioteca sin UI: contrato de acciones, clasificación de riesgo, normalización, estado de sesión, aprobaciones, colas y cancelación. Nunca acepta comandos de shell arbitrarios.
3. **Adaptadores locales**: Windows shell para destinos conocidos, UI Automation para controles semánticos, documentos para creación local, navegador para navegación explícita. Cada adaptador declara capacidades y restricciones.
4. **Windows Gateway**, servicio nuevo y opcional: autentica la sesión de Windows y contacta Laya Windows y el generador. Tokens de los modelos viven en el servidor, no en el instalador. No usar los endpoints móviles por conveniencia.
5. **Laya Windows**, clasificador independiente: determina intención y abstención; no escribe documentos ni ejecuta acciones. Su salida necesita validación local.
6. **Generador**, servicio de texto: redacta y propone planes estructurados; el borrador se muestra antes de guardarlo, escribirlo o enviarlo. Su salida no tiene autoridad de ejecución.
7. **Comunicaciones**, módulo separado: señalización, presencia, WebRTC, dispositivos y controles de llamada. Reutilizar protocolos existentes solo después de inspeccionar contratos y compatibilidad.

El conjunto debe funcionar degradado: sin red se pueden abrir programas y trabajar con borradores; si falla el modelo no se inventa una intención. Sin micrófono, teclado y botones continúan disponibles.

## Diseño de interacción

**Notch cerrado:** propuesta de tamaño final 220–280 × 54–64 DIP; avatar de 32–40 DIP, indicador de estado y expansión. La preview usa 420 × 92 DIP para disponer de controles de desarrollo: reducirlo y mover botones al panel tras pruebas de accesibilidad. No robar foco al aparecer una respuesta ni capturar teclas fuera de sus atajos. Ocultar o atenuar durante pantalla completa según preferencia. Ofrecer monitor principal/activo/elegido; recordar por identificador de pantalla y recuperar si se desconecta.

**Panel abierto:** conversación en la parte superior, tarjetas de acciones con objetivo, progreso y resultado, editor lateral o inferior de borradores, controles de voz y cancelación siempre visibles. Evitar un formulario interminable. El texto técnico y los nombres de enums de la preview deben sustituirse por etiquetas claras en español.

**Avatar:** conservar identidad AURA; emplear el recurso oficial confirmado por Medardo. Animaciones sutiles para escuchar y responder; pausa sin pulsación. Respetar movimiento reducido y alto contraste. Lipsync solo con audio efectivamente reproducido. No simular pensamiento continuo cuando no hay trabajo.

**Teclado y accesibilidad:** recorrido lógico con Tab, foco visible, Escape para cerrar panel, Enter para enviar texto salvo editor multilinea, Ctrl+Enter para preparar. Confirmación separada accesible y Narrador anunciando cambios. Evitar activar tareas solo porque se reconoció una palabra por voz.

**Llamadas:** mostrar destinatario verificado, origen de la llamada, cámara/micrófono, dispositivos elegidos y botón colgar. Cámara apagada inicialmente. Durante llamada mantener notch resumido con duración y controles. No llamar automáticamente por una inferencia ambigua.

## Contrato de acción propuesto

```json
{
  "schema": "aura.windows.action.v1",
  "id": "UUID",
  "sessionGeneration": 8,
  "source": "user",
  "kind": "document.create",
  "arguments": {"format":"txt","content":"Texto revisado"},
  "target": null,
  "requiresConfirmation": true,
  "expiresAt": "2026-09-30T12:00:30Z"
}
```

No confiar en `source`, `requiresConfirmation` ni vencimiento enviados por el modelo. Los fija el host local. Validar esquema con rechazo de propiedades desconocidas, tamaño máximo por acción y tipos permitidos. El motor genera su propio UUID y enlaza aprobación a una copia inmutable del payload. Cambiar texto/destino exige una aprobación nueva. Guardar un documento en un diálogo no implica autorizar su envío.

Para UIA añadir identificador de proceso, tiempo de inicio, handle de ventana, identificador del control y una comprobación de foco inmediatamente anterior a escribir. No bastan título de ventana ni coordenadas. Si cambia el destino, cancelar. Rechazar contraseña, controles protegidos, ventanas elevadas, UAC, terminales y editores de comandos. Nunca agregar Enter por defecto. Primera implementación solo aplicaciones verificadas; presentar una vista previa.

## Catálogo por fases

| Etapa | Capacidades | Requisito de aceptación |
|---|---|---|
| 0: base actual | Abrir herramientas, búsqueda, borrador local | Compila, pruebas de política pasan y revisión manual Windows |
| 1: conversación | Chat, generación de borradores, estado real, avatar de marca | Identidad aislada; sin secretos en cliente; cancelar no deja tareas huérfanas |
| 2: escritorio | Ventanas, escritura UIA, captura explícita de pantalla | Destino estable y campos protegidos rechazados; no ejecutar instrucciones dentro de documentos |
| 3: documentos | TXT/MD/CSV y después DOCX/PDF, carpetas de proyecto | Vista previa, ubicación elegida, sin sobrescribir, abrir y validar artefacto generado |
| 4: comunicaciones | Audio, video, compartir pantalla elegido por usuario | Pruebas entre dos cuentas y distintas redes; TURN; permisos y reconexión |
| 5: distribución | Instalador firmado, actualizaciones y rollback | Instalación limpia, desinstalación, versión anterior recuperable y firma verificada |

No asignar tiempos cerrados antes de comprobar disponibilidad de GPU, proveedor de chat, contratos de cuenta y protocolo de comunicaciones. La dependencia crítica no es el dibujo del notch: es la ejecución fiable y la autenticación correcta.

## Entrenamiento exclusivo de Windows

Nombre `windows_command_v1`, etiquetas `win_*`, dataset y checkpoint exclusivos. No mezclar con `comando`, `mensaje`, `documento` ni los ejemplos de Dr Electrum o las apps. Reutilizar un encoder multilingüe genérico es compatible con esta separación; seguir entrenando el checkpoint productivo de las apps no lo es.

El seed contiene 105 ejemplos de entrenamiento, 10 de prueba y 15 adversariales. Hay solo diez clases; no es un entrenamiento profesional acabado. Gran parte del volumen son prefijos sobre ejemplos base. Ampliar con órdenes reales revisadas por hablantes de español, variantes hondureñas, errores de dictado, lenguaje informal, referencias incompletas y preguntas que contienen verbos de acción.

Proceso exigido:

1. Definir catálogo ejecutable y esquema de argumentos antes de inventar nuevas etiquetas. Las funciones aún no soportadas deben abstenerse.
2. Separar familias de plantillas, autores y sesiones antes de generar variantes; guardar `familyId`. Hacer el split interno de validación por familia, no por fila.
3. Incluir negaciones, citas, instrucciones contenidas en webs/documentos, acciones múltiples, órdenes contradictorias, destinos ambiguos y ejemplos fuera de dominio.
4. Entrenar en entorno Windows-Laya independiente; fijar dependencias y registrar versión exacta del encoder. El motor actual usa APIs internas de Laya que necesitan una prueba de compatibilidad.
5. Guardar manifiesto con SHA256 del dataset, versiones, seed, configuración, checkpoint base, métricas y licencia del modelo. No reutilizar nombres de ejecución.
6. Medir precisión/recall por clase, matriz de confusión, calibración, tasa de abstención, exactitud de argumentos y latencia p50/p95. Evitar resumir todo en accuracy.
7. Decisión propuesta de publicación: precision de intenciones ejecutables ≥99% sobre evaluación humana suficiente y ningún caso crítico adversarial ejecutado. Estos son objetivos, no resultados. Para tasas cercanas a 0, reportar intervalo de confianza y tamaño de muestra; 15 negativos no certifican seguridad.
8. Probar el modelo en modo sombra: registra una propuesta local sin ejecutarla; comparar con anotación humana. Activación gradual y rollback propio de Windows.

La familia `win_none` necesita especial atención: agrupa charla, negaciones y fuera de catálogo. Añadir abstención por baja confianza y margen entre clases, pero calibrar umbrales con datos reales. No dar autoridad al argmax solo porque siempre produce un ganador.

## Integraciones y privacidad

- Cuenta Windows con tokens acotados y almacenamiento protegido por DPAPI/Credential Manager. Al cerrar sesión incrementar generación, invalidar tareas, limpiar conversación y descartar respuestas tardías.
- No almacenar capturas, audio o contenido de ventanas automáticamente. Antes de transmitir indicar qué se enviará y a qué servicio. Datos del entrenamiento deben recogerse con consentimiento y revisión de PII.
- Si se usa WebView2 para compatibilidad de chat, llamarlo integración web: no es un chat nativo terminado. Sin host objects ni puente hacia acciones del escritorio; restringir navegación/origen y pedir cámara/micrófono explícitamente.
- APIs propias usan TLS, límites de tamaño, timeout, cancelación y autenticación obligatoria. El servidor no acepta URL de modelo arbitraria desde el cliente.
- Auditoría local mínima con ID, tipo, estado y error; no registrar contraseñas, cuerpos de chat ni documentos. Retención y borrado visibles.

## Pruebas que debe añadir Claude

Pruebas unitarias sobre política y contratos; integración en Windows con adaptadores falsos para no tocar archivos personales; prueba manual física para dispositivos y UI. No llamar pruebas de compilación a una validación de experiencia completa.

Casos imprescindibles: pausa durante voz, evento tardío tras nueva sesión, confirmación repetida, cambio de propuesta, confirmación vencida, destino de escritura cambiado, ventana cerrada, fallo de permisos, portapapeles ocupado, archivo existente, desconexión de pantalla, Windows 150/200% DPI, monitor pequeño, narrador, atajos ocupados, red caída, inferencia tardía, llamada interrumpida y actualización fallida.

La pausa cancela lo pendiente y evita nuevas ejecuciones; no revierte aplicaciones abiertas ni acciones ya completadas. La UI debe decirlo así.

## Instrucción de continuidad para Claude

Trabaja desde `codex/aura-windows-native` y revisa primero `windows/README.md`, este documento y el resultado del workflow Windows. Mantén el producto y entrenamiento separados de web/móvil. No edites `main`, modelos de apps ni servicios productivos para completar Windows.

Primero corrige errores reales de compilación/ejecución y verifica la preview en Windows. Después completa fase 1 con contratos de API comprobados. Refactoriza `MainWindow` a ViewModels y adaptadores conforme aumente el alcance; evita añadir más lógica de negocio al code-behind. Cada PR debe describir una capacidad que realmente funciona, su prueba y lo pendiente. No usar botones decorativos para simular chat, llamadas o video. No afirmar que Laya está entrenado hasta entregar checkpoint, métricas y evaluación independiente.
