"""Piezas comunes del generador de fragmentos del modelo `documento`.

Todo es inventado: números con prefijo DEMO-/EXP-FICT-/FICT-, firmantes solo por cargo,
firmas y sellos como texto genérico «[Firma y sello]», empresas y concesiones ficticias.
"""
import random
import re
import string
import unicodedata

R = random.Random(20260926)
MODO = {'split': 'train'}  # 'train' | 'test': qué plantillas se pueden usar

# ------------------------------------------------------------------ plantillas y pools

class T:
    """Plantilla con etiquetas req_* (letras F C A M X P)."""
    __slots__ = ('t', 'tags')

    def __init__(self, t, tags=''):
        self.t = t
        self.tags = set(tags)


def pool(*items):
    return [x if isinstance(x, T) else T(x) for x in items]


_RESERVA = {}


def reservadas_de(p):
    """Plantillas reservadas para test, elegidas dentro de cada grupo con las mismas etiquetas
    (de 4 o más: una de cada cuatro; de 3: la última), para que train no pierda ninguna etiqueta."""
    clave = tuple(id(x) for x in p)
    if clave not in _RESERVA:
        grupos = {}
        for x in p:
            grupos.setdefault(frozenset(x.tags), []).append(x)
        res = set()
        for g in grupos.values():
            if len(g) >= 4:
                res |= {id(x) for i, x in enumerate(g) if i % 4 == 3}
            elif len(g) == 3:
                res.add(id(g[2]))
        _RESERVA[clave] = res
    return _RESERVA[clave]


def elegir(p):
    res = reservadas_de(p)
    if not res:
        return R.choice(p)
    libres = [x for x in p if id(x) not in res]
    if MODO['split'] == 'train':
        return R.choice(libres)
    # en test: una plantilla reservada del mismo grupo de etiquetas, casi siempre
    x = R.choice(p)
    grupo_res = [y for y in p if id(y) in res and y.tags == x.tags]
    if grupo_res and R.random() < 0.8:
        return R.choice(grupo_res)
    return x


LETRA = {'F': 'req_firma_autoridad', 'C': 'req_coordenadas', 'A': 'req_agua',
         'M': 'req_comunidad', 'X': 'req_cierre', 'P': 'req_plazo'}

# ------------------------------------------------------------------ entidades inventadas

EMPRESAS = [
    'Minerales Cerro Azul Demo, S.A. de C.V.', 'Inversiones Auríferas Ficticias del Norte, S. de R.L.',
    'Compañía Minera Tres Valles Demo, S.A.', 'Exploraciones Pinolapa FICT, S.A. de C.V.',
    'Minera Lomas Verdes Demo, S.A.', 'Metales del Altiplano Ficticio, S. de R.L. de C.V.',
    'Sociedad Minera La Candelilla Demo, S.A.', 'Oro de Occidente FICT, S.A. de C.V.',
    'Grupo Minero Ceibal Demo, S. de R.L.', 'Extracciones y Agregados El Porvenir Demo, S.A.',
    'Cooperativa Mixta de Pequeños Mineros Nueva Aurora (ficticia)', 'Minas del Valle Escondido Demo, S.A.',
    'Aurífera Montecristo FICT, S. de R.L.', 'Compañía Exploradora Los Pinares Demo, S.A. de C.V.',
    'Mármoles y Calizas del Sur Demo, S.A.', 'Minera Quetzaltepe Ficticia, S.A.',
]
CONSULTORAS = ['Consultores Ambientales Ceiba Demo', 'Geoservicios Ixbalam FICT', 'EcoGestión Catracha Demo, S. de R.L.',
               'Estudios Técnicos del Istmo Demo', 'Hidrogeología Aplicada FICT', 'Geominas Consultores Demo']
