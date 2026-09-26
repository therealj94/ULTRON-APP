#!/usr/bin/env python3
"""Etapa CONVERTIR: conversión de timbre a Dora con Seed-VC.

AVISO DE LICENCIA: Seed-VC (código y pesos) es GPL-3.0.  Este envoltorio sólo
importa y llama a su `inference.py` sin redistribuirlo; se usa exclusivamente
como herramienta de servidor en el nodo T4 (no se distribuye con la app).  El
audio generado no es "obra derivada" del programa.

Uso (entorno /opt/estudio/envs/vc):
    python convertir.py trabajos.json

trabajos.json = {"modo": "canto"|"habla", "trabajos": [
   {"fuente": "voz.wav", "referencia": "dora_ref.wav", "salida": "out.wav",
    "semitonos": 0, "auto_f0": false, "pasos": 40, "cfg": 0.7}, ...]}

modo "canto": modelo DiT_seed_v2_uvit_whisper_base_f0_44k (f0 con RMVPE, 44.1 kHz)
modo "habla": modelo DiT_seed_v2_uvit_whisper_small_wavenet (22.05 kHz)
Los modelos se cargan UNA vez y se procesan todos los trabajos.
"""
import argparse
import json
import os
import sys
import time

import huggingface_hub  # noqa: F401  (fija HF_HOME antes de que seed-vc toque HF_HUB_CACHE)
import transformers  # noqa: F401
import soundfile as sf
import torch

SEEDVC = os.environ.get("SEEDVC_RAIZ", "/opt/estudio/repos/seed-vc")


def main():
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    modo = spec.get("modo", "canto")
    os.chdir(SEEDVC)
    sys.path.insert(0, SEEDVC)
    hub_cache = os.environ.get("HF_HUB_CACHE")
    import inference as sv  # noqa: E402  (módulo de Seed-VC)
    if hub_cache:
        os.environ["HF_HUB_CACHE"] = hub_cache
    else:
        os.environ.pop("HF_HUB_CACHE", None)

    base = argparse.Namespace(
        source="", target="", output="", diffusion_steps=40, length_adjust=1.0,
        inference_cfg_rate=0.7, f0_condition=(modo == "canto"), auto_f0_adjust=False,
        semi_tone_shift=0, checkpoint=None, config=None, fp16=True,
    )
    t0 = time.time()
    modelos = sv.load_models(base)
    t_carga = time.time() - t0
    print(f"[convertir] modo={modo} modelos cargados en {t_carga:.1f}s", flush=True)
    sv.load_models = lambda args: modelos  # reutilizar en cada trabajo

    escrito = {}

    def guardar(ruta, wave, sr):  # sustituye torchaudio.save (torchaudio>=2.9 exige torchcodec)
        escrito["wave"], escrito["sr"] = wave.squeeze(0).numpy(), sr

    sv.torchaudio.save = guardar
    resumen = {"modo": modo, "carga_s": round(t_carga, 1), "trabajos": []}
    for tr in spec["trabajos"]:
        if os.path.exists(tr["salida"]) and not spec.get("rehacer"):
            continue
        args = argparse.Namespace(**vars(base))
        args.source, args.target = tr["fuente"], tr["referencia"]
        args.output = os.path.dirname(tr["salida"]) or "."
        args.diffusion_steps = int(tr.get("pasos", 40 if modo == "canto" else 30))
        args.inference_cfg_rate = float(tr.get("cfg", 0.7))
        args.auto_f0_adjust = bool(tr.get("auto_f0", False))
        args.semi_tone_shift = int(tr.get("semitonos", 0))
        torch.cuda.reset_peak_memory_stats()
        t1 = time.time()
        try:
            sv.main(args)
        except Exception as ex:  # un trabajo fallido no tumba los demás
            print(f"[convertir] {tr['fuente']}: ERROR {ex!r}"[:400], flush=True)
            continue
        dt = time.time() - t1
        os.makedirs(args.output, exist_ok=True)
        sf.write(tr["salida"], escrito["wave"], escrito["sr"], subtype="FLOAT")
        dur = len(escrito["wave"]) / escrito["sr"]
        info = {"salida": tr["salida"], "tiempo_s": round(dt, 2), "duracion_s": round(dur, 2),
                "vram_pico_torch_gb": round(torch.cuda.max_memory_allocated() / 2**30, 2)}
        resumen["trabajos"].append(info)
        print(f"[convertir] {os.path.basename(tr['salida'])}: {dur:.1f}s en {dt:.1f}s", flush=True)
    if spec.get("resumen"):
        json.dump(resumen, open(spec["resumen"], "w"), indent=1)


if __name__ == "__main__":
    main()
