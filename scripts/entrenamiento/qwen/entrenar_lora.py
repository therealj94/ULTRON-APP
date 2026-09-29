"""Ajuste LoRA de Qwen con las conversaciones que el equipo aprobó o corrigió en la Escuela.

Qué aprende: el COMPORTAMIENTO de Dr Electrum — qué herramienta llamar, con qué argumentos, cómo
contestar con lo que devolvió y en qué tono. No aprende hechos (esos salen de las herramientas con su
fuente). La pérdida se calcula SOLO sobre lo que dice el asistente (sus llamadas y su respuesta): la
pregunta de la persona y lo que devolvieron las herramientas son contexto, no algo a imitar.

Datos: el `qwen-sft.jsonl` y el `herramientas.json` que escribe scripts/entrenamiento/exportar.ts.
Nunca salidas de otros modelos comerciales (ver README.md).

    # GPU (A10G 24 GB o mejor): QLoRA en 4 bits
    python entrenar_lora.py --datos salida/qwen-sft.jsonl --herramientas salida/herramientas.json \\
        --base <modelo HF de los MISMOS pesos que sirve el nodo> --salida lora-electrum

    # Prueba de humo en CPU con un Qwen chico (verifica todo el camino en minutos)
    python entrenar_lora.py --datos prueba-humo.jsonl --herramientas herramientas-prueba.json \\
        --base Qwen/Qwen3-0.6B --salida /tmp/lora-prueba --pasos 6 --max-largo 1024

Sale: el adaptador (adapter_model.safetensors + adapter_config.json), el tokenizador y
`entrenamiento.json` con los datos usados (huella), los hiperparámetros y la pérdida de validación.
Convertirlo a GGUF para llama-server: a_gguf.sh.
"""
import argparse
import hashlib
import json
import math
import os
import random
import time

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments

INICIO_ASISTENTE = '<|im_start|>assistant\n'
FIN_TURNO = '<|im_end|>'


def leer_jsonl(ruta):
    with open(ruta, encoding='utf-8') as f:
        return [json.loads(l) for l in f if l.strip()]


def herramientas_del_ejemplo(ej, todas, distractores, azar):
    """Las herramientas que usó el ejemplo más unas cuantas que no, para que aprenda a ELEGIR."""
    por_nombre = {h['function']['name']: h for h in todas}
    usadas = [por_nombre[n] for n in ej.get('herramientas', []) if n in por_nombre]
    resto = [h for h in todas if h['function']['name'] not in ej.get('herramientas', [])]
    extra = azar.sample(resto, min(distractores, len(resto)))
    lista = usadas + extra
    azar.shuffle(lista)
    return lista


def mensajes_para_plantilla(mensajes):
    """El formato del exportador → el que espera la plantilla de chat de Qwen (OpenAI con tool_calls)."""
    salida = []
    for m in mensajes:
        if m['role'] == 'assistant' and m.get('tool_calls'):
            salida.append({'role': 'assistant', 'content': m.get('content') or '', 'tool_calls': [
                {'type': 'function', 'function': {'name': t['function']['name'], 'arguments': t['function']['arguments']}} for t in m['tool_calls']
            ]})
        elif m['role'] == 'tool':
            salida.append({'role': 'tool', 'name': m.get('name'), 'content': m['content']})
        else:
            salida.append({'role': m['role'], 'content': m['content']})
    return salida


def tramos_del_asistente(texto):
    """Dónde habla el asistente en el texto ya renderizado (ChatML de Qwen): desde después de
    «<|im_start|>assistant\\n» hasta «<|im_end|>» inclusive (aprender a cerrar el turno es parte)."""
    tramos, i = [], 0
    while True:
        a = texto.find(INICIO_ASISTENTE, i)
        if a < 0:
            return tramos
        ini = a + len(INICIO_ASISTENTE)
        fin = texto.find(FIN_TURNO, ini)
        fin = len(texto) if fin < 0 else fin + len(FIN_TURNO)
        tramos.append((ini, fin))
        i = fin


