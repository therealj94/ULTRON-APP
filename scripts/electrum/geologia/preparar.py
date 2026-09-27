#!/usr/bin/env python3
"""
Paquete de geología abierta para Dr Electrum: baja las fuentes, las recorta a Honduras y su
entorno, normaliza los atributos en español y escribe data/geologia/*.geojson.gz.

Uso (una vez; el resultado va al repositorio y lo carga scripts/electrum/cargar-geologia.ts):

    pip install pyogrio geopandas remotezip
    python3 scripts/electrum/geologia/preparar.py [--trabajo /tmp/geo]

Qué entra y con qué límites (va también en data/geologia/FUENTES.md y en cada capa):

  · Geología superficial y fallas — USGS OFR 97-470-K (French y Schenk, 2004), a partir del mapa
    geológico-tectónico del Caribe de Case y Holcombe (1980). Escala 1:2 500 000, error de
    georreferencia (RMS) ≈ 1,6 km. Dominio público. Sirve para el contexto regional: qué rocas y
    qué estructuras hay en la zona. NO para decidir dentro de una concesión.
  · Provincias geológicas — la misma publicación.
  · Fallas activas — GEM Global Active Faults, catálogo de Centroamérica y el Caribe
    (Styron y Pagani, 2020). CC BY-SA 4.0.
  · Límites de placas — PB2002 (Bird, 2003), conversión de Ahlenius. ODC-BY 1.0.
  · Tractos permisivos para pórfido de cobre y sus depósitos y prospectos — USGS SIR 2010-5090-I
    (Gray y otros, 2014). Dominio público.
  · Yacimientos — USGS Mineral Resources Data System (MRDS), servicio WFS. Dominio público.
  · Países — Natural Earth 1:50 m. Dominio público. Solo para el fondo del mapa geotectónico.
"""
import argparse
import gzip
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import box, mapping

RAIZ = Path(__file__).resolve().parents[3]
SALIDA = RAIZ / 'data' / 'geologia'

# Honduras con margen: entra la falla de Motagua en Guatemala, el golfo de Fonseca y las islas.
REGION = (-90.6, 12.4, -82.6, 17.9)
# El mapa geotectónico mira más lejos: la fosa Mesoamericana y la dorsal de Cocos.
REGION_TECTONICA = (-100.0, 4.0, -70.0, 24.0)

URL = {
    'caribe': 'https://pubs.usgs.gov/of/1997/0470k/ofr97470K.zip',
    'gem': 'https://raw.githubusercontent.com/GEMScienceTools/gem-global-active-faults/master/geojson/gem_active_faults_harmonized.geojson',
    'pb2002': 'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json',
    'porfido': 'https://pubs.usgs.gov/sir/2010/5090/i/downloads/sir2010-5090I_GISdata.zip',
    'mrds': 'https://mrdata.usgs.gov/services/wfs/mrds?service=WFS&request=GetFeature&version=1.0.0&typeName=mrds&BBOX={},{},{},{}&maxFeatures=20000',
    'paises': 'https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip',
}

