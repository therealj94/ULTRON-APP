#!/usr/bin/env python3
"""EL MOTOR DE ULTRON EN EL NODO: la única puerta desde afuera hacia el modelo.

── POR QUÉ EXISTE ───────────────────────────────────────────────────────────

Ollama escucha en 127.0.0.1:11434, sin clave y sin TLS, y así tiene que
quedarse: cualquiera que le hable puede cargar modelos, borrarlos o hacerle
gastar la tarjeta. ULTRON vive en Heroku y necesita pensar con el modelo del
nodo. Esto es lo que hay en medio, y hace exactamente tres cosas:

  1. Exige un secreto (cabecera `x-ultron-secreto`, comparación en tiempo
     constante) y habla TLS con un certificado propio cuya huella ULTRON
     conoce. Sin secreto: 401. Sin TLS: no hay puerto.
  2. Deja pasar solo `/api/chat` y `/api/tags`. Ni `/api/pull`, ni
     `/api/delete`, ni nada que cambie lo que hay en la tarjeta.
  3. FIJA el modelo y el tamaño de contexto a los de AU-RA. Esta tarjeta tiene
     UN modelo cargado a la vez (OLLAMA_MAX_LOADED_MODELS=1): un pedido con
     otro modelo o con otro `num_ctx` desaloja al de AU-RA, y el siguiente
     mensaje de un cliente por WhatsApp espera veinte segundos a que vuelva a
     cargar. Se decide aquí y no en ULTRON porque aquí es donde no se puede
     equivocar: un ULTRON mal configurado no puede tumbar a AU-RA.

El streaming pasa tal cual: Ollama manda NDJSON y esto lo reescribe línea a
línea según llega, que es lo que hace que la respuesta se vea escribirse.

── LO QUE NO ES ─────────────────────────────────────────────────────────────

No es un balanceador ni un cache. Un pedido, una respuesta. Si algún día hay
dos tarjetas, esto crece; hoy con una alcanza.

Variables (en /etc/ultron-motor.env):
  ULTRON_MOTOR_SECRETO    obligatoria; sin ella no arranca
  ULTRON_MOTOR_PUERTO     8443
  ULTRON_MOTOR_MODELO     qwen3.8:27b   (el mismo que AU-RA)
  ULTRON_MOTOR_CTX        32768         (el de AU-RA — mismo número o se recarga)
  ULTRON_MOTOR_VECTOR     embeddinggemma:300m  (para buscar en el saber por significado)
  ULTRON_MOTOR_CERT / _LLAVE   rutas del certificado y la llave
"""

import hmac
import json
import os
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRETO = (os.environ.get('ULTRON_MOTOR_SECRETO') or '').strip()
PUERTO = int(os.environ.get('ULTRON_MOTOR_PUERTO', '8443'))
MODELO = os.environ.get('ULTRON_MOTOR_MODELO', 'qwen3.8:27b')
CTX = int(os.environ.get('ULTRON_MOTOR_CTX', '32768'))
# El modelo de vectores para buscar en el saber POR SIGNIFICADO y no por
# palabras. Es otro modelo, chico (621 MB) y aparte del que piensa: ollama los
# tiene los dos y el de vectores no desaloja al grande.
MODELO_VECTOR = os.environ.get('ULTRON_MOTOR_VECTOR', 'embeddinggemma:300m')
CERT = os.environ.get('ULTRON_MOTOR_CERT', '/etc/ultron-motor/cert.pem')
LLAVE = os.environ.get('ULTRON_MOTOR_LLAVE', '/etc/ultron-motor/llave.pem')
OLLAMA = os.environ.get('OLLAMA_HOST_LOCAL', 'http://127.0.0.1:11434')
TOPE_CUERPO = 12 * 1024 * 1024   # 12 MB: una foto del telefono en base64 pasa de medio mega, y sin esto las imagenes no se pueden mirar
PLAZO_S = 180                     # un turno largo con herramientas

