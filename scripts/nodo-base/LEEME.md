# electrum-base: la máquina de la base, sin GPU

Desde el 11-oct-2026 reemplaza a la A10G (`aura-gpu-a10g`). Qwen se dejó: todo el cerebro contesta
con Bedrock (GLM-5 primero, Kimi K2.5 de relevo).

| Qué | Dónde | Notas |
|---|---|---|
| PostgreSQL 16 + PostGIS 3.4 + pgvector 0.6 + pg_trgm + unaccent | `:5432` en `localhost,172.31.23.219` | Base `electrum`. Solo Render (74.220.48.0/24) por `hostssl`. Certificado propio en `/etc/postgresql/16/main/tls/`; Render lo confía en el archivo secreto `electrum-db-ca.pem`. |
| Embeddings bge-m3 (TEI, versión CPU) | contenedor `embed`, `:8794` | Mismos vectores que en la GPU (coseno 0,99999). Render llega por el Caddy de la T4 (`/embed/*`). |
| Motor con secreto y TLS | `ultron-motor.py` en `:8443` | El mismo de `scripts/nodo-a10g/`. Render lo usa como `ULTRON_NODO_URL`. |
| Motor sin GPU | `ollama-bedrock.py` en `127.0.0.1:11434` | Habla como Ollama, contesta con Bedrock (us-west-2). Servicio `ollama-bedrock` con su venv en `/opt/ultron/venv` (el boto3 de Ubuntu no trae Converse). |
| AU-RA de PULSE2CHAT | `aura`, `aura-voz-nube`, `aura-vigilante.timer` | Mudado tal cual; su modelo ahora es el motor de arriba. |

- Tipo: `m7i-flex.large` (2 núcleos, 8 GB), disco gp3 de 40 GB, rol `electrum-base`
  (SSM, Bedrock solo GLM-5 y Kimi K2.5, copias en S3).
- IP fija: la Elastic IP `34.201.236.251` (`34-201-236-251.sslip.io`), la misma que tenía la A10G:
  Render no cambió de dirección.
- La A10G quedó **apagada** como respaldo. Para volver atrás: reasociar la Elastic IP a la A10G,
  encenderla, quitarle a la base `default_transaction_read_only` y devolver el `reverse_proxy` de
  `/embed/*` en el Caddy de la T4 a `172.31.23.34:8794`.
