#!/usr/bin/env python3
"""Etapa EXPRESAR: genera vocalizaciones no verbales (risas, suspiros, jadeos...).

Motores (ambos con licencia permisiva de código y pesos):
  * chatterbox : Chatterbox-Turbo (Resemble AI, MIT) — etiquetas [laugh] [chuckle]
                 [sigh] [gasp] [clear throat] [cough] [groan] [sniff] [crying]
                 [shush] y de emoción [surprised] [happy] [fear] [sarcastic]...
                 Clona el timbre desde la referencia de Dora (voice prompt).
                 Añade la marca de agua inaudible Perth de Resemble (se conserva).
  * dia        : Dia 1.6B-0626 (Nari Labs, Apache-2.0) — (laughs) (chuckle) (sighs) (gasps)
                 (humming) (inhales) (exhales) (groans) (sniffs) (clears throat)...  Inglés; con
                 audio_prompt = frase de Dora (r1.wav) + su transcripción con [S1].

Uso (entorno /opt/estudio/envs/vc):
    python expresar.py trabajo.json
trabajo.json = {"motor": "chatterbox"|"dia", "referencia": "dora_ref.wav", "dia_dir": "(sólo dia)",
                "referencia_texto": "... (sólo dia)", "salida_dir": "...",
                "clips": [{"id": "risa_corta", "texto": "[laugh]", "n": 4,
                           "semilla": 100, "temperatura": 0.8}, ...]}
Escribe <salida_dir>/<id>__c<k>.wav (float, sr nativa del motor: 24 kHz / 44.1 kHz).
"""
import json
import os
import sys
import time

import numpy as np
import soundfile as sf
import torch


def fijar_semilla(s):
    import random
    random.seed(s)
    np.random.seed(s % (2**32 - 1))
    torch.manual_seed(s)
    torch.cuda.manual_seed_all(s)


def motor_chatterbox(spec):
    from chatterbox.tts_turbo import ChatterboxTurboTTS
    t0 = time.time()
    # from_pretrained llama a snapshot_download(token=True) y falla sin token de HF aunque los pesos estén
    # en caché: se carga la instantánea local directamente.
    import glob
    snap = sorted(glob.glob(os.path.join(os.environ.get("HF_HOME", "/opt/estudio/hf"),
                                         "hub/models--ResembleAI--chatterbox-turbo/snapshots/*/")))[-1]
    m = ChatterboxTurboTTS.from_local(snap, device="cuda")
    m.prepare_conditionals(spec["referencia"], norm_loudness=True)
    print(f"[expresar] chatterbox-turbo cargado en {time.time() - t0:.1f}s", flush=True)

    def gen(clip, semilla):
        fijar_semilla(semilla)
        w = m.generate(clip["texto"], temperature=float(clip.get("temperatura", 0.8)),
                       top_p=float(clip.get("top_p", 0.95)), repetition_penalty=float(clip.get("rep", 1.2)))
        return w.squeeze(0).cpu().numpy(), m.sr
    return gen


def motor_dia(spec):
    """Dia 1.6B-0626 en fp16.  Los pesos oficiales sólo se publican en fp32 (pytorch_model.bin, 6.4 GB);
    cargarlos con Dia.from_pretrained necesita ~10-13 GB de RAM (inviable en el nodo, 16 GB compartidos
    con Voicebox).  Se usa una copia fp16 convertida una vez (safetensors, 3.2 GB) y el modelo se
    construye directamente en la GPU, copiando los tensores desde el mmap: RAM mínima."""
    from safetensors.torch import load_file
    from dia.config import DiaConfig
    from dia.layers import DiaModel
    from dia.model import Dia

    d = spec.get("dia_dir", "/opt/estudio/modelos/dia-1.6b-0626-fp16")
    t0 = time.time()
    cfg = DiaConfig.load(os.path.join(d, "config.json"))
    dev = torch.device("cuda")
    with torch.device(dev):
        red = DiaModel(cfg, torch.float16)
    red.load_state_dict(load_file(os.path.join(d, "dia-1.6b-0626-fp16.safetensors"), device="cpu"), strict=True)
    red.eval()
    m = Dia.__new__(Dia)  # evita Dia.__init__, que construiría otra copia del modelo en CPU
    m.config, m.device, m.compute_dtype, m.model = cfg, dev, torch.float16, red
    m.dac_model, m._compiled_step, m.load_dac = None, None, True
    m._load_dac_model()
    ref_txt = spec.get("referencia_texto", "")
    prompt = None
    n_prompt = 0
    if spec.get("referencia"):
        # Igual que Dia.load_audio pero leyendo con soundfile (torchaudio>=2.9 exige torchcodec para .load)
        import torchaudio.functional as taf
        a, sr = sf.read(spec["referencia"], dtype="float32", always_2d=True)
        a = torch.from_numpy(a.mean(axis=1)).unsqueeze(0)  # (1, T)
        if sr != 44100:
            a = taf.resample(a, sr, 44100)
        prompt = m._encode(a.to(dev))  # códigos DAC (T, C), se codifica UNA vez
        n_prompt = int(prompt.shape[0])
    print(f"[expresar] dia fp16 cargado en {time.time() - t0:.1f}s; prompt {n_prompt} tramas", flush=True)

    def gen(clip, semilla):
        fijar_semilla(semilla)
        texto = (ref_txt + " " + clip["texto"]).strip() if prompt is not None else clip["texto"]
        # OJO: en Dia max_tokens INCLUYE las tramas del prompt de audio (bucle "while dec_step < max_tokens"
        # empieza en prefill_steps).  86 tramas = 1 s.
        with torch.inference_mode():
            w = m.generate(texto, audio_prompt=prompt, use_torch_compile=False, verbose=False,
                           cfg_scale=float(clip.get("cfg", 3.0)), temperature=float(clip.get("temperatura", 1.2)),
                           top_p=float(clip.get("top_p", 0.95)), cfg_filter_top_k=45,
                           max_tokens=n_prompt + int(clip.get("max_tokens", 500)))
        return (np.zeros(1, np.float32) if w is None else np.asarray(w, np.float32).reshape(-1)), 44100
    return gen


def main():
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    os.makedirs(spec["salida_dir"], exist_ok=True)
    gen = {"chatterbox": motor_chatterbox, "dia": motor_dia}[spec["motor"]](spec)
    resumen = []
    for clip in spec["clips"]:
        for k in range(int(clip.get("n", 1))):
            semilla = int(clip.get("semilla", 1000)) + k
            torch.cuda.reset_peak_memory_stats()
            t1 = time.time()
            try:
                w, sr = gen(clip, semilla)
            except Exception as ex:  # un clip fallido no tumba la etapa
                print(f"[expresar] {clip['id']} c{k}: ERROR {ex!r}"[:400], flush=True)
                continue
            dt = time.time() - t1
            ruta = os.path.join(spec["salida_dir"], f"{clip['id']}__c{k}.wav")
            sf.write(ruta, w.astype(np.float32), sr, subtype="FLOAT")
            info = {"ruta": ruta, "id": clip["id"], "k": k, "semilla": semilla, "texto": clip["texto"],
                    "motor": spec["motor"], "sr": sr, "duracion_s": round(len(w) / sr, 2), "tiempo_s": round(dt, 2),
                    "vram_pico_torch_gb": round(torch.cuda.max_memory_allocated() / 2**30, 2)}
            resumen.append(info)
            print(f"[expresar] {clip['id']} c{k}: {info['duracion_s']}s en {dt:.1f}s", flush=True)
    json.dump(resumen, open(os.path.join(spec["salida_dir"], f"expresar_{spec['motor']}.json"), "w"),
              ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
