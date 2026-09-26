# Estudio AU-RA — canto y expresiones con la voz Dora (nodo T4)

Banco pregrabado de **canciones cantadas** y **expresiones no verbales** con el timbre de Dora
(Kokoro `ef_dora` del perfil `0014442b-…` de Voicebox). Todo corre en el nodo
`i-02653feadc919d3a4` (Tesla T4 16 GB, 16 GB de RAM sin swap, 4 vCPU) bajo `/opt/estudio`.

| Pieza | Licencia | Uso |
|---|---|---|
| ACE-Step 1.5 turbo + LM 0.6B | MIT | canción completa (voz + instrumental) a partir de letra y estilo |
| Demucs htdemucs | MIT | separar voz / instrumental |
| Seed-VC (f0 44 kHz y habla 22 kHz) | GPL-3.0 | **sólo herramienta de servidor** (no se distribuye): conversión de timbre a Dora |
| Chatterbox-Turbo 0.1.6 | MIT | vocalizaciones con etiquetas `[laugh] [chuckle] [sigh] [gasp] [shush]…` (marca de agua Perth incluida) |
| Dia 1.6B-0626 (fp16) | Apache-2.0 | vocalizaciones `(laughs) (humming) (whistles)…` |
| Whisper large-v3-turbo | MIT | inteligibilidad (WER) — Whisper **propio** del estudio, funciona con Voicebox parado |
| AST AudioSet, Resemblyzer | BSD-3 / Apache-2.0 | etiqueta del sonido, similitud con Dora |

## Archivos

```
estudio.py            orquestador (subórdenes, perro guardián de RAM, exportación, manifiestos)
etapas/cantar.py      ACE-Step (entorno del repo ACE-Step)
etapas/separar.py     Demucs
etapas/convertir.py   Seed-VC (modo "canto" = f0 44.1 kHz, modo "habla" = 22 kHz)
etapas/expresar.py    Chatterbox-Turbo / Dia fp16
etapas/evaluar.py     Whisper + f0 + AST + Resemblyzer + clipping
etapas/metricas.py    métricas de canto vs habla a partir de la f0 (librosa.pyin)
ejemplos/aura.json    el pedido completo: 6 canciones + 34 expresiones
instalar.sh           instalación idempotente;  dia16_convertir.py  Dia fp32 -> fp16 (fuera del nodo)
```

## Instalación

```bash
sudo bash instalar.sh          # ~15 min, ~13 GB; exige >= 25 GB libres y deja >= 10 GB
```
Notas aprendidas:
- `setuptools<81` es obligatorio: `perth` (marca de agua de Chatterbox) importa `pkg_resources`; sin él
  `PerthImplicitWatermarker` queda en `None` y Chatterbox-Turbo no arranca.
- Chatterbox se carga con `from_local(<snapshot>)`: `from_pretrained` pide token de HF aunque esté en caché.
- `torchaudio>=2.9` necesita torchcodec para `load/save`: se lee/escribe con soundfile (Seed-VC y el prompt de Dia).
- Dia: `max_tokens` **incluye** las tramas del prompt de audio (86 tramas = 1 s); el orquestador lo suma.
- Resemblyzer 0.1.4 no tiene `trim_silence`; los clips < 2 s se repiten hasta 2 s para que el embedding
  sea estable (Dora/Kokoro real en clips de < 1 s: 0.64–0.76; frases largas: 0.90–0.98).
- **Ubicación temporal (26-09-2026)**: por falta de disco en `/` (instalación ajena `/opt/laya`),
  `modelos/dia-1.6b-0626-fp16` y `hf/hub/models--ResembleAI--chatterbox-turbo` son *symlinks* a
  `/opt/dlami/nvme/estudio-modelos/` (NVMe **efímero**: se pierde si la instancia se detiene). Si
  desaparece: borrar los symlinks, re-ejecutar `instalar.sh` (Chatterbox) y regenerar Dia fp16 con
  `dia16_convertir.py` en otra máquina (la copia de S3 se borró).

