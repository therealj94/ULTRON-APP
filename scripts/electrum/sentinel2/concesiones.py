#!/usr/bin/env python3
"""
Tercer paso: mide cada concesión sobre `clases.tif` (de mosaico.py) y escribe el JSON que carga
POST /api/electrum/satelite/cargar (server/electrum/satelite.ts).

Uso:
    python3 concesiones.py --trabajo DIR --catastro catastro.json
        (catastro.json = lo que devuelve GET /api/electrum/catastro.geojson)

Por concesión, en hectáreas de terreno (el píxel de Web Mercator se corrige por cos(lat)):
  ha               superficie que cayó dentro del raster
  ha_comparable    comparable entre los dos años (sin nubes ni agua en ninguno)
  veg              pérdida de vegetación densa [moderada, fuerte, muy fuerte]
  ha_expuesto      suelo expuesto (NDVI < 0,30)
  arc, fe          anomalía de arcillas / de óxidos de hierro [moderada, alta, muy alta]
Una concesión más chica que un píxel se mide igual: su píxel central.
"""
import argparse, json, math, os, subprocess

import cv2
import numpy as np

R = 6378137.0


def merc(lon, lat):
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def anillos(geom):
    if geom['type'] == 'Polygon':
        return [geom['coordinates']]
    if geom['type'] == 'MultiPolygon':
        return geom['coordinates']
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--trabajo', required=True)
    ap.add_argument('--catastro', required=True)
    a = ap.parse_args()
    clases = os.path.join(a.trabajo, 'clases.tif')
    info = json.loads(subprocess.run(['gdalinfo', '-json', clases], capture_output=True, text=True, check=True).stdout)
    gt = info['geoTransform']
    W, H = info['size']
    bandas = []
    for b in (1, 2, 3):
        raw = os.path.join(a.trabajo, f'_c{b}.tif')
        subprocess.run(['gdal_translate', '-q', '-b', str(b), '-co', 'COMPRESS=NONE', clases, raw], check=True)
        bandas.append(cv2.imread(raw, cv2.IMREAD_UNCHANGED))
        os.remove(raw)
    arc, fe, veg = bandas

    j = json.load(open(a.catastro))
    fc = j.get('geojson', j)
    salida, fuera = [], 0
    for f in fc['features']:
        pid = f['properties'].get('id')
        polis = anillos(f['geometry'] or {})
        if not pid or not polis:
            continue
        # A píxeles del raster (el centro del píxel j está en j + 0,5).
        px = [[np.array([((merc(x, y)[0] - gt[0]) / gt[1], (merc(x, y)[1] - gt[3]) / gt[5]) for x, y in anillo]) for anillo in poli] for poli in polis]
        todos = np.vstack([r for p in px for r in p])
        x0, y0 = np.floor(todos.min(0)).astype(int) - 1
        x1, y1 = np.ceil(todos.max(0)).astype(int) + 2
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, W), min(y1, H)
        if x1 <= x0 or y1 <= y0:
            fuera += 1
            continue
        m = np.zeros((y1 - y0, x1 - x0), np.uint8)
        for p in px:
            cv2.fillPoly(m, [np.round((p[0] - [x0 + 0.5, y0 + 0.5]) * 16).astype(np.int32)], 1, shift=4)
            for hueco in p[1:]:
                cv2.fillPoly(m, [np.round((hueco - [x0 + 0.5, y0 + 0.5]) * 16).astype(np.int32)], 0, shift=4)
        if not m.any():
            cx, cy = todos.mean(0)
            cx, cy = int(cx) - x0, int(cy) - y0
            if 0 <= cy < m.shape[0] and 0 <= cx < m.shape[1]:
                m[cy, cx] = 1
        sel = m.astype(bool)
        # Hectáreas de terreno por píxel en esta latitud.
        lat = math.degrees(2 * math.atan(math.exp((gt[3] + gt[5] * (y0 + y1) / 2) / R)) - math.pi / 2)
        ha_px = (abs(gt[1]) * math.cos(math.radians(lat))) ** 2 / 1e4
        va, vf, vv = arc[y0:y1, x0:x1][sel], fe[y0:y1, x0:x1][sel], veg[y0:y1, x0:x1][sel]
        hay_dato = (va > 0) | (vf > 0) | (vv > 0)
        if not hay_dato.any():
            fuera += 1
            continue
        r = lambda v: round(float(v) * ha_px, 1)
        salida.append({'id': int(pid), 'datos': {
            'ha': r(sel.sum()),
            'ha_comparable': r((vv > 0).sum()),
            'veg': [r((vv == k).sum()) for k in (2, 3, 4)],
            'ha_expuesto': r((va > 0).sum()),
            'arc': [r((va == k).sum()) for k in (2, 3, 4)],
            'fe': [r((vf == k).sum()) for k in (2, 3, 4)],
        }})
    destino = os.path.join(a.trabajo, 'satelite-concesiones.json')
    json.dump(salida, open(destino, 'w'))
    print(f'{len(salida)} concesiones medidas; {fuera} sin dato o fuera del raster → {destino}')


if __name__ == '__main__':
    main()
