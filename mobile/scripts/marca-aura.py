#!/usr/bin/env python3
"""
El símbolo de AU-RA dibujado en limpio: planeta crema, anillo dorado y punto terracota, con fondo
transparente y a cualquier tamaño.

El logo se eligió como imagen, pero los íconos del teléfono necesitan el símbolo solo y sin fondo,
y recortarlo del JPG dejaba bordes sucios. Aquí se calcula con máscaras analíticas (numpy) a 3x y
se reduce, así que sale nítido.

    python3 scripts/marca-aura.py        # escribe assets/icon.png, adaptive-icon.png y splash-icon.png
"""
import math
import os

import numpy as np
from PIL import Image

ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets')
CREMA = np.array([254, 249, 243], float)
ORO = np.array([226, 168, 62], float)
BARRO = np.array([217, 130, 95], float)
CLARO = np.array([252, 236, 207], float)
ARENA = np.array([242, 212, 160], float)


def simbolo(S: int) -> Image.Image:
    k = 3
    W = S * k
    y, x = np.mgrid[0:W, 0:W].astype(float) + 0.5
    cx, cy, r = W * 0.5, W * 0.5, W * 0.29

    planeta = (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    t = np.clip(((x - cx) + (y - cy)) / (2 * r) + 0.5, 0, 1)[..., None]
    color_planeta = CLARO + (ARENA - CLARO) * t

    # como en el logo, solo se ve el arco de delante: una media luna entre dos elipses iguales,
    # la de dentro subida, que es gruesa abajo y se afina hasta nada en las puntas
    ang = math.radians(-17)
    u = (x - cx) * math.cos(ang) + (y - cy) * math.sin(ang)
    v = -(x - cx) * math.sin(ang) + (y - cy) * math.cos(ang)
    rx, ry, grosor, hueco = r * 1.5, r * 0.5, r * 0.2, r * 0.07

    def elipse(dy, crece=0.0):
        return (u / (rx + crece)) ** 2 + ((v - dy) / (ry + crece)) ** 2 <= 1

    arco = elipse(0) & ~elipse(-grosor)
    borde = elipse(0, hueco) & ~elipse(-grosor, -hueco)

    rgb = np.zeros((W, W, 3))
    a = np.zeros((W, W))
    rgb[planeta], a[planeta] = color_planeta[planeta], 1
    # una línea crema separa el arco del planeta, como en el logo
    m = borde & planeta
    rgb[m] = CREMA
    rgb[arco], a[arco] = ORO, 1
    # el punto terracota
    px, py, pr = cx + r * 0.98, cy + r * 0.98, r * 0.13
    m = (x - px) ** 2 + (y - py) ** 2 <= pr * pr
    rgb[m], a[m] = BARRO, 1

    img = Image.fromarray(np.dstack([rgb, a * 255]).astype('uint8'), 'RGBA')
    return img.resize((S, S), Image.LANCZOS)


def sobre(fondo, S: int, zona: float) -> Image.Image:
    base = Image.new('RGBA', (S, S), tuple(int(c) for c in fondo) + (255,) if fondo is not None else (0, 0, 0, 0))
    s = simbolo(int(S * zona))
    base.alpha_composite(s, ((S - s.width) // 2, (S - s.height) // 2))
    return base


if __name__ == '__main__':
    sobre(CREMA, 1024, 0.86).convert('RGB').save(os.path.join(ASSETS, 'icon.png'), optimize=True)
    # el ícono adaptable de Android recorta a un círculo: el símbolo va dentro de la zona segura (66 %)
    sobre(None, 1024, 0.62).save(os.path.join(ASSETS, 'adaptive-icon.png'), optimize=True)
    sobre(None, 512, 0.9).save(os.path.join(ASSETS, 'splash-icon.png'), optimize=True)
    for n in ('icon.png', 'adaptive-icon.png', 'splash-icon.png'):
        im = Image.open(os.path.join(ASSETS, n))
        print(f'{n:18} {im.size[0]}x{im.size[1]} {im.mode}')
