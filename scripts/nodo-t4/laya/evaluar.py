"""Mide un modelo de Laya sobre sus pruebas apartadas.

Dos modos. Con --tabla, electrum como siempre (abajo). Sin --tabla, cualquier modelo de
modelos/<nombre>/ (ver main_decisor al final):

    python evaluar.py --modelo /opt/laya/modelo-mensaje --modelo-dir modelos/mensaje \
        [--test x.jsonl ...] [--bordes y.jsonl ...] [--evals z.jsonl ...] [--errores 30] [--json salida.json]

Electrum: compara, sobre la prueba apartada, la tabla de palabras actual con Laya y con el híbrido.

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

from comun import cargar_config, decidir, leer_filas
from servidor import Decisor, Modelo


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


def main_electrum(a):
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
        casos = [json.loads(l) for r in a.bordes for l in open(r, encoding='utf-8') if l.strip()]
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


# ------------------------------------------------------------------ modelos genéricos

def por_etiqueta(filas, clave, ids, cubre=None):
    """Precisión, recall, F1 y soporte por etiqueta. `cubre(f)` limita, fila a fila, las etiquetas
    que cuentan (las reglas no opinan de todas)."""
    salida = {}
    for i in ids:
        tp = fp = fn = 0
        for f in filas:
            if cubre and i not in cubre(f):
                continue
            pred, oro = i in f[clave], i in f['e']
            tp += pred and oro; fp += pred and not oro; fn += oro and not pred
        p, r = tp / max(1, tp + fp), tp / max(1, tp + fn)
        salida[i] = {'precision': p, 'recall': r, 'f1': 2 * p * r / max(1e-9, p + r), 'soporte': tp + fn,
                     'predichos': tp + fp, 'tp': tp}
    return salida


def resumen(filas, clave, ids, grupos, cubre=None):
    """Exactitud de cada grupo, «todas bien» (el conjunto entero igual al etiquetado, o solo en las
    etiquetas que cubre `cubre`), F1 micro y macro de las etiquetas sueltas."""
    en_grupo = {i for m in grupos.values() for i in m}
    n = max(1, len(filas))
    m = {'n': len(filas)}
    for g, miembros in grupos.items():
        if cubre and not all(i in cubre(f) for f in filas for i in miembros):
            continue
        m[f'grupo_{g}'] = sum(1 for f in filas if [i for i in miembros if i in f[clave]] ==
                              [i for i in miembros if i in f['e']]) / n
    todas = 0
    for f in filas:
        c = set(cubre(f)) if cubre else set(ids)
        todas += set(f[clave]) & c == set(f['e']) & c
    m['todas_bien'] = todas / n
    pe = por_etiqueta(filas, clave, [i for i in ids if i not in en_grupo], cubre)
    tp = sum(v['tp'] for v in pe.values())
    soporte = sum(v['soporte'] for v in pe.values())
    predichos = sum(v['predichos'] for v in pe.values())
    prec, rec = tp / max(1, predichos), tp / max(1, soporte)
    m['f1_micro'] = 2 * prec * rec / max(1e-9, prec + rec)
    con_soporte = [v['f1'] for v in pe.values() if v['soporte']]
    m['f1_macro'] = sum(con_soporte) / max(1, len(con_soporte))
    # Cuántas etiquetas sueltas hay: con 0 (todo en grupos, como «comando») el F1 macro no dice nada
    # y comparar.py decide por la exactitud de cada grupo.
    m['sueltas'] = len(pe)
    return m


def anotar_decisor(m, filas, umbrales=None):
    P = m.probabilidades([f['q'] for f in filas])
    for f, p in zip(filas, P):
        etiquetas, ganadores = decidir(p, m.grupos, umbrales or m.umbrales)
        f['p'] = p
        f['laya'] = etiquetas + list(ganadores.values())


def leer_conjunto(rutas, m):
    # Un checkpoint anterior puede no conocer etiquetas nuevas de los datos: se recortan a las suyas.
    filas = leer_filas(rutas, m.ids, m.grupos, origen=True, recortar_a_ids=True)
    for f in filas:
        if 'reglas' in f:
            f['reglas_cubre'] = f.get('reglas_cubre') or []
    return filas


def informe_conjunto(nombre, filas, m, errores, u_global):
    """Imprime y devuelve las cifras de un conjunto (test o evals)."""
    ids, grupos = m.ids, m.grupos
    hay_reglas = all('reglas' in f for f in filas)
    cubre = (lambda f: f['reglas_cubre']) if hay_reglas else None
    out = {'laya': resumen(filas, 'laya', ids, grupos), 'por_etiqueta': {'laya': por_etiqueta(filas, 'laya', ids)}}
    L = out['laya']
    grupos_txt = ' · '.join(f'grupo {g} {L[f"grupo_{g}"]:.3f}' for g in grupos)
    print(f'\n== {nombre}: {len(filas)} textos ==')
    print(f'laya: todas bien {L["todas_bien"]:.3f} · {grupos_txt} · F1 sueltas micro {L["f1_micro"]:.3f} / '
          f'macro {L["f1_macro"]:.3f}')
    if u_global is not None:
        copia = [dict(f) for f in filas]
        for f in copia:
            et, gan = decidir(f['p'], grupos, {i: u_global for i in ids})
            f['laya'] = et + list(gan.values())
        G = resumen(copia, 'laya', ids, grupos)
        out['laya_umbral_global'] = G
        print(f'  (con un solo umbral {u_global} para todas: todas bien {G["todas_bien"]:.3f} · '
              f'F1 micro {G["f1_micro"]:.3f} / macro {G["f1_macro"]:.3f}; diagnóstico, no se elige aquí)')
    if hay_reglas:
        R, Lc = resumen(filas, 'reglas', ids, grupos, cubre), resumen(filas, 'laya', ids, grupos, cubre)
        out['reglas'], out['laya_en_lo_que_cubren_las_reglas'] = R, Lc
        out['por_etiqueta']['reglas'] = por_etiqueta(filas, 'reglas', ids, cubre)
        out['por_etiqueta']['laya_cubiertas'] = por_etiqueta(filas, 'laya', ids, cubre)
        gr = ' · '.join(f'grupo {g} {R[f"grupo_{g}"]:.3f} vs {Lc[f"grupo_{g}"]:.3f}' for g in grupos if f'grupo_{g}' in R)
        print(f'reglas vs laya, solo en lo que cubren las reglas: todas bien {R["todas_bien"]:.3f} vs '
              f'{Lc["todas_bien"]:.3f} · {gr}')
    print('\npor etiqueta (precisión / recall / F1 · soporte)' + ('   ·   reglas (P / R / F1)' if hay_reglas else ''))
    pl = out['por_etiqueta']['laya']
    pr = out['por_etiqueta'].get('reglas', {})
    for i in ids:
        x = pl[i]
        linea = f'  {i:22}{x["precision"]:7.2f}{x["recall"]:7.2f}{x["f1"]:7.2f} · {x["soporte"]:4d}'
        if hay_reglas and any(i in f['reglas_cubre'] for f in filas):
            y = pr[i]
            linea += f'   ·  {y["precision"]:6.2f}{y["recall"]:7.2f}{y["f1"]:7.2f}'
        elif hay_reglas:
            linea += '   ·  (sin regla)'
        print(linea)
    cal = calibracion(filas, ids)
    out['calibracion'] = cal
    print(f'calibración ({cal["pares"]} pares texto×pregunta): Brier {cal["brier"]:.4f} · ECE {cal["ece"]:.4f}')
    for c in cal['tabla']:
        print(f'  [{c["desde"]:.1f}, {c["hasta"]:.1f})  n={c["n"]:5d}  P media {c["p_media"]:.3f}  '
              f'frecuencia real {c["frecuencia"]:.3f}')
    if errores:
        malos = [f for f in filas if set(f['laya']) != set(f['e'])]
        print(f'\nfallos ({len(malos)}; oro → laya · P de lo que difiere):')
        for f in malos[:errores]:
            print(fallo(f))
    return out


def fallo(f):
    dif = sorted(set(f['laya']) ^ set(f['e']))
    ps = ' '.join(f'{k}={f["p"][k]:.2f}' for k in dif)
    t = ' '.join(f['q'].split())  # un fragmento de documento trae saltos de línea: una sola línea al listar
    q = t if len(t) <= 110 else f'{t[:50]} … {t[-50:]} ({len(f["q"])} car.)'
    reglas = f' · reglas {"✓" if bien_reglas(f) else "✗"}' if 'reglas' in f else ''
    nota = f'\n      nota: {f["nota"][:140]}' if f.get('nota') else ''
    return f'  {tipo(f):14} {sorted(f["e"])} → {sorted(f["laya"])} · {ps}{reglas}\n      {q}{nota}'


def tipo(f):
    """La categoría del caso: «c» si la trae; si no, el archivo de donde vino (bordes_aura…)."""
    return f.get('c') or f.get('_archivo') or '-'


def bien_reglas(f):
    c = set(f['reglas_cubre'])
    return set(f['reglas']) & c == set(f['e']) & c


def main_decisor(a):
    m = Modelo(a.nombre or 'modelo', a.modelo, a.device)
    d = m.agente.cfg.get('decisor', {})
    conf = cargar_config(a.modelo_dir) if a.modelo_dir else {'rutas': {}}
    if conf.get('ids') and conf['ids'] != m.ids:
        print(f'AVISO: los ids de {a.modelo_dir}/modelo.json no son los del checkpoint; mando el checkpoint')
    rutas = {'test': a.test or conf['rutas'].get('test', []), 'evals': a.evals or conf['rutas'].get('evals', []),
             'bordes': a.bordes or conf['rutas'].get('bordes', [])}
    u_global = d.get('umbral_global')
    informe = {'temperatura': m.temp, 'umbrales': m.umbrales_de(m.ids), 'umbral_global': u_global,
               'recorte': [m.cabeza, m.cola], 'validacion': d.get('validacion')}
    print(f'{d.get("nombre", a.modelo)} · temperatura {m.temp:.3f} · recorte {m.cabeza}/{m.cola} · '
          f'umbral global {u_global} · umbrales {json.dumps(informe["umbrales"])}')
    for nombre in ('test', 'evals'):
        if rutas[nombre]:
            filas = leer_conjunto(rutas[nombre], m)
            anotar_decisor(m, filas)
            informe[nombre] = informe_conjunto(nombre, filas, m, a.errores, u_global)
    if rutas['bordes']:
        casos = leer_conjunto(rutas['bordes'], m)
        anotar_decisor(m, casos)
        informe['bordes'] = informe_conjunto('bordes', casos, m, 0, None)
        malos = [f for f in casos if set(f['laya']) != set(f['e'])]
        print(f'\ncasos de borde que fallan: {len(malos)} de {len(casos)} (oro → laya · P de lo que difiere)')
        por_tipo = {}
        for f in casos:
            r = por_tipo.setdefault(tipo(f), {'n': 0, 'laya': 0, 'reglas': 0})
            r['n'] += 1
            r['laya'] += set(f['laya']) == set(f['e'])
            r['reglas'] += 'reglas' in f and bien_reglas(f)
        for f in malos:
            print(fallo(f))
        print('  por tipo (aciertos laya' + (' / reglas en lo que cubren' if casos and 'reglas' in casos[0] else '') + '):')
        for c, r in por_tipo.items():
            print(f'    {c:14} {r["laya"]}/{r["n"]}' + (f'  ·  {r["reglas"]}/{r["n"]}' if 'reglas' in casos[0] else ''))
        informe['bordes_por_tipo'] = por_tipo
    if not any(rutas.values()):
        print('no hay nada que evaluar: pasá --modelo-dir o --test/--bordes/--evals')
    if a.json:
        with open(a.json, 'w', encoding='utf-8') as fh:
            json.dump(informe, fh, ensure_ascii=False, indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--modelo', required=True, help='el checkpoint (directorio de entrenar.py --salida)')
    ap.add_argument('--tabla', help='electrum: prueba anotada por tabla.mjs (datos/test-tabla.jsonl)')
    ap.add_argument('--modelo-dir', help='genérico: carpeta con modelo.json, de donde salen test/bordes/evals')
    ap.add_argument('--test', nargs='+', help='genérico: en lugar de los test de modelo.json (p. ej. anotados por reglas-mensaje.mjs)')
    ap.add_argument('--evals', nargs='+', help='genérico: en lugar de los evals de modelo.json')
    ap.add_argument('--bordes', nargs='+', help='casos difíciles (electrum: anotados por tabla.mjs)')
    ap.add_argument('--nombre', help='genérico: cómo llamarlo en el informe')
    ap.add_argument('--device', default=None)
    ap.add_argument('--errores', type=int, default=0, help='cuántos fallos listar')
    ap.add_argument('--json', help='guarda aquí todas las cifras')
    a = ap.parse_args()
    if a.tabla:
        main_electrum(a)
    else:
        main_decisor(a)


if __name__ == '__main__':
    main()
