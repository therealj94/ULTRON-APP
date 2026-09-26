"""Ajusta Laya (multilingüe) para decidir qué especialistas de Dr Electrum convocar.

Una pregunta noul por especialista (preguntas.json): el modelo da P(sí) calibrada para cada uno y
decidir.py convoca como mucho dos por encima del umbral. Aquí se entrena, se calibra la temperatura
de las noul sobre validación, se elige el umbral y se guarda un checkpoint que `laya.load(dir)` lee.

    python entrenar.py --datos datos/ --salida modelo-electrum/ [--epocas 4]

Corre en CPU (lento pero alcanza para unos miles de filas) o en la T4 con --device cuda.
"""
import argparse
import glob
import json
import math
import os
import random
import shutil
import time

import numpy as np
import torch
import laya
from laya.common import collate_items
from safetensors.torch import save_file

AQUI = os.path.dirname(os.path.abspath(__file__))
IDS = ['geologo', 'minas', 'civil', 'metalurgista', 'geomatica', 'ambiental', 'legal', 'economista']


def leer(rutas):
    filas = []
    for r in rutas:
        with open(r, encoding='utf-8') as f:
            for n, linea in enumerate(f, 1):
                linea = linea.strip()
                if not linea:
                    continue
                d = json.loads(linea)
                assert isinstance(d['q'], str) and d['q'].strip(), f'{r}:{n} sin texto'
                assert all(e in IDS for e in d['e']) and len(d['e']) <= 2, f'{r}:{n} etiqueta rara {d["e"]}'
                filas.append({'q': d['q'].strip(), 'e': list(dict.fromkeys(d['e']))})
    return filas


def codificar(agente, internas, filas):
    """Una fila de entrenamiento por (consulta, especialista), codificada igual que en predict()."""
    items = []
    for i, f in enumerate(filas):
        seqs = agente._encode_state(f['q'], IDS, internas)
        for j, it in enumerate(seqs):
            it['label'] = 1 if IDS[j] in f['e'] else 0
            it['fila'] = i
            it['esp'] = j
            items.append(it)
    return items


def lotes(items, tam, barajar, semilla=0):
    orden = list(range(len(items)))
    if barajar:
        random.Random(semilla).shuffle(orden)
    for k in range(0, len(orden), tam):
        yield collate_items([[items[i] for i in orden[k:k + tam]]], pad_id=0)


@torch.no_grad()
def logits_de(modelo, items, device, tam=16):
    modelo.eval()
    salida = []
    for b in lotes(items, tam, False):
        lg, _ = modelo(b['input_ids'].to(device), b['attention_mask'].to(device), b['marker_pos'].to(device),
                       b['marker_mask'].to(device), b['qtype'].to(device))
        salida.append(lg[:, :2].float().cpu())
    return torch.cat(salida)


def probabilidades(lg, temp=1.0):
    return torch.softmax(lg / temp, -1)[:, 1].numpy()


def panel(p_fila, umbral, maximo=2):
    orden = np.argsort(-p_fila)
    return [IDS[i] for i in orden[:maximo] if p_fila[i] >= umbral]


def metricas(filas, P, umbral):
    """P: [n_filas, 8] probabilidades. Exacto (sin orden), principal, F1 micro y vacíos."""
    exacto = principal = vacios_ok = vacios = 0
    tp = fp = fn = 0
    for f, p in zip(filas, P):
        pred = panel(p, umbral)
        oro = f['e']
        exacto += set(pred) == set(oro)
        principal += (pred[:1] == oro[:1])
        if not oro:
            vacios += 1
            vacios_ok += not pred
        tp += len(set(pred) & set(oro))
        fp += len(set(pred) - set(oro))
        fn += len(set(oro) - set(pred))
    n = len(filas)
    prec = tp / max(1, tp + fp)
    rec = tp / max(1, tp + fn)
    return {'exacto': exacto / n, 'principal': principal / n, 'f1': 2 * prec * rec / max(1e-9, prec + rec),
            'precision': prec, 'recall': rec, 'vacios': vacios_ok / max(1, vacios), 'n': n}