LABS = ['Laboratorio Analítico Andesita Demo', 'LabMinero Centroamericano FICT', 'Laboratorio de Aguas El Roble Demo']
BANCOS = ['Banco Cordillera Demo, S.A.', 'Banco del Valle Central FICT', 'Banco Hondureño de Fomento Demo']
ASEGURADORAS = ['Seguros La Sierra Demo, S.A.', 'Afianzadora Continental FICT']
CONCESIONES = [
    'El Guayabo Dorado', 'Los Tizatillos', 'Cerro La Campana', 'Quebrada Honda II', 'San Lucas Norte',
    'La Esmeralda del Sur', 'Las Tres Cruces', 'El Pinabete', 'Montaña de Oro Viejo', 'Santa Rufina',
    'El Zapotal', 'Los Encinos', 'La Chorrera', 'Piedra Rayada', 'El Chaparral', 'Agua Caliente Norte',
    'Río Chiquito', 'Cerro Pelón', 'La Culebrilla', 'Las Golondrinas', 'El Camarón Viejo', 'San Isidro Alto',
    'Veta Rica', 'Los Achiotes', 'La Peña Blanca', 'El Tigre Uno', 'Cuesta del Aire', 'La Mina Vieja',
]
DEPTOS = {
    'Olancho': ['Juticalpa', 'Catacamas', 'Campamento', 'Salamá', 'Manto', 'Silca', 'Concordia'],
    'El Paraíso': ['Danlí', 'El Paraíso', 'Yuscarán', 'Teupasenti', 'Trojes', 'San Lucas'],
    'Choluteca': ['Choluteca', 'San Marcos de Colón', 'El Corpus', 'Concepción de María', 'Namasigüe'],
    'Santa Bárbara': ['Santa Bárbara', 'Macuelizo', 'Quimistán', 'San Nicolás', 'Trinidad'],
    'Francisco Morazán': ['San Juan de Flores', 'Cedros', 'Vallecillo', 'San Ignacio', 'Orica'],
    'Copán': ['Santa Rosa de Copán', 'Dulce Nombre', 'La Jigua', 'Florida'],
    'Lempira': ['Gracias', 'Erandique', 'Gualcince'],
    'Intibucá': ['La Esperanza', 'Yamaranguila', 'San Marcos de la Sierra'],
    'Yoro': ['Yoro', 'Olanchito', 'Victoria', 'Sulaco'],
    'Colón': ['Tocoa', 'Sonaguera', 'Iriona'],
    'Valle': ['Nacaome', 'Goascorán', 'San Lorenzo'],
    'Comayagua': ['Comayagua', 'Siguatepeque', 'Esquías', 'Minas de Oro'],
    'Atlántida': ['Tela', 'Arizona', 'Jutiapa'],
    'Ocotepeque': ['Ocotepeque', 'Sinuapa'],
}
ALDEAS = ['El Carrizal', 'Las Minitas', 'El Tablón', 'Los Planes de Arriba', 'El Zapote', 'La Libertad',
          'San José del Potrero', 'El Rosario', 'Las Crucitas', 'El Chagüite', 'Agua Blanca', 'Río Abajo',
          'Quebrada de Arena', 'El Ocotal', 'La Montañita', 'Pueblo Viejo', 'Los Pozos', 'El Terrero',
          'Santa Cruz de la Loma', 'El Aguacatal', 'Las Pitas', 'Monte Grande', 'El Pedernal', 'La Ermita',
          'Los Horcones', 'El Jícaro', 'San Antonio del Cerro', 'Las Joyas']
QUEBRADAS = ['El Zope', 'Los Mangos', 'La Chorrerita', 'El Aguacate', 'Los Guapotes', 'La Leona', 'El Tempisque',
             'Las Lajas', 'El Guineo', 'Seca', 'La Danta', 'El Achiote', 'El Barro', 'Las Marías', 'Salada',
             'El Hule', 'San Ramoncito', 'La Pita', 'El Coyol', 'Los Jobos']
RIOS = ['Tamarindo', 'Las Pavas', 'Chiquihuite', 'San Lorencito', 'El Encanto', 'Cuscateca', 'Pedregal',
        'Colorado Chico', 'Talquezal', 'Las Cañas', 'Guachipilín']
PUEBLOS = ['lenca', 'maya chortí', 'tolupán', 'pech', 'tawahka', 'misquito', 'nahua', 'garífuna']
MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre',
         'noviembre', 'diciembre']
