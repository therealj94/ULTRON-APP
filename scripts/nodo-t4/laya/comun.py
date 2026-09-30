"""Lo que comparten entrenar.py, evaluar.py y servidor.py para los modelos de modelos/<nombre>/.

Cada modelo es una carpeta con:

    modelo.json      nombre, orden de ids, grupos exclusivos, recorte y dónde están los datos
    preguntas.json   una pregunta noul por id (las claves son los mismos ids)
    datos/*.jsonl    {"q": texto, "e": [ids]} por línea

modelo.json (JSON puro, sin comentarios; lo explica docs/NODO-T4.md):

    {"nombre": "mensaje",
     "ids": ["razonar", ..., "tarea_conversacion", ...],     # el orden en que salen las P
     "grupos": {"tarea": ["tarea_conversacion", ...]},        # exactamente uno por texto; gana el argmax
     "recorte": {"cabeza": 200, "cola": 500},                 # caracteres; lo mismo al entrenar y al servir
     "datos": {"train": ["datos/train_*.jsonl"],              # globs relativos a la carpeta
               "test": [...], "bordes": [...], "evals": [...]}}

Todo conjunto que no sea «train» se aparta: entrenar.py descarta del entrenamiento cualquier texto
que aparezca en él, así que añadir un conjunto de prueba nuevo no exige tocar el código.
Solo biblioteca estándar: el servidor lo importa sin nada más.
"""
import glob
import json
import os
import re
import unicodedata

CLAVES_DATOS = ('train', 'test', 'bordes', 'evals')
NOMBRE_VALIDO = re.compile(r'^[a-z0-9_-]{1,40}$')


def limpiar(texto):
    """Sin sustitutos UTF-16 sueltos (el tokenizador los rechaza: un emoji partido daba 502)."""
    return str(texto or '').encode('utf-8', 'replace').decode('utf-8').strip()


def recortar(texto, cabeza=200, cola=500):
    """Sin sustitutos sueltos y, si es largo, cabeza + … + cola (como recortarParaLaya en lib/laya.ts)."""
    t = limpiar(texto)
    if len(t) <= cabeza + cola:
        return t
    return t[:cabeza].rstrip() + ' … ' + t[-cola:].lstrip()


