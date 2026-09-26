"""Servidor de decisiones de Laya para el nodo T4: varios modelos ajustados en un solo proceso.

El de siempre (electrum) contesta qué especialistas de Dr Electrum convocar, con la probabilidad
calibrada de cada uno. Los de modelos/<nombre>/ (mensaje, documento…) contestan su juego de
preguntas noul: P de cada una, las etiquetas que pasan su umbral y el ganador de cada grupo
exclusivo.

    LAYA_CLAVE=... python servidor.py --modelo /opt/laya/modelo-electrum [--puerto 8792]
    LAYA_CLAVE=... python servidor.py --modelo electrum=/opt/laya/modelo-electrum \\
        --modelo mensaje=/opt/laya/modelo-mensaje --modelo documento=/opt/laya/modelo-documento

    GET  /salud                         → {"ok": true, "modelo": ..., "device": ..., "entrenado": ...,
                                           "modelos": {"mensaje": {"ok": true, "ids": [...], "recorte": [200, 500], ...}}}
    POST /decidir  {"texto": "..."}     → {"panel": ["legal"], "p": {"legal": 0.97, ...},
                                           "umbral": 0.5, "ms": 41}                       (electrum)
    POST /v1/<nombre> {"texto": "...", "preguntas"?: [ids]}
                                        → {"p": {id: P}, "etiquetas": [...], "grupos": {g: id},
                                           "umbrales": {id: u}, "ms": 41}
    POST /v1/<nombre> {"textos": [...hasta 32], "preguntas"?: [ids]}
                                        → {"resultados": [{"p", "etiquetas", "grupos"}, ...],
                                           "umbrales": {...}, "ms": 120}
         (todas las POST: Authorization: Bearer $LAYA_CLAVE)

Solo biblioteca estándar para el HTTP: no hay nada que mantener aparte de torch y laya.

Un error con un mensaje raro no tumba nada: se contesta 400/413/500 con JSON y el servicio sigue.
Un modelo que no carga tampoco: arrancan los demás y /salud dice cuál falta y por qué (un modelo
nuevo roto no se lleva por delante a electrum). Los mensajes de los usuarios no se escriben en el
log, ni en los errores.
"""
import argparse
import datetime
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
import laya
from laya.common import collate_items

from comun import NOMBRE_VALIDO, decidir, limpiar, recortar as recortar_a

# El principio y el final del mensaje, como lib/laya.ts (recortarParaLaya): el modelo se ajustó con
# consultas cortas y su tiempo crece con el largo (67 ms con 20 caracteres, 394 ms con 2000 en la T4).
# En un mensaje dictado o pegado la pregunta suele ir al final; cortar por la cabeza la perdía.
# Es el recorte de electrum; los demás modelos traen el suyo en el checkpoint (cfg['decisor']).
CABEZA, COLA = 200, 500
MAX_CUERPO = 16384
# Un lote de 32 textos ya recortados por el cliente (hasta ~900 caracteres cada uno) no cabe en 16 KB.
MAX_CUERPO_LOTE = 65536
MAX_LOTE = 32
# Lo que ocupa la GPU una pasada antes de soltar el cerrojo: hasta 64 filas (texto × pregunta) y hasta
# ~6000 tokens. Con mensajes cortos manda el tope de filas (64 × ~60 tokens); con fragmentos de
# documento de 900 caracteres (~300 tokens por fila) el de tokens, y así la pasada que tiene que
# esperar un /decidir es unas tres veces más corta.
FILAS_POR_PASADA = 64
TOKENS_POR_PASADA = 6000


def pasadas(items):
    """Parte las filas en pasadas que respetan los dos topes (siempre al menos una fila)."""
    tanda, tokens = [], 0
    for it in items:
        n = len(it['ids'])
        if tanda and (len(tanda) >= FILAS_POR_PASADA or tokens + n > TOKENS_POR_PASADA):
            yield tanda
            tanda, tokens = [], 0
        tanda.append(it)
        tokens += n
    if tanda:
        yield tanda


