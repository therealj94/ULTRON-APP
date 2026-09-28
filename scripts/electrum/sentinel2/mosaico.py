"""
Segundo paso de composicion.py: junta las teselas MGRS en un solo raster de Honduras (Web
Mercator, 40 m), decide las clases con percentiles NACIONALES del suelo expuesto, les da color y
escribe un PMTiles por capa, más `resumen.json` con los cortes en unidades reales (para la leyenda
y las notas) y `clases.tif` (arcillas, hierro y pérdida de vegetación: 0 sin dato, 1 medido sin anomalía,
2–4 clases) para medir cada concesión después.
"""
import glob, json, os, subprocess

import cv2
import numpy as np

from composicion import RANGO

# Cortes por percentil del suelo expuesto: anomalía moderada, alta y muy alta.
PERCENTILES = (90.0, 97.0, 99.5)
COLORES = {
    # Arcillas: amarillo → naranja → magenta (se distingue del rojo del hierro).
    'arc': [(250, 220, 90), (245, 140, 40), (220, 40, 180)],
    # Óxidos de hierro: salmón → rojo → granate.
    'fe': [(250, 160, 120), (225, 60, 40), (140, 10, 20)],
    # Pérdida de vegetación: naranja (moderada) → rojo (fuerte).
    'veg': [(255, 170, 60), (235, 50, 40), (160, 0, 60)],
}
ALFA = (170, 210, 245)
# Caída de vegetación: donde en 2025 había vegetación densa (NDVI > 0,5) y el NDVI bajó. Con una caída
# de 0,15 (primera prueba) salían 4 900 km²: sequía, quemas y cosechas, no desmonte. Desde 0,25 queda lo fuerte.
NDVI_DENSO = 0.5
CAIDAS = (0.25, 0.35, 0.50)
PMTILES = os.path.expanduser('~/go/bin/go-pmtiles')


def q2v(q, rango):
    lo, hi = rango
    return np.float32(lo) + (np.asarray(q, np.float32) - 1) / np.float32(254) * np.float32(hi - lo)


def v2q(v, rango):
    lo, hi = rango
    return int(np.clip(round((v - lo) / (hi - lo) * 254) + 1, 1, 255))


def banda(tif, b, trabajo):
    raw = os.path.join(trabajo, f'_b{b}.tif')
    subprocess.run(['gdal_translate', '-q', '-b', str(b), '-co', 'COMPRESS=NONE', tif, raw], check=True)
    a = cv2.imread(raw, cv2.IMREAD_UNCHANGED)
    os.remove(raw)
    return a


def georref(src, dst_png_tif, trabajo, bandas):
    """Copia la georreferencia de `src` a un raster recién escrito con cv2."""
    info = json.loads(subprocess.run(['gdalinfo', '-json', src], capture_output=True, text=True, check=True).stdout)
    gt = info['geoTransform']
    w, h = info['size']
    return ['-a_srs', 'EPSG:3857', '-a_ullr', str(gt[0]), str(gt[3]), str(gt[0] + gt[1] * w), str(gt[3] + gt[5] * h)]


def pmtiles(rgba_tif, nombre, trabajo):
    mb = os.path.join(trabajo, f'{nombre}.mbtiles')
    for f in (mb,):
        if os.path.exists(f):
            os.remove(f)
    subprocess.run(['gdal_translate', '-q', '-of', 'MBTILES', '-co', 'TILE_FORMAT=PNG', '-co', 'ZOOM_LEVEL_STRATEGY=UPPER', rgba_tif, mb], check=True)
    subprocess.run(['gdaladdo', '-q', '-r', 'average', mb, '2', '4', '8', '16', '32', '64'], check=True)
    pm = os.path.join(trabajo, f'{nombre}.pmtiles')
    if os.path.exists(pm):
        os.remove(pm)
    subprocess.run([PMTILES, 'convert', mb, pm], check=True, capture_output=True)
    os.remove(mb)
    return pm


