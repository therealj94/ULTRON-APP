#!/usr/bin/env python3
"""
Sentinel-2 para Dr Electrum: alteración hidrotermal y cambios de vegetación en Honduras.

Composición de temporada seca (enero–mayo, la de menos nubes) con las imágenes Sentinel-2 L2A de
Copernicus que AWS publica abiertas (catálogo STAC de Element 84, Earth Search). Nada se paga: se
leen solo las sobrevistas de 40 m de cada banda, por HTTP, sin bajar las escenas enteras.

Tres capas, cada una un PMTiles raster para el mapa (van al cubo, en biblioteca/teselas/):

  · Arcillas (Al-OH / Mg-OH): cociente SWIR B11/B12. Sube con caolinita, sericita, illita,
    esmectita y clorita: alteración argílica y fílica alrededor de epitermales y pórfidos.
  · Óxidos de hierro (férrico): cociente B04/B02. Sube con hematita, goethita y jarosita: gossans,
    lateritas y zonas oxidadas.
  · Pérdida de vegetación: caída del NDVI entre la temporada seca de un año y la del siguiente,
    donde antes había vegetación densa. Desmonte, caminos, tajos, pero también quemas y cosechas.

Límites que van en las notas de cada capa (no se callan):
  · Los cocientes se calculan SOLO donde el suelo está expuesto (NDVI < 0,30): bajo el bosque el
    satélite no ve la roca. Sin anomalía no quiere decir sin alteración.
  · Un cociente alto también lo dan suelos arcillosos, lateritas, arenas ferruginosas, techos y
    caminos de tierra. Es una guía para decidir dónde mirar, no un hallazgo.
  · Las clases son RELATIVAS a todo el suelo expuesto de Honduras (percentiles), no umbrales
    mineralógicos.
  · 40 m por píxel.

Uso (sin dependencias más allá de GDAL, numpy y opencv):

    python3 composicion.py escenas  --trabajo DIR      # busca las escenas en el STAC
    python3 composicion.py teselas  --trabajo DIR [-j 3]  # compone cada tesela MGRS (≈40)
    python3 composicion.py mosaico  --trabajo DIR      # mosaico, clases, colores y PMTiles

Hace falta el contorno de Honduras en DIR/hn.geojson (Natural Earth 1:10 m, ADM0_A3 = HND) y
`go-pmtiles` en el PATH o en ~/go/bin.
"""
import argparse, json, os, subprocess, sys, time, urllib.request
from concurrent.futures import ProcessPoolExecutor

import numpy as np

STAC = 'https://earth-search.aws.element84.com/v1'
BBOX = [-89.4, 12.9, -83.1, 16.5]
TEMPORADAS = {'2025': '2025-01-15T00:00:00Z/2025-05-10T00:00:00Z', '2026': '2026-01-15T00:00:00Z/2026-05-10T00:00:00Z'}
POR_TEMPORADA = 3
# Bandas: 10 m (B02, B04) se leen en su 2.ª sobrevista (40 m); 20 m (B8A, B11, B12, SCL), en la 1.ª.
BANDAS = {'blue': 1, 'red': 1, 'nir08': 0, 'swir16': 0, 'swir22': 0, 'scl': 0}
# SCL válidos: 4 vegetación, 5 suelo desnudo, 6 agua, 7 sin clasificar. Fuera: sin dato, saturado,
# sombra oscura/topográfica, sombra de nube, nubes, cirros, nieve.
SCL_VALIDO = (4, 5, 6, 7)
NDVI_EXPUESTO = 0.30
# Cuantización a 8 bits (0 = sin dato / enmascarado).
RANGO = {'arc': (0.8, 2.4), 'fe': (0.6, 4.0), 'ndvi': (-0.2, 1.0)}

os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
os.environ.setdefault('CPL_VSIL_CURL_ALLOWED_EXTENSIONS', '.tif')
os.environ.setdefault('GDAL_HTTP_MAX_RETRY', '4')
os.environ.setdefault('GDAL_HTTP_RETRY_DELAY', '3')


def pedir(url, cuerpo=None):
    for i in range(5):
        try:
            req = urllib.request.Request(url, data=json.dumps(cuerpo).encode() if cuerpo else None, headers={'content-type': 'application/json'})
            return json.load(urllib.request.urlopen(req, timeout=120))
        except Exception as e:  # el STAC contesta 502 de vez en cuando
            print('  reintento', i + 1, e, file=sys.stderr)
            time.sleep(3 * (i + 1))
    raise SystemExit(f'No pude consultar {url}')


