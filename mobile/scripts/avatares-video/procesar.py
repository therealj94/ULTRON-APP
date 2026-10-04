"""Rehace los clips para que enganchen sin costura (el procedimiento está en docs/avatares-video.md):

  · la COLA: los últimos M cuadros de cada clip se funden, con una curva suave, hacia su propio cuadro 0
    (la foto base). El último cuadro queda en la foto base: el bucle de un fondo cierra sin el salto de
    textura que se veía cada 5 s, y un golpe termina exactamente en la pose de reposo. El cuadro 0 no se toca;
  · codificación que no deja «derivar» los cuadros quietos del final del GOP (fast-pskip=0, dct-decimate=0,
    deadzone 6): era la otra mitad del salto de la costura;
  · un solo cuadro clave, el 0: sin el «bombeo» de textura que hacían los del medio (cada 2 s) en los
    momentos quietos. Ya no se busca dentro de un clip (siempre arranca en el 0), así que no hacen falta;
  · 720×1280 H.264 main yuv420p, sin audio, faststart. Todo en YUV, sin pasar por RGB.

uso: procesar.py <originales> <salida> [crf=29] [clip...]   (los originales, fuera del repo)
"""
import sys, os, subprocess
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from medir import CLIPS, FONDOS, FF

M = 8  # cuadros de la cola (1/3 s)
TAM = 720 * 1280 * 3 // 2
X264 = 'fast-pskip=0:dct-decimate=0:deadzone-inter=6:deadzone-intra=6:ipratio=1.15:aq-mode=3'


def leer(ruta):
    out = subprocess.run([FF, '-v', 'error', '-i', ruta, '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(out, np.uint8).reshape(-1, TAM).astype(np.float32)


def cola(fr):
    fr = fr.copy()
    n = len(fr)
    for k in range(M):
        a = (k + 1) / M
        a = a * a * (3 - 2 * a)  # smoothstep: arranca y llega sin quiebre
        fr[n - M + k] = fr[n - M + k] * (1 - a) + fr[0] * a
    return fr


def escribir(fr, ruta, crf, g):
    p = subprocess.Popen([FF, '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', '720x1280', '-r', '24', '-i', '-',
                          '-an', '-c:v', 'libx264', '-profile:v', 'main', '-level', '3.1', '-pix_fmt', 'yuv420p',
                          '-crf', str(crf), '-preset', 'veryslow', '-g', str(g), '-keyint_min', str(g), '-sc_threshold', '0',
                          '-x264-params', X264, '-movflags', '+faststart', ruta], stdin=subprocess.PIPE)
    p.stdin.write(np.clip(np.rint(fr), 0, 255).astype(np.uint8).tobytes())
    p.stdin.close()
    assert p.wait() == 0


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    crf = float(sys.argv[3]) if len(sys.argv) > 3 else 29
    solo = sys.argv[4:]
    os.makedirs(dst, exist_ok=True)
    for av in ['claudio', 'antonio']:
        for c in CLIPS:
            nombre = f'{av}-{c}.mp4'
            if solo and nombre not in solo and c not in solo:
                continue
            fr = cola(leer(os.path.join(src, nombre)))
            escribir(fr, os.path.join(dst, nombre), crf, 250)
            print(nombre, len(fr), os.path.getsize(os.path.join(dst, nombre)) // 1024, 'KB', flush=True)