UNIDADES = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once',
            'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
            'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete',
            'veintiocho', 'veintinueve', 'treinta', 'treinta y uno']
CARGOS_INHGEOMIN = ['Director(a) Ejecutivo(a)', 'Secretario(a) General', 'Subdirector(a) Ejecutivo(a)',
                    'Jefe(a) de la Unidad de Catastro Minero', 'Director(a) de Fiscalización Minera',
                    'Jefe(a) de Asesoría Legal', 'Técnico(a) de Catastro Minero']


def palabras(n):
    if n <= 31:
        return UNIDADES[n]
    dec = {3: 'treinta', 4: 'cuarenta', 5: 'cincuenta', 6: 'sesenta', 7: 'setenta', 8: 'ochenta', 9: 'noventa'}
    d, u = divmod(n, 10)
    return dec[d] + ('' if u == 0 else ' y ' + UNIDADES[u])


def anio_l(a):
    return 'dos mil ' + palabras(a - 2000) if a > 2000 else 'dos mil'


def miles(n, dec=2):
    s = f'{n:,.{dec}f}'
    return s


def fecha_tupla():
    return R.randint(2008, 2025), R.randint(1, 12), R.randint(1, 28)


def fmt_fecha(a, m, d, estilo=None):
    estilo = estilo or R.choice(['larga', 'larga', 'corta', 'num', 'letras'])
    if estilo == 'larga':
        return f'{d} de {MESES[m - 1]} de {a}'
    if estilo == 'corta':
        return f'{d} de {MESES[m - 1]} del {a}'
    if estilo == 'num':
        return f'{d:02d}/{m:02d}/{a}'
    return f'{palabras(d)} de {MESES[m - 1]} del año {anio_l(a)}'


def coords_base():
    return R.randint(380, 720) * 1000 + R.randint(0, 999), R.randint(1450, 1700) * 1000 + R.randint(0, 999)


def poligono(n=None):
    n = n or R.choice([4, 4, 4, 5, 6, 6, 8])
    x0, y0 = coords_base()
    lado = R.choice([1000, 1500, 2000, 2500, 3000, 4000])
    pts = []
    import math
    for i in range(n):
        ang = 2 * math.pi * i / n + R.uniform(-0.15, 0.15)
        rr = lado * R.uniform(0.7, 1.0)
        pts.append((round(x0 + rr * math.cos(ang), R.choice([0, 0, 2])), round(y0 + rr * math.sin(ang), R.choice([0, 0, 2]))))
    return pts


def fnum(v, sep):
    if isinstance(v, float) and v != int(v):
        s = f'{v:,.2f}'
    else:
        s = f'{int(v):,}'
    return s.replace(',', sep)


def coords_tabla(docling=None):
    pts = poligono()
    docling = R.random() < 0.5 if docling is None else docling
    sep = R.choice([',', ' ', ''])
    if docling:
        enc = R.choice(['Vértice | X (Este) | Y (Norte)', 'Vértice | Este (m) | Norte (m)', 'Punto | X | Y',
                        'VÉRTICE | COORDENADA X | COORDENADA Y'])
        filas = [f'{R.choice(["", "V", "V-", "P"])}{i + 1} | {fnum(x, sep)} | {fnum(y, sep)}' for i, (x, y) in enumerate(pts)]
        return '[TABLA] ' + enc + '\n' + '\n'.join(filas)
    enc = R.choice(['VÉRTICE   ESTE   NORTE', 'PUNTO  X  Y', 'Vértice    X    Y', 'V   E (m)   N (m)'])
    filas = [f'{R.choice(["V", "P-", ""])}{i + 1}   {fnum(x, sep)}   {fnum(y, sep)}' for i, (x, y) in enumerate(pts)]
    return enc + '\n' + '\n'.join(filas)