def normalizar(texto):
    """Clave para saber si dos textos son «el mismo»: sin tildes, minúsculas, espacios colapsados.

    Más laxa que el .lower() de electrum a propósito: los datos de mensaje y documento los escriben
    varias manos y «Hola, AU-RA» / «hola,  au-ra» en train y en test inflarían la prueba.
    """
    t = unicodedata.normalize('NFKD', limpiar(texto))
    t = ''.join(c for c in t if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', t).strip().lower()


def cargar_config(directorio):
    """Lee y valida modelo.json + preguntas.json. Falla con un mensaje que dice qué arreglar."""
    directorio = os.path.abspath(directorio)
    with open(os.path.join(directorio, 'modelo.json'), encoding='utf-8') as f:
        m = json.load(f)
    with open(os.path.join(directorio, 'preguntas.json'), encoding='utf-8') as f:
        preguntas = json.load(f)
    nombre, ids = m.get('nombre'), m.get('ids')
    if not isinstance(nombre, str) or not NOMBRE_VALIDO.match(nombre):
        raise ValueError(f'{directorio}/modelo.json: «nombre» debe ser [a-z0-9_-]+')
    if not isinstance(ids, list) or not ids or len(set(ids)) != len(ids):
        raise ValueError(f'{nombre}: «ids» debe ser una lista sin repetidos')
    if set(preguntas) != set(ids):
        faltan, sobran = sorted(set(ids) - set(preguntas)), sorted(set(preguntas) - set(ids))
        raise ValueError(f'{nombre}: preguntas.json no coincide con ids (faltan {faltan}, sobran {sobran})')
    for i in ids:
        if not isinstance(preguntas[i], dict) or preguntas[i].get('type') != 'noul':
            raise ValueError(f'{nombre}: la pregunta {i!r} no es noul; aquí todas son sí/no')
    grupos = m.get('grupos') or {}
    vistos = set()
    for g, miembros in grupos.items():
        if not isinstance(miembros, list) or len(miembros) < 2 or not set(miembros) <= set(ids):
            raise ValueError(f'{nombre}: el grupo {g!r} debe tener ≥2 ids de «ids»')
        if vistos & set(miembros):
            raise ValueError(f'{nombre}: el grupo {g!r} comparte ids con otro grupo')
        vistos |= set(miembros)
    r = m.get('recorte') or {}
    cabeza, cola = int(r.get('cabeza', 200)), int(r.get('cola', 500))
    if cabeza < 0 or cola < 0 or cabeza + cola < 50:
        raise ValueError(f'{nombre}: recorte raro {r}')
    rutas = {}
    for clave, patrones in (m.get('datos') or {}).items():
        if isinstance(patrones, str):
            patrones = [patrones]
        rutas[clave] = sorted({r for p in patrones for r in glob.glob(os.path.join(directorio, p))})
    return {'nombre': nombre, 'dir': directorio, 'ids': ids, 'grupos': grupos, 'preguntas': preguntas,
            'recorte': {'cabeza': cabeza, 'cola': cola}, 'rutas': rutas}


def leer_filas(rutas, ids, grupos, estricto=True, origen=False, recortar_a_ids=False):
    """Filas {"q", "e", ...} de varios .jsonl, validadas contra ids y grupos exclusivos.

    Conserva los demás campos (p. ej. «c», la categoría de un caso de borde; «nota»). Con origen,
    anota en «_archivo» de qué archivo vino (si no lo trae ya, p. ej. de reglas-mensaje.mjs). Junta TODOS los
    errores antes de fallar: con varias manos escribiendo datos, arreglar de uno en uno es eterno.
    """
    filas, errores = [], []
    for r in rutas:
        with open(r, encoding='utf-8') as f:
            for n, linea in enumerate(f, 1):
                linea = linea.strip()
                if not linea:
                    continue
                try:
                    d = json.loads(linea)
                except ValueError as e:
                    errores.append(f'{r}:{n} no es JSON ({e})')
                    continue
                q, e = d.get('q'), d.get('e')
                if not isinstance(q, str) or not q.strip():
                    errores.append(f'{r}:{n} sin texto')
                    continue
                if not isinstance(e, list) or not all(isinstance(x, str) for x in e):
                    errores.append(f'{r}:{n} «e» no es una lista de ids')
                    continue
                e = list(dict.fromkeys(e))
                raras = [x for x in e if x not in ids]
                if raras and recortar_a_ids:
                    # Al evaluar un checkpoint VIEJO con datos nuevos (p. ej. «comando» sin el grupo `app`
                    # de AU-RA): las etiquetas que ese checkpoint no conoce se quitan, no son un error.
                    e = [x for x in e if x in ids]
                    raras = []
                if raras:
                    errores.append(f'{r}:{n} etiqueta rara {raras}')
                    continue
                for g, miembros in grupos.items():
                    k = [x for x in e if x in miembros]
                    if len(k) != 1:
                        errores.append(f'{r}:{n} grupo {g}: debe llevar exactamente uno y lleva {k}')
                fila = {**d, 'q': q.strip(), 'e': e}
                if origen:
                    fila.setdefault('_archivo', os.path.splitext(os.path.basename(r))[0])
                filas.append(fila)
    if errores and estricto:
        raise SystemExit('datos inválidos:\n  ' + '\n  '.join(errores[:40])
                         + (f'\n  … y {len(errores) - 40} más' if len(errores) > 40 else ''))
    return filas


def decidir(p, grupos, umbrales):
    """{id: P} → (etiquetas sueltas ≥ su umbral, de mayor a menor P; {grupo: ganador por argmax}).

    Solo decide sobre los ids que trae p: si se pidió un subconjunto, lo demás no existe.
    """
    en_grupo = {i for m in grupos.values() for i in m}
    etiquetas = sorted((i for i in p if i not in en_grupo and p[i] >= umbrales[i]), key=lambda i: -p[i])
    ganadores = {}
    for g, miembros in grupos.items():
        presentes = [i for i in miembros if i in p]
        if presentes:
            ganadores[g] = max(presentes, key=lambda i: p[i])
    return etiquetas, ganadores
