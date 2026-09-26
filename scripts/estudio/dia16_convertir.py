#!/usr/bin/env python3
"""Convierte Dia 1.6B-0626 (nari-labs, Apache-2.0) de fp32 a fp16 safetensors (3.2 GB).

Ejecutar en una máquina con >= 12 GB de RAM libres (NO en el nodo T4 con Voicebox en marcha):
    pip install torch safetensors huggingface_hub   (torch CPU basta)
    python dia16_convertir.py  ./dia-1.6b-0626-fp16
Luego copiar la carpeta a /opt/estudio/modelos/dia-1.6b-0626-fp16 en el nodo.
"""
import os
import sys
import time

import torch
from huggingface_hub import hf_hub_download
from safetensors.torch import save_file

dst = sys.argv[1] if len(sys.argv) > 1 else "dia-1.6b-0626-fp16"
os.makedirs(dst, exist_ok=True)
t = time.time()
hf_hub_download("nari-labs/Dia-1.6B-0626", "config.json", local_dir=dst)
p = hf_hub_download("nari-labs/Dia-1.6B-0626", "pytorch_model.bin", local_dir=dst)
sd = torch.load(p, map_location="cpu", mmap=True, weights_only=True)
out = {k: (v.to(torch.float16) if v.is_floating_point() else v).contiguous() for k, v in sd.items()}
save_file(out, os.path.join(dst, "dia-1.6b-0626-fp16.safetensors"),
          metadata={"origen": "nari-labs/Dia-1.6B-0626 pytorch_model.bin", "licencia": "apache-2.0"})
del sd
os.remove(p)
print(f"ok: {len(out)} tensores, {sum(v.numel() for v in out.values())} parámetros, {time.time() - t:.0f}s")
