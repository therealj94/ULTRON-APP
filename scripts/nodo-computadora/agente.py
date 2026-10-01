"""La computadora de los agentes: un escritorio Linux propio y un modelo que lo maneja.

Lo que corre en el nodo (scripts/nodo-computadora/instalar.sh):
  · `escritorio`: el contenedor de la demo oficial de computer use de Anthropic (Ubuntu + Xvfb + VNC +
    noVNC + Firefox + LibreOffice). Se maneja con xdotool por `docker exec`.
  · `holo`: vLLM con Hcompany/Holo-3.1-9B (Apache 2.0), con las banderas de la guía de H Company.
  · este servicio: recibe una tarea, hace el ciclo mirar → decidir → actuar y cuenta cada paso.

El ciclo sigue la guía oficial de Holo («Core concepts» y «Function calling», hub.hcompany.ai):
herramientas OpenAI con tool_choice="required", coordenadas en [0, 1000] escaladas a la captura,
la captura como `<observation>` de usuario, solo las 3 últimas imágenes, temperatura 0.8, pensamiento
encendido y sin volver a meterlo en la conversación, y la tarea termina solo con la herramienta `answer`.

El motor de pago es Claude con `computer_toolset_20260801` (GA, sin cabecera beta; documentación de
computer use de Claude): coordenadas en los píxeles de la captura, cada tool_result lleva
`"toolset_name": "computer"`, y si una acción falla las siguientes del mismo turno se contestan como no
hechas. Solo se ofrece si hay ANTHROPIC_API_KEY.

API (todo con `Authorization: Bearer $COMPUTADORA_CLAVE`, salvo /salud):
  GET  /salud
  POST /tareas {"instruccion": "...", "motor": "holo"|"claude", "max_pasos": 25, "dueno": "<huella>"}   → {"id": ...}

Cada dueño (una huella, nunca el correo) trabaja en un escritorio limpio: si la tarea es de otro dueño que
la anterior, el contenedor del escritorio se borra y se crea de nuevo (pestañas, historial, descargas y
documentos del anterior no quedan). Las tareas terminadas se olvidan tras una hora.
  GET  /tareas/{id}                                      → estado, pasos y respuesta
  GET  /tareas/{id}/eventos                              → los mismos pasos en vivo (SSE)
  POST /tareas/{id}/parar
  GET  /pantalla                                         → la captura de ahora (PNG)
  POST /vista                                            → {"ruta": "/vista/<llave>/vnc.html?..."} para mirar en vivo
  GET  /vista/permitir                                   → para el forward_auth de Caddy
"""
import asyncio
import base64
import hmac
import io
import json
import os
import secrets
import shlex
import subprocess
import threading
import time
import uuid

import httpx

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from openai import OpenAI
from PIL import Image

CLAVE = os.environ.get('COMPUTADORA_CLAVE', '')
MODELO_URL = os.environ.get('MODELO_URL', 'http://127.0.0.1:8000/v1')
MODELO = os.environ.get('MODELO', 'holo3-1-9b')
ESCRITORIO = os.environ.get('ESCRITORIO', 'escritorio')
PANTALLA = os.environ.get('PANTALLA', ':1')
PASOS_MAX = int(os.environ.get('PASOS_MAX', '30'))
ESCRITORIO_IMAGEN = os.environ.get('ESCRITORIO_IMAGEN', 'ghcr.io/anthropics/anthropic-quickstarts:computer-use-demo-latest')
OLVIDAR_TRAS_S = int(os.environ.get('OLVIDAR_TRAS_S', '3600'))
TAREAS_MAX = int(os.environ.get('TAREAS_MAX', '100'))
ESPERA_TRAS_ACCION = float(os.environ.get('ESPERA_TRAS_ACCION', '1.2'))
CLAUDE_CLAVE = os.environ.get('ANTHROPIC_API_KEY', '')
CLAUDE_MODELO = os.environ.get('CLAUDE_MODELO', 'claude-sonnet-5-5')

cliente = OpenAI(base_url=MODELO_URL, api_key='local', timeout=120)
app = FastAPI()


