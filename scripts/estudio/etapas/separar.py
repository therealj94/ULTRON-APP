#!/usr/bin/env python3
"""Etapa SEPARAR: voz / instrumental con Demucs htdemucs (MIT).

Uso (entorno /opt/estudio/envs/vc):
    python separar.py trabajos.json
trabajos.json = {"modelo": "htdemucs", "trabajos": [{"entrada": "cruda.wav", "dir": "carpeta"}]}
Escribe <dir>/voz.wav y <dir>/instrumental.wav (44.1 kHz estéreo float).
"""
import json
import sys
import time

import numpy as np
import soundfile as sf
import torch
import demucs.api


def main():
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    t0 = time.time()
    sep = demucs.api.Separator(model=spec.get("modelo", "htdemucs"), device="cuda", shifts=int(spec.get("shifts", 1)),
                               overlap=0.25, split=True, segment=None, progress=False)
    print(f"[separar] modelo cargado en {time.time() - t0:.1f}s sr={sep.samplerate}", flush=True)
    import os
    for tr in spec["trabajos"]:
        if os.path.exists(f"{tr['dir']}/voz.wav") and not spec.get("rehacer"):
            continue
        t1 = time.time()
        torch.cuda.reset_peak_memory_stats()
        _, stems = sep.separate_audio_file(tr["entrada"])
        voz = stems["vocals"].cpu().numpy().T
        inst = sum(v for k, v in stems.items() if k != "vocals").cpu().numpy().T
        sf.write(f"{tr['dir']}/voz.wav", voz.astype(np.float32), sep.samplerate, subtype="FLOAT")
        sf.write(f"{tr['dir']}/instrumental.wav", inst.astype(np.float32), sep.samplerate, subtype="FLOAT")
        print(f"[separar] {tr['entrada']}: {time.time() - t1:.1f}s "
              f"pico_torch={torch.cuda.max_memory_allocated() / 2**30:.2f}GB", flush=True)


if __name__ == "__main__":
    main()
