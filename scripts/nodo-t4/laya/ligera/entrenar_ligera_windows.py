"""Laya LIGERA para Windows: el grupo `win` de Laya «windows» destilado en el mismo clasificador lineal
que lib/laya-ligera.ts, pero con su léxico de escritorio, y escrito en C# para que corra DENTRO del
.exe de AURA para Windows, sin red, en microsegundos.

    python entrenar_ligera_windows.py            # (cualquier python con numpy)

Escribe:
  · windows/src/Aura.Windows.Core/LayaLigeraModelo.g.cs: pesos int8 en base64, etiquetas, léxico,
    temperatura, umbral y MUESTRAS (lo que Python calculó; las pruebas de C# comprueban que C# dice lo
    mismo: windows/tests/Program.cs);
  · ligera/informe-windows.json: exactitud, cobertura, precisión de lo que se ejecutaría, por idioma y
    por etiqueta, bordes y la compuerta.

Los rasgos (normalizar, n-gramas, conceptos, FNV-1a) son EXACTAMENTE los de entrenar_ligera.py: se
importan de allí; solo cambia el léxico. Aura.Windows.Core/LayaLigera.cs es su traducción a C#.

Conjuntos (modelos/windows/datos, sin fugas por construcción, ver generador/generar.py):
entrenamiento train_*.jsonl · validación val.jsonl (temperatura y umbral) · prueba test.jsonl ·
bordes.jsonl aparte.

COMPUERTA: se escribe solo si en la prueba la precisión de lo que se EJECUTARÍA sin cerebro es
≥ --precision-minima (0,97). --forzar lo salta.
"""
import argparse
import base64
import glob
import json
import os
import time

import numpy as np

import entrenar_ligera as el

AQUI = os.path.dirname(os.path.abspath(__file__))
WINDOWS = os.path.join(AQUI, '..', 'modelos', 'windows')
RAIZ = os.path.abspath(os.path.join(AQUI, '..', '..', '..', '..'))
SALIDA_CS = os.path.join(RAIZ, 'windows', 'src', 'Aura.Windows.Core', 'LayaLigeraModelo.g.cs')
INFORME = os.path.join(AQUI, 'informe-windows.json')

