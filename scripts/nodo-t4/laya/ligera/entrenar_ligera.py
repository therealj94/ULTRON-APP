"""Laya LIGERA: el grupo `app` de Laya «comando» destilado en un clasificador lineal que corre DENTRO
del servidor de AU-RA, sin red y en microsegundos.

Laya (el modelo de 322 M parámetros del nodo T4) contesta en ~35–70 ms en la GPU, más la ida y vuelta
desde Render (~100 ms reutilizando la conexión). Para una orden de la app («vete atrás», «dark mode»,
«cállate») eso es casi todo lo que tarda el turno. Este modelo aprende de LOS MISMOS DATOS
(modelos/comando/datos) a decir qué mano es, con n-gramas de palabras y de letras (así aguanta el
dictado: «bideollamada», «pantaya», sin tildes) y una regresión logística. Decide en el servidor antes
que nadie; si duda, se pregunta al Laya del nodo (si está) y si no, al cerebro. Nunca decide A QUIÉN,
A QUÉ HORA ni QUÉ TEXTO (eso lo sacan las reglas o el cerebro) y nunca se salta una confirmación.

    ../../../../laya-venv/bin/python entrenar_ligera.py          # (o cualquier python con numpy)
    python entrenar_ligera.py --dim 4096 --salida ../../../../lib/laya-ligera-modelo.ts

Escribe:
  · lib/laya-ligera-modelo.ts: los pesos (int8, base64), las etiquetas, la temperatura y el umbral;
    lib/laya-ligera.ts los lee y calcula EXACTAMENTE lo mismo que aquí (las «muestras» del archivo lo
    comprueban en tests/laya-ligera.test.ts);
  · ligera/informe.json: exactitud, precisión/recall/F1 por etiqueta y por idioma, cobertura con el
    umbral, falsos positivos sobre los negativos, latencia; y la compuerta (ver abajo).

Conjuntos (sin fugas: entrenamiento nunca ve un texto de validación, prueba o bordes, normalizado):
  · entrenamiento: datos/train_*.jsonl (Electrum aporta miles de negativos: órdenes del mapa);
  · validación: datos/val_app.jsonl + un 10 % fijo de train_a.jsonl (temperatura y umbral salen de aquí);
  · prueba: datos/test_app.jsonl (AU-RA, es/en) y datos/test.jsonl (Electrum); bordes_aura.jsonl aparte.

COMPUERTA: el modelo nuevo solo se escribe si en la prueba de AU-RA (con el umbral) la precisión de lo
que se EJECUTARÍA es ≥ --precision-minima (0,97) y la exactitud del grupo no baja más de 0,01 respecto
del informe anterior (si existe). --forzar lo salta.

Solo numpy. Determinista (--semilla).
"""
import argparse
import base64
import glob
import json
import math
import os
import re
import time
import unicodedata

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
COMANDO = os.path.join(AQUI, '..', 'modelos', 'comando')
RAIZ = os.path.abspath(os.path.join(AQUI, '..', '..', '..', '..'))
SALIDA_TS = os.path.join(RAIZ, 'lib', 'laya-ligera-modelo.ts')
INFORME = os.path.join(AQUI, 'informe.json')

# Las manos que el camino rápido puede EJECUTAR sin cerebro (con su parámetro sacado de la frase) o
# PROPONER (llamar: con su «sí»). La precisión que exige la compuerta es sobre estas.
EJECUTABLES = ['app_atras', 'app_abrir', 'app_tema', 'app_avatar', 'app_callar', 'app_hablar', 'app_presencia', 'app_idioma',
               'app_llamar', 'app_videollamar']


# ------------------------------------------------------------------ rasgos (igual en lib/laya-ligera.ts)

def normalizar(texto):
    """Sin tildes, minúsculas, solo [a-z0-9] y espacios. El mismo paso a paso que normalizar() en TS."""
    t = unicodedata.normalize('NFKD', str(texto or ''))
    t = ''.join(c for c in t if not (0x300 <= ord(c) <= 0x36f))
    t = t.lower()
    return re.sub(r'[^a-z0-9]+', ' ', t).strip()


