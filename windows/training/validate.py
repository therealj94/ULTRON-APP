"""Validate seed schema and disjoint sets, not model accuracy."""
import json, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'engine'))
from comun import cargar_config, leer_filas, normalizar
root=Path(__file__).parent/'modelo'
cfg=cargar_config(str(root))
assert cfg['nombre']=='windows_command_v1'
seen=set()
for split,paths in cfg['rutas'].items():
 rows=leer_filas(paths,cfg['ids'],cfg['grupos'])
 assert rows,split
 keys=[normalizar(r['q']) for r in rows]
 assert len(keys)==len(set(keys)),f'duplicate in {split}'
 assert not seen.intersection(keys),f'leakage in {split}'
 seen.update(keys)
 print(split,len(rows))
assert all(x.startswith('win_') for x in cfg['ids'])
print('PASS: schema, exclusive labels, independent namespace, exact normalized split separation')