# Todas las manos se deciden aquí; las que tienen efecto (escribir en otra ventana, bloquear) quedan
# como propuesta que espera el «sí» en el .exe. Todas cuentan para la precisión.
LEXICO = {
 'exactas': {
  '@abrir': 'abre abreme abrime abri abrir open launch start run inicia arranca ejecuta lanzame prende pon ponme boot load fire entra metete ve go visit navega navigate head'.split(),
  '@app': 'word excel powerpoint chrome edge spotify whatsapp outlook teams zoom paint photoshop discord telegram vlc acrobat notion steam firefox obs canva capcut onenote autocad calculadora calculator notepad bloc notas explorador explorer configuracion settings terminal programa aplicacion app camara reloj clock'.split(),
  '@carpeta': 'documentos documents descargas downloads escritorio desktop imagenes pictures musica music videos carpeta folder onedrive papelera recycle fotos photos'.split(),
  '@web': 'youtube gmail facebook drive netflix amazon wikipedia instagram linkedin reddit tiktok twitter github chatgpt pagina sitio website site web com maps navegador browser'.split(),
  '@buscar': 'busca buscame busque buscar search google googlea look find investiga averigua averiguame research browse'.split(),
  '@escribir': 'escribe escribeme escribi escribilo escribelo teclea type dicta dictate write pega paste anota transcribe key insert'.split(),
  '@redactar': 'redacta redactame redactas hazme haceme armame arma prepara preparame draft compose elabora genera componme crea create whip'.split(),
  '@documento': 'carta letter correo email informe report resumen summary propuesta proposal contrato agreement memo memorando acta minutes cotizacion quote discurso speech solicitud request publicacion post invitacion invitation plan borrador'.split(),
  '@pantalla': 'pantalla screen monitor ventana window'.split(),
  '@ver': 've ves mira mirame lee leeme read look see analiza analyze revisa checa check explicame explain scan'.split(),
  '@captura': 'captura screenshot pantallazo capture snap grab'.split(),
  '@volumen': 'volumen volume sonido sound audio'.split(),
  '@subir': 'sube subele subi subile aumenta alto fuerte louder up raise increase crank pump boost mas'.split(),
  '@bajar': 'baja bajale baja bajale bajo quedito suave quieter down lower decrease reduce menos'.split(),
  '@mute': 'mute mutea silencia unmute'.split(),
  '@musica': 'musica music cancion song video tema track rola spotify reproduccion playback'.split(),
  '@play': 'play pausa pause reanuda resume continua continue unpause'.split(),
  '@siguiente': 'siguiente next anterior previous salta skip pasa pasale otra another'.split(),
  '@recordar': 'recuerdame recordame avisame acuerdame recordatorio reminder remind alarma alarm alerta alert timer temporizador ping nudge agendame'.split(),
  '@tiempo': 'minutos minutes minuto hora horas hour hours pm am noon tarde noche manana ratito bit'.split(),
  '@callar': 'callate calla callese silencio silence shh quiet hush chito basta enough zip stop para detente'.split(),
  '@todo': 'todo todas everything all total'.split(),
  '@chat': 'chat panel conversacion conversation historial history ventana'.split(),
  '@ocultar': 'escondete ocultate cierrate minimizate recogete achicate hide collapse shrink tuck'.split(),
  '@avatar': 'claudio aura antonio ant onio guardian ojos eyes avatar hormiga zorro dorada fox golden'.split(),
  '@bloquear': 'bloquea bloquea bloquear lock candado asegura secure'.split(),
  '@neg': 'no not dont nunca never ni'.split(),
  '@pregunta': 'que como cuando donde quien cual cuanto por what how when where who why which'.split(),
  '@contar': 'ayer yesterday fui estuvo estaba hice was were did went abri escribi busque cerre copie descargue'.split(),
  '@pulsar': 'dale pulsa pulsale presiona aprieta clic click press tap hit selecciona select choose elige'.split(),
  '@control': 'boton botones button buttons pestana pestanas tab tabs menu menus opcion opciones option options controles controls'.split(),
  '@ventana2': 'ventana window minimiza maximiza cierra cerra minimize maximize close restaura restore frente front'.split(),
  '@cambiar': 'cambia cambiate pasame vuelve regresa trae traeme switch bring'.split(),
  '@info': 'hora horas time fecha date dia day bateria battery cargador plugged espacio space disco disk wifi internet conectado connected'.split(),
  '@copia': 'copie copiado copiaste portapapeles clipboard copied'.split(),
  '@archivo': 'archivo archivos file files documento document pdf descarga descargue download downloaded baje'.split(),
  '@musica2': 'sonando suena cancion canta escuchando playing song sings listening spotify youtube reproduce playlist'.split(),
  '@correo': 'correo correos email emails mail inbox bandeja'.split(),
  '@agenda': 'agenda calendario calendar reunion reuniones cita citas meeting meetings schedule junta'.split(),
 },
 'prefijos': {
  '@abrir': 'abre abri inici arranc ejecut lanz'.split(),
  '@buscar': 'busc googl averigu investig'.split(),
  '@escribir': 'escrib tecle dict transcrib'.split(),
  '@redactar': 'redact elabor'.split(),
  '@recordar': 'recuerd record acuerd remind avis'.split(),
  '@captura': 'captur screensh pantallaz'.split(),
  '@callar': 'calla silenc'.split(),
  '@bloquear': 'bloque'.split(),
  '@ocultar': 'escond ocult'.split(),
  '@ventana2': 'minimiz maximiz'.split(),
  '@pulsar': 'puls presion apriet'.split(),
  '@copia': 'copi'.split(),
  '@archivo': 'archiv descarg'.split(),
 },
}

MUESTRAS = ['abre excel', 'open spotify', 'abre descargas', 'busca el precio del café', 'abre youtube', 'escribe hola en el bloc de notas',
            'redáctame una carta de renuncia', 'qué ves en mi pantalla', 'toma un screenshot', 'súbele al volumen', 'bájale', 'mute',
            'pausa la canción', 'siguiente canción', 'recuérdame en 10 minutos tomar agua', 'cállate', 'pausa todo', 'abre el chat',
            'escóndete', 'cambia a claudio', 'minimiza todo', 'bloquea la compu', 'hola aura, cómo estás', 'ayer abrí word y se trabó',
            'qué está sonando', 'pon bad bunny en spotify', 'léeme mis correos', 'qué tengo hoy',
            'dale a guardar', 'qué botones hay', 'cierra esta ventana', 'cuánta batería me queda', 'resume lo que copié', 'abre el último archivo que descargué']


def usar_lexico():
    el.LEXICO = LEXICO
    el._EXACTA = {}
    for c, ws in LEXICO['exactas'].items():
        for w in ws:
            if c not in el._EXACTA.setdefault(w, []):
                el._EXACTA[w].append(c)
    el._PREFIJOS = sorted(((p, c) for c, ps in LEXICO['prefijos'].items() for p in ps), key=lambda x: (-len(x[0]), x[0], x[1]))


def leer(rutas):
    filas = []
    for r in rutas:
        with open(r, encoding='utf-8') as f:
            for linea in f:
                linea = linea.strip()
                if linea:
                    d = json.loads(linea)
                    filas.append({'q': d['q'], 'y': d['e'][0], 'l': d.get('l', 'es')})
    return filas


