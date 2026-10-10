#!/usr/bin/env python3
"""Instrucciones de corrección v1.0 sobre el manifiesto del Índice Maestro v1.4.

No rehace la clasificación (los IDs ya publicados no cambian): toma el manifest.json publicado y le
agrega lo que pide el documento de correcciones.

  1. `estilo` por capa, con este orden de prioridad: el estilo del propio KML/KMZ (relleno, borde e
     íconos de cada Placemark, ya convertidos de aabbggrr a #rrggbb al cargarlos), un archivo de
     estilo junto al Shape, un campo de color de la tabla y, al final, la paleta estándar
     (por mineral en las capas de recursos; por unidad o tipo en geología y suelos).
  2. `alias` en todas las capas: cómo las nombra la gente.
  3. Las entradas del índice que no tienen archivo quedan igual en el árbol, con `sin_datos`.
  4. Los archivos de los proyectos Indexa que estaban en Otros (8xxxxx) pasan a su proyecto
     (301000–304000) con un ID nuevo; el viejo queda retirado en `id_anterior` y en `retirados`.

Uso: python3 correcciones.py <dir>   (lee de <dir>: manifest.json —el v1.4 publicado—,
atributos.json, kmlestilos.json, iconos.json, leyendas.json y capa-ext.txt; escribe
manifest.json v1.5 en <dir>/salida/ y correcciones.json con lo que va al reporte).
"""
import colorsys, collections, copy, json, os, re, sys, unicodedata

S = sys.argv[1]
M = json.load(open(f'{S}/manifest.json'))
A = json.load(open(f'{S}/atributos.json'))        # capa de la base → campo → {nd, total, vals}
K = json.load(open(f'{S}/kmlestilos.json'))       # capa → combinaciones de relleno/borde/ícono
ICO = json.load(open(f'{S}/iconos.json'))         # capa → ícono del KMZ → color dominante
LEY = json.load(open(f'{S}/leyendas.json'))       # capa → color → etiqueta sacada de la tabla del KML
EXT = dict(l.split('|', 1) for l in open(f'{S}/capa-ext.txt').read().split() if '|' in l)
assert M['version'] == '1.4', 'se corrige el manifiesto v1.4 publicado'
M = copy.deepcopy(M)
CAPAS = M['capas']
POR = {c['id']: c for c in CAPAS}
R = collections.defaultdict(list)  # lo que va al reporte


