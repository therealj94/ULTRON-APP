# El cliente de Laya para AU-RA en PULSE2CHAT.
#
# ── QUE HACE ────────────────────────────────────────────────────────────────
#
# Le pregunta a Laya, por cada mensaje de una persona, que es ese mensaje:
# una crisis, una estafa, un insulto, spam, un intento de torcer a AU-RA, algo
# urgente, o una charla normal. Contesta en milisegundos con probabilidades.
#
#     POST {LAYA_URL}/v1/mensaje   Authorization: Bearer {LAYA_CLAVE}
#          {"texto": "..."}  →  {"p": {...}, "etiquetas": [...],
#                                "grupos": {"tarea": "..."}, "umbrales": {...},
#                                "ms": n}
#
# ── LA UNICA REGLA: LAYA NO PUEDE DEJAR A NADIE SIN RESPUESTA ─────────────────
#
# Laya es una ayuda, no una puerta. Si esta caida, lenta, mal configurada o
# contesta basura, AU-RA sigue contestando exactamente como hoy. Por eso:
#
#   · `clasificar()` NUNCA lanza. Si algo falla devuelve None, y quien llama
#     sigue su camino de siempre.
#   · Tiene un plazo DURO (800 ms por omision) medido de punta a punta, no por
#     operacion de socket: urllib aplica el timeout a cada lectura, y con una
#     conexion lenta tres operaciones de 800 ms son 2,4 s. Aqui el plazo es el
#     plazo.
#   · Tiene cortacircuitos. Tras un fallo no se vuelve a intentar durante 5 s;
#     si vuelve a fallar, 10, 20, 40... hasta 2 minutos. Un acierto lo resetea.
#     Sin esto, con Laya caida CADA mensaje pagaria el plazo entero.
#
# ── LO QUE NO SE ESCRIBE EN NINGUN LADO ─────────────────────────────────────
#
# El texto de la persona viaja a Laya y a nada mas. El registro de este modulo
# dice «Laya no contesta» o «Laya volvio», nunca que se le pregunto.
#
# Solo biblioteca estandar, como asistente.py: urllib y ssl con verificacion.

import json
import os
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

# El principio y el final del mensaje, IGUAL que el servidor (servidor.py,
# `recortar`) y que lib/laya.ts (`recortarParaLaya`). El modelo se ajusto con
# consultas cortas; en un mensaje dictado o pegado la pregunta suele ir al
# final, y cortar solo por la cabeza la perdia. Recortar aqui ahorra mandar
# por internet un texto pegado de veinte mil caracteres que el servidor va a
# tirar igual.
CABEZA, COLA = 200, 500

PAUSA_MIN = 5.0         # segundos de pausa tras el primer fallo
PAUSA_MAX = 120.0       # techo de la pausa: dos minutos
TIMEOUT_MS_OMISION = 800


def _log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


# Quien escribe los avisos del cortacircuitos. asistente.py puede poner aqui su
# `log`; por omision se imprime igual que el, con la hora delante.
registrar = _log


def recortar(texto):
    """Sin sustitutos sueltos y, si es largo, cabeza + … + cola."""
    t = str(texto or '').encode('utf-8', 'replace').decode('utf-8').strip()
    if len(t) <= CABEZA + COLA:
        return t
    return t[:CABEZA].rstrip() + ' … ' + t[-COLA:].lstrip()


def _config():
    """Se lee del entorno en cada llamada: cuesta nada y deja que las pruebas
    (o un reinicio con otro EnvironmentFile) cambien la configuracion sin
    recargar el modulo."""
    url = (os.environ.get('LAYA_URL') or '').strip().rstrip('/')
    clave = (os.environ.get('LAYA_CLAVE') or '').strip()
    try:
        ms = int(os.environ.get('LAYA_TIMEOUT_MS') or TIMEOUT_MS_OMISION)
    except ValueError:
        ms = TIMEOUT_MS_OMISION
    return url, clave, max(50, min(ms, 10000))


def _url_segura(url):
    """HTTPS siempre; HTTP solo contra la propia maquina (pruebas, o un Laya
    local). La clave viaja en la cabecera: por HTTP a otra maquina iria en
    claro por internet."""
    try:
        u = urllib.parse.urlparse(url)
    except ValueError:
        return False
    if u.scheme == 'https':
        return bool(u.hostname)
    return u.scheme == 'http' and u.hostname in ('127.0.0.1', 'localhost', '::1')


# ── el cortacircuitos ─────────────────────────────────────────────────────

_candado = threading.Lock()
_estado = {'pausa': 0.0, 'hasta': 0.0, 'fallos': 0, 'avisado_apagado': False}


def reiniciar():
    """Deja el cortacircuitos como recien arrancado. Para las pruebas."""
    with _candado:
        _estado.update(pausa=0.0, hasta=0.0, fallos=0, avisado_apagado=False)


