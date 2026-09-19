#!/usr/bin/env python3
"""
Genera los assets gráficos de ULTRON FP a partir del logo rasterizado (los anillos cian):

  assets/icon.png          1024×1024  logo sobre negro (icono clásico / iOS)
  assets/adaptive-icon.png 1024×1024  capa foreground transparente, logo dentro de la zona segura (66 %)
  assets/splash-icon.png    512×512   logo transparente para el splash nativo (expo-splash-screen)
  assets/splash.png        1284×2778  arte completo: logo + «ULTRON FP» + «powered by ORDEN GLOBAL»

El logo se extrae de assets/logo-source.png (o del icon.png anterior) quitando el fondo negro:
alpha = luminancia (un brillo aditivo sobre negro se ve idéntico compuesto sobre negro).

  python3 scripts/make-assets.py
"""
from __future__ import annotations

import os
import sys

import numpy as _np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
CYAN = (5, 225, 255)
BLACK = (0, 0, 0)
FONT_BOLD = next(
    (p for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"] if os.path.exists(p)),
    None,
)


def font(size: int) -> ImageFont.ImageFont:
    return ImageFont.truetype(FONT_BOLD, size) if FONT_BOLD else ImageFont.load_default()


def extract_logo(src_path: str) -> Image.Image:
    """Recorta los anillos y convierte el negro de fondo en transparencia."""
    im = Image.open(src_path).convert("RGB")
    w, h = im.size
    # alfa por canal máximo (brillo); el fondo (#000/#050a0e) queda ≈ 0
    arr = _np.asarray(im).astype("float32")
    alpha = arr.max(axis=2)
    alpha = _np.clip((alpha - 14) / (255 - 14), 0, 1)  # quita el gris del fondo
    alpha = alpha ** 0.85
    rgb = arr / _np.maximum(alpha[..., None] * 255, 1) * 255  # des-premultiplica
    rgb = _np.clip(rgb, 0, 255)
    out = _np.dstack([rgb, alpha * 255]).astype("uint8")
    logo = Image.fromarray(out, "RGBA")
    # recorta al contenido con margen
    bbox = logo.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if not bbox:
        raise SystemExit("no encontré el logo en " + src_path)
    x0, y0, x1, y1 = bbox
    pad = int(max(x1 - x0, y1 - y0) * 0.12)
    box = (max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad))
    logo = logo.crop(box)
    # cuadra el lienzo
    s = max(logo.size)
    sq = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sq.paste(logo, ((s - logo.width) // 2, (s - logo.height) // 2))
    return sq


def fit(logo: Image.Image, size: int) -> Image.Image:
    return logo.resize((size, size), Image.LANCZOS)


def glow(canvas: Image.Image, layer: Image.Image, pos: tuple[int, int], radius: int, strength: float = 0.55) -> None:
    """Halo cian suave detrás del logo."""
    g = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    g.paste(layer, pos, layer)
    g = g.filter(ImageFilter.GaussianBlur(radius))
    a = g.getchannel("A").point(lambda v: int(v * strength))
    g.putalpha(a)
    canvas.alpha_composite(g)


def make_icon(logo: Image.Image) -> None:
    c = Image.new("RGBA", (1024, 1024), BLACK + (255,))
    l = fit(logo, 700)
    pos = ((1024 - 700) // 2, (1024 - 700) // 2)
    glow(c, l, pos, 40)
    c.alpha_composite(l, pos)
    c.convert("RGB").save(os.path.join(ASSETS, "icon.png"), optimize=True)


def make_adaptive(logo: Image.Image) -> None:
    # zona segura: círculo de 66 % del lienzo (≈ 676 px de 1024); el logo va al 60 %
    c = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    size = 600
    l = fit(logo, size)
    pos = ((1024 - size) // 2, (1024 - size) // 2)
    glow(c, l, pos, 36)
    c.alpha_composite(l, pos)
    c.save(os.path.join(ASSETS, "adaptive-icon.png"), optimize=True)


def make_splash_icon(logo: Image.Image) -> None:
    c = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    l = fit(logo, 440)
    pos = ((512 - 440) // 2, (512 - 440) // 2)
    glow(c, l, pos, 28)
    c.alpha_composite(l, pos)
    c.save(os.path.join(ASSETS, "splash-icon.png"), optimize=True)


def text_spaced(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, fnt: ImageFont.ImageFont, fill, spacing: int) -> int:
    """Texto con letter-spacing, centrado horizontalmente en xy[0]. Devuelve el ancho."""
    widths = [draw.textlength(ch, font=fnt) for ch in text]
    total = sum(widths) + spacing * (len(text) - 1)
    x = xy[0] - total / 2
    for ch, w in zip(text, widths):
        draw.text((x, xy[1]), ch, font=fnt, fill=fill)
        x += w + spacing
    return int(total)


def make_splash(logo: Image.Image) -> None:
    W, H = 1284, 2778
    c = Image.new("RGBA", (W, H), BLACK + (255,))
    size = 520
    l = fit(logo, size)
    pos = ((W - size) // 2, int(H * 0.36) - size // 2)
    glow(c, l, pos, 70, 0.7)
    c.alpha_composite(l, pos)
    d = ImageDraw.Draw(c)
    y = pos[1] + size + 90
    text_spaced(d, (W // 2, y), "ULTRON FP", font(96), (232, 251, 255, 255), 26)
    text_spaced(d, (W // 2, y + 150), "POWERED BY ORDEN GLOBAL", font(34), CYAN + (153,), 10)
    # línea fina cian bajo la marca
    d.rounded_rectangle((W // 2 - 120, y + 125, W // 2 + 120, y + 129), 2, fill=CYAN + (110,))
    c.convert("RGB").save(os.path.join(ASSETS, "splash.png"), optimize=True)


def main() -> None:
    src = next((p for p in [os.path.join(ASSETS, "logo-source.png"), os.path.join(ASSETS, "icon.png")] if os.path.exists(p)), None)
    if not src:
        sys.exit("falta assets/logo-source.png o assets/icon.png")
    logo = extract_logo(src)
    # guarda la fuente extraída para futuras regeneraciones sin degradar
    keep = os.path.join(ASSETS, "logo-source.png")
    if not os.path.exists(keep):
        logo.save(keep, optimize=True)
    make_icon(logo)
    make_adaptive(logo)
    make_splash_icon(logo)
    make_splash(logo)
    for f in ("icon.png", "adaptive-icon.png", "splash-icon.png", "splash.png", "logo-source.png"):
        p = os.path.join(ASSETS, f)
        im = Image.open(p)
        print(f"{f:20s} {im.size[0]}x{im.size[1]} {im.mode} {os.path.getsize(p) // 1024} KB")


if __name__ == "__main__":
    main()