## Procedimiento de ventana (Voicebox en pausa, máx. 120 min)

1. **Antes de parar** (necesita Voicebox): referencias y lecturas habladas, e interjecciones Kokoro:
   ```bash
   cd /opt/estudio/scripts && . /opt/estudio/env.sh; P=/opt/estudio/envs/vc/bin/python
   T=/opt/dlami/nvme/estudio-trabajo/w1          # trabajo en NVMe (no gasta disco de /)
   $P estudio.py referencias ejemplos/aura.json          # /opt/estudio/refs/dora/ (d01-d08, 40.5 s)
   $P estudio.py kokoro      ejemplos/aura.json -t $T
   ```
2. **Parar** (anotar en `/opt/estudio/logs/ventana.log`) y armar el retorno automático:
   ```bash
   systemctl stop voicebox-templar.timer; docker stop voicebox          # SOLO esto (caddy/ultron-manos siguen)
   systemd-run --on-active=115min --unit=voicebox-volver /bin/sh -c \
     'docker start voicebox; systemctl start voicebox-templar.timer voicebox-templar.service'
   ```
3. **GPU, un modelo cada vez** (cada orden encadena sus etapas):
   ```bash
   $P estudio.py canciones-generar   ejemplos/aura.json -t $T --voicebox-parado   # ACE-Step todo en GPU
   $P estudio.py canciones-convertir ejemplos/aura.json -t $T --top 3
   #   variantes extra de conversión:  --tomas id:k,id:k --sufijo _b --cfg 0.5   |  --sufijo _c --pasos 30
   $P estudio.py expresiones-generar ejemplos/aura.json -t $T --motores chatterbox,dia,dia-libre
   ```
4. **Restaurar** y comprobar con una llamada real:
   ```bash
   docker start voicebox && systemctl start voicebox-templar.timer && systemctl start voicebox-templar.service
   curl -s localhost:17493/health          # "healthy"
   curl -s -X POST localhost:17493/generate/stream -H 'Content-Type: application/json' \
     -d '{"profile_id":"0014442b-51e6-44f5-9a35-f0e1ed296da5","text":"Hola","language":"es","engine":"kokoro"}' -o x.wav
   systemctl stop voicebox-volver.timer    # sólo tras restaurar a mano
   ```
5. **Sin GPU pesada** (Voicebox ya en marcha):
   ```bash
   $P estudio.py canciones-final   ejemplos/aura.json -t $T
   $P estudio.py expresiones-final ejemplos/aura.json -t $T
   ```
Salida: `/opt/estudio/salida/{canciones,expresiones}/<id>.mp3` (44.1 kHz) + `<id>_24k.wav` (24 kHz mono
PCM16) + `manifiesto.json`. Las canciones incluyen además `<id>-voz.*` (voz Dora sola). Sonoridad integrada
igualada a Kokoro/Dora (**−19.6 LUFS**, ffmpeg ebur128) por separado en MP3 y en WAV mono, con limitador a −1 dBFS
y segunda pasada de corrección (respiraciones/suspiros −2 a −4 dB relativos, indicado en el manifiesto).

## Criterios objetivos (fijados antes de mirar resultados)

**Canción** (sobre la voz Dora convertida, aislada): WER Whisper ≤ 0.35 · proporción de tiempo sonoro en notas
sostenidas (f0 estable ≥ 250 ms) ≥ max(0.30, 2× la lectura hablada de Kokoro de la misma letra) · estabilidad
(Δf0 medio entre tramas) ≤ 0.8× la del habla · voz ≥ 50 % de las tramas activas · similitud Resemblyzer con
Dora de la voz convertida ≥ la de la voz original de ACE-Step + 0.02 · sin clipping. Entre las que pasan: menor WER.

