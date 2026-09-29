"""¿El modelo recién entrenado es al menos tan bueno como el que está sirviendo? Decide la promoción.

Lee dos informes de `evaluar.py --json` sobre las MISMAS pruebas apartadas (el anterior y el nuevo) y
sale con 0 si el nuevo se promueve y con 1 si no. Antes, reentrenar reemplazaba el modelo sin mirar:
datos reales mal etiquetados podían empeorar a Laya en producción sin que nadie se enterara.

    python comparar.py viejo.json nuevo.json [--tolerancia 0.01]

Qué se compara (la cifra que decide en cada modelo):
  · electrum: F1 del híbrido (lo que corre en producción: nombrados + Laya + tabla) en la prueba;
    si baja más que la tolerancia, no se promueve. El exacto se muestra al lado.
  · los demás (mensaje, documento, comando): F1 macro de Laya en «test» (o en «evals» si no hay test).
"""
import argparse
import json
import sys


def cifra(inf):
    """(nombre, valor principal, valor secundario) del informe, sea de electrum o de un modelo genérico."""
    if isinstance(inf.get('hibrido'), dict):
        h = inf['hibrido']
        return 'F1 híbrido', float(h['f1']), float(h.get('exacto', 0))
    for conjunto in ('test', 'evals'):
        c = inf.get(conjunto)
        if isinstance(c, dict) and isinstance(c.get('laya'), dict):
            L = c['laya']
            return f'F1 macro ({conjunto})', float(L['f1_macro']), float(L.get('todas_bien', 0))
    raise SystemExit('el informe no trae ni «hibrido» ni «test/evals»: ¿es de evaluar.py --json?')


def decidir(viejo, nuevo, tolerancia):
    nombre, v, v2 = cifra(viejo)
    nombre_n, n, n2 = cifra(nuevo)
    if nombre != nombre_n:
        raise SystemExit(f'los informes no son del mismo tipo de modelo: {nombre} vs {nombre_n}')
    promover = n >= v - tolerancia
    linea = f'{nombre}: anterior {v:.3f} → nuevo {n:.3f} (secundaria {v2:.3f} → {n2:.3f}); tolerancia {tolerancia:.3f}'
    return promover, linea


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('viejo')
    ap.add_argument('nuevo')
    ap.add_argument('--tolerancia', type=float, default=0.01)
    a = ap.parse_args()
    with open(a.viejo, encoding='utf-8') as f:
        viejo = json.load(f)
    with open(a.nuevo, encoding='utf-8') as f:
        nuevo = json.load(f)
    promover, linea = decidir(viejo, nuevo, a.tolerancia)
    print(('PROMOVER · ' if promover else 'NO PROMOVER · ') + linea)
    sys.exit(0 if promover else 1)


if __name__ == '__main__':
    main()
