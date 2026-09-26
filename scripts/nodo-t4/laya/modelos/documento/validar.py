"""Valida los datos del modelo `documento` (ESPEC.md).

    python validar.py [carpeta_datos]

JSON válido, exactamente un doc_*, etiquetas de preguntas.json, largo 150-900, sin duplicados exactos
y sin casi-duplicados entre train y test (tejas de 3 palabras, sin números: Jaccard >= 0.5).
Imprime los positivos por etiqueta. Sale con código 1 si algo falla.
"""
import glob
import json
import os
import re
import sys
import unicodedata

AQUI = os.path.dirname(os.path.abspath(__file__))
IDS = list(json.load(open(os.path.join(AQUI, 'preguntas.json'), encoding='utf-8')))
DOCS = [i for i in IDS if i.startswith('doc_')]
REQS = [i for i in IDS if i.startswith('req_')]
MINIMOS = {**{d: 90 for d in DOCS}, 'doc_otro': 60, **{r: 120 for r in REQS}}
UMBRAL_CASI = 0.5


def normal(t):
    t = unicodedata.normalize('NFKD', t.lower())
    t = ''.join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r'\d', '0', t)
    t = re.sub(r'[^a-z0\s]', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def tejas(t, k=3):
    w = [p for p in normal(t).split() if not set(p) <= {'0'}]
    return {' '.join(w[i:i + k]) for i in range(max(1, len(w) - k + 1))}


def jaccard(a, b):
    return len(a & b) / len(a | b) if a and b else 0.0


def leer(ruta, errores, con_nota=False):
    filas = []
    with open(ruta, encoding='utf-8') as fh:
        for n, linea in enumerate(fh, 1):
            if not linea.strip():
                continue
            donde = f'{os.path.basename(ruta)}:{n}'
            try:
                d = json.loads(linea)
            except json.JSONDecodeError as ex:
                errores.append(f'{donde} JSON inválido: {ex}')
                continue
            q, e = d.get('q'), d.get('e')
            if not isinstance(q, str) or not q.strip():
                errores.append(f'{donde} sin texto')
                continue
            if not isinstance(e, list) or not all(isinstance(x, str) for x in e):
                errores.append(f'{donde} "e" no es lista de etiquetas')
                continue
            raras = [x for x in e if x not in IDS]
            if raras:
                errores.append(f'{donde} etiquetas no permitidas {raras}')
            if len(set(e)) != len(e):
                errores.append(f'{donde} etiquetas repetidas {e}')
            ndoc = sum(x in DOCS for x in e)
            if ndoc != 1:
                errores.append(f'{donde} {ndoc} doc_* (debe ser exactamente uno): {e}')
            if not 150 <= len(q) <= 900:
                errores.append(f'{donde} largo {len(q)} fuera de 150-900')
            if con_nota and not (isinstance(d.get('nota'), str) and d['nota'].strip()):
                errores.append(f'{donde} sin "nota"')
            filas.append({'q': q, 'e': e, 'donde': donde})
    return filas


def clave(q):
    return re.sub(r'\s+', ' ', q.strip().lower())


def conteo(filas):
    return {i: sum(i in f['e'] for f in filas) for i in IDS}


def main():
    carpeta = sys.argv[1] if len(sys.argv) > 1 else os.path.join(AQUI, 'datos')
    errores, avisos = [], []
    rutas_train = sorted(glob.glob(os.path.join(carpeta, 'train_*.jsonl')))
    if not rutas_train:
        errores.append('no hay train_*.jsonl')
    train, lineas = [], {}
    for r in rutas_train:
        f = leer(r, errores)
        lineas[os.path.basename(r)] = len(f)
        train += f
    test = leer(os.path.join(carpeta, 'test.jsonl'), errores)
    lineas['test.jsonl'] = len(test)
    ruta_b = os.path.join(carpeta, 'bordes.jsonl')
    bordes = leer(ruta_b, errores, con_nota=True) if os.path.exists(ruta_b) else []
    lineas['bordes.jsonl'] = len(bordes)

    # duplicados exactos (sin distinguir mayúsculas ni espacios), dentro y entre conjuntos
    vistos = {}
    for nombre, filas in (('train', train), ('test', test), ('bordes', bordes)):
        for f in filas:
            k = clave(f['q'])
            if k in vistos:
                errores.append(f'duplicado exacto: {f["donde"]} = {vistos[k]}')
            else:
                vistos[k] = f['donde']

    # casi-duplicados entre train y test, y entre train y bordes
    tj_train = [tejas(f['q']) for f in train]
    peor_test = 0.0
    for nombre, filas in (('test', test), ('bordes', bordes)):
        for f in filas:
            t = tejas(f['q'])
            j, i = max(((jaccard(t, o), i) for i, o in enumerate(tj_train)), default=(0.0, -1))
            if nombre == 'test':
                peor_test = max(peor_test, j)
            if j >= UMBRAL_CASI:
                errores.append(f'casi-duplicado ({j:.2f}) {f["donde"]} ~ {train[i]["donde"]}')

    ct, cs, cb = conteo(train), conteo(test), conteo(bordes)
    for i, m in MINIMOS.items():
        if ct[i] < m:
            avisos.append(f'{i}: {ct[i]} positivos en train (mínimo {m})')

    print('líneas:', ', '.join(f'{k} {v}' for k, v in lineas.items()), f'· train total {len(train)}')
    print(f'casi-duplicado más alto test~train: Jaccard {peor_test:.2f} (umbral {UMBRAL_CASI})')
    print()
    print(f'{"etiqueta":22s} {"train":>6s} {"%":>6s} {"test":>6s} {"%":>6s} {"bordes":>7s}')
    for i in IDS:
        pt = 100 * ct[i] / max(1, len(train))
        ps = 100 * cs[i] / max(1, len(test))
        print(f'{i:22s} {ct[i]:6d} {pt:5.1f}% {cs[i]:6d} {ps:5.1f}% {cb[i]:7d}')
    print()
    for a in avisos:
        print('AVISO', a)
    for e in errores[:50]:
        print('ERROR', e)
    if len(errores) > 50:
        print(f'... y {len(errores) - 50} errores más')
    print('OK' if not errores else f'{len(errores)} errores')
    sys.exit(1 if errores else 0)


if __name__ == '__main__':
    main()