def recortar(texto):
    """Sin sustitutos sueltos (el tokenizador los rechaza) y, si es largo, cabeza + … + cola."""
    return recortar_a(texto, CABEZA, COLA)


class CerrojoJusto:
    """Un cerrojo que atiende por orden de llegada.

    La T4 es compartida con la voz: un solo cerrojo para TODOS los modelos deja como mucho una
    pasada de Laya en la GPU a la vez (memoria y tiempo acotados, la voz no compite con tres). Se
    toma por pasada (ver pasadas()), no por petición, y en orden de llegada (threading.Lock no
    promete orden): un /decidir de Electrum, que espera como mucho 1 s, no queda detrás de un lote de
    32 documentos entero, solo de la pasada que esté corriendo.
    """

    def __init__(self):
        self._c = threading.Condition()
        self._siguiente = 0
        self._turno = 0

    def __enter__(self):
        with self._c:
            mio = self._siguiente
            self._siguiente += 1
            while self._turno != mio:
                self._c.wait()

    def __exit__(self, *_):
        with self._c:
            self._turno += 1
            self._c.notify_all()


GPU = CerrojoJusto()


class Modelo:
    """Un checkpoint con sus preguntas. Sirve igual para electrum que para los de modelos/<nombre>/."""

    def __init__(self, nombre, directorio, device=None, cerrojo=GPU):
        device = device or ('cuda' if torch.cuda.is_available() else 'cpu')
        directorio = os.path.abspath(directorio)
        pesos = os.path.join(directorio, 'model.safetensors')
        if not os.path.exists(pesos):
            raise FileNotFoundError(f'no hay checkpoint en {directorio}')
        self.nombre = nombre
        self.agente = laya.load(directorio, device=device)
        self.device = device
        cfg = self.agente.cfg
        if 'decisor' in cfg:
            d = cfg['decisor']
            self.ids, self.grupos = list(d['ids']), dict(d.get('grupos') or {})
            self.umbrales = {i: float(u) for i, u in d['umbrales'].items()}
            self.cabeza, self.cola = int(d['recorte']['cabeza']), int(d['recorte']['cola'])
        elif 'electrum' in cfg:
            # El checkpoint de siempre no trae cfg['decisor']: un umbral para todos y el recorte de hoy.
            self.ids, self.grupos = list(cfg['electrum']['ids']), {}
            self.umbrales = {i: float(cfg['electrum']['umbral']) for i in self.ids}
            self.cabeza, self.cola = CABEZA, COLA
        else:
            raise ValueError('el checkpoint no trae cfg["decisor"] ni cfg["electrum"]')
        self.en_grupo = {i for m in self.grupos.values() for i in m}
        self.temp = float(cfg['temperature'][2])
        with open(os.path.join(directorio, 'preguntas.json'), encoding='utf-8') as f:
            preguntas = json.load(f)
        self.internas = {k: self.agente._to_internal(preguntas[k]) for k in self.ids}
        self.modelo = self.agente.model.eval()
        self.cerrojo = cerrojo
        self.entrenado = datetime.datetime.fromtimestamp(os.path.getmtime(pesos), datetime.timezone.utc) \
            .strftime('%Y-%m-%dT%H:%M:%SZ')

    def pedidas(self, preguntas=None):
        """Los ids a calcular, en el orden del modelo. Si se pide un miembro de un grupo, va el grupo
        entero: el ganador es el argmax entre todos, y con la mitad del grupo sería otro."""
        if not preguntas:
            return list(self.ids)
        quiero = set(preguntas)
        for miembros in self.grupos.values():
            if quiero & set(miembros):
                quiero |= set(miembros)
        return [i for i in self.ids if i in quiero]

    @torch.no_grad()
    def probabilidades(self, textos, ids=None):
        """Lista de textos → lista de {id: P(sí)}. Solo las preguntas de ids (menos cómputo)."""
        ids = ids or self.ids
        items = []
        for t in textos:
            items.extend(self.agente._encode_state(recortar_a(t, self.cabeza, self.cola), ids, self.internas))
        salida = []
        for tanda in pasadas(items):
            b = collate_items([tanda], pad_id=0)
            d = self.device
            with self.cerrojo:
                lg, _ = self.modelo(b['input_ids'].to(d), b['attention_mask'].to(d), b['marker_pos'].to(d),
                                    b['marker_mask'].to(d), b['qtype'].to(d))
                salida.append(torch.softmax(lg[:, :2].float() / self.temp, -1)[:, 1].cpu())
        p = torch.cat(salida).view(len(textos), len(ids)).tolist()
        return [dict(zip(ids, fila)) for fila in p]

    def contestar(self, p):
        etiquetas, ganadores = decidir(p, self.grupos, self.umbrales)
        return {'p': {k: round(v, 4) for k, v in p.items()}, 'etiquetas': etiquetas, 'grupos': ganadores}

    def umbrales_de(self, ids):
        """Los umbrales que deciden algo: los de las etiquetas sueltas (los grupos van por argmax)."""
        return {i: self.umbrales[i] for i in ids if i not in self.en_grupo}

    def salud(self):
        return {'ok': True, 'ids': self.ids, 'grupos': self.grupos, 'recorte': [self.cabeza, self.cola],
                'umbrales': self.umbrales_de(self.ids), 'entrenado': self.entrenado, 'device': self.device}


