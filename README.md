# ULTRON FP

Asistente con cuerpo digital para la junta directiva de **Orden Global**. Una cara viva, una voz humana y un cerebro propio. No es un chatbot: piensa, siente, reacciona y trabaja.

- **Web (mesa):** React + Vite + canvas 2D, servida por el mismo servidor Express. Producción en Render (`ultron-looi-desk`).
- **APK (Expo / React Native):** `mobile/`. Se compila sola en GitHub Actions.
- **Servidor:** `server.ts` + `server/` + `lib/`. Cerebro Qwen 3.8 27B en nodo AWS propio, ojo Playwright/visión en otro nodo, voz ElevenLabs v3, memoria en S3, Telegram de ida y vuelta.

## Correr

```bash
cp .env.example .env      # rellenar claves
npm install
npm run dev               # servidor + Vite en :3000
npm test                  # 88 tests
npm run build && npm start
```

APK: `cd mobile && npm ci && npx expo run:android`, o bajar el artefacto de la acción **Android APK**.

## Mapa del repo

| Dónde | Qué | Tocar para… |
|---|---|---|
| `lib/emocion.ts` | Contrato de emoción (14 emociones) | cambiar qué siente ULTRON |
| `lib/capacidades.ts` | Catálogo único de capacidades | añadir o quitar algo que ULTRON hace |
| `server/voz.ts` | La única voz: hablar, cantar, expresividad, caché | timbre, etiquetas de audio, repertorio |
| `server/desk.ts` | Personalidad e identidad de la junta | cómo habla, tono por modo, oído |
| `server/seguridad.ts` | Sesión firmada, rate limit, SSRF | quién entra y qué puede tocar |
| `server.ts` | Rutas `/api/*`: turno, stream, voz, canto, capacidades, memoria, Telegram | el harness y el flujo de un turno |
| `lib/` | memoria S3, Telegram, taller, PDF, visión, harness, ejecutor | herramientas del cerebro |
| `src/02-cara/` | Cara web (motor, gestos, fun pack) | expresiones, tacto, partículas |
| `src/03-voz/` | Cliente de voz: banco de clips, `hablar`, oído | qué suena en el navegador |
| `src/04-cerebro/` | Cliente del turno (stream) e intenciones locales | gags locales, qué va al cerebro |
| `src/07-pantallas/` | Arranque, Ajustes + catálogo, dock, acceso, bóveda, cámara | UI |
| `src/App.tsx` | Composición (≈ 470 líneas) | flujo de la mesa |
| `public/voz/` | Clips grabados con la voz oficial (`scripts/grabar-banco.mjs`) | frases sin red, canciones |
| `mobile/` | APK | ver `mobile/README.md` |
| `docs/` | Entrega 4.0 y planes históricos | contexto |

Reglas: la voz es una (Gabriela, ElevenLabs v3). El nodo Qwen no se toca. Nada que cambie estado pasa sin sesión firmada. Si una herramienta no respondió, ULTRON lo dice.

Detalle de qué se hizo y por qué: `docs/ENTREGA-4.0.md`.

## Dos plataformas, un cuerpo

El mismo binario sirve a dos plataformas según `ULTRON_PERFIL`:

- sin variable → **Genesis Core**, el asistente de la junta de Orden Global (lo de siempre).
- `ULTRON_PERFIL=minas` → **Cerebro de Minas**, asistente de minería para demostración, con cálculos
  de mina y padrón de concesiones, y sin un solo dato de Orden Global.

Cara, voz, emociones, ojos y oído son los mismos para las dos. Ver `docs/CEREBRO-MINAS.md`.
