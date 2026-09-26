#!/usr/bin/env python3
"""Etapa EVALUAR: métricas objetivas por archivo (entorno /opt/estudio/envs/vc).

  * Whisper large-v3-turbo (MIT, openai/whisper-large-v3-turbo, fp16 en GPU): transcripción
    -> el orquestador calcula el WER contra la letra.  Es el Whisper PROPIO del estudio, así las
    comprobaciones funcionan aunque Voicebox esté parado.
  * f0 (librosa.pyin, etapas/metricas.py): proporción de notas sostenidas, rango, estabilidad, vibrato.
  * AST (MIT/ast-finetuned-audioset-10-10-0.4593, BSD-3): clasificador AudioSet 527 clases ->
    top-5 y puntuación (sigmoide) de las clases objetivo ("Laughter", "Sigh", "Gasp", "Humming"...).
  * Resemblyzer (Apache-2.0): similitud coseno con el embedding medio de Dora (clips de evaluación
    distintos de los de referencia de conversión).
  * Pico / muestras recortadas (clipping) y duración.

Uso:  python evaluar.py trabajo.json
trabajo.json = {"dora_eval": ["e1.wav", ...], "salida": "eval.json",
                "archivos": [{"ruta": "x.wav", "clases": ["Laughter"], "whisper": "es"|"en"|null,
                              "f0": true|false, "sim": true, "recortar_silencio": true}]}
"""
import json
import os
import sys
import time

import librosa
import numpy as np
import soundfile as sf
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from metricas import metricas_f0  # noqa: E402

WHISPER = "openai/whisper-large-v3-turbo"
AST = "MIT/ast-finetuned-audioset-10-10-0.4593"


def _f0_de_archivo(ruta):
    w, sr = sf.read(ruta, dtype="float32", always_2d=True)
    return metricas_f0(w.mean(axis=1), sr)


def main():
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    archivos = spec["archivos"]
    t0 = time.time()
    res = [{"ruta": a["ruta"]} for a in archivos]
    audio = {}
    for a, r in zip(archivos, res):
        w, sr = sf.read(a["ruta"], dtype="float32", always_2d=True)
        r.update({"duracion_s": round(len(w) / sr, 3), "pico": round(float(np.abs(w).max()), 4),
                  "muestras_recortadas": int((np.abs(w) >= 0.999).sum())})
        mono = w.mean(axis=1)
        audio[a["ruta"]] = librosa.resample(mono, orig_sr=sr, target_sr=16000) if sr != 16000 else mono

    # --- f0 (pyin, CPU): en paralelo, 4 procesos ---
    con_f0 = [a["ruta"] for a in archivos if a.get("f0")]
    if con_f0:
        from multiprocessing import get_context
        with get_context("spawn").Pool(min(4, len(con_f0))) as pool:
            f0s = dict(zip(con_f0, pool.map(_f0_de_archivo, con_f0)))
        for a, r in zip(archivos, res):
            if a.get("f0"):
                r["f0"] = f0s[a["ruta"]]

    # --- similitud de hablante (Resemblyzer) ---
    if any(a.get("sim", True) for a in archivos):
        from resemblyzer import VoiceEncoder, preprocess_wav
        from resemblyzer.audio import normalize_volume
        ve = VoiceEncoder(device="cuda", verbose=False)
        ref = np.mean([ve.embed_utterance(preprocess_wav(p)) for p in spec["dora_eval"]], axis=0)
        ref /= np.linalg.norm(ref)
        for a, r in zip(archivos, res):
            if not a.get("sim", True):
                continue
            w16 = audio[a["ruta"]]
            try:
                # resemblyzer 0.1.4: preprocess_wav siempre recorta silencios con webrtcvad; en clips muy cortos
                # (risas, suspiros) puede dejarlo vacío -> sólo normalización de volumen, sin VAD.
                pw = preprocess_wav(w16, source_sr=16000)
                if len(pw) < 8000:
                    pw = normalize_volume(w16.astype(np.float32), -30, increase_only=True)
                if len(pw) < 32000:  # < 2 s: se repite (con 50 ms de silencio) hasta >= 2 s para que las
                    # ventanas de 1.6 s de Resemblyzer vean voz y no relleno
                    rep = np.concatenate([pw, np.zeros(800, np.float32)])
                    pw = np.tile(rep, int(np.ceil(32000 / len(rep))))
                e = ve.embed_utterance(pw)
                r["sim_dora"] = round(float(np.dot(e, ref) / np.linalg.norm(e)), 4)
            except Exception as ex:  # clip demasiado corto
                r["sim_dora"] = None
                r["sim_error"] = str(ex)[:120]
        del ve
        torch.cuda.empty_cache()

    # --- AST (AudioSet) ---
    if any(a.get("clases") is not None for a in archivos):
        from transformers import ASTFeatureExtractor, ASTForAudioClassification
        fe = ASTFeatureExtractor.from_pretrained(AST)
        ast = ASTForAudioClassification.from_pretrained(AST).to("cuda").eval()
        etiquetas = ast.config.id2label
        idx = {v: int(k) for k, v in etiquetas.items()}
        for a, r in zip(archivos, res):
            if a.get("clases") is None:
                continue
            x = fe(audio[a["ruta"]], sampling_rate=16000, return_tensors="pt").to("cuda")
            with torch.no_grad():
                p = torch.sigmoid(ast(**x).logits[0]).cpu().numpy()
            top = np.argsort(-p)[:5]
            r["ast_top5"] = [[etiquetas[int(i)], round(float(p[i]), 3)] for i in top]
            clases = [c for c in a["clases"] if c in idx]
            if clases:
                r["ast_objetivo"] = {c: round(float(p[idx[c]]), 3) for c in clases}
                r["ast_objetivo_max"] = max(r["ast_objetivo"].values())
                rango = {etiquetas[int(i)]: n + 1 for n, i in enumerate(np.argsort(-p)[:10])}
                r["ast_objetivo_rango"] = min([rango.get(c, 99) for c in clases])
        del ast
        torch.cuda.empty_cache()

    # --- Whisper ---
    if any(a.get("whisper") for a in archivos):
        from transformers import pipeline
        asr = pipeline("automatic-speech-recognition", model=WHISPER, torch_dtype=torch.float16, device="cuda:0")
        for a, r in zip(archivos, res):
            if not a.get("whisper"):
                continue
            w16 = audio[a["ruta"]]
            if len(w16) < 16000:  # Whisper necesita algo de contexto: se rellena con silencio
                w16 = np.pad(w16, (4000, 16000 - len(w16) + 4000))
            out = asr({"raw": w16, "sampling_rate": 16000}, chunk_length_s=30, batch_size=4,
                      generate_kwargs={"language": a["whisper"], "task": "transcribe"})
            r["whisper"] = out["text"].strip()
            r["whisper_idioma"] = a["whisper"]
    json.dump(res, open(spec["salida"], "w"), ensure_ascii=False, indent=1)
    print(f"[evaluar] {len(res)} archivos evaluados en {time.time() - t0:.1f}s -> {spec['salida']}", flush=True)


if __name__ == "__main__":
    main()
