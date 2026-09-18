# ULTRON FP — Qwen3-TTS (nodo T4)

## Decisión de nodo (VRAM / latencia)

| Opción | Recurso | VRAM / tipo | Veredicto |
|--------|---------|-------------|-----------|
| **a) T4 dedicada** | `i-02653feadc919d3a4` g4dn.xlarge | **T4 16 GB** | **Elegida** — ya fue nodo de voz; ~1–3 s/frase VoiceDesign 1.7B |
| b) Playwright | `34.229.88.165` t3.large | CPU, scraping | No — sin GPU, carga headless |
| c) CPU only | cualquiera | 0 GPU | Latencia 10–40 s/frase; no sirve junta en vivo |
| — Qwen 27B | `34.207.148.69` g5 A10G | saturado | **Prohibido** |

Qwen3-TTS VoiceDesign ~1.7B cabe holgado en T4 16 GB (bf16 ≈ 4–6 GB + KV).

## Pipeline desk

`Qwen3-TTS (T4)` → `ElevenLabs` (si hay key) → Web Speech (cliente)

## Endpoints desk (`server.ts`)

| Método | Ruta | Qué hace |
|--------|------|----------|
| `POST` | `/api/tts/synthesize` | Normaliza números + sintetiza (voz `jarvis\|formal\|tierna\|estrategia\|orbita`) |
| `GET` | `/api/tts/voces` | Catálogo 5 voces + # expresiones |
| `GET` | `/api/tts/status` | Proxy config + ping `/salud` T4 |
| `GET` | `/api/tts/normalize?text=` | Prueba normalizador |
| `GET` | `/api/aws/tts-node` | `DescribeInstances` T4 |
| `POST` | `/api/aws/tts-node/start` | `StartInstances` T4 |
| `GET/POST` | `/api/memoria/personas` | Memoria de personas (persistida en `data/person-memory.json`) |
| `POST` | `/api/vault/elevenlabs/synthesize` | Misma cadena con fallback ElevenLabs |

## Env Render

```
ULTRON_TTS_URL=http://<PUBLIC_IP_T4>:8790
ULTRON_TTS_CLAVE=…
ULTRON_TTS_INSTANCE_ID=i-02653feadc919d3a4
AWS_ACCESS_KEY_ID=…   # con ec2:StartInstances / Describe
AWS_SECRET_ACCESS_KEY=…
EXPO_TOKEN=…          # solo para EAS APK
ELEVENLABS_API_KEY=…  # fallback opcional
```

## Voces

1. **JARVIS** (default) — butler calmado, LATAM  
2. **FORMAL** — junta  
3. **TIERNA** — suave / cara luminosa  
4. **ESTRATEGIA** — analítica / Cerebro  
5. **ÓRBITA** — exploradora / creativa  

## Arranque T4

```bash
export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=…
bash scripts/bring-up-tts.sh
# SSH/SSM → cd tts-node && ULTRON_TTS_CLAVE=… bash deploy.sh
```