# ------------------------------------------------------------------ unidades geológicas
# Código del mapa → (descripción en español, edad, clase de roca). La clase es lo que usa el
# análisis: un «intrusivo» es un plutón, fuente posible de calor y metales.
UNIDADES = {
    'Q': ('Aluvión cuaternario', 'Cuaternario', 'aluvial'),
    'Qv': ('Edificios volcánicos, coladas y depósitos piroclásticos cuaternarios', 'Cuaternario', 'volcanica'),
    'Qvi': ('Rellenos de pómez y mantos piroclásticos cuaternarios', 'Cuaternario', 'volcanica'),
    'QTv': ('Edificios volcánicos, coladas, tobas y piroclastos silícicos cuaternarios y terciarios', 'Cuaternario–Terciario', 'volcanica'),
    'QTc': ('Depósitos continentales cuaternarios y terciarios', 'Cuaternario–Terciario', 'sedimentaria'),
    'Tv': ('Rocas volcánicas terciarias', 'Terciario', 'volcanica'),
    'Tva': ('Coladas andesíticas y rocas volcánicas asociadas del Plioceno y Mioceno', 'Mioceno–Plioceno', 'volcanica'),
    'Ti': ('Plutones terciarios, sobre todo intermedios a silícicos', 'Terciario', 'intrusiva'),
    'Tc': ('Estratos continentales terciarios', 'Terciario', 'sedimentaria'),
    'uT': ('Estratos marinos posteriores al Eoceno', 'Oligoceno–Plioceno', 'sedimentaria'),
    'lT': ('Estratos marinos del Eoceno o del Paleoceno', 'Paleoceno–Eoceno', 'sedimentaria'),
    'TK': ('Estratos marinos terciarios y cretácicos', 'Cretácico–Terciario', 'sedimentaria'),
    'TKc': ('Estratos continentales terciarios y cretácicos', 'Cretácico–Terciario', 'sedimentaria'),
    'TKi': ('Plutones terciarios y cretácicos, sobre todo intermedios a silícicos', 'Cretácico–Terciario', 'intrusiva'),
    'K': ('Estratos marinos cretácicos (calizas y lutitas en buena parte)', 'Cretácico', 'sedimentaria'),
    'Ki': ('Plutones cretácicos, sobre todo intermedios a silícicos', 'Cretácico', 'intrusiva'),
    'J': ('Estratos marinos y continentales jurásicos', 'Jurásico', 'sedimentaria'),
    'JTr': ('Estratos marinos y continentales jurásicos y triásicos', 'Triásico–Jurásico', 'sedimentaria'),
    'Mz': ('Rocas sedimentarias y volcánicas mesozoicas', 'Mesozoico', 'sedimentaria'),
    'MzPzm': ('Rocas metasedimentarias y metaígneas mesozoicas y paleozoicas', 'Paleozoico–Mesozoico', 'metamorfica'),
    'Pz': ('Estratos paleozoicos', 'Paleozoico', 'sedimentaria'),
    'Pzv': ('Rocas volcánicas paleozoicas', 'Paleozoico', 'volcanica'),
    'Pzi': ('Plutones paleozoicos, sobre todo intermedios a silícicos', 'Paleozoico', 'intrusiva'),
    'Pzm': ('Rocas metamórficas paleozoicas y precámbricas, sin dividir', 'Precámbrico–Paleozoico', 'metamorfica'),
    'u': ('Rocas ultramáficas (serpentinitas, peridotitas)', 'sin edad asignada', 'ultramafica'),
    'i': ('Rocas intrusivas sin dividir, sobre todo intermedias a silícicas', 'sin edad asignada', 'intrusiva'),
    'Tpm': ('Estratos del Plioceno y del Mioceno', 'Mioceno–Plioceno', 'sedimentaria'),
    'Te': ('Estratos del Eoceno', 'Eoceno', 'sedimentaria'),
    'Mzm': ('Rocas metasedimentarias y metaígneas mesozoicas, de metamorfismo bajo a intermedio', 'Mesozoico', 'metamorfica'),
    'W': ('Agua', '', 'agua'),
    'Und': ('Sin determinar', '', 'otra'),
}


def unidad(codigo: str, descripcion_en: str):
    """Lo que no está en la tabla (unidades de los países vecinos) se clasifica por su texto."""
    if codigo in UNIDADES:
        return UNIDADES[codigo]
    d = (descripcion_en or '').lower()
    if re.search(r'pluton|intrusive|granit|diorit', d):
        clase = 'intrusiva'
    elif re.search(r'volcan|pyroclast|tuff|basalt|andesit', d):
        clase = 'volcanica'
    elif re.search(r'metamorph|schist|gneiss', d):
        clase = 'metamorfica'
    elif re.search(r'ultramafic|ophiolit|serpentin', d):
        clase = 'ultramafica'
    elif re.search(r'alluvium', d):
        clase = 'aluvial'
    elif re.search(r'strata|sediment|deposit|limestone|carbonate', d):
        clase = 'sedimentaria'
    else:
        clase = 'otra'
    return (descripcion_en or 'Sin descripción', '', clase)