def metricas(filas, P, etiquetas, umbral):
    y = np.array([etiquetas.index(f['y']) for f in filas])
    pred, conf = P.argmax(1), P.max(1)
    ning = etiquetas.index('win_ninguna')
    decide = (pred != ning) & (conf >= umbral)
    positivos = y != ning
    out = {'n': len(filas), 'exactitud': float((pred == y).mean()) if len(filas) else 0.0,
           'cobertura': float((decide & positivos).sum() / max(1, positivos.sum())),
           'precision_ejecutables': float(((pred == y) & decide).sum() / max(1, decide.sum())),
           'decididos': int(decide.sum()),
           'falsos_positivos_en_negativos': int((decide & ~positivos).sum()), 'negativos': int((~positivos).sum())}
    por = {}
    for k, e in enumerate(etiquetas):
        tp = int(((pred == k) & (y == k)).sum()); fp = int(((pred == k) & (y != k)).sum()); fn = int(((pred != k) & (y == k)).sum())
        p, r = tp / max(1, tp + fp), tp / max(1, tp + fn)
        por[e] = {'precision': round(p, 3), 'recall': round(r, 3), 'f1': round(2 * p * r / max(1e-9, p + r), 3), 'soporte': tp + fn}
    out['por_etiqueta'] = por
    return out


def elegir_umbral(filas, P, etiquetas, precision=0.985, piso=0.5):
    for u in [round(x, 2) for x in np.arange(piso, 0.991, 0.01)]:
        if metricas(filas, P, etiquetas, u)['precision_ejecutables'] >= precision:
            return u
    return 0.99


