import argparse,json,sys,hashlib,importlib.metadata
from pathlib import Path
root=Path(__file__).resolve().parent
sys.path.insert(0,str(root/'engine'))
import laya
from comun import cargar_config,leer_filas
from entrenar import codificar,logits_de,matriz
p=argparse.ArgumentParser();p.add_argument('--checkpoint',required=True);p.add_argument('--device',default='cpu');a=p.parse_args()
checkpoint=Path(a.checkpoint);cfg=cargar_config(str(root/'modelo'));agent=laya.load(str(checkpoint),device=a.device)
assert agent.cfg['decisor']['nombre']=='windows_command_v1'
ids=cfg['ids'];internal={i:agent._to_internal(cfg['preguntas'][i]) for i in ids}
report={'model':'windows_command_v1','checkpoint':str(checkpoint.name),'sets':{},'versions':{},'eligibleForActivation':False,'note':'Candidate only; seed evaluation is too small for production certification.'}
for split in ['test','bordes']:
 rows=leer_filas(cfg['rutas'][split],ids,cfg['grupos']);items=codificar(agent,internal,rows,ids);probs=matriz(items,logits_de(agent.model,items,a.device),len(rows),agent.cfg['temperature'][2],len(ids))
 predicted=[];errors=[];correct=0
 for row,pr in zip(rows,probs):
  order=pr.argsort()[::-1];i=int(order[0]);j=int(order[1]);label=ids[i] if float(pr[i])>=.9 and float(pr[i]-pr[j])>=.2 else 'win_none'
  predicted.append(label);correct+=label in row['e']
  if label not in row['e']:errors.append({'q':row['q'],'expected':row['e'],'predicted':label,'score':float(pr[i])})
 by_class={}
 for label in ids:
  tp=sum(p==label and label in r['e'] for p,r in zip(predicted,rows));fp=sum(p==label and label not in r['e'] for p,r in zip(predicted,rows));fn=sum(p!=label and label in r['e'] for p,r in zip(predicted,rows))
  by_class[label]={'precision':tp/max(1,tp+fp),'recall':tp/max(1,tp+fn),'support':tp+fn}
 report['sets'][split]={'n':len(rows),'accuracy':correct/len(rows),'perClass':by_class,'errors':errors,'nonNonePredictions':sum(x!='win_none' for x in predicted)}
for name in ['torch','laya','numpy','safetensors']:report['versions'][name]=importlib.metadata.version(name)
report['dataHashes']={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (root/'modelo').rglob('*.jsonl')}
(checkpoint/'evaluation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