def renderizar_cabe(tok, mensajes, herramientas, max_largo, piso=160):
    """Renderiza la conversación y, si no cabe en `max_largo` tokens, acorta lo que devolvieron las
    herramientas (el contexto), de la más larga a la más corta, antes que cortar la cola: cortar la cola
    se come la respuesta final, que es justo lo que se quiere enseñar. None si ni así cabe."""
    msgs = [dict(m) for m in mensajes]
    for _ in range(40):
        texto = tok.apply_chat_template(msgs, tools=herramientas, tokenize=False, enable_thinking=False)
        n = len(tok(texto, add_special_tokens=False)['input_ids'])
        if n <= max_largo:
            return texto, n
        herr = [m for m in msgs if m['role'] == 'tool' and len(m['content']) > piso]
        if not herr:
            return None, n
        larga = max(herr, key=lambda m: len(m['content']))
        larga['content'] = larga['content'][: max(piso, len(larga['content']) // 2)].rstrip() + ' …[recortado]'
    return None, n


def codificar(tok, texto, max_largo, aprender=None):
    """input_ids y labels: -100 en todo lo que no dice el asistente, y también en los turnos del
    asistente marcados para no aprender (`aprender[i]` False: el i-ésimo turno del asistente)."""
    enc = tok(texto, return_offsets_mapping=True, add_special_tokens=False, truncation=True, max_length=max_largo)
    tramos = tramos_del_asistente(texto)
    if aprender is not None:
        if len(aprender) != len(tramos):
            raise ValueError(f'{len(tramos)} turnos del asistente en el texto y {len(aprender)} en el ejemplo: no se puede enmascarar con seguridad')
        tramos = [t for t, si in zip(tramos, aprender) if si]
    labels = []
    for (a, b), t in zip(enc['offset_mapping'], enc['input_ids']):
        dentro = any(a >= i and b <= f and b > a for i, f in tramos)
        labels.append(t if dentro else -100)
    return {'input_ids': enc['input_ids'], 'attention_mask': enc['attention_mask'], 'labels': labels}


class Conjunto(torch.utils.data.Dataset):
    def __init__(self, filas):
        self.filas = filas

    def __len__(self):
        return len(self.filas)

    def __getitem__(self, i):
        return self.filas[i]


def juntar(tok):
    def f(lote):
        largo = max(len(x['input_ids']) for x in lote)
        pad = tok.pad_token_id if tok.pad_token_id is not None else tok.eos_token_id
        return {
            'input_ids': torch.tensor([x['input_ids'] + [pad] * (largo - len(x['input_ids'])) for x in lote]),
            'attention_mask': torch.tensor([x['attention_mask'] + [0] * (largo - len(x['attention_mask'])) for x in lote]),
            'labels': torch.tensor([x['labels'] + [-100] * (largo - len(x['labels'])) for x in lote]),
        }
    return f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--datos', required=True)
    ap.add_argument('--herramientas', required=True)
    ap.add_argument('--base', required=True, help='modelo HF con los MISMOS pesos que sirve llama-server')
    ap.add_argument('--salida', required=True)
    ap.add_argument('--epocas', type=float, default=2)
    ap.add_argument('--pasos', type=int, default=-1, help='tope de pasos (prueba de humo)')
    ap.add_argument('--lr', type=float, default=1e-4)
    ap.add_argument('--rango', type=int, default=16)
    ap.add_argument('--alfa', type=int, default=32)
    ap.add_argument('--max-largo', type=int, default=4096)
    ap.add_argument('--lote', type=int, default=1)
    ap.add_argument('--acumular', type=int, default=8)
    ap.add_argument('--distractores', type=int, default=6)
    ap.add_argument('--validacion', type=float, default=0.1)
    ap.add_argument('--semilla', type=int, default=17)
    ap.add_argument('--minimo', type=int, default=0, help='no entrenar con menos ejemplos que esto (en serio: 300)')
    a = ap.parse_args()

    from peft import LoraConfig, get_peft_model

    ejemplos = leer_jsonl(a.datos)
    if len(ejemplos) < a.minimo:
        raise SystemExit(f'Solo hay {len(ejemplos)} ejemplos revisados (mínimo {a.minimo}). Seguí revisando en la Escuela.')
    with open(a.herramientas, encoding='utf-8') as f:
        todas = json.load(f)
    azar = random.Random(a.semilla)

    tok = AutoTokenizer.from_pretrained(a.base)
    filas, largos, acortados, fuera = [], [], 0, 0
    for ej in ejemplos:
        mensajes = mensajes_para_plantilla(ej['messages'])
        herramientas = herramientas_del_ejemplo(ej, todas, a.distractores, azar)
        completo = tok.apply_chat_template(mensajes, tools=herramientas, tokenize=False, enable_thinking=False)
        if not tramos_del_asistente(completo):
            raise SystemExit(f'{ej.get("id")}: la plantilla no produjo turnos «assistant» en ChatML; ¿el --base es un Qwen?')
        texto, n = renderizar_cabe(tok, mensajes, herramientas, a.max_largo)
        if texto is None:
            fuera += 1
            print(f'  fuera: {ej.get("id")} no cabe en {a.max_largo} tokens ni acortando las herramientas ({n})')
            continue
        acortados += texto != completo
        # Las llamadas de un turno corregido son contexto, no algo a aprender (ver dataset.ts).
        aprender = [m.get('entrenar', True) is not False for m in ej['messages'] if m['role'] == 'assistant']
        fila = codificar(tok, texto, a.max_largo, aprender)
        if any(l != -100 for l in fila['labels']):
            filas.append(fila)
            largos.append(len(fila['input_ids']))
    if not filas:
        raise SystemExit('Ningún ejemplo cabe: subí --max-largo.')
    azar.shuffle(filas)
    n_val = max(1, int(len(filas) * a.validacion)) if len(filas) >= 10 else 0
    val, train = filas[:n_val], filas[n_val:]
    print(f'{len(ejemplos)} ejemplos → {len(train)} entrenamiento, {len(val)} validación · '
          f'largo medio {sum(largos) // max(1, len(largos))} tokens, máx {max(largos)} · con herramientas acortadas {acortados} · fuera {fuera}')

    cuda = torch.cuda.is_available()
    if cuda:
        from transformers import BitsAndBytesConfig
        from peft import prepare_model_for_kbit_training
        modelo = AutoModelForCausalLM.from_pretrained(
            a.base,
            quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4', bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True),
            device_map='auto',
        )
        modelo = prepare_model_for_kbit_training(modelo, use_gradient_checkpointing=True)
    else:
        modelo = AutoModelForCausalLM.from_pretrained(a.base, dtype=torch.float32)
    modelo = get_peft_model(modelo, LoraConfig(
        r=a.rango, lora_alpha=a.alfa, lora_dropout=0.05, bias='none', task_type='CAUSAL_LM',
        target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'],
    ))
    modelo.print_trainable_parameters()

    args = TrainingArguments(
        output_dir=os.path.join(a.salida, 'pasos'),
        num_train_epochs=a.epocas,
        max_steps=a.pasos,
        per_device_train_batch_size=a.lote,
        per_device_eval_batch_size=a.lote,
        gradient_accumulation_steps=a.acumular,
        learning_rate=a.lr,
        lr_scheduler_type='cosine',
        warmup_steps=2,
        logging_steps=1,
        eval_strategy='epoch' if val else 'no',
        save_strategy='no',
        bf16=cuda,
        gradient_checkpointing=cuda,
        report_to=[],
        seed=a.semilla,
        use_cpu=not cuda,
    )
    t0 = time.time()
    entrenador = Trainer(model=modelo, args=args, train_dataset=Conjunto(train), eval_dataset=Conjunto(val) if val else None, data_collator=juntar(tok))
    res = entrenador.train()
    metricas = entrenador.evaluate() if val else {}

    os.makedirs(a.salida, exist_ok=True)
    modelo.save_pretrained(a.salida)
    tok.save_pretrained(a.salida)
    with open(a.datos, 'rb') as f:
        huella = hashlib.sha256(f.read()).hexdigest()[:16]
    manifiesto = {
        'base': a.base,
        'datos': os.path.basename(a.datos),
        'huella_datos': huella,
        'ejemplos': len(ejemplos),
        'fuera_por_largo': fuera,
        'herramientas_acortadas': acortados,
        'entrenamiento': len(train),
        'validacion': len(val),
        'perdida_entrenamiento': round(float(res.training_loss), 4),
        'perdida_validacion': round(float(metricas['eval_loss']), 4) if 'eval_loss' in metricas else None,
        'perplejidad_validacion': round(math.exp(metricas['eval_loss']), 3) if 'eval_loss' in metricas else None,
        'hiperparametros': {k: getattr(a, k) for k in ('epocas', 'pasos', 'lr', 'rango', 'alfa', 'max_largo', 'lote', 'acumular', 'distractores', 'semilla')},
        'gpu': torch.cuda.get_device_name(0) if cuda else None,
        'segundos': round(time.time() - t0, 1),
        'cuando': time.strftime('%Y-%m-%dT%H:%M:%S'),
    }
    with open(os.path.join(a.salida, 'entrenamiento.json'), 'w', encoding='utf-8') as f:
        json.dump(manifiesto, f, ensure_ascii=False, indent=1)
    print(json.dumps(manifiesto, ensure_ascii=False))


if __name__ == '__main__':
    main()