def coords_inline():
    pts = poligono(R.choice([4, 4, 5, 6]))
    estilo = R.random()
    if estilo < 0.4:
        return '; '.join(f'V{i + 1} X={int(x)} Y={int(y)}' for i, (x, y) in enumerate(pts))
    if estilo < 0.7:
        return ', '.join(f'vértice {i + 1}: {int(x):,} E, {int(y):,} N' for i, (x, y) in enumerate(pts))
    return ' / '.join(f'P{i + 1} ({int(x)}, {int(y)})' for i, (x, y) in enumerate(pts))


def rumbo():
    return f'{R.choice("NS")} {R.randint(0, 89)}°{R.randint(0, 59):02d}\'{R.randint(0, 59):02d}" {R.choice("EO")}'


def rumbos():
    n = R.choice([3, 4, 4, 5])
    partes = []
    for i in range(n):
        a, b = i + 1, (i + 1) % n + 1
        partes.append(R.choice([
            f'del vértice {a} al {b}, rumbo {rumbo()}, distancia {R.randint(150, 2800)}.{R.randint(0, 99):02d} m',
            f'{a}-{b}  {rumbo()}  {R.randint(150, 2800)}.{R.randint(0, 99):02d} m',
            f'lado {a}-{b} con rumbo {rumbo()} y {R.randint(150, 2800)}.{R.randint(0, 99):02d} metros',
        ]))
    return '; '.join(partes)


def cuadro_construccion():
    pts = poligono(R.choice([4, 5, 6]))
    filas = []
    for i, (x, y) in enumerate(pts):
        j = (i + 1) % len(pts)
        filas.append(f'{i + 1}-{j + 1} | {rumbo()} | {R.randint(200, 2500)}.{R.randint(0, 99):02d} | {j + 1} | {int(pts[j][1]):,} | {int(pts[j][0]):,}')
    return '[TABLA] LADO | RUMBO | DISTANCIA | V | Y | X\n' + '\n'.join(filas)


def punto_suelto():
    x, y = coords_base()
    return R.choice([f'E {x} N {y}', f'X: {x:,} Y: {y:,}', f'{x} E / {y} N', f'16P {x} {y}'])


def colindante():
    return R.choice(['propiedad de la sucesión [NOMBRE]', 'terreno ejidal de la Municipalidad', 'camino real que conduce a la aldea {aldea2}',
                     'propiedad de [NOMBRE]', 'lote de la Cooperativa Agrícola (ficticia)', 'terreno nacional', 'carretera pavimentada',
                     'cerco de alambre y propiedad privada', 'servidumbre de paso existente', 'cerro {concesion2}'])


def linderos(con_agua=False):
    lados = ['AL NORTE', 'AL SUR', 'AL ESTE', 'AL OESTE']
    R.shuffle(lados)
    vals = [colindante() for _ in range(4)]
    if con_agua:
        vals[0] = R.choice(['quebrada {quebrada} de por medio', 'margen del río {rio}', 'la quebrada {quebrada}',
                            'el cauce de la quebrada {quebrada}'])
    orden = ['AL NORTE', 'AL SUR', 'AL ESTE', 'AL OESTE']
    d = dict(zip(lados, vals))
    sep = R.choice(['; ', ', ', '.- '])
    return sep.join(f'{k}, {R.choice(["con ", "colinda con ", ""])}{d[k]}' for k in orden)


def monto_l(lo=2000, hi=900000):
    return 'L. ' + miles(R.randint(lo, hi) + R.choice([0, 0, 0.5, 0.25, 0.8]))


def monto_usd(lo=1500, hi=2500000):
    return R.choice(['US$ ', 'USD ', '$ ']) + miles(R.randint(lo, hi) + R.choice([0, 0, 0.5]))


def res_num(anio=None):
    a = anio or R.randint(2008, 2025)
    n = R.randint(12, 1999)
    return R.choice([
        f'DEMO-{n:04d}-{a}', f'DEMO-DE-{n:04d}-{a}', f'DEMO-SG-{n:03d}-{a}', f'DEMO-DFM-{n:04d}-{a}',
        f'DEMO-DECA-{n:04d}-{a}', f'DEMO-{n}-SERNA-{a}', f'DEMO-INHGEOMIN-{n:04d}-{a}', f'DEMO-UCM-{n:03d}-{a}',
    ])


