# Servicio independiente AURA Windows

Node 22+, sin paquetes npm. No modifica servicios, modelos ni credenciales de las apps.

1. Configurar `WINDOWS_API_TOKEN` con al menos 32 caracteres aleatorios, `WINDOWS_CHAT_MODEL` con el nombre real del modelo instalado y `WINDOWS_MODEL_URL` con su endpoint. `.env.example` enumera opciones; cargarlo mediante el gestor del servicio, no copiar claves al código.
2. Ejecutar `node server.mjs`. Por defecto escucha solo en `127.0.0.1:8787`.
3. En AURA Windows → Conexión, establecer la URL y la clave. Windows protege esta configuración con DPAPI para el usuario actual.
4. Si se usa en varias computadoras, colocar el servicio detrás de HTTPS con un proxy y limitar su acceso. No exponer el endpoint del modelo directamente.
5. Para llamadas entre redes, configurar TURN propio con `WINDOWS_TURN_URLS` y `WINDOWS_TURN_SECRET`. El gateway emite credenciales de una hora. Sin TURN se pueden negociar conexiones directas si las redes lo permiten, pero no hay garantía de conectividad por Internet.

Qwen servido por Ollama es compatible con `/v1/chat/completions`. Para el nodo AURA que usa `/api/chat`, seleccionar `WINDOWS_MODEL_PROTOCOL=ollama`; si exige `x-ultron-secreto`, configurar `WINDOWS_MODEL_AUTH_HEADER=x-ultron-secreto` y su clave únicamente en el servidor. El generador puede compartirse; el entrenamiento y despliegue de intenciones Windows permanecen separados.

## Llamadas

Crear requiere la clave del gateway. La otra persona solo necesita la misma URL del gateway y la invitación de un uso; no necesita la clave del creador. La invitación admite un invitado y vence junto con la sala al cabo de una hora. Colgar elimina la sala; si un cliente desaparece sin avisar, la caducidad la elimina en la siguiente solicitud. No hay agenda ni identidad Genesis integrada todavía: verificar por otro canal a quién se entrega la invitación.

El servidor conserva señales SDP temporalmente en memoria, no audio/video ni mensajes del canal WebRTC. Estas señales contienen datos de conectividad; no se registran en logs. Los medios y mensajes circulan por WebRTC. No afirmar cifrado extremo a extremo adicional al transporte WebRTC ni interoperabilidad con PULSE móvil.

Señalización: creación, invitación, intercambio de oferta/respuesta, consulta incremental y cierre. La negociación recoge candidatos ICE antes de enviar SDP. No hay renegociación ni ICE restart automático; ante un corte iniciar otra llamada. Límites: 50 salas, 2 participantes, 180 solicitudes por minuto/IP y cuerpos de 256 KiB. Es una implementación para piloto, no un servicio de telefonía pública.

## Pruebas

`node --test server.test.mjs` prueba autenticación, roles de conversación, intercambio de señales, invitación de un uso, rechazo de terceros y cierre. Usa una respuesta de modelo simulada para verificar el protocolo; no mide calidad ni disponibilidad del Qwen real.
