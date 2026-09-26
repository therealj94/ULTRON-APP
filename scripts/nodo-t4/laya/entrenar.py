"""Ajusta Laya (multilingüe) para contestar un juego fijo de preguntas noul sobre un texto.

Sin --modelo-dir entrena el de siempre: qué especialistas de Dr Electrum convocar. Una pregunta noul
por especialista (preguntas.json): el modelo da P(sí) calibrada para cada uno y servidor.py convoca
como mucho dos por encima del umbral. Aquí se entrena, se calibra la temperatura de las noul sobre
validación, se elige el umbral y se guarda un checkpoint que `laya.load(dir)` lee.

    python entrenar.py --datos datos/ --salida modelo-electrum/ [--epocas 4]

Con --modelo-dir entrena uno de modelos/<nombre>/ (modelo.json lo describe; ver comun.py):

    python entrenar.py --modelo-dir modelos/mensaje --salida /opt/laya/modelo-mensaje [--device cuda]

Lo que cambia respecto a electrum:
  · etiquetas multi-etiqueta libres (0..n), salvo los grupos exclusivos (exactamente una de cada
    grupo por texto; se decide por argmax dentro del grupo, sin umbral);
  · un umbral POR ETIQUETA elegido en validación (ver elegir_umbrales: mezclado con el global
    según cuántos positivos hay, para no sobreajustarlo con tres ejemplos);
  · validación estratificada y reproducible (--semilla), y fuera del entrenamiento cualquier texto
    que esté en test/bordes/evals (normalizado: sin tildes, minúsculas, espacios colapsados);
  · el mismo recorte cabeza/cola al entrenar que al servir.
Se guarda en cfg['decisor']; cfg['electrum'] sigue siendo solo del de siempre.

Corre en CPU (lento pero alcanza para unos miles de filas) o en la T4 con --device cuda.
--limite N (solo para pruebas de humo) se queda con N consultas de entrenamiento al azar.
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

from comun import cargar_config, decidir, leer_filas, normalizar, recortar

AQUI = os.path.dirname(os.path.abspath(__file__))
IDS = ['geologo', 'minas', 'civil', 'metalurgista', 'geomatica', 'ambiental', 'legal', 'economista']

# Umbrales por etiqueta (modelos genéricos). Con 3 positivos en validación, el umbral que maximiza
# el F1 de esa etiqueta es ruido: por eso se mezcla con el global como si el global valiera
# PSEUDO_POSITIVOS positivos más, por debajo de MIN_POSITIVOS se usa el global tal cual, y nunca sale
# de [PISO, TECHO] (un 0,9 aprendido de dos casos dejaría la etiqueta muda en producción).
MIN_POSITIVOS = 3
PSEUDO_POSITIVOS = 10
PISO, TECHO = 0.2, 0.8
REJILLA = [round(float(u), 2) for u in np.arange(0.10, 0.91, 0.05)]


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


def codificar(agente, internas, filas, ids=IDS):
    """Una fila de entrenamiento por (consulta, pregunta), codificada igual que en predict()."""
    items = []
    for i, f in enumerate(filas):
        seqs = agente._encode_state(f['q'], ids, internas)
        for j, it in enumerate(seqs):
            it['label'] = 1 if ids[j] in f['e'] else 0
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


def matriz(items, lg, n_filas, temp, n_ids=len(IDS)):
    P = np.zeros((n_filas, n_ids))
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


def ajustar(agente, it_ent, it_val, a, puntuar):
    """El bucle de entrenamiento (igual para todos los modelos). Devuelve el modelo con los pesos de
    la mejor época según puntuar(logits de validación) → (puntuación, métricas para imprimir)."""
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
        puntos, m = puntuar(lg)
        print(f'época {ep + 1}: validación {json.dumps({k: round(v, 3) for k, v in m.items() if isinstance(v, (int, float))})}', flush=True)
        if puntos > mejor:
            mejor = puntos
            mejor_estado = {k: v.detach().cpu().clone() for k, v in modelo.state_dict().items()}

    modelo.load_state_dict(mejor_estado)
    return modelo


def guardar(agente, modelo, salida, temp, extra, archivos):
    """Checkpoint que laya.load() entiende: pesos + config + tokenizer y encoder del modelo base."""
    os.makedirs(salida, exist_ok=True)
    base = os.path.join(os.path.dirname(agente.tok.name_or_path.rstrip('/')), '')
    for sub in ('tokenizer', 'encoder'):
        origen = os.path.join(base, sub)
        if os.path.isdir(origen):
            shutil.copytree(origen, os.path.join(salida, sub), dirs_exist_ok=True)
    cfg = dict(agente.cfg)
    cfg['temperature'] = [cfg['temperature'][0], cfg['temperature'][1], temp]
    cfg.update(extra)
    with open(os.path.join(salida, 'rl_agent_config.json'), 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=1)
    estado = {k: v.contiguous() for k, v in modelo.state_dict().items()}
    save_file(estado, os.path.join(salida, 'model.safetensors'))
    for origen in archivos:
        shutil.copy(origen, os.path.join(salida, os.path.basename(origen)))
    print('guardado en', salida)


def cargar_base(a):
    return laya.load('convaiinnovations/laya', subfolder='multilingual', device=a.device)


def main_electrum(a):
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
    if a.limite:
        filas = filas[:a.limite]
    corte = max(40, len(filas) // 10)
    val, ent = filas[:corte], filas[corte:]
    print(f'entrenamiento {len(ent)} consultas · validación {len(val)}')

    agente = cargar_base(a)
    preguntas = json.load(open(os.path.join(AQUI, 'preguntas.json'), encoding='utf-8'))
    internas = {k: agente._to_internal(preguntas[k]) for k in IDS}
    it_ent, it_val = codificar(agente, internas, ent), codificar(agente, internas, val)
    y_val = [it['label'] for it in it_val]

    def puntuar(lg):
        m = metricas(val, matriz(it_val, lg, len(val), 1.0), 0.5)
        return m['exacto'] + m['f1'], m

    modelo = ajustar(agente, it_ent, it_val, a, puntuar)
    lg = logits_de(modelo, it_val, a.device)
    temp = ajustar_temperatura(lg, y_val)
    P = matriz(it_val, lg, len(val), temp)
    umbral, mejor_m = 0.5, None
    for u in np.arange(0.25, 0.81, 0.05):
        m = metricas(val, P, float(u))
        if mejor_m is None or m['exacto'] + m['f1'] > mejor_m['exacto'] + mejor_m['f1']:
            umbral, mejor_m = round(float(u), 2), m
    print(f'temperatura noul {temp:.3f} · umbral {umbral} · validación {json.dumps({k: round(v, 3) for k, v in mejor_m.items()})}')

    guardar(agente, modelo, a.salida, temp,
            {'electrum': {'ids': IDS, 'umbral': umbral, 'maximo': 2, 'validacion': mejor_m,
                          'consultas_entrenamiento': len(ent), 'epocas': a.epocas}},
            [os.path.join(AQUI, 'preguntas.json')])


# ------------------------------------------------------------------ modelos genéricos

def metricas_decisor(filas, P, ids, grupos, umbrales):
    """Lo que se mira en validación: F1 micro de las etiquetas sueltas, acierto de cada grupo y
    «todas bien» (el conjunto entero de etiquetas, sueltas + ganadores, igual al etiquetado)."""
    en_grupo = {i for m in grupos.values() for i in m}
    tp = fp = fn = exacto = 0
    aciertos = {g: 0 for g in grupos}
    for f, fila in zip(filas, P):
        p = dict(zip(ids, fila))
        etiquetas, ganadores = decidir(p, grupos, umbrales)
        oro = set(f['e'])
        pred, oro_suelto = set(etiquetas), oro - en_grupo
        tp += len(pred & oro_suelto); fp += len(pred - oro_suelto); fn += len(oro_suelto - pred)
        for g, gan in ganadores.items():
            aciertos[g] += gan in oro
        exacto += (pred | set(ganadores.values())) == oro
    n = max(1, len(filas))
    prec, rec = tp / max(1, tp + fp), tp / max(1, tp + fn)
    m = {'f1': 2 * prec * rec / max(1e-9, prec + rec), 'precision': prec, 'recall': rec,
         'todas_bien': exacto / n, 'n': len(filas)}
    for g in grupos:
        m[f'grupo_{g}'] = aciertos[g] / n
    return m


def puntos_decisor(m, grupos):
    """Para elegir época: F1 de las sueltas + acierto medio de los grupos (los dos pesan igual)."""
    return m['f1'] + (sum(m[f'grupo_{g}'] for g in grupos) / len(grupos) if grupos else m['f1'])


def f1_etiqueta(y, p, u):
    pred = p >= u
    tp = int((pred & y).sum()); fp = int((pred & ~y).sum()); fn = int((~pred & y).sum())
    return 2 * tp / max(1, 2 * tp + fp + fn)


def elegir_umbrales(P, filas, ids, grupos):
    """Un umbral global (el que maximiza el F1 micro de las sueltas) y, sobre él, uno por etiqueta.

    Para cada etiqueta suelta: el umbral de la rejilla que maximiza SU F1 en validación (a igualdad,
    el más cercano al global), mezclado con el global en proporción a sus positivos:
        u = (n·u_etiqueta + PSEUDO_POSITIVOS·u_global) / (n + PSEUDO_POSITIVOS)
    y recortado a [PISO, TECHO]. Con menos de MIN_POSITIVOS positivos, el global. Así una etiqueta
    con 40 positivos usa sobre todo el suyo (80 %) y una con 3, casi el global (23 % del suyo).
    """
    en_grupo = {i for m in grupos.values() for i in m}
    sueltas = [i for i in ids if i not in en_grupo]
    Y = np.array([[i in f['e'] for i in ids] for f in filas], dtype=bool)
    cols = [ids.index(i) for i in sueltas]
    u_global, mejor = 0.5, -1.0
    for u in REJILLA:
        if not PISO <= u <= TECHO:
            continue
        pred = P[:, cols] >= u
        y = Y[:, cols]
        tp = int((pred & y).sum()); fp = int((pred & ~y).sum()); fn = int((~pred & y).sum())
        f1 = 2 * tp / max(1, 2 * tp + fp + fn)
        if f1 > mejor + 1e-9 or (abs(f1 - mejor) <= 1e-9 and abs(u - 0.5) < abs(u_global - 0.5)):
            u_global, mejor = u, f1
    umbrales, detalle = {}, {}
    for i in sueltas:
        j = ids.index(i)
        n_pos = int(Y[:, j].sum())
        if n_pos < MIN_POSITIVOS:
            umbrales[i] = u_global
            detalle[i] = {'positivos': n_pos, 'propio': None, 'umbral': u_global}
            continue
        propio = max(REJILLA, key=lambda u: (round(f1_etiqueta(Y[:, j], P[:, j], u), 9), -abs(u - u_global)))
        u = (n_pos * propio + PSEUDO_POSITIVOS * u_global) / (n_pos + PSEUDO_POSITIVOS)
        umbrales[i] = round(min(TECHO, max(PISO, u)), 3)
        detalle[i] = {'positivos': n_pos, 'propio': propio, 'umbral': umbrales[i],
                      'f1_propio': round(f1_etiqueta(Y[:, j], P[:, j], propio), 3),
                      'f1_final': round(f1_etiqueta(Y[:, j], P[:, j], umbrales[i]), 3)}
    # Los de grupo no usan umbral (gana el argmax); se guarda el global solo para que exista la clave.
    for i in en_grupo:
        umbrales[i] = u_global
    return u_global, umbrales, detalle


def estratificar(filas, grupos, semilla, corte):
    """Validación estratificada por (ganador de cada grupo, la etiqueta suelta más rara que lleve).

    Así las etiquetas raras (crisis, ataque, req_cierre…) caen en validación en su proporción, que
    es de donde sale su umbral. Reproducible: mismo orden de entrada + misma semilla = mismo corte.
    """
    en_grupo = {i for m in grupos.values() for i in m}
    frec = {}
    for f in filas:
        for e in f['e']:
            frec[e] = frec.get(e, 0) + 1

    def clave(f):
        gan = tuple(sorted(e for e in f['e'] if e in en_grupo))
        sueltas = sorted((e for e in f['e'] if e not in en_grupo), key=lambda e: (frec[e], e))
        return gan + (sueltas[0] if sueltas else '-',)

    cubos = {}
    for f in filas:
        cubos.setdefault(clave(f), []).append(f)
    # Cuota de cada cubo por restos mayores: redondear cubo a cubo se queda corto cuando hay muchos
    # cubos pequeños (con 2 filas y un 10 %, todos redondean a 0) y la validación sale enana.
    frac = corte / max(1, len(filas))
    rnd = random.Random(semilla)
    claves = sorted(cubos)
    cuota = {k: int(len(cubos[k]) * frac) for k in claves}
    resto = sorted(claves, key=lambda k: (-(len(cubos[k]) * frac - cuota[k]), rnd.random()))
    for k in resto[:max(0, corte - sum(cuota.values()))]:
        cuota[k] += 1
    val, ent = [], []
    for k in claves:
        cubo = cubos[k]
        rnd.shuffle(cubo)
        val.extend(cubo[:cuota[k]]); ent.extend(cubo[cuota[k]:])
    rnd.shuffle(val); rnd.shuffle(ent)
    return val, ent


def textos_apartados(conf):
    """Textos normalizados de todo conjunto que no es train (test, bordes, evals…)."""
    vistos = set()
    for clave, rutas in conf['rutas'].items():
        if clave == 'train':
            continue
        for r in rutas:
            with open(r, encoding='utf-8') as f:
                for linea in f:
                    linea = linea.strip()
                    if linea:
                        q = json.loads(linea).get('q')
                        if isinstance(q, str):
                            vistos.add(normalizar(q))
    return vistos


def main_decisor(a):
    conf = cargar_config(a.modelo_dir)
    ids, grupos, rec = conf['ids'], conf['grupos'], conf['recorte']
    if not conf['rutas'].get('train'):
        raise SystemExit(f'{conf["nombre"]}: no hay archivos de entrenamiento ({conf["dir"]}/modelo.json → datos.train)')
    filas = leer_filas(conf['rutas']['train'], ids, grupos)
    apartados = textos_apartados(conf)
    unicas, repetidas, en_prueba = [], 0, 0
    vistas = set()
    for f in filas:
        k = normalizar(f['q'])
        if k in apartados:
            en_prueba += 1
        elif k in vistas:
            repetidas += 1
        else:
            vistas.add(k)
            # El mismo recorte que en servidor.py: lo que se aprende es lo que se ve al servir.
            unicas.append({'q': recortar(f['q'], rec['cabeza'], rec['cola']), 'e': f['e']})
    filas = unicas
    if a.limite:
        random.Random(a.semilla).shuffle(filas)
        filas = filas[:a.limite]
    # Como electrum (un 10 %, al menos 40), pero nunca más de un cuarto: con pocos datos (una prueba
    # de humo) el mínimo de 40 se comería todo el entrenamiento.
    val, ent = estratificar(filas, grupos, a.semilla, min(max(40, len(filas) // 10), len(filas) // 4))
    print(f'{conf["nombre"]}: entrenamiento {len(ent)} · validación {len(val)} · descartadas: '
          f'{en_prueba} por estar en test/bordes/evals, {repetidas} repetidas')
    if not ent or not val:
        raise SystemExit(f'{conf["nombre"]}: muy pocos datos para separar entrenamiento y validación')
    faltan = [i for i in ids if not any(i in f['e'] for f in ent)]
    if faltan:
        print(f'AVISO: sin ningún positivo en entrenamiento: {faltan}', flush=True)

    agente = cargar_base(a)
    internas = {k: agente._to_internal(conf['preguntas'][k]) for k in ids}
    it_ent, it_val = codificar(agente, internas, ent, ids), codificar(agente, internas, val, ids)
    y_val = [it['label'] for it in it_val]
    medio = {i: 0.5 for i in ids}

    def puntuar(lg):
        m = metricas_decisor(val, matriz(it_val, lg, len(val), 1.0, len(ids)), ids, grupos, medio)
        return puntos_decisor(m, grupos), m

    modelo = ajustar(agente, it_ent, it_val, a, puntuar)
    lg = logits_de(modelo, it_val, a.device)
    temp = ajustar_temperatura(lg, y_val)
    P = matriz(it_val, lg, len(val), temp, len(ids))
    u_global, umbrales, detalle = elegir_umbrales(P, val, ids, grupos)
    m_global = metricas_decisor(val, P, ids, grupos, {i: u_global for i in ids})
    m = metricas_decisor(val, P, ids, grupos, umbrales)
    print(f'temperatura noul {temp:.3f} · umbral global {u_global}')
    print(f'validación, umbral global:       {json.dumps({k: round(v, 3) for k, v in m_global.items()})}')
    print(f'validación, umbral por etiqueta: {json.dumps({k: round(v, 3) for k, v in m.items()})}')
    for i, d in detalle.items():
        print(f'  {i:22} positivos {d["positivos"]:3d} · propio {d["propio"]} → {d["umbral"]}')

    guardar(agente, modelo, a.salida, temp,
            {'decisor': {'nombre': conf['nombre'], 'ids': ids, 'grupos': grupos, 'umbrales': umbrales,
                         'umbral_global': u_global, 'recorte': rec, 'validacion': m,
                         'validacion_umbral_global': m_global, 'umbrales_detalle': detalle,
                         'metodo_umbral': {'min_positivos': MIN_POSITIVOS, 'pseudo_positivos': PSEUDO_POSITIVOS,
                                           'piso': PISO, 'techo': TECHO},
                         'consultas_entrenamiento': len(ent), 'consultas_validacion': len(val),
                         'descartadas_apartadas': en_prueba, 'epocas': a.epocas, 'semilla': a.semilla}},
            [os.path.join(conf['dir'], 'preguntas.json'), os.path.join(conf['dir'], 'modelo.json')])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--modelo-dir', help='carpeta con modelo.json (modelos/mensaje…); sin ella, electrum')
    ap.add_argument('--datos', default=os.path.join(AQUI, 'datos'), help='solo electrum')
    ap.add_argument('--salida', default=None)
    ap.add_argument('--epocas', type=int, default=4)
    ap.add_argument('--lote', type=int, default=32)
    ap.add_argument('--micro', type=int, default=8, help='sub-lote por pasada; el gradiente se acumula hasta --lote')
    ap.add_argument('--lr', type=float, default=3e-5)
    ap.add_argument('--lr-cabeza', type=float, default=2e-4)
    ap.add_argument('--peso-positivo', type=float, default=2.0)
    ap.add_argument('--device', default='cpu')
    ap.add_argument('--semilla', type=int, default=7)
    ap.add_argument('--limite', type=int, default=0, help='solo pruebas: N consultas al azar')
    a = ap.parse_args()

    random.seed(a.semilla); np.random.seed(a.semilla); torch.manual_seed(a.semilla)
    if a.device == 'cpu':
        torch.set_num_threads(os.cpu_count() or 4)
    if a.modelo_dir:
        a.salida = a.salida or os.path.join(AQUI, 'modelo-' + os.path.basename(os.path.normpath(a.modelo_dir)))
        main_decisor(a)
    else:
        a.salida = a.salida or os.path.join(AQUI, 'modelo-electrum')
        main_electrum(a)


if __name__ == '__main__':
    main()