def exp_num(anio=None):
    a = anio or R.randint(2008, 2025)
    n = R.randint(10, 9999)
    return R.choice([f'EXP-FICT-{a}-{n:04d}', f'EXP-FICT-{n}-{str(a)[2:]}', f'EXP-FICT-SLAS-{a}-{n:05d}',
                     f'EXP-FICT-PL-{n:04d}-{a}', f'EXP-FICT-{a}-EX-{n:04d}'])


def fict_num(pref=''):
    return f'FICT-{pref}{R.randint(10, 99999):05d}'


class Ctx(dict):
    """Rellena {huecos} a pedido; lo mismo dentro de un fragmento queda igual."""

    def __missing__(self, k):
        if k.startswith('_'):
            raise KeyError(k)
        base = k.rstrip('0123456789')
        v = self.gen(base, k)
        self[k] = v
        return v

    def distinto(self, lista, base):
        usados = {v for kk, v in self.items() if kk.rstrip('0123456789') == base}
        opciones = [x for x in lista if x not in usados] or lista
        return R.choice(opciones)

    def gen(self, base, k):
        if base == 'depto':
            return self.setdefault('_depto', R.choice(list(DEPTOS)))
        if base == 'muni':
            return self.distinto(DEPTOS[self['depto']], 'muni')
        if base == 'aldea':
            return self.distinto(ALDEAS, 'aldea')
        if base == 'quebrada':
            return self.distinto(QUEBRADAS, 'quebrada')
        if base == 'rio':
            return self.distinto(RIOS, 'rio')
        if base == 'empresa':
            return self.distinto(EMPRESAS, 'empresa')
        if base == 'concesion':
            return self.distinto(CONCESIONES, 'concesion')
        if base == 'consultora':
            return R.choice(CONSULTORAS)
        if base == 'lab':
            return R.choice(LABS)
        if base == 'banco':
            return R.choice(BANCOS)
        if base == 'aseguradora':
            return R.choice(ASEGURADORAS)
        if base == 'pueblo':
            return R.choice(PUEBLOS)
        if base == 'anio':
            return str(self.anio_n)
        if base == 'fecha':
            a, m, d = fecha_tupla()
            a = self.anio_n if k == 'fecha' else self.anio_n - R.randint(0, 3)
            return fmt_fecha(a, m, d)
        if base == 'fecha_l':
            a, m, d = fecha_tupla()
            return fmt_fecha(self.anio_n, m, d, 'letras')
        if base == 'fecha_prox':
            m = R.randint(1, 12)
            return fmt_fecha(self.anio_n + (1 if m < 3 else 0), m, R.randint(1, 28), R.choice(['larga', 'num']))
        if base == 'fecha_futura':
            return fmt_fecha(self.anio_n + R.randint(1, 10), R.randint(1, 12), R.randint(1, 28), R.choice(['larga', 'num']))
        if base == 'mes':
            return R.choice(MESES)
        if base == 'dias':
            return str(R.choice([3, 5, 8, 10, 10, 15, 15, 20, 30, 30, 45, 60, 90]))
        if base == 'dias_l':
            n = R.choice([3, 5, 8, 10, 15, 20, 30])
            return f'{palabras(n)} ({n})'
        if base == 'anios':
            return str(R.choice([2, 3, 4, 5, 5, 10, 10, 15, 20, 25]))
        if base == 'meses':
            return str(R.choice([3, 6, 6, 12, 18, 24]))
        if base == 'ha':
            return miles(R.choice([R.randint(20, 1000), R.randint(50, 400) * 1.0]) + R.choice([0, 0.25, 0.5, 0.75, 0.12]))
        if base == 'mz':
            return str(R.randint(2, 60))
        if base == 'res':
            return res_num(self.anio_n)
        if base == 'exp':
            return exp_num(self.anio_n)
        if base == 'fict':
            return fict_num()
        if base == 'lps':
            return monto_l()
        if base == 'lps_chico':
            return monto_l(200, 25000)
        if base == 'usd':
            return monto_usd()
        if base == 'usd_chico':
            return monto_usd(100, 30000)
        if base == 'n':
            return str(R.randint(2, 48))
        if base == 'nn':
            return str(R.randint(60, 950))
        if base == 'art':
            return str(R.randint(3, 110))
        if base == 'pag':
            return str(R.randint(2, 40))
        if base == 'tot':
            return str(R.randint(40, 180))
        if base == 'datum':
            return R.choice(['NAD27', 'NAD 27', 'WGS84', 'WGS 84', 'NAD27 Centroamérica'])
        if base == 'escala':
            return R.choice(['1:5,000', '1:10,000', '1:25,000', '1:50,000', '1:2,500', '1:1,000'])
        if base == 'coords_tabla':
            return coords_tabla()
        if base == 'coords_inline':
            return coords_inline()
        if base == 'rumbos':
            return rumbos()
        if base == 'cuadro':
            return cuadro_construccion()
        if base == 'linderos':
            return linderos(False)
        if base == 'linderos_q':
            return linderos(True)
        if base == 'punto':
            return punto_suelto()
        if base == 'cargo':
            return R.choice(CARGOS_INHGEOMIN)
        if base == 'au':
            return f'{R.uniform(0.3, 28):.2f}'
        if base == 'ag':
            return f'{R.uniform(1, 180):.1f}'
        if base == 'm':
            return str(R.choice([5, 10, 15, 20, 25, 30, 50, 100, 150]))
        if base == 'q':
            return f'{R.uniform(0.5, 180):.1f}'
        if base == 'pct':
            return f'{R.uniform(55, 96):.1f}'
        if base == 'ddh':
            return f'DDH-{R.choice(["", "FICT-"])}{R.randint(1, 60):02d}'
        if base == 'prof':
            return f'{R.uniform(30, 450):.1f}'
        if base == 'hora':
            return f'{R.randint(8, 16)}:{R.choice(["00", "15", "30", "45", "10", "25"])}'
        if base == 'trim':
            return R.choice(['primer', 'segundo', 'tercer', 'cuarto'])
        if base == 'km':
            return f'{R.uniform(1, 45):.1f}'
        if base == 'hab':
            return str(R.randint(80, 3500))
        if base == 'ton':
            return miles(R.randint(800, 60000), 0)
        if base == 'oz':
            return miles(R.randint(80, 9000), 0)
        raise KeyError(k)


