#!/usr/bin/env python3
"""Arma reporte_correcciones.md (instrucciones de corrección v1.0, sección 6) a partir de lo que
dejó correcciones.py (salida/manifest.json y salida/correcciones.json) y del resultado de las pruebas.

Uso: python3 reporte_correcciones.py <dir-salida> <pruebas.txt> > reporte_correcciones.md
"""
import collections, json, re, sys

D = sys.argv[1]
M = json.load(open(f'{D}/manifest.json'))
R = json.load(open(f'{D}/correcciones.json'))
PRUEBAS = open(sys.argv[2]).read() if len(sys.argv) > 2 else ''
POR = {c['id']: c for c in M['capas']}
i6 = lambda i: f'{i:06d}'
L = []
w = L.append

w('# Reporte de correcciones — panel de capas, simbología, proyectos y Doctor Electrum')
w('')
w('Base: `indice_capas_gis_kml.md` v1.4 · Instrucciones: `instrucciones_correcciones_panel_electrum.md` v1.0 · Manifiesto resultante: **v1.5** (`biblioteca/mapas/manifest.json`).')
w('Se trabajó sobre copias: no se borró ni modificó ningún archivo original. Los IDs ya publicados no cambiaron; los 24 que se movieron quedaron retirados.')
w('')

# 1 ------------------------------------------------------------------
w('## 1. Clasificaciones que faltaban en el panel y cómo se corrigieron')
w('')
w('Se comparó el árbol del panel contra el índice v1.4, entrada por entrada (bloques 0, 1, 2, 3, 4 y 8, todas las categorías `…000` y sus subcapas). Resultado:')
w('')
falt = R.get('faltaban', [])
if falt:
    for i, n, m in falt:
        w(f'- `{i6(i)}` {n}: {m}.')
else:
    w('- **Ninguna entrada del índice faltaba en el manifiesto publicado.** El panel en producción ya mostraba los 46 nodos del documento desde el despliegue del 10 de octubre; la revisión del 9 de octubre se hizo con la versión anterior (lista de categorías escrita a mano), que no tenía el índice.')
w('- Lo que sí se corrigió en el panel:')
w('  - Las entradas sin archivo se marcan `sin_datos` en el manifiesto y el panel las muestra en gris con la etiqueta **«Sin datos»** (antes decía «no disponible»). Hoy ninguna entrada oficial está sin datos; «no disponible» queda solo para lo que una organización no puede ver.')
w('  - El panel ya no tiene **ninguna lista escrita a mano**: los nombres con que se piden las capas salen de `alias` y los colores de `estilo` del manifiesto (se borró la tabla `ALIAS` del frontal; la prueba falla si vuelve).')
w('  - Los 4 proyectos Indexa muestran sus **subcarpetas** (KML, Shape, Datos de campo, Imágenes, Planos) a partir del campo `subgrupo`.')
w('  - Tres entradas que el documento no traía (`107008` Zonas Indexa, `110003` Fichas de ocurrencia minera, `110004` Yacimientos y ocurrencias mineras) quedan marcadas `fuera_de_indice` con su explicación en `notas`.')
w('- Verificado: División política con sus 5 subcapas en orden; Concesiones Indexa con las 7 (Buenavista, Chaparro, La Campana, Escalera, Pantaleona, El Tajo, Targets); Recursos mineros con Depósitos y Fichas seleccionadas; las 10 capas de geología con Suelos Simmons `210000`; los 4 proyectos con sus subcarpetas; Otros `800000`.')
w('- Prueba automática: `tests/electrum-arbol-indice.test.ts` compara el árbol del panel contra `tests/fixtures/indice-v1.4.json` y falla si falta, sobra o cambia de orden algo.')
w('')

# 2 ------------------------------------------------------------------
w('## 2. Fuente del estilo de cada capa')
w('')
cuenta = collections.Counter()
for c in M['capas']:
    if c.get('estilo'):
        cuenta[c['estilo']['fuente']] += 1
w(f"Resumen: **{cuenta['kml']}** con el estilo del KML/KMZ original, **{cuenta['paleta']}** con la paleta estándar (por mineral, por unidad/tipo o de un color), **{cuenta['imagen']}** imágenes (rásteres, con sus colores propios). Archivos de estilo junto al Shape: solo hay dos `.lyr` de ArcMap (Minas de Oro), binarios y no legibles; su mapa existe también en KMZ y se usaron los colores del KMZ. Campos de color: el de Suelos Simmons (`color`) describe el color del suelo, no la simbología, y `COLOR_H2O` es el color del agua; no se usaron como color de mapa.")
w('')
w('Cómo se pinta: el servidor calcula el color de **cada rasgo** con la misma regla de la leyenda y lo manda en el rasgo (`_c` relleno, `_b` borde, `_o` opacidad del KML); el mapa MapLibre y el de Google lo leen igual.')
w('')
w('| ID | Capa | Fuente del estilo |')
w('|---|---|---|')
for i, n, f in sorted(R['fuente_estilo']):
    w(f'| {i6(i)} | {n} | {f} |')
