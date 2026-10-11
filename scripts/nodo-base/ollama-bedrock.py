#!/usr/bin/env python3
"""
EL MOTOR SIN GPU. Habla como Ollama (lo que esperan AU-RA de PULSE2CHAT y el motor con secreto) y
contesta con Bedrock: GLM-5 primero y Kimi K2.5 de relevo, el mismo cerebro que Dr Electrum.

Reemplaza en la máquina de la base a llama.cpp + Qwen + ollama-proxy-ndjson.py (la A10G). Escucha
SOLO en 127.0.0.1: el que da la cara hacia fuera sigue siendo ultron-motor.py, con su secreto y TLS.

  GET  /api/tags        los nombres que los clientes tienen configurados (MOTOR_NOMBRES), para que
                        su comprobación de «¿está mi modelo?» siga pasando.
  POST /api/chat        mensajes de Ollama → Converse de Bedrock. stream true (NDJSON, por omisión,
                        como Ollama) o false (un JSON). options: temperature, num_predict, stop.
  POST /api/precalentar no hay nada que calentar: 200.

GLM-5 no acepta `stopSequences`: las paradas (el «freno de las listas» de AU-RA) se aplican aquí,
cortando el texto en cuanto aparece una. El resultado es el mismo que en Ollama.

Credenciales: las del rol de la máquina (boto3 las encuentra solo). Región: MOTOR_REGION (us-west-2,
donde Render ya usa estos modelos).
"""
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import boto3
from botocore.config import Config

REGION = os.environ.get('MOTOR_REGION', 'us-west-2')
MODELOS = [m.strip() for m in os.environ.get('MOTOR_MODELOS', 'zai.glm-5,moonshotai.kimi-k2.5').split(',') if m.strip()]
NOMBRES = [n.strip() for n in os.environ.get(
    'MOTOR_NOMBRES', 'qwen3.8:27b,qwen2.5:14b,orcarouter/Qwen3.8-27B-Uncensored,glm-5').split(',') if n.strip()]
PUERTO = int(os.environ.get('MOTOR_PUERTO', '11434'))
MAX_SALIDA = int(os.environ.get('MOTOR_MAX_SALIDA', '4096'))

_cliente = None
_candado = threading.Lock()


def cliente():
    global _cliente
    with _candado:
        if _cliente is None:
            _cliente = boto3.client('bedrock-runtime', region_name=REGION,
                                    config=Config(read_timeout=120, connect_timeout=10, retries={'max_attempts': 1}))
    return _cliente


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, file=sys.stderr, flush=True)


def a_converse(mensajes):
    """Mensajes de Ollama → (system, messages) de Converse: roles alternados y empezando por el usuario."""
    sistema, salida = [], []
    for m in mensajes or []:
        if not isinstance(m, dict):
            continue
        rol = m.get('role')
        texto = m.get('content')
        if not isinstance(texto, str) or not texto.strip():
            continue
        if rol == 'system':
            sistema.append({'text': texto})
            continue
        rol = 'assistant' if rol == 'assistant' else 'user'
        if salida and salida[-1]['role'] == rol:
            salida[-1]['content'][0]['text'] += '\n\n' + texto
        else:
            salida.append({'role': rol, 'content': [{'text': texto}]})
    while salida and salida[0]['role'] != 'user':
        salida.pop(0)
    if not salida:
        salida = [{'role': 'user', 'content': [{'text': '(sin mensaje)'}]}]
    return sistema, salida


def config_inferencia(opciones):
    o = opciones if isinstance(opciones, dict) else {}
    c = {'maxTokens': MAX_SALIDA}
    try:
        n = int(o.get('num_predict'))
        if n > 0:
            c['maxTokens'] = min(n, MAX_SALIDA)
    except (TypeError, ValueError):
        pass
    try:
        if o.get('temperature') is not None:
            c['temperature'] = max(0.0, min(1.0, float(o['temperature'])))
    except (TypeError, ValueError):
        pass
    paradas = [s for s in (o.get('stop') or []) if isinstance(s, str) and s]
    return c, paradas


def cortar(texto, paradas):
    """Dónde cortar por la primera parada que aparezca (o None)."""
    cortes = [texto.find(s) for s in paradas if s in texto]
    return min(cortes) if cortes else None



