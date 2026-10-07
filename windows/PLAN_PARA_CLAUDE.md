# AURA Windows 0.4 — instrucciones de ejecución para Claude

> **Estado 30-sep-2026 (Claude):** entregado AURA para Windows 1.0 sobre esta base. Ver `windows/README.md`: notch nuevo con resortes, avatares 3D de la app, cerebro/voz/oído del mismo servidor AU-RA, Laya «windows» en el nodo y ligera en el .exe. Este plan queda como historial.

Actualizado: 30 de septiembre de 2026. Responsable de producto: la junta.
Repositorio: `therealj94/ULTRON-APP`. Rama: `codex/aura-windows-native`. PR: https://github.com/therealj94/ULTRON-APP/pull/85

Este documento reemplaza el plan anterior de la preview 0.2. Las revisiones 0.2 y 0.3 son antecedentes históricos. Usa el código actual de esta rama y el README 0.4 como punto de partida.

## Encargo de la junta

Mejorar e instalar una app nativa Windows: notch negro compacto, centrado arriba, con su avatar AURA; expansión y animaciones suaves; conversación por voz; escritura y acciones sobre la computadora; asistente útil para preparar trabajo y documentos. La junta pide ejecución y un ejecutable comprobado, no otra entrega limitada a un plan.

Mantener Windows como producto y entrenamiento independientes de AURA web/Android/iOS. Se puede compartir el generador Qwen mediante un servicio Windows con autenticación propia. No mezclar checkpoints, datos ni etiquetas con las apps. Trabajar en esta rama o una rama derivada; no fusionar a main automáticamente.

## Evidencia entregada y descarga

Código compilado: `3fc37824e10da875fbbebb90e9db9abe475290ad`.
Ejecución aprobada: https://github.com/therealj94/ULTRON-APP/actions/runs/36735412984

En Artifacts:
- `AURA-Windows-Setup-x64`: ZIP con el instalador.
- `AURA-Windows-x64-preview`: ejecutable portable con sus recursos.
- `AURA-Windows-design-review`: capturas nativas para inspección.
- `AURA-Windows-protocol-verification`: pruebas del cliente y conversación integrada.
- `AURA-Windows-desktop-verification`: escritura real en Bloc de notas.
- `AURA-Windows-RTC-verification`: transporte WebRTC sintético.
- `AURA-Windows-delivery-part-01/02/03`: fragmentos de transferencia, no tres instaladores. Usar preferentemente el ZIP Setup completo.

Instalador: `AURA-Windows-Setup-0.4.0-x64.exe`.
Tamaño: 53.699.325 bytes.
SHA256 del EXE original: `c06da989604836d537ac175165e6ee60da34440864a3ab26f4d281fcc7ad2552`.

Los artefactos de esa ejecución vencen el 14 de octubre de 2026. El código permite recompilar. Ese hash identifica exclusivamente el instalador original; una nueva compilación debe tener su propio hash y evidencia.

## Estado real

| Capacidad | Implementación y límite |
|---|---|
| Notch | WPF nativo, negro, 292 × 76 DIP, centro superior del monitor principal; panel hasta 500 × 790 DIP ajustado al área útil; transición de 280 ms |
| Avatar | AURA original blanco/dorado; cinco estados, 120 fotogramas del modelo 3D; reproducción nativa de atlas PNG; actividad de boca ligada a eventos de voz. No es un visor 3D interactivo ni lipsync fonético exacto |
| Conversación | Integrada en el panel, historial en memoria, cancelar, responder con voz y llevar respuesta al borrador. Cliente probado con proveedor simulado; Qwen productivo pendiente |
| Voz | Reconocimiento y síntesis de Windows en español; conversación continua opcional tras tocar el micrófono; prueba física de micrófono pendiente |
| Acciones | Abrir herramientas/carpetas, búsqueda web, URL HTTPS y aplicaciones desde accesos del menú Inicio; propuestas confirmadas |
| Escritura | Campo seleccionado con Ctrl+Alt+W en Bloc de notas o Word; hasta 12.000 caracteres con párrafos. Bloc de notas probado realmente; Word pendiente de prueba física |
| Borradores | Editor, copiar, TXT/MD sin sobrescritura, recuperación local cifrada con DPAPI |
| Pausa | Ctrl+Alt+Esc; invalida propuestas, cancela solicitudes y voz; detiene movimiento del avatar. No revierte acciones ya completadas |
| Llamadas/video | Gateway de señalización e invitación, WebRTC para dos personas; prueba sintética aprobada. TURN y dos equipos reales pendientes |
| Instalación | Instalador por usuario autocontenido; instalación, apertura y desinstalación aprobadas en Windows CI |
| Distribución | Sin firma Authenticode del propietario; actualizaciones manuales |
| Laya | Candidato entrenado, sin calidad suficiente ni activación en interfaz. El test pequeño con abstención obtuvo 1/10. No bajar umbrales para aparentar precisión |