class Decisor(Modelo):
    """Electrum: el modelo más las ocho preguntas y el panel de como mucho dos. Lo usan igual el
    servidor (/decidir) y evaluar.py --tabla."""

    def __init__(self, directorio, device=None, cerrojo=GPU):
        super().__init__('electrum', directorio, device, cerrojo)
        cfg = self.agente.cfg['electrum']
        self.umbral = float(cfg['umbral'])
        self.maximo = int(cfg.get('maximo', 2))

    def panel(self, p):
        orden = sorted(self.ids, key=lambda i: -p[i])
        return [i for i in orden[:self.maximo] if p[i] >= self.umbral]

    def decidir(self, texto):
        t0 = time.perf_counter()
        p = self.probabilidades([texto])[0]
        return {'panel': self.panel(p), 'p': {k: round(v, 4) for k, v in p.items()}, 'umbral': self.umbral,
                'ms': round((time.perf_counter() - t0) * 1000)}


def compartir_embeddings(modelos):
    """La tabla de embeddings (197M de los 322M parámetros, ~790 MB en fp32) no se toca al entrenar
    (entrenar.py la congela), así que es idéntica en todos los checkpoints: se deja una sola copia en
    la GPU. Con tres modelos ahorra ~1,6 GB de VRAM a la voz. Si alguna difiere, no se comparte."""
    ahorro, primera = 0, None
    for m in modelos:
        emb = m.modelo.encoder.embeddings.tok_embeddings
        if primera is None:
            primera = emb.weight
        elif emb.weight.shape == primera.shape and emb.weight.device == primera.device \
                and torch.equal(emb.weight, primera):
            ahorro += emb.weight.numel() * emb.weight.element_size()
            emb.weight = primera
    if ahorro and torch.cuda.is_available():
        torch.cuda.empty_cache()
    return ahorro


