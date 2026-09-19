# Modelo de amenazas — ULTRON FP

**Público:** `/api/health`, `/api/capacidades`, `GET /api/cantar`, `/api/ultron/salud` (sin datos de usuario), `/api/nodo/listo`.

**Conversación sin sesión, con rate limit por IP** (decisión de la junta, 19-sep-2026, para que la APK no se quede muda al caducar el token): `/api/turno`, `/api/turno/stream`, `/api/tts`, `/api/stt`, `/api/vision/analyze`, `POST /api/cantar`. Sin sesión: acceso de consulta, memoria atribuida solo por nombre, ningún hecho del cliente entra a largo plazo.

**Sesión firmada obligatoria** (`x-ultron-sesion`, HMAC, 14 días): `POST /api/memoria`, `/api/vault/*`, `/api/ejecutar`, `/api/render/deploy`, `/api/playwright/scrape`, `/api/taller`, `/api/sistema`, `/api/tareas`.

**Mando** (redespliegue, mantenimiento, ejecutor, escribir bóveda, borrar memoria de junta): solo José o Medardo con identidad verificada (sesión o Telegram). `puedeCambiarSistema(null) === false`. El body nunca escala.

**Ejecutor:** en producción solo con sandbox remoto (`EJECUTOR_URL`) o Docker (`EJECUTOR_DOCKER=1`). Nunca `python3` en el host de Render. El código que escribe el modelo solo se ejecuta si alguien con mando lo pidió de forma explícita.

**SSRF:** toda URL que abre el ojo o el lector pasa por `urlPublica` (bloquea localhost, privadas v4/v6, link-local, CGNAT, metadata).

**TLS:** el certificado autofirmado del nodo Qwen se acepta solo para ese host (dispatcher propio). No se toca el TLS global del proceso.

**Bóveda:** solo booleanos `configured`; nunca valores.

**Telegram:** webhook con secreto en tiempo constante; allow-list por chat/usuario; fotos y notas de voz vuelven al chat que las pidió.

**Rate limit:** por `req.ip` (Render pone la IP real con `trust proxy`) y ruta; el body no cuenta.

**Secretos:** nunca en el repo. Las claves compartidas en chat durante el desarrollo deben rotarse.