def ctx_nuevo():
    c = Ctx()
    c.anio_n = R.randint(2009, 2025)
    return c


ALT = re.compile(r'‹([^‹›]*)›')


def rellenar(t, c):
    while True:
        nuevo = ALT.sub(lambda m: R.choice(m.group(1).split('|')), t)
        if nuevo == t:
            break
        t = nuevo
    # dos pasadas: un hueco puede traer otro hueco (linderos -> {aldea2})
    for _ in range(3):
        t2 = string.Formatter().vformat(t, (), c)
        if t2 == t:
            break
        t = t2
    return t


class Seg:
    __slots__ = ('texto', 'tags', 'cortable', 'minimo')

    def __init__(self, texto, tags, cortable, minimo=0):
        # minimo: una pieza etiquetada se puede cortar si queda al menos esto a la vista (tablas y
        # listas de vértices: el principio o el final de la tabla sigue siendo coordenadas)
        self.texto, self.tags, self.cortable, self.minimo = texto, tags, cortable, minimo


def seg(plantilla, c, cortable=None):
    """plantilla: una T o un pool (lista); de un pool no se repite una plantilla ya usada en el fragmento."""
    usados = c.setdefault('_usados', set())
    if isinstance(plantilla, list):
        for _ in range(12):
            x = elegir(plantilla)
            if id(x) not in usados:
                break
        plantilla = x
    usados.add(id(plantilla))
    txt = rellenar(plantilla.t, c)
    minimo = 170 if plantilla.tags == {'C'} and len(txt) > 260 else 0
    return Seg(txt, set(plantilla.tags), (not plantilla.tags) if cortable is None else cortable, minimo)