No hay control universal de todas las aplicaciones, lectura general de pantalla ni conexión productiva al Qwen configurada en la entrega.

## Qué leer primero

1. `windows/README.md`.
2. `windows/src/Aura.Windows/MainWindow.xaml` y `MainWindow.xaml.cs`.
3. `Assistant.cs`: conversación, micrófono, síntesis, cancelación y recuperación.
4. `AvatarView.cs` y `AvatarAssets/`: reproducción y estados.
5. `Applications.cs`, `DesktopTarget.cs`, `LocalActions.cs`.
6. `windows/src/Aura.Windows.Core/Commands.cs`: catálogo, validación y aprobación.
7. `Connection.cs`, `SettingsWindow.cs`, `windows/gateway/README.md`, `server.mjs`, `.env.example`.
8. `CallWindow.cs`, `CallAssets/`.
9. `windows/scripts/publish.ps1`, `windows/installer/Aura.Windows.iss`, `.github/workflows/aura-windows.yml`.
10. `windows/training/` y resultados del candidato: https://github.com/therealj94/ULTRON-APP/actions/runs/36698779613

## Instalar y ejecutar en Windows

En un equipo Windows x64 autorizado, descargar y extraer el artefacto Setup. Desde su carpeta:

```powershell
Get-FileHash ./AURA-Windows-Setup-0.4.0-x64.exe -Algorithm SHA256
Start-Process ./AURA-Windows-Setup-0.4.0-x64.exe -Wait
```

Comparar con el hash anterior cuando se use el binario original. Completar el asistente de instalación por usuario. No desactivar Defender, SmartScreen ni políticas del equipo. Resolver la firma con un certificado legítimo del propietario.

Abrir AURA desde Inicio. Tocar el avatar o Ctrl+Alt+Espacio. Probar primero abrir Calculadora y crear un borrador. En Bloc de notas, hacer foco en el editor y pulsar Ctrl+Alt+W; volver al borrador, revisar el destino y confirmar escritura. No usar documentos personales durante las primeras pruebas.

Agregar reconocimiento de voz y una voz en español en Configuración de Windows, y revisar permisos de micrófono para apps de escritorio. Comprobar micrófono, salida de audio, interrupción y modo continuo con hardware real.

Si Claude solo dispone de Linux, puede revisar código y preparar despliegue, pero no afirmar que instaló la aplicación en la PC de la junta. Compilar/probar con Windows CI y entregar el EXE; registrar qué equipo Windows recibió realmente la instalación.

## Prioridad 1 — conectar el Qwen real e instalar el servicio Windows

La URL de las apps o el endpoint del modelo no son automáticamente un gateway Windows. Revisar los contratos y la configuración actual del servidor autorizado. No extraer ni publicar secretos de otros productos.

Desplegar `windows/gateway/server.mjs` como servicio independiente con Node 22 o posterior. No requiere paquetes npm. Configurar mediante un gestor de secretos o un archivo privado fuera de git:

- `WINDOWS_API_TOKEN`: token Windows propio, aleatorio, al menos 32 caracteres.
- `WINDOWS_CHAT_MODEL`: nombre exacto del Qwen instalado, confirmado en el servidor.
- `WINDOWS_MODEL_URL`: URL real de inferencia.
- `WINDOWS_MODEL_PROTOCOL=openai` para el contrato chat-completions; `ollama` para `/api/chat`.
- `WINDOWS_MODEL_KEY` y `WINDOWS_MODEL_AUTH_HEADER` solo cuando el proveedor los requiera; permanecen en el servidor.
- Dejar Laya sin activar mientras no exista un modelo evaluado apto.

`server.mjs` no carga .env implícitamente. Con un archivo privado compatible, usar Node con `--env-file=/ruta/privada/aura-windows.env`; o inyectar variables con el gestor de servicios. Mantener loopback detrás de proxy HTTPS y configurar reinicio automático. En Docker, 127.0.0.1 apunta al contenedor; no asumir que alcanza el Qwen del host. Ver Dockerfile y configurar red explícitamente.