def clave(item):
    p = item['properties']
    return f"{p['mgrs:utm_zone']}{p['mgrs:latitude_band']}{p['mgrs:grid_square']}"


def escenas(trabajo):
    from shapely.geometry import shape
    hn = shape(json.load(open(os.path.join(trabajo, 'hn.geojson')))['features'][0]['geometry'])
    por = {}
    for anio, fechas in TEMPORADAS.items():
        cuerpo = {'collections': ['sentinel-2-l2a'], 'bbox': BBOX, 'datetime': fechas, 'query': {'eo:cloud_cover': {'lt': 20}}, 'limit': 100}
        j = pedir(f'{STAC}/search', cuerpo)
        while True:
            for it in j['features']:
                if not shape(it['geometry']).intersects(hn):
                    continue
                por.setdefault(clave(it), {}).setdefault(anio, []).append(it)
            sig = [l for l in j.get('links', []) if l.get('rel') == 'next']
            if not sig:
                break
            j = pedir(sig[0]['href'], sig[0].get('body')) if sig[0].get('method') == 'POST' else pedir(sig[0]['href'])
    elegidas = {}
    for t, anios in sorted(por.items()):
        elegidas[t] = {}
        for anio, items in anios.items():
            # Menos nubes primero; a igualdad, la escena más completa (las del borde de la órbita traen media tesela).
            items.sort(key=lambda it: it['properties']['eo:cloud_cover'] + 0.5 * it['properties'].get('s2:nodata_pixel_percentage', 0))
            elegidas[t][anio] = [{'id': it['id'], 'nubes': it['properties']['eo:cloud_cover'], 'fecha': it['properties']['datetime'][:10],
                                  'bandas': {b: it['assets'][b]['href'] for b in BANDAS}} for it in items[:POR_TEMPORADA]]
    json.dump(elegidas, open(os.path.join(trabajo, 'elegidas.json'), 'w'), indent=1)
    print(f'{len(elegidas)} teselas MGRS sobre Honduras;', sum(len(v) for a in elegidas.values() for v in a.values()), 'escenas elegidas')


def leer(href, nivel, destino):
    """Una banda en la sobrevista pedida, a un GeoTIFF local; devuelve (arreglo, geotransform, srs)."""
    import cv2
    subprocess.run(['gdal_translate', '-q', '-oo', f'OVERVIEW_LEVEL={nivel}', '/vsicurl/' + href, destino], check=True)
    a = cv2.imread(destino, cv2.IMREAD_UNCHANGED)
    if a is None:
        raise RuntimeError(f'no pude leer {href}')
    return a


def georef(tif):
    info = json.loads(subprocess.run(['gdalinfo', '-json', tif], capture_output=True, text=True, check=True).stdout)
    return info['geoTransform'], info['coordinateSystem']['wkt'], info['size']


def cuantizar(x, rango):
    lo, hi = rango
    q = np.clip((x - lo) / (hi - lo) * 254, 0, 254) + 1
    return np.where(np.isfinite(x), q, 0).astype(np.uint8)