def servir(modelos, fallos, puerto, clave):
    """modelos: {nombre: Modelo} cargados; fallos: {nombre: motivo} de los que no cargaron."""
    electrum = modelos.get('electrum')

    def salud():
        estado = {n: m.salud() for n, m in modelos.items()}
        estado.update({n: {'ok': False, 'error': e} for n, e in fallos.items()})
        if electrum:
            return 200, {'ok': True, 'modelo': 'laya-electrum', 'device': electrum.device,
                         'especialistas': electrum.ids, 'umbral': electrum.umbral,
                         'entrenado': electrum.entrenado, 'recorte': [CABEZA, COLA], 'modelos': estado}
        # Sin electrum: si se pidió y no cargó, el servicio NO está bien para lib/laya.ts (503).
        ok = 'electrum' not in fallos and bool(modelos)
        return (200 if ok else 503), {'ok': ok, 'modelo': 'laya', 'modelos': estado}

    class Manejador(BaseHTTPRequestHandler):
        timeout = 10  # un cliente que anuncia un cuerpo y no lo manda no retiene el hilo para siempre

        def _json(self, codigo, cuerpo):
            datos = json.dumps(cuerpo, ensure_ascii=False).encode('utf-8')
            self.send_response(codigo)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(datos)))
            self.end_headers()
            self.wfile.write(datos)

        def _cuerpo(self, maximo):
            """El JSON del cuerpo, o None si ya se contestó el error (o el cliente se fue)."""
            if clave and self.headers.get('Authorization', '') != f'Bearer {clave}':
                self._json(401, {'error': 'clave'})
                return None
            try:
                largo = int(self.headers.get('Content-Length') or 0)
            except ValueError:
                self._json(400, {'error': 'content-length'})
                return None
            if not 0 < largo <= maximo:
                self._json(413, {'error': 'cuerpo vacío o demasiado grande'})
                return None
            try:
                cuerpo = json.loads(self.rfile.read(largo))
            except (ValueError, UnicodeDecodeError):
                self._json(400, {'error': 'json'})
                return None
            except OSError:
                return None  # el cliente se fue o no mandó el cuerpo a tiempo: no hay a quién contestar
            if not isinstance(cuerpo, dict):
                self._json(400, {'error': 'json'})
                return None
            return cuerpo, largo

        def do_GET(self):
            if self.path == '/salud':
                return self._json(*salud())
            self._json(404, {'error': 'no existe'})

        def do_POST(self):
            if self.path == '/decidir':
                return self._decidir()
            if self.path.startswith('/v1/'):
                return self._v1(self.path[4:])
            self._json(404, {'error': 'no existe'})

        def _decidir(self):
            if not electrum:
                return self._json(503, {'error': 'modelo no cargado'})
            leido = self._cuerpo(MAX_CUERPO)
            if leido is None:
                return
            texto = recortar(leido[0].get('texto'))
            if not texto:
                return self._json(200, {'panel': [], 'p': {}, 'umbral': electrum.umbral, 'ms': 0})
            try:
                decision = electrum.decidir(texto)
            except Exception as e:  # noqa: BLE001 — cualquier fallo del modelo es un 500, no un hilo muerto
                print(f'error al decidir: {type(e).__name__}', flush=True)  # sin el texto del usuario
                return self._json(500, {'error': 'interno'})
            self._json(200, decision)

        def _v1(self, nombre):
            if not NOMBRE_VALIDO.match(nombre) or (nombre not in modelos and nombre not in fallos):
                return self._json(404, {'error': 'no existe'})
            if nombre in fallos:
                return self._json(503, {'error': 'modelo no cargado'})
            m = modelos[nombre]
            leido = self._cuerpo(MAX_CUERPO_LOTE)
            if leido is None:
                return
            cuerpo, largo = leido
            lote = 'textos' in cuerpo
            if lote:
                textos = cuerpo['textos']
                if not isinstance(textos, list) or not all(t is None or isinstance(t, str) for t in textos):
                    return self._json(400, {'error': '«textos» debe ser una lista de textos'})
                if len(textos) > MAX_LOTE:
                    return self._json(413, {'error': f'como mucho {MAX_LOTE} textos por lote'})
            else:
                if largo > MAX_CUERPO:
                    return self._json(413, {'error': 'cuerpo vacío o demasiado grande'})
                if not (cuerpo.get('texto') is None or isinstance(cuerpo.get('texto'), str)):
                    return self._json(400, {'error': '«texto» debe ser un texto'})
                textos = [cuerpo.get('texto')]
            preguntas = cuerpo.get('preguntas')
            if preguntas is not None:
                if not isinstance(preguntas, list) or not preguntas or not all(isinstance(i, str) for i in preguntas):
                    return self._json(400, {'error': '«preguntas» debe ser una lista de ids'})
                raras = [i for i in preguntas if i not in m.ids]
                if raras:
                    return self._json(400, {'error': 'preguntas desconocidas', 'desconocidas': raras[:20]})
            ids = m.pedidas(preguntas)
            limpios = [limpiar(t) for t in textos]
            t0 = time.perf_counter()
            try:
                llenos = [t for t in limpios if t]
                ps = iter(m.probabilidades(llenos, ids) if llenos else [])
                vacio = {'p': {}, 'etiquetas': [], 'grupos': {}}
                resultados = [m.contestar(next(ps)) if t else vacio for t in limpios]
            except Exception as e:  # noqa: BLE001 — cualquier fallo del modelo es un 500, no un hilo muerto
                print(f'error en /v1/{nombre}: {type(e).__name__}', flush=True)  # sin el texto del usuario
                return self._json(500, {'error': 'interno'})
            ms = round((time.perf_counter() - t0) * 1000) if llenos else 0
            if lote:
                return self._json(200, {'resultados': resultados, 'umbrales': m.umbrales_de(ids), 'ms': ms})
            self._json(200, {**resultados[0], 'umbrales': m.umbrales_de(ids), 'ms': ms})

        def log_message(self, formato, *args):
            pass  # los mensajes de los usuarios no se escriben en el log

        def handle_one_request(self):
            try:
                super().handle_one_request()
            except (ConnectionError, TimeoutError):
                self.close_connection = True

    sv = ThreadingHTTPServer(('0.0.0.0', puerto), Manejador)
    cargados = ' · '.join(f'{n} ({m.device})' for n, m in modelos.items())
    print(f'laya en :{puerto} · {cargados}' + (f' · SIN CARGAR: {", ".join(fallos)}' if fallos else ''), flush=True)
    sv.serve_forever()


