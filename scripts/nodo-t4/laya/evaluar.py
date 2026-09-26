"""Compara, sobre la prueba apartada, la tabla de palabras actual con Laya y con el híbrido.

    npx tsx tabla.mjs ../../../server/electrum/especialistas.ts datos/test.jsonl > datos/test-tabla.jsonl
    python evaluar.py --modelo modelo-electrum --tabla datos/test-tabla.jsonl [--errores 30]

test-tabla.jsonl trae, por consulta, la etiqueta (e), lo que decide la tabla (tabla) y a quién nombró
el usuario (explicitos). El híbrido es lo que corre en producción (decidirPanel en server/electrum/especialistas.ts): los nombrados
van primero y el resto lo decide Laya.
"""
import argparse
import json

from servidor import Decisor


def metricas(filas, clave):
    exacto = principal = vacios = vacios_ok = tp = fp = fn = 0
    for f in filas:
        pred, oro = f[clave], f['e']
        exacto += set(pred) == set(oro)
        principal += pred[:1] == oro[:1]
        if not oro:
            vacios += 1
            vacios_ok += not pred
        tp += len(set(pred) & set(oro))
        fp += len(set(pred) - set(oro))
        fn += len(set(oro) - set(pred))
    n = len(filas)
    prec, rec = tp / max(1, tp + fp), tp / max(1, tp + fn)
    return {'exacto': exacto / n, 'principal': principal / n, 'f1': 2 * prec * rec / max(1e-9, prec + rec),
            'precision': prec, 'recall': rec, 'vacios': vacios_ok / max(1, vacios), 'n': n}


def hibrido(explicitos, panel, maximo=2):
    salida = list(dict.fromkeys(explicitos))
    for i in panel:
        if i not in salida:
            salida.append(i)
    return salida[:maximo]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--modelo', required=True)
    ap.add_argument('--tabla', required=True)
    ap.add_argument('--errores', type=int, default=0, help='cuántos fallos del híbrido listar')
    a = ap.parse_args()

    filas = [json.loads(l) for l in open(a.tabla, encoding='utf-8') if l.strip()]
    d = Decisor(a.modelo)
    P = d.probabilidades([f['q'] for f in filas])
    for f, p in zip(filas, P):
        f['p'] = p
        f['laya'] = d.panel(p)
        f['hibrido'] = hibrido(f['explicitos'], f['laya'], d.maximo)

    print(f'prueba apartada: {len(filas)} consultas · umbral {d.umbral} · temperatura {d.temp:.3f}')
    print(f'{"":10}{"exacto":>8}{"principal":>10}{"f1":>7}{"precis.":>9}{"recall":>8}{"vacíos":>8}')
    for clave in ('tabla', 'laya', 'hibrido'):
        m = metricas(filas, clave)
        print(f'{clave:10}{m["exacto"]:8.3f}{m["principal"]:10.3f}{m["f1"]:7.3f}{m["precision"]:9.3f}'
              f'{m["recall"]:8.3f}{m["vacios"]:8.3f}')

    if a.errores:
        print('\nfallos del híbrido (oro → decidido · P de los decididos y de los que faltaron):')
        for f in [f for f in filas if set(f['hibrido']) != set(f['e'])][:a.errores]:
            ps = ' '.join(f'{k}={f["p"][k]:.2f}' for k in dict.fromkeys(f['hibrido'] + f['e']))
            print(f'  {f["e"]} → {f["hibrido"]} · {ps} · tabla {f["tabla"]}\n    {f["q"][:140]}')


if __name__ == '__main__':
    main()