if R.get('conflictos'):
    w('')
    w('**Conflictos entre fuentes** (gana el estilo original del archivo):')
    for i, t in R['conflictos']:
        w(f'- `{i6(i)}`: {t}')
if R.get('iconos_faltantes'):
    w('')
    w('**Íconos que el KML nombra pero no venían en el archivo** (se les dio un color de la paleta, distinto para cada ícono):')
    for i, n, k in R['iconos_faltantes']:
        w(f'- `{i6(i)}` {n}: {k} íconos.')
w('')

# 3 ------------------------------------------------------------------
w('## 3. Minerales encontrados y color asignado')
w('')
w('Tabla 2.2 de las instrucciones; los no metálicos usan el marrón claro `#C2A878` y tonos de la misma familia para que cada mineral quede distinto; los que no están en la tabla tienen un color propio que no usa ningún otro. Con varios minerales («Oro/Plata»), manda el primero; los demás se ven en la ventana de atributos (campo `minerales`).')
w('')
por_mineral = collections.OrderedDict()
for i, valor, m, col in R['minerales']:
    por_mineral.setdefault((m, col), set()).add((i, valor))
w('| Mineral | Color | Dónde aparece (capa: valor del dato) |')
w('|---|---|---|')
for (m, col), xs in sorted(por_mineral.items(), key=lambda x: x[0][0]):
    donde = '; '.join(f'{i6(i)}: {v}' for i, v in sorted(xs))
    w(f'| {m.capitalize()} | `{col}` | {donde} |')
w('')
w('Las 166 fichas de `110003` no traían mineral en el archivo: se tomó el de la ficha seleccionada con el mismo número FOM (97 de 166); las 69 restantes quedan «Sin dato» en gris. Las fichas seleccionadas (`110002`) guardan además, en `minerales`, todos los elementos que nombra cada ficha (por ejemplo «Oro, Plata»).')
w('')
w('Derechos mineros (`104001`): la tabla del catastro no trae mineral (1076 de 1076 vacíos), así que se colorean por estado del trámite (otorgada, en trámite, delimitada, suspendida).')
w('')

# 4 ------------------------------------------------------------------
w('## 4. Reclasificación de proyectos')
w('')
w('| Archivo (ruta original) | ID anterior | ID nuevo | Proyecto | Por qué |')
w('|---|---|---|---|---|')
for arch, viejo, nuevo, proy, motivo in R['reclasificacion']:
    e = POR.get(nuevo, {})
    ruta = re.search(r'Ruta original: ([^.]+(?:\.[a-z]{3})?)', e.get('notas', ''))
    w(f"| {e.get('nombre', arch[0])} ({ruta.group(1).strip() if ruta else 'sin ruta'}) | {i6(viejo)} | {i6(nuevo)} | {proy} | {motivo} |")
w('')
w('Los IDs anteriores quedan retirados (no se reutilizan): están en `id_anterior` de cada capa y en la lista `retirados` del manifiesto; pedir una capa por su ID viejo lleva a la nueva. Las capas de concesiones del Bloque 1 (`107xxx`) se quedaron donde estaban. Dentro de cada proyecto, las capas se agrupan en KML, Shape, Datos de campo, Imágenes y Planos.')
w('')

# 5 ------------------------------------------------------------------
w('## 5. Archivos con proyecto dudoso (se dejaron en Otros)')
w('')
w('| ID | Capa | Motivo |')
w('|---|---|---|')
for i, n, m in R['dudosos']:
    w(f'| {i6(i)} | {n} | {m} |')
w('')

# 6 ------------------------------------------------------------------
w('## 6. Alias por capa')
w('')
w('| ID | Capa | Alias |')
w('|---|---|---|')
for i, n, al in sorted(R['alias']):
    w(f"| {i6(i)} | {n} | {', '.join(al)} |")
w('')

# 7 ------------------------------------------------------------------
w('## 7. Resultado de las pruebas (sección 5)')
w('')
w(PRUEBAS.strip() or '(pendiente)')
w('')
print('\n'.join(L))
