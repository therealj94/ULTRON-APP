# ULTRON FP

Robot de escritorio tipo LOOI · agentic harness para la junta de Orden Global.

## Stack
- React + Vite + Tailwind (cara animada, voz, visión)
- Express bridge (`server.ts`) → nodos AWS Qwen + Playwright
- PWA instalable (`manifest.webmanifest` + service worker)

## Desarrollo
```bash
cp .env.example .env.local   # rellenar secretos (nunca commitear)
npm install
npm run dev
```

## Secretos (solo servidor / Render)
| Variable | Uso |
|---|---|
| `ULTRON_NODO_URL` + `ULTRON_NODO_SECRETO` | Motor Qwen (`x-ultron-secreto`) |
| `ULTRON_NODO_INSECURE_TLS=1` | Cert IP del motor |
| `ULTRON_OJO_URL` + `ULTRON_OJO_CLAVE` | Playwright ojo (`X-Ojo-Clave`) |
| `GITHUB_PAT` / `RENDER_API_KEY` / `AWS_*` | Infra |
| `ELEVENLABS_API_KEY` / `GEMINI_API_KEY` | Voz / fallback visión |

## Kiosk Android
Ver [`docs/FULLY_KIOSK.md`](docs/FULLY_KIOSK.md).
