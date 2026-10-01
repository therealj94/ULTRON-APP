# Modelo de amenazas — AU-RA FP

**Público:** `/api/health`, `/api/capacidades`, `GET /api/cantar`, `/api/ultron/salud` (sin datos de usuario), `/api/nodo/listo`.

**Sin sesión, con rate limit por IP** (decisión de la junta, 19-sep-2026, para que la APK no se quede muda al caducar el token), solo lo que no despierta al cerebro: `/api/tts`, `/api/tts/stream`, `/api/voz`, `/api/stt`, `/api/vision/analyze`, `/api/cantar`, `/api/orar` (coincidencia exacta). Cuerpo de hasta 1 MB.

**Turnos** (`/api/turno`, `/api/turno/stream`, `/api/voz/agente`): sesión de AU-RA o clave de mesa (Fase 0.3, 1-oct-2026). Un turno anónimo ya no llega al 27B.

**Sesión de AU-RA** (`sesionAbreAura`): la de quien está en el padrón con acceso a AU-RA, o la de un miembro de la comunidad fuera del padrón. Una sesión de Dr Electrum (código temporal o persona solo de Electrum) no abre la mesa (Fase 0.6).

**Modo desarrollo** solo con `AURA_DEV=1` o `NODE_ENV=test`; sin `NODE_ENV` el servidor se porta como producción (Fase 0.2).

**Cuerpo:** 1 MB por omisión; 12 MB solo en las rutas de foto/PDF/audio y con credencial (Fase 0.4).

**Sesión firmada obligatoria** (`x-ultron-sesion`, HMAC, 14 días): `POST /api/memoria`, `/api/vault/*`, `/api/ejecutar`, `/api/render/deploy`, `/api/playwright/scrape`, `/api/taller`, `/api/sistema`, `/api/tareas`.

**Mando** (redespliegue, mantenimiento, ejecutor, escribir bóveda, borrar memoria de junta): solo José o Medardo con identidad verificada (sesión o Telegram). `puedeCambiarSistema(null) === false`. El body nunca escala.

**Ejecutor:** en producción solo con sandbox remoto (`EJECUTOR_URL`, con `EJECUTOR_SECRETO` en `x-ejecutor-secreto`) o Docker (`EJECUTOR_DOCKER=1`). Nunca `python3` en el host de Render. El código que escribe el modelo solo se ejecuta si alguien con mando lo pidió de forma explícita.

**SSRF:** toda URL que abre el ojo o el lector pasa por `urlPublica` (bloquea localhost, privadas v4/v6, link-local, CGNAT, metadata).

**TLS:** el certificado autofirmado del nodo Qwen se acepta solo para ese host (dispatcher propio). No se toca el TLS global del proceso. Pendiente: verificarlo de verdad y pasar el ojo a https (docs/entregas/FASE-0.md, 0.10).

**Bóveda:** solo booleanos `configured`; nunca valores.

**Telegram:** webhook con secreto en tiempo constante; allow-list por chat/usuario; fotos y notas de voz vuelven al chat que las pidió.

**Rate limit:** por `req.ip` (Render pone la IP real con `trust proxy`) y ruta; el body no cuenta.

**Secretos:** nunca en el repo. Las claves compartidas en chat durante el desarrollo deben rotarse.
