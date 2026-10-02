# Prueba del parche sobre la COPIA, sin tocar el servicio: _empujar_aura contra un AU-RA falso local.
import importlib.util, json, os, sys, threading, tempfile, time
from http.server import BaseHTTPRequestHandler, HTTPServer
recibidos = []
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0)); b = json.loads(self.rfile.read(n))
        recibidos.append((self.headers.get('Authorization'), b))
        code = 410 if b['ref'].startswith('sinTel') else 200
        self.send_response(code); self.end_headers(); self.wfile.write(b'{}')
    def log_message(self, *a): pass
srv = HTTPServer(('127.0.0.1', 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
tmp = tempfile.mkdtemp()
os.environ.update(MENSAJES_DATOS=os.path.join(tmp, 'datos.json'), MENSAJES_AURA_URL=f'http://127.0.0.1:{srv.server_port}/api/push/relevo', MENSAJES_AURA_CLAVE='clave-prueba', MENSAJES_VAPID_PEM=os.path.join(tmp, 'no.pem'))
spec = importlib.util.spec_from_file_location('relevo_copia', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
ref = 'YW5hQHguY29t.' + 'a' * 32
assert m.RE_AURA.match(ref)
assert m._empujar_uno({'aura': ref}, 'normal') is True
assert recibidos[-1] == ('Bearer clave-prueba', {'ref': ref, 'tipo': 'mensaje'}), recibidos[-1]
assert m._empujar_uno({'aura': ref}, 'high') is True and recibidos[-1][1]['tipo'] == 'llamada'
assert m._empujar_uno({'aura': 'sinTel.' + 'b' * 32}, 'normal') is False, '410 → se poda'
assert m._empujar_uno({'aura': 'malo'}, 'normal') is False
# empujar(): una cuenta con un telefono AU-RA (sin VAPID) recibe el aviso y la poda no toca a los demás
d = {'fichas': {'ana@x.com': {'push': [{'aura': 'sinTel.' + 'c' * 32, 'aparato': 'a1'}, {'aura': ref, 'aparato': 'a2'}, {'endpoint': 'https://web.push/x', 'keys': {}}]}}}
m.guardar(d) if hasattr(m, 'guardar') else None
antes = len(recibidos)
m.empujar(m.cargar(), ['ana@x.com'])
for _ in range(50):
    if len(recibidos) >= antes + 2: break
    time.sleep(0.1)
time.sleep(0.5)
assert len(recibidos) == antes + 2, recibidos[antes:]
quedan = m.cargar()['fichas']['ana@x.com']['push']
assert [x.get('aura') or x.get('endpoint') for x in quedan] == [ref, 'https://web.push/x'], quedan
print('PRUEBAS OK', len(recibidos), 'avisos')