# ------------------------------------------------------------------ fallas
TIPO_FALLA_USGS = {
    'FDT': ('normal o de bloque hundido', 'cierta'),
    'FDTA': ('normal o de bloque hundido', 'aproximada'),
    'FU': ('desplazamiento desconocido', 'cierta'),
    'FUA': ('desplazamiento desconocido', 'aproximada'),
    'FUS': ('desplazamiento desconocido', 'especulativa'),
    'RTF': ('inversa o de cabalgamiento', 'cierta'),
    'RTFA': ('inversa o de cabalgamiento', 'aproximada o inferida'),
    'SSTF': ('de rumbo o transformante', 'cierta'),
}
TIPO_FALLA_GEM = {
    'Sinistral': 'de rumbo sinestral',
    'Dextral': 'de rumbo dextral',
    'Normal': 'normal',
    'Reverse': 'inversa',
    'Thrust': 'de cabalgamiento',
    'Sinistral-Normal': 'sinestral con componente normal',
    'Dextral-Normal': 'dextral con componente normal',
    'Normal-Sinistral': 'normal con componente sinestral',
    'Normal-Dextral': 'normal con componente dextral',
    'Sinistral-Reverse': 'sinestral con componente inversa',
    'Dextral-Reverse': 'dextral con componente inversa',
    'Reverse-Sinistral': 'inversa con componente sinestral',
    'Reverse-Dextral': 'inversa con componente dextral',
    'Subduction_Thrust': 'cabalgamiento de subducción',
    'Anticline': 'anticlinal',
    'Syncline': 'sinclinal',
}

# ------------------------------------------------------------------ placas
PLACAS = {
    'CA': 'Caribe', 'NA': 'Norteamérica', 'CO': 'Cocos', 'NZ': 'Nazca', 'SA': 'Sudamérica',
    'PM': 'Panamá', 'ND': 'Andes del Norte', 'PA': 'Pacífico', 'RI': 'Rivera',
}
# PB2002 marca en este archivo solo la subducción. El resto, por el par de placas, con lo que dice
# Bird (2003) de cada límite en la región; lo que no se sabe se dice así.
TIPO_LIMITE_PAR = {
    frozenset(('CA', 'NA')): 'transformante (sistema Motagua–Polochic–fosa del Caimán)',
    frozenset(('CO', 'NZ')): 'divergente (dorsal de Galápagos)',
    frozenset(('CO', 'PA')): 'divergente (dorsal del Pacífico Oriental)',
    frozenset(('NZ', 'PM')): 'transformante (zona de fractura de Panamá)',
    frozenset(('CA', 'SA')): 'transformante con deformación',
    frozenset(('PM', 'CA')): 'convergente difuso (cinturón deformado del norte de Panamá)',
    frozenset(('NA', 'SA')): 'difuso',
    frozenset(('ND', 'SA')): 'transformante con deformación',
    frozenset(('PM', 'ND')): 'colisión (Panamá contra los Andes del Norte)',
}

# ------------------------------------------------------------------ minerales
MINERAL = {
    'AU': 'oro', 'AG': 'plata', 'CU': 'cobre', 'PB': 'plomo', 'ZN': 'zinc', 'SB': 'antimonio',
    'FE': 'hierro', 'MN': 'manganeso', 'W': 'wolframio', 'MO': 'molibdeno', 'HG': 'mercurio',
    'NI': 'níquel', 'CR': 'cromo', 'CO': 'cobalto', 'SN': 'estaño', 'AS': 'arsénico', 'BI': 'bismuto',
    'CD': 'cadmio', 'BA': 'bario', 'U': 'uranio', 'PT': 'platino', 'TI': 'titanio', 'AL': 'aluminio',
    'GYP': 'yeso', 'LST': 'caliza', 'MBL': 'mármol', 'CLY': 'arcilla', 'KAO': 'caolín', 'OPL': 'ópalo',
    'SIL': 'sílice', 'GRV': 'grava', 'SND': 'arena', 'BEN': 'bentonita', 'PUM': 'pómez', 'ZEO': 'zeolita',
    'COL': 'carbón', 'SLT': 'sal', 'SUL': 'azufre', 'GEM': 'gemas', 'PER': 'perlita', 'DIA': 'diatomita',
}
ESTADO_MRDS = {'Occurrence': 'ocurrencia', 'Prospect': 'prospecto', 'Past Producer': 'productor en el pasado',
               'Producer': 'productor', 'Plant': 'planta', 'Unknown': 'sin dato'}
