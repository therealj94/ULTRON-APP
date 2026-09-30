"""¿El modelo recién entrenado es al menos tan bueno como el que está sirviendo? Decide la promoción.

Lee dos informes de `evaluar.py --json` sobre las MISMAS pruebas apartadas (el anterior y el nuevo) y
sale con 0 si el nuevo se promueve y con 1 si no. Antes, reentrenar reemplazaba el modelo sin mirar:
datos reales mal etiquetados podían empeorar a Laya en producción sin que nadie se enterara.

    python comparar.py viejo.json nuevo.json [--tolerancia 0.01]

Qué se compara (la cifra que decide en cada modelo):
  · electrum: F1 del híbrido (lo que corre en producción: nombrados + Laya + tabla) en la prueba;
    si baja más que la tolerancia, no se promueve. El exacto se muestra al lado.
  · los demás (mensaje, documento): F1 macro de Laya en «test» (o en «evals» si no hay test).
  · un modelo SIN etiquetas sueltas (todo en grupos exclusivos, como «comando»): ahí el F1 macro es
    siempre 0 y no decidía nada (se promovía cualquiera). Se decide por la EXACTITUD DE CADA GRUPO que
    ya tenía el anterior: ninguno puede bajar más que la tolerancia. Un grupo nuevo (el `app` de
    AU-RA en «comando») no tiene con qué compararse: se muestra y no frena.
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


def grupos_de(inf):
    """{grupo: exactitud} del conjunto que decide, si el modelo no tiene etiquetas sueltas; si no, None."""
    for conjunto in ('test', 'evals'):
        c = inf.get(conjunto)
        if isinstance(c, dict) and isinstance(c.get('laya'), dict):
            L = c['laya']
            if L.get('sueltas') == 0:
                return conjunto, {k[len('grupo_'):]: float(v) for k, v in L.items() if k.startswith('grupo_')}
            return None
    return None


def decidir(viejo, nuevo, tolerancia):
    gv, gn = grupos_de(viejo), grupos_de(nuevo)
    if gv and gn:
        conjunto, v = gv
        _, n = gn
        partes, promover = [], True
        for g in sorted(set(v) | set(n)):
            if g in v and g in n:
                ok = n[g] >= v[g] - tolerancia
                promover = promover and ok
                partes.append(f'grupo {g}: anterior {v[g]:.3f} → nuevo {n[g]:.3f}{"" if ok else " (BAJA)"}')
            elif g in n:
                partes.append(f'grupo {g} (nuevo): {n[g]:.3f}')
        return promover, f'exactitud por grupo ({conjunto}): ' + ' · '.join(partes) + f'; tolerancia {tolerancia:.3f}'
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