def generar(cuerpo):
    """Genera (trozo, fin) con el primer modelo que conteste; fin = 'stop' | 'length' al terminar."""
    sistema, mensajes = a_converse(cuerpo.get('messages'))
    inferencia, paradas = config_inferencia(cuerpo.get('options'))
    ultimo_error = None
    for i, modelo in enumerate(MODELOS):
        dicho = ''
        entregado = 0
        try:
            pedido = {'modelId': modelo, 'messages': mensajes, 'inferenceConfig': inferencia}
            if sistema:
                pedido['system'] = sistema
            r = cliente().converse_stream(**pedido)
            fin = 'stop'
            for ev in r['stream']:
                if 'contentBlockDelta' in ev:
                    trozo = ev['contentBlockDelta'].get('delta', {}).get('text')
                    if not trozo:
                        continue
                    dicho += trozo
                    # Se retiene lo justo para que una parada partida entre dos trozos no se escape.
                    retener = max((len(s) for s in paradas), default=1) - 1
                    c = cortar(dicho, paradas) if paradas else None
                    if c is not None:
                        if c > entregado:
                            yield dicho[entregado:c], None
                        yield '', 'stop'
                        return
                    hasta = max(entregado, len(dicho) - retener)
                    if hasta > entregado:
                        yield dicho[entregado:hasta], None
                        entregado = hasta
                elif 'messageStop' in ev:
                    fin = 'length' if ev['messageStop'].get('stopReason') == 'max_tokens' else 'stop'
            if len(dicho) > entregado:
                yield dicho[entregado:], None
            yield '', fin
            return
        except Exception as e:  # noqa: BLE001 — cualquier fallo del modelo pasa al relevo
            ultimo_error = e
            log('modelo', modelo, 'falló:', type(e).__name__, str(e)[:160])
            if entregado or dicho:
                # Ya salió texto: no se empieza otra respuesta encima. Se cierra con lo que hubo.
                yield '', 'stop'
                return
            continue
    raise RuntimeError(f'ningún modelo contestó: {type(ultimo_error).__name__}: {str(ultimo_error)[:200]}')


class Manejador(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, formato, *args):
        log(self.address_string(), formato % args)

    def _json(self, codigo, obj):
        b = json.dumps(obj).encode()
        self.send_response(codigo)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path.split('?')[0] == '/api/tags':
            return self._json(200, {'models': [{'name': n, 'model': n} for n in NOMBRES]})
        if self.path.split('?')[0] in ('/', '/salud'):
            return self._json(200, {'ok': True, 'motor': 'bedrock', 'modelos': MODELOS})
        return self._json(404, {'error': 'no existe'})

    def do_POST(self):
        ruta = self.path.split('?')[0]
        largo = int(self.headers.get('Content-Length') or 0)
        try:
            cuerpo = json.loads(self.rfile.read(largo) or b'{}')
        except Exception:
            return self._json(400, {'error': 'JSON inválido'})
        if ruta == '/api/precalentar':
            return self._json(200, {'ok': True})
        if ruta != '/api/chat':
            return self._json(404, {'error': 'no existe'})
        nombre = cuerpo.get('model') or (NOMBRES[0] if NOMBRES else 'bedrock')
        t0 = time.time()
        if cuerpo.get('stream', True) is False:
            try:
                partes, fin = [], 'stop'
                for trozo, f in generar(cuerpo):
                    partes.append(trozo)
                    if f:
                        fin = f
            except Exception as e:  # noqa: BLE001
                return self._json(502, {'error': str(e)})
            return self._json(200, {
                'model': nombre, 'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'message': {'role': 'assistant', 'content': ''.join(partes)},
                'done': True, 'done_reason': fin, 'total_duration': int((time.time() - t0) * 1e9),
            })
        self.send_response(200)
        self.send_header('Content-Type', 'application/x-ndjson')
        self.send_header('Transfer-Encoding', 'chunked')
        self.end_headers()

        def mandar(obj):
            b = (json.dumps(obj) + '\n').encode()
            self.wfile.write(f'{len(b):X}\r\n'.encode() + b + b'\r\n')
            self.wfile.flush()

        ahora = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        try:
            for trozo, fin in generar(cuerpo):
                if trozo:
                    mandar({'model': nombre, 'created_at': ahora, 'message': {'role': 'assistant', 'content': trozo}, 'done': False})
                if fin:
                    mandar({'model': nombre, 'created_at': ahora, 'message': {'role': 'assistant', 'content': ''},
                            'done': True, 'done_reason': fin, 'total_duration': int((time.time() - t0) * 1e9)})
        except Exception as e:  # noqa: BLE001
            mandar({'error': str(e), 'done': True})
        self.wfile.write(b'0\r\n\r\n')
        self.wfile.flush()


if __name__ == '__main__':
    log('motor bedrock en 127.0.0.1:%d · %s · %s' % (PUERTO, REGION, ', '.join(MODELOS)))
    ThreadingHTTPServer(('127.0.0.1', PUERTO), Manejador).serve_forever()
