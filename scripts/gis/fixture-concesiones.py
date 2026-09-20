#!/usr/bin/env python3
"""
Genera los shapefiles de prueba del motor GIS (tests/fixtures/gis/).

Se hacen en UTM 16N (EPSG:32616) a propósito, que es como llegan de verdad los archivos del catastro
hondureño: si el motor ignora el .prj, las concesiones aterrizan en mitad del Atlántico y la prueba
lo caza. Las medidas son exactas en el plano UTM, así que sirven de verdad conocida.

Uso: python3 scripts/gis/fixture-concesiones.py
"""
import os
import shapefile  # pyshp
import zipfile

SALIDA = os.path.join(os.path.dirname(__file__), '..', '..', 'tests', 'fixtures', 'gis')
os.makedirs(SALIDA, exist_ok=True)

# Danlí, El Paraíso. Esquina suroeste de la primera concesión, en UTM 16N.
E0, N0 = 545_000.0, 1_551_000.0

PRJ_UTM16N = (
    'PROJCS["WGS_1984_UTM_Zone_16N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",'
    'SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],'
    'UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],'
    'PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],'
    'PARAMETER["Central_Meridian",-87.0],PARAMETER["Scale_Factor",0.9996],'
    'PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'
)


def cuadrado(e, n, lado):
    """Anillo cerrado en sentido horario, como los escribe un shapefile."""
    return [[e, n], [e, n + lado], [e + lado, n + lado], [e + lado, n], [e, n]]


def escribir(nombre, registros, prj=PRJ_UTM16N):
    ruta = os.path.join(SALIDA, nombre)
    w = shapefile.Writer(ruta, shapeType=shapefile.POLYGON)
    w.field('EXPEDIENTE', 'C', 20)
    w.field('NOMBRE', 'C', 40)
    w.field('TITULAR', 'C', 60)
    w.field('HECTAREAS', 'N', 12, 2)
    for anillo, campos in registros:
        w.poly([anillo])
        w.record(*campos)
    w.close()
    with open(f'{ruta}.prj', 'w', encoding='utf-8') as f:
        f.write(prj)
    return ruta


# --- catastro.shp: dos concesiones que SE TRASLAPAN, que es el problema real de un catastro.
# A: 2.000 x 2.000 m = 400,00 ha exactas en el plano.
# B: desplazada 1.500 m al este, mismo tamaño → traslape de 500 x 2.000 m = 100,00 ha.
a = cuadrado(E0, N0, 2000)
b = cuadrado(E0 + 1500, N0, 2000)
ruta = escribir(
    'catastro',
    [
        (a, ['EXP-2021-0442', 'Quebrada Seca', 'Minera Demo del Norte S.A.', 400.00]),
        (b, ['EXP-2019-0118', 'Cerro Partido', 'Compañía Demo Andina Ltda.', 400.00]),
    ],
)

# El mismo par, empaquetado en .zip, que es como los manda todo el mundo por correo.
with zipfile.ZipFile(os.path.join(SALIDA, 'catastro.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    for ext in ('shp', 'dbf', 'shx', 'prj'):
        z.write(f'{ruta}.{ext}', f'catastro.{ext}')

# --- sin-prj.shp: el caso feo. Mismo polígono, sin .prj. El motor tiene que avisar, no adivinar.
ruta2 = os.path.join(SALIDA, 'sin-prj')
w = shapefile.Writer(ruta2, shapeType=shapefile.POLYGON)
w.field('NOMBRE', 'C', 40)
w.poly([a])
w.record('Sin proyección')
w.close()
if os.path.exists(f'{ruta2}.prj'):
    os.remove(f'{ruta2}.prj')

print('fixtures en', os.path.normpath(SALIDA))
for f in sorted(os.listdir(SALIDA)):
    print('  ', f, os.path.getsize(os.path.join(SALIDA, f)), 'bytes')
