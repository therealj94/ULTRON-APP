# Modelo de amenazas — AU-RA FP

**Público:** `/api/health`, `/api/capacidades`, `GET /api/cantar`, `/api/ultron/salud` (sin datos de usuario), `/api/nodo/listo`.

**Sin sesión, con rate limit por IP** (decisión de la junta, 19-sep-2026, para que la APK no se quede muda al caducar el token), solo lo que no despierta al cerebro: `/api/tts`, `/api/tts/stream`, `/api/voz`, `/api/stt`, `/api/vision/analyze`, `/api/cantar`, `/api/orar` (coincidencia exacta). Cuerpo de hasta 1 MB.

**Turnos** (`/api/turno`, `/api/turno/stream`, `/api/voz/agente`): sesión de AU-RA o clave de mesa (Fase 0.3, 1-oct-2026). Un turno anónimo ya no llega al 27B.

**Sesión de AU-RA** (`sesionAbreAura`): la de quien está en el padrón con acceso a AU-RA, o la de un miembro de la comunidad fuera del padrón. Una sesión de Dr Electrum (código temporal o persona solo de Electrum) no abre la mesa (Fase 0.6).

**Suspensión y sesiones ya emitidas** (SEC-04, `server/autoridad-cuenta.ts`, `exigirAutoridadVigente`): toda petición a `/api` con sesión válida pasa por la autoridad vigente de su cuenta antes de su ruta. `suspendida` (el registro `cuentas.cuenta` lo dice, o la recarga de cuentas lo vio) → 403 `cuenta_suspendida` y ese token queda cerrado de forma durable. `desconocida` (el registro falla o tarda más de 1,5 s) → 503 `autoridad_desconocida` para lecturas privadas y efectos; solo sigue la identidad configurada en el despliegue (`ULTRON_PADRON`/padrón base, no las cuentas aprobadas desde la web). Presupuesto de revocación: un «activa» se reutiliza a lo más 30 s por proceso (`AURA_AUTORIDAD_VIVE_MS`, 0–300 000); un fallo nunca extiende un permiso. Lo público inocuo (`/api/tts`, `/api/voz`, `/api/stt`, `/api/cantar`, `/api/orar`, `/api/diag`, `/api/vision/analyze`, `/api/health`, cerrar sesión) sigue. **Sin URL de cuentas** (`CUENTAS_DB_URL`/`COGNITIVO_DB_URL`/`ELECTRUM_DB_URL`) «no configurado» NO es «no suspendido»: `AURA_SUSPENSIONES=ninguna` declara que el despliegue no tiene registro de suspensiones (las sesiones valen hasta vencer); sin declararlo, en producción las sesiones de quien no está en el padrón del entorno no leen datos privados ni causan efectos; en desarrollo equivale a `ninguna`; `AURA_SUSPENSIONES=registro` exige el registro también en desarrollo. El arranque escribe en el log qué política rige.

**El pase de la voz y la autoridad** (revisión 9): cada turno de `/api/voz/llm` mira, además de que la sesión del pase siga viva, la autoridad vigente de su cuenta con la misma regla que `/api` (`autoridadSinSesion`, también la del enlace firmado de un documento): `suspendida` → el pase deja de valer; `desconocida` → una frase honesta sin cerebro ni nada de la cuenta, salvo la identidad configurada en el despliegue.

**El turno especulativo** (revisión 9). En la mesa del teléfono, con algo esperando decisión, el turno no empieza sin el POST de confirmar (`hayDecisionEsperando`); un confirmar que le gana al stream se guarda 8 s por clave (500 como mucho; nunca para una clave que ya cerró) y se aplica al abrirse. En la conversación de voz la confirmación llega después de la respuesta, así que el «no», el apartado de un borrador, el cambio de lugar y el «¿sigo?» se aplican en el acto y CADA uno se repone si el turno se descarta (`alDescartar`); lo que no se deshace (cerrar su tarjeta, gastar la mención o el aviso de lo vencido, enviar, marcar el borrador como presentado) espera a `hacer`; y el turno mantiene abierta la espera de confirmación aunque no tenga acciones. Un borrador que la persona rechazó en su panel o su ventana mientras tanto no se repone. Un intento descartado devuelve su lugar del cupo por persona (con tope: 3× el cupo por ventana).

**Lo presentado** (SEC-01, revisión 9): el texto de un borrador cuenta como presentado cuando su respuesta se entregó (el `done` del stream sin corte, el JSON de `/api/turno`, la voz al confirmarse), no al armarlo.

**Lápidas biométricas** (SEC-03, revisión 9): pasado el tope de 500 lápidas por cajón, las viejas se compactan en una marca de agua (`marcaLapidas` + `vivosEnMarca`, solo ids): quien nació hasta la marca y no está entre los vivos no vuelve desde ninguna copia.

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
