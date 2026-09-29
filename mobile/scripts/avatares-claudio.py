"""Prepara las fotos de Claudio para la app (assets/avatares/claudio y claudio-pie).

Entrada: las ilustraciones de José ya sin fondo (PNG con transparencia; el recorte se hizo con
rembg + BiRefNet-general). Salida: WebP con transparencia, lo que carga ClaudioRetrato y ClaudioDePie.

    python3 scripts/avatares-claudio.py <carpeta con los PNG recortados>

Qué hace, además de convertir:
  · La boca que habla. La foto de boca abierta que vino tiene OTRA pose (la cabeza más de frente):
    alternarla con la cerrada hace saltar la cabeza en vez de hablar. Así que los cuadros de habla
    se sacan de la misma foto de siempre: la barbilla se baja con una deformación suave y el hueco se
    pinta como interior de la boca (retrato, boca cerrada) o se estira la boca que ya está abierta
    (cuerpo entero). Tres aperturas por avatar; la app elige una según el nivel de la voz.
  · Cuerpo entero: se recorta al contorno con margen, en un lienzo vertical fijo.
  · La foto de boca abierta original se queda para cantar (ahí el cambio de pose no molesta).

Las coordenadas de la boca (LABIO_RETRATO, BOCA_CUERPO) se midieron a ojo sobre las fotos de salida
(768 px el retrato, 720×1080 el cuerpo). Si cambian las fotos, hay que volver a medirlas.

Nombres de entrada (los de las imágenes del chat del 29-sep):
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

try:
    import cv2
except ImportError:  # pragma: no cover
    sys.exit('Hace falta opencv-python (cv2).')

RETRATO = {
    'base': '746928f4',      # tres cuartos a la derecha, boca cerrada (la cara de siempre)
    'canta': 'c9a347fc',     # boca muy abierta, otra pose: solo para cantar
    'risa': 'ee0cca9b',
    'sorpresa': '4643a451',
    'pensando': 'fee7ed2f',
    'sueno': 'c01e92ae',
    'mira': '7cf2d75b',      # tres cuartos a la izquierda
    'aparta': '1b30769f',    # de perfil, mirando lejos
    'perfil': '4bf0795c',    # perfil derecho
}
CUERPO = '09c80c30'
# Línea de los labios del retrato (x, y) y la apertura de cada cuadro de habla, en px de 768.
LABIO_RETRATO = [(397, 389), (434, 399), (484, 401), (514, 399), (530, 396)]
HABLA_RETRATO = {'habla1': 7, 'habla2': 13, 'habla3': 20}
# Boca del cuerpo (ya abierta): línea media del interior, centro, medio ancho; y cada cuadro.
BOCA_CUERPO = {'y0': 308, 'cx': 346, 'medio': 30, 'alcance': 60}
HABLA_CUERPO = {'cierra': -7, 'habla1': 4, 'habla2': 8}
LADO_RETRATO = 768
CUERPO_W, CUERPO_H = 720, 1080


def abrir(carpeta: Path, clave: str) -> Image.Image:
    for p in carpeta.glob(f'{clave}*.png'):
        return Image.open(p).convert('RGBA')
    sys.exit(f'falta la imagen {clave}*.png en {carpeta}')


def suave(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def abrir_boca_cerrada(img: Image.Image, labio, h: float, cx=478, medio=46, alcance=78) -> Image.Image:
    """Retrato: baja la barbilla `h` px bajo la línea del labio y pinta el hueco como boca."""
    src = np.array(img).astype(np.float32)
    H, W = src.shape[:2]
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    pts = np.array(labio, np.float32)
    L = np.interp(xs, pts[:, 0], pts[:, 1])
    t = np.clip((xs - cx) / medio, -1, 1)
    w = np.where(np.abs(xs - cx) < medio, 0.5 * (1 + np.cos(np.pi * t)), 0)
    abre = h * w
    d = ys - L
    f = np.clip(1 - (d - abre) / alcance, 0, 1)
    mapy = np.where(d > 0, ys - abre * np.where(d < abre, 1, f), ys)
    out = cv2.remap(src, xs, mapy.astype(np.float32), cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    hueco = (d > 0) & (d < abre) & (w > 0)
    rel = np.where(abre > 0, d / np.maximum(abre, 1e-3), 0)[..., None]
    arriba, medio_c, lengua = (np.array(c, np.float32) for c in ([46, 16, 20], [70, 22, 28], [196, 104, 112]))
    color = np.where(rel < 0.55, arriba + (medio_c - arriba) * (rel / 0.55), medio_c + (lengua - medio_c) * np.clip((rel - 0.55) / 0.45, 0, 1))
    m = cv2.GaussianBlur(hueco.astype(np.float32), (0, 0), 1.1)
    out[..., :3] = out[..., :3] * (1 - m[..., None]) + color * m[..., None]
    out[..., 3] = np.maximum(out[..., 3], m * 255)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def mover_quijada(img: Image.Image, y0, cx, medio, h, alcance) -> Image.Image:
    """Cuerpo: estira (h > 0) o junta (h < 0) la boca ya abierta, sin costura: el estiramiento
    ocurre dentro de la boca (banda ±a) y se apaga suave hacia la barbilla."""
    src = np.array(img).astype(np.float32)
    H, W = src.shape[:2]
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    ancho = medio * 1.6
    w = np.where(np.abs(xs - cx) < ancho, 0.5 * (1 + np.cos(np.pi * np.clip((xs - cx) / ancho, -1, 1))), 0)
    d = ys - y0
    a = 8.0
    peso = np.where(d < a, suave((d + a) / (2 * a)), suave(1 - (d - a) / (alcance - a)))
    mapy = ys - h * w * peso
    out = cv2.remap(src, xs, mapy.astype(np.float32), cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))




def guardar(img: Image.Image, ruta: Path):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    img.save(ruta, 'WEBP', quality=88, method=6)
    print(f'  {ruta} · {ruta.stat().st_size // 1024} KB')


def retrato(carpeta: Path, salida: Path):
    fotos = {k: abrir(carpeta, v).resize((LADO_RETRATO, LADO_RETRATO), Image.LANCZOS) for k, v in RETRATO.items()}
    for nombre, h in HABLA_RETRATO.items():
        fotos[nombre] = abrir_boca_cerrada(fotos['base'], LABIO_RETRATO, h)
    for k, img in fotos.items():
        guardar(img, salida / 'claudio' / f'{k}.webp')




def cuerpo(carpeta: Path, salida: Path):
    base = abrir(carpeta, CUERPO)
    x0, y0, x1, y1 = base.split()[3].getbbox()
    margen = 24
    recorte = base.crop((max(0, x0 - margen), max(0, y0 - margen), min(base.width, x1 + margen), min(base.height, y1 + margen)))
    escala = min(CUERPO_W / recorte.width, CUERPO_H / recorte.height)
    rec = recorte.resize((int(recorte.width * escala), int(recorte.height * escala)), Image.LANCZOS)
    lienzo = Image.new('RGBA', (CUERPO_W, CUERPO_H), (0, 0, 0, 0))
    lienzo.alpha_composite(rec, ((CUERPO_W - rec.width) // 2, CUERPO_H - rec.height))
    guardar(lienzo, salida / 'claudio-pie' / 'base.webp')
    b = BOCA_CUERPO
    for nombre, h in HABLA_CUERPO.items():
        guardar(mover_quijada(lienzo, b['y0'], b['cx'], b['medio'], h, b['alcance']), salida / 'claudio-pie' / f'{nombre}.webp')
    return lienzo


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    carpeta = Path(sys.argv[1])
    salida = Path(__file__).resolve().parent.parent / 'assets' / 'avatares'
    print('Retrato:')
    retrato(carpeta, salida)
    print('Cuerpo entero:')
    cuerpo(carpeta, salida)


if __name__ == '__main__':
    main()
