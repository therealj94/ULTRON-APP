"""Servidor de decisiones de Laya para el nodo T4.

Carga el checkpoint ajustado por entrenar.py y contesta, para un mensaje, qué especialistas de
Dr Electrum convocar, con la probabilidad calibrada de cada uno.

    LAYA_CLAVE=... python servidor.py --modelo /opt/laya/modelo-electrum [--puerto 8792]

    GET  /salud                         → {"ok": true, "modelo": ..., "device": ...}
    POST /decidir  {"texto": "..."}     → {"panel": ["legal"], "p": {"legal": 0.97, ...},
                                           "umbral": 0.5, "ms": 41}
         (Authorization: Bearer $LAYA_CLAVE)

Solo biblioteca estándar para el HTTP: no hay nada que mantener aparte de torch y laya.
"""
import argparse
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
import laya
from laya.common import collate_items

MAX_TEXTO = 2000


class Decisor:
    """El modelo más las ocho preguntas. Lo usan igual el servidor y evaluar.py."""

    def __init__(self, directorio, device=None):
        device = device or ('cuda' if torch.cuda.is_available() else 'cpu')
        self.agente = laya.load(os.path.abspath(directorio), device=device)
        self.device = device
        cfg = self.agente.cfg['electrum']
        self.ids = cfg['ids']
        self.umbral = float(cfg['umbral'])
        self.maximo = int(cfg.get('maximo', 2))
        self.temp = float(self.agente.cfg['temperature'][2])
        with open(os.path.join(directorio, 'preguntas.json'), encoding='utf-8') as f:
            preguntas = json.load(f)
        self.internas = {k: self.agente._to_internal(preguntas[k]) for k in self.ids}
        self.modelo = self.agente.model.eval()
        self.cerrojo = threading.Lock()

    @torch.no_grad()
    def probabilidades(self, textos):
        """Lista de textos → lista de {id: P(sí)}."""
        items = []
        for t in textos:
            items.extend(self.agente._encode_state(t[:MAX_TEXTO], self.ids, self.internas))
        salida = []
        with self.cerrojo:
            for k in range(0, len(items), 64):
                b = collate_items([items[k:k + 64]], pad_id=0)
                d = self.device
                lg, _ = self.modelo(b['input_ids'].to(d), b['attention_mask'].to(d), b['marker_pos'].to(d),
                                    b['marker_mask'].to(d), b['qtype'].to(d))
                salida.append(torch.softmax(lg[:, :2].float() / self.temp, -1)[:, 1].cpu())
        p = torch.cat(salida).view(len(textos), len(self.ids)).tolist()
        return [dict(zip(self.ids, fila)) for fila in p]

    def panel(self, p):
        orden = sorted(self.ids, key=lambda i: -p[i])
        return [i for i in orden[:self.maximo] if p[i] >= self.umbral]

    def decidir(self, texto):
        t0 = time.perf_counter()
        p = self.probabilidades([texto])[0]
        return {'panel': self.panel(p), 'p': {k: round(v, 4) for k, v in p.items()}, 'umbral': self.umbral,
                'ms': round((time.perf_counter() - t0) * 1000)}


def servir(decisor, puerto, clave):
    class Manejador(BaseHTTPRequestHandler):
        def _json(self, codigo, cuerpo):
            datos = json.dumps(cuerpo, ensure_ascii=False).encode('utf-8')
            self.send_response(codigo)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(datos)))
            self.end_headers()
            self.wfile.write(datos)

        def do_GET(self):
            if self.path == '/salud':
                return self._json(200, {'ok': True, 'modelo': 'laya-electrum', 'device': decisor.device,
                                        'especialistas': decisor.ids, 'umbral': decisor.umbral})
            self._json(404, {'error': 'no existe'})

        def do_POST(self):
            if self.path != '/decidir':
                return self._json(404, {'error': 'no existe'})
            if clave and self.headers.get('Authorization', '') != f'Bearer {clave}':
                return self._json(401, {'error': 'clave'})
            largo = int(self.headers.get('Content-Length') or 0)
            if not 0 < largo <= 16384:
                return self._json(413, {'error': 'cuerpo vacío o demasiado grande'})
            try:
                texto = str(json.loads(self.rfile.read(largo)).get('texto') or '').strip()
            except (ValueError, AttributeError):
                return self._json(400, {'error': 'json'})
            if not texto:
                return self._json(200, {'panel': [], 'p': {}, 'umbral': decisor.umbral, 'ms': 0})
            self._json(200, decisor.decidir(texto))

        def log_message(self, formato, *args):
            pass  # los mensajes de los usuarios no se escriben en el log

    sv = ThreadingHTTPServer(('0.0.0.0', puerto), Manejador)
    print(f'laya-electrum en :{puerto} · {decisor.device} · umbral {decisor.umbral}', flush=True)
    sv.serve_forever()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--modelo', default=os.environ.get('LAYA_MODELO', 'modelo-electrum'))
    ap.add_argument('--puerto', type=int, default=int(os.environ.get('LAYA_PUERTO', '8792')))
    ap.add_argument('--device', default=os.environ.get('LAYA_DEVICE') or None)
    a = ap.parse_args()
    clave = os.environ.get('LAYA_CLAVE', '')
    if not clave:
        print('AVISO: LAYA_CLAVE vacía, /decidir queda abierto', flush=True)
    decisor = Decisor(a.modelo, a.device)
    decisor.decidir('hola')  # calienta el modelo antes de aceptar tráfico
    servir(decisor, a.puerto, clave)


if __name__ == '__main__':
    main()
