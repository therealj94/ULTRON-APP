"""Isolated training entry. Refuses to overwrite an existing run."""
import argparse, pathlib, subprocess, sys, re
root=pathlib.Path(__file__).resolve().parent
p=argparse.ArgumentParser()
p.add_argument('--run',required=True)
p.add_argument('--device',choices=['cpu','cuda'],default='cpu')
p.add_argument('--epocas',type=int,default=4)
a=p.parse_args()
if not re.fullmatch(r'[a-z0-9_-]{1,50}',a.run): p.error('run must be a simple lowercase name')
out=root/'checkpoints'/a.run
if out.exists(): p.error('run exists; choose a new identifier')
subprocess.run([sys.executable,str(root/'validate.py')],check=True)
subprocess.run([sys.executable,str(root/'engine/entrenar.py'),'--modelo-dir',str(root/'modelo'),'--salida',str(out),'--device',a.device,'--epocas',str(a.epocas)],check=True)