**Expresión**: duración recortada en rango (0.3–4 s; tarareo 2–5 s) · verificada por AST (clase objetivo
≥ 0.15 o entre las 3 primeras de 527) **o** por Whisper (onomatopeya esperada) · sin palabras inventadas
(Kokoro: nada fuera del propio texto) · similitud con Dora ≥ 0.60 (no aplica a Kokoro, que es Dora, ni a sonidos
sordos: shh, jadeo, inhalación — decisión tomada tras ver que Resemblyzer no mide timbre en ellos) · sin clipping.
`verificacion_debil: true` en el manifiesto = pasó sólo por rango AST con probabilidad < 0.15: escuchar antes de usar.

## Recursos medidos (26-09-2026, Voicebox parado; otro proceso ajeno usaba 1.4–4.6 GB de la GPU)

| Etapa | Tiempo | VRAM etapa (pico) | RAM disponible mínima |
|---|---|---|---|
| ACE-Step bf16, 18 tomas (carga 44–95 s; 22–55 s de audio en 12–29 s) | 425 s | 9.2 GB | 10.9 GB |
| ACE-Step, 9 tomas extra | 220 s | 9.2 GB | 10.9 GB |
| Demucs htdemucs (shifts=2), 18 tomas | 62 s | 1.0 GB | 13.0 GB |
| Evaluar (Whisper + pyin×4 + Resemblyzer), 18 voces | 259 s (81 s con pyin en paralelo, 9 voces) | 2.0 GB | 11.8 GB |
| Seed-VC canto f0, 50 pasos, 18 voces (≈ 2.1× tiempo real) | 1409 s | 3.4 GB | 12.5 GB |
| Dia fp16 con prompt, 61 clips (≈ 6× más lento que tiempo real) | 971 s | 8.9 GB | 8.1 GB |
| Dia fp16 sin prompt, 12 clips | 136 s | 4.8 GB | 11.8 GB |
| Chatterbox-Turbo, 96 clips (≈ 1 s por clip) | 95 s | 4.9 GB | 9.4 GB |
| Seed-VC habla (20–30 pasos), 52–96 clips | 256–274 s | 2.5–3.8 GB | 11.1 GB |
| Evaluar expresiones (≈ 100–160 clips) | 63–82 s | 1.9 GB | 12.1 GB |

El perro guardián (RAM disponible < 2.5 GB o thrashing) no tuvo que actuar. Ventana real: 94.8 min.

## Limitaciones conocidas

- La conversión Seed-VC (referencia hablada de Dora) **baja la inteligibilidad** del canto (WER cruda → Dora:
  0.15 → 0.24 Way Maker, 0.06 → 0.22 feliz día, 0.00 → 0.26 nana). Las marcas «Aura» y «Orden Global» salen
  mal en la bienvenida («Maurer», «Borde, engloba»).
- Dia 1.6B con el prompt de Dora tiende a repetir la frase del prompt; sus risas/tarareos/silbidos no pasaron.
- Kokoro no sabe pronunciar interjecciones sin vocales («Mmm» → «eme») y añade sílabas en algunas («¡Uy, uy!»).

## Dónde quedó en la app

- Canciones (mezcla completa, MP3 44.1 kHz): `public/voz/{jesus,waymaker,bienvenida,felizdia,bendicion,cuna}.mp3`
  (repertorio en `lib/capacidades.ts`; `jesus` y `waymaker` reemplazan las tomas de la voz anterior).
- Expresiones: WAV 24 kHz mono en `server/expresiones/<toma>.wav` (el servidor las pega dentro de lo que
  dice AU-RA, `server/empalme.ts`) y MP3 en `public/voz/expresiones/<toma>.mp3` (reacciones al tacto).
  Etiqueta → tomas en `lib/expresiones.ts`: solo tomas verificadas; las de `verificacion_debil` solo cuando
  son la única toma de su expresión (risa tierna, respiro, bufido).
