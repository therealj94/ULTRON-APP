"""Oído de respaldo de AU-RA en la T4: Whisper large-v3-turbo (faster-whisper) en la GPU.

Contesta lo mismo que contestaba Voicebox en /transcribe, así lib/oido.ts (`transcribirVoicebox`) no
cambia: multipart con `file`, `language` opcional (sin él detecta el idioma) y `model` (se ignora).
Devuelve {"text", "duration", "language"}. Caddy lo publica en /transcribe con la misma X-Voz-Clave.

Medido en la T4 el 1-oct-2026 (frase de 4,5 s): 0,33 s y 1,2 GB de VRAM con int8_float16. Voicebox
tardaba 0,79 s y ocupaba 4,7 GB. En CPU, turbo tarda 10 s: por eso va en la GPU.

    OIDO_CLAVE=... python servidor.py [--puerto 17495] [--modelo large-v3-turbo]
    GET  /health     → {"ok": true, "modelo": ..., "device": "cuda"}
    POST /transcribe → {"text": "...", "duration": 4.5, "language": "es"}
"""
import argparse
import email.parser
import email.policy
import hmac
import io
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from faster_whisper import WhisperModel

MAX_BYTES = 25 * 1024 * 1024
CLAVE = os.environ.get('OIDO_CLAVE', '')


def leer_multipart(tipo, cuerpo):
    """Los campos de un multipart/form-data, sin el módulo cgi (ya no está en Python 3.13)."""
    msg = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(
        b'Content-Type: ' + tipo.encode('latin-1') + b'\r\nMIME-Version: 1.0\r\n\r\n' + cuerpo)
    campos = {}
    if not msg.is_multipart():
        return campos
    for parte in msg.iter_parts():
        nombre = parte.get_param('name', header='content-disposition')
        if nombre:
            campos[nombre] = parte.get_payload(decode=True) or b''
    return campos


class Oido:
    def __init__(self, modelo, raiz):
        t = time.time()
        self.nombre = modelo
        self.modelo = WhisperModel(modelo, device='cuda', compute_type='int8_float16', download_root=raiz)
        # Una a la vez: la T4 es compartida con Laya y un pico de pedidos no debe llenarle la memoria.
        self.cerrojo = threading.Lock()
        print(f'oído: {modelo} en cuda, cargado en {time.time() - t:.1f} s', flush=True)

    def oir(self, audio, idioma):
        with self.cerrojo:
            segs, info = self.modelo.transcribe(io.BytesIO(audio), language=idioma or None, beam_size=1,
                                                vad_filter=True, condition_on_previous_text=False)
            texto = ''.join(s.text for s in segs).strip()
        return {'text': texto, 'duration': round(info.duration, 3), 'language': info.language}


def manejador(oido):
    class H(BaseHTTPRequestHandler):
        def responder(self, codigo, datos):
            cuerpo = json.dumps(datos, ensure_ascii=False).encode()
            self.send_response(codigo)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(cuerpo)))
            self.end_headers()
            self.wfile.write(cuerpo)

        def autorizado(self):
            return bool(CLAVE) and hmac.compare_digest(self.headers.get('X-Voz-Clave', ''), CLAVE)

        def do_GET(self):
            if self.path == '/health':
                return self.responder(200, {'ok': True, 'status': 'healthy', 'modelo': oido.nombre, 'device': 'cuda'})
            self.responder(404, {'error': 'no existe'})

        def do_POST(self):
            if self.path != '/transcribe':
                return self.responder(404, {'error': 'no existe'})
            if not self.autorizado():
                return self.responder(403, {'error': 'clave'})
            largo = int(self.headers.get('Content-Length') or 0)
            if largo <= 0 or largo > MAX_BYTES:
                return self.responder(413, {'error': 'audio vacío o de más de 25 MB'})
            campos = leer_multipart(self.headers.get('Content-Type', ''), self.rfile.read(largo))
            audio = campos.get('file') or b''
            if len(audio) < 80:
                return self.responder(400, {'error': 'sin audio'})
            idioma = (campos.get('language') or b'').decode('utf-8', 'ignore').strip()[:5]
            t = time.time()
            try:
                out = oido.oir(audio, idioma)
            except Exception as e:  # audio que av no sabe abrir, sobre todo
                print('oído falló:', str(e)[:200], flush=True)
                return self.responder(422, {'error': 'no pude leer ese audio'})
            print(f'oído: {out["duration"]:.1f} s de audio en {time.time() - t:.2f} s', flush=True)
            self.responder(200, out)

        def log_message(self, *a):
            pass

    return H


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--puerto', type=int, default=int(os.environ.get('OIDO_PUERTO', 17495)))
    p.add_argument('--modelo', default=os.environ.get('OIDO_MODELO', 'large-v3-turbo'))
    p.add_argument('--raiz', default=os.environ.get('OIDO_RAIZ', '/opt/oido/modelos'))
    a = p.parse_args()
    if not CLAVE:
        raise SystemExit('Falta OIDO_CLAVE: sin ella el oído contestaría a cualquiera.')
    servidor = ThreadingHTTPServer(('127.0.0.1', a.puerto), manejador(Oido(a.modelo, a.raiz)))
    print(f'oído en 127.0.0.1:{a.puerto}', flush=True)
    servidor.serve_forever()
