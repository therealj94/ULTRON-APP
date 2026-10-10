#!/usr/bin/env python3
"""Clasifica todos los SHP/KML/KMZ del lote-1 según el Índice Maestro de Capas v1.4.

Corre en el nodo de carga (archivos en /datos/lote-1/listo, base por con-cerebro/psql).
Salida: /root/indice/clasificacion.json (todo lo necesario para el manifiesto y el reporte).
"""
import json, os, re, subprocess, unicodedata, hashlib, collections, sys

LISTO = '/datos/lote-1/listo'
ORIG = '/datos/lote-1/original'
RAIZ = 'INFORMACION ELECTRUM'
OUT = '/root/indice'
os.makedirs(OUT, exist_ok=True)
DB = os.environ['ELECTRUM_DB_URL']


def psql(sql):
    r = subprocess.run(['psql', DB, '-At', '-F', '\x1f', '-R', '\x1e', '-c', sql], capture_output=True, text=True, check=True)
    return [l.split('\x1f') for l in r.stdout.rstrip('\n').split('\x1e') if l.strip()]


def fold(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def slug(s):
    return fold(s).replace(' ', '_')[:60] or 'capa'


# ---------------------------------------------------------------- base: capas
capas = {}
for cid, carpeta, nombre, rol, n, caja in psql(
    """SELECT c.id, coalesce(c.carpeta,''), c.nombre, coalesce(c.rol,''),
              (SELECT count(*) FROM entidad_geo e WHERE e.capa_id=c.id),
              (SELECT ST_Extent(e.geom)::text FROM entidad_geo e WHERE e.capa_id=c.id)
         FROM capa c"""):
    capas[int(cid)] = dict(id=int(cid), carpeta=carpeta, nombre=nombre, rol=rol, n=int(n), caja=caja)
geom = {int(a): b for a, b in psql("SELECT capa_id, string_agg(DISTINCT GeometryType(geom), ',') FROM entidad_geo GROUP BY 1")}


def capa_de(carpeta_rel, base):
    """La capa de la base que salió de este archivo: misma carpeta y nombre; si no, mismo nombre."""
    fb = fold(base)
    cand = [c for c in capas.values() if fold(c['nombre']) == fb]
    if not cand:
        return None
    misma = [c for c in cand if fold(c['carpeta']) == fold(f'{RAIZ}/{carpeta_rel}')]
    con = [c for c in (misma or cand) if c['n'] > 0] or (misma or cand)
    return sorted(con, key=lambda c: (-c['n'], c['id']))[0]


# ---------------------------------------------------------------- archivos
archivos = []
for d, _, fs in os.walk(os.path.join(LISTO, RAIZ)):
    for f in fs:
        if f.lower().endswith(('.shp', '.kml', '.kmz')):
            archivos.append(os.path.join(d, f))
archivos.sort()


def ogr(path):
    try:
        r = subprocess.run(['ogrinfo', '-ro', '-so', '-al', path], capture_output=True, text=True, timeout=120)
        t = r.stdout
        n = sum(int(x) for x in re.findall(r'Feature Count: (\d+)', t))
        g = sorted(set(re.findall(r'Geometry: (.+)', t)))
        crs = None
        m = re.search(r'ID\["EPSG",(\d+)\]\]\s*$', t, re.M)
        ids = re.findall(r'ID\["EPSG",(\d+)\]', t)
        if ids:
            crs = f'EPSG:{ids[-1]}'
        if path.lower().endswith(('.kml', '.kmz')):
            crs = 'EPSG:4326'
        return dict(ok=r.returncode == 0, n=n, geometria=','.join(g), crs=crs, error=r.stderr.strip()[:200] if r.returncode else '')
    except Exception as e:
        return dict(ok=False, n=0, geometria='', crs=None, error=str(e)[:200])


def huella(path):
    h = hashlib.sha1()
    base = path[:-4]
    for ext in ('.shp', '.dbf') if path.lower().endswith('.shp') else ('',):
        p = base + ext if ext else path
        if os.path.exists(p):
            with open(p, 'rb') as fh:
                for b in iter(lambda: fh.read(1 << 20), b''):
                    h.update(b)
    return h.hexdigest()


# ---------------------------------------------------------------- reglas del índice
INDEXA = {'buena vista monarka': 1, 'chaparros': 2, 'la campana': 3, 'la escalera': 4, 'pantaleona': 5, 'tajo': 6, 'target blancos': 7}
GEO = [
    ('estructural 2', 201), ('estructural', 202), ('fallas geologicas centroamerica', 203), ('geologico olancho 1 100 000', 204),
    ('geologico', 205), ('mapa estructural 1 50 000', 206), ('mapa geotectonico', 207), ('mapa metalogenetico', 208),
    ('mapas geologicos 1 500000', 209), ('suelos simmons hn', 210),
]
PROY = {'1 pantaleona': 301, '2 buena vista monarka': 302, '3 cimarron': 303, '4 minas de oro aura': 304}


def regla(rel):
    """(id_categoria, id_capa|None, extra) para un archivo, por su ruta bajo INFORMACION ELECTRUM."""
    partes = rel.split('/')
    f = [fold(p) for p in partes]
    base = fold(os.path.splitext(partes[-1])[0])
    if f[0] == '1 informacion gis':
        sub = f[1] if len(f) > 1 else ''
        if sub.startswith('areas protegidas'): return (101, 1, None)
        if sub.startswith('buffer carretera'): return (102, 1, None)
        if sub.startswith('curvas de nivel'): return (103, 1, None)
        if sub.startswith('derechos mineros'): return (104, 1, None)
        if sub.startswith('division politica'):
            k = {'departamentos': 1, 'municipios': 2, 'caserios': 3, 'aldeas': 4, 'red hidrica hn': 5}.get(f[2] if len(f) > 2 else '')
            return (105, k, None)
        if sub.startswith('mircocuencas') or sub.startswith('microcuencas'): return (108, 1, None)
        if sub.startswith('patrimonio publico forestal'): return (109, 1, None)
        if sub.startswith('zonas informales'): return (111, 1, None)
        if sub.startswith('recursos'):
            if len(f) > 3 and f[2] == 'depositos minerales': return (110, 1, ('mineral', re.sub(r'^depos?i?to\s+', '', base).upper()))
            if len(f) > 3 and f[2] == 'fichas seleccionadas': return (110, 2, ('mineral', base.upper()))
            if base == 'fichas de ocurrencia minera': return (110, 3, None)
            if base == 'yacimientos y ocurrencias minera': return (110, 4, None)
        if sub == 'informacion concesiones indexsa':
            if len(f) > 3 and f[2] in INDEXA: return (107, INDEXA[f[2]], ('archivo', os.path.splitext(partes[-1])[0]))
            if base.startswith('zonas'): return (107, 8, ('archivo', os.path.splitext(partes[-1])[0]))
    if f[0] == '2 geologia' and len(f) >= 2:
        for k, i in GEO:
            if base == k: return (i, 1, None)
    if f[0] == '5 proyectos indexsa' and len(f) > 1 and f[1] in PROY:
        return (PROY[f[1]], None, None)
    return (800, None, None)


res = []
for p in archivos:
    rel = os.path.relpath(p, os.path.join(LISTO, RAIZ))
    carpeta_rel, nom = os.path.split(rel)
    base = os.path.splitext(nom)[0]
    o = ogr(p)
    falt = []
    if p.lower().endswith('.shp'):
        b = p[:-4]
        for e in ('.shx', '.dbf', '.prj'):
            if not (os.path.exists(b + e) or os.path.exists(b + e.upper())):
                falt.append(e)
    c = capa_de(carpeta_rel, base)
    cat, sub, extra = regla(rel)
    orig = os.path.join(ORIG, RAIZ, rel)
    hermanos = []
    if p.lower().endswith('.shp'):
        d = os.path.dirname(p)
        for x in sorted(os.listdir(d)):
            if os.path.splitext(x)[0] == base and x != nom:
                hermanos.append(os.path.join(carpeta_rel, x))
    res.append(dict(
        rel=rel, nombre=base, ext=os.path.splitext(nom)[1].lower()[1:], tam=os.path.getsize(p),
        en_original=os.path.exists(orig), hermanos=hermanos, faltan=falt,
        huella=huella(p), cat=cat, sub=sub, extra=extra,
        capa=c['id'] if c else None, capa_n=c['n'] if c else None, capa_rol=c['rol'] if c else None,
        **o,
    ))

# ---------------------------------------------------------------- hojas cartográficas (tif con su extensión)
hojas = []
for d, _, fs in os.walk(os.path.join(ORIG, RAIZ, '1. INFORMACION GIS', 'HOJAS CARTOGRAFICAS')):
    for f in fs:
        if f.lower().endswith('.tif'):
            p = os.path.join(d, f)
            try:
                j = json.loads(subprocess.run(['gdalinfo', '-json', p], capture_output=True, text=True, timeout=120).stdout)
                w = j.get('wgs84Extent', {}).get('coordinates', [[]])[0]
                xs = [a[0] for a in w]; ys = [a[1] for a in w]
                caja = [min(xs), min(ys), max(xs), max(ys)] if xs else None
                srs = j.get('coordinateSystem', {}).get('wkt', '')
                ids = re.findall(r'ID\["EPSG",(\d+)\]', srs)
            except Exception:
                caja, ids = None, []
            hojas.append(dict(rel=os.path.relpath(p, os.path.join(ORIG, RAIZ)), nombre=os.path.splitext(f)[0], tam=os.path.getsize(p),
                              caja=caja, crs=f'EPSG:{ids[-1]}' if ids else None))
hojas.sort(key=lambda h: (re.sub(r'\D', '', h['nombre']).zfill(5), h['nombre'], h['rel']))

# ---------------------------------------------------------------- planos de proyectos (documentos)
planos = []
for proy, cid in PROY.items():
    for d, _, fs in os.walk(os.path.join(LISTO, RAIZ, '5. PROYECTOS INDEXSA')):
        if fold(os.path.relpath(d, os.path.join(LISTO, RAIZ, '5. PROYECTOS INDEXSA')).split('/')[0]) != proy:
            continue
        for f in fs:
            fl = fold(f)
            if re.search(r'\.(pdf|dwg|dxf|jpg|jpeg|png|tif|sid)$', f, re.I) and re.search(r'plano|mapa|planta|croquis|levantamiento|topograf|ubicacion|poligono|perfil|seccion|1620c', fl + ' ' + fold(d)):
                if 'fotos' in fold(d) and not re.search(r'plano|mapa', fl):
                    continue
                p = os.path.join(d, f)
                planos.append(dict(proyecto=cid, rel=os.path.relpath(p, os.path.join(LISTO, RAIZ)), nombre=os.path.splitext(f)[0],
                                   ext=os.path.splitext(f)[1].lower()[1:], tam=os.path.getsize(p)))
planos.sort(key=lambda x: (x['proyecto'], x['rel']))
docs = {}
for did, carpeta, nombre in psql("SELECT id, coalesce(carpeta,''), nombre FROM documento"):
    docs.setdefault(fold(nombre), []).append((int(did), carpeta))
for pl in planos:
    cand = docs.get(fold(pl['nombre'] + '.' + pl['ext'])) or docs.get(fold(pl['nombre'] + '.txt')) or []
    misma = [d for d in cand if fold(d[1]) == fold(f"{RAIZ}/{os.path.dirname(pl['rel'])}")]
    pl['documento'] = (misma or cand or [(None, '')])[0][0]

# ---------------------------------------------------------------- filtros: campos útiles de cada capa
NO = re.compile(r'^(fid|id|objectid|gid|oid|shape|area|perim|length|len|leng|longitud|x|y|lat|lon|long|xcoord|ycoord|este|norte|utm|cod|codigo|clave|hect|ha|km2|acres|fecha|date|z|elev|altura|cota|orden|num|n|no|nro|layer|path|descripci|description|name|nombre|folder|styleurl|begin|end|timestamp|altitudemode|tessellate|extrude|visibility|drawOrder|icon|snippet)', re.I)
ids_capa = sorted({r['capa'] for r in res if r['capa']} | {c for c in capas if capas[c]['n'] > 0})
filtros = {}
for cid in ids_capa:
    if capas[cid]['n'] == 0 or capas[cid]['n'] > 60000:
        continue
    filas = psql(f"""SELECT k, count(DISTINCT v), count(*), (array_agg(DISTINCT v ORDER BY v))[1:41]::text
                       FROM (SELECT a.k, trim(a.v) AS v FROM entidad_geo e, jsonb_each_text(e.atributos) a(k, v)
                              WHERE e.capa_id={cid} AND trim(a.v) <> '') s GROUP BY k""")
    fs = []
    for k, dist, tot, vals in filas:
        dist, tot = int(dist), int(tot)
        if NO.match(k) or dist < 2 or dist > 40 or dist >= tot:
            continue
        valores = [v.strip('"') for v in re.findall(r'"(?:[^"\\]|\\.)*"|[^,{}]+', vals.strip('{}'))]
        valores = [v.replace('\\"', '"') for v in valores if v]
        if all(re.fullmatch(r'-?[\d.,]+', v) for v in valores) and dist > 12:
            continue
        fs.append(dict(campo=k, valores=valores, distintos=dist))
    if fs:
        filtros[cid] = sorted(fs, key=lambda x: x['distintos'])[:4]

# catastro (concesiones): estado, departamento, tipo, mineral
cat = {}
for campo in ('estado', 'departamento', 'tipo', 'mineral'):
    v = [r[0] for r in psql(f"SELECT DISTINCT trim({campo}) FROM concesion WHERE coalesce(trim({campo}),'') <> '' ORDER BY 1 LIMIT 60")]
    if 2 <= len(v) <= 40:
        cat[campo] = v

json.dump(dict(archivos=res, hojas=hojas, planos=planos, capas=capas, geom=geom, filtros=filtros, catastro=cat),
          open(f'{OUT}/clasificacion.json', 'w'), ensure_ascii=False)
print('archivos', len(res), 'hojas', len(hojas), 'planos', len(planos), 'capas', len(capas), 'filtros', len(filtros))
print('por categoria', collections.Counter(r['cat'] for r in res).most_common())
print('sin capa', sum(1 for r in res if not r['capa']))
