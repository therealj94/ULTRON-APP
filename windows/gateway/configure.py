"""Generate a new private gateway environment file; never prints credentials."""
import argparse,json,os,secrets
from urllib.parse import urlparse
p=argparse.ArgumentParser();p.add_argument('--model',required=True);p.add_argument('--model-url',default='http://127.0.0.1:11434/v1/chat/completions');p.add_argument('--output',default='windows-gateway.env');a=p.parse_args()
u=urlparse(a.model_url)
if u.scheme!='https' and not(u.scheme=='http' and u.hostname in ['127.0.0.1','localhost','::1']):p.error('HTTPS required except loopback')
if any(c in a.model for c in '\r\n'):p.error('Model name must be one line')
values={'HOST':'127.0.0.1','PORT':'8787','WINDOWS_API_TOKEN':secrets.token_urlsafe(32),'WINDOWS_CHAT_MODEL':a.model,'WINDOWS_MODEL_URL':a.model_url,'WINDOWS_LAYA_URL':'http://127.0.0.1:8797/v1/intent','WINDOWS_LAYA_TOKEN':secrets.token_urlsafe(32)}
fd=os.open(a.output,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
with os.fdopen(fd,'w') as f:
 for key,value in values.items():f.write(f'{key}={json.dumps(value)}\n')
print('Private configuration created:',a.output)
print('Load with Node --env-file; configure TURN and HTTPS before use across networks.')