def matriz(items, lg, n_filas, temp):
    P = np.zeros((n_filas, len(IDS)))
    pr = probabilidades(lg, temp)
    for it, p in zip(items, pr):
        P[it['fila'], it['esp']] = p
    return P


def ajustar_temperatura(lg, etiquetas):
    """Temperatura que minimiza la log-loss de validación (escalado de Platt de un parámetro)."""
    log_t = torch.zeros(1, requires_grad=True)
    y = torch.tensor(etiquetas)
    opt = torch.optim.LBFGS([log_t], lr=0.1, max_iter=200)

    def paso():
        opt.zero_grad()
        perdida = torch.nn.functional.cross_entropy(lg / log_t.exp(), y)
        perdida.backward()
        return perdida

    opt.step(paso)
    return float(log_t.exp().clamp(0.5, 5.0))  # el mismo rango que acepta laya (TEMP_MIN)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--datos', default=os.path.join(AQUI, 'datos'))
    ap.add_argument('--salida', default=os.path.join(AQUI, 'modelo-electrum'))
    ap.add_argument('--epocas', type=int, default=4)
    ap.add_argument('--lote', type=int, default=32)
    ap.add_argument('--micro', type=int, default=8, help='sub-lote por pasada; el gradiente se acumula hasta --lote')
    ap.add_argument('--lr', type=float, default=3e-5)
    ap.add_argument('--lr-cabeza', type=float, default=2e-4)
    ap.add_argument('--peso-positivo', type=float, default=2.0)
    ap.add_argument('--device', default='cpu')
    ap.add_argument('--semilla', type=int, default=7)
    a = ap.parse_args()

    random.seed(a.semilla); np.random.seed(a.semilla); torch.manual_seed(a.semilla)
    if a.device == 'cpu':
        torch.set_num_threads(os.cpu_count() or 4)

    filas = leer(sorted(glob.glob(os.path.join(a.datos, 'train_*.jsonl'))))
    # sin repetidas y sin nada que esté en la prueba apartada (test.jsonl), si existe
    prueba = os.path.join(a.datos, 'test.jsonl')
    vistas = {f['q'].lower() for f in leer([prueba])} if os.path.exists(prueba) else set()
    unicas = []
    for f in filas:
        if f['q'].lower() not in vistas:
            vistas.add(f['q'].lower())
            unicas.append(f)
    filas = unicas
    random.Random(a.semilla).shuffle(filas)
    corte = max(40, len(filas) // 10)
    val, ent = filas[:corte], filas[corte:]
    print(f'entrenamiento {len(ent)} consultas · validación {len(val)}')

    agente = laya.load('convaiinnovations/laya', subfolder='multilingual', device=a.device)
    preguntas = json.load(open(os.path.join(AQUI, 'preguntas.json'), encoding='utf-8'))
    internas = {k: agente._to_internal(preguntas[k]) for k in IDS}
    it_ent, it_val = codificar(agente, internas, ent), codificar(agente, internas, val)
    y_val = [it['label'] for it in it_val]

    modelo = agente.model.to(a.device)
    # La tabla de embeddings (256k × 768, 197M de los 322M parámetros) queda congelada: con unos
    # cientos de consultas no hay nada que aprender ahí y en CPU es la mitad de la memoria.
    modelo.encoder.embeddings.tok_embeddings.weight.requires_grad_(False)
    cabeza = [p for n, p in modelo.named_parameters() if not n.startswith('encoder.')]
    cuerpo = [p for n, p in modelo.named_parameters() if n.startswith('encoder.') and p.requires_grad]
    opt = torch.optim.AdamW([{'params': cuerpo, 'lr': a.lr}, {'params': cabeza, 'lr': a.lr_cabeza}], weight_decay=0.01)
    pasos = a.epocas * math.ceil(len(it_ent) / a.lote)
    calentar = max(1, int(0.06 * pasos))
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min(1.0, (s + 1) / calentar) * max(0.0, (pasos - s) / max(1, pasos - calentar)))
    peso = torch.tensor([1.0, a.peso_positivo], device=a.device)

    mejor, mejor_estado = -1.0, None
    paso = 0
    for ep in range(a.epocas):
        modelo.train()
        t0, acum = time.time(), 0.0
        orden = list(range(len(it_ent)))
        random.Random(a.semilla + ep).shuffle(orden)
        for k in range(0, len(orden), a.lote):
            lote = [it_ent[i] for i in orden[k:k + a.lote]]
            opt.zero_grad()
            for m in range(0, len(lote), a.micro):
                sub = lote[m:m + a.micro]
                b = collate_items([sub], pad_id=0)
                lg, _ = modelo(b['input_ids'].to(a.device), b['attention_mask'].to(a.device), b['marker_pos'].to(a.device),
                               b['marker_mask'].to(a.device), b['qtype'].to(a.device))
                perdida = torch.nn.functional.cross_entropy(lg[:, :2].float(), b['label'].to(a.device), weight=peso)
                (perdida * len(sub) / len(lote)).backward()
                acum += float(perdida.detach()) * len(sub) / len(lote)
            torch.nn.utils.clip_grad_norm_(modelo.parameters(), 1.0)
            opt.step(); sched.step()
            paso += 1
            if paso % 25 == 0:
                print(f'  época {ep + 1} paso {paso}/{pasos} pérdida {acum / 25:.4f} · {time.time() - t0:.0f}s', flush=True)
                acum = 0.0
        lg = logits_de(modelo, it_val, a.device)
        m = metricas(val, matriz(it_val, lg, len(val), 1.0), 0.5)
        print(f'época {ep + 1}: validación {json.dumps({k: round(v, 3) for k, v in m.items()})}', flush=True)
        if m['exacto'] + m['f1'] > mejor:
            mejor = m['exacto'] + m['f1']
            mejor_estado = {k: v.detach().cpu().clone() for k, v in modelo.state_dict().items()}

    modelo.load_state_dict(mejor_estado)
    lg = logits_de(modelo, it_val, a.device)
    temp = ajustar_temperatura(lg, y_val)
    P = matriz(it_val, lg, len(val), temp)
    umbral, mejor_m = 0.5, None
    for u in np.arange(0.25, 0.81, 0.05):
        m = metricas(val, P, float(u))
        if mejor_m is None or m['exacto'] + m['f1'] > mejor_m['exacto'] + mejor_m['f1']:
            umbral, mejor_m = round(float(u), 2), m
    print(f'temperatura noul {temp:.3f} · umbral {umbral} · validación {json.dumps({k: round(v, 3) for k, v in mejor_m.items()})}')

    # checkpoint que laya.load() entiende: pesos + config + tokenizer y encoder del modelo base
    os.makedirs(a.salida, exist_ok=True)
    base = os.path.join(os.path.dirname(agente.tok.name_or_path.rstrip('/')), '')
    for sub in ('tokenizer', 'encoder'):
        origen = os.path.join(base, sub)
        if os.path.isdir(origen):
            shutil.copytree(origen, os.path.join(a.salida, sub), dirs_exist_ok=True)
    cfg = dict(agente.cfg)
    cfg['temperature'] = [cfg['temperature'][0], cfg['temperature'][1], temp]
    cfg['electrum'] = {'ids': IDS, 'umbral': umbral, 'maximo': 2, 'validacion': mejor_m,
                       'consultas_entrenamiento': len(ent), 'epocas': a.epocas}
    with open(os.path.join(a.salida, 'rl_agent_config.json'), 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=1)
    estado = {k: v.contiguous() for k, v in modelo.state_dict().items()}
    save_file(estado, os.path.join(a.salida, 'model.safetensors'))
    shutil.copy(os.path.join(AQUI, 'preguntas.json'), os.path.join(a.salida, 'preguntas.json'))
    print('guardado en', a.salida)


if __name__ == '__main__':
    main()
