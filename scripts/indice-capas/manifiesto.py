#!/usr/bin/env python3
"""Arma manifest.json, manifest.csv, reporte_clasificacion.md y el plan de copias de mapas/
a partir de la clasificación hecha en el nodo (clasificacion.json + empates.json) y del índice de
teselas. Sigue el Índice Maestro de Capas v1.4."""
import csv, json, os, re, sys, unicodedata, collections

S = sys.argv[1]
d = json.load(open(f'{S}/clasificacion.json'))
emp = json.load(open(f'{S}/empates.json'))
tes = json.load(open(f'{S}/indice-teselas.json'))
tes = {x['clave']: x for x in (tes['rasters'] if isinstance(tes, dict) else tes)}
CAPAS = {int(k): v for k, v in d['capas'].items()}
FILTROS = {int(k): v for k, v in d['filtros'].items()}
GEOM = {int(k): v for k, v in d['geom'].items()}
LOTE = 'lote-1/INFORMACION ELECTRUM/'
MAX = 20000  # más rasgos que esto: teselas o no se pinta entera


def fold(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def slug(s):
    return fold(s).replace(' ', '_')[:60] or 'capa'


def caja(c):
    m = re.findall(r'-?[\d.]+(?:e-?\d+)?', (CAPAS.get(c) or {}).get('caja') or '')
    return [round(float(x), 6) for x in m] if len(m) == 4 else None


def union(cs):
    bs = [b for b in cs if b]
    return [min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs)] if bs else None


def geomtipo(c):
    g = GEOM.get(c, '') or ''
    for k, v in (('POLYGON', 'Polygon'), ('LINESTRING', 'LineString'), ('POINT', 'Point')):
        if k in g.upper():
            return v
    return g or None


# Los archivos que el nodo no empató por nombre, empatados por su extensión exacta.
MANUAL = {  # mismo contenido, otro nombre (confirmado por número de rasgos y carpeta)
    'Areas Amanda Buena Vista.kml': 278, 'Geologia Amanda Buena vista.kml': 282, 'Prospeccion inicial amanda buena vista.kml': 289,
}
for r in d['archivos']:
    if not r['capa']:
        e = emp.get(r['rel'])
        if e and e.get('igual'):
            r['capa'], r['empate'] = e['igual'][1], 'misma extensión y rasgos'
        elif os.path.basename(r['rel']) in MANUAL:
            r['capa'], r['empate'] = MANUAL[os.path.basename(r['rel'])], 'mismo contenido (nombre «Amanda»)'

capas = []  # el manifiesto
planos_copia = []  # (mapas/…, biblioteca/mapas/planos/…) en el cubo de expedientes
usadas = set()  # capas de la base ya referenciadas
copias = []  # (origen, destino) para la carpeta mapas/
cuarentena = []  # (archivo, motivo)
problemas = []
reporte_filas = []  # archivo original → id → ruta nueva


def entrada(**k):
    base = dict(id=None, nombre='', tipo='vector', padre=None, orden=0, formato_original=None, ruta=None, ruta_web=None,
                crs_original=None, geometria=None, num_entidades=None, visible_por_defecto=False, carga='bajo_demanda',
                filtros=[], archivos_origen=[], notas='', fuentes=[], caja=None)
    base.update(k)
    capas.append(base)
    return base


def grupo(i, nombre, padre, orden, notas=''):
    return entrada(id=i, nombre=nombre, tipo='grupo', padre=padre, orden=orden, carga=None, notas=notas)


def carpeta_de(i):
    b = str(i)[0]
    raiz = {'1': '1_informacion_gis', '2': '2_informacion_geologica', '3': '3_proyectos_indexa', '4': '4_historia_honduras', '8': '8_otros'}[b]
    return raiz


def filtros_de(cids, sintetico=None):
    fs = []
    if sintetico:
        fs.append(dict(campo=sintetico[0], etiqueta=sintetico[0].capitalize(), valores=sorted(set(sintetico[1]))))
    junt = collections.OrderedDict()
    for c in cids:
        for f in FILTROS.get(c, []):
            junt.setdefault(f['campo'], set()).update(f['valores'])
    for k, v in junt.items():
        # Los campos de estilo de Google Earth (relleno, trazo, opacidad) no son datos: no filtran nada.
        if re.match(r'^(fill|stroke|marker|icon|label|style|obs|otros|visibility|tessellate|extrude)', k, re.I):
            continue
        if 2 <= len(v) <= 40 and len(fs) < 5:
            fs.append(dict(campo=k, etiqueta=REPARA.get(k, k).replace('_', ' ').capitalize(), valores=sorted(v)))
    return fs


