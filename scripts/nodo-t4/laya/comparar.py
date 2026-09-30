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
    ya tenía el anterior: ninguno puede bajar más que la tolerancia. Se mira en «test» Y en «evals»
    (en «comando», el test es de Electrum y los evals son de AU-RA: si el grupo `app` empeora en la
    prueba de AU-RA, tampoco se promueve). Un grupo o un conjunto nuevo no tiene con qué compararse: se
    muestra y no frena, salvo que se le ponga un mínimo:

    python comparar.py viejo.json nuevo.json --minimo evals:app=0.85

  · --minimo conjunto:grupo=valor exige además esa exactitud al NUEVO (lo que AU-RA va a ejecutar sin
    esperar al cerebro no puede entrar flojo aunque el anterior fuera peor).
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
    """{conjunto: {grupo: exactitud}} de «test» y «evals», si el modelo no tiene etiquetas sueltas; si no, None."""
    out = {}
    for conjunto in ('test', 'evals'):
        c = inf.get(conjunto)
        if isinstance(c, dict) and isinstance(c.get('laya'), dict):
            L = c['laya']
            if L.get('sueltas') != 0:
                return None
            out[conjunto] = {k[len('grupo_'):]: float(v) for k, v in L.items() if k.startswith('grupo_')}
    return out or None


def decidir(viejo, nuevo, tolerancia, minimos=None):
    gv, gn = grupos_de(viejo), grupos_de(nuevo)
    minimos = minimos or {}
    if gv and gn:
        partes, promover = [], True
        for conjunto in ('test', 'evals'):
            v, n = gv.get(conjunto, {}), gn.get(conjunto, {})
            for g in sorted(set(v) | set(n)):
                if g in v and g in n:
                    ok = n[g] >= v[g] - tolerancia
                    promover = promover and ok
                    partes.append(f'{conjunto}/{g}: anterior {v[g]:.3f} → nuevo {n[g]:.3f}{"" if ok else " (BAJA)"}')
                elif g in n:
                    partes.append(f'{conjunto}/{g} (nuevo): {n[g]:.3f}')
        for (conjunto, g), minimo in sorted(minimos.items()):
            valor = gn.get(conjunto, {}).get(g)
            ok = valor is not None and valor >= minimo
            promover = promover and ok
            partes.append(f'mínimo {conjunto}/{g} ≥ {minimo:.3f}: {"sin cifra" if valor is None else f"{valor:.3f}"}{"" if ok else " (NO LLEGA)"}')
        return promover, 'exactitud por grupo: ' + ' · '.join(partes) + f'; tolerancia {tolerancia:.3f}'
    nombre, v, v2 = cifra(viejo)
    nombre_n, n, n2 = cifra(nuevo)
    if nombre != nombre_n:
        raise SystemExit(f'los informes no son del mismo tipo de modelo: {nombre} vs {nombre_n}')
    promover = n >= v - tolerancia
    linea = f'{nombre}: anterior {v:.3f} → nuevo {n:.3f} (secundaria {v2:.3f} → {n2:.3f}); tolerancia {tolerancia:.3f}'
    return promover, linea


def leer_minimos(lista):
    """['evals:app=0.85', …] → {('evals', 'app'): 0.85}."""
    out = {}
    for m in lista or []:
        try:
            clave, valor = m.split('=')
            conjunto, grupo = clave.split(':')
            out[(conjunto.strip(), grupo.strip())] = float(valor)
        except ValueError:
            raise SystemExit(f'--minimo raro: {m!r} (se escribe conjunto:grupo=valor, p. ej. evals:app=0.85)')
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('viejo')
    ap.add_argument('nuevo')
    ap.add_argument('--tolerancia', type=float, default=0.01)
    ap.add_argument('--minimo', action='append', help='conjunto:grupo=valor que el NUEVO tiene que alcanzar (se puede repetir)')
    a = ap.parse_args()
    with open(a.viejo, encoding='utf-8') as f:
        viejo = json.load(f)
    with open(a.nuevo, encoding='utf-8') as f:
        nuevo = json.load(f)
    promover, linea = decidir(viejo, nuevo, a.tolerancia, leer_minimos(a.minimo))
    print(('PROMOVER · ' if promover else 'NO PROMOVER · ') + linea)
    sys.exit(0 if promover else 1)


if __name__ == '__main__':
    main()