def componer(c, sub):
    """sub: {'cab': pool, 'cuerpo': [(pool, prob)], 'cola': [(pool, prob)], 'min': n}.
    El cuerpo va en la cabeza; con varias piezas, la última puede pasar a la cola (el final del documento)."""
    cab = [seg(sub['cab'], c)]
    cuerpo = [seg(p, c) for p, pr in sub.get('cuerpo', []) if R.random() < pr]
    relleno = sub.get('relleno')
    while relleno and len(cuerpo) < sub.get('min', 1):
        cuerpo.append(seg(relleno, c))
    if sub.get('barajar') and len(cuerpo) > 1:
        R.shuffle(cuerpo)
    cola = [seg(p, c) for p, pr in sub.get('cola', []) if R.random() < pr]
    if len(cuerpo) > 1 and R.random() < 0.45:
        cola.insert(0, cuerpo.pop())
    return cab + cuerpo, cola


def medio_de(subs, c):
    """Un trozo del medio de un documento, sin encabezado ni firmas: solo cuerpo de un subtipo."""
    s = subtipo(subs)
    pools = [p for p, _ in s.get('cuerpo', [])] + ([s['relleno']] if s.get('relleno') else [])
    elegidos = [seg(p, c) for p, pr in s.get('cuerpo', []) if R.random() < max(pr, 0.5)]
    intentos = 0
    while len(elegidos) < 2 and intentos < 6:
        elegidos.append(seg(R.choice(pools), c))
        intentos += 1
    R.shuffle(elegidos)
    return elegidos


def subtipo(subs):
    """subs: lista de (peso, dict)."""
    tot = sum(w for w, _ in subs)
    x = R.random() * tot
    for w, s in subs:
        x -= w
        if x <= 0:
            return s
    return subs[-1][1]


# ------------------------------------------------------------------ armado cabeza + « … » + cola

def recortar_final(txt, n):
    if len(txt) <= n:
        return txt
    corte = txt.rfind(' ', 0, n)
    return txt[:corte if corte > n * 0.5 else n].rstrip(' ,;')


def recortar_inicio(txt, n):
    if len(txt) <= n:
        return txt
    ini = txt.find(' ', len(txt) - n)
    return txt[ini + 1 if ini >= 0 else len(txt) - n:]


def armar(cabeza, cola, maximo=None):
    """cabeza y cola: listas de Seg. Devuelve (texto, tags)."""
    maximo = maximo or R.randint(420, 880)
    todos = cabeza + cola
    unido = '\n'.join(s.texto for s in todos)
    if len(unido) <= maximo:
        return unido, set().union(*[s.tags for s in todos]) if todos else set()
    sep = R.choice([' … ', '\n…\n', ' … ', ' […] ', '\n… '])
    presupuesto_c = R.randint(int(maximo * 0.4), int(maximo * 0.62))
    presupuesto_t = maximo - presupuesto_c
    usados, tags, lon = [], set(), 0
    for s in cabeza:
        if lon + len(s.texto) <= presupuesto_c or not usados:
            if lon + len(s.texto) > presupuesto_c and not usados:
                if s.cortable or (s.minimo and presupuesto_c >= s.minimo):
                    usados.append(recortar_final(s.texto, presupuesto_c))
                    if not s.cortable:
                        tags |= s.tags
                    lon = presupuesto_c
                    break
                usados.append(s.texto); tags |= s.tags; lon += len(s.texto)
                break
            usados.append(s.texto); tags |= s.tags; lon += len(s.texto) + 1
        else:
            resto = presupuesto_c - lon
            if s.cortable and resto > 60:
                usados.append(recortar_final(s.texto, resto))
            elif s.minimo and resto >= s.minimo:
                usados.append(recortar_final(s.texto, resto))
                tags |= s.tags
            break
    texto_c = '\n'.join(usados)
    usados, lon = [], 0
    for s in reversed(cola):
        if lon + len(s.texto) <= presupuesto_t or not usados:
            if lon + len(s.texto) > presupuesto_t and not usados and (s.cortable or (s.minimo and presupuesto_t >= s.minimo)):
                usados.insert(0, recortar_inicio(s.texto, presupuesto_t))
                if not s.cortable:
                    tags |= s.tags
                break
            usados.insert(0, s.texto); tags |= s.tags; lon += len(s.texto) + 1
        else:
            resto = presupuesto_t - lon
            if s.cortable and resto > 60:
                usados.insert(0, recortar_inicio(s.texto, resto))
            elif s.minimo and resto >= s.minimo:
                usados.insert(0, recortar_inicio(s.texto, resto))
                tags |= s.tags
            break
    return texto_c + sep + '\n'.join(usados), tags


