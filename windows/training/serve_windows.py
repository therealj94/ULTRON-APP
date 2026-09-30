"""Loopback-only Windows intent service; suggestions, never OS execution."""
import argparse,hmac,json,os,sys,threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
root=Path(__file__).resolve().parent;sys.path.insert(0,str(root/'engine'))
import laya,torch
from comun import cargar_config
from entrenar import codificar,logits_de,matriz
p=argparse.ArgumentParser();p.add_argument('--checkpoint',required=True);p.add_argument('--port',type=int,default=8797);p.add_argument('--device',default='cpu');a=p.parse_args()
key=os.environ.get('WINDOWS_LAYA_TOKEN','')
if len(key)<32:raise SystemExit('WINDOWS_LAYA_TOKEN must be at least 32 characters')
torch.set_num_threads(2)
checkpoint=Path(a.checkpoint);cfg=cargar_config(str(checkpoint));agent=laya.load(str(checkpoint),device=a.device)
if cfg['nombre']!='windows_command_v1' or agent.cfg.get('decisor',{}).get('nombre')!='windows_command_v1':raise SystemExit('Refusing non-Windows model')
ids=cfg['ids'];questions={i:agent._to_internal(cfg['preguntas'][i]) for i in ids};busy=threading.Lock()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def reply(self,status,body):
  data=json.dumps(body).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def do_POST(self):
  if self.path!='/v1/intent':return self.reply(404,{'error':'not_found'})
  if not hmac.compare_digest(self.headers.get('Authorization','').encode(),('Bearer '+key).encode()):return self.reply(401,{'error':'unauthorized'})
  try:
   n=int(self.headers.get('Content-Length','0'))
   if not 0<n<=20000:return self.reply(413,{'error':'body_size'})
   body=json.loads(self.rfile.read(n));text=body['text']
   if not isinstance(text,str) or not 0<len(text)<=4000:return self.reply(400,{'error':'text_size'})
  except (ValueError,KeyError,TypeError):return self.reply(400,{'error':'invalid_json'})
  if not busy.acquire(blocking=False):return self.reply(429,{'error':'busy'})
  try:
   items=codificar(agent,questions,[{'q':text,'e':[]}],ids)
   probs=matriz(items,logits_de(agent.model,items,a.device),1,agent.cfg['temperature'][2],len(ids))[0]
   order=probs.argsort()[::-1];top,second=int(order[0]),int(order[1]);score=float(probs[top]);margin=float(probs[top]-probs[second])
   intent=ids[top] if score>=.9 and margin>=.2 else 'win_none'
   self.reply(200,{'model':'windows_command_v1','intent':intent,'confidence':score,'margin':margin,'candidate':True})
  finally:busy.release()
print('AURA Windows intent service on loopback; no texts logged',flush=True)
ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