PAIS_FIPS = {'fHO': 'Honduras', 'fGT': 'Guatemala', 'fES': 'El Salvador', 'fNU': 'Nicaragua', 'fBH': 'Belice', 'fMX': 'México'}


def nombre_falla_gem(n: str) -> str:
    """«Polochic Fault-Cuilco Segment» → «Falla Polochic, segmento Cuilco»."""
    if not n:
        return 'Falla activa sin nombre'
    fijos = {'Middle America Trench megathrust': 'Megacabalgamiento de la fosa Mesoamericana',
             'Swan Islands Transform': 'Falla transformante de las islas del Cisne'}
    if n in fijos:
        return fijos[n]
    m = re.match(r'^(.*?) Fault(?:-(.*?) Segment)?$', n)
    if m:
        return f'Falla {m.group(1)}' + (f', segmento {m.group(2)}' if m.group(2) else '')
    m = re.match(r'^(.*?) Graben$', n)
    return f'Graben de {m.group(1)}' if m else n


def primero(v) -> str:
    """GEM guarda «(valor, mínimo, máximo)»: se queda el valor."""
    t = texto(v).strip('()[] ')
    x = t.split(',')[0].strip() if t else ''
    return x.rstrip('.') if x else ''


PROVINCIAS = {
    'Chiapas Massif-Nuclear Central America': 'Macizo de Chiapas y Centroamérica nuclear (bloque Chortís)',
    'Middle America Province': 'Provincia Mesoamericana (arco volcánico)', 'Maya Mountains': 'Montañas Mayas',
    'Sierra Madre de Chiapas-Peten Foldbelt': 'Sierra Madre de Chiapas y cinturón plegado del Petén',
    'North Nicaraguan Rise': 'Alto de Nicaragua norte', 'South Nicaraguan Rise': 'Alto de Nicaragua sur',
    'Cayman Ridge': 'Dorsal del Caimán', 'Cayman Trough': 'Fosa del Caimán', 'Yucatan Basin': 'Cuenca de Yucatán',
    'Yucatan Platform': 'Plataforma de Yucatán', 'Pacific Offshore Basin': 'Cuenca costa afuera del Pacífico',
    'Choco Pacific Basin': 'Cuenca Chocó-Pacífico', 'Colombian Basin': 'Cuenca de Colombia',
    'Greater Antilles Deformed Belt': 'Cinturón deformado de las Antillas Mayores',
    'North Caribbean Deformed Belt': 'Cinturón deformado del norte del Caribe',
    'South Caribbean Accretionary Prism': 'Prisma de acreción del sur del Caribe', 'Venezuelan Basin': 'Cuenca de Venezuela',
    'Beata Ridge': 'Dorsal de Beata', 'Aves Ridge': 'Dorsal de Aves', 'Bahama Platform': 'Plataforma de Bahamas',
    'Villahermosa Uplift': 'Alto de Villahermosa', 'Saline-Comalcalco Basin': 'Cuenca Salina-Comalcalco',
    'Macuspana Basin': 'Cuenca de Macuspana',
}
EDAD_TRACTO = {'Late Cretaceous to Early Tertiary': 'Cretácico tardío a Terciario temprano',
               'Middle to Late Tertiary': 'Terciario medio a tardío'}


def bajar(url: str, destino: Path) -> Path:
    if destino.exists() and destino.stat().st_size > 0:
        return destino
    print('bajando', url, file=sys.stderr)
    with urllib.request.urlopen(url, timeout=300) as r, open(destino, 'wb') as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
    return destino


def recortar(gdf: gpd.GeoDataFrame, caja) -> gpd.GeoDataFrame:
    gdf = gdf.to_crs(4326) if gdf.crs and gdf.crs.to_epsg() != 4326 else gdf
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty]
    gdf = gdf[gdf.intersects(box(*caja))].copy()
    gdf['geometry'] = gdf.geometry.make_valid().intersection(box(*caja))
    return gdf[~gdf.geometry.is_empty]