def fold(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def capas_base(e):
    return [f['capa'] for f in e.get('fuentes') or [] if 'capa' in f]


# ============================================================== 4. reclasificación de proyectos
# Por nombre (archivo, carpeta de origen o nombre de la capa) y, para los dudosos, por ubicación.
PROYECTO = {301000: 'Pantaleona', 302000: 'Buenavista Monarca', 303000: 'Cimarrón', 304000: 'Minas de Oro'}
MOVER = {
    301000: [800120, 800135],                      # Pantaleona; Terreno Planta El Teniente (carpeta AMBIENTAL/EL TENIENTE de Pantaleona)
    302000: [800008, 800113, 800114],              # Buena Vista-Monarka, MONARKA I y II
    303000: [800010, 800012, 800013, 800018, 800050, 800139],  # Campana, Chaparro, Cimarrón, Escalera y Piedra Dorada, estructuras y videos de El Chaparro
    304000: [800009, 800030, 800099, 800103, 800104, 800105, 800106, 800107, 800115, 800116, 800117, 800118, 800126],
}
MOTIVO = {
    800120: 'nombre «Pantaleona»', 800135: 'nombre «El Teniente» (Pantaleona/AMBIENTAL/EL TENIENTE)',
    800008: 'nombre «Buena Vista-Monarka»', 800113: 'nombre «Monarka»', 800114: 'nombre «Monarka»',
    800010: 'nombre «Campana» (concesión de Cimarrón, junto a 107003)', 800012: 'nombre «Chaparro»', 800013: 'nombre «Cimarron»',
    800018: 'nombre «Escalera y Piedra Dorada» (Cimarrón, junto a 107004)', 800050: 'carpeta 3 CIMARRON/2 EL CHAPARRO',
    800139: 'nombre «El Chaparro» (videos de campo)', 800009: 'carpeta MINAS DE ORO/shp_Minas de Oro', 800030: 'nombre «Minas de Oro»',
    800099: 'carpeta MINAS DE ORO/shp_Minas de Oro', 800103: 'nombre «Minas de Oro I»', 800104: 'nombre «Minas de Oro II»',
    800105: 'nombre «Minas de Oro III»', 800106: 'nombre «Minas de Oro IV»', 800107: 'nombre «Minas de Oro V»',
    800115: 'Montecielo (carpeta MINAS DE ORO/11 Finca Montecielo) y ubicación junto a Minas de Oro I–V',
    800116: 'Montecielo y ubicación junto a Minas de Oro I–V', 800117: 'Montecielo y ubicación junto a Minas de Oro I–V',
    800118: 'Montecielo y ubicación junto a Minas de Oro I–V', 800126: 'carpeta Geologicas Municipios/Minas de Oro; cae dentro de Montecielo',
}
DUDOSOS = {
    800011: 'Cerro Rico', 800014: 'Cortinas', 800017: 'El Blanco', 800083: 'La Cortina I', 800084: 'La Cortina II', 800085: 'La Cortina III',
    800086: 'La Cortina IV', 800087: 'La Cortina V', 800095: 'La Roca', 800096: 'LA ROCA I', 800097: 'LA ROKA II', 800132: 'San Judas',
    800143: 'Zona Beta',
}
for i, n in DUDOSOS.items():
    R['dudosos'].append((i, n, 'Concesión de «Catastro minero/Proyectos y concesiones» en el bloque Pantaleona–Cimarrón (13.22–13.34 N): cae dentro de la extensión de 107005 Pantaleona y pegada a Chaparro, La Campana y Escalera (Cimarrón). El nombre no dice de cuál es: se deja en Otros.'))
R['dudosos'].append((800134, 'Tajo', 'Mismo polígono que 107006 El Tajo, que el índice marca como proyecto independiente (ni Pantaleona ni Cimarrón): se deja en Otros.'))
for i in (800001, 800002, 800006, 800007, 800029, 800034, 800035, 800053, 800054, 800089, 800090, 800091, 800092, 800093, 800101, 800108, 800109, 800110, 800111, 800112, 800121, 800122, 800123, 800127, 800128, 800129, 800144):
    R['dudosos'].append((i, POR[i]['nombre'], 'Proyecto La Lola (Olancho): no es ninguno de los cuatro proyectos del índice; se deja en Otros.'))


def subgrupo(e):
    if e['tipo'] == 'documento':
        return 'Planos'
    if e['tipo'] == 'raster':
        return 'Imágenes'
    exts = {EXT.get(str(c), '?').lower() for c in capas_base(e)}
    fo = (e.get('formato_original') or '').lower()
    if exts & {'kml', 'kmz'} or 'km' in fo:
        return 'KML'
    if exts & {'csv', 'mp4', 'mov'} or 'video' in fold(e['nombre']):
        return 'Datos de campo'
    return 'Shape'


retirados = []
for pid, ids in MOVER.items():
    usados = [c['id'] for c in CAPAS if c['padre'] == pid]
    sig = max(usados, default=pid) + 1
    orden = max([c['orden'] for c in CAPAS if c['padre'] == pid], default=0) + 1
    for viejo in ids:
        e = POR.pop(viejo)
        nuevo = sig
        sig += 1
        assert nuevo not in POR and nuevo < pid + 1000
        ext = EXT.get(str(capas_base(e)[0]), '?') if capas_base(e) else '?'
        e.update(id=nuevo, padre=pid, orden=orden, id_anterior=viejo, ruta_web=f'/api/electrum/mapa/indice/capa/{nuevo}',
                 ruta=f"3_proyectos_indexa/{pid}_{fold(PROYECTO[pid]).replace(' ', '_')}/{nuevo}_{fold(e['nombre']).replace(' ', '_')[:60]}/",
                 formato_original=e.get('formato_original') or (ext.upper() if ext != '?' else 'SHP (carga del catastro anterior)'),
                 notas=(e['notas'].split(' Sugerencia:')[0] + f' Reclasificada desde Otros ({viejo:06d}, ID retirado) por {MOTIVO[viejo]}.').strip())
        orden += 1
        POR[nuevo] = e
        retirados.append(dict(id=viejo, ahora=nuevo, nombre=e['nombre']))
        R['reclasificacion'].append((e['archivos_origen'] or [e['nombre']], viejo, nuevo, PROYECTO[pid], MOTIVO[viejo]))
for c in CAPAS:
    if c.get('padre') and 300000 < c['padre'] < 400000:
        c['subgrupo'] = subgrupo(c)
M['retirados'] = retirados

# ============================================================== 3. todo el índice en el árbol
INDICE = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../tests/fixtures/indice-v1.4.json')))
for x in INDICE['entradas']:
    if x['id'] not in POR:
        e = dict(id=x['id'], nombre=x['nombre'], tipo='grupo' if x['grupo'] else 'vector', padre=x['padre'], orden=x['orden'],
                 formato_original=None, ruta=None, ruta_web=None, crs_original=None, geometria=None, num_entidades=None,
                 visible_por_defecto=False, carga=None, filtros=[], archivos_origen=[], notas='Sin datos: no hay archivo en el lote.', fuentes=[], caja=None)
        POR[x['id']] = e
        R['faltaban'].append((x['id'], x['nombre'], 'no estaba en el manifiesto: se agregó como «Sin datos»'))
for e in POR.values():
    if e['tipo'] not in ('grupo', 'documento') and (not e.get('fuentes') or e.get('ruta_web') is None):
        e['sin_datos'] = True
        R['sin_datos'].append((e['id'], e['nombre']))
# Las que el documento no trae y se agregaron con el siguiente ID libre: se marcan, con el porqué.
for i in (107008, 110003, 110004):
    POR[i]['fuera_de_indice'] = True

# ============================================================== 1. estilos
PALETA_MINERAL = collections.OrderedDict([
    ('oro', '#FFD700'), ('plata', '#C0C0C0'), ('cobre', '#B87333'), ('plomo', '#5B6770'), ('zinc', '#7A9CC6'),
    ('hierro', '#8B2E16'), ('antimonio', '#8E44AD'), ('manganeso', '#4B0082'), ('niquel', '#2E8B57'),
    ('polimetalico', '#FF8C00'), ('sin dato', '#999999'),
    # No están en la tabla 2.2: colores propios que no usa ningún otro.
    ('mercurio', '#DC143C'), ('uranio', '#9ACD32'),
])
# No metálicos: el marrón claro de la tabla (#C2A878) para el primero y tonos de la misma familia
# para los demás, para que cada mineral quede con un color distinto.
NO_METALICOS = collections.OrderedDict([('caliza', '#C2A878'), ('yeso', '#D9C9A0'), ('bentonita', '#A88E62'), ('barita', '#B8A383'),
                                        ('arcilla', '#CBB48B'), ('bario', '#9E8A68'), ('marmol', '#E3D7B8'), ('puzolana', '#AD9670')])
# Minerales que no están en la tabla: colores que no usa ningún otro.
EXTRA_MINERAL = ['#9ACD32', '#DC143C', '#20B2AA', '#FF69B4', '#00CED1', '#D2691E', '#6B8E23', '#BA55D3', '#4682B4', '#F08080']
SINONIMO = {'au': 'oro', 'ag': 'plata', 'cu': 'cobre', 'pb': 'plomo', 'zn': 'zinc', 'fe': 'hierro', 'sb': 'antimonio', 'mn': 'manganeso',
            'ni': 'niquel', 'polimetalicos': 'polimetalico', 'polimetalica': 'polimetalico', 'varios': 'polimetalico', 'no definido': 'sin dato',
            'sin dato': 'sin dato', 'hg': 'mercurio', 'u': 'uranio', 'ba': 'bario', 'baritina': 'barita'}
extra_usados = {}


def primer_mineral(v):
    t = fold(v)
    if not t:
        return 'sin dato'
    t = SINONIMO.get(t, t)
    if t in PALETA_MINERAL or t in NO_METALICOS:
        return t
    p = [SINONIMO.get(fold(x), fold(x)) for x in re.split(r'[/,;]| y ', str(v)) if fold(x)]
    return p[0] if p else 'sin dato'


def color_mineral(v):
    m = primer_mineral(v)
    if m in PALETA_MINERAL:
        return m, PALETA_MINERAL[m]
    if m in NO_METALICOS:
        return m, NO_METALICOS[m]
    if m not in extra_usados:
        extra_usados[m] = EXTRA_MINERAL[len(extra_usados) % len(EXTRA_MINERAL)]
    return m, extra_usados[m]


def paleta_unidades(n):
    """n colores bien distintos y estables (ángulo áureo en HSL), sin el amarillo oro."""
    out, h = [], 0.07
    while len(out) < n:
        h = (h + 0.618033988749895) % 1
        if 0.12 < h < 0.17:  # el amarillo queda para el oro
            continue
        l = (0.52, 0.42, 0.62)[len(out) % 3]
        r, g, b = colorsys.hls_to_rgb(h, l, 0.62)
        out.append('#%02X%02X%02X' % (int(r * 255), int(g * 255), int(b * 255)))
    return out


ROL_COLOR = {101: '#2ECC71', 108: '#4DA3FF', 109: '#1B9E5A', 110: '#FFE066', 111: '#FF7A00'}
PALETA = ['#FFB020', '#5CC8FF', '#B891FF', '#7CFFB2', '#FF7A45', '#F2D16B', '#4DA3FF', '#FF4FD8', '#C9A0FF', '#2ECC71', '#E9D18B', '#FF6B6B']


def color_unico(e):
    c = e['id'] // 1000
    if e['id'] == 105001: return '#FFFFFF'
    if e['id'] == 105002: return '#E6EDF1'
    if c in ROL_COLOR: return ROL_COLOR[c]
    if 201 <= c <= 209 and 'line' in (e.get('geometria') or '').lower(): return '#FF4D4D'
    if c == 401: return '#B8A68A'
    return PALETA[e['id'] % len(PALETA)]


def icono_de(geom):
    g = (geom or '').lower()
    return 'circulo' if 'point' in g else 'linea' if 'line' in g else 'area'


GOOGLE = {'ylw-pushpin': '#F4EB37', 'blue-pushpin': '#4A89F3', 'red-pushpin': '#E43D3D', 'grn-pushpin': '#46B34B', 'wht-pushpin': '#FFFFFF',
          'caution': '#F9C02E', 'placemark_circle': None}


def color_icono(capa, icono):
    if not icono:
        return None
    base = os.path.basename(icono)
    c = (ICO.get(str(capa)) or {}).get(base)
    if c:
        return c.upper()
    for k, v in GOOGLE.items():
        if k in base:
            return v
    return None


def legible(t):
    t = str(t or '').strip()
    return t if t and not re.fullmatch(r'[\d.,\s-]+', t) and t.lower() not in ('none', 'null') else ''


def estilo_kml(e, caps):
    """El estilo de cada Placemark tal cual: relleno, borde e ícono. Leyenda: un renglón por color."""
    cats, iconos, sin_icono = collections.OrderedDict(), {}, []
    for cid in caps:
        ley = LEY.get(str(cid)) or {}
        etq, nom = ley.get('etiquetas') or {}, ley.get('nombres') or {}
        for x in K.get(str(cid)) or []:
            combo = '|'.join([x['fill'] or '', x['stroke'] or '', x['icon'] or ''])
            g = (x['g'] or '').upper()
            if 'POINT' in g:
                col = color_icono(cid, x['icon'])
                if x['icon'] and not col:
                    sin_icono.append(os.path.basename(x['icon']))
                if x['icon']:
                    iconos[os.path.basename(x['icon'])] = col
                col = col or (x['fill'] if x['fill'] and x['fill'] != '#000000' else None)
            elif 'LINE' in g:
                col = x['stroke'] or x['fill']
            else:
                transparente = x['fo'] in ('0', '0.0') or not x['fill']
                col = x['stroke'] if transparente else x['fill']
            col = (col or '').upper() or None
            etiqueta = legible(etq.get(combo)) or legible(nom.get(combo))
            clave = (col, etiqueta)
            if clave in cats:
                cats[clave]['n'] += x['n']
            else:
                cats[clave] = dict(valor=etiqueta, color=col, icono=icono_de(g), n=x['n'])
    # Íconos externos al KMZ que no vinieron: un color de la paleta, distinto, y se avisa.
    faltan = [k for k, v in iconos.items() if not v]
    for k, col in zip(faltan, paleta_unidades(len(faltan) + 3)[3:]):
        iconos[k] = col
    if faltan:
        R['iconos_faltantes'].append((e['id'], e['nombre'], len(faltan)))
    sin_color = [c for c in cats.values() if not c['color']]
    for c in sin_color:
        c['color'] = color_unico(e)
    lista = sorted(cats.values(), key=lambda c: -c['n'])
    k = 0
    for c in lista:
        if not c['valor']:
            k += 1
            c['valor'] = 'Estilo del archivo' if len(lista) == 1 else f'Estilo {k} del archivo'
    est = dict(fuente='kml', tipo='original', color=lista[0]['color'] if lista else color_unico(e),
               categorias=[dict(valor=c['valor'], color=c['color'], icono=c['icono']) for c in lista[:40]])
    if iconos:
        est['iconos'] = {k: v for k, v in iconos.items() if v}
    return est


def categorias_de(caps, campo, por_mineral):
    vals = collections.Counter()
    for cid in caps:
        for v, n in (A.get(str(cid), {}).get(campo) or {}).get('vals') or []:
            vals[v] += n
    return vals


def reparar(v):
    """«Ã¡» → «á»: texto UTF-8 leído como Latin-1 al cargar. El valor se deja tal cual (es lo que
    hay en los datos y contra eso se filtra); esto es solo la etiqueta que se lee."""
    try:
        r = str(v).encode('latin-1').decode('utf-8')
        return r if r != v else None
    except (UnicodeEncodeError, UnicodeDecodeError):
        return None


def estilo_categorizado(e, campo, valores, por_mineral, fuente='paleta', colores=None):
    cats = []
    if por_mineral:
        for v in valores:
            m, col = color_mineral(v)
            cats.append(dict(valor=v, color=col, icono=icono_de(e.get('geometria')), grupo=m.capitalize()))
            R['minerales'].append((e['id'], v, m, col))
    else:
        pal = paleta_unidades(len(valores))
        for v, col in zip(valores, pal):
            cats.append(dict(valor=v, color=(colores or {}).get(v) or col, icono=icono_de(e.get('geometria'))))
    for c in cats:
        if reparar(c['valor']):
            c['etiqueta'] = reparar(c['valor'])
    return dict(fuente=fuente, tipo='categorizado', campo=campo, categorias=cats, otro='#999999')


CAMPO_MINERAL = re.compile(r'^(mineral|MINERAL|Mineral|Deposito)$')
CAMPO_UNIDAD = ['Unidad', 'UNIDAD', 'UNIT', 'Unit', 'nombre_sue', 'lithology', 'LITHOLOGY', 'Lithology', 'Formaci�n', 'Formation',
                'Tipo', 'TIPO', 'Type', 'categoria', 'Categor�a', 'Zona', 'estado', 'Fase', 'Prioridad', 'TRACTO', 'NOMBRE']
FORZADO = {210001: 'nombre_sue', 101001: 'categoria', 108001: 'estado', 111001: 'Zona'}
# 304003 «Geologia» (SHP) es el mismo mapa que 304002 «Geologia Minas de Oro» (KMZ): sus unidades
# toman el color del KMZ (gana el estilo original del archivo).
MISMO_MAPA = {304003: 304002}

for e in sorted(POR.values(), key=lambda x: x['id']):
    if e['tipo'] in ('grupo', 'documento') or e.get('sin_datos'):
        continue
    caps = capas_base(e)
    fu = e.get('fuentes') or []
    if e['tipo'] == 'raster' or any(f.get('tesela') for f in fu) and not caps:
        if e['tipo'] == 'raster':
            e['estilo'] = dict(fuente='imagen', tipo='imagen')
        else:
            e['estilo'] = dict(fuente='paleta', tipo='unico', color=color_unico(e))
        R['fuente_estilo'].append((e['id'], e['nombre'], 'imagen original (ráster)' if e['tipo'] == 'raster' else 'paleta estándar (teselas vectoriales, un solo tipo de rasgo)'))
        continue
    if any(f.get('catastro') for f in fu):
        grupos = [('Otorgada', '#FFAE3B', ['Otorgada', 'Explotar', 'Explorar']), ('En trámite (solicitud)', '#5CC8FF', ['Solicitud', 'S-Explotar', 'S-Explorar']),
                  ('Delimitada', '#B891FF', ['Delimitada']), ('Suspendida', '#FF6B6B', ['Suspenso', 'Suspendida', 'Suspendido'])]
        e['estilo'] = dict(fuente='paleta', tipo='categorizado', campo='estado', otro='#C9D5DB',
                           categorias=[dict(valor=v, color=c, icono='area', grupo=g) for g, c, vs in grupos for v in vs])
        R['fuente_estilo'].append((e['id'], e['nombre'], 'paleta estándar por estado del trámite (la tabla del catastro no trae mineral: 1076 de 1076 vacíos)'))
        continue
    if any(f.get('muestras') for f in fu):
        e['estilo'] = dict(fuente='paleta', tipo='graduado', campo='elemento', color='#FFD700')
        R['fuente_estilo'].append((e['id'], e['nombre'], 'paleta estándar graduada por ley del elemento elegido'))
        continue
    if any(f.get('perimetro') for f in fu):
        e['estilo'] = dict(fuente='paleta', tipo='unico', color='#FFAE3B')
        continue
    sint = [f for f in e.get('filtros') or [] if f['campo'] in ('mineral',)]
    # Recursos: por mineral siempre que haya mineral (la tabla 2.2), aunque el KML traiga un solo estilo.
    if e['id'] in (110001, 110002) and sint:
        e['estilo'] = estilo_categorizado(e, 'mineral', sint[0]['valores'], True, fuente='paleta')
        R['fuente_estilo'].append((e['id'], e['nombre'], 'paleta estándar por mineral (2.2): el mineral sale del archivo de cada ficha (ORO.shp, PLATA.shp…); los SHP no traen color propio (SymbolID 0)'))
        continue
    if e['id'] == 110003:
        vals = list(categorias_de(caps, 'mineral', True))
        e['estilo'] = estilo_categorizado(e, 'mineral', sorted(vals), True)
        e['filtros'] = [dict(campo='mineral', etiqueta='Mineral', valores=sorted(vals))] + [f for f in e.get('filtros') or [] if f['campo'] != 'mineral']
        R['fuente_estilo'].append((e['id'], e['nombre'], 'paleta estándar por mineral. El KML original pinta las 166 fichas con un mismo ícono amarillo y no trae mineral: el mineral se tomó de la ficha seleccionada con el mismo número FOM (97 de 166); las otras 69 quedan «Sin dato». Conflicto anotado: se prefirió el color por mineral que pide la sección 2.2.'))
        continue
    campos = {k: v for cid in caps for k, v in (A.get(str(cid)) or {}).items()}
    total = max([v['total'] for v in campos.values()] or [0])
    # Mineral en la tabla: paleta por mineral.
    cm = next((k for k in campos if CAMPO_MINERAL.match(k) and 1 <= campos[k]['nd'] <= 60), None)
    if cm:
        vals = sorted(categorias_de(caps, cm, True))
        e['estilo'] = estilo_categorizado(e, cm, vals, True)
        if not any(f['campo'] == cm for f in e.get('filtros') or []):
            e['filtros'] = [dict(campo=cm, etiqueta='Mineral', valores=vals)] + (e.get('filtros') or [])
        R['fuente_estilo'].append((e['id'], e['nombre'], f'paleta estándar por mineral (campo «{cm}»)'))
        continue
    if e['id'] in MISMO_MAPA:
        otra = POR[MISMO_MAPA[e['id']]]
        kml = estilo_kml(otra, capas_base(otra))
        col = {c['valor']: c['color'] for c in kml['categorias']}
        vals = sorted(categorias_de(caps, 'Unidad', False))
        e['estilo'] = estilo_categorizado(e, 'Unidad', vals, False, fuente='kml', colores=col)
        e['estilo']['nota'] = f"Colores de {otra['id']:06d} {otra['nombre']} (KMZ del mismo mapa)."
        R['fuente_estilo'].append((e['id'], e['nombre'], f"KML: colores por unidad tomados de {otra['id']:06d} {otra['nombre']}, el KMZ del mismo mapa (el .lyr de ArcMap que acompaña al SHP es binario y no se puede leer)"))
        R['conflictos'].append((e['id'], f"SHP «Geologia» y KMZ «Geologia Minas de Oro» son el mismo mapa: se usaron los colores del KMZ, que es el estilo original."))
        continue
    if caps and all(str(c) in K for c in caps):
        e['estilo'] = estilo_kml(e, caps)
        R['fuente_estilo'].append((e['id'], e['nombre'], f"KML/KMZ: estilo de cada Placemark ({len(e['estilo']['categorias'])} {'color' if len(e['estilo']['categorias']) == 1 else 'colores'})"))
        continue
    cu = FORZADO.get(e['id']) or next((k for k in CAMPO_UNIDAD if k in campos and 2 <= campos[k]['nd'] <= 40 and campos[k]['total'] >= 0.5 * total), None)
    if cu:
        vals = sorted(categorias_de(caps, cu, False))
        e['estilo'] = estilo_categorizado(e, cu, vals, False)
        if not any(f['campo'] == cu for f in e.get('filtros') or []):
            e['filtros'] = (e.get('filtros') or []) + [dict(campo=cu, etiqueta=cu.replace('�', 'ó' if 'Formaci' in cu else 'í').capitalize(), valores=vals)]
        nota = ''
        if e['id'] == 210001:
            nota = ' El campo «color» de la tabla describe el color del suelo (40 % vacío), no la simbología: no se usó como color de mapa.'
        R['fuente_estilo'].append((e['id'], e['nombre'], f'paleta estándar por {"unidad" if cu in ("Unidad", "UNIDAD", "UNIT", "Unit", "nombre_sue") else "tipo"} (campo «{cu}»; el SHP no trae archivo de estilo ni campo de color){nota}'))
        continue
    e['estilo'] = dict(fuente='paleta', tipo='unico', color=color_unico(e))
    R['fuente_estilo'].append((e['id'], e['nombre'], 'paleta estándar, un solo color (la tabla no tiene un campo de categorías)'))

# Ningún filtro sin su color: los valores del campo del estilo llevan el suyo en el panel.

# ============================================================== 2. alias
BASE_ALIAS = {
    1: ['perímetro', 'contorno de honduras', 'frontera'],
    100000: ['información gis', 'capas gis', 'bloque 1'],
    900000: ['cuarentena', 'archivos en revisión'],
    101000: ['zonas protegidas', 'reservas', 'zonas de reserva', 'parques', 'parques nacionales', 'áreas protegidas'],
    102000: ['carreteras', 'carreteras primarias', 'vías', 'buffer de carreteras', 'franja de carreteras'],
    103000: ['curvas de nivel', 'curvas', 'topografía', 'relieve', 'altimetría'],
    104000: ['concesiones mineras', 'derechos', 'títulos mineros', 'catastro', 'catastro minero', 'concesiones', 'derechos mineros'],
    105000: ['mapa político', 'división política', 'límites', 'político'],
    105001: ['departamentos', 'límites departamentales'],
    105002: ['municipios', 'límites municipales', 'alcaldías'],
    105003: ['caseríos', 'poblados', 'comunidades', 'pueblos'],
    105004: ['aldeas'],
    105005: ['ríos', 'red hídrica', 'quebradas', 'hidrografía', 'drenajes'],
    106000: ['hojas cartográficas', 'hojas', 'cartas topográficas', 'mapas topográficos', 'hojas topográficas'],
    107000: ['concesiones indexa', 'concesiones de indexa', 'indexa', 'nuestras concesiones'],
    107007: ['targets', 'blancos', 'objetivos'],
    107008: ['zonas indexa', 'zonas de indexa'],
    108000: ['microcuencas', 'zonas de recarga', 'cuencas', 'microcuencas declaradas'],
    109000: ['reservas forestales', 'patrimonio forestal', 'bosque nacional', 'zonas de reserva', 'bosques', 'forestal'],
    110000: ['recursos mineros', 'recursos', 'minerales'],
    110001: ['depósitos', 'yacimientos', 'depósitos minerales'],
    110002: ['fichas de ocurrencia', 'fichas de ocurrencia minera', 'ocurrencias', 'fichas', 'fichas seleccionadas'],
    110003: ['todas las fichas de ocurrencia', 'fichas completas', 'inventario de fichas'],
    110004: ['yacimientos y ocurrencias', 'ocurrencias defomin', 'yacimientos defomin'],
    111000: ['zonas informales', 'minería informal', 'minería artesanal', 'informales', 'güirises'],
    200000: ['geología', 'información geológica', 'mapas geológicos'],
    201000: ['estructural 2'], 202000: ['estructural', 'estructuras'], 203000: ['fallas', 'fallas geológicas', 'fallas centroamericanas'],
    204000: ['geológico de olancho', 'geología de olancho'], 205000: ['geológicos'], 206000: ['mapa estructural', 'estructural 50 mil'],
    207000: ['geotectónico', 'mapa geotectónico', 'tectónica'], 208000: ['metalogenético', 'mapa metalogenético', 'metalogenia'],
    209000: ['mapa geológico', 'geológico nacional', 'geología de honduras'], 210000: ['suelos', 'suelos simmons', 'tipos de suelo', 'simmons'],
    300000: ['proyectos', 'proyectos indexa', 'nuestros proyectos'],
    301000: ['pantaleona', 'proyecto pantaleona'], 302000: ['buenavista', 'buena vista', 'monarca', 'monarka', 'proyecto buenavista'],
    303000: ['cimarrón', 'cimarron', 'el chaparro', 'proyecto cimarrón'], 304000: ['minas de oro', 'mdo', 'proyecto minas de oro', 'montecielo'],
    400000: ['historia', 'historia de honduras'], 401000: ['históricos', 'mapas históricos', 'jica'],
    800000: ['otros', 'otras capas', 'varios'],
}
CURADOS = {fold(a): i for i, xs in BASE_ALIAS.items() for a in xs}
for e in POR.values():
    al = list(BASE_ALIAS.get(e['id'], []))
    nombre = re.sub(r'\s*\([^)]*\)', '', e['nombre']).strip()
    for x in (nombre, e['nombre']):
        # El nombre propio no se agrega si es un alias curado de OTRA capa (sería un empate falso).
        if x and fold(x) not in {fold(a) for a in al} and CURADOS.get(fold(x), e['id']) == e['id'] and not re.fullmatch(r'\d\s.*', x):
            al.append(x.lower() if x.isupper() else x)
    if e.get('id_anterior'):
        al.append(f"{e['id_anterior']:06d}")
    if 106000 < e['id'] < 107000:
        al.append(e['nombre'].replace('Hoja ', 'hoja '))
    # La única capa de una categoría se nombra como la categoría («Áreas protegidas» → 101001).
    if not al and e.get('padre') in BASE_ALIAS:
        al = list(BASE_ALIAS[e['padre']])
    e['alias'] = list(dict.fromkeys(a for a in al if a))
    R['alias'].append((e['id'], e['nombre'], e['alias']))

# ============================================================== salida
M['capas'] = sorted(POR.values(), key=lambda c: (c['padre'] or 0, c['orden'], c['id']))
M['version'] = '1.5'
M['correcciones'] = 'instrucciones_correcciones_panel_electrum.md v1.0 (9 de octubre de 2026)'
os.makedirs(f'{S}/salida', exist_ok=True)
json.dump(M, open(f'{S}/salida/manifest.json', 'w'), ensure_ascii=False, indent=1)
json.dump({k: v for k, v in R.items()}, open(f'{S}/salida/correcciones.json', 'w'), ensure_ascii=False, indent=1)
print('capas', len(M['capas']), 'retirados', len(retirados), 'faltaban', len(R['faltaban']), 'sin_datos', len(R['sin_datos']),
      'con estilo', sum(1 for c in M['capas'] if c.get('estilo')), 'minerales extra', extra_usados)