# Cuántos piensan a la vez. Ollama tiene NUM_PARALLEL=3 y AU-RA usa esas
# ranuras; ULTRON toma como mucho DOS para no dejar a AU-RA sin ninguna. Un
# tercero espera, no se rechaza: la junta son seis personas, no mil.
CUPO = threading.BoundedSemaphore(int(os.environ.get('ULTRON_MOTOR_CUPO', '2')))

# Solo lo que ULTRON necesita. Todo lo demás es 404, no 403: no se cuenta qué
# hay detrás.
PERMITIDO = {('POST', '/api/chat'), ('POST', '/api/embed'), ('GET', '/api/tags'), ('GET', '/salud')}

contador = {'pedidos': 0, 'rechazados': 0, 'desde': time.time()}


# Lo que dejó el vigía (scripts/nodo-a10g/vigia): caídas, qué las curó y qué aprendió. Si no
# está instalado o el archivo está a medio escribir, None: la salud del motor no depende de él.
VIGIA = os.environ.get('ULTRON_VIGIA_RESUMEN', '/var/lib/ultron-vigia/resumen.json')


def leer_vigia():
    try:
        with open(VIGIA) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


class Motor(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    # Plazo por conexion y saludo TLS en el hilo de cada una. Antes el saludo se
    # hacia dentro de accept(), en el hilo principal: una conexion que abria y
    # no saludaba (un escaner de internet) dejaba al motor sordo para todos
    # (28-sep: colgado cinco horas con la cola de accept llena).
    timeout = 60

    def setup(self):
        super().setup()
        self.connection.do_handshake()

    server_version = 'ultron-motor/1'

    def log_message(self, *a):        # el registro es nuestro, no el del módulo
        pass

    def _json(self, codigo, obj):
        cuerpo = json.dumps(obj).encode()
        self.send_response(codigo)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(cuerpo)))
        self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(cuerpo)

    def _autorizado(self):
        dado = (self.headers.get('x-ultron-secreto') or '').encode()
        return SECRETO and hmac.compare_digest(dado, SECRETO.encode())

    def do_GET(self):
        self._atender('GET')

    def do_POST(self):
        self._atender('POST')

    def _atender(self, metodo):
        ruta = self.path.split('?')[0]
        if (metodo, ruta) not in PERMITIDO:
            return self._json(404, {'error': 'no'})
        if not self._autorizado():
            contador['rechazados'] += 1
            return self._json(401, {'error': 'no', 'codigo': 'NO'})
        contador['pedidos'] += 1
        if ruta == '/salud':
            return self._json(200, {'ok': True, 'modelo': MODELO, 'ctx': CTX, 'ollama': self._ollama_vivo(),
                                    'pedidos': contador['pedidos'], 'rechazados': contador['rechazados'],
                                    'desde': int(contador['desde']), 'vigia': leer_vigia()})
        if ruta == '/api/tags':
            return self._reenviar('GET', ruta, None)
        # /api/chat y /api/embed
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > TOPE_CUERPO:
            return self._json(413, {'error': 'cuerpo fuera de medida', 'codigo': 'MEDIDA'})
        try:
            pedido = json.loads(self.rfile.read(n) or b'{}')
        except Exception:
            return self._json(400, {'error': 'no es JSON', 'codigo': 'JSON'})
        # LA REGLA QUE NO SE NEGOCIA: el modelo y el contexto son los de esta
        # casa, no los que pida quien llama. Un pedido con otro modelo u otra
        # ventana obliga a ollama a recargar 17 GB y deja a AU-RA esperando.
        if ruta == '/api/embed':
            # Los vectores van con SU modelo, que es otro y chico. Del pedido
            # solo se respeta la entrada: ni modelo ni opciones se aceptan de
            # fuera, por la misma razon que en /api/chat.
            entrada = pedido.get('input')
            if entrada is None:
                return self._json(400, {'error': 'falta input', 'codigo': 'SIN_ENTRADA'})
            self._reenviar('POST', ruta, json.dumps(
                {'model': MODELO_VECTOR, 'input': entrada, 'keep_alive': -1}).encode())
            return
        pedido['model'] = MODELO
        opciones = pedido.get('options') if isinstance(pedido.get('options'), dict) else {}
        opciones['num_ctx'] = CTX
        pedido['options'] = opciones
        # KEEP_ALIVE = -1: NO SE SUELTA NUNCA, y no es una exageracion.
        #
        # La maquina tiene 15 GB de RAM y el modelo pesa 16: no cabe en la
        # cache del sistema, asi que CADA carga son 16 GB leidos del disco, dos
        # minutos largos. Con el '30m' que habia antes, media hora sin
        # preguntar bastaba para que se soltara, y la siguiente pregunta pagaba
        # esos dos minutos... o peor: si el plazo del cliente vencia primero, la
        # carga se CANCELABA a medias y la pregunta siguiente empezaba de cero.
        # Eso es lo que dejo a Jose sin respuesta el 5-sep: un bucle de cargas
        # que nunca terminaban.
        #
        # Se ignora tambien lo que pida el cliente: un keep_alive corto de
        # fuera vuelve a abrir el mismo agujero.
        pedido['keep_alive'] = -1
        self._reenviar('POST', ruta, json.dumps(pedido).encode())

    def _ollama_vivo(self):
        try:
            with urllib.request.urlopen(OLLAMA + '/api/tags', timeout=4) as r:
                d = json.loads(r.read() or b'{}')
            return {'vivo': True, 'modelos': [m.get('name') for m in d.get('models', [])]}
        except Exception as e:
            return {'vivo': False, 'porQue': type(e).__name__}

    def _reenviar(self, metodo, ruta, cuerpo):
        req = urllib.request.Request(OLLAMA + ruta, data=cuerpo, method=metodo,
                                     headers={'Content-Type': 'application/json'})
        with CUPO:
            t0 = time.time()
            try:
                with urllib.request.urlopen(req, timeout=PLAZO_S) as r:
                    self.send_response(r.status)
                    self.send_header('Content-Type', r.headers.get('Content-Type', 'application/x-ndjson'))
                    self.send_header('Cache-Control', 'no-store')
                    self.send_header('Connection', 'close')
                    self.end_headers()
                    # Línea a línea: Ollama manda un JSON por línea y cada uno es
                    # un trozo de respuesta. Esperar el final sería quitarle a
                    # ULTRON justo lo que hace que se vea vivo.
                    while True:
                        trozo = r.readline()
                        if not trozo:
                            break
                        self.wfile.write(trozo)
                        self.wfile.flush()
                if ruta == '/api/chat':
                    log(f'chat · {time.time() - t0:.1f}s')
            except urllib.error.HTTPError as e:
                detalle = e.read()[:400]
                log(f'ollama {e.code} en {ruta}: {detalle[:120]!r}')
                self._json(502, {'error': 'el modelo contestó mal', 'codigo': 'MODELO', 'ollama': e.code,
                                 'detalle': detalle.decode('utf-8', 'replace')})
            except Exception as e:
                log(f'ollama no contesta en {ruta}: {type(e).__name__} {str(e)[:120]}')
                try:
                    self._json(503, {'error': 'el modelo no contesta', 'codigo': 'MODELO_MUDO', 'porQue': type(e).__name__})
                except Exception:
                    pass


def main():
    if len(SECRETO) < 24:
        print('ULTRON_MOTOR_SECRETO falta o es corto (mínimo 24). No arranco.', file=sys.stderr)
        sys.exit(2)
    for ruta in (CERT, LLAVE):
        if not os.path.exists(ruta):
            print(f'falta {ruta}. Correr instalar-motor.sh.', file=sys.stderr)
            sys.exit(2)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(CERT, LLAVE)
    sv = ThreadingHTTPServer(('0.0.0.0', PUERTO), Motor)
    sv.socket = ctx.wrap_socket(sv.socket, server_side=True, do_handshake_on_connect=False)
    log(f'motor de ULTRON en :{PUERTO} · modelo {MODELO} · ctx {CTX} · ollama {OLLAMA}')
    sv.serve_forever()


if __name__ == '__main__':
    main()
