#!/usr/bin/env python3
"""Etapa CANTAR (entorno ACE-Step 1.5, licencia MIT).

Genera canciones (voz + instrumental mezclados) a partir de letra en español y
etiquetas de estilo.  Se ejecuta con el Python del venv de ACE-Step:

    /opt/estudio/repos/ACE-Step-1.5/.venv/bin/python cantar.py trabajo.json

trabajo.json = {"salida_dir": "...", "canciones": [ {id, letra, estilo, bpm,
                duracion, tonalidad, compas, semillas:[...], candidatos:N}, ... ]}

Escribe <salida_dir>/<id>/cruda_<k>.wav (48 kHz estéreo float) y
<salida_dir>/<id>/cruda_<k>.json con los metadatos (semilla, bpm, tonalidad...).
Pensado para la T4 compartida con Voicebox: tope de VRAM con MAX_CUDA_VRAM
(por defecto 10 GB), DiT turbo (2.4 B parámetros), LM 0.6B, VAE/encoder/DiT
descargados a CPU entre fases (el DiT se queda en GPU, ver nota en initialize_service).

PRECISIÓN (importante en la T4, sm75 "pre-Ampere"): ACE-Step elige fp16 en GPUs
sin bf16 nativo y el lyric-encoder / DiT se desbordan (activaciones > 65504 ->
latentes NaN, fallo "Generation produced NaN or Inf latents").  La variable
ACESTEP_DTYPE que sugiere su mensaje de error no existe en el código.  Por eso,
con "precision": "bf16" (por defecto) se fuerza bf16 para DiT + codificador de
texto (mismo rango que fp32, es el dtype de entrenamiento; en la T4 se emula,
~1.3 TFLOPS, pero el modelo turbo sólo da 8 pasos).  El VAE sigue en fp16 (no
desborda y así es rápido).  fp32 completo no cabe junto a Voicebox (9.6 GB).
"""
import json
import os
import sys
import time

# Con Voicebox PARADO (ventana de mantenimiento) el orquestador pasa MAX_CUDA_VRAM=14 y "offload": false.
os.environ.setdefault("MAX_CUDA_VRAM", "10")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
import torch  # noqa: E402

RAIZ_ACE = os.environ.get("ACE_RAIZ", "/opt/estudio/repos/ACE-Step-1.5")
sys.path.insert(0, RAIZ_ACE)

import acestep.gpu_config as _gc  # noqa: E402
from acestep.gpu_config import get_gpu_config, set_global_gpu_config  # noqa: E402
from acestep.handler import AceStepHandler  # noqa: E402
from acestep.inference import GenerationConfig, GenerationParams, generate_music  # noqa: E402
from acestep.llm_inference import LLMHandler  # noqa: E402
import acestep.model_downloader as _md  # noqa: E402

# El repo principal trae el LM 1.7B (3.7 GB) que no usamos en la T4 (usamos el 0.6B):
# se quita de la comprobación para que ACE-Step no intente descargarlo.
_md.MAIN_MODEL_COMPONENTS[:] = [c for c in _md.MAIN_MODEL_COMPONENTS if c != "acestep-5Hz-lm-1.7B"]


