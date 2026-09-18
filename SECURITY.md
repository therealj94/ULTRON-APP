# Modelo de amenazas — ULTRON desk

Público: solo `/api/health`.
Caro o destructivo (TTS tope 20/min, deploy, vault write, scrape, memoria write): sesión (`x-ultron-sesion`) y/o rate-limit.
Biometría no es login: exige sesión previa de junta.
Status de bóveda: `configured` boolean, nunca recortes de claves.
Playwright: URL http(s) pública; se rechaza localhost, link-local y DNS a privadas.
TLS del proceso no se apaga en global.