def estado():
    """Una foto del cortacircuitos, para el registro o para mirar a mano."""
    with _candado:
        return {'abierto': time.monotonic() < _estado['hasta'],
                'pausa_s': _estado['pausa'], 'fallos': _estado['fallos']}


def _fallo(por):
    with _candado:
        _estado['fallos'] += 1
        _estado['pausa'] = (PAUSA_MIN if not _estado['pausa']
                            else min(_estado['pausa'] * 2, PAUSA_MAX))
        _estado['hasta'] = time.monotonic() + _estado['pausa']
        pausa, n = _estado['pausa'], _estado['fallos']
    # Se dice la primera vez y cuando la pausa crece; con la pausa en su techo
    # es una linea cada dos minutos, no una por mensaje.
    try:
        registrar(f'Laya no contesta ({por}) · sin Laya {pausa:.0f}s · fallo {n}')
    except Exception:
        pass


def _acierto():
    with _candado:
        volvio = _estado['fallos'] > 0
        _estado.update(pausa=0.0, hasta=0.0, fallos=0)
    if volvio:
        try:
            registrar('Laya volvió')
        except Exception:
            pass


def _valida(j):
    """Lo minimo para que la politica pueda leerlo sin tropezar."""
    if not isinstance(j, dict) or not isinstance(j.get('p'), dict):
        return None
    p = {}
    for k, v in j['p'].items():
        if isinstance(k, str) and isinstance(v, (int, float)) and not isinstance(v, bool):
            p[k] = float(v)
    etiquetas = [e for e in (j.get('etiquetas') or []) if isinstance(e, str)]
    grupos = j.get('grupos') if isinstance(j.get('grupos'), dict) else {}
    umbrales = {k: float(v) for k, v in (j.get('umbrales') or {}).items()
                if isinstance(k, str) and isinstance(v, (int, float))} \
        if isinstance(j.get('umbrales'), dict) else {}
    return {'p': p, 'etiquetas': etiquetas, 'grupos': grupos,
            'umbrales': umbrales, 'ms': j.get('ms')}


def _pedir(url, clave, texto, plazo_s, caja):
    """Corre en su hilo. Deja en `caja` el resultado o el motivo del fallo."""
    try:
        req = urllib.request.Request(
            url + '/v1/mensaje', method='POST',
            data=json.dumps({'texto': texto}, ensure_ascii=False).encode('utf-8'),
            headers={'Content-Type': 'application/json',
                     'Authorization': 'Bearer ' + clave})
        ctx = ssl.create_default_context() if url.startswith('https') else None
        with urllib.request.urlopen(req, timeout=plazo_s, context=ctx) as r:
            caja['j'] = json.loads(r.read(65536) or b'{}')
    except urllib.error.HTTPError as e:
        caja['error'] = f'HTTP {e.code}'
    except Exception as e:  # noqa: BLE001 — cualquier cosa es «sin Laya»
        caja['error'] = type(e).__name__


def clasificar(texto):
    """Lo que Laya dice de este texto, o None. NUNCA lanza y nunca tarda mas
    que LAYA_TIMEOUT_MS (mas unos microsegundos)."""
    try:
        url, clave, ms = _config()
        if not url:
            with _candado:
                ya = _estado['avisado_apagado']
                _estado['avisado_apagado'] = True
            if not ya:
                try:
                    registrar('Laya apagada (falta LAYA_URL): se atiende sin ella')
                except Exception:
                    pass
            return None
        if not _url_segura(url):
            with _candado:
                ya = _estado['avisado_apagado']
                _estado['avisado_apagado'] = True
            if not ya:
                try:
                    registrar('Laya apagada: LAYA_URL tiene que ser https')
                except Exception:
                    pass
            return None
        recorte = recortar(texto)
        if not recorte:
            return None
        with _candado:
            if time.monotonic() < _estado['hasta']:
                return None             # cortacircuitos abierto: ni se intenta
        plazo = ms / 1000.0
        caja = {}
        hilo = threading.Thread(target=_pedir, args=(url, clave, recorte, plazo, caja),
                                daemon=True)
        hilo.start()
        hilo.join(plazo)
        if hilo.is_alive():
            # El hilo se queda terminando solo: su socket tiene el mismo plazo,
            # asi que muere enseguida. El cortacircuitos evita que se junten.
            _fallo(f'más de {ms} ms')
            return None
        if 'error' in caja:
            _fallo(caja['error'])
            return None
        r = _valida(caja.get('j'))
        if r is None:
            _fallo('respuesta sin forma')
            return None
        _acierto()
        return r
    except Exception as e:  # noqa: BLE001 — la regla: nunca lanza
        try:
            _fallo(type(e).__name__)
        except Exception:
            pass
        return None