def escribir_cs(ruta, etiquetas, dim, q, escala, b, T, umbral, muestras, meta):
    datos = base64.b64encode(q.tobytes(order='C')).decode('ascii')
    cs = lambda s: json.dumps(s, ensure_ascii=False)
    exactas = ', '.join(f'[{cs(k)}] = new[] {{ {", ".join(cs(w) for w in v)} }}' for k, v in LEXICO['exactas'].items())
    prefijos = ', '.join(f'[{cs(k)}] = new[] {{ {", ".join(cs(w) for w in v)} }}' for k, v in LEXICO['prefijos'].items())
    fl = lambda xs: ', '.join(f'{float(x):.6f}' for x in xs)
    lineas = [
        '// PESOS de Laya ligera para Windows (LayaLigera.cs). ARCHIVO GENERADO: no se edita a mano.',
        '//   scripts/nodo-t4/laya/ligera/entrenar_ligera_windows.py → este archivo + ligera/informe-windows.json',
        f'// Entrenado con {meta["entrenamiento"]} frases (modelos/windows/datos), {dim} cubos × {len(etiquetas)} etiquetas en int8.',
        'using System.Collections.Generic;',
        'namespace Aura.Windows.Core;',
        'public static partial class LayaLigeraModelo {',
        f' public static readonly string[] Etiquetas = {{ {", ".join(cs(e) for e in etiquetas)} }};',
        f' public const int Dim = {dim};',
        f' public const double Temperatura = {T};',
        f' public const double Umbral = {umbral};',
        f' public static readonly double[] Escala = {{ {fl(escala)} }};',
        f' public static readonly double[] Sesgo = {{ {fl(b)} }};',
        f' public const string PesosB64 = "{datos}";',
        f' public static readonly Dictionary<string, string[]> Exactas = new() {{ {exactas} }};',
        f' public static readonly Dictionary<string, string[]> Prefijos = new() {{ {prefijos} }};',
        ' public static readonly (string Q, string Etiqueta, double P)[] Muestras = {',
        *[f'  ({cs(m["q"])}, {cs(m["etiqueta"])}, {m["p"]}),' for m in muestras],
        ' };',
        f' public const string Entrenado = {cs(meta["fecha"])};',
        '}',
        '',
    ]
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    with open(ruta, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lineas))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dim', type=int, default=8192)
    ap.add_argument('--epocas', type=int, default=10)
    ap.add_argument('--lr', type=float, default=0.05)
    ap.add_argument('--l2', type=float, default=1e-4)
    ap.add_argument('--semilla', type=int, default=7)
    ap.add_argument('--balance', type=float, default=0.5)
    ap.add_argument('--precision-minima', type=float, default=0.97)
    ap.add_argument('--salida', default=SALIDA_CS)
    ap.add_argument('--informe', default=INFORME)
    ap.add_argument('--forzar', action='store_true')
    a = ap.parse_args()
    usar_lexico()

    m = json.load(open(os.path.join(WINDOWS, 'modelo.json'), encoding='utf-8'))
    etiquetas = m['grupos']['win']
    D = lambda n: os.path.join(WINDOWS, 'datos', n)
    val, test, bordes = leer([D('val.jsonl')]), leer([D('test.jsonl')]), leer([D('bordes.jsonl')])
    apartados = {el.normalizar(f['q']) for f in val + test + bordes}
    ent, vistos = [], set()
    for f in leer(sorted(glob.glob(D('train_*.jsonl')))):
        k = el.normalizar(f['q'])
        if k in apartados or k in vistos:
            continue
        vistos.add(k)
        ent.append(f)
    print(f'entrenamiento {len(ent)} · validación {len(val)} · prueba {len(test)} · bordes {len(bordes)}')

    K = len(etiquetas)
    X, y = el.matriz(ent, a.dim), [etiquetas.index(f['y']) for f in ent]
    Xv, yv = el.matriz(val, a.dim), [etiquetas.index(f['y']) for f in val]
    cuenta = np.bincount(y, minlength=K).astype(float)
    pesos_clase = (len(y) / (K * np.maximum(cuenta, 1))) ** a.balance
    t0 = time.time()
    W, b = el.entrenar(X, y, K, a.dim, pesos_clase, a.epocas, a.lr, a.l2, a.semilla, Xv, yv)
    print(f'entrenado en {time.time() - t0:.1f} s (CPU)')
    q, escala = el.cuantizar(W)
    Wq = el.descuantizar(q, escala)
    T = el.ajustar_temperatura(el.logits_de(Xv, Wq, b), np.array(yv))
    Pv = el.softmax(el.logits_de(Xv, Wq, b) / T)
    umbral = elegir_umbral(val, Pv, etiquetas)
    print(f'temperatura {T} · umbral {umbral}')

    informe = {'dim': a.dim, 'epocas': a.epocas, 'semilla': a.semilla, 'temperatura': T, 'umbral': umbral, 'entrenamiento': len(ent)}
    for nombre, filas in (('validacion', val), ('prueba', test), ('bordes', bordes)):
        P = el.softmax(el.logits_de(el.matriz(filas, a.dim), Wq, b) / T)
        informe[nombre] = metricas(filas, P, etiquetas, umbral)
        informe[nombre]['por_idioma'] = {l: metricas([filas[i] for i in s], P[s], etiquetas, umbral)['exactitud']
                                         for l in ('es', 'en') for s in [[i for i, f in enumerate(filas) if f['l'] == l]] if s}
        if nombre != 'validacion':
            informe[nombre]['errores'] = [{'q': f['q'], 'oro': f['y'], 'dijo': etiquetas[int(P[i].argmax())], 'p': round(float(P[i].max()), 3)}
                                          for i, f in enumerate(filas) if etiquetas[int(P[i].argmax())] != f['y']][:60]
    tp = informe['prueba']
    print(f"prueba: exactitud {tp['exactitud']:.3f} · con umbral {umbral}: cobertura {tp['cobertura']:.3f}, precisión de lo que ejecutaría "
          f"{tp['precision_ejecutables']:.3f} ({tp['decididos']}), falsos positivos {tp['falsos_positivos_en_negativos']}/{tp['negativos']} · {tp['por_idioma']}")
    tb = informe['bordes']
    print(f"bordes: exactitud {tb['exactitud']:.3f} · errores {[(e['q'], e['dijo']) for e in tb['errores']]}")
    motivos = []
    if tp['precision_ejecutables'] < a.precision_minima:
        motivos.append(f"precisión de lo que se ejecutaría {tp['precision_ejecutables']:.3f} < {a.precision_minima}")
    informe['compuerta'] = {'aprobada': not motivos, 'motivos': motivos}
    print('COMPUERTA: ' + ('APROBADA' if not motivos else 'RECHAZADA · ' + ' · '.join(motivos)))
    if motivos and not a.forzar:
        raise SystemExit(1)
    Pm = el.softmax(el.logits_de(el.matriz([{'q': s} for s in MUESTRAS], a.dim), Wq, b) / T)
    muestras = [{'q': s, 'etiqueta': etiquetas[int(Pm[i].argmax())], 'p': round(float(Pm[i].max()), 6)} for i, s in enumerate(MUESTRAS)]
    informe['muestras'] = muestras
    informe['fecha'] = time.strftime('%Y-%m-%d')
    escribir_cs(a.salida, etiquetas, a.dim, q, escala, b, T, umbral, muestras, {'entrenamiento': len(ent), 'fecha': informe['fecha']})
    with open(a.informe, 'w', encoding='utf-8') as f:
        json.dump(informe, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('escrito', a.salida, 'y', a.informe)


if __name__ == '__main__':
    main()
