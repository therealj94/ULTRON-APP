#!/usr/bin/env python3
"""ESTUDIO AU-RA — orquestador del nodo T4 (canto + expresiones con la voz Dora).

Se ejecuta con el Python del entorno vc:   P=/opt/estudio/envs/vc/bin/python
    $P estudio.py referencias  pedido.json                 # CON Voicebox: refs de Dora, lecturas habladas
    $P estudio.py kokoro       pedido.json -t TRABAJO      # CON Voicebox: interjecciones Kokoro + ffmpeg
    --- ventana (Voicebox PARADO) ---
    $P estudio.py canciones-generar  pedido.json -t TRABAJO   # ACE-Step -> Demucs -> evaluar voz cruda
    $P estudio.py canciones-convertir pedido.json -t TRABAJO  # Seed-VC canto (f0) -> evaluar voz Dora
    $P estudio.py expresiones-generar pedido.json -t TRABAJO  # Chatterbox/Dia -> Seed-VC habla -> evaluar
    --- sin GPU (se puede hacer con Voicebox ya restaurado) ---
    $P estudio.py canciones-final    pedido.json -t TRABAJO   # comparar con habla, elegir, mezclar, exportar
    $P estudio.py expresiones-final  pedido.json -t TRABAJO   # aceptar/rechazar, exportar, manifiesto

Cada etapa de GPU corre en un proceso aparte (un modelo pesado a la vez) dentro de un scope systemd con
MemoryMax y con un PERRO GUARDIÁN de RAM (mata la etapa si la RAM disponible baja de 2.5 GB o hay thrashing).
Salidas en /opt/estudio/salida/{canciones,expresiones}/ : <id>.mp3 (44.1 kHz) + <id>_24k.wav (24 kHz mono)
+ manifiesto.json.  La sonoridad se iguala a la de Kokoro/Dora (ffmpeg ebur128, integrada).
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.request

import numpy as np
import soundfile as sf

RAIZ = "/opt/estudio"
ETAPAS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "etapas")
sys.path.insert(0, ETAPAS)
PY_ACE = f"{RAIZ}/repos/ACE-Step-1.5/.venv/bin/python"
PY_VC = f"{RAIZ}/envs/vc/bin/python"
REFS = f"{RAIZ}/refs/dora"
VOICEBOX = "http://127.0.0.1:17493"
PERFIL_DORA = "0014442b-51e6-44f5-9a35-f0e1ed296da5"
SALIDA = f"{RAIZ}/salida"
# variantes de conversión Seed-VC (canto) que compiten en canciones-final (nombre de archivo -> parámetros)
VARIANTES_VC = {"voz_dora.wav": {"pasos": 50, "cfg": 0.7}, "voz_dora_b.wav": {"pasos": 50, "cfg": 0.5},
                "voz_dora_c.wav": {"pasos": 30, "cfg": 0.7}}

# Frases de referencia de Dora (Kokoro ef_dora vía Voicebox).
#   d01-d05 -> referencia de conversión Seed-VC (concatenadas, <= 25 s)
#   d01-d02 -> referencia (voice prompt) de Chatterbox;  d01 -> prompt de audio de Dia
#   d06-d08 -> SÓLO evaluación (embedding medio de Resemblyzer), no se usan para convertir
FRASES = {
    "d01": "Hola, soy Aura. Me alegra mucho acompañarte hoy. Cuéntame, ¿cómo te sientes?",
    "d02": "¡Qué maravilla! De verdad, no puedo creer lo bien que salió todo esta mañana.",
    "d03": "Mira, te lo explico con calma: primero revisamos los números y luego decidimos juntos.",
    "d04": "Gracias por tu paciencia. Estoy aquí para ayudarte en todo lo que necesites, siempre.",
    "d05": "¿Sabes qué? Creo que mañana va a ser un día precioso para empezar algo nuevo.",
    "d06": "Respira hondo, cierra los ojos un momento y deja que la tranquilidad llegue poco a poco.",
    "d07": "Buenos días a toda la junta. Hoy presentamos el informe del trimestre con muy buenas noticias.",
    "d08": "Me encanta aprender cosas nuevas contigo; cada conversación me enseña algo distinto.",
}
EVAL = [f"{REFS}/d06.wav", f"{REFS}/d07.wav", f"{REFS}/d08.wav"]
REF_CONV = f"{REFS}/dora_conv.wav"
REF_CB = f"{REFS}/dora_cb.wav"
REF_DIA = f"{REFS}/d01.wav"


def log(*a):
    print(time.strftime("[%H:%M:%S]"), *a, flush=True)


def sh(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        raise RuntimeError(f"falló {' '.join(cmd[:6])}...: {r.stderr[-800:]}")
    return r


def jload(p, defecto=None):
    try:
        return json.load(open(p, encoding="utf-8"))
    except FileNotFoundError:
        return defecto


def jsave(obj, p):
    tmp = p + ".tmp"
    json.dump(obj, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.replace(tmp, p)


# ----------------------------------------------------------------------------- Voicebox (Kokoro)
def voicebox_tts(texto, ruta, idioma="es", motor="kokoro"):
    cuerpo = json.dumps({"profile_id": PERFIL_DORA, "text": texto, "language": idioma, "engine": motor}).encode()
    req = urllib.request.Request(f"{VOICEBOX}/generate/stream", data=cuerpo,
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as r:
        datos = r.read()
    if datos[:4] != b"RIFF":
        raise RuntimeError(f"Voicebox no devolvió WAV para «{texto}»: {datos[:200]!r}")
    open(ruta, "wb").write(datos)
    return ruta


# ----------------------------------------------------------------------------- texto / WER
def normalizar_texto(t):
    t = unicodedata.normalize("NFD", (t or "").lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"\[[^\]]*\]|\([^)]*\)", " ", t)
    return " ".join(re.sub(r"[^a-z0-9ñ' ]+", " ", t).replace("'", "").split())


def letra_plana(letra):
    return " ".join(ln.strip() for ln in letra.splitlines() if ln.strip() and not ln.strip().startswith("["))


def wer(ref, hip):
    import jiwer
    r, h = normalizar_texto(ref), normalizar_texto(hip)
    if not r:
        return None
    if not h:
        return 1.0
    return round(float(jiwer.wer(r, h)), 3)


# Onomatopeyas que NO cuentan como "palabras inventadas" en una vocalización no verbal
ONOMATOPEYA = re.compile(r"^(h*[aeiou]+h*|([jh][aeiou])+[jh]?|m+|h+m+|m+h+m*|s+h+|c?h?s+t*|p+s+t+|w+o+h*o*|w+h*o+|"
                         r"a+w+|a+u+|u+h+|o+h+|o+w+|m+u+a+h?|m+w+a+h?|u+p+s+|o+p+s+|a+h+a+|e+h+|h+e+h*|j+e+|"
                         r"a+j+a+|u+y+|a+y+|p+h+e+w+|p+u+f+|u+f+|u+g+h*|b+r+|t+s+k+|w+h+e+w+)$")


def palabras_lexicas(texto):
    return [p for p in normalizar_texto(texto).split() if not ONOMATOPEYA.match(p)]


# ----------------------------------------------------------------------------- recursos / perro guardián
def mem_disponible_mib():
    for ln in open("/proc/meminfo"):
        if ln.startswith("MemAvailable:"):
            return int(ln.split()[1]) // 1024
    return 0


def fallos_mayores():
    for ln in open("/proc/vmstat"):
        if ln.startswith("pgmajfault "):
            return int(ln.split()[1])
    return 0


class Guardian(threading.Thread):
    """Cada 0.5 s mide VRAM (GPU total y procesos nuevos) y RAM.  PERRO GUARDIÁN: si la RAM disponible
    baja de ESTUDIO_RAM_MIN_MIB (2500) o hay thrashing (> ESTUDIO_FALLOS_MAX fallos de página mayores/s
    durante 10 s con RAM < 2x mínimo) mata la etapa (todo su grupo de procesos)."""

    def __init__(self, proc):
        super().__init__(daemon=True)
        self.proc = proc
        self.base = self._procesos()
        self.pico_total = self.pico_etapa = 0
        self.ram_min = 10**9
        self.motivo = None
        self.fin = threading.Event()

    @staticmethod
    def _procesos():
        r = subprocess.run(["nvidia-smi", "--query-compute-apps=pid,used_memory", "--format=csv,noheader,nounits"],
                           capture_output=True, text=True)
        d = {}
        for ln in r.stdout.strip().splitlines():
            try:
                p, m = [x.strip() for x in ln.split(",")]
                d[int(p)] = int(m)
            except ValueError:
                pass
        return d

    def run(self):
        ram_min = int(os.environ.get("ESTUDIO_RAM_MIN_MIB", "2500"))
        fallos_max = int(os.environ.get("ESTUDIO_FALLOS_MAX", "3000"))
        f_prev, t_prev, racha = fallos_mayores(), time.time(), 0
        while not self.fin.is_set():
            r = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                               capture_output=True, text=True)
            try:
                self.pico_total = max(self.pico_total, int(r.stdout.strip().splitlines()[0]))
            except (ValueError, IndexError):
                pass
            self.pico_etapa = max(self.pico_etapa, sum(m for p, m in self._procesos().items() if p not in self.base))
            disp = mem_disponible_mib()
            self.ram_min = min(self.ram_min, disp)
            f, t = fallos_mayores(), time.time()
            tasa = (f - f_prev) / max(t - t_prev, 1e-3)
            f_prev, t_prev = f, t
            racha = racha + 1 if tasa > fallos_max else 0
            if self.proc.poll() is None and self.motivo is None:
                if disp < ram_min:
                    self._matar(f"RAM disponible {disp} MiB < {ram_min} MiB")
                elif racha >= 20 and disp < 2 * ram_min:
                    self._matar(f"thrashing: {tasa:.0f} fallos mayores/s durante 10 s con {disp} MiB disponibles")
            self.fin.wait(0.5)

    def _matar(self, motivo):
        self.motivo = motivo
        log(f"PERRO GUARDIÁN: {motivo} -> se mata la etapa")
        try:
            os.killpg(self.proc.pid, 9)
        except ProcessLookupError:
            pass


def etapa(nombre, python, script, spec, trabajo, memoria_max=None, env=None, tolerar=False):
    """Ejecuta etapas/<script> en su entorno, con tope de RAM (scope systemd) y perro guardián."""
    os.makedirs(f"{trabajo}/logs", exist_ok=True)
    ruta_spec = f"{trabajo}/{nombre}.json"
    jsave(spec, ruta_spec)
    ruta_log = f"{trabajo}/logs/{nombre}.log"
    mem = memoria_max or os.environ.get("ESTUDIO_MEMORIA_MAX", "9G")
    envs = {"HF_HOME": f"{RAIZ}/hf", "HF_HUB_DISABLE_TELEMETRY": "1", "HF_HUB_OFFLINE": "1",
            "TOKENIZERS_PARALLELISM": "false", "TMPDIR": os.environ.get("TMPDIR", "/tmp"),
            "PYTHONUNBUFFERED": "1", **(env or {})}
    cmd = ["systemd-run", "--scope", "-q", "-p", f"MemoryMax={mem}", "-p", "MemorySwapMax=0",
           *[f"--setenv={k}={v}" for k, v in envs.items()], python, os.path.join(ETAPAS, script), ruta_spec]
    t0 = time.time()
    with open(ruta_log, "w") as flog:
        proc = subprocess.Popen(cmd, stdout=flog, stderr=subprocess.STDOUT, start_new_session=True)
        g = Guardian(proc)
        g.start()
        rc = proc.wait()
    g.fin.set()
    g.join()
    info = {"etapa": nombre, "tiempo_s": round(time.time() - t0, 1), "vram_pico_etapa_mib": g.pico_etapa,
            "vram_pico_gpu_total_mib": g.pico_total, "ram_disponible_min_mib": g.ram_min, "codigo": rc,
            "memoria_max": mem, "fin": time.strftime("%H:%M:%S")}
    if g.motivo:
        info["perro_guardian"] = g.motivo
    recursos = jload(f"{trabajo}/recursos.json", [])
    recursos.append(info)
    jsave(recursos, f"{trabajo}/recursos.json")
    log(f"etapa {nombre}: {info['tiempo_s']}s VRAM etapa {g.pico_etapa} MiB (GPU total {g.pico_total} MiB) "
        f"RAM disp. mín {g.ram_min} MiB rc={rc}")
    if rc != 0 and not tolerar:
        cola = open(ruta_log, errors="replace").read()[-2500:]
        raise RuntimeError(f"etapa {nombre} falló (rc={rc}, {g.motivo or 'error'}). Final del log:\n{cola}")
    return info


# ----------------------------------------------------------------------------- audio
def lufs_ffmpeg(ruta):
    """Sonoridad integrada (LUFS) y pico verdadero con ffmpeg ebur128. Clips < 1 s se repiten para medir."""
    dur = sf.info(ruta).duration
    entrada = ["-i", ruta]
    if dur < 1.0:
        entrada = ["-stream_loop", str(int(np.ceil(1.2 / max(dur, 0.05)))), "-i", ruta]
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", *entrada, "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True)
    bloque = r.stderr[r.stderr.rfind("Summary:"):]
    mi = re.search(r"I:\s+(-?[\d.]+|-inf) LUFS", bloque)
    mp = re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", bloque)
    i = float(mi.group(1)) if mi and mi.group(1) != "-inf" else None
    p = float(mp.group(1)) if mp and mp.group(1) != "-inf" else None
    return i, p


def _lufs_mp3(ruta):
    """Sonoridad integrada de un MP3 (se decodifica a WAV temporal)."""
    tmp = ruta + ".__med.wav"
    sh(["ffmpeg", "-v", "error", "-y", "-i", ruta, "-c:a", "pcm_f32le", tmp])
    try:
        return lufs_ffmpeg(tmp)[0]
    finally:
        os.remove(tmp)


def objetivo_lufs():
    p = f"{REFS}/objetivo.json"
    o = jload(p)
    if o is None:
        vals = {k: lufs_ffmpeg(f"{REFS}/{k}.wav")[0] for k in FRASES}
        o = {"lufs_kokoro_dora": round(float(np.mean([v for v in vals.values() if v is not None])), 2),
             "por_frase": vals}
        jsave(o, p)
    return o["lufs_kokoro_dora"]


def limites_actividad(w, sr, umbral_rel_db=40.0, piso_db=-55.0, pre=0.02, post=0.06):
    """(ini, fin) de la zona con sonido: umbral = max(piso, pico - umbral_rel) sobre RMS de 10 ms."""
    hop = int(sr * 0.01)
    n = max(1, len(w) // hop)
    rms = np.sqrt(np.mean(w[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms)
    umbral = max(piso_db, db.max() - umbral_rel_db)
    act = np.where(db > umbral)[0]
    if len(act) == 0:
        return 0, len(w)
    return max(0, act[0] * hop - int(pre * sr)), min(len(w), (act[-1] + 1) * hop + int(post * sr))


def recorte_ajustado(w, sr, **kw):
    """Quita silencio al principio/final (ver limites_actividad) con fundidos cortos. w: (n,) o (n, canales)."""
    a, b = limites_actividad(w if w.ndim == 1 else w.mean(axis=1), sr, **kw)
    w = w[a:b].copy()
    fi, fo = int(0.004 * sr), int(0.025 * sr)
    if len(w) > fi + fo:
        ent, sal = np.linspace(0, 1, fi), np.linspace(1, 0, fo)
        w[:fi] *= ent if w.ndim == 1 else ent[:, None]
        w[-fo:] *= sal if w.ndim == 1 else sal[:, None]
    return w


def exportar(ruta_in, destino_base, lufs_obj, estereo=False, recortar=True, ganancia_rel_db=0.0):
    """-> <destino_base>.mp3 (44.1 kHz) y <destino_base>_24k.wav (24 kHz mono PCM16), sonoridad = lufs_obj
    (+ ganancia_rel_db).  Ganancia lineal + limitador (techo -1 dBFS) para evitar recortes."""
    w, sr = sf.read(ruta_in, dtype="float32", always_2d=True)
    tmp = destino_base + ".__tmp.wav"
    if estereo and w.shape[1] == 2:
        x = w
        if recortar:
            x = recorte_ajustado(w, sr)
        sf.write(tmp, x, sr, subtype="FLOAT")
    else:
        mono = w.mean(axis=1)
        sf.write(tmp, recorte_ajustado(mono, sr) if recortar else mono, sr, subtype="FLOAT")
    objetivo = lufs_obj + ganancia_rel_db
    tmp_mono = destino_base + ".__tmpm.wav"
    sh(["ffmpeg", "-v", "error", "-y", "-i", tmp, "-ac", "1", "-c:a", "pcm_f32le", tmp_mono])

    def render(fuente, salida, g, args):
        cadena = f"volume={g:.2f}dB,alimiter=limit=0.891:level=false:attack=2:release=50"
        if salida.endswith("_24k.wav"):
            cadena += ",aresample=24000:resampler=soxr"
        sh(["ffmpeg", "-v", "error", "-y", "-i", fuente, "-af", cadena, *args, salida])

    ganancias = {}
    # MP3 (estéreo en canciones) y WAV 24 kHz mono se igualan POR SEPARADO: la mezcla a mono baja ~3 LU la
    # sonoridad de una pista estéreo.  Dos pasadas: la 2ª corrige lo que haya comido el limitador.
    for fuente, salida, args in ((tmp, destino_base + ".mp3", ["-ar", "44100", "-ac", "2" if estereo else "1",
                                                                "-c:a", "libmp3lame", "-b:a", "192k" if estereo else "128k"]),
                                 (tmp_mono, destino_base + "_24k.wav", ["-ac", "1", "-c:a", "pcm_s16le"])):
        i0, _ = lufs_ffmpeg(fuente)
        g = (objetivo - i0) if i0 is not None else 0.0
        render(fuente, salida, g, args)
        i1 = lufs_ffmpeg(salida)[0] if salida.endswith(".wav") else _lufs_mp3(salida)
        if i1 is not None and abs(i1 - objetivo) > 0.3:
            g += objetivo - i1
            render(fuente, salida, g, args)
        ganancias[os.path.basename(salida)] = round(g, 2)
    os.remove(tmp)
    os.remove(tmp_mono)
    i2, p2 = lufs_ffmpeg(destino_base + "_24k.wav")
    i3 = _lufs_mp3(destino_base + ".mp3")
    w2, _ = sf.read(destino_base + "_24k.wav", dtype="float32")
    m3 = sh(["ffprobe", "-v", "error", "-show_entries", "stream=sample_rate,channels", "-of", "csv=p=0",
             destino_base + ".mp3"]).stdout.strip()
    g = ganancias
    return {"mp3": os.path.basename(destino_base) + ".mp3", "wav24k": os.path.basename(destino_base) + "_24k.wav",
            "duracion_s": round(len(w2) / 24000, 3), "lufs_wav24k": i2, "pico_dbtp_wav24k": p2, "lufs_mp3": i3,
            "muestras_recortadas_wav24k": int((np.abs(w2) >= 0.999).sum()), "ganancia_db": g,
            "mp3_sr_canales": m3}


# ----------------------------------------------------------------------------- REFERENCIAS (con Voicebox)
def cmd_referencias(pedido, a):
    os.makedirs(REFS, exist_ok=True)
    for k, frase in FRASES.items():
        p = f"{REFS}/{k}.wav"
        if not os.path.exists(p):
            voicebox_tts(frase, p)
        log(f"{k}: {sf.info(p).duration:.2f}s {sf.info(p).samplerate} Hz")
    quita = "silenceremove=start_periods=1:start_threshold=-50dB:stop_periods=-1:stop_duration=0.3:stop_threshold=-50dB"
    ins = sum([["-i", f"{REFS}/d0{k}.wav"] for k in range(1, 6)], [])
    sh(["ffmpeg", "-v", "error", "-y", *ins, "-filter_complex", f"concat=n=5:v=0:a=1,{quita}", "-t", "25", REF_CONV])
    sh(["ffmpeg", "-v", "error", "-y", "-i", f"{REFS}/d01.wav", "-i", f"{REFS}/d02.wav", "-filter_complex",
        f"concat=n=2:v=0:a=1,{quita}", REF_CB])
    total = sum(sf.info(f"{REFS}/{k}.wav").duration for k in FRASES)
    log(f"referencias: total {total:.1f}s; conv {sf.info(REF_CONV).duration:.1f}s; chatterbox {sf.info(REF_CB).duration:.1f}s")
    # lecturas HABLADAS de cada letra (línea base de habla para las métricas de f0)
    for c in pedido.get("canciones", []):
        p = f"{REFS}/habla_{c['id']}.wav"
        if not os.path.exists(p):
            voicebox_tts(letra_plana(c["letra"]), p, idioma=c.get("idioma", "es"))
        log(f"habla_{c['id']}: {sf.info(p).duration:.1f}s")
    jsave({"frases": FRASES, "conversion": REF_CONV, "chatterbox": REF_CB, "dia_prompt": REF_DIA,
           "dia_prompt_texto": "[S1] " + FRASES["d01"], "evaluacion": EVAL, "total_s": round(total, 1)},
          f"{REFS}/referencias.json")
    log(f"sonoridad objetivo Kokoro/Dora = {objetivo_lufs()} LUFS")


def cmd_kokoro(pedido, a):
    """Interjecciones con palabra (¡ay!, ¡uy!, ¡ups!...) con Kokoro/Dora + prosodia ffmpeg (necesita Voicebox)."""
    d = f"{a.trabajo}/expresiones/kokoro"
    os.makedirs(d, exist_ok=True)
    res = []
    for x in [x for x in pedido["expresiones"] if x.get("motor") == "kokoro"]:
        textos = x["texto"] if isinstance(x["texto"], list) else [x["texto"]]
        filtros = x.get("filtro") or [None] * len(textos)
        for k, (t, f) in enumerate(zip(textos, filtros)):
            ruta = f"{d}/{x['id']}__k{k}.wav"
            if os.path.exists(ruta):  # ya generada (y quizá evaluada): no se regenera
                res.append({"id": x["id"], "ruta": ruta, "metodo": "kokoro+ffmpeg", "texto": t, "filtro": f})
                continue
            cruda = voicebox_tts(t, f"{d}/{x['id']}__k{k}_crudo.wav")
            sh(["ffmpeg", "-v", "error", "-y", "-i", cruda, "-af", f or "anull", "-ar", "24000", "-ac", "1", ruta])
            res.append({"id": x["id"], "ruta": ruta, "metodo": "kokoro+ffmpeg", "texto": t, "filtro": f})
            log(f"kokoro {x['id']} k{k}: «{t}» {sf.info(ruta).duration:.2f}s filtro={f}")
    jsave(res, f"{d}/kokoro.json")


# ----------------------------------------------------------------------------- CANCIONES
def _estado_c(t):
    return jload(f"{t}/estado_canciones.json", {})


def cmd_canciones_generar(pedido, a):
    t = a.trabajo
    dc = f"{t}/canciones"
    lista = [c for c in pedido["canciones"] if not a.ids or c["id"] in a.ids.split(",")]
    campos = ("id", "letra", "estilo", "bpm", "duracion", "tonalidad", "compas", "semillas", "semilla_base",
              "candidatos", "pasos", "shift", "pensar", "idioma", "lm_temperatura")
    etapa("cantar", PY_ACE, "cantar.py", {
        "salida_dir": dc, "precision": "bf16", "offload": not a.voicebox_parado,
        "canciones": [{k: v for k, v in c.items() if k in campos} for c in lista]}, t,
        memoria_max="11G" if a.voicebox_parado else "8G",
        env={"MAX_CUDA_VRAM": "14" if a.voicebox_parado else "10"}, tolerar=True)
    trabajos = []
    for c in lista:
        for k in range(40):
            cruda = f"{dc}/{c['id']}/cruda_{k}.wav"
            if os.path.exists(cruda):
                os.makedirs(f"{dc}/{c['id']}/sep_{k}", exist_ok=True)
                trabajos.append({"entrada": cruda, "dir": f"{dc}/{c['id']}/sep_{k}"})
    etapa("separar", PY_VC, "separar.py", {"modelo": "htdemucs", "shifts": 2, "trabajos": trabajos}, t)
    evaluar_canciones(pedido, t, "voz.wav")


def evaluar_canciones(pedido, t, nombre):
    dc = f"{t}/canciones"
    est = _estado_c(t)
    archivos = []
    for c in pedido["canciones"]:
        for k in range(40):
            p = f"{dc}/{c['id']}/sep_{k}/{nombre}"
            clave = f"{c['id']}|{k}|{nombre}"
            if os.path.exists(p) and clave not in est:
                archivos.append({"ruta": p, "whisper": c.get("idioma", "es"), "f0": True, "sim": True,
                                 "clave": clave})
    if archivos:
        salida = f"{t}/evaluar_{nombre.replace('.wav', '')}_{int(time.time())}.json"
        etapa(f"evaluar_{nombre.replace('.wav', '')}", PY_VC, "evaluar.py",
              {"dora_eval": EVAL, "salida": salida, "archivos": archivos}, t)
        letras = {c["id"]: letra_plana(c["letra"]) for c in pedido["canciones"]}
        for f, r in zip(archivos, jload(salida)):
            r["wer"] = wer(letras[f["clave"].split("|")[0]], r.get("whisper", ""))
            est[f["clave"]] = r
        jsave(est, f"{t}/estado_canciones.json")
    for clave in sorted(est):
        if clave.endswith(nombre):
            r = est[clave]
            f0 = r.get("f0", {})
            log(f"{clave}: WER={r.get('wer')} sim={r.get('sim_dora')} sost={f0.get('prop_sostenida')} "
                f"Δc={f0.get('delta_cents')} rango={f0.get('rango_st')} vib={f0.get('vibrato_frac')} "
                f"«{r.get('whisper', '')[:80]}»")


def puntuacion_cruda(r):
    f0 = r.get("f0", {})
    return -(r.get("wer") if r.get("wer") is not None else 1.0) + 0.5 * f0.get("prop_sostenida", 0)


def cmd_canciones_convertir(pedido, a):
    t = a.trabajo
    dc = f"{t}/canciones"
    est = _estado_c(t)
    trabajos = []
    for c in pedido["canciones"]:
        if a.ids and c["id"] not in a.ids.split(","):
            continue
        tomas = sorted([(puntuacion_cruda(r), int(k.split("|")[1])) for k, r in est.items()
                        if k.startswith(c["id"] + "|") and k.endswith("|voz.wav")], reverse=True)
        elegidas = [k for _, k in tomas[: a.top]]
        if a.tomas:  # p. ej. --tomas cancion-x:4,cancion-x:3
            elegidas = [int(x.split(":")[1]) for x in a.tomas.split(",") if x.split(":")[0] == c["id"]]
        for k in elegidas:
            d = f"{dc}/{c['id']}/sep_{k}"
            trabajos.append({"fuente": f"{d}/voz.wav", "referencia": REF_CONV, "salida": f"{d}/voz_dora{a.sufijo}.wav",
                             "semitonos": int(c.get("semitonos_vc", 0)), "auto_f0": False,
                             "pasos": a.pasos or int(c.get("pasos_vc", 50)),
                             "cfg": a.cfg if a.cfg is not None else float(c.get("cfg_vc", 0.7))})
    etapa(f"convertir_canto{a.sufijo}", PY_VC, "convertir.py", {"modo": "canto", "trabajos": trabajos,
                                                     "resumen": f"{t}/convertir_canto{a.sufijo}_res.json"}, t)
    evaluar_canciones(pedido, t, f"voz_dora{a.sufijo}.wav")


def cmd_canciones_final(pedido, a):
    from metricas import metricas_f0
    t = a.trabajo
    dc = f"{t}/canciones"
    est = _estado_c(t)
    lufs_obj = objetivo_lufs()
    dsal = f"{SALIDA}/canciones"
    os.makedirs(dsal, exist_ok=True)
    manif = jload(f"{dsal}/manifiesto.json", {"canciones": [], "rechazadas": []})
    manif["canciones"] = [m for m in manif["canciones"] if m["id"] not in [c["id"] for c in pedido["canciones"]]]
    manif["rechazadas"] = [m for m in manif["rechazadas"] if m["id"] not in [c["id"] for c in pedido["canciones"]]]
    criterios = pedido.get("criterios_canto", {})
    wer_max = float(criterios.get("wer_max", 0.35))
    for c in pedido["canciones"]:
        if a.ids and c["id"] not in a.ids.split(","):
            continue
        habla_p = f"{REFS}/habla_{c['id']}.wav"
        w, sr = sf.read(habla_p, dtype="float32", always_2d=True)
        habla = metricas_f0(w.mean(axis=1), sr)
        candidatas = []
        for k, variante in [(k, v) for k in range(40) for v in VARIANTES_VC]:
            rc = est.get(f"{c['id']}|{k}|voz.wav")
            rv = est.get(f"{c['id']}|{k}|{variante}")
            if not rv:
                continue
            f0 = rv["f0"]
            motivos = []
            if rv.get("wer") is None or rv["wer"] > wer_max:
                motivos.append(f"WER {rv.get('wer')} > {wer_max}")
            if f0["prop_sostenida"] < max(0.30, 2 * habla["prop_sostenida"]):
                motivos.append(f"prop_sostenida {f0['prop_sostenida']} < max(0.30, 2x habla {habla['prop_sostenida']})")
            if habla.get("delta_cents") and f0.get("delta_cents") and f0["delta_cents"] > 0.8 * habla["delta_cents"]:
                motivos.append(f"estabilidad Δcents {f0['delta_cents']} > 0.8x habla {habla['delta_cents']}")
            if f0["sonora_activa"] < 0.5:
                motivos.append(f"sonora_activa {f0['sonora_activa']} < 0.5")
            if rv.get("sim_dora") is None or rc is None or rv["sim_dora"] < (rc.get("sim_dora") or 0) + 0.02:
                motivos.append(f"sim Dora convertida {rv.get('sim_dora')} no supera cruda {rc and rc.get('sim_dora')} + 0.02")
            candidatas.append({"k": k, "variante": variante, "motivos": motivos, "wer": rv.get("wer"), "sim": rv.get("sim_dora"),
                               "cruda": rc, "dora": rv})
        ok = sorted([x for x in candidatas if not x["motivos"]], key=lambda x: (x["wer"], -(x["sim"] or 0)))
        resumen_tomas = [{"toma": x["k"], "conversion": x["variante"], "wer_voz_dora": x["wer"], "wer_voz_cruda": x["cruda"] and x["cruda"].get("wer"),
                          "sim_dora": x["sim"], "sim_cruda": x["cruda"] and x["cruda"].get("sim_dora"),
                          "prop_sostenida": x["dora"]["f0"]["prop_sostenida"], "rechazo": x["motivos"]}
                         for x in candidatas]
        if not ok:
            manif["rechazadas"].append({"id": c["id"], "motivo": "ninguna toma supera los criterios",
                                        "tomas": resumen_tomas, "habla": habla})
            log(f"{c['id']}: RECHAZADA — ninguna toma pasa: {resumen_tomas}")
            continue
        mejor = ok[0]
        d = f"{dc}/{c['id']}/sep_{mejor['k']}"
        # mezcla: voz Dora al mismo nivel relativo que tenía la voz original frente al instrumental
        li_voz, _ = lufs_ffmpeg(f"{d}/voz.wav")
        stem = f"{d}/{mejor['variante']}"
        li_dora, _ = lufs_ffmpeg(stem)
        ajuste = (li_voz - li_dora) if (li_voz is not None and li_dora is not None) else 0.0
        ajuste += float(c.get("voz_db", 0.0))
        rev = ",aecho=0.8:0.55:40|77:0.12|0.07" if c.get("reverb", True) else ""
        filtro = (f"[0:a]highpass=f=80,volume={ajuste:.2f}dB,pan=stereo|c0=c0|c1=c0{rev}[v];"
                  f"[1:a]volume={float(c.get('inst_db', 0))}dB[i];[v][i]amix=inputs=2:duration=longest:normalize=0[m]")
        mezcla = f"{d}/mezcla.wav"
        sh(["ffmpeg", "-v", "error", "-y", "-i", stem, "-i", f"{d}/instrumental.wav",
            "-filter_complex", filtro, "-map", "[m]", "-ar", "44100", "-c:a", "pcm_f32le", mezcla])
        fin = exportar(mezcla, f"{dsal}/{c['id']}", lufs_obj, estereo=True, recortar=True)
        voz = exportar(stem, f"{dsal}/{c['id']}-voz", lufs_obj, estereo=False, recortar=True)
        meta = jload(f"{dc}/{c['id']}/cruda_{mejor['k']}.json", {})
        entrada = {"id": c["id"], "archivos": {"mp3": fin["mp3"], "wav24k": fin["wav24k"],
                                               "voz_sola_mp3": voz["mp3"], "voz_sola_wav24k": voz["wav24k"]},
                   "duracion_s": fin["duracion_s"], "toma_elegida": mejor["k"], "conversion": mejor["variante"],
                   "parametros_conversion": VARIANTES_VC[mejor["variante"]], "semilla_ace": meta.get("semilla"),
                   "metodo": "ACE-Step 1.5 turbo (letra+estilo, LM 0.6B, bf16) -> Demucs htdemucs -> Seed-VC canto "
                             "(f0 RMVPE, 44.1 kHz, referencia Kokoro/Dora) -> remezcla ffmpeg -> sonoridad Kokoro",
                   "letra": letra_plana(c["letra"]), "estilo": c["estilo"],
                   "metricas": {"canto_voz_dora_f0": mejor["dora"]["f0"], "habla_kokoro_f0": habla,
                                "canto_voz_cruda_f0": mejor["cruda"]["f0"],
                                "wer_voz_dora": mejor["wer"], "whisper_voz_dora": mejor["dora"].get("whisper"),
                                "wer_voz_cruda": mejor["cruda"].get("wer"),
                                "sim_dora_convertida": mejor["sim"], "sim_dora_cruda": mejor["cruda"].get("sim_dora"),
                                "muestras_recortadas_voz_convertida": mejor["dora"].get("muestras_recortadas"),
                                "export": fin},
                   "tomas": resumen_tomas}
        manif["canciones"].append(entrada)
        log(f"{c['id']}: toma {mejor['k']} WER={mejor['wer']} sim={mejor['sim']} -> {fin['mp3']} {fin['duracion_s']}s")
    manif["lufs_objetivo_kokoro"] = lufs_obj
    jsave(manif, f"{dsal}/manifiesto.json")


# ----------------------------------------------------------------------------- EXPRESIONES
def cmd_expresiones_generar(pedido, a):
    t = a.trabajo
    de = f"{t}/expresiones"
    lista = pedido["expresiones"]
    motores = a.motores.split(",")
    cand = jload(f"{de}/candidatas.json", [])
    hechos = {c["ruta"] for c in cand}
    # "dia" = Dia con prompt de audio de Dora (clonación); "dia-libre" = Dia SIN prompt (voz aleatoria; el timbre
    # de Dora lo pone Seed-VC).  Con prompt, Dia 1.6B tiende a volver a decir la frase del prompt.
    for motor in ("chatterbox", "dia", "dia-libre"):
        clips = [x for x in lista if x.get("motor") == motor]
        if motor not in motores or not clips:
            continue
        d = f"{de}/{motor}"
        spec = {"motor": "dia" if motor == "dia-libre" else motor, "salida_dir": d,
                "referencia": {"chatterbox": REF_CB, "dia": REF_DIA, "dia-libre": None}[motor],
                "clips": [{k: v for k, v in x.items() if k in ("id", "texto", "n", "semilla", "temperatura", "top_p",
                                                                 "cfg", "max_tokens", "rep")} for x in clips]}
        if motor == "dia":
            spec["referencia_texto"] = "[S1] " + FRASES["d01"]
        etapa(f"expresar_{motor}", PY_VC, "expresar.py", spec, t, tolerar=True)
        for r in jload(f"{d}/expresar_{spec['motor']}.json", []):
            if r["ruta"] not in hechos:
                cand.append({"id": r["id"], "ruta": r["ruta"], "metodo": motor, "texto": r["texto"]})
                hechos.add(r["ruta"])
    for r in jload(f"{de}/kokoro/kokoro.json", []):
        if r["ruta"] not in hechos:
            cand.append(r)
            hechos.add(r["ruta"])
    # conversión a Dora con Seed-VC (habla; y canto-f0 para tarareos si vc_canto)
    vc = {x["id"]: x for x in lista}
    for modo in ("habla", "canto"):
        trabajos, nuevas = [], []
        for c in list(cand):
            x = vc.get(c["id"], {})
            if c["metodo"] not in ("chatterbox", "dia", "dia-libre"):
                continue
            if modo == "canto" and not any(y.get("vc_canto") for y in lista if y["id"] == c["id"]):
                continue
            s = c["ruta"].replace(".wav", f"__vc{modo}.wav")
            if s in hechos:
                continue
            trabajos.append({"fuente": c["ruta"], "referencia": REF_CONV, "salida": s, "auto_f0": True,
                             "pasos": int(pedido.get("pasos_vc_expresiones", 20)) if modo == "habla" else 30,
                             "cfg": 0.7})
            nuevas.append({"id": c["id"], "ruta": s, "metodo": f"{c['metodo']}+seedvc_{modo}", "texto": c["texto"]})
        if trabajos:
            etapa(f"convertir_{modo}_expr", PY_VC, "convertir.py", {"modo": modo, "trabajos": trabajos}, t, tolerar=True)
            for n in nuevas:
                if os.path.exists(n["ruta"]):
                    cand.append(n)
                    hechos.add(n["ruta"])
    jsave(cand, f"{de}/candidatas.json")
    # evaluación de las candidatas nuevas (sobre el audio recortado, que es lo que se exporta)
    ev = jload(f"{de}/evaluacion.json", {})
    archivos = []
    os.makedirs(f"{de}/recortes", exist_ok=True)
    for c in cand:
        if c["ruta"] in ev:
            continue
        w, sr = sf.read(c["ruta"], dtype="float32", always_2d=True)
        rec = recorte_ajustado(w.mean(axis=1), sr)
        pr = f"{de}/recortes/{os.path.basename(c['ruta'])}"
        sf.write(pr, rec, sr, subtype="FLOAT")
        x = [y for y in lista if y["id"] == c["id"] and ("clases" in y or "esperado" in y)]
        x = x[0] if x else {}
        archivos.append({"ruta": pr, "origen": c["ruta"], "clases": x.get("clases", []),
                         "whisper": "es" if c["metodo"].startswith("kokoro") else x.get("whisper_idioma", "en"),
                         "sim": True, "f0": bool(x.get("f0"))})
    if archivos:
        salida = f"{de}/evaluar_{int(time.time())}.json"
        etapa("evaluar_expresiones", PY_VC, "evaluar.py", {"dora_eval": EVAL, "salida": salida,
                                                          "archivos": archivos}, t)
        for f, r in zip(archivos, jload(salida)):
            r["recorte"] = f["ruta"]
            ev[f["origen"]] = r
        jsave(ev, f"{de}/evaluacion.json")
    log(f"expresiones: {len(cand)} candidatas, {len(ev)} evaluadas")


def cmd_expresiones_final(pedido, a):
    t = a.trabajo
    de = f"{t}/expresiones"
    cand = jload(f"{de}/candidatas.json", [])
    ev = jload(f"{de}/evaluacion.json", {})
    lufs_obj = objetivo_lufs()
    dsal = f"{SALIDA}/expresiones"
    os.makedirs(dsal, exist_ok=True)
    for f in os.listdir(dsal):
        os.remove(os.path.join(dsal, f))
    params = {}
    for x in pedido["expresiones"]:
        p = params.setdefault(x["id"], {"motores": []})
        p["motores"].append(x.get("motor"))
        for k in ("clases", "esperado", "variantes", "dur", "palabras_ok", "ganancia_rel_db", "sim_min", "ast_min",
                  "verificacion", "descripcion", "nota"):
            if k in x and k not in p:
                p[k] = x[k]
    sim_min_def = float(pedido.get("sim_min", 0.60))
    manif = {"lufs_objetivo_kokoro": lufs_obj, "expresiones": [], "rechazadas": []}
    for ident, p in params.items():
        filas = []
        for c in [c for c in cand if c["id"] == ident]:
            r = ev.get(c["ruta"])
            if not r:
                continue
            motivos = []
            dur = r["duracion_s"]
            dmin, dmax = p.get("dur", [0.3, 4.0])
            if not (dmin <= dur <= dmax):
                motivos.append(f"duración {dur}s fuera de [{dmin}, {dmax}]")
            ast = r.get("ast_objetivo_max") or 0.0
            rango = r.get("ast_objetivo_rango", 99)
            texto = r.get("whisper", "")
            norm = normalizar_texto(texto).split()
            esperado = [normalizar_texto(e) for e in p.get("esperado", [])]
            ok_ast = bool(p.get("clases")) and (ast >= float(p.get("ast_min", 0.15)) or rango <= 3)
            ok_txt = bool(esperado) and any(any(tok == e or (len(e) >= 3 and tok.startswith(e[:3])) for e in esperado)
                                            for tok in norm)
            if not (ok_ast or ok_txt):
                motivos.append(f"no verificada: AST {r.get('ast_objetivo')} (rango {rango}) / Whisper «{texto}»")
            if c["metodo"].startswith("kokoro"):
                # Kokoro lee un texto: no puede aparecer NADA fuera de las palabras del propio texto (p. ej.
                # «¡Uy, uy!» transcrito «Uy, soy ya» = sílabas espurias) ni de las onomatopeyas.
                permitidas = set(normalizar_texto(c["texto"]).split()) | set(esperado)
                lex = [w for w in palabras_lexicas(texto) if w not in permitidas]
                if lex:
                    motivos.append(f"Kokoro: sílabas/palabras espurias {lex}")
            else:
                lex = palabras_lexicas(texto)
                if len(lex) > int(p.get("palabras_ok", 0)):
                    motivos.append(f"palabras de más: {lex}")
            sim = r.get("sim_dora")
            # Kokoro ES la voz Dora (TTS directo): exenta.  Resto (Chatterbox/Dia/Seed-VC) debe parecerse a Dora.
            smin = 0.0 if c["metodo"].startswith("kokoro") else float(p.get("sim_min", sim_min_def))
            if smin > 0 and (sim is None or sim < smin):
                motivos.append(f"similitud Dora {sim} < {smin}")
            if r.get("muestras_recortadas", 0) > 0:
                motivos.append("clipping en la candidata")
            puntos = (ast if p.get("clases") else 0.0) + (sim or 0.0) + (0.3 if ok_txt else 0.0)
            filas.append({**c, "motivos": motivos, "ast": ast, "ast_objetivo": r.get("ast_objetivo"),
                          "ast_top5": r.get("ast_top5"), "ast_rango": rango, "sim_dora": sim, "dur_s": dur,
                          "whisper": texto, "puntos": round(puntos, 3), "recorte": r["recorte"]})
        ok = sorted([f for f in filas if not f["motivos"]], key=lambda f: -f["puntos"])
        elegidas = []
        for f in ok:  # variantes de tomas distintas (no la cruda y su conversión)
            base = f["ruta"].split("__vc")[0]
            if any(e["ruta"].split("__vc")[0] == base for e in elegidas):
                continue
            elegidas.append(f)
            if len(elegidas) == int(p.get("variantes", 2)):
                break
        if not elegidas:
            manif["rechazadas"].append({"id": ident, "candidatas": len(filas),
                                        "motivos": sorted({m for f in filas for m in f["motivos"]})[:12]})
            log(f"{ident}: RECHAZADA ({len(filas)} candidatas)")
            continue
        for j, f in enumerate(elegidas):
            nombre = f"{ident}-{j + 1}"
            fin = exportar(f["recorte"], f"{dsal}/{nombre}", lufs_obj, recortar=True,
                           ganancia_rel_db=float(p.get("ganancia_rel_db", 0.0)))
            manif["expresiones"].append({
                "id": nombre, "expresion": ident, "archivos": {"mp3": fin["mp3"], "wav24k": fin["wav24k"]},
                "duracion_s": fin["duracion_s"], "metodo": f["metodo"], "texto_prompt": f["texto"],
                "filtro_ffmpeg": f.get("filtro"), "nota": p.get("nota"),
                # débil = pasó sólo porque una clase objetivo quedó en el top-3 de AST con probabilidad < ast_min
                # y Whisper no lo confirma: conviene escucharla antes de usarla
                "verificacion_debil": (bool(p.get("clases")) and f["ast"] < float(p.get("ast_min", 0.15))
                                       and not any(e in normalizar_texto(f["whisper"]).split()
                                                   for e in [normalizar_texto(x) for x in p.get("esperado", [])])),
                "verificado_por": ("AST" if (p.get("clases") and (f["ast"] >= float(p.get("ast_min", 0.15))
                                                                  or f["ast_rango"] <= 3)) else "Whisper"),
                "metricas": {"ast_objetivo": f["ast_objetivo"], "ast_top5": f["ast_top5"], "sim_dora": f["sim_dora"],
                             "whisper": f["whisper"], "lufs": fin["lufs_wav24k"], "pico_dbtp": fin["pico_dbtp_wav24k"],
                             "ganancia_rel_db": float(p.get("ganancia_rel_db", 0.0))}})
            log(f"{nombre}: {f['metodo']} {fin['duracion_s']}s ast={f['ast']:.2f} sim={f['sim_dora']} «{f['whisper'][:40]}»")
    jsave(manif, f"{dsal}/manifiesto.json")
    log(f"expresiones aceptadas: {len(manif['expresiones'])} archivos de "
        f"{len({e['expresion'] for e in manif['expresiones']})} expresiones; rechazadas {len(manif['rechazadas'])}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("orden", choices=["referencias", "kokoro", "canciones-generar", "canciones-convertir",
                                      "canciones-final", "expresiones-generar", "expresiones-final"])
    ap.add_argument("pedido")
    ap.add_argument("-t", "--trabajo", default="/opt/dlami/nvme/estudio-trabajo/actual")
    ap.add_argument("--ids", default="")
    ap.add_argument("--top", type=int, default=3)
    ap.add_argument("--tomas", default="", help="tomas explícitas a convertir: id:k,id:k")
    ap.add_argument("--sufijo", default="", help="variante de conversión: voz_dora<sufijo>.wav")
    ap.add_argument("--pasos", type=int, default=0)
    ap.add_argument("--cfg", type=float, default=None)
    ap.add_argument("--motores", default="chatterbox,dia")
    ap.add_argument("--voicebox-parado", action="store_true",
                    help="ventana de mantenimiento: ACE-Step todo en GPU (sin offload), MAX_CUDA_VRAM=14")
    a = ap.parse_args()
    pedido = json.load(open(a.pedido, encoding="utf-8"))
    os.makedirs(a.trabajo, exist_ok=True)
    libre = shutil.disk_usage(RAIZ).free / 2**30
    if libre < 10:
        raise SystemExit(f"sólo {libre:.1f} GB libres en {RAIZ}; se exigen >= 10 GB")
    {"referencias": cmd_referencias, "kokoro": cmd_kokoro, "canciones-generar": cmd_canciones_generar,
     "canciones-convertir": cmd_canciones_convertir, "canciones-final": cmd_canciones_final,
     "expresiones-generar": cmd_expresiones_generar, "expresiones-final": cmd_expresiones_final}[a.orden](pedido, a)


if __name__ == "__main__":
    main()
