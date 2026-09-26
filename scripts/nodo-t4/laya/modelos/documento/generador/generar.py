"""Genera train_*.jsonl y test.jsonl del modelo `documento`.

    python generar.py ../datos   (desde modelos/documento/generador/)
"""
import json
import os
import sys
from collections import Counter

import comun
from comun import R, MODO, LETRA, armar, ocr, ctx_nuevo, tejas, jaccard
import tipos_a as A
import tipos_b as B
import fin_otro as FO

GEN = {
    'doc_resolucion': (A.g_resolucion, A.medio_resolucion),
    'doc_contrato': (A.g_contrato, A.medio_contrato),
    'doc_ambiental': (A.g_ambiental, A.medio_ambiental),
    'doc_tecnico': (A.g_tecnico, A.medio_tecnico),
    'doc_plano': (B.g_plano, B.medio_plano),
    'doc_financiero': (FO.g_financiero, FO.medio_financiero),
    'doc_solicitud': (B.g_solicitud, B.medio_solicitud),
    'doc_otro': (FO.g_otro, FO.medio_otro),
}
CUOTA_TRAIN = {'doc_resolucion': 170, 'doc_contrato': 145, 'doc_ambiental': 150, 'doc_tecnico': 140,
               'doc_plano': 115, 'doc_financiero': 125, 'doc_solicitud': 160, 'doc_otro': 95}
REQ = ['req_firma_autoridad', 'req_coordenadas', 'req_agua', 'req_comunidad', 'req_cierre', 'req_plazo']
DOCS = list(GEN)


def uno(doc):
    g, medio = GEN[doc]
    c = ctx_nuevo()
    if R.random() < 0.11:
        segs = medio(c)
        # el troceado real arrastra 120 caracteres del trozo anterior: se empieza a mitad de frase
        if segs[0].cortable and R.random() < 0.5 and len(segs[0].texto) > 80:
            segs[0].texto = comun.recortar_inicio(segs[0].texto, int(len(segs[0].texto) * R.uniform(0.35, 0.7)))
        texto, tags = armar(segs[:1], segs[1:])
        memb = ''
    else:
        cab, cola, memb = g(c)
        texto, tags = armar(cab, cola)
    if R.random() < 0.3:
        texto = ocr(texto, memb)
    texto = texto.strip()
    if not 150 <= len(texto) <= 900:
        return None
    e = [doc] + [LETRA[t] for t in 'FCAMXP' if t in tags]
    return {'q': texto, 'e': e}


def generar(cuota, contra=None, umbral_propio=0.55, umbral_contra=0.4):
    salida = {d: [] for d in cuota}
    tejas_d = {d: [] for d in cuota}
    contra = contra or []
    intentos = 0
    for d, n in cuota.items():
        while len(salida[d]) < n:
            intentos += 1
            if intentos > 400000:
                raise SystemExit(f'no alcanzo la cuota de {d}: {len(salida[d])}/{n}')
            f = uno(d)
            if not f:
                continue
            tj = tejas(f['q'])
            if any(jaccard(tj, o) >= umbral_propio for o in tejas_d[d]):
                continue
            if contra and any(jaccard(tj, o) >= umbral_contra for o in contra):
                continue
            salida[d].append(f)
            tejas_d[d].append(tj)
    return [f for d in cuota for f in salida[d]]


def generar_estratificado(train, cuota, contra, umbral_propio=0.55, umbral_contra=0.4, intentos_por=4000):
    """Test con la misma distribución de conjuntos de etiquetas que train, tipo por tipo: se sortea
    un conjunto de train y se genera hasta dar con uno igual que además no se parezca a nada de train."""
    salida = []
    for d, n in cuota.items():
        conjuntos = sorted(tuple(f['e']) for f in train if f['e'][0] == d)
        paso = len(conjuntos) / n
        inicio = R.random() * paso
        objetivos = [conjuntos[int(inicio + i * paso)] for i in range(n)]
        propios = []
        for obj in objetivos:
            hecho = False
            for _ in range(intentos_por):
                f = uno(d)
                if not f or tuple(f['e']) != obj:
                    continue
                tj = tejas(f['q'])
                if any(jaccard(tj, o) >= umbral_propio for o in propios):
                    continue
                if any(jaccard(tj, o) >= umbral_contra for o in contra):
                    continue
                salida.append(f)
                propios.append(tj)
                hecho = True
                break
            if not hecho:
                print(f'  aviso: no salió {obj} para test', file=sys.stderr)
    return salida


def contar(filas):
    c = Counter(e for f in filas for e in f['e'])
    return {k: c.get(k, 0) for k in DOCS + REQ}


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    MODO['split'] = 'train'
    train = generar(CUOTA_TRAIN)
    MODO['split'] = 'test'
    cuota_test = {d: round(n / 5) for d, n in CUOTA_TRAIN.items()}
    contra = [tejas(f['q']) for f in train]
    test = generar_estratificado(train, cuota_test, contra)
    R.shuffle(train)
    R.shuffle(test)
    partes = 'abcd'
    tam = -(-len(train) // len(partes))
    for i, p in enumerate(partes):
        with open(os.path.join(out, f'train_{p}.jsonl'), 'w', encoding='utf-8') as fh:
            for f in train[i * tam:(i + 1) * tam]:
                fh.write(json.dumps(f, ensure_ascii=False) + '\n')
    with open(os.path.join(out, 'test.jsonl'), 'w', encoding='utf-8') as fh:
        for f in test:
            fh.write(json.dumps(f, ensure_ascii=False) + '\n')
    ct, cs = contar(train), contar(test)
    print(f'train {len(train)} · test {len(test)}')
    for k in DOCS + REQ:
        print(f'{k:22s} {ct[k]:5d} {cs[k]:5d}')


if __name__ == '__main__':
    main()