# ------------------------------------------------------------------ ruido de OCR

SIN_TILDE = str.maketrans('áéíóúÁÉÍÓÚ', 'aeiouAEIOU')


def ocr(t, membrete='', fuerza=None):
    f = fuerza if fuerza is not None else R.uniform(0.3, 1.0)
    if R.random() < 0.6 * f + 0.2:
        t = t.translate(SIN_TILDE)
    if R.random() < 0.3 * f:
        t = t.replace('ñ', R.choice(['n', 'fi', '~n']))
    subs = [('m', 'rn'), ('rn', 'm'), ('O', '0'), ('o', '0'), ('0', 'O'), ('l', '1'), ('1', 'l'), ('I', 'l'),
            ('e', 'c'), ('S', '5'), ('B', '8'), ('cl', 'd'), ('ll', 'Il'), ('u', 'ii'), ('h', 'b'), ('.', ','),
            ('ó', '6'), ('í', 'i'), ('a', 'á')]
    chars = list(t)
    salida = []
    i = 0
    p = 0.012 + 0.03 * f
    while i < len(t):
        hecho = False
        if R.random() < p:
            R.shuffle(subs)
            for a, b in subs[:4]:
                if t.startswith(a, i):
                    salida.append(b)
                    i += len(a)
                    hecho = True
                    break
        if not hecho:
            ch = t[i]
            if ch == ' ' and R.random() < 0.02 * f:
                salida.append(R.choice(['\n', '  ', '', ' | ', ' ~ ']))
            elif ch == '\n' and R.random() < 0.3 * f:
                salida.append(' ')
            else:
                salida.append(ch)
            i += 1
    t = ''.join(salida)
    # guion de fin de línea que parte una palabra
    if R.random() < 0.5 * f:
        palabras_l = [m.start() for m in re.finditer(r'[a-záéíóúñ]{8,}', t)]
        for pos in R.sample(palabras_l, min(len(palabras_l), R.randint(1, 2))):
            k = pos + R.randint(3, 5)
            t = t[:k] + '-\n' + t[k:]
    # encabezado y número de página repetidos
    if membrete and R.random() < 0.55 * f + 0.1:
        lineas = t.split('\n')
        if len(lineas) > 2:
            k = R.randint(1, len(lineas) - 1)
            pie = R.choice([f'Página {R.randint(2, 30)} de {R.randint(30, 90)}', f'- {R.randint(2, 60)} -',
                            f'Pag. {R.randint(2, 40)}', f'{R.randint(2, 99)}', f'Folio {R.randint(10, 400)}'])
            lineas.insert(k, (membrete.upper() if R.random() < 0.5 else membrete) + '\n' + pie)
            t = '\n'.join(lineas)
    if R.random() < 0.3 * f:
        t = R.choice(['|', '.', '~', "'", '■', '']) + t
    return t


# ------------------------------------------------------------------ similitud

def normal(t):
    t = unicodedata.normalize('NFKD', t.lower())
    t = ''.join(ch for ch in t if not unicodedata.combining(ch))
    t = re.sub(r'\d', '0', t)
    t = re.sub(r'[^a-z0\s]', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def tejas(t, k=3):
    w = [p for p in normal(t).split() if not set(p) <= {'0'}]
    return {' '.join(w[i:i + k]) for i in range(max(1, len(w) - k + 1))}


def jaccard(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)