def tesela(args):
    trabajo, t, anios = args
    salida = os.path.join(trabajo, 'teselas', f'{t}.tif')
    if os.path.exists(salida):
        return t, 'ya estaba'
    tmp = os.path.join(trabajo, 'tmp', t)
    os.makedirs(tmp, exist_ok=True)
    import cv2  # noqa: F401  (se importa aquí para cada proceso)
    pilas = {b: [] for b in ('blue', 'red', 'nir08', 'swir16', 'swir22')}
    ndvi_anio = {}
    agua_votos = None
    gt = srs = tam = None
    for anio, escs in anios.items():
        ndvis = []
        for e in escs:
            try:
                scl = leer(e['bandas']['scl'], BANDAS['scl'], os.path.join(tmp, 'scl.tif'))
                if gt is None:
                    gt, srs, tam = georef(os.path.join(tmp, 'scl.tif'))
                ok = np.isin(scl, SCL_VALIDO)
                agua = scl == 6
                agua_votos = agua.astype(np.int16) if agua_votos is None else agua_votos + agua
                b = {}
                for banda in pilas:
                    a = leer(e['bandas'][banda], BANDAS[banda], os.path.join(tmp, f'{banda}.tif')).astype(np.float32)
                    if a.shape != scl.shape:
                        a = cv2.resize(a, (scl.shape[1], scl.shape[0]), interpolation=cv2.INTER_AREA)
                    b[banda] = np.where(ok & (a > 0), a / 10000.0, np.nan)
                for banda in pilas:
                    pilas[banda].append(b[banda])
                with np.errstate(invalid='ignore', divide='ignore'):
                    ndvis.append((b['nir08'] - b['red']) / (b['nir08'] + b['red']))
            except Exception as ex:
                print(f'  {t} {e["id"]}: {ex}', file=sys.stderr)
        if ndvis:
            with np.errstate(all='ignore'):
                ndvi_anio[anio] = np.nanmedian(np.stack(ndvis), axis=0)
    if gt is None:
        return t, 'sin escenas legibles'
    import warnings
    warnings.filterwarnings('ignore', category=RuntimeWarning)
    med = {b: np.nanmedian(np.stack(v), axis=0) for b, v in pilas.items() if v}
    with np.errstate(invalid='ignore', divide='ignore'):
        ndvi = (med['nir08'] - med['red']) / (med['nir08'] + med['red'])
        arc = med['swir16'] / med['swir22']
        fe = med['red'] / med['blue']
    # Suelo expuesto y no agua (el agua vota en las escenas; y la reflectancia SWIR muy baja también es agua).
    agua = (agua_votos > 0) | (med['swir16'] < 0.03)
    expuesto = (ndvi < NDVI_EXPUESTO) & ~agua & np.isfinite(arc) & np.isfinite(fe)
    capas = [
        cuantizar(np.where(expuesto, arc, np.nan), RANGO['arc']),
        cuantizar(np.where(expuesto, fe, np.nan), RANGO['fe']),
        cuantizar(np.where(~agua, ndvi_anio.get('2025', np.full(ndvi.shape, np.nan)), np.nan), RANGO['ndvi']),
        cuantizar(np.where(~agua, ndvi_anio.get('2026', np.full(ndvi.shape, np.nan)), np.nan), RANGO['ndvi']),
    ]
    crudo = os.path.join(tmp, 'crudo.tif')
    # Se escribe con cv2 (4 bandas uint8, sin georreferencia) y GDAL le pone la de la tesela.
    import cv2
    h, w = capas[0].shape
    for i, c in enumerate(capas):
        cv2.imwrite(os.path.join(tmp, f'c{i}.tif'), c)
    vrt = os.path.join(tmp, 'c.vrt')
    subprocess.run(['gdalbuildvrt', '-q', '-separate', vrt] + [os.path.join(tmp, f'c{i}.tif') for i in range(4)], check=True)
    ulx, px, _, uly, _, py = gt
    subprocess.run(['gdal_translate', '-q', '-a_srs', srs, '-a_ullr', str(ulx), str(uly), str(ulx + px * w), str(uly + py * h),
                    '-a_nodata', '0', '-co', 'COMPRESS=DEFLATE', '-co', 'TILED=YES', vrt, crudo], check=True)
    os.makedirs(os.path.dirname(salida), exist_ok=True)
    os.replace(crudo, salida)
    subprocess.run(['rm', '-rf', tmp])
    return t, f"{sum(len(v) for v in anios.values())} escenas, expuesto {expuesto.mean() * 100:.1f} %"


def teselas(trabajo, j):
    elegidas = json.load(open(os.path.join(trabajo, 'elegidas.json')))
    trabajos = [(trabajo, t, a) for t, a in sorted(elegidas.items())]
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=j) as ex:
        for i, (t, r) in enumerate(ex.map(tesela, trabajos), 1):
            print(f'[{i}/{len(trabajos)}] {t}: {r} ({time.time() - t0:.0f} s)', flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('paso', choices=['escenas', 'teselas', 'mosaico'])
    ap.add_argument('--trabajo', required=True)
    ap.add_argument('-j', type=int, default=3)
    a = ap.parse_args()
    if a.paso == 'escenas':
        escenas(a.trabajo)
    elif a.paso == 'teselas':
        teselas(a.trabajo, a.j)
    else:
        from mosaico import mosaico  # mosaico.py, al lado
        mosaico(a.trabajo)


if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main()