# EL LÉXICO: palabras de la app agrupadas en CONCEPTOS, en los dos idiomas («abre», «open», «muéstrame»
# → @abrir; «ajustes», «settings», «la mesa» → @pantalla). Una plantilla nueva con otro verbo del mismo
# concepto se parece a las que ya vio. Sale del vocabulario de las reglas de la app (PANTALLA_DE,
# presenciaDicha, manoPorReglas…) y del habla de aquí; viaja DENTRO de los pesos (laya-ligera-modelo.ts),
# así TS no tiene una copia que se desincronice. `exactas`: la palabra entera; `prefijos`: el principio
# de la palabra (para «llámale», «recuérdamelo», «abrime»), de 4 letras o más.
LEXICO = {
 'exactas': {
  '@atras': 'atras back previous anterior return regresa regresate vuelve volve devuelvete'.split(),
  '@abrir': 'abre abreme abrime abrir abri open ve vete go vamos entra muestrame show ensename lleva llevame take bring pull metete ponme'.split(),
  '@pantalla': 'ajustes configuracion preferencias settings preferences opciones chats mensajes messages conversaciones conversations mesa inicio home principal perfil profile pantalla screen list lista'.split(),
  '@tema': 'oscuro oscura claro clara dark light noche night dia blanco blanca white negro black tema theme modo mode sistema system automatico'.split(),
  '@avatar': 'claudio aura antonio ant onio guardian ojos eyes avatar'.split(),
  '@callar': 'callate calla callar silencio silence shh quiet hush shut chito zip enough basta'.split(),
  '@hablar': 'habla hablar talk speak despierta despiertate wake unmute activate activate'.split(),
  '@presencia': 'completa full fullscreen grande grandota big bigger lado side ladito costado chiquita chiquito pequena pequeno small shrink minimizate minimize achicate esquina corner acoplate dock caminar camina walk'.split(),
  '@idioma': 'ingles english espanol spanish idioma language'.split(),
  '@perfil': 'dime decime vivo live mude moved trabajo work cumpleanos birthday cumplo gusta like favorita favorite soy tengo'.split(),
  '@hora': 'las la manana tomorrow minutos minutes minuto hora horas hour hours noche tarde pm am noon tonight morning viernes friday lunes monday temprano media half cuarto'.split(),
  '@llamar': 'llama llamale llamame llamar marca marcale marcame call phone dial ring timbra timbrame telefono llamada'.split(),
  '@video': 'video videollamada videollama bideollamada bideo facetime camara'.split(),
  '@colgar': 'cuelga colga cuelgale hang corta termina terminar end finaliza disconnect drop'.split(),
  '@leer': 'lee leeme read dijo escribio say said sent mando contesto mandaron nuevos new'.split(),
  '@mensaje': 'mensaje mensajes message messages text texto nota note borrador draft chat'.split(),
  '@escribir': 'escribele escribe write redacta draft dile tell avisale mandale enviale textea text let know'.split(),
  '@enviar': 'envialo enviala envia mandalo mandala mandaselo envialo send'.split(),
  '@borrar': 'borralo borrala borra borrar delete descartalo discard scrap quita quitalo cancela cancelalo elimina throw desechalo'.split(),
  '@buscar': 'busca buscame busca busque search find encuentra look googlea google investiga averigua averiguame browse check'.split(),
  '@internet': 'internet web online noticias news'.split(),
  '@camara': 'camara camera vision mirame'.split(),
  '@ayuda': 'ayuda help tutorial comandos commands instrucciones instructions usarte funciona funcionas'.split(),
  '@neg': 'no not dont nunca never ni'.split(),
  '@pregunta': 'que como cuando donde quien cual cuanto what how when where who why which'.split(),
  '@contar': 'ayer yesterday fui fuimos estuvo estaba hicimos was were did went called llamo'.split(),
  '@confirmar': 'si sip yes yep dale ok okay claro go ahead'.split(),
 },
 'prefijos': {
  '@recordar': 'recuerd record remind avisa acuerd olvid forget alert alarm'.split(),
  '@llamar': 'llama marca timbr'.split(),
  '@abrir': 'abre muestr ensen'.split(),
  '@atras': 'regres devuel'.split(),
  '@buscar': 'busca busq'.split(),
  '@borrar': 'borr descart elimin'.split(),
  '@escribir': 'escrib redact'.split(),
  '@callar': 'calla silenc'.split(),
  '@silenciar': 'mute silenc notific desilenc aviso avisos'.split(),
  '@colgar': 'cuelg colg'.split(),
  '@video': 'video bideo'.split(),
  '@idioma': 'ingle espan'.split(),
 },
}
_EXACTA = {}
for _c, _ws in LEXICO['exactas'].items():
    for _w in _ws:
        _EXACTA.setdefault(_w, []).append(_c)
