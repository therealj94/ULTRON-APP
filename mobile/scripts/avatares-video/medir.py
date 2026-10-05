"""Mide las poses de los clips: primer/último cuadro contra el de referencia (reposo, cuadro 0),
costura del bucle, deriva a lo largo del clip, encuadre (caja del personaje), brillo y color.

uso: python medir.py <carpeta_clips> <salida.json>
(pip install numpy pillow scikit-image imageio-ffmpeg; ffmpeg: $FFMPEG, el de imageio-ffmpeg o el del PATH)
"""
import json, shutil, subprocess, sys, os
import numpy as np
from skimage.metrics import structural_similarity as ssim


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
FONDOS = CLIPS[:7]
W, H = 360, 640


def cuadros(ruta, w=W, h=H):
    out = subprocess.run([FF, '-v', 'error', '-i', ruta, '-vf', f'scale={w}:{h}:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(out, np.uint8).reshape(-1, h, w, 3)


def gris(f):
    return (f[..., 0] * 0.299 + f[..., 1] * 0.587 + f[..., 2] * 0.114).astype(np.float32)


def psnr(a, b):
    m = np.mean((a.astype(np.float32) - b.astype(np.float32)) ** 2)
    return 99.0 if m == 0 else float(10 * np.log10(255 ** 2 / m))


def mad(a, b):
    return float(np.mean(np.abs(a.astype(np.float32) - b.astype(np.float32))))


def caja(f, fondo):
    """Caja del personaje: píxeles que se apartan del color de fondo."""
    d = np.abs(f.astype(np.int16) - fondo[None, None, :].astype(np.int16)).sum(-1)
    m = d > 60
    ys, xs = np.nonzero(m)
    if len(ys) == 0:
        return None
    return {'x0': int(np.percentile(xs, 1)), 'x1': int(np.percentile(xs, 99)), 'y0': int(np.percentile(ys, 1)), 'y1': int(np.percentile(ys, 99)), 'cx': float(xs.mean()), 'cy': float(ys.mean()), 'area': int(m.sum())}


def main(carpeta, salida):
    res = {}
    for av in ['claudio', 'antonio']:
        ref = cuadros(os.path.join(carpeta, f'{av}-reposo.mp4'))[0]
        refg = gris(ref)
        # color del fondo: esquinas superiores
        fondo = np.median(np.concatenate([ref[:40, :40].reshape(-1, 3), ref[:40, -40:].reshape(-1, 3)]), 0)
        res[av] = {'fondo_rgb': fondo.tolist(), 'clips': {}}
        for c in CLIPS:
            fr = cuadros(os.path.join(carpeta, f'{av}-{c}.mp4'))
            g = [gris(x) for x in fr]
            n = len(fr)
            paso = [mad(g[i], g[i + 1]) for i in range(n - 1)]
            deriva = [mad(x, refg) for x in g]
            fondo_c = np.median(np.concatenate([fr[0][:40, :40].reshape(-1, 3), fr[0][:40, -40:].reshape(-1, 3)]), 0)
            r = {
                'n': n,
                'ini_ssim': float(ssim(g[0], refg, data_range=255)), 'ini_psnr': psnr(fr[0], ref), 'ini_mad': mad(g[0], refg),
                'fin_ssim': float(ssim(g[-1], refg, data_range=255)), 'fin_psnr': psnr(fr[-1], ref), 'fin_mad': mad(g[-1], refg),
                'costura_ssim': float(ssim(g[-1], g[0], data_range=255)), 'costura_psnr': psnr(fr[-1], fr[0]), 'costura_mad': mad(g[-1], g[0]),
                'paso_mediana': float(np.median(paso)), 'paso_max': float(np.max(paso)), 'paso_max_en': int(np.argmax(paso)),
                'paso_ini': paso[:3], 'paso_fin': paso[-3:],
                'deriva_max': float(np.max(deriva)), 'deriva_max_en': int(np.argmax(deriva)), 'deriva': [round(x, 2) for x in deriva],
                # a los 4,68 s (aviso del golpe, 320 ms antes del final) y a 1,8 s (cuando lo corta el habla)
                'mad_468': deriva[min(n - 1, round(4.68 * 24))], 'mad_180': deriva[min(n - 1, round(1.8 * 24))],
                'brillo_ini': float(g[0].mean()), 'brillo_fin': float(g[-1].mean()),
                'rgb_ini': fr[0].reshape(-1, 3).mean(0).tolist(), 'rgb_fin': fr[-1].reshape(-1, 3).mean(0).tolist(),
                'fondo_rgb': fondo_c.tolist(),
                'caja_ini': caja(fr[0], fondo), 'caja_fin': caja(fr[-1], fondo),
            }
            res[av]['clips'][c] = r
            print(f"{av:8s} {c:9s} ini ssim {r['ini_ssim']:.4f} mad {r['ini_mad']:5.2f} | fin ssim {r['fin_ssim']:.4f} mad {r['fin_mad']:5.2f} | costura {r['costura_psnr']:5.1f}dB mad {r['costura_mad']:5.2f} | paso med {r['paso_mediana']:4.2f} max {r['paso_max']:5.2f}@{r['paso_max_en']} | deriva max {r['deriva_max']:5.2f}@{r['deriva_max_en']} | @1.8 {r['mad_180']:5.2f} @4.68 {r['mad_468']:5.2f}", flush=True)
    json.dump(res, open(salida, 'w'), indent=1)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
