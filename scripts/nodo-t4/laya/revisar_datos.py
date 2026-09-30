"""Revisa los datos de un modelo de modelos/<nombre>/ SIN entrenar (sin torch ni GPU): lo que haría
entrenar.py antes de tocar el modelo, para enterarse aquí y no en el nodo.

    python revisar_datos.py modelos/comando

  · modelo.json y preguntas.json válidos (comun.cargar_config);
  · cada fila de cada conjunto con etiquetas conocidas y exactamente una por grupo (comun.leer_filas);
  · cuántas frases de entrenamiento se descartan por estar en test/val/evals/bordes, y cuántas repetidas;
  · que ninguna plantilla (`t`) esté en dos conjuntos (fugas), si las filas la traen;
  · cuántas frases hay por etiqueta, conjunto e idioma (`l`), y la validación estratificada que saldría.
Sale con 1 si algo está mal.
"""
import argparse
import os
import sys
from collections import Counter

from comun import cargar_config, leer_filas, normalizar
from entrenar import estratificar, textos_apartados


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('modelo_dir')
    ap.add_argument('--semilla', type=int, default=7)
    a = ap.parse_args()
    conf = cargar_config(a.modelo_dir)
    ids, grupos = conf['ids'], conf['grupos']
    print(f'{conf["nombre"]}: {len(ids)} preguntas · grupos {", ".join(f"{g} ({len(m)})" for g, m in grupos.items())}')
    conjuntos = {}
    for clave, rutas in conf['rutas'].items():
        conjuntos[clave] = leer_filas(rutas, ids, grupos, origen=True)
        print(f'  {clave:7} {len(conjuntos[clave]):6d} filas · {", ".join(os.path.basename(r) for r in rutas)}')
    malo = False
    apartados = textos_apartados(conf)
    vistos, en_prueba, repetidas, unicas = set(), 0, 0, []
    for f in conjuntos.get('train', []):
        k = normalizar(f['q'])
        if k in apartados:
            en_prueba += 1
        elif k in vistos:
            repetidas += 1
        else:
            vistos.add(k)
            unicas.append(f)
    print(f'  entrenamiento útil {len(unicas)} · descartadas {en_prueba} por estar apartadas, {repetidas} repetidas')
    plantillas = {c: {f['t'] for f in filas if f.get('t')} for c, filas in conjuntos.items()}
    claves = [c for c in plantillas if plantillas[c]]
    for i, c1 in enumerate(claves):
        for c2 in claves[i + 1:]:
            comun = plantillas[c1] & plantillas[c2]
            if comun:
                malo = True
                print(f'  FUGA: {len(comun)} plantillas en {c1} y en {c2}, p. ej. {sorted(comun)[:3]}')
    if not malo and claves:
        print(f'  sin fugas de plantillas entre {", ".join(claves)}')
    for g, miembros in grupos.items():
        print(f'\n  grupo {g}: frases por etiqueta (conjunto · idioma)')
        cols = [(c, l) for c in conjuntos for l in ('es', 'en')]
        cuentas = {c: Counter((e, f.get('l', 'es')) for f in conjuntos[c] for e in f['e'] if e in miembros) for c in conjuntos}
        print('    ' + ' ' * 26 + ''.join(f'{c[:6] + "·" + l:>10}' for c, l in cols))
        for e in miembros:
            fila = ''.join(f'{cuentas[c][(e, l)]:10d}' for c, l in cols)
            print(f'    {e:26}{fila}')
            if not any(e in f['e'] for f in unicas):
                malo = True
                print(f'    FALTA: {e} sin ningún ejemplo de entrenamiento')
    val, ent = estratificar(unicas, grupos, a.semilla, min(max(40, len(unicas) // 10), len(unicas) // 4))
    print(f'\n  entrenar.py separaría: entrenamiento {len(ent)} · validación {len(val)} (estratificada, semilla {a.semilla})')
    print('RESULTADO: ' + ('HAY PROBLEMAS' if malo else 'datos listos para entrenar'))
    sys.exit(1 if malo else 0)


if __name__ == '__main__':
    main()
