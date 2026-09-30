# AURA Windows 0.4

Asistente nativo WPF para Windows x64, independiente de las apps móviles. Notch negro centrado arriba, expansión animada, avatar original AURA blanco/dorado con cinco estados animados, conversación integrada, voz de Windows, borradores recuperables y acciones confirmadas.

## Empezar

Instalar `AURA-Windows-Setup-0.4.0-x64.exe`. Tocar el avatar o pulsar Ctrl+Alt+Espacio. En Ajustes, introducir URL HTTPS y clave del gateway Windows de tu servidor AURA. La clave se cifra con DPAPI para el usuario de Windows. El instalador no lleva credenciales ni un modelo incorporado. Ver `gateway/README.md` para conectar el Qwen del servidor.

Para hablar: instalar reconocimiento y voz en español en Windows y tocar el micrófono. El texto reconocido se envía como conversación; las órdenes locales muestran confirmación. «Conversación continua» vuelve a escuchar al terminar la respuesta, solo tras iniciar la sesión con el micrófono. Detener o Ctrl+Alt+Esc corta escucha y respuesta. Sin voz instalada, el teclado continúa disponible.

## Capacidades

- Conversación con historial de sesión, cancelación, respuesta hablada, controles de pausa y paso de respuestas al borrador.
- Abrir Bloc de notas, Calculadora, Explorador, Documentos, Descargas, Escritorio y Configuración. Abrir aplicaciones mediante sus accesos del menú Inicio.
- Buscar en navegador, abrir URLs HTTPS, crear borradores y guardarlos como TXT/MD sin sobrescribir.
- Seleccionar el campo editable de Bloc de notas o Word con Ctrl+Alt+W, revisar el destino e insertar hasta 12.000 caracteres con párrafos. Puede reemplazar la selección actual. Si cambia foco/documento se detiene. Word requiere prueba física con la versión instalada; CI cubre Bloc de notas.
- Recuperación de borrador cifrada localmente; conversación no persistida. El borrador se conserva en LocalAppData/AuraWindows/draft.bin.
- Llamadas WebRTC para dos personas mediante gateway Windows y una invitación. TURN y pruebas entre equipos siguen siendo requisitos de despliegue.
- Avatar derivado del modelo original 3D de AURA (`aura-avatar-suite/src/aura.js`): reproducción nativa de 120 fotogramas con parpadeo, mirada y expresiones; actividad de boca vinculada a eventos de voz. Es una animación prerenderizada, no un visor 3D interactivo ni sincronía fonética exacta.

## Límites de distribución

El ejecutable funciona localmente para acciones y borradores. La conversación inteligente requiere el servidor Windows conectado al Qwen real. No se ha configurado una URL ni credenciales de producción. No hay control universal del escritorio, lectura de pantalla ni ejecución de shell. El entrenamiento candidato recuperado (run 36698779613) obtuvo 1/10 aciertos con abstención en el pequeño test semilla; no se activa ni se presenta en la interfaz. No hay entrenamiento Laya certificado, actualizador automático ni firma Authenticode del propietario. La configuración de voz y pruebas físicas de micrófono dependen del equipo.

## Compilar y verificar

En Windows con .NET 10: `./windows/scripts/publish.ps1`. Compilar instalador con Inno Setup 6 (`windows/installer/Aura.Windows.iss`). Workflow `AURA Windows independent`: pruebas C#, gateway, render nativo, conversación integrada contra proveedor de prueba, transporte WebRTC sintético, escritura real en Bloc de notas e instalación/desinstalación. Las pruebas simuladas verifican integración, no disponibilidad del Qwen productivo.

No mezclar entrenamiento, modelos ni endpoints de intenciones de las apps. El PR mantiene su rama Windows. Los documentos 0.2 y 0.3 son históricos; este README describe 0.4.