REPARA = {'Formaci\ufffdn': 'Formación', 'Litolog\ufffda': 'Litología', 'clasificac': 'Clasificación', 'concesiona': 'Concesionario',
          'regim_mane': 'Régimen de manejo', 'depto': 'Departamento', 'tene_ejid': 'Tenencia ejidal', 'tene_naci': 'Tenencia nacional',
          'plan_man': 'Plan de manejo', 'profundida': 'Profundidad', 'ph_n_': 'pH (nivel)', 'highway': 'Tipo de vía', 'lanes': 'Carriles'}


def capa_archivos(i, nombre, padre, orden, archivos, sintetico_campo=None, notas=''):
    """Una capa del índice hecha de uno o más archivos (cada uno, una capa de la base)."""
    fuentes, origen, cids, valores = [], [], [], []
    ruta_dir = None
    for r in archivos:
        if not r.get('capa'):
            continue
        prop = {}
        if sintetico_campo:
            v = (r.get('extra') or [None, None])[1] if r.get('extra') else None
            v = v or r['nombre']
            v = v.title() if sintetico_campo == 'mineral' else v
            prop[sintetico_campo] = v
            valores.append(v)
        fuentes.append(dict(capa=r['capa'], propiedades=prop))
        cids.append(r['capa'])
        usadas.add(r['capa'])
        origen.append(os.path.basename(r['rel']))
    if not fuentes:
        return entrada(id=i, nombre=nombre, padre=padre, orden=orden, notas=(notas + ' Sin archivo en el lote.').strip())
    n = sum(CAPAS[c]['n'] for c in set(cids))
    sub = f"{carpeta_de(i)}/{i // 1000 * 1000}_{slug(CAPAS_NOMBRE.get(i // 1000 * 1000, nombre))}/{i}_{slug(nombre)}"
    if i % 1000 == 1 and len([x for x in capas if x['padre'] == i // 1000 * 1000]) == 0 and len(archivos) == 1:
        sub = f"{carpeta_de(i)}/{i // 1000 * 1000}_{slug(CAPAS_NOMBRE.get(i // 1000 * 1000, nombre))}"
    primero = archivos[0]
    e = entrada(
        id=i, nombre=nombre, padre=padre, orden=orden,
        tipo='kml' if primero['ext'] in ('kml', 'kmz') and len(archivos) == 1 else 'vector',
        formato_original=','.join(sorted({r['ext'].upper() for r in archivos})),
        ruta=f"{sub}/{i}_{slug(nombre)}.{primero['ext']}" if len(archivos) == 1 else f"{sub}/",
        ruta_web=f"/api/electrum/mapa/indice/capa/{i}",
        crs_original=','.join(sorted({r['crs'] or 'desconocido' for r in archivos})),
        geometria=geomtipo(cids[0]), num_entidades=n,
        filtros=filtros_de(sorted(set(cids)), (sintetico_campo, valores) if sintetico_campo else None),
        archivos_origen=origen, fuentes=fuentes, caja=union([caja(c) for c in cids]), notas=notas,
    )
    for r in archivos:
        destino_base = f"mapas/{sub}/{i}_{slug(nombre if len(archivos) == 1 else r['nombre'])}"
        for rel in [r['rel']] + r.get('hermanos', []):
            ext = os.path.splitext(rel)[1].lower()
            copias.append((LOTE + rel, destino_base + ext))
        reporte_filas.append((r['rel'], i, destino_base + '.' + r['ext']))
        if r.get('faltan'):
            problemas.append(f"`{r['rel']}`: shapefile incompleto, faltan {', '.join(r['faltan'])}.")
        if not r.get('crs'):
            problemas.append(f"`{r['rel']}`: el .prj no trae código EPSG (CRS sin identificar por código; la carga lo leyó del .prj).")
    if n > MAX:
        e['notas'] = (e['notas'] + f' {n} rasgos: pesada, con zoom mínimo.').strip()
    return e


CAPAS_NOMBRE = {}

A = d['archivos']
por = collections.defaultdict(list)
vistos_huella, vistos_capa = {}, {}
for r in sorted(A, key=lambda r: (len(r['rel']), r['rel'])):
    if r['rel'].endswith('ZONAS INDEXSA CON ANOTACION PROVISIONAL.shp'):
        reporte_filas.append((r['rel'], 107008, 'mapas/1_informacion_gis/107000_informacion_de_concesiones_indexa/107008_zonas_indexa/107008_zonas_indexa_con_anotacion_provisional.shp'))
        for rel in [r['rel']] + r['hermanos']:
            copias.append((LOTE + rel, '1_informacion_gis/107000_informacion_de_concesiones_indexa/107008_zonas_indexa/107008_zonas_indexa_con_anotacion_provisional' + os.path.splitext(rel)[1].lower()))
        continue  # entró como cartera de concesiones: va en 107008 por su cartera
    cargada = r.get('capa') and (CAPAS.get(r['capa']) or {}).get('n')
    if not cargada and (not r['n'] or not r['ok']):
        cuarentena.append((r['rel'], 'vacío o ilegible: ' + ('sin entidades' if r['ok'] else r['error'][:80])))
        continue
    if cargada and not r['ok']:
        problemas.append(f"`{r['rel']}`: ogrinfo no lo abre en la copia de trabajo ({r['error'][:60]}), pero el cargador sí lo leyó: {CAPAS[r['capa']]['n']} rasgos en la base.")
    if r['huella'] in vistos_huella:
        cuarentena.append((r['rel'], f"duplicado exacto de `{vistos_huella[r['huella']]}`"))
        continue
    if not r.get('capa'):
        cuarentena.append((r['rel'], 'no entró al cerebro: el cargador no encontró geometría usable'))
        continue
    if r.get('capa') and r['capa'] in vistos_capa and r['cat'] >= 300:
        cuarentena.append((r['rel'], f"mismo contenido que `{vistos_capa[r['capa']]}`"))
        continue
    vistos_huella[r['huella']] = r['rel']
    if r.get('capa'):
        vistos_capa.setdefault(r['capa'], r['rel'])
    por[(r['cat'], r['sub'])].append(r)

# ---------------------------------------------------------------- bloque 0
entrada(id=1, nombre='Perímetro de Honduras', tipo='vector', orden=0, visible_por_defecto=True, carga='inicial',
        ruta_web='/api/electrum/mapa/perimetro', geometria='Polygon', num_entidades=1,
        fuentes=[dict(perimetro=True)], formato_original='GeoJSON',
        notas='Disolución de 105001 Departamentos. Única capa visible al abrir; no se apaga.', caja=[-89.36, 12.98, -83.13, 16.52])

# ---------------------------------------------------------------- bloque 1
grupo(100000, '1 Información GIS', None, 1)
G1 = [
    (101000, 'Áreas protegidas'), (102000, 'Buffer de carreteras primarias'), (103000, 'Curvas de nivel'),
    (104000, 'Derechos mineros de Honduras'), (105000, 'División política de Honduras'), (106000, 'Hojas cartográficas'),
    (107000, 'Información de concesiones Indexa'), (108000, 'Microcuencas declaradas (WGS 84)'), (109000, 'Patrimonio público forestal'),
    (110000, 'Recursos mineros de Honduras (WGS 84)'), (111000, 'Zonas informales'),
]
for k, (i, n) in enumerate(G1, 1):
    CAPAS_NOMBRE[i] = n
for k, (i, n) in enumerate(G1, 1):
    grupo(i, n, 100000, k)
    cat = i // 1000
    if i == 103000:
        t = tes.get('lote-1-curvas-de-nivel-20m-hn')
        entrada(id=103001, nombre='Curvas de nivel cada 20 m', tipo='vector', padre=i, orden=1, formato_original='SHP',
                ruta='1_informacion_gis/103000_curvas_de_nivel/103001_curvas_de_nivel.shp', ruta_web='teselas:lote-1-curvas-de-nivel-20m-hn',
                crs_original='EPSG:4326', geometria='LineString', archivos_origen=['CURVAS DE NIVEL 20m HN.shp'],
                fuentes=[dict(tesela='lote-1-curvas-de-nivel-20m-hn')], caja=t and t.get('encuadre'),
                notas='2,4 GB: servida como teselas vectoriales (PMTiles), se ve de cerca.')
        for ext in ('.shp', '.shx', '.dbf', '.prj', '.qmd'):
            copias.append((LOTE + '1. INFORMACION GIS/CURVAS DE NIVEL HN WGS84/CURVAS DE NIVEL 20m HN' + ext, '1_informacion_gis/103000_curvas_de_nivel/103001_curvas_de_nivel' + ext))
        reporte_filas.append(('1. INFORMACION GIS/CURVAS DE NIVEL HN WGS84/CURVAS DE NIVEL 20m HN.shp', 103001, 'mapas/1_informacion_gis/103000_curvas_de_nivel/103001_curvas_de_nivel.shp'))
        continue
    if i == 104000:
        rs = por.get((104, 1), [])
        e = entrada(id=104001, nombre='Derechos mineros (catastro INHGEOMIN, junio 2026)', padre=i, orden=1, formato_original='SHP',
                    ruta='1_informacion_gis/104000_derechos_mineros/104001_derechos_mineros.shp', ruta_web='/api/electrum/catastro.geojson',
                    crs_original='EPSG:26716 (NAD27 UTM 16N)', geometria='Polygon', num_entidades=1076,
                    archivos_origen=[os.path.basename(r['rel']) for r in rs], fuentes=[dict(catastro=True)],
                    filtros=[dict(campo=k, etiqueta=k.capitalize(), valores=v) for k, v in d['catastro'].items()],
                    caja=[-89.36, 12.98, -83.13, 16.52], notas='El catastro vigente: 1076 concesiones (base: tabla concesion).')
        for r in rs:
            for rel in [r['rel']] + r['hermanos']:
                copias.append((LOTE + rel, '1_informacion_gis/104000_derechos_mineros/104001_derechos_mineros' + os.path.splitext(rel)[1].lower()))
            reporte_filas.append((r['rel'], 104001, 'mapas/1_informacion_gis/104000_derechos_mineros/104001_derechos_mineros.shp'))
        continue
    if i == 105000:
        nombres = {1: 'Departamentos', 2: 'Municipios', 3: 'Caseríos', 4: 'Aldeas', 5: 'Red hídrica'}
        for s, nm in nombres.items():
            rs = por.get((105, s), [])
            if s in (3, 5):  # pesadas: teselas
                clave = 'referencia-caserios-hn' if s == 3 else 'referencia-rios-hn'
                r = rs[0] if rs else None
                e = capa_archivos(105000 + s, nm, i, s, rs)
                e.update(fuentes=[dict(tesela=clave)], ruta_web=f'teselas:{clave}', filtros=[],
                         notas=f"{e['num_entidades']} rasgos: servida como teselas vectoriales; se ve de cerca.")
                e['caja'] = (tes.get(clave) or {}).get('encuadre') or e['caja']
            else:
                capa_archivos(105000 + s, nm, i, s, rs)
        continue
    if i == 106000:
        for k2, h in enumerate(d['hojas'], 1):
            hid = 106000 + k2
            entrada(id=hid, nombre=f"Hoja {h['nombre']}", tipo='raster', padre=i, orden=k2, formato_original='GeoTIFF',
                    ruta=f"1_informacion_gis/106000_hojas_cartograficas/{hid}_hoja_{slug(h['nombre'])}.tif",
                    ruta_web='teselas:lote-1-hojas-cartograficas', crs_original=h['crs'], archivos_origen=[os.path.basename(h['rel'])],
                    fuentes=[dict(tesela='lote-1-hojas-cartograficas', caja=h['caja'])], caja=[round(x, 6) for x in h['caja']] if h['caja'] else None,
                    notas=f"Código de hoja {h['nombre']}. Mosaico en teselas; la hoja se encuadra en su extensión.")
            copias.append((LOTE + h['rel'], f"1_informacion_gis/106000_hojas_cartograficas/{hid}_hoja_{slug(h['nombre'])}.tif"))
            reporte_filas.append((h['rel'], hid, f"mapas/1_informacion_gis/106000_hojas_cartograficas/{hid}_hoja_{slug(h['nombre'])}.tif"))
        continue
    if i == 107000:
        nombres = {1: 'Buenavista', 2: 'Chaparro', 3: 'La Campana', 4: 'Escalera', 5: 'Pantaleona', 6: 'El Tajo', 7: 'Targets (blancos)', 8: 'Zonas Indexa'}
        for s, nm in nombres.items():
            rs = por.get((107, s), [])
            e = capa_archivos(107000 + s, nm, i, s, rs, 'archivo',
                              notas={5: 'Proyecto independiente.', 6: 'Proyecto independiente (no confundir con Pantaleona).',
                                     8: 'No está en el índice v1.4: las cuatro capas de zonas de Indexa de la carpeta de concesiones. Siguiente ID libre del grupo.'}.get(s, ''))
            if s == 8:  # la de anotación provisional entró como cartera de concesiones
                e['fuentes'].append(dict(cartera='ZONAS INDEXSA CON ANOTACION PROVISIONAL', propiedades={'archivo': 'ZONAS INDEXSA CON ANOTACION PROVISIONAL'}))
                for f in e['filtros']:
                    if f['campo'] == 'archivo' and 'ZONAS INDEXSA CON ANOTACION PROVISIONAL' not in f['valores']:
                        f['valores'] = sorted(f['valores'] + ['ZONAS INDEXSA CON ANOTACION PROVISIONAL'])
        continue
    if i == 110000:
        capa_archivos(110001, 'Depósitos minerales', i, 1, por.get((110, 1), []), 'mineral')
        capa_archivos(110002, 'Fichas seleccionadas (ocurrencia minera)', i, 2, por.get((110, 2), []), 'mineral')
        capa_archivos(110003, 'Fichas de ocurrencia minera', i, 3, por.get((110, 3), []), notas='No está en el índice v1.4: archivo suelto en RECURSOS WGS84. Siguiente ID libre del grupo.')
        capa_archivos(110004, 'Yacimientos y ocurrencias mineras', i, 4, por.get((110, 4), []), notas='No está en el índice v1.4: archivo suelto en RECURSOS WGS84. Siguiente ID libre del grupo.')
        continue
    capa_archivos(i + 1, n, i, 1, por.get((cat, 1), []))

# ---------------------------------------------------------------- bloque 2
grupo(200000, '2 Información geológica', None, 2)
G2 = [(201, 'Estructural 2', ''), (202, 'Estructural', ''), (203, 'Fallas geológicas (centroamericanas)', ''), (204, 'Geológico de Olancho', '1:100,000'),
      (205, 'Geológicos', ''), (206, 'Mapa estructural', '1:50,000'), (207, 'Mapa geotectónico', ''), (208, 'Mapa metalogenético', ''),
      (209, 'Mapa geológico', '1:500,000'), (210, 'Suelos Simmons', '')]
for k, (c, n, esc) in enumerate(G2, 1):
    CAPAS_NOMBRE[c * 1000] = n + (f' {esc}' if esc else '')
    grupo(c * 1000, n + (f' ({esc})' if esc else ''), 200000, k)
    e = capa_archivos(c * 1000 + 1, n + (f' {esc}' if esc else ''), c * 1000, 1, por.get((c, 1), []),
                      notas='Escala 1:500,000 por el nombre del archivo; confirmar.' if c == 209 else ('Clasificación de suelos de Simmons (SHP).' if c == 210 else ''))
    if e.get('num_entidades') and e['num_entidades'] > MAX and c == 206:
        e.update(fuentes=[dict(tesela='referencia-fallas-1-50000')], ruta_web='teselas:referencia-fallas-1-50000', filtros=[])

# ---------------------------------------------------------------- bloque 3
grupo(300000, '3 Proyectos Indexa (planos)', None, 3)
PROY = [(301, 'Pantaleona'), (302, 'Buenavista Monarca'), (303, 'Cimarrón'), (304, 'Minas de Oro')]
for k, (c, n) in enumerate(PROY, 1):
    CAPAS_NOMBRE[c * 1000] = n
    grupo(c * 1000, n, 300000, k)
    sub = 0
    rs = sorted(por.get((c, None), []), key=lambda r: r['rel'])
    for r in rs:
        sub += 1
        capa_archivos(c * 1000 + sub, r['nombre'], c * 1000, sub, [r], notas=f"Ruta original: {r['rel']}")
    if c == 304:  # la hoja 1620c, georreferenciada
        sub += 1
        t = tes.get('lote-1-1620c-wgs84') or {}
        entrada(id=c * 1000 + sub, nombre='Hoja 1620c (Minas de Oro)', tipo='raster', padre=c * 1000, orden=sub, formato_original='MrSID',
                ruta=f'3_proyectos_indexa/304000_minas_de_oro/{c * 1000 + sub}_hoja_1620c.sid', ruta_web='teselas:lote-1-1620c-wgs84',
                crs_original='EPSG:4326', archivos_origen=['1620c_wgs84.sid'], fuentes=[dict(tesela='lote-1-1620c-wgs84')], caja=t.get('encuadre'),
                notas='Plano georreferenciado: se dibuja en el mapa (teselas).')
        copias.append((LOTE + '5. PROYECTOS INDEXSA/4 MINAS DE ORO AURA/MINAS DE ORO/shp_Minas de Oro/1620c_wgs84.sid', f'3_proyectos_indexa/304000_minas_de_oro/{c * 1000 + sub}_hoja_1620c.sid'))
    for pl in [p for p in d['planos'] if p['proyecto'] == c]:
        if not re.search(r'plano|mapa|ubicacion|perfil|seccion|poligono', fold(pl['nombre']) + ' ' + fold(os.path.dirname(pl['rel']).split('/')[-1])) or re.search(r'escritura|rtn|eia', fold(pl['nombre'])):
            continue
        sub += 1
        pid = c * 1000 + sub
        destino = f"3_proyectos_indexa/{c * 1000}_{slug(n)}/{pid}_{slug(pl['nombre'])}.{pl['ext']}"
        entrada(id=pid, nombre=pl['nombre'], tipo='documento', padre=c * 1000, orden=sub, formato_original=pl['ext'].upper(), ruta=destino,
                ruta_web=f"/api/electrum/mapa/plano/{pid}", carga=None,
                archivos_origen=[os.path.basename(pl['rel'])], fuentes=[dict(plano=f"biblioteca/mapas/planos/{pid}.{pl['ext']}", documento=pl.get('documento'))],
                notas='Plano sin georreferencia: se abre en el visor.' + (f" Su texto está en el cerebro (documento {pl['documento']})." if pl.get('documento') else '') + f" Ruta original: {pl['rel']}")
        planos_copia.append(('mapas/' + destino, f"biblioteca/mapas/planos/{pid}.{pl['ext']}"))
        copias.append((LOTE + pl['rel'], destino))
        reporte_filas.append((pl['rel'], pid, 'mapas/' + destino))

# ---------------------------------------------------------------- bloque 4
grupo(400000, '4 Historia de Honduras', None, 4)
grupo(401000, 'Historia de Honduras', 400000, 1, notas='La carpeta «6. HISTORIA DE LA MINERIA EN HONDURAS» solo trae un LEEME: no hay planos históricos en el lote. Se agregan aquí los mapas históricos de JICA (1978-2003) ya georreferenciados.')
hist = 0
for clave in ('jica-olancho-geologico', 'jica-olancho-estructural', 'jica-olancho-anomalias-cu', 'jica-olancho-anomalias-zn'):
    t = tes.get(clave)
    if not t:
        continue
    hist += 1
    entrada(id=401000 + hist, nombre=t['nombre'], tipo='raster', padre=401000, orden=hist, formato_original='GeoTIFF (escaneo JICA)',
            ruta_web=f'teselas:{clave}', fuentes=[dict(tesela=clave)], caja=t.get('encuadre'), notas=f"Mapa escaneado y georreferenciado. {t.get('fuente') or ''}".strip())
hist += 1
entrada(id=401000 + hist, nombre='Muestras geoquímicas JICA (Fases I–III)', tipo='vector', padre=401000, orden=hist, ruta_web='/api/electrum/mapa/muestras',
        fuentes=[dict(muestras=True)], geometria='Point', notas='Rocas, sedimentos y minerales con leyes de laboratorio; se colorean por elemento.',
        filtros=[dict(campo='elemento', etiqueta='Elemento', valores=['au', 'ag', 'cu', 'pb', 'zn'])])
for c in sorted(CAPAS):
    if CAPAS[c]['rol'] == 'historico' and CAPAS[c]['n'] and c not in usadas:
        hist += 1
        usadas.add(c)
        entrada(id=401000 + hist, nombre=CAPAS[c]['nombre'], padre=401000, orden=hist, ruta_web=f'/api/electrum/mapa/indice/capa/{401000 + hist}',
                fuentes=[dict(capa=c, propiedades={})], num_entidades=CAPAS[c]['n'], geometria=geomtipo(c), caja=caja(c),
                filtros=filtros_de([c]), notas=f"Capa histórica (rol histórico). Carpeta: {CAPAS[c]['carpeta']}")

# ---------------------------------------------------------------- bloque 8: todo lo demás que está cargado
grupo(800000, '8 Otros', None, 8, notas='SHP/KML/KMZ válidos que no encajan en el índice. Se cargan igual; ver la sugerencia en notas.')
SUG = {'litologia': '2 Información geológica', 'falla': '2 Información geológica', 'placa': '2 Información geológica', 'provincia_geologica': '2 Información geológica',
       'tracto_permisivo': '2 Información geológica', 'ocurrencia': '110000 Recursos mineros', 'proyecto': '3 Proyectos Indexa', 'area_protegida': '101000 Áreas protegidas',
       'microcuenca': '108000 Microcuencas', 'forestal': '109000 Patrimonio forestal', 'zona_informal': '111000 Zonas informales', 'rio': '105005 Red hídrica',
       'poblado': '105000 División política', 'carretera': '102000 Buffer de carreteras', 'municipio': '105002 Municipios', 'departamento': '105001 Departamentos'}
otros = [c for c in CAPAS if CAPAS[c]['n'] and c not in usadas]
for k, c in enumerate(sorted(otros, key=lambda c: fold(CAPAS[c]['nombre'])), 1):
    x = CAPAS[c]
    sug = SUG.get(x['rol'], '')
    if 'proyectos indexsa/1 pantaleona' in fold(x['carpeta']): sug = '301000 Pantaleona'
    elif 'buena vista' in fold(x['carpeta']): sug = '302000 Buenavista Monarca'
    elif 'cimarron' in fold(x['carpeta']) or 'chaparro' in fold(x['nombre']): sug = '303000 Cimarrón'
    elif 'minas de oro' in fold(x['carpeta']): sug = '304000 Minas de Oro'
    elif 'geologicas municipios' in fold(x['carpeta']): sug = '2 Información geológica (mapas geológicos por municipio)'
    tes_ = None
    entrada(id=800000 + k, nombre=x['nombre'], padre=800000, orden=k, ruta=f"8_otros/{800000 + k}_{slug(x['nombre'])}/",
            ruta_web=f'/api/electrum/mapa/indice/capa/{800000 + k}', fuentes=[dict(capa=c, propiedades={})], num_entidades=x['n'],
            geometria=geomtipo(c), caja=caja(c), filtros=filtros_de([c]),
            notas=f"Ruta original: {x['carpeta'] or '(sin carpeta)'}." + (f' Sugerencia: {sug}.' if sug else '') + (f" {x['n']} rasgos: pesada." if x['n'] > MAX else ''))
    usadas.add(c)
k0 = len(otros)
for t in ('s2-arc', 's2-fe', 's2-veg'):
    if t in tes:
        k0 += 1
        entrada(id=800000 + k0, nombre=tes[t]['nombre'], tipo='raster', padre=800000, orden=k0, ruta_web=f'teselas:{t}', fuentes=[dict(tesela=t)],
                caja=tes[t].get('encuadre'), notas='Calculada de Sentinel-2 (no es un archivo del lote). Sugerencia: análisis satelital.')

# ---------------------------------------------------------------- bloque 9
grupo(900000, '9 Cuarentena', None, 9, notas='No se carga al mapa. Revisión humana.')

# ---------------------------------------------------------------- salida
M = dict(version='1.4', crs_salida='EPSG:4326', generado='2026-10-10', capas=capas,
         cuarentena=[dict(archivo=a, motivo=m) for a, m in cuarentena])
json.dump(M, open(f'{S}/manifest.json', 'w'), ensure_ascii=False, indent=1)
with open(f'{S}/manifest.csv', 'w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['id', 'nombre', 'tipo', 'padre', 'orden', 'formato_original', 'ruta', 'crs_original', 'geometria', 'num_entidades', 'archivos_origen', 'notas'])
    for c in capas:
        w.writerow([f"{c['id']:06d}", c['nombre'], c['tipo'], f"{c['padre']:06d}" if c['padre'] else '', c['orden'], c['formato_original'] or '', c['ruta'] or '',
                    c['crs_original'] or '', c['geometria'] or '', c['num_entidades'] if c['num_entidades'] is not None else '', '; '.join(c['archivos_origen']), c['notas']])
for a, _ in cuarentena:
    copias.append((LOTE + a, '9_cuarentena/' + a.replace('/', '__')))
with open(f'{S}/planos.tsv', 'w') as fh:
    for a, b in planos_copia:
        fh.write(f'{a}\t{b}\n')
with open(f'{S}/copias.tsv', 'w') as fh:
    for a, b in copias:
        fh.write(f"{a}\t{b if b.startswith('mapas/') else 'mapas/' + b}\n")

hojas = [c for c in capas if 106000 < c['id'] < 107000]
vect = [c for c in capas if c['tipo'] in ('vector', 'kml', 'raster')]
falt = [c for c in capas if c['tipo'] not in ('grupo', 'documento') and not c['fuentes']]
recib = len(A) + len(d['hojas']) + 2
en_indice = len([r for r in reporte_filas if r[1] < 800000])
en_otros = len([c for c in capas if 800000 < c['id'] < 900000])
L = [f"# Reporte de clasificación — Índice Maestro de Capas v1.4", '', 'Generado el 10 de octubre de 2026 a partir del lote-1 (s3://electrum-lotes-548380372606/lote-1) y de lo ya cargado en el cerebro.', '',
     '## Totales', '',
     f'- Archivos GIS recibidos (SHP/KML/KMZ, incluidos los que venían dentro de .zip/.rar, más rásteres GeoTIFF/MrSID): **{recib}**',
     f'- Clasificados en el índice: **{en_indice}** (más {len([c for c in capas if c["tipo"] == "documento"])} planos como documento)',
     f'- Capas en Otros (8xxxxx): **{en_otros}** (capas válidas ya cargadas que no encajan en el índice, más los 3 cálculos Sentinel-2)',
     f'- En cuarentena (9xxxxx): **{len(cuarentena)}**',
     f'- Capas del manifiesto que se pueden encender: **{len([c for c in vect if c["fuentes"]])}**', '',
     '## Capas en Otros, con la categoría sugerida', '', '| ID | Capa | Rasgos | Sugerencia / ruta original |', '|---|---|---|---|']
for c in capas:
    if 800000 < c['id'] < 900000:
        L.append(f"| {c['id']:06d} | {c['nombre']} | {c['num_entidades'] or ''} | {c['notas']} |")
L += ['', '## Archivo original → ID → ruta nueva', '', '| Archivo original | ID | Ruta nueva |', '|---|---|---|']
for a, i, b in sorted(reporte_filas, key=lambda x: x[1]):
    L.append(f'| `{a}` | {i:06d} | `{b}` |')
L += ['', '## Cuarentena', '', '| Archivo | Motivo |', '|---|---|'] + [f'| `{a}` | {m} |' for a, m in cuarentena]
L += ['', '## Capas faltantes del índice', '']
L += [f"- {c['id']:06d} {c['nombre']}: {c['notas']}" for c in falt] or ['- Ninguna categoría del índice quedó sin archivo, salvo lo indicado abajo.']
L += [f"- 401000 Historia de Honduras: {capas[[c['id'] for c in capas].index(401000)]['notas']}",
      '- FON: no apareció ningún archivo FON en el lote.']
L += ['', '## Problemas encontrados', ''] + [f'- {p}' for p in sorted(set(problemas))] + [
    '- Varias capas venían en NAD27 UTM 16N (EPSG:26716): se pasaron a WGS 84 con el corrimiento de NAD27 para Centroamérica al cargarlas.',
    '- 3 polígonos de PANTALEONA+TERRENOS venían con el lindero cruzado: uno se reparó y dos sin superficie no entraron.',
    '- Los KMZ de terrenos (Pantaleona, Chaparro, Escalera-Guayabal, Tajo) se perdían al cargar (MultiGeometry); se arregló el cargador y se recargaron.']
L += ['', '## Puntos pendientes de confirmar', '',
      f'- Listado de hojas cartográficas: se encontraron {len(hojas)} hojas GeoTIFF ({", ".join(h["nombre"].replace("Hoja ", "") for h in hojas)}). La 1637 solo viene en PDF (sin GeoTIFF) y la 1620c en MrSID dentro de Minas de Oro (304).',
      '- Escala del mapa geológico 209000: el archivo dice «1-500000»; se dejó 1:500,000 por el nombre.',
      '- 107008 Zonas Indexa y 110003/110004: no estaban en el índice; se les dio el siguiente ID libre de su grupo.',
      '- 401000 Historia: se ubicaron ahí los mapas históricos de JICA (1978-2003) y sus muestras; confirmar si va así.', '',
      '## Filtros por capa', '', '| ID | Capa | Campo | Valores |', '|---|---|---|---|']
for c in capas:
    for f in c['filtros']:
        L.append(f"| {c['id']:06d} | {c['nombre']} | {f['campo']} | {', '.join(map(str, f['valores']))} |")
open(f'{S}/reporte_clasificacion.md', 'w').write('\n'.join(L) + '\n')
print('capas', len(capas), 'copias', len(copias), 'cuarentena', len(cuarentena), 'otros', en_otros, 'faltan', [c['id'] for c in falt])