def main():
    trabajo = json.load(open(sys.argv[1], encoding="utf-8"))
    salida = trabajo["salida_dir"]
    dit_modelo = trabajo.get("dit", "acestep-v15-turbo")
    lm_modelo = trabajo.get("lm", "acestep-5Hz-lm-0.6B")
    lm_backend = trabajo.get("lm_backend", "pt")

    offload = bool(trabajo.get("offload", True))  # False = todo en GPU (sólo con Voicebox parado)
    precision = trabajo.get("precision", "bf16")
    if precision == "bf16":
        # init_service_orchestrator / init_service_loader consultan gpu_config.cuda_supports_bfloat16()
        # a través del módulo -> bf16 + atención SDPA para el DiT.  memory_utils importó la función por
        # nombre, así que el VAE conserva fp16.
        _gc.cuda_supports_bfloat16 = lambda *a, **k: True
    gpu = get_gpu_config()
    set_global_gpu_config(gpu)
    print(f"[cantar] GPU tier={gpu.tier} memoria={gpu.gpu_memory_gb:.1f} GB", flush=True)

    t0 = time.time()
    dit = AceStepHandler()
    msg, ok = dit.initialize_service(
        project_root=RAIZ_ACE,
        config_path=dit_modelo,
        device="cuda",
        use_flash_attention=False,  # la T4 (sm75) no soporta FlashAttention 2
        compile_model=False,
        offload_to_cpu=offload,
        # ¡NO descargar el DiT a CPU!  En bf16 los pesos quedan mapeados (mmap) desde el safetensors y, con
        # sólo ~10 GB de RAM disponibles junto a Voicebox, el nodo entró en thrashing de caché de páginas
        # (lecturas EBS sostenidas a 130 MB/s y agente SSM caído).  El DiT se queda en la GPU (~4.8 GB).
        offload_dit_to_cpu=bool(trabajo.get("offload_dit", False)),
        quantization=None,
    )
    if not ok:
        raise SystemExit(f"[cantar] fallo iniciando DiT: {msg}")
    llm = LLMHandler()
    msg, ok = llm.initialize(
        checkpoint_dir=os.path.join(RAIZ_ACE, "checkpoints"),
        lm_model_path=lm_modelo,
        backend=lm_backend,
        device="cuda",
        offload_to_cpu=offload,
        dtype=None,  # bf16 en CUDA (el LM en fp16 se desborda en la T4)
    )
    if not ok:
        raise SystemExit(f"[cantar] fallo iniciando LM: {msg}")
    t_carga = time.time() - t0
    print(f"[cantar] modelos cargados en {t_carga:.1f}s dtype={dit.dtype}", flush=True)

    resumen = {"carga_s": round(t_carga, 1), "precision": str(dit.dtype), "canciones": []}
    for c in trabajo["canciones"]:
        d = os.path.join(salida, c["id"])
        os.makedirs(d, exist_ok=True)
        n = int(c.get("candidatos", 1))
        semillas = list(c.get("semillas", []))
        for k in range(n):
            semilla = int(semillas[k]) if k < len(semillas) else int(c.get("semilla_base", 1000)) + 7919 * k
            ruta = os.path.join(d, f"cruda_{k}.wav")
            if os.path.exists(ruta) and not trabajo.get("rehacer"):
                print(f"[cantar] {c['id']} cand {k}: ya existe, se omite", flush=True)
                continue
            params = GenerationParams(
                task_type="text2music",
                caption=c["estilo"],
                lyrics=c["letra"],
                lm_temperature=float(c.get("lm_temperatura", 0.85)),
                vocal_language=c.get("idioma", "es"),
                bpm=c.get("bpm"),
                keyscale=c.get("tonalidad", ""),
                timesignature=str(c.get("compas", "4")),
                duration=float(c.get("duracion", 60)),
                inference_steps=int(c.get("pasos", 8)),
                shift=float(c.get("shift", 3.0)),
                seed=semilla,
                thinking=bool(c.get("pensar", True)),
                use_cot_caption=False,  # respetar el estilo pedido tal cual
                use_cot_language=False,
            )
            cfg = GenerationConfig(batch_size=1, use_random_seed=False, seeds=[semilla], audio_format="wav")
            torch.cuda.reset_peak_memory_stats()
            t1 = time.time()
            try:
                res = generate_music(dit, llm, params, cfg, save_dir=None)
            except Exception as ex:  # una toma fallida (p. ej. NaN) no tumba las demás
                print(f"[cantar] {c['id']} cand {k}: EXCEPCIÓN {ex!r}"[:500], flush=True)
                continue
            dt = time.time() - t1
            if not res.success or not res.audios or res.audios[0].get("tensor") is None:
                print(f"[cantar] {c['id']} cand {k}: FALLO {res.error or res.status_message}"[:500], flush=True)
                continue
            a = res.audios[0]
            wav = a["tensor"].float().cpu().numpy().T  # (muestras, canales)
            sr = int(a.get("sample_rate", 48000))
            if not np.isfinite(wav).all() or np.abs(wav).max() < 1e-3:
                print(f"[cantar] {c['id']} cand {k}: audio no finito o silencioso, se descarta", flush=True)
                continue
            sf.write(ruta, wav, sr, subtype="FLOAT")
            meta_lm = (res.extra_outputs or {}).get("lm_metadata") or {}
            meta = {
                "id": c["id"], "candidato": k, "semilla": semilla, "sr": sr,
                "duracion_s": round(wav.shape[0] / sr, 2), "tiempo_s": round(dt, 1),
                "vram_pico_torch_gb": round(torch.cuda.max_memory_allocated() / 2**30, 2),
                "pico_abs": float(np.abs(wav).max()),
                "lm": {k2: v for k2, v in meta_lm.items() if isinstance(v, (str, int, float))},
            }
            json.dump(meta, open(ruta.replace(".wav", ".json"), "w"), ensure_ascii=False, indent=1)
            resumen["canciones"].append(meta)
            print(f"[cantar] {c['id']} cand {k} semilla={semilla} {meta['duracion_s']}s en {dt:.1f}s "
                  f"pico_torch={meta['vram_pico_torch_gb']}GB", flush=True)
    json.dump(resumen, open(os.path.join(salida, "cantar_resumen.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
