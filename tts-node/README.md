# ULTRON FP — Nodo TTS (Qwen3-TTS)

## Decisión (datos AWS reales, cuenta 548380372606)

| Recurso | ID / IP | Tipo | Decisión |
|---------|---------|------|----------|
| Qwen 27B | `i-06530893af0dd0638` · 34.207.148.69 | **g5.xlarge A10G** | **NO tocar** (saturado) |
| Playwright / manos | `i-0b528eeae0ed61ecb` · 34.229.88.165 | **t3.large** CPU · ~100 MB proceso | **NO** (sin GPU, scraping) |
| Voz histórica | `i-02653feadc919d3a4` | **g4dn.xlarge T4 16 GB** (stopped) | **SÍ — reactivar** |

Nombre: `aura-gpu-T4-APAGADA (voz movida a ElevenLabs 5-sep)`.
Ya fue el nodo de voz (puerto 8123 en SG). Mejor opción: reutilizarla para Qwen3-TTS.

## Arranque

1. **Rotar** la access key que se pegó en chat (AWS la puso en `AWSCompromisedKeyQuarantineV3`).
2. Con un usuario con permiso `ec2:StartInstances`:
   ```bash
   aws ec2 start-instances --instance-ids i-02653feadc919d3a4 --region us-east-1
   ```
3. Abrir **TCP 8790** en SG `sg-0b55186eab43ac7cb` (o reusar 8123).
4. En la instancia:
   ```bash
   export ULTRON_TTS_CLAVE='…secreto…'
   bash deploy.sh
   ```
5. En Render (`ultron-looi-desk`):
   ```
   ULTRON_TTS_URL=http://<PUBLIC_IP>:8790
   ULTRON_TTS_CLAVE=…mismo secreto…
   ```

## Endpoints del nodo

- `GET /salud`
- `GET /voces`
- `POST /synthesize` `{ text, voice, language, instruct }` → `audio/wav`
