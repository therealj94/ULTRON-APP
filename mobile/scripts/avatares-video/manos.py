"""Dónde deja cada clip la mano que agarra el sable de luz: el tramo de cuadros en que se va de su lugar
de la foto base. El sable (efectos/escena.ts, AGARRES en la mesa vertical) se dibuja en ese lugar: solo
puede estar en la mano mientras la mano está ahí. Escribe la tabla en TS.

Sigue la mano con una plantilla (la mano del cuadro 0, sin su brillo medio) buscada en ±20 px de un
cuadro de 180x320, cuadro por cuadro. «Fuera» = a más de U (fracción del alto del cuadro) de su lugar.

uso: manos.py mobile/assets/avatares/video mobile/src/avatares/video/manos.ts 0.04
(pip install numpy imageio-ffmpeg; ffmpeg: $FFMPEG, el de imageio-ffmpeg o el del PATH)
"""
import os, shutil, subprocess, sys
import numpy as np
from numpy.lib.stride_tricks import sliding_window_view


def _ffmpeg():
    if os.environ.get('FFMPEG'):
        return os.environ['FFMPEG']
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return shutil.which('ffmpeg') or 'ffmpeg'


FF = _ffmpeg()
CLIPS = ['reposo', 'escucha', 'habla', 'piensa', 'teclea', 'lee', 'espera', 'risa', 'saluda', 'senala', 'sorpresa', 'triste', 'celebra', 'asiente', 'niega', 'duda', 'despide']
W, H = 180, 320
# El centro del puño en la mesa vertical (0..1 del cuadro): lo mismo que AGARRES[avatar].cuerpo.mano de escena.ts.
MANO = {'claudio': (0.783, 0.712), 'antonio': (0.24, 0.874)}
R = 20  # la búsqueda, en px de 180x320
MEDIO_ANCHO, MEDIO_ALTO = 9, 10
# Un cuadro de más a cada lado del tramo: lo que tarda en irse o volver sin pasar el umbral del todo.
HOLGURA = 2


def cuadros(ruta):
    out = subprocess.run([FF, '-v', 'error', '-i', ruta, '-vf', f'scale={W}:{H}:flags=area', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(out, np.uint8).reshape(-1, H, W).astype(np.float32)


def desplazamientos(f, mx, my):
    """Cuánto se movió la mano en cada cuadro, en fracción del alto."""
    cx, cy = int(mx * W), int(my * H)
    pw, ph = 2 * MEDIO_ANCHO, 2 * MEDIO_ALTO
    tpl = f[0, cy - MEDIO_ALTO:cy + MEDIO_ALTO, cx - MEDIO_ANCHO:cx + MEDIO_ANCHO]
    tpl = tpl - tpl.mean()
    y0, x0 = max(0, cy - MEDIO_ALTO - R), max(0, cx - MEDIO_ANCHO - R)
    y1, x1 = min(H, cy + MEDIO_ALTO + R), min(W, cx + MEDIO_ANCHO + R)
    d = []
    for fr in f:
        ventanas = sliding_window_view(fr[y0:y1, x0:x1], (ph, pw))  # [dy, dx, ph, pw]
        v = ventanas - ventanas.mean(axis=(2, 3), keepdims=True)
        err = np.abs(v - tpl).mean(axis=(2, 3))
        iy, ix = np.unravel_index(int(np.argmin(err)), err.shape)
        dy = (y0 + iy) - (cy - MEDIO_ALTO)
        dx = (x0 + ix) - (cx - MEDIO_ANCHO)
        d.append(float(np.hypot(dx, dy)) / H)
    return np.array(d)


def main():
    carpeta, salida = sys.argv[1], sys.argv[2]
    U = float(sys.argv[3]) if len(sys.argv) > 3 else 0.04
    tabla = {}
    for av in ['claudio', 'antonio']:
        tabla[av] = {}
        mx, my = MANO[av]
        for c in CLIPS:
            f = cuadros(os.path.join(carpeta, f'{av}-{c}.mp4'))
            d = desplazamientos(f, mx, my)
            fuera = np.where(d > U)[0]
            if len(fuera):
                tabla[av][c] = [max(0, int(fuera[0]) - HOLGURA), min(len(f) - 1, int(fuera[-1]) + HOLGURA)]
            print(f'{av:8s} {c:9s} máx {d.max() * 100:4.1f} %  fuera {tabla[av].get(c, "-")}', flush=True)
    with open(salida, 'w') as o:
        o.write('/**\n * GENERADO por mobile/scripts/avatares-video/manos.py (docs/avatares-video.md): no editar a mano.\n')
        o.write(' * Para cada clip: [primer cuadro, último cuadro] del tramo en que la mano que agarra el sable (AGARRES de\n')
        o.write(f' * efectos/escena.ts, la mesa vertical) se va de su lugar de la foto base: a más de {U} del alto del cuadro.\n')
        o.write(' * Sin entrada: la mano no se va en todo el clip. A 24 cuadros por segundo (reposos.ts).\n */\n')
        o.write("import type { ClipVideo } from './guion';\n\n")
        o.write("export const MANO_FUERA: Record<'claudio' | 'antonio', Partial<Record<ClipVideo, readonly [number, number]>>> = {\n")
        for av in tabla:
            o.write(f'  {av}: {{\n')
            for c, v in tabla[av].items():
                o.write(f'    {c}: [{v[0]}, {v[1]}],\n')
            o.write('  },\n')
        o.write('};\n')


if __name__ == '__main__':
    main()
