#!/usr/bin/env python3
"""
La marca de AU-RA dibujada en limpio: el símbolo (planeta crema, anillo dorado y punto terracota) y
el logo para fondo oscuro, que es el de la paleta Grafito elegida (25-sep).

El logo se eligió como imagen sobre crema. Los íconos necesitan el símbolo solo, y recortarlo del
JPG dejaba bordes sucios: aquí se calcula con máscaras analíticas (numpy) a 3x y se reduce. Para el
logo oscuro, las letras se sacan del logo claro (tinta sobre fondo liso: el alfa sale exacto) y se
pintan en claro; el símbolo es el de aquí.

    python3 scripts/marca-aura.py
      mobile/assets: icon.png, adaptive-icon.png, splash-icon.png, marca/logo-aura.png
      public:        icon.png, icon-192.png, apple-touch-icon.png, favicon.png, marca/logo-aura-oscuro.png
"""
import math
import os

import numpy as np
from PIL import Image

MOVIL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(MOVIL, 'assets')
PUBLICO = os.path.join(os.path.dirname(MOVIL), 'public')
CREMA = np.array([254, 249, 243], float)
GRAFITO = np.array([44, 46, 50], float)
ORO = np.array([214, 181, 108], float)
TEXTO = np.array([236, 232, 226], float)
SUBTEXTO = np.array([185, 178, 168], float)
BARRO = np.array([217, 130, 95], float)
CLARO = np.array([252, 236, 207], float)
ARENA = np.array([242, 212, 160], float)


def simbolo(S: int, linea=GRAFITO) -> Image.Image:
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
    # una línea del color del fondo separa el arco del planeta, como en el logo
    m = borde & planeta
    rgb[m] = linea
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


def logo_oscuro() -> Image.Image:
    """El logo sobre transparente para fondo grafito: símbolo de aquí y letras claras del logo original."""
    claro = np.asarray(Image.open(os.path.join(PUBLICO, 'marca', 'logo-aura.png')).convert('RGB')).astype(float)
    h, w, _ = claro.shape
    fondo = claro[2, 2]
    rgb = np.zeros((h, w, 3))
    a = np.zeros((h, w))
    # Las letras: cada píxel es fondo + alfa·(tinta − fondo). «AU-RA» va arriba, «by Orden Global» abajo.
    for (y0, y1), tinta, nueva in (((0, 232), np.array([55, 46, 39.0]), TEXTO), ((232, h), np.array([143, 144, 113.0]), SUBTEXTO)):
        zona = claro[y0:y1, 300:]
        d = tinta - fondo
        alfa = np.clip(((zona - fondo) * d).sum(2) / (d * d).sum(), 0, 1)
        rgb[y0:y1, 300:] = nueva
        a[y0:y1, 300:] = alfa
    img = Image.fromarray(np.dstack([rgb, a * 255]).astype('uint8'), 'RGBA')
    # El símbolo del original ocupa x 19..280, y 66..241; el dibujado mide 0,87 de su lienzo a lo ancho.
    capa = Image.new('RGBA', img.size, (0, 0, 0, 0))
    capa.paste(simbolo(300), (150 - 150 - 1, 154 - 150 - 1))
    return Image.alpha_composite(capa, img)


if __name__ == '__main__':
    sobre(GRAFITO, 1024, 0.86).convert('RGB').save(os.path.join(ASSETS, 'icon.png'), optimize=True)
    # el ícono adaptable de Android recorta a un círculo: el símbolo va dentro de la zona segura (66 %)
    sobre(None, 1024, 0.62).save(os.path.join(ASSETS, 'adaptive-icon.png'), optimize=True)
    sobre(None, 512, 0.9).save(os.path.join(ASSETS, 'splash-icon.png'), optimize=True)
    logo = logo_oscuro()
    os.makedirs(os.path.join(ASSETS, 'marca'), exist_ok=True)
    logo.save(os.path.join(ASSETS, 'marca', 'logo-aura.png'), optimize=True)
    logo.save(os.path.join(PUBLICO, 'marca', 'logo-aura-oscuro.png'), optimize=True)
    for nombre, tam in (('icon.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180), ('favicon.png', 64)):
        sobre(GRAFITO, tam, 0.86).convert('RGB').save(os.path.join(PUBLICO, nombre), optimize=True)
    for ruta in ('mobile/assets/icon.png', 'mobile/assets/adaptive-icon.png', 'mobile/assets/splash-icon.png',
                 'mobile/assets/marca/logo-aura.png', 'public/marca/logo-aura-oscuro.png', 'public/icon.png', 'public/favicon.png'):
        im = Image.open(os.path.join(os.path.dirname(MOVIL), ruta))
        print(f'{ruta:36} {im.size[0]}x{im.size[1]} {im.mode}')
