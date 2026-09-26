#!/usr/bin/env python3
"""Métricas objetivas de CANTO vs HABLA a partir de la f0 (librosa.pyin, 10 ms).

metricas_f0(w, sr) -> dict con:
  sonora_total      fracción de tramas con f0 (sobre toda la pista)
  sonora_activa     fracción de tramas con f0 sobre las tramas con energía (> pico-35 dB)
  rango_st          rango de tono p5..p95 en semitonos
  f0_mediana_hz
  notas             nº de "notas" (segmentos de f0 estable: la f0 suavizada 200 ms no se aleja
                    más de 50 cents de la media del segmento; el vibrato queda dentro)
  nota_mediana_s    duración mediana de las notas (>= 50 ms)
  nota_max_s        nota más larga
  prop_sostenida    fracción del tiempo sonoro que está en notas >= 250 ms  (clave canto/habla)
  notas_sostenidas  nº de notas >= 250 ms
  delta_cents       media de min(|Δf0|, 100) entre tramas consecutivas sonoras (cents / 10 ms) (estabilidad;
                    el tope de 100 cents excluye los saltos entre notas)
  vibrato_frac      fracción de notas >= 400 ms con vibrato (pico espectral 4-8 Hz en la f0
                    sin tendencia, con extensión >= 15 cents y >= 35 % de la energía 2-15 Hz)
  vibrato_hz, vibrato_cents  medias sobre las notas con vibrato
"""
import numpy as np

HOP_S = 0.01


def _suavizar(x, n):
    if n <= 1:
        return x.copy()
    k = np.ones(n) / n
    pad = np.pad(x, (n // 2, n - 1 - n // 2), mode="edge")
    return np.convolve(pad, k, mode="valid")


def _tramos(mascara):
    """[(ini, fin_excl)] de los tramos True."""
    m = np.concatenate([[False], mascara, [False]]).astype(int)
    d = np.diff(m)
    return list(zip(np.where(d == 1)[0], np.where(d == -1)[0]))


def f0_pyin(w, sr):
    import librosa
    y = librosa.resample(w.astype(np.float32), orig_sr=sr, target_sr=16000) if sr != 16000 else w.astype(np.float32)
    f0, vflag, _ = librosa.pyin(y, fmin=65.0, fmax=1100.0, sr=16000, frame_length=1024, hop_length=160,
                                center=True, fill_na=np.nan)
    rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=160, center=True)[0]
    n = min(len(f0), len(rms))
    return f0[:n], vflag[:n], rms[:n]


def metricas_f0(w, sr):
    if w.ndim > 1:
        w = w.mean(axis=1)
    f0, vflag, rms = f0_pyin(w, sr)
    db = 20 * np.log10(rms + 1e-9)
    activa = db > (db.max() - 35.0)
    sonora = vflag & np.isfinite(f0) & activa
    n_act = max(int(activa.sum()), 1)
    out = {"duracion_s": round(len(w) / sr, 2),
           "sonora_total": round(float(sonora.mean()), 3),
           "sonora_activa": round(float(sonora.sum() / n_act), 3)}
    if sonora.sum() < 20:
        out.update({"rango_st": 0.0, "notas": 0, "prop_sostenida": 0.0, "notas_sostenidas": 0,
                    "nota_mediana_s": 0.0, "nota_max_s": 0.0, "delta_cents": None, "vibrato_frac": 0.0})
        return out
    cents = np.full(len(f0), np.nan)
    cents[sonora] = 1200 * np.log2(f0[sonora] / 55.0)
    v = cents[sonora]
    out["f0_mediana_hz"] = round(float(55 * 2 ** (np.median(v) / 1200)), 1)
    out["rango_st"] = round(float((np.percentile(v, 95) - np.percentile(v, 5)) / 100), 2)

    notas, deltas, vib = [], [], []
    for a, b in _tramos(sonora):
        c = cents[a:b]
        if len(c) >= 2:
            deltas.extend(np.abs(np.diff(c)).tolist())
        s = _suavizar(c, 20)  # 200 ms: aplana el vibrato (5-7 Hz) para segmentar notas
        i = 0
        while i < len(s):
            j, suma = i + 1, s[i]
            while j < len(s) and abs(s[j] - suma / (j - i)) <= 50.0:
                suma += s[j]
                j += 1
            notas.append((j - i) * HOP_S)
            if (j - i) * HOP_S >= 0.4:  # vibrato en notas largas
                seg = c[i:j]
                t = np.arange(len(seg))
                res = seg - np.polyval(np.polyfit(t, seg, 2), t)
                nfft = 1024
                esp = np.abs(np.fft.rfft(res * np.hanning(len(res)), nfft)) ** 2
                fr = np.fft.rfftfreq(nfft, HOP_S)
                banda = (fr >= 2) & (fr <= 15)
                vb = (fr >= 4) & (fr <= 8)
                ext = float(np.sqrt(2) * res.std())
                share = esp[vb].sum() / max(esp[banda].sum(), 1e-9)
                es_vib = bool(share >= 0.35 and ext >= 15.0)
                vib.append((es_vib, float(fr[vb][np.argmax(esp[vb])]), ext))
            i = j
    notas = np.array(notas)
    largas = notas[notas >= 0.05]
    sost = notas[notas >= 0.25]
    t_sonoro = sonora.sum() * HOP_S
    out.update({
        "notas": int(len(largas)),
        "nota_mediana_s": round(float(np.median(largas)) if len(largas) else 0.0, 3),
        "nota_max_s": round(float(notas.max()), 2),
        "prop_sostenida": round(float(sost.sum() / max(t_sonoro, 1e-9)), 3),
        "notas_sostenidas": int(len(sost)),
        "delta_cents": round(float(np.mean(np.minimum(deltas, 100.0))), 2) if deltas else None,
        "vibrato_frac": round(float(np.mean([x[0] for x in vib])) if vib else 0.0, 3),
        "notas_400ms": len(vib),
    })
    con = [x for x in vib if x[0]]
    if con:
        out["vibrato_hz"] = round(float(np.mean([x[1] for x in con])), 2)
        out["vibrato_cents"] = round(float(np.mean([x[2] for x in con])), 1)
    return out


if __name__ == "__main__":
    import json
    import sys

    import soundfile as sf
    for p in sys.argv[1:]:
        w, sr = sf.read(p, dtype="float32", always_2d=True)
        print(p, json.dumps(metricas_f0(w.mean(axis=1), sr), ensure_ascii=False))