def mosaico(trabajo):
    teselas = sorted(glob.glob(os.path.join(trabajo, 'teselas', '*.tif')))
    mos = os.path.join(trabajo, 'mosaico.tif')
    if not os.path.exists(mos):
        # Teselas en tres zonas UTM (15, 16, 17): gdalwarp las lleva a Web Mercator de una vez.
        subprocess.run(['gdalwarp', '-q', '-t_srs', 'EPSG:3857', '-tr', '40', '40', '-r', 'near', '-srcnodata', '0', '-dstnodata', '0',
                        # Tierra firme e Islas de la Bahía: las Islas del Cisne (17,4° N) estirarían el raster 90 km de mar.
                        '-cutline', os.path.join(trabajo, 'hn.geojson'), '-te', '-89.4', '12.9', '-83.1', '16.6', '-te_srs', 'EPSG:4326',
                        '-wo', 'NUM_THREADS=4', '-multi',
                        '-co', 'COMPRESS=DEFLATE', '-co', 'TILED=YES', '-co', 'BIGTIFF=YES', *teselas, mos], check=True)
    arc, fe, n25, n26 = (banda(mos, b, trabajo) for b in (1, 2, 3, 4))
    resumen = {'pixel_m': 40, 'teselas': len(teselas)}
    # En Web Mercator un píxel de 40 m mide 40·cos(lat) en el terreno: km² por píxel, fila por fila.
    gt = json.loads(subprocess.run(['gdalinfo', '-json', mos], capture_output=True, text=True, check=True).stdout)['geoTransform']
    y = gt[3] + gt[5] * (np.arange(arc.shape[0]) + 0.5)
    lat = np.degrees(2 * np.arctan(np.exp(y / 6378137.0)) - np.pi / 2)
    km2_fila = ((40 * np.cos(np.radians(lat))) ** 2 / 1e6).astype(np.float64)

    def km2(m):
        return round(float((m.sum(axis=1) * km2_fila).sum()), 1)

    tierra = (n25 > 0) | (n26 > 0) | (arc > 0)
    resumen['tierra_km2'] = km2(tierra)
    resumen['expuesto_km2'] = km2(arc > 0)

    clases = np.zeros(arc.shape + (3,), np.uint8)
    for i, (k, q) in enumerate((('arc', arc), ('fe', fe))):
        vals = q[q > 0]
        cortes_q = [int(np.percentile(vals, p)) for p in PERCENTILES]
        resumen[k] = {'cortes': [round(float(q2v(c, RANGO[k])), 3) for c in cortes_q], 'percentiles': PERCENTILES}
        # 0 = sin dato o bajo vegetación; 1 = suelo expuesto sin anomalía; 2–4 = anomalía moderada, alta, muy alta.
        c = (q > 0).astype(np.uint8)
        for j, cq in enumerate(cortes_q, 2):
            c[q >= cq] = j
        clases[..., i] = c

    v25, v26 = q2v(n25, RANGO['ndvi']), q2v(n26, RANGO['ndvi'])
    ambos = (n25 > 0) & (n26 > 0)
    caida = np.where(ambos & (v25 > NDVI_DENSO), v25 - v26, 0)
    # 0 = no comparable (nubes o agua en un año); 1 = comparable sin pérdida; 2–4 = pérdida moderada, fuerte, muy fuerte.
    c = ambos.astype(np.uint8)
    for j, d in enumerate(CAIDAS, 2):
        c[caida >= d] = j
    clases[..., 2] = c
    resumen['veg'] = {'caidas_ndvi': CAIDAS, 'ndvi_denso_2025': NDVI_DENSO,
                      'km2': [km2(c == j) for j in (2, 3, 4)],
                      'comparable_km2': km2(ambos)}
    del v25, v26, caida, n25, n26

    ref = georref(mos, None, trabajo, 3)
    crudo = os.path.join(trabajo, '_clases.tif')
    cv2.imwrite(crudo, clases[..., ::-1])  # cv2 escribe BGR: se da vuelta para que la banda 1 sea arcillas
    salida_clases = os.path.join(trabajo, 'clases.tif')
    subprocess.run(['gdal_translate', '-q', *ref, '-co', 'COMPRESS=DEFLATE', '-co', 'TILED=YES', crudo, salida_clases], check=True)
    os.remove(crudo)

    salidas = {}
    for i, k in enumerate(('arc', 'fe', 'veg')):
        lut = np.zeros((5, 4), np.uint8)  # 0 y 1 transparentes: solo se pintan las anomalías
        for j in (2, 3, 4):
            lut[j] = (*COLORES[k][j - 2], ALFA[j - 2])
        rgba = lut[clases[..., i]]
        crudo = os.path.join(trabajo, f'_{k}.tif')
        cv2.imwrite(crudo, rgba[..., [2, 1, 0, 3]])  # BGRA para cv2
        del rgba
        geo = os.path.join(trabajo, f'_{k}_geo.tif')
        subprocess.run(['gdal_translate', '-q', *ref, '-colorinterp', 'red,green,blue,alpha', '-co', 'COMPRESS=DEFLATE', '-co', 'TILED=YES', crudo, geo], check=True)
        os.remove(crudo)
        salidas[k] = pmtiles(geo, f's2-{k}', trabajo)
        os.remove(geo)
        print(k, salidas[k], f'{os.path.getsize(salidas[k]) / 1e6:.1f} MB', flush=True)

    json.dump(resumen, open(os.path.join(trabajo, 'resumen.json'), 'w'), indent=1)
    print(json.dumps(resumen, indent=1))
    return salidas
