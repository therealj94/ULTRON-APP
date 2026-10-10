import json, subprocess, re, os
d = json.load(open('/root/indice/clasificacion.json'))
L = '/datos/lote-1/listo/INFORMACION ELECTRUM/'
def caja_db(t):
    m = re.findall(r'-?[\d.]+(?:e-?\d+)?', t or '')
    return [float(x) for x in m] if len(m) == 4 else None
C = {int(k): v for k, v in d['capas'].items()}
out = {}
for r in d['archivos']:
    if r['capa'] or not r['n']:
        continue
    p = L + r['rel']
    g = subprocess.run(['ogr2ogr', '-t_srs', 'EPSG:4326', '-f', 'GeoJSON', '/vsistdout/', p], capture_output=True).stdout.decode('utf-8', 'replace')
    try:
        fc = json.loads(g)
    except Exception:
        out[r['rel']] = None; continue
    xs, ys = [], []
    def ver(c):
        if isinstance(c[0], (int, float)): xs.append(c[0]); ys.append(c[1])
        else:
            for y in c: ver(y)
    for f in fc['features']:
        if f.get('geometry'): ver(f['geometry']['coordinates'])
    if not xs:
        out[r['rel']] = None; continue
    b = [min(xs), min(ys), max(xs), max(ys)]
    best = None
    for c in C.values():
        cb = caja_db(c['caja'])
        if not cb: continue
        dif = max(abs(cb[i] - b[i]) for i in range(4))
        if dif < 0.0005 and (best is None or dif < best[0] or (dif == best[0] and c['n'] == r['n'])):
            best = (dif, c['id'], c['nombre'], c['n'])
    out[r['rel']] = dict(caja=b, n=len(fc['features']), igual=best)
json.dump(out, open('/root/indice/empates.json', 'w'), ensure_ascii=False)
for k, v in out.items():
    print(k[-70:], '=>', v and v['igual'])