def escribir(nombre_archivo: str, capa: str, gdf: gpd.GeoDataFrame, propiedades):
    """GeoJSON comprimido con coordenadas a 5 decimales (≈ 1 m, de sobra para 1:2 500 000)."""
    SALIDA.mkdir(parents=True, exist_ok=True)
    feats = []
    for _, fila in gdf.iterrows():
        geom = fila.geometry
        if geom is None or geom.is_empty:
            continue
        feats.append({'type': 'Feature', 'properties': propiedades(fila), 'geometry': redondear(mapping(geom))})
    fc = {'type': 'FeatureCollection', 'name': capa, 'features': feats}
    with gzip.open(SALIDA / nombre_archivo, 'wt', encoding='utf-8', compresslevel=9) as f:
        json.dump(fc, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{nombre_archivo}: {len(feats)} rasgos', file=sys.stderr)


def redondear(g):
    def r(c):
        return [r(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 5), round(c[1], 5)]
    if g['type'] == 'GeometryCollection':
        return {'type': 'GeometryCollection', 'geometries': [redondear(x) for x in g['geometries']]}
    return {'type': g['type'], 'coordinates': r(g['coordinates'])}


def texto(v):
    return '' if v is None or (isinstance(v, float) and pd.isna(v)) else str(v).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--trabajo', default='/tmp/geo-electrum')
    a = ap.parse_args()
    T = Path(a.trabajo)
    T.mkdir(parents=True, exist_ok=True)

    # --- USGS OFR 97-470-K: solo los shapefiles que hacen falta, sin bajar los 200 MB del CD.
    from remotezip import RemoteZip
    carpeta = T / 'caribe'
    if not (carpeta / 'spatial/shape/geo6bg.shp').exists():
        with RemoteZip(URL['caribe']) as z:
            for i in z.infolist():
                n = i.filename
                if n.startswith('spatial/shape/') and n.split('/')[-1].split('.')[0] in ('geo6bg', 'flt6bg', 'prv6bg') and not n.endswith('.zip'):
                    z.extract(n, carpeta)

    geo = recortar(gpd.read_file(carpeta / 'spatial/shape/geo6bg.shp'), REGION)
    # Sin código ni descripción no dicen nada (lagos y huecos del digitalizado): no entran.
    geo = geo[(geo['AGE'].fillna('').astype(str).str.strip() != '') & (geo['AGE'].astype(str) != 'W')]

    def prop_geo(f):
        cod = texto(f['AGE'])
        desc, edad, clase = unidad(cod, texto(f['DESCRPTN']))
        return {'NOMBRE': f'{cod} · {desc}', 'UNIDAD': cod, 'DESCRIPCION': desc, 'EDAD': edad, 'CLASE_ROCA': clase,
                'DESCRIPCION_ORIGINAL': texto(f['DESCRPTN']), 'FUENTE': 'USGS OFR 97-470-K', 'ESCALA': '1:2500000'}
    escribir('geologia-usgs.geojson.gz', 'Geología superficial USGS Caribe 1:2.5M', geo, prop_geo)

    flt = recortar(gpd.read_file(carpeta / 'spatial/shape/flt6bg.shp'), REGION)

    def prop_flt(f):
        tipo, certeza = TIPO_FALLA_USGS.get(texto(f['CODE']), ('sin clasificar', 'sin dato'))
        return {'NOMBRE': 'Falla sin nombre en el mapa', 'TIPO': tipo, 'CERTEZA': certeza, 'CODIGO': texto(f['CODE']),
                'FUENTE': 'USGS OFR 97-470-K', 'ESCALA': '1:2500000'}
    escribir('fallas-usgs.geojson.gz', 'Fallas geológicas USGS Caribe 1:2.5M', flt, prop_flt)

    prv = recortar(gpd.read_file(carpeta / 'spatial/shape/prv6bg.shp'), REGION_TECTONICA)
    prv = prv[prv['NAME'].fillna('').astype(str).str.strip().isin(['', 'Ocean']) == False]
    escribir('provincias-usgs.geojson.gz', 'Provincias geológicas USGS Caribe', prv,
             lambda f: {'NOMBRE': PROVINCIAS.get(texto(f['NAME']), texto(f['NAME'])), 'NOMBRE_ORIGINAL': texto(f['NAME']),
                        'CODIGO': texto(f['CODE']), 'FUENTE': 'USGS OFR 97-470-K'})

    # --- GEM: fallas activas con nombre y cinemática.
    gem = recortar(gpd.read_file(bajar(URL['gem'], T / 'gem.geojson')), REGION)

    def prop_gem(f):
        slip = texto(f.get('slip_type'))
        return {'NOMBRE': nombre_falla_gem(texto(f.get('name'))), 'NOMBRE_ORIGINAL': texto(f.get('name')),
                'TIPO': TIPO_FALLA_GEM.get(slip, slip.lower() or 'sin dato'),
                'ACTIVA': 'sí', 'TASA_MM_ANIO': primero(f.get('net_slip_rate')), 'BUZAMIENTO': primero(f.get('average_dip')),
                'FUENTE': 'GEM Global Active Faults (CC BY-SA 4.0)', 'CATALOGO': texto(f.get('catalog_name'))}
    escribir('fallas-activas-gem.geojson.gz', 'Fallas activas GEM Centroamérica', gem, prop_gem)

    # --- PB2002: límites de placa.
    pb = recortar(gpd.read_file(bajar(URL['pb2002'], T / 'pb2002.json')), REGION_TECTONICA)

    def prop_pb(f):
        a_, b_ = texto(f['PlateA']), texto(f['PlateB'])
        nombre = f"{PLACAS.get(a_, a_)}–{PLACAS.get(b_, b_)}"
        if texto(f['Type']) == 'subduction':
            sub = b_ if '/' in texto(f['Name']) else a_
            tipo = f'subducción (se hunde {PLACAS.get(sub, sub)})'
        else:
            tipo = TIPO_LIMITE_PAR.get(frozenset((a_, b_)), 'no clasificado en PB2002')
        return {'NOMBRE': f'Límite {nombre}', 'TIPO': tipo, 'PLACA_A': PLACAS.get(a_, a_), 'PLACA_B': PLACAS.get(b_, b_),
                'FUENTE': f"PB2002 (Bird, 2003; ODC-BY) — {texto(f['Source'])}"}
    escribir('placas-pb2002.geojson.gz', 'Límites de placas tectónicas PB2002', pb, prop_pb)

    # --- USGS SIR 2010-5090-I: tractos permisivos y depósitos de pórfido de cobre.
    zp = bajar(URL['porfido'], T / 'porfido.zip')
    import zipfile
    with zipfile.ZipFile(zp) as z:
        for n in z.namelist():
            if re.search(r'CentAm(-|_)Carib_pCu_(Tracts|Deposits_prospects)\.(shp|shx|dbf|prj)$', n):
                z.extract(n, T / 'porfido')
    base = next((T / 'porfido').rglob('CentAm_Carib_pCu_Tracts.shp')).parent
    tr = recortar(gpd.read_file(base / 'CentAm_Carib_pCu_Tracts.shp'), REGION)
    GEOL_TRACTO = {
        'CA_CARIB-KT2': 'Arco continental del Cretácico tardío al Terciario temprano: plutones dioríticos y tonalíticos que intruyen rocas sedimentarias mesozoicas y metamórficas más antiguas del norte de Centroamérica.',
        'CA_CARIB-T2': 'Arco continental del Terciario medio a tardío sobre la parte norte de la fosa Mesoamericana, en la interacción de las placas de Norteamérica, Caribe y Cocos.',
    }

    def prop_tr(f):
        tid = texto(f['Tract_ID'])
        return {'NOMBRE': f"Tracto {texto(f['Tract_name'])} (pórfido de cobre)", 'TRACTO': tid,
                'GEOLOGIA': GEOL_TRACTO.get(tid, texto(f['Geology'])), 'EDAD': EDAD_TRACTO.get(texto(f['Age']), texto(f['Age'])),
                'DEPOSITOS_ESPERADOS_MEDIA': texto(f['N_expected']), 'DEPOSITOS_ESPERADOS_P50': texto(f['N50']),
                'DEPOSITOS_ESPERADOS_P10': texto(f['N10']), 'DEPOSITOS_CONOCIDOS': texto(f['N_known']),
                'AREA_KM2': round(float(f['Area_km2']), 0) if texto(f['Area_km2']) else '',
                'FUENTE': 'USGS SIR 2010-5090-I (Gray y otros, 2014)'}
    escribir('tractos-porfido-usgs.geojson.gz', 'Tractos permisivos pórfido de cobre USGS', tr, prop_tr)

    dp = recortar(gpd.read_file(base / 'CentAm-Carib_pCu_Deposits_prospects.shp'), REGION)

    def prop_dp(f):
        num = lambda k: '' if texto(f[k]) in ('', '-9999', '-9999.0') else texto(f[k])
        mins = ', '.join(MINERAL.get(m.strip().upper(), m.strip().lower()) for m in texto(f['Comm_major']).split(',') if m.strip())
        return {'NOMBRE': texto(f['Name']), 'TIPO': texto(f['Type']).replace('porphyry copper', 'pórfido de cobre').replace('skarn related', 'relacionado con skarn'),
                'MINERAL': mins, 'ESTADO': {'Prospect': 'prospecto', 'Deposit': 'depósito'}.get(texto(f['SiteStatus']), texto(f['SiteStatus'])),
                'EDAD_MA': num('Age_Ma'), 'TONELAJE_MT': num('Tonnage_Mt'), 'CU_PCT': num('Cu_pct'), 'AU_G_T': num('Au_g_t'),
                'PAIS': texto(f['Country']), 'FUENTE': 'USGS SIR 2010-5090-I (Gray y otros, 2014)'}
    escribir('yacimientos-porfido-usgs.geojson.gz', 'Yacimientos y prospectos pórfido de cobre USGS', dp, prop_dp)

    # --- USGS MRDS por WFS: los yacimientos de la región.
    xml = bajar(URL['mrds'].format(*REGION), T / 'mrds.xml').read_text(encoding='utf-8')
    filas = []
    for m in re.finditer(r'<ms:mrds fid="[^"]+">(.*?)</ms:mrds>', xml, re.S):
        s = m.group(1)
        g = lambda k: (re.search(rf'<ms:{k}>([^<]*)</ms:{k}>', s) or [None, ''])[1].strip()
        xy = re.search(r'<gml:Point[^>]*>\s*<gml:coordinates>([-\d.]+),([-\d.]+)</gml:coordinates>', s)
        if not xy:
            continue
        codigos = [c for c in g('code_list').split() if c]
        filas.append({'NOMBRE': g('site_name') or 'Sin nombre', 'ESTADO': ESTADO_MRDS.get(g('dev_stat'), g('dev_stat').lower() or 'sin dato'),
                      'MINERAL': ', '.join(MINERAL.get(c.upper(), c.lower()) for c in codigos), 'CODIGOS': ' '.join(codigos),
                      'PAIS': PAIS_FIPS.get(g('fips_code'), g('fips_code')), 'MRDS_ID': g('dep_id'), 'URL': g('url'),
                      'FUENTE': 'USGS MRDS', 'lon': float(xy.group(1)), 'lat': float(xy.group(2))})
    mr = gpd.GeoDataFrame(filas, geometry=gpd.points_from_xy([f['lon'] for f in filas], [f['lat'] for f in filas]), crs=4326)
    escribir('yacimientos-mrds-usgs.geojson.gz', 'Yacimientos MRDS USGS', mr,
             lambda f: {k: f[k] for k in ('NOMBRE', 'ESTADO', 'MINERAL', 'CODIGOS', 'PAIS', 'MRDS_ID', 'URL', 'FUENTE')})

    # --- Natural Earth: países para el fondo del mapa geotectónico (no va a la base).
    ne = bajar(URL['paises'], T / 'paises.zip')
    pa = recortar(gpd.read_file(f'zip://{ne}'), REGION_TECTONICA)
    pa['geometry'] = pa.geometry.simplify(0.01)
    escribir('paises-natural-earth.geojson.gz', 'Países Natural Earth 1:50m', pa,
             lambda f: {'NOMBRE': texto(f.get('NAME_ES')) or texto(f.get('NAME')), 'ISO': texto(f.get('ISO_A3'))})


if __name__ == '__main__':
    main()
