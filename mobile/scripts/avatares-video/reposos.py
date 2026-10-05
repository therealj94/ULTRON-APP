"""Dónde está cada clip en la pose de reposo (la foto base): el tramo del principio [0, hasta] y el del final
[desde, n-1]. Ahí, y solo ahí, se puede pasar a otro clip sin que la pose salte. Escribe la tabla en TS.

uso: reposos.py mobile/assets/avatares/video mobile/src/avatares/video/reposos.ts 2.5
"""
import sys, os, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from medir import cuadros, gris, mad, CLIPS

carpeta, salida = sys.argv[1], sys.argv[2]
U = float(sys.argv[3]) if len(sys.argv) > 3 else 2.5
tabla = {}
for av in ['claudio', 'antonio']:
    tabla[av] = {}
    for c in CLIPS:
        g = [gris(x) for x in cuadros(os.path.join(carpeta, f'{av}-{c}.mp4'))]
        d = [mad(x, g[0]) for x in g]
        n = len(g)
        hasta = 0
        while hasta + 1 < n and d[hasta + 1] <= U:
            hasta += 1
        desde = n - 1
        while desde - 1 > hasta and d[desde - 1] <= U:
            desde -= 1
        tabla[av][c] = [n, hasta, desde]
        print(f'{av:8s} {c:9s} n {n}  reposo al principio hasta {hasta:3d} ({(hasta + 1) / 24:4.2f} s)  al final desde {desde:3d} ({desde / 24:4.2f} s)  pose máx {max(d):5.2f}')
with open(salida, 'w') as f:
    f.write('/**\n * GENERADO por mobile/scripts/avatares-video/reposos.py (docs/avatares-video.md): no editar a mano.\n')
    f.write(' * Para cada clip: [cuadros, último cuadro del reposo del principio, primer cuadro del reposo del final],\n')
    f.write(f' * a 24 cuadros por segundo. «En reposo» = a no más de {U} (diferencia media, 0-255) de su cuadro 0, la foto base.\n */\n')
    f.write("import type { ClipVideo } from './guion';\n\n")
    f.write('export const FPS_VIDEO = 24;\n\n')
    f.write("export const REPOSOS: Record<'claudio' | 'antonio', Record<ClipVideo, readonly [number, number, number]>> = {\n")
    for av in tabla:
        f.write(f'  {av}: {{\n')
        for c, v in tabla[av].items():
            f.write(f'    {c}: [{v[0]}, {v[1]}, {v[2]}],\n')
        f.write('  },\n')
    f.write('};\n')