def leer_modelos(valores):
    """«nombre=DIR» o, como hasta ahora, «DIR» a secas (= electrum). Varios separados por comas en
    LAYA_MODELO también valen."""
    salida = {}
    for v in valores:
        for parte in (x.strip() for x in v.split(',')):
            if not parte:
                continue
            nombre, _, ruta = parte.partition('=') if '=' in parte else ('electrum', '', parte)
            nombre = nombre.strip()
            if not NOMBRE_VALIDO.match(nombre):
                raise SystemExit(f'nombre de modelo inválido: {nombre!r}')
            if nombre in salida:
                raise SystemExit(f'modelo repetido: {nombre}')
            salida[nombre] = ruta.strip()
    return salida


def cargar(especificacion, device):
    """Carga cada modelo por separado: el que falla (checkpoint ausente o roto, sin memoria…) queda
    en `fallos` con su motivo y los demás siguen."""
    modelos, fallos = {}, {}
    for nombre, ruta in especificacion.items():
        try:
            m = Decisor(ruta, device) if nombre == 'electrum' else Modelo(nombre, ruta, device)
            m.probabilidades(['hola'])  # calienta el modelo antes de aceptar tráfico
            modelos[nombre] = m
        except Exception as e:  # noqa: BLE001
            fallos[nombre] = f'{type(e).__name__}: {str(e)[:200]}'
            print(f'NO se cargó {nombre} ({ruta}): {fallos[nombre]}', flush=True)
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
    return modelos, fallos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--modelo', action='append', default=[],
                    help='nombre=DIR (repetible); un DIR a secas es electrum, como antes')
    ap.add_argument('--puerto', type=int, default=int(os.environ.get('LAYA_PUERTO', '8792')))
    ap.add_argument('--device', default=os.environ.get('LAYA_DEVICE') or None)
    a = ap.parse_args()
    especificacion = leer_modelos(a.modelo or [os.environ.get('LAYA_MODELO', 'modelo-electrum')])
    clave = os.environ.get('LAYA_CLAVE', '')
    if not clave:
        print('AVISO: LAYA_CLAVE vacía, /decidir y /v1 quedan abiertos', flush=True)
    modelos, fallos = cargar(especificacion, a.device)
    if not modelos:
        raise SystemExit('no se cargó ningún modelo')
    ahorro = compartir_embeddings(list(modelos.values()))
    if ahorro:
        print(f'embeddings compartidos entre modelos: {ahorro / 2**20:.0f} MB menos', flush=True)
    servir(modelos, fallos, a.puerto, clave)


if __name__ == '__main__':
    main()