_PREFIJOS = sorted(((p, c) for c, ps in LEXICO['prefijos'].items() for p in ps), key=lambda x: (-len(x[0]), x[0], x[1]))


def conceptos(palabra):
    """Los conceptos de una palabra: los de la palabra entera y los de cada prefijo que calce (sin repetir, en orden)."""
    out = list(_EXACTA.get(palabra, []))
    for p, c in _PREFIJOS:
        if len(palabra) >= len(p) and palabra.startswith(p) and c not in out:
            out.append(c)
    return out


def rasgos(texto):
    """Palabras, pares de palabras, cómo empieza, largo, trigramas/cuatrigramas de letras por palabra, y
    los CONCEPTOS del léxico (cada uno, el primero de la frase y los pares de conceptos seguidos)."""
    w = normalizar(texto).split(' ')[:40]
    w = [x for x in w if x]
    out = set()
    if not w:
        return out
    out.add('n=' + str(min(len(w), 12)))
    out.add('s=' + w[0])
    if len(w) > 1:
        out.add('s2=' + w[0] + '_' + w[1])
    previos = []
    primero = True
    for i, x in enumerate(w):
        out.add('w=' + x)
        if i + 1 < len(w):
            out.add('b=' + x + '_' + w[i + 1])
        p = '<' + x + '>'
        for n in (3, 4):
            for j in range(len(p) - n + 1):
                out.add('c=' + p[j:j + n])
        cs = conceptos(x)
        for c in cs:
            out.add('k=' + c)
            if primero:
                out.add('ks=' + c)
            for a in previos:
                out.add('kb=' + a + '_' + c)
        if cs:
            primero = False
            previos = cs
    return out


def fnv1a(s):
    h = 0x811c9dc5
    for b in s.encode('utf-8'):
        h ^= b
        h = (h * 0x01000193) & 0xffffffff
    return h


def indices(texto, dim):
    """Los cubos de los rasgos (con repetición si dos rasgos caen en el mismo) y el peso de cada uno."""
    idx = sorted(fnv1a(r) % dim for r in rasgos(texto))
    return idx, (1.0 / math.sqrt(len(idx)) if idx else 0.0)


# ------------------------------------------------------------------ datos

def leer(rutas):
    filas = []
    for r in rutas:
        with open(r, encoding='utf-8') as f:
            for linea in f:
                linea = linea.strip()
                if linea:
                    d = json.loads(linea)
                    app = next((e for e in d['e'] if e.startswith('app_')), 'app_ninguna')
                    filas.append({'q': d['q'], 'y': app, 'l': d.get('l') or idioma_de(d['q']), 'origen': os.path.basename(r)})
    return filas


INGLES = set('the is are what how do does can could would will please you your my me i to a an of in on at for with and this that go open call text send '
             'turn switch set remind show read search find stop be let tell give take make back mode dark light camera help'.split())
ESPANOL = set('el la los las de que en y es un una por para con mi me te se lo le al del ya pon abre ve llama dime cambia quiero'.split())


def idioma_de(q):
    """Para las filas de Electrum (sin «l»): inglés solo si hay palabras de inglés y ninguna de español."""
    w = normalizar(q).split()
    en = sum(1 for x in w if x in INGLES)
    es = sum(1 for x in w if x in ESPANOL)
    return 'en' if en >= 1 and es == 0 else 'es'


def matriz(filas, dim):
    """Filas → (lista de (idx, peso)) para el producto disperso."""
    return [indices(f['q'], dim) for f in filas]


def logits_de(X, W, b):
    out = np.empty((len(X), W.shape[1]), dtype=np.float64)
    for i, (idx, v) in enumerate(X):
        out[i] = W[idx].sum(0) * v + b if idx else b
    return out