Probar /health, /v1/status autenticado y /v1/chat contra Qwen real. Verificar acceso rechazado con token incorrecto, respuesta en español, cancelación, caída de red y recuperación. Confirmar el nombre del modelo y registrar latencia sin guardar conversaciones ni claves.

En AURA → Ajustes, introducir la URL HTTPS del gateway Windows y el token. La app los protege con DPAPI. Probar una conversación real, respuesta hablada, traslado al borrador y escritura. Si faltan acceso de despliegue, endpoint o credenciales, identificar el dato concreto faltante; nunca sustituir la conexión real por fixture-server.

## Prioridad 2 — mejorar experiencia y control del escritorio

- Conservar identidad del avatar AURA y diseño negro/dorado. Revisar tamaño, legibilidad, foco, movimiento reducido y alto contraste. Quien la usa necesita buen contraste y lectura clara.
- Verificar animaciones de expansión, escucha, pensamiento, habla y pausa; mostrar solo actividad real.
- Añadir selector de monitor, manejo de pantalla completa y recuperación al desconectar una pantalla. Probar 100/150/200% DPI y pantallas pequeñas.
- Revisar en Windows 11 moderno los títulos de pestañas de Bloc de notas: un cambio automático al escribir puede disparar la comprobación de documento. Resolver sin permitir escribir en un documento distinto.
- Probar Word instalado y ampliar adaptadores por aplicación con objetivos semánticos verificables. No anunciar soporte universal.
- Mejorar interacción natural y planes de varias acciones: catálogo tipado, objetivos visibles, confirmación vinculada al contenido/destino, cancelación y resultado por paso. El modelo propone; el ejecutor local valida.
- Evitar shell arbitrario, campos protegidos, ventanas elevadas y órdenes incrustadas en documentos. No modificar ni enviar contenido a otras personas sin la acción explícita correspondiente.
- Incorporar documentos DOCX/PDF con vista previa y validación real de los archivos; actualmente solo TXT/MD.
- Refactorizar gradualmente a ViewModels y adaptadores; no añadir toda la lógica al code-behind.

## Prioridad 3 — voz, comunicaciones y distribución

Para voz, medir tiempo de respuesta y probar eco, silencio, interrupción y eventos tardíos. Incorporar una voz de marca solo con servicio, licencia y credenciales confirmados. No incluir claves de ElevenLabs u otros proveedores en el EXE.

Para llamadas, configurar TURN propio mediante `WINDOWS_TURN_URLS` y `WINDOWS_TURN_SECRET`. Hacer llamadas entre dos equipos en redes distintas, con audio/cámara reales, mute, colgar, expiración de invitación y reconexión. La prueba sintética no acredita calidad física ni conectividad por Internet. No afirmar interoperabilidad con PULSE móvil ni agenda Genesis implementada.

Firmar binarios/instalador con certificado del propietario. Añadir actualización verificada, rollback y conservación de configuración/borradores. Usar `windows/scripts/sign.ps1` después de revisar su contrato. El certificado y las claves se configuran como secretos.

Para Laya, ampliar datos humanos diversos, splits por familias y evaluación independiente. Conservar el modelo Windows separado. Medir precisión/recall por clase, argumentos, abstención, negativos y latencia. No activar el candidato anterior ni retirar abstención para obtener una cifra atractiva.

## Compilar y criterios de entrega

En Windows con .NET 10:

```powershell
./windows/scripts/publish.ps1
& "${env:ProgramFiles(x86)}/Inno Setup 6/ISCC.exe" windows/installer/Aura.Windows.iss
```

Salida portable: `windows/artifacts/win-x64/Aura.Windows.exe`.
Salida instalador: `windows/artifacts/installer/`.

Ejecutar los checks existentes y añadir pruebas solo para riesgos/capacidades nuevas. Inspeccionar capturas nativas; probar instalación limpia, actualización y desinstalación. Separar evidencia del núcleo, proveedor simulado, Qwen real y hardware físico.

Entregar:
1. EXE con versión, tamaño, SHA256, fuente exacta y ejecución aprobada.
2. URL real del servicio Windows y conexión instalada, sin secretos en el informe.
3. Evidencia de conversación Qwen, micrófono y escritura en apps efectivamente soportadas.
4. Capturas/video de la interfaz funcionando.
5. Cambios, límites y bloqueos restantes concretos, con README y descripción del PR actualizados.

Registrar si se instaló realmente en la máquina del usuario o solo se verificó en CI. Avanzar con implementación y correcciones; no concluir el encargo con otra lista de tareas.