# ------------------------------------------------------------------ escritorio

def en_escritorio(comando, entrada=None, timeout=30):
    """Un comando dentro del escritorio, con su pantalla. Devuelve stdout en bytes."""
    r = subprocess.run(['docker', 'exec', '-i', '-e', f'DISPLAY={PANTALLA}', ESCRITORIO, 'sh', '-c', comando],
                       input=entrada, capture_output=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).decode('utf-8', 'ignore')[:300] or f'código {r.returncode}')
    return r.stdout


def captura():
    """PNG de la pantalla entera, y su tamaño (el mismo con que se escalan las coordenadas)."""
    png = en_escritorio('import -window root png:-', timeout=20)
    ancho, alto = Image.open(io.BytesIO(png)).size
    return png, ancho, alto


def escritorio_nuevo():
    """Borra el escritorio y crea uno limpio, igual que instalar.sh, y espera a que tenga pantalla."""
    subprocess.run(['docker', 'rm', '-f', ESCRITORIO], capture_output=True, timeout=60)
    r = subprocess.run(['docker', 'run', '-d', '--name', ESCRITORIO, '--restart', 'unless-stopped',
                        '-e', 'WIDTH=1280', '-e', 'HEIGHT=800', '-p', '127.0.0.1:6080:6080', '--shm-size', '2g',
                        ESCRITORIO_IMAGEN], capture_output=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError('no pude crear el escritorio: ' + r.stderr.decode('utf-8', 'ignore')[:200])
    hasta = time.time() + 90
    while time.time() < hasta:
        try:
            captura()
            # La barra y el gestor de ventanas tardan un poco más que la pantalla.
            en_escritorio('pgrep -x tint2 >/dev/null && pgrep -x mutter >/dev/null', timeout=10)
            time.sleep(2)
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError('el escritorio nuevo no arrancó a tiempo')


def xdotool(*args):
    en_escritorio('xdotool ' + ' '.join(shlex.quote(str(a)) for a in args))


TECLAS = {'enter': 'Return', 'return': 'Return', 'esc': 'Escape', 'escape': 'Escape', 'tab': 'Tab',
          'backspace': 'BackSpace', 'delete': 'Delete', 'up': 'Up', 'down': 'Down', 'left': 'Left',
          'right': 'Right', 'space': 'space', 'ctrl': 'ctrl', 'control': 'ctrl', 'alt': 'alt', 'shift': 'shift',
          'cmd': 'super', 'win': 'super', 'super': 'super', 'meta': 'super', 'pageup': 'Prior',
          'pagedown': 'Next', 'home': 'Home', 'end': 'End'}


def tecla_xdotool(combo):
    partes = [p.strip() for p in str(combo).replace(' ', '+').split('+') if p.strip()]
    return '+'.join(TECLAS.get(p.lower(), p if len(p) > 1 else p.lower()) for p in partes)


# ------------------------------------------------------------------ herramientas (formato de la guía)

def fn(nombre, descripcion, requeridos=None, **props):
    return {'type': 'function', 'function': {'name': nombre, 'description': descripcion, 'parameters': {
        'type': 'object', 'properties': props, 'required': list(props) if requeridos is None else requeridos}}}


COORD = {'type': 'integer', 'description': 'Coordinate as integer in [0, 1000]'}
ELEM = {'type': 'string', 'description': 'Detailed description of the target UI element'}
HERRAMIENTAS = [
    fn('click', 'Click at (x, y) coordinates', element=ELEM, x=COORD, y=COORD),
    fn('double_click', 'Double-click at (x, y) coordinates', element=ELEM, x=COORD, y=COORD),
    fn('right_click', 'Right-click at (x, y) coordinates', element=ELEM, x=COORD, y=COORD),
    fn('type', 'Type text into the focused element, optionally pressing Enter', ['text'],
       text={'type': 'string'}, press_enter={'type': 'boolean'}),
    fn('key', 'Press a key or key combination, e.g. "enter", "ctrl+l", "alt+tab"', keys={'type': 'string'}),
    fn('scroll', 'Scroll at (x, y) in a direction', ['direction'], direction={'type': 'string', 'enum': ['up', 'down']},
       x=COORD, y=COORD),
    fn('drag', 'Drag from (x1, y1) to (x2, y2)', x1=COORD, y1=COORD, x2=COORD, y2=COORD),
    fn('open_url', 'Open a URL in the web browser', url={'type': 'string'}),
    fn('wait', 'Wait for the screen to settle', seconds={'type': 'number'}),
    fn('answer', 'Provide a final answer', content={'type': 'string', 'description': 'The answer content'}),
]

SISTEMA = ('You are a computer-use agent working on your own Linux desktop (Ubuntu, Firefox, LibreOffice). '
           'You see the screen through screenshots and act with your tools, one action per step. '
           'Work until the task is really done, then call answer with a short report of what you did and '
           'what you found, in the same language as the task. If something blocks you (a login, a captcha, '
           'a payment, a missing permission), stop and say so in answer instead of guessing.')


def a_pixel(v, total):
    return max(0, min(total - 1, round(int(v) / 1000 * total)))


def ejecutar(nombre, a, ancho, alto):
    """Hace la acción. Devuelve el texto que vuelve al modelo como resultado de la herramienta."""
    px = lambda k: a_pixel(a[k], ancho if k.startswith('x') else alto)
    if nombre in ('click', 'double_click', 'right_click'):
        x, y = px('x'), px('y')
        boton = '3' if nombre == 'right_click' else '1'
        veces = ['--repeat', '2', '--delay', '120'] if nombre == 'double_click' else []
        xdotool('mousemove', '--sync', x, y, 'click', *veces, boton)
    elif nombre == 'type':
        # xdotool type con --delay: algunos campos pierden letras si se escribe de golpe.
        xdotool('type', '--delay', '12', '--', str(a.get('text', '')))
        if a.get('press_enter'):
            xdotool('key', 'Return')
    elif nombre == 'key':
        xdotool('key', '--clearmodifiers', tecla_xdotool(a.get('keys', '')))
    elif nombre == 'scroll':
        if 'x' in a and 'y' in a:
            xdotool('mousemove', '--sync', px('x'), px('y'))
        xdotool('click', '--repeat', '5', '4' if a.get('direction') == 'up' else '5')
    elif nombre == 'drag':
        xdotool('mousemove', '--sync', px('x1'), px('y1'), 'mousedown', '1')
        xdotool('mousemove', '--sync', px('x2'), px('y2'), 'mouseup', '1')
    elif nombre == 'open_url':
        url = str(a.get('url', ''))
        if not url.startswith(('http://', 'https://')):
            url = 'https://' + url
        en_escritorio(f'(firefox-esr {shlex.quote(url)} >/dev/null 2>&1 &)')
        time.sleep(2.5)
    elif nombre == 'wait':
        time.sleep(min(10.0, max(0.5, float(a.get('seconds') or 2))))
    else:
        return f'Unknown tool {nombre}'
    time.sleep(ESPERA_TRAS_ACCION)
    return 'Done.'


def observacion(png):
    b64 = base64.b64encode(png).decode()
    return {'role': 'user', 'content': [
        {'type': 'text', 'text': '<observation>\n'},
        {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{b64}'}},
        {'type': 'text', 'text': '\n</observation>'},
    ]}


def recortar_imagenes(mensajes, n=3):
    vistas = 0
    for m in reversed(mensajes):
        if m['role'] != 'user' or not isinstance(m['content'], list):
            continue
        for trozo in m['content']:
            if trozo.get('type') != 'image_url':
                continue
            vistas += 1
            if vistas > n:
                trozo['type'] = 'text'
                trozo['text'] = '[screenshot evicted]'
                trozo.pop('image_url', None)


def miniatura(png, ancho=480):
    im = Image.open(io.BytesIO(png)).convert('RGB')
    im.thumbnail((ancho, ancho))
    out = io.BytesIO()
    im.save(out, 'JPEG', quality=70)
    return base64.b64encode(out.getvalue()).decode()


# ------------------------------------------------------------------ motor de pago: Claude

SISTEMA_CLAUDE = SISTEMA.replace('call answer with a short report', 'end with a short report') + (
    ' After each step, take a screenshot and check that it worked before moving on. '
    'Prefer keyboard shortcuts for dropdowns and scrollbars.')
NO_HECHA = 'Not executed: an earlier computer action in this turn failed.'


def accion_claude(nombre, a):
    """Una acción de computer_toolset_20260801. Devuelve texto o una lista de bloques (la imagen)."""
    def xy(clave='coordinate'):
        c = a.get(clave)
        return (int(c[0]), int(c[1])) if c else None

    def imagen(png):
        return [{'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png',
                                             'data': base64.b64encode(png).decode()}}]

    mods = [tecla_xdotool(m) for m in str(a.get('text') or '').split('+') if m.strip()] if nombre not in ('type', 'key', 'hold_key') else []
    if nombre == 'screenshot':
        return imagen(captura()[0])
    if nombre == 'zoom':
        x0, y0, x1, y1 = [int(v) for v in a['region']]
        im = Image.open(io.BytesIO(captura()[0])).crop((x0, y0, x1, y1))
        out = io.BytesIO()
        im.save(out, 'PNG')
        return imagen(out.getvalue())
    if nombre in ('left_click', 'right_click', 'middle_click', 'double_click', 'triple_click'):
        boton = {'right_click': '3', 'middle_click': '2'}.get(nombre, '1')
        veces = {'double_click': 2, 'triple_click': 3}.get(nombre, 1)
        p = xy()
        if p:
            xdotool('mousemove', '--sync', *p)
        for m in mods:
            xdotool('keydown', m)
        xdotool('click', '--repeat', veces, '--delay', '100', boton)
        for m in reversed(mods):
            xdotool('keyup', m)
    elif nombre == 'left_click_drag':
        xdotool('mousemove', '--sync', *xy('start_coordinate'), 'mousedown', '1')
        xdotool('mousemove', '--sync', *xy(), 'mouseup', '1')
    elif nombre == 'mouse_move':
        xdotool('mousemove', '--sync', *xy())
    elif nombre == 'left_mouse_down':
        xdotool('mousedown', '1')
    elif nombre == 'left_mouse_up':
        xdotool('mouseup', '1')
    elif nombre == 'cursor_position':
        return en_escritorio('xdotool getmouselocation').decode().strip()
    elif nombre == 'scroll':
        p = xy()
        if p:
            xdotool('mousemove', '--sync', *p)
        boton = {'up': '4', 'down': '5', 'left': '6', 'right': '7'}[a.get('scroll_direction', 'down')]
        for m in mods:
            xdotool('keydown', m)
        xdotool('click', '--repeat', max(1, min(30, int(a.get('scroll_amount') or 3))), boton)
        for m in reversed(mods):
            xdotool('keyup', m)
    elif nombre == 'type':
        xdotool('type', '--delay', '12', '--', str(a.get('text', '')))
    elif nombre == 'key':
        xdotool('key', '--clearmodifiers', '--repeat', max(1, min(100, int(a.get('repeat') or 1))), tecla_xdotool(a.get('text', '')))
    elif nombre == 'hold_key':
        k = tecla_xdotool(a.get('text', ''))
        xdotool('keydown', k)
        time.sleep(min(30.0, float(a.get('duration') or 1)))
        xdotool('keyup', k)
    elif nombre == 'wait':
        time.sleep(min(30.0, float(a.get('duration') or 1)))
        return 'OK'
    else:
        raise RuntimeError(f'acción desconocida: {nombre}')
    time.sleep(ESPERA_TRAS_ACCION)
    return 'OK'


def correr_claude(t):
    """El ciclo de la documentación de computer use: responder cada tool_use en orden, todo en un mensaje."""
    png, _, _ = captura()
    mensajes = [{'role': 'user', 'content': [
        {'type': 'text', 'text': t.instruccion},  # el texto antes de la imagen: mejor puntería (documentación)
        {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png', 'data': base64.b64encode(png).decode()}},
    ]}]
    with httpx.Client(timeout=180) as http:
        for _ in range(t.max_pasos):
            if t.parar:
                return t.cerrar('parada')
            t0 = time.time()
            r = http.post('https://api.anthropic.com/v1/messages', headers={
                'x-api-key': CLAUDE_CLAVE, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
                json={'model': CLAUDE_MODELO, 'max_tokens': 4096, 'system': SISTEMA_CLAUDE,
                      'tools': [{'type': 'computer_toolset_20260801'}], 'messages': mensajes})
            if r.status_code != 200:
                return t.cerrar('fallo', error=f'Claude {r.status_code}: {r.text[:300]}')
            j = r.json()
            ms = round((time.time() - t0) * 1000)
            mensajes.append({'role': 'assistant', 'content': j['content']})
            usos = [b for b in j['content'] if b.get('type') == 'tool_use' and b.get('toolset_name') == 'computer']
            texto = ' '.join(b.get('text', '') for b in j['content'] if b.get('type') == 'text').strip()
            if not usos:
                return t.cerrar('hecha', respuesta=texto or '(sin respuesta)')
            resultados, fallo = [], False
            for b in usos:
                res = {'type': 'tool_result', 'tool_use_id': b['id'], 'toolset_name': 'computer'}
                if fallo:
                    res.update(content=NO_HECHA, is_error=True)
                else:
                    try:
                        res['content'] = accion_claude(b['name'], b.get('input') or {})
                    except Exception as e:
                        res.update(content=f'Error: {e}', is_error=True)
                        fallo = True
                t.anotar(accion=b['name'], args=b.get('input') or {}, ms=ms, pensado=texto[-400:],
                         miniatura=miniatura(captura()[0]) if b['name'] != 'screenshot' else None)
                resultados.append(res)
            # Solo las 3 últimas capturas viajan: las viejas pesan y no ayudan.
            mensajes.append({'role': 'user', 'content': resultados})
            vistas = 0
            for m in reversed(mensajes):
                if m['role'] != 'user' or not isinstance(m['content'], list):
                    continue
                for bloque in m['content']:
                    for dentro in (bloque.get('content') if isinstance(bloque.get('content'), list) else [bloque]):
                        if isinstance(dentro, dict) and dentro.get('type') == 'image':
                            vistas += 1
                            if vistas > 3:
                                dentro.clear()
                                dentro.update(type='text', text='[screenshot evicted]')
    t.cerrar('sin_pasos', error=f'Se acabaron los {t.max_pasos} pasos sin terminar.')


# ------------------------------------------------------------------ tareas

TAREAS = {}
TURNO = threading.Lock()  # un escritorio: una tarea a la vez, las demás esperan su turno
# De quién fue la última tarea en el escritorio. None al arrancar: la primera tarea también estrena escritorio.
DUENO_ACTUAL = {'v': None}


def olvidar_viejas():
    """Las terminadas hace más de OLVIDAR_TRAS_S se van; y nunca más de TAREAS_MAX en memoria."""
    ahora = time.time()
    terminadas = sorted((t for t in TAREAS.values() if t.estado not in ('en_cola', 'trabajando')), key=lambda t: t.creada)
    for t in terminadas:
        if ahora - t.creada > OLVIDAR_TRAS_S:
            TAREAS.pop(t.id, None)
    sobran = len(TAREAS) - TAREAS_MAX
    for t in terminadas:
        if sobran <= 0:
            break
        if t.id in TAREAS:
            TAREAS.pop(t.id, None)
            sobran -= 1


class Tarea:
    def __init__(self, instruccion, max_pasos, motor='holo', dueno=''):
        self.id = uuid.uuid4().hex[:12]
        self.motor = motor
        self.dueno = dueno
        self.instruccion = instruccion
        self.max_pasos = max_pasos
        self.estado = 'en_cola'
        self.pasos = []
        self.respuesta = None
        self.error = None
        self.parar = False
        self.creada = time.time()
        self.cambio = threading.Condition()

    def anotar(self, **paso):
        with self.cambio:
            paso['n'] = len(self.pasos) + 1
            paso['t'] = round(time.time() - self.creada, 1)
            self.pasos.append(paso)
            self.cambio.notify_all()

    def cerrar(self, estado, respuesta=None, error=None):
        with self.cambio:
            self.estado, self.respuesta, self.error = estado, respuesta, error
            self.cambio.notify_all()

    def resumen(self, con_miniaturas=False):
        pasos = self.pasos if con_miniaturas else [{k: v for k, v in p.items() if k != 'miniatura'} for p in self.pasos]
        return {'id': self.id, 'motor': self.motor, 'instruccion': self.instruccion, 'estado': self.estado, 'pasos': pasos,
                'respuesta': self.respuesta, 'error': self.error, 'segundos': round(time.time() - self.creada, 1)}


def correr(t: Tarea):
    with TURNO:
        if t.parar:
            return t.cerrar('parada')
        t.estado = 'trabajando'
        if DUENO_ACTUAL['v'] != t.dueno:
            try:
                escritorio_nuevo()
            except Exception as e:
                return t.cerrar('fallo', error=str(e)[:500])
            DUENO_ACTUAL['v'] = t.dueno
            t.anotar(accion='escritorio_limpio')
        if t.motor == 'claude':
            try:
                return correr_claude(t)
            except Exception as e:
                return t.cerrar('fallo', error=str(e)[:500])
        mensajes = [{'role': 'system', 'content': SISTEMA}, {'role': 'user', 'content': t.instruccion}]
        try:
            for _ in range(t.max_pasos):
                if t.parar:
                    return t.cerrar('parada')
                png, ancho, alto = captura()
                mensajes.append(observacion(png))
                recortar_imagenes(mensajes)
                t0 = time.time()
                r = cliente.chat.completions.create(
                    model=MODELO, messages=mensajes, tools=HERRAMIENTAS, tool_choice='required', temperature=0.8,
                    extra_body={'chat_template_kwargs': {'enable_thinking': True}})
                ms = round((time.time() - t0) * 1000)
                msg = r.choices[0].message
                # Solo lo que dijo y la llamada: el pensamiento no se vuelve a meter (guía de Holo).
                mensajes.append({'role': 'assistant', 'content': msg.content or '',
                                 'tool_calls': [c.model_dump() for c in (msg.tool_calls or [])]})
                if not msg.tool_calls:
                    t.anotar(accion='nada', ms=ms, miniatura=miniatura(png))
                    continue
                llamada = msg.tool_calls[0]
                try:
                    args = json.loads(llamada.function.arguments or '{}')
                except json.JSONDecodeError:
                    args = {}
                nombre = llamada.function.name
                pensado = (getattr(msg, 'reasoning', None) or getattr(msg, 'reasoning_content', None) or '')[-400:]
                t.anotar(accion=nombre, args=args, ms=ms, pensado=pensado, miniatura=miniatura(png))
                if nombre == 'answer':
                    return t.cerrar('hecha', respuesta=str(args.get('content', '')))
                try:
                    resultado = ejecutar(nombre, args, ancho, alto)
                except Exception as e:
                    resultado = f'Error: {e}'
                mensajes.append({'role': 'tool', 'tool_call_id': llamada.id, 'content': resultado})
            t.cerrar('sin_pasos', error=f'Se acabaron los {t.max_pasos} pasos sin terminar.')
        except Exception as e:
            t.cerrar('fallo', error=str(e)[:500])


# ------------------------------------------------------------------ HTTP

def exigir(req: Request):
    dado = req.headers.get('authorization', '').removeprefix('Bearer ').strip()
    if not CLAVE or not hmac.compare_digest(dado, CLAVE):
        raise HTTPException(401, 'clave')


@app.get('/salud')
def salud():
    try:
        modelos = [m.id for m in cliente.models.list().data]
    except Exception as e:
        modelos = f'sin modelo: {str(e)[:80]}'
    try:
        _, ancho, alto = captura()
        pantalla = f'{ancho}x{alto}'
    except Exception as e:
        pantalla = f'sin escritorio: {str(e)[:80]}'
    ocupada = any(t.estado == 'trabajando' for t in TAREAS.values())
    motores = (['holo'] if isinstance(modelos, list) else []) + (['claude'] if CLAUDE_CLAVE else [])
    return {'ok': isinstance(modelos, list) and 'x' in pantalla, 'motores': motores, 'modelos': modelos,
            'pantalla': pantalla, 'ocupada': ocupada}


@app.post('/tareas')
async def crear(req: Request):
    exigir(req)
    cuerpo = await req.json()
    instruccion = str(cuerpo.get('instruccion', '')).strip()[:2000]
    if not instruccion:
        raise HTTPException(400, 'falta la instrucción')
    motor = 'claude' if cuerpo.get('motor') == 'claude' else 'holo'
    if motor == 'claude' and not CLAUDE_CLAVE:
        raise HTTPException(400, 'el motor Claude no está configurado (falta ANTHROPIC_API_KEY)')
    dueno = str(cuerpo.get('dueno') or '')[:64]
    t = Tarea(instruccion, max(1, min(PASOS_MAX, int(cuerpo.get('max_pasos') or 25))), motor, dueno)
    olvidar_viejas()
    TAREAS[t.id] = t
    threading.Thread(target=correr, args=(t,), daemon=True).start()
    return {'id': t.id, 'estado': t.estado}


def tarea(req, id):
    exigir(req)
    t = TAREAS.get(id)
    if not t:
        raise HTTPException(404, 'no existe')
    return t


@app.get('/tareas/{id}')
def ver(id: str, req: Request, miniaturas: int = 0):
    return tarea(req, id).resumen(bool(miniaturas))


@app.post('/tareas/{id}/parar')
def parar(id: str, req: Request):
    t = tarea(req, id)
    t.parar = True
    return {'id': id, 'estado': t.estado}


@app.get('/tareas/{id}/eventos')
async def eventos(id: str, req: Request):
    t = tarea(req, id)

    async def flujo():
        enviados = 0
        while True:
            while enviados < len(t.pasos):
                yield f'event: paso\ndata: {json.dumps(t.pasos[enviados], ensure_ascii=False)}\n\n'
                enviados += 1
            if t.estado not in ('en_cola', 'trabajando'):
                yield f'event: fin\ndata: {json.dumps(t.resumen(), ensure_ascii=False)}\n\n'
                return
            await asyncio.get_running_loop().run_in_executor(None, lambda: _esperar(t, enviados))

    return StreamingResponse(flujo(), media_type='text/event-stream', headers={'Cache-Control': 'no-cache'})


def _esperar(t, enviados):
    with t.cambio:
        if len(t.pasos) == enviados and t.estado in ('en_cola', 'trabajando'):
            t.cambio.wait(15)


@app.get('/pantalla')
def pantalla(req: Request):
    exigir(req)
    png, _, _ = captura()
    return Response(png, media_type='image/png', headers={'Cache-Control': 'no-store'})


# Vista en vivo: una llave por pedido, que vence. Caddy pregunta aquí (forward_auth) antes de pasar a noVNC.
VISTAS = {}


@app.post('/vista')
async def vista(req: Request):
    exigir(req)
    cuerpo = await req.json() if req.headers.get('content-length') not in (None, '0') else {}
    llave = secrets.token_urlsafe(24)
    VISTAS[llave] = time.time() + int(cuerpo.get('segundos') or 1800)
    solo_mirar = 0 if cuerpo.get('tomar_control') else 1
    ruta = f'/vista/{llave}/vnc.html?path=vista/{llave}/websockify&autoconnect=1&resize=scale&view_only={solo_mirar}'
    return {'ruta': ruta, 'vence_en': int(VISTAS[llave] - time.time())}


@app.get('/vista/permitir')
def permitir(req: Request):
    uri = req.headers.get('x-forwarded-uri', '')
    partes = uri.split('/')
    llave = partes[2] if len(partes) > 2 and partes[1] == 'vista' else ''
    ahora = time.time()
    for k in [k for k, v in VISTAS.items() if v < ahora]:
        VISTAS.pop(k, None)
    if llave and llave in VISTAS:
        return Response(status_code=200)
    return JSONResponse({'error': 'vista vencida'}, status_code=403)