def softmax(z):
    z = z - z.max(1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(1, keepdims=True)


# ------------------------------------------------------------------ entrenamiento

def entrenar(X, y, K, dim, pesos_clase, epocas, lr, l2, semilla, Xv=None, yv=None):
    rng = np.random.default_rng(semilla)
    W = np.zeros((dim, K))
    b = np.zeros(K)
    mW, vW, mb, vb = np.zeros_like(W), np.zeros_like(W), np.zeros_like(b), np.zeros_like(b)
    b1, b2, eps = 0.9, 0.999, 1e-8
    t = 0
    lote = 64
    mejor, mejor_estado = -1.0, None
    for ep in range(epocas):
        orden = rng.permutation(len(X))
        for k in range(0, len(orden), lote):
            sel = orden[k:k + lote]
            gW = np.zeros_like(W)
            gb = np.zeros(K)
            for i in sel:
                idx, v = X[i]
                z = (W[idx].sum(0) * v if idx else 0) + b
                p = softmax(z[None])[0]
                p[y[i]] -= 1.0
                p *= pesos_clase[y[i]]
                if idx:
                    np.add.at(gW, idx, np.outer(np.full(len(idx), v), p))
                gb += p
            gW /= len(sel)
            gb /= len(sel)
            usados = np.unique(np.concatenate([X[i][0] for i in sel if X[i][0]])) if any(X[i][0] for i in sel) else np.array([], dtype=int)
            gW[usados] += l2 * W[usados]
            t += 1
            mW = b1 * mW + (1 - b1) * gW
            vW = b2 * vW + (1 - b2) * gW * gW
            mb = b1 * mb + (1 - b1) * gb
            vb = b2 * vb + (1 - b2) * gb * gb
            corr = math.sqrt(1 - b2 ** t) / (1 - b1 ** t)
            W -= lr * corr * mW / (np.sqrt(vW) + eps)
            b -= lr * corr * mb / (np.sqrt(vb) + eps)
        if Xv is not None:
            acc = float((logits_de(Xv, W, b).argmax(1) == np.array(yv)).mean())
            print(f'  época {ep + 1}: validación {acc:.3f}', flush=True)
            if acc > mejor:
                mejor, mejor_estado = acc, (W.copy(), b.copy())
    return mejor_estado if mejor_estado else (W, b)


def ajustar_temperatura(Z, y):
    mejor, T = 1e18, 1.0
    for t in np.exp(np.linspace(math.log(0.3), math.log(5.0), 120)):
        p = softmax(Z / t)
        nll = -np.log(np.clip(p[np.arange(len(y)), y], 1e-12, 1)).mean()
        if nll < mejor:
            mejor, T = nll, float(t)
    return round(T, 4)


def cuantizar(W):
    """int8 por etiqueta: W[:, k] ≈ q[:, k] · escala[k] / 127."""
    escala = np.abs(W).max(0)
    escala[escala == 0] = 1.0
    q = np.clip(np.round(W / escala * 127), -127, 127).astype(np.int8)
    return q, escala


def descuantizar(q, escala):
    return q.astype(np.float64) * escala / 127.0


# ------------------------------------------------------------------ métricas

def metricas(filas, P, etiquetas, umbral):
    """Exactitud del grupo (argmax) y, con el umbral, lo que el camino rápido haría: ejecutar la mano si
    no es app_ninguna y su P ≥ umbral; si no, pasarlo (al Laya del nodo o al cerebro)."""
    y = np.array([etiquetas.index(f['y']) for f in filas])
    pred = P.argmax(1)
    conf = P.max(1)
    ning = etiquetas.index('app_ninguna')
    out = {'n': len(filas), 'exactitud': float((pred == y).mean()) if len(filas) else 0.0}
    decide = (pred != ning) & (conf >= umbral)
    ejec = np.array([etiquetas[p] in EJECUTABLES for p in pred]) & decide
    positivos = y != ning
    out['cobertura'] = float((decide & positivos).sum() / max(1, positivos.sum()))
    out['precision_decide'] = float(((pred == y) & decide).sum() / max(1, decide.sum()))
    out['precision_ejecutables'] = float(((pred == y) & ejec).sum() / max(1, ejec.sum()))
    out['ejecutables_decididos'] = int(ejec.sum())
    out['falsos_positivos_en_negativos'] = int((decide & ~positivos).sum())
    out['negativos'] = int((~positivos).sum())
    por = {}
    for k, e in enumerate(etiquetas):
        tp = int(((pred == k) & (y == k)).sum())
        fp = int(((pred == k) & (y != k)).sum())
        fn = int(((pred != k) & (y == k)).sum())
        p, r = tp / max(1, tp + fp), tp / max(1, tp + fn)
        por[e] = {'precision': round(p, 3), 'recall': round(r, 3), 'f1': round(2 * p * r / max(1e-9, p + r), 3), 'soporte': tp + fn}
    out['por_etiqueta'] = por
    return out


def por_idioma(filas, P, etiquetas, umbral):
    out = {}
    for l in ('es', 'en'):
        sel = [i for i, f in enumerate(filas) if f['l'] == l]
        if sel:
            out[l] = metricas([filas[i] for i in sel], P[sel], etiquetas, umbral)
    return out


def elegir_umbral(filas, P, etiquetas, precision=0.95, piso=0.85):
    """El umbral más bajo (más cobertura) con el que lo que se EJECUTARÍA acierta ≥ `precision` en
    validación, nunca por debajo de `piso`. No hace falta más: en el servidor una mano solo se ejecuta si
    además su parámetro sale de la frase (qué pantalla, qué tema, qué avatar, a quién), y las que tienen
    efecto (llamar) quedan como propuesta que espera el «sí»."""
    for u in [round(x, 2) for x in np.arange(piso, 0.991, 0.01)]:
        m = metricas(filas, P, etiquetas, u)
        if m['precision_ejecutables'] >= precision and m['precision_decide'] >= precision - 0.03:
            return u
    return 0.99


# ------------------------------------------------------------------ salida

def escribir_ts(ruta, etiquetas, dim, q, escala, b, T, umbral, muestras, meta):
    datos = base64.b64encode(q.tobytes(order='C')).decode('ascii')
    lineas = [
        '/**',
        ' * PESOS de Laya ligera (lib/laya-ligera.ts). ARCHIVO GENERADO: no se edita a mano.',
        ' *',
        ' *   scripts/nodo-t4/laya/ligera/entrenar_ligera.py → este archivo + ligera/informe.json',
        ' *',
        f' * Entrenado con {meta["entrenamiento"]} frases (modelos/comando/datos), {dim} cubos × {len(etiquetas)} etiquetas en int8.',
        ' */',
        f'export const ETIQUETAS = {json.dumps(etiquetas)} as const;',
        f'export const DIM = {dim};',
        f'export const TEMPERATURA = {T};',
        f'export const UMBRAL = {umbral};',
        f'export const ESCALA: number[] = {json.dumps([round(float(x), 6) for x in escala])};',
        f'export const SESGO: number[] = {json.dumps([round(float(x), 6) for x in b])};',
        '/** int8, fila por cubo (DIM × ETIQUETAS), en base64. */',
        f'export const PESOS_B64 = {json.dumps(datos)};',
        '/** El léxico de conceptos con que se entrenó (lib/laya-ligera.ts lo usa tal cual). */',
        f'export const LEXICO: {{ exactas: Record<string, string[]>; prefijos: Record<string, string[]> }} = {json.dumps(LEXICO, ensure_ascii=False)};',
        '/** Lo que el script calculó para estas frases: la prueba de que TS y Python dicen lo mismo. */',
        f'export const MUESTRAS: Array<{{ q: string; etiqueta: string; p: number }}> = {json.dumps(muestras, ensure_ascii=False)};',
        f'export const ENTRENADO = {json.dumps(meta["fecha"])};',
        '',
    ]
    with open(ruta, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lineas))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dim', type=int, default=8192)
    ap.add_argument('--epocas', type=int, default=12)
    ap.add_argument('--lr', type=float, default=0.05)
    ap.add_argument('--l2', type=float, default=1e-4)
    ap.add_argument('--semilla', type=int, default=7)
    ap.add_argument('--balance', type=float, default=0.5, help='peso de cada etiqueta = (N / (K·n))^balance')
    ap.add_argument('--precision-minima', type=float, default=0.97)
    ap.add_argument('--salida', default=SALIDA_TS)
    ap.add_argument('--informe', default=INFORME)
    ap.add_argument('--forzar', action='store_true')
    ap.add_argument('--curva', action='store_true', help='imprime la curva umbral → cobertura / precisión')
    ap.add_argument('--solo-medir', action='store_true', help='entrena y mide, pero no escribe nada')
    a = ap.parse_args()

    m = json.load(open(os.path.join(COMANDO, 'modelo.json'), encoding='utf-8'))
    etiquetas = m['grupos']['app']
    D = lambda n: os.path.join(COMANDO, 'datos', n)
    train_a = leer([D('train_a.jsonl')])
    # El 10 % fijo de Electrum que va a validación: por el hash del texto (no por el azar).
    val_e = [f for f in train_a if fnv1a(normalizar(f['q'])) % 10 == 0]
    val = leer([D('val_app.jsonl')]) + val_e
    test_app = leer([D('test_app.jsonl')])
    test_e = leer([D('test.jsonl')])
    bordes = leer([D('bordes_aura.jsonl')])
    apartados = {normalizar(f['q']) for f in val + test_app + test_e + bordes}
    crudo = [f for r in sorted(glob.glob(D('train_*.jsonl'))) for f in leer([r])]
    ent, vistos, fuera = [], set(), 0
    for f in crudo:
        k = normalizar(f['q'])
        if k in apartados:
            fuera += 1
            continue
        if k in vistos:
            continue
        vistos.add(k)
        ent.append(f)
    print(f'entrenamiento {len(ent)} (fuera por estar apartadas: {fuera}) · validación {len(val)} · prueba AU-RA {len(test_app)} · prueba Electrum {len(test_e)} · bordes {len(bordes)}')

    K = len(etiquetas)
    X = matriz(ent, a.dim)
    y = [etiquetas.index(f['y']) for f in ent]
    Xv = matriz(val, a.dim)
    yv = [etiquetas.index(f['y']) for f in val]
    cuenta = np.bincount(y, minlength=K).astype(float)
    pesos_clase = (len(y) / (K * np.maximum(cuenta, 1))) ** a.balance
    t0 = time.time()
    W, b = entrenar(X, y, K, a.dim, pesos_clase, a.epocas, a.lr, a.l2, a.semilla, Xv, yv)
    print(f'entrenado en {time.time() - t0:.1f} s (CPU)')

    # Lo que se mide es lo que va a correr: los pesos int8.
    q, escala = cuantizar(W)
    Wq = descuantizar(q, escala)
    T = ajustar_temperatura(logits_de(Xv, Wq, b), np.array(yv))
    Pv = softmax(logits_de(Xv, Wq, b) / T)
    umbral = elegir_umbral(val, Pv, etiquetas)
    print(f'temperatura {T} · umbral {umbral}')

    informe = {'dim': a.dim, 'epocas': a.epocas, 'semilla': a.semilla, 'temperatura': T, 'umbral': umbral,
               'entrenamiento': len(ent), 'validacion': len(val)}
    for nombre, filas in (('validacion', val), ('test_app', test_app), ('test_electrum', test_e), ('bordes_aura', bordes)):
        P = softmax(logits_de(matriz(filas, a.dim), Wq, b) / T)
        informe[nombre] = metricas(filas, P, etiquetas, umbral)
        if nombre in ('test_app', 'bordes_aura'):
            informe[nombre]['por_idioma'] = por_idioma(filas, P, etiquetas, umbral)
        if nombre == 'test_app':
            informe[nombre]['errores'] = [{'q': f['q'], 'oro': f['y'], 'dijo': etiquetas[int(P[i].argmax())], 'p': round(float(P[i].max()), 3)}
                                          for i, f in enumerate(filas) if etiquetas[int(P[i].argmax())] != f['y']][:60]
        if nombre == 'bordes_aura':
            informe[nombre]['casos'] = [{'q': f['q'], 'oro': f['y'], 'dijo': etiquetas[int(P[i].argmax())], 'p': round(float(P[i].max()), 3)}
                                        for i, f in enumerate(filas)]
    # La curva umbral → cobertura / precisión (diagnóstico: el umbral se elige en validación).
    Pt = softmax(logits_de(matriz(test_app, a.dim), Wq, b) / T)
    informe['curva'] = []
    for u in (0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 0.98, 0.99):
        mv, mt = metricas(val, Pv, etiquetas, u), metricas(test_app, Pt, etiquetas, u)
        informe['curva'].append({'umbral': u, 'val_cobertura': round(mv['cobertura'], 3), 'val_precision_ejecutables': round(mv['precision_ejecutables'], 3),
                                 'test_cobertura': round(mt['cobertura'], 3), 'test_precision_ejecutables': round(mt['precision_ejecutables'], 3),
                                 'test_falsos_positivos': mt['falsos_positivos_en_negativos']})
    if a.curva:
        for c in informe['curva']:
            print('  curva', json.dumps(c))
    # Latencia en Python (la de TS la mide tests/laya-ligera.test.ts, que es la que corre).
    textos = [f['q'] for f in test_app]
    t0 = time.perf_counter()
    for s in textos:
        softmax(logits_de(matriz([{'q': s}], a.dim), Wq, b) / T)
    informe['ms_por_prediccion_python'] = round((time.perf_counter() - t0) * 1000 / len(textos), 4)

    ta = informe['test_app']
    print(f"prueba AU-RA: exactitud {ta['exactitud']:.3f} · con umbral {umbral}: cobertura {ta['cobertura']:.3f}, precisión de lo que "
          f"ejecutaría {ta['precision_ejecutables']:.3f} ({ta['ejecutables_decididos']}), falsos positivos {ta['falsos_positivos_en_negativos']}/{ta['negativos']}")
    for l, x in ta['por_idioma'].items():
        print(f"  {l}: exactitud {x['exactitud']:.3f} · cobertura {x['cobertura']:.3f} · precisión ejecutables {x['precision_ejecutables']:.3f} · n {x['n']}")
    te = informe['test_electrum']
    print(f"prueba Electrum (órdenes del mapa): exactitud del grupo app {te['exactitud']:.3f} · falsos positivos {te['falsos_positivos_en_negativos']}/{te['negativos']}")

    # La compuerta.
    anterior = None
    if os.path.exists(a.informe):
        try:
            anterior = json.load(open(a.informe, encoding='utf-8'))
        except ValueError:
            anterior = None
    motivos = []
    if ta['precision_ejecutables'] < a.precision_minima:
        motivos.append(f"precisión de lo que se ejecutaría {ta['precision_ejecutables']:.3f} < {a.precision_minima}")
    if anterior and 'test_app' in anterior and ta['exactitud'] < anterior['test_app']['exactitud'] - 0.01:
        motivos.append(f"exactitud {ta['exactitud']:.3f} baja respecto de la anterior {anterior['test_app']['exactitud']:.3f}")
    informe['compuerta'] = {'aprobada': not motivos, 'motivos': motivos,
                            'anterior': {'exactitud': anterior['test_app']['exactitud']} if anterior and 'test_app' in anterior else None}
    print('COMPUERTA: ' + ('APROBADA' if not motivos else 'RECHAZADA · ' + ' · '.join(motivos)))
    if a.solo_medir:
        return
    if motivos and not a.forzar:
        raise SystemExit(1)

    # Muestras para comprobar TS = Python (con los pesos int8 y la temperatura).
    ejemplos = ['vete atrás', 'go back', 'ponlo oscuro', 'dark mode please', 'cambia a claudio', 'cállate', 'stop talking', 'ya puedes hablar',
                'ponte a pantalla completa', 'háblame en inglés', 'llama a mi mamá', 'video call beto', 'mi mamá me llamó ayer', '¿qué hora es?',
                'recuérdame a las 5 tomar la pastilla', 'abre ajustes', 'open my chats', 'sí, envíalo', 'bórralo', 'acércate al mapa']
    Pm = softmax(logits_de(matriz([{'q': s} for s in ejemplos], a.dim), Wq, b) / T)
    muestras = [{'q': s, 'etiqueta': etiquetas[int(Pm[i].argmax())], 'p': round(float(Pm[i].max()), 6)} for i, s in enumerate(ejemplos)]
    informe['fecha'] = time.strftime('%Y-%m-%d')
    escribir_ts(a.salida, etiquetas, a.dim, q, escala, b, T, umbral, muestras, {'entrenamiento': len(ent), 'fecha': informe['fecha']})
    with open(a.informe, 'w', encoding='utf-8') as f:
        json.dump(informe, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('escrito', a.salida, 'y', a.informe)


if __name__ == '__main__':
    main()
