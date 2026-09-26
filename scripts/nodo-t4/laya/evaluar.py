"""Compara, sobre la prueba apartada, la tabla de palabras actual con Laya y con el híbrido.

    npx tsx tabla.mjs ../../../server/electrum/especialistas.ts datos/test.jsonl > datos/test-tabla.jsonl
    npx tsx tabla.mjs ../../../server/electrum/especialistas.ts datos/bordes.jsonl > datos/bordes-tabla.jsonl
    python evaluar.py --modelo modelo-electrum --tabla datos/test-tabla.jsonl \
        [--bordes datos/bordes-tabla.jsonl] [--errores 30] [--json salida.json]

test-tabla.jsonl trae, por consulta, la etiqueta (e), lo que decide la tabla (tabla) y a quién nombró
el usuario (explicitos). El híbrido es lo que corre en producción (decidirPanel en
server/electrum/especialistas.ts): los nombrados van primero, el resto lo decide Laya, y si así no
queda nadie decide la tabla.

Imprime, para los tres: exacto, principal, F1 micro, precisión, recall y «nadie» bien; la misma
cuenta por especialista; la calibración de las probabilidades de Laya (Brier, ECE y la tabla de
fiabilidad), la sensibilidad al umbral (solo diagnóstico: el umbral se elige en validación, nunca
aquí) y, con --bordes, los casos difíciles uno por uno (saludos, inglés, faltas, nombres de
concesiones, varias especialidades, textos largos).
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


def por_especialista(filas, clave, ids):
    salida = {}
    for i in ids:
        tp = sum(1 for f in filas if i in f[clave] and i in f['e'])
        fp = sum(1 for f in filas if i in f[clave] and i not in f['e'])
        fn = sum(1 for f in filas if i not in f[clave] and i in f['e'])
        p, r = tp / max(1, tp + fp), tp / max(1, tp + fn)
        salida[i] = {'precision': p, 'recall': r, 'f1': 2 * p * r / max(1e-9, p + r), 'soporte': tp + fn}
    return salida


def calibracion(filas, ids, cubetas=10):
    """P(sí) de cada (consulta, especialista) contra la etiqueta: Brier, ECE y tabla de fiabilidad."""
    pares = [(f['p'][i], 1.0 if i in f['e'] else 0.0) for f in filas for i in ids]
    brier = sum((p - y) ** 2 for p, y in pares) / len(pares)
    tabla, ece = [], 0.0
    for k in range(cubetas):
        lo, hi = k / cubetas, (k + 1) / cubetas
        dentro = [(p, y) for p, y in pares if lo <= p < hi or (k == cubetas - 1 and p == 1.0)]
        if not dentro:
            continue
        conf = sum(p for p, _ in dentro) / len(dentro)
        frec = sum(y for _, y in dentro) / len(dentro)
        ece += len(dentro) / len(pares) * abs(conf - frec)
        tabla.append({'desde': lo, 'hasta': hi, 'n': len(dentro), 'p_media': conf, 'frecuencia': frec})
    return {'brier': brier, 'ece': ece, 'pares': len(pares), 'tabla': tabla}


def hibrido(explicitos, panel, tabla, maximo=2):
    salida = list(dict.fromkeys(explicitos))
    for i in panel:
        if i not in salida:
            salida.append(i)
    return salida[:maximo] or list(tabla)[:maximo]


def bien(f, clave):
    """Un caso de borde pasa si el panel es el etiquetado; con «acepta», si son dos de los aceptables."""
    pred = f[clave]
    if f.get('acepta'):
        return len(pred) == min(2, len(f['acepta'])) and set(pred) <= set(f['acepta'])
    return set(pred) == set(f['e'])


def anotar(d, filas):
    P = d.probabilidades([f['q'] for f in filas])
    for f, p in zip(filas, P):
        f['p'] = p
        f['laya'] = d.panel(p)
        f['hibrido'] = hibrido(f['explicitos'], f['laya'], f['tabla'], d.maximo)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--modelo', required=True)
    ap.add_argument('--tabla', required=True)
    ap.add_argument('--bordes', help='casos difíciles anotados por tabla.mjs (datos/bordes.jsonl)')
    ap.add_argument('--errores', type=int, default=0, help='cuántos fallos del híbrido listar')
    ap.add_argument('--json', help='guarda aquí todas las cifras')
    a = ap.parse_args()

    filas = [json.loads(l) for l in open(a.tabla, encoding='utf-8') if l.strip()]
    d = Decisor(a.modelo)
    anotar(d, filas)
    informe = {'umbral': d.umbral, 'temperatura': d.temp, 'n': len(filas)}

    print(f'prueba apartada: {len(filas)} consultas · umbral {d.umbral} · temperatura {d.temp:.3f}')
    print(f'{"":10}{"exacto":>8}{"principal":>10}{"f1":>7}{"precis.":>9}{"recall":>8}{"vacíos":>8}')
    for clave in ('tabla', 'laya', 'hibrido'):
        m = metricas(filas, clave)
        informe[clave] = m
        print(f'{clave:10}{m["exacto"]:8.3f}{m["principal"]:10.3f}{m["f1"]:7.3f}{m["precision"]:9.3f}'
              f'{m["recall"]:8.3f}{m["vacios"]:8.3f}')

    print('\npor especialista (precisión / recall / F1 · soporte):')
    print(f'{"":14}{"tabla":>22}{"híbrido (Laya)":>24}')
    pe_t, pe_h = por_especialista(filas, 'tabla', d.ids), por_especialista(filas, 'hibrido', d.ids)
    informe['por_especialista'] = {'tabla': pe_t, 'hibrido': pe_h}
    for i in d.ids:
        t, h = pe_t[i], pe_h[i]
        print(f'{i:14}{t["precision"]:8.2f}{t["recall"]:7.2f}{t["f1"]:7.2f}   {h["precision"]:8.2f}{h["recall"]:7.2f}'
              f'{h["f1"]:7.2f} · {h["soporte"]}')

    cal = calibracion(filas, d.ids)
    informe['calibracion'] = cal
    print(f'\ncalibración de P(sí) ({cal["pares"]} pares consulta×especialista): Brier {cal["brier"]:.4f} · '
          f'ECE {cal["ece"]:.4f}')
    for c in cal['tabla']:
        print(f'  [{c["desde"]:.1f}, {c["hasta"]:.1f})  n={c["n"]:4d}  P media {c["p_media"]:.3f}  '
              f'frecuencia real {c["frecuencia"]:.3f}')

    print('\nsensibilidad al umbral (diagnóstico; el umbral se elige en validación):')
    umbral_real, sens = d.umbral, {}
    for u in (0.3, 0.4, 0.5, 0.6, 0.7):
        d.umbral = u
        for f in filas:
            f['_u'] = hibrido(f['explicitos'], d.panel(f['p']), f['tabla'], d.maximo)
        m = metricas(filas, '_u')
        sens[u] = m
        print(f'  umbral {u:.1f}: exacto {m["exacto"]:.3f} · f1 {m["f1"]:.3f} · vacíos {m["vacios"]:.3f}')
    d.umbral = umbral_real
    informe['sensibilidad_umbral'] = sens

    if a.errores:
        print('\nfallos del híbrido (oro → decidido · P de los decididos y de los que faltaron):')
        for f in [f for f in filas if set(f['hibrido']) != set(f['e'])][:a.errores]:
            ps = ' '.join(f'{k}={f["p"][k]:.2f}' for k in dict.fromkeys(f['hibrido'] + f['e']))
            print(f'  {f["e"]} → {f["hibrido"]} · {ps} · tabla {f["tabla"]}\n    {f["q"][:140]}')

    if a.bordes:
        casos = [json.loads(l) for l in open(a.bordes, encoding='utf-8') if l.strip()]
        anotar(d, casos)
        print(f'\ncasos de borde ({len(casos)}): ✓ = acierta el panel entero')
        resumen = {}
        for f in casos:
            r = resumen.setdefault(f.get('c', '-'), {'n': 0, 'tabla': 0, 'hibrido': 0})
            r['n'] += 1
            r['tabla'] += bien(f, 'tabla')
            r['hibrido'] += bien(f, 'hibrido')
            top = sorted(f['p'].items(), key=lambda kv: -kv[1])[:2]
            oro = f['e'] or (['2 de ' + '/'.join(f['acepta'])] if f.get('acepta') else [])
            q = f['q'] if len(f['q']) <= 90 else f'{f["q"][:40]} … {f["q"][-45:]} ({len(f["q"])} car.)'
            print(f'  {f.get("c", "-"):8} {"✓" if bien(f, "hibrido") else "✗"} laya {f["hibrido"]}'
                  f' {"✓" if bien(f, "tabla") else "✗"} tabla {f["tabla"]} · oro {oro}'
                  f' · {" ".join(f"{k}={v:.2f}" for k, v in top)}\n      {q}')
        print('  por tipo (aciertos laya / tabla):')
        for c, r in resumen.items():
            print(f'    {c:8} {r["hibrido"]}/{r["n"]}  ·  {r["tabla"]}/{r["n"]}')
        informe['bordes'] = resumen

    if a.json:
        with open(a.json, 'w', encoding='utf-8') as fh:
            json.dump(informe, fh, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
