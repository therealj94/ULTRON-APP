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
  GET  /tareas/{id}                                      → estado, pasos, respuesta y `pregunta` (si espera un sí)
  GET  /tareas/{id}/eventos                              → los mismos pasos en vivo (SSE)
  POST /tareas/{id}/parar
  POST /tareas/{id}/pausar · /reanudar                   → pausa entre un paso y el siguiente
  POST /tareas/{id}/confirmar {"si": true|false}         → contesta la pregunta de una acción sensible
  POST /tareas/{id}/control {"tomar": true|false}        → la persona toma el escritorio (la tarea espera) o lo devuelve
  POST /tareas/{id}/accion {"tipo": "click"|"escribir"|"tecla"|"scroll", ...}  → lo que hace la persona con el control
  GET  /tareas/{id}/pantalla                             → la captura de ahora (JPEG), solo mientras esa tarea tiene el escritorio
  GET  /pantalla                                         → la captura de ahora (PNG)

Estados de una tarea: en_cola, trabajando, pausada, confirmar (espera el sí de la persona antes de algo
sensible: enviar, iniciar sesión, publicar, borrar), control (la persona tiene el escritorio), y los finales
hecha, parada, sin_pasos, fallo. Pagar o comprar: nunca (la acción no se hace aunque el modelo la pida).
/salud dice `capacidades` (pausar, confirmar, control): el servidor de AU-RA solo ofrece lo que el nodo sabe.
  POST /vista                                            → {"ruta": "/vista/<llave>/vnc.html?..."} para mirar en vivo
  GET  /vista/permitir                                   → para el forward_auth de Caddy
"""
import asyncio
import base64
import hmac
import io
import json
import os
import re
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
# Cuánto espera el sí de la persona antes de una acción sensible, y cuánto puede durar una pausa o el control.
ESPERA_CONFIRMACION_S = int(os.environ.get('ESPERA_CONFIRMACION_S', '600'))
PAUSA_MAX_S = int(os.environ.get('PAUSA_MAX_S', '1800'))
# Lo que este servicio sabe hacer además de encargar y parar (el servidor de AU-RA lo lee en /salud).
CAPACIDADES = ['pausar', 'confirmar', 'control']
ESTADOS_VIVOS = ('en_cola', 'trabajando', 'pausada', 'confirmar', 'control')

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


TAMANO = {'ancho': 1280, 'alto': 800}  # el de la última captura (para los toques de la persona)


def captura():
    """PNG de la pantalla entera, y su tamaño (el mismo con que se escalan las coordenadas)."""
    png = en_escritorio('import -window root png:-', timeout=20)
    ancho, alto = Image.open(io.BytesIO(png)).size
    TAMANO.update(ancho=ancho, alto=alto)
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
    fn('ask_user_confirmation', 'Ask the user for permission before a sensitive action (submitting a form, signing in, '
       'publishing or sending something, deleting). Wait for the answer before acting.',
       question={'type': 'string', 'description': 'One short question, in the language of the task, saying exactly what you are about to do'}),
    fn('answer', 'Provide a final answer', content={'type': 'string', 'description': 'The answer content'}),
]

SISTEMA = ('You are a computer-use agent working on your own Linux desktop (Ubuntu, Firefox, LibreOffice). '
           'You see the screen through screenshots and act with your tools, one action per step. '
           'Work until the task is really done, then call answer with a short report of what you did and '
           'what you found, in the same language as the task: the concrete result first (the data, the list, '
           'the comparison) and the addresses (URLs) of the pages where you found it. '
           'Before anything sensitive (submitting a form, signing in, publishing or sending something, deleting) '
           'call ask_user_confirmation and wait for the answer; if the user says no, do not do it. '
           'Never pay, buy, order or type card numbers: that is forbidden even if the task asks for it. '
           'If something blocks you (a login you have no permission for, a captcha, a payment, a missing '
           'permission), stop and say so in answer instead of guessing.')

# Pagar o comprar: nunca, aunque el modelo lo pida (el toque no se hace). Lo sensible: con el sí de la persona.
PAGO = re.compile(r'\b(pagar|comprar|compra ahora|finalizar (la )?compra|realizar (el )?pedido|hacer (el )?pedido|'
                  r'confirmar (el )?pago|proceder al pago|ir a pagar|a[nñ]adir al carrito|agregar al carrito|donar|'
                  r'checkout|pay now|pay|buy now|buy|purchase|place (your )?order|add to (cart|bag)|'
                  r'proceed to checkout|donate)\b', re.I)
SENSIBLE = re.compile(r'\b(enviar|env[ií]a(r|lo)?|mandar|submit|send|publicar|publica|postear|publish|post|tweet|'
                      r'borrar|borra|eliminar|elimina|delete|remove|iniciar sesi[oó]n|inicia sesi[oó]n|ingresar|'
                      r'entrar con|acceder|log ?in|sign ?in|sign ?up|registrar(me|se)?|reg[ií]strate|crear (una )?cuenta|'
                      r'create (an )?account|confirmar|confirm|guardar cambios|save changes|suscrib[a-z]*|subscribe|'
                      r'reservar|book now|agendar)\b', re.I)
COOKIES = re.compile(r'cookie|galleta', re.I)
TARJETA = re.compile(r'(?:\d[ -]?){13,19}')
NO_PAGO = ('Not executed: paying, buying, ordering or entering card numbers is forbidden on this computer. '
           'Do not try again; finish with answer and say that a person has to do that part.')
NO_DIJO = 'Not executed: the user said NO. Do not do it; continue without it, or finish with answer explaining why.'
SI_DIJO = 'The user said YES. Go ahead with exactly that action.'
NOTA_CONTROL = ('Note: the user took control of the desktop for a moment and may have changed what is on the '
                'screen. Look at the new screenshot and continue the task from where it is now, without starting over.')


class Detenida(Exception):
    """La tarea se cierra como parada con un motivo (nadie contestó, la pausa se pasó del tope)."""


def idioma_de(texto):
    """'en' si la tarea está en inglés; si no, 'es'."""
    t = f' {str(texto).lower()} '
    en = sum(t.count(f' {w} ') for w in ('the', 'and', 'what', 'tell', 'me', 'go', 'to', 'find', 'search', 'is', 'of'))
    es = sum(t.count(f' {w} ') for w in ('el', 'la', 'y', 'de', 'que', 'dime', 'busca', 'entra', 'a', 'en', 'los'))
    return 'en' if en > es else 'es'


def pregunta_para(elemento, idioma='es'):
    e = ' '.join(str(elemento).split())[:80]
    return f'I am about to click «{e}». Should I?' if idioma == 'en' else f'Voy a tocar «{e}». ¿Lo hago?'


def _pide_enter(nombre, a):
    """La acción manda un Enter (tecla, o escribir y Enter): puede enviar lo que esté enfocado."""
    if nombre == 'key':
        return bool(re.search(r'(^|\+)(enter|return)$', str(a.get('keys') or a.get('key') or '').lower().replace(' ', '')))
    return nombre == 'type' and bool(a.get('press_enter'))


def _sensible(t, elemento, idioma):
    """Lo sensible, con un sí para ESTA acción: un sí previo (ask_user_confirmation) vale para una sola, no
    para los pasos que sigan (auditoría, 3-oct: antes un sí abría una ventana de tres pasos para cualquier cosa)."""
    if t.permiso_unico:
        t.permiso_unico = False
        return None
    si = t.pedir_confirmacion(pregunta_para(elemento, idioma))
    if si is None:
        raise Detenida('la pararon mientras esperaba tu sí')
    # El sí de aquí es para esta acción, que se hace ahora: no deja permiso para la siguiente.
    t.permiso_unico = False
    return None if si else NO_DIJO


def revisar_accion(t, nombre, a):
    """Antes de una acción del motor gratis: pagar o comprar, nunca; lo sensible, solo con el sí de la persona.
    Devuelve None si se puede hacer, o el texto que vuelve al modelo en lugar de hacerla."""
    if nombre == 'type' and TARJETA.search(str(a.get('text', ''))):
        return NO_PAGO
    idioma = idioma_de(t.instruccion)
    if _pide_enter(nombre, a):
        # Un Enter envía lo que esté enfocado: vale lo mismo que tocar el último elemento que se tocó (antes el
        # Enter se saltaba la revisión: «Comprar» enfocado + Enter compraba).
        ultimo = t.ultimo_elemento
        if ultimo and PAGO.search(ultimo):
            return NO_PAGO
        if ultimo and SENSIBLE.search(ultimo) and not COOKIES.search(ultimo):
            return _sensible(t, f'Enter en «{ultimo}»' if idioma == 'es' else f'Enter on «{ultimo}»', idioma)
        return None
    if nombre not in ('click', 'double_click', 'right_click'):
        return None
    elemento = str(a.get('element') or '')
    t.ultimo_elemento = elemento
    if not elemento:
        return None
    # Pagar primero: «Aceptar cookies y comprar» no se salva por decir «cookies».
    if PAGO.search(elemento):
        return NO_PAGO
    if COOKIES.search(elemento):
        return None
    if SENSIBLE.search(elemento):
        return _sensible(t, elemento, idioma)
    return None


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

SISTEMA_CLAUDE = SISTEMA.replace('call answer with a short report', 'end with a short report').replace(
    'call ask_user_confirmation', 'use the ask_user_confirmation tool') + (
    ' After each step, take a screenshot and check that it worked before moving on. '
    'Prefer keyboard shortcuts for dropdowns and scrollbars.')
NO_HECHA = 'Not executed: an earlier computer action in this turn failed.'
# Una herramienta propia junto al toolset: el sí de la persona antes de algo sensible.
CONFIRMAR_CLAUDE = {'name': 'ask_user_confirmation',
                    'description': 'Ask the user for permission before a sensitive action (submitting a form, signing in, '
                                   'publishing or sending something, deleting). Returns YES or NO. Never use it for payments: those are forbidden.',
                    'input_schema': {'type': 'object', 'properties': {'question': {
                        'type': 'string', 'description': 'One short question in the language of the task saying exactly what you are about to do'}},
                        'required': ['question']}}


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
            if t.parar or not t.esperar_si_pausada():
                return t.cerrar('parada')
            if t.notas:
                mensajes[-1]['content'].extend({'type': 'text', 'text': n} for n in t.notas)
                t.notas.clear()
            t0 = time.time()
            r = http.post('https://api.anthropic.com/v1/messages', headers={
                'x-api-key': CLAUDE_CLAVE, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
                json={'model': CLAUDE_MODELO, 'max_tokens': 4096, 'system': SISTEMA_CLAUDE,
                      'tools': [{'type': 'computer_toolset_20260801'}, CONFIRMAR_CLAUDE], 'messages': mensajes})
            if r.status_code != 200:
                return t.cerrar('fallo', error=f'Claude {r.status_code}: {r.text[:300]}')
            j = r.json()
            ms = round((time.time() - t0) * 1000)
            mensajes.append({'role': 'assistant', 'content': j['content']})
            usos = [b for b in j['content'] if b.get('type') == 'tool_use'
                    and (b.get('toolset_name') == 'computer' or b.get('name') == CONFIRMAR_CLAUDE['name'])]
            texto = ' '.join(b.get('text', '') for b in j['content'] if b.get('type') == 'text').strip()
            if not usos:
                # La captura final va con el resultado (la app la muestra en la tarjeta del final).
                t.anotar(accion='answer', args={'content': texto[:300]}, ms=ms, miniatura=miniatura(captura()[0]))
                return t.cerrar('hecha', respuesta=texto or '(sin respuesta)')
            # `fallo`: algo salió mal o la persona dijo NO: lo que sigue en el mismo lote ya no se hace
            # (auditoría, 3-oct: tras un NO, las acciones siguientes del lote corrían igual).
            resultados, fallo = [], False
            for b in usos:
                if t.parar:
                    return t.cerrar('parada')
                if b.get('name') == CONFIRMAR_CLAUDE['name']:
                    res = {'type': 'tool_result', 'tool_use_id': b['id']}
                    if fallo:
                        res.update(content=NO_HECHA, is_error=True)
                    else:
                        si = t.pedir_confirmacion(str((b.get('input') or {}).get('question', '')))
                        if si is None:
                            return t.cerrar('parada')
                        res['content'] = SI_DIJO if si else NO_DIJO
                        if not si:
                            fallo = True
                    resultados.append(res)
                    continue
                res = {'type': 'tool_result', 'tool_use_id': b['id'], 'toolset_name': 'computer'}
                entrada = b.get('input') or {}
                if fallo:
                    res.update(content=NO_HECHA, is_error=True)
                elif TARJETA.search(str(entrada.get('text', ''))):
                    # Números de tarjeta: nunca, tampoco con Claude.
                    res.update(content=NO_PAGO, is_error=True)
                    fallo = True
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
# Reiniciar el escritorio y lo que hace la persona a mano no se cruzan: una acción admitida antes de parar no
# cae en el escritorio del dueño siguiente, ni se entrega su pantalla mientras se reinicia (auditoría, 3-oct).
ESCRITORIO_LOCK = threading.Lock()
REINICIANDO = {'v': False}
# De quién fue la última tarea en el escritorio. None al arrancar: la primera tarea también estrena escritorio.
DUENO_ACTUAL = {'v': None}


def olvidar_viejas():
    """Las terminadas hace más de OLVIDAR_TRAS_S se van; y nunca más de TAREAS_MAX en memoria."""
    ahora = time.time()
    terminadas = sorted((t for t in TAREAS.values() if t.estado not in ESTADOS_VIVOS), key=lambda t: t.creada)
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
        # Pausa, control de la persona y confirmación: se miran entre un paso y el siguiente.
        self.pausa = False
        self.control = False
        self.en_espera = False  # el ciclo está de verdad quieto esperando (la persona ya puede actuar)
        self.pregunta = None    # la pregunta que espera su sí
        self.si = None
        self.permiso_unico = False  # el sí a una pregunta del modelo vale para UNA acción sensible, la siguiente
        self.ultimo_elemento = ''   # lo último que tocó: un Enter después vale lo mismo que tocarlo
        self.persona_actuo = False
        self.notas = []          # lo que se le dice al modelo en el paso siguiente

    def anotar(self, **paso):
        with self.cambio:
            paso['n'] = len(self.pasos) + 1
            paso['t'] = round(time.time() - self.creada, 1)
            self.pasos.append(paso)
            self.cambio.notify_all()

    def cerrar(self, estado, respuesta=None, error=None):
        with self.cambio:
            self.estado, self.respuesta, self.error = estado, respuesta, error
            self.pausa = self.control = False
            self.pregunta = None
            self.cambio.notify_all()

    def estado_visible(self):
        """Lo que se cuenta afuera: mientras trabaja, si espera un sí, si la tiene la persona o si está en pausa."""
        if self.estado == 'trabajando':
            if self.pregunta:
                return 'confirmar'
            if self.control:
                return 'control'
            if self.pausa:
                return 'pausada'
        return self.estado

    def avisar(self, **cambios):
        """Cambia banderas (pausa, control, si, parar) y despierta al ciclo si está esperando."""
        with self.cambio:
            for k, v in cambios.items():
                setattr(self, k, v)
            self.cambio.notify_all()

    def esperar_si_pausada(self):
        """Entre un paso y el siguiente: si la pausaron o la persona tiene el control, espera (el escritorio
        sigue siendo de esta tarea). False si la pararon mientras tanto. Al volver del control, el modelo lo sabe."""
        if not (self.pausa or self.control):
            return True
        hasta = time.time() + PAUSA_MAX_S
        with self.cambio:
            self.en_espera = True
            self.persona_actuo = False
            self.cambio.notify_all()
            try:
                while (self.pausa or self.control) and not self.parar:
                    queda = hasta - time.time()
                    if queda <= 0:
                        raise Detenida('estuvo en pausa demasiado tiempo')
                    self.cambio.wait(min(queda, 5))
            finally:
                self.en_espera = False
                self.cambio.notify_all()
        if self.parar:
            return False
        if self.persona_actuo:
            self.notas.append(NOTA_CONTROL)
        return True

    def pedir_confirmacion(self, pregunta):
        """Se queda quieta hasta el sí o el no de la persona. True/False; None si la pararon. Sin respuesta
        en ESPERA_CONFIRMACION_S la tarea se cierra (Detenida): nada sensible se hace sin su sí."""
        pregunta = ' '.join(str(pregunta or '').split())[:300] or 'Voy a hacer algo sensible. ¿Lo hago?'
        self.anotar(accion='pedir_confirmacion', args={'pregunta': pregunta})
        hasta = time.time() + ESPERA_CONFIRMACION_S
        with self.cambio:
            self.pregunta, self.si, self.en_espera = pregunta, None, True
            self.cambio.notify_all()
            try:
                while self.si is None and not self.parar and time.time() < hasta:
                    self.cambio.wait(min(5, max(0.05, hasta - time.time())))
                si = self.si
            finally:
                self.pregunta, self.si, self.en_espera = None, None, False
                self.cambio.notify_all()
        if self.parar:
            return None
        if si is None:
            raise Detenida('nadie dijo que sí a tiempo; no hice lo que pedía permiso')
        self.anotar(accion='confirmacion', args={'si': bool(si)})
        self.permiso_unico = bool(si)
        return bool(si)

    def resumen(self, con_miniaturas=False):
        pasos = self.pasos if con_miniaturas else [{k: v for k, v in p.items() if k != 'miniatura'} for p in self.pasos]
        return {'id': self.id, 'motor': self.motor, 'instruccion': self.instruccion, 'estado': self.estado_visible(), 'pasos': pasos,
                'respuesta': self.respuesta, 'error': self.error, 'segundos': round(time.time() - self.creada, 1),
                'pregunta': self.pregunta, 'en_espera': self.en_espera}


def correr(t: Tarea):
    with TURNO:
        if t.parar:
            return t.cerrar('parada')
        limpio = False
        if DUENO_ACTUAL['v'] != t.dueno:
            with ESCRITORIO_LOCK:
                REINICIANDO['v'] = True
                try:
                    escritorio_nuevo()
                except Exception as e:
                    return t.cerrar('fallo', error=str(e)[:500])
                finally:
                    REINICIANDO['v'] = False
                DUENO_ACTUAL['v'] = t.dueno
                limpio = True
        # «trabajando» solo con SU escritorio ya listo: antes se marcaba antes del reinicio y la pantalla del
        # dueño anterior se podía pedir en ese rato.
        t.estado = 'trabajando'
        if limpio:
            t.anotar(accion='escritorio_limpio')
        if t.motor == 'claude':
            try:
                return correr_claude(t)
            except Detenida as d:
                return t.cerrar('parada', error=str(d)[:300])
            except Exception as e:
                return t.cerrar('fallo', error=str(e)[:500])
        mensajes = [{'role': 'system', 'content': SISTEMA}, {'role': 'user', 'content': t.instruccion}]
        try:
            for _ in range(t.max_pasos):
                if t.parar or not t.esperar_si_pausada():
                    return t.cerrar('parada')
                for nota in t.notas:
                    mensajes.append({'role': 'user', 'content': nota})
                t.notas.clear()
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
                # Lo pararon (o pausaron) MIENTRAS pensaba: lo que decidió ya no se hace (auditoría, 3-oct: el
                # clic salía igual). En pausa, al seguir mira la pantalla de nuevo en lugar de usar esta jugada.
                if t.parar:
                    return t.cerrar('parada')
                if t.pausa or t.control:
                    mensajes.append({'role': 'tool', 'tool_call_id': llamada.id,
                                     'content': 'Not executed: the user paused you. Look at the screen again before acting.'})
                    continue
                if nombre == 'answer':
                    return t.cerrar('hecha', respuesta=str(args.get('content', '')))
                if nombre == 'ask_user_confirmation':
                    si = t.pedir_confirmacion(args.get('question', ''))
                    if si is None:
                        return t.cerrar('parada')
                    mensajes.append({'role': 'tool', 'tool_call_id': llamada.id, 'content': SI_DIJO if si else NO_DIJO})
                    continue
                # Pagar o comprar, nunca; lo sensible, con su sí (aunque el modelo no lo haya preguntado).
                resultado = revisar_accion(t, nombre, args)
                if resultado is None:
                    try:
                        resultado = ejecutar(nombre, args, ancho, alto)
                    except Exception as e:
                        resultado = f'Error: {e}'
                mensajes.append({'role': 'tool', 'tool_call_id': llamada.id, 'content': resultado})
            t.cerrar('sin_pasos', error=f'Se acabaron los {t.max_pasos} pasos sin terminar.')
        except Detenida as d:
            t.cerrar('parada', error=str(d)[:300])
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
            'pantalla': pantalla, 'ocupada': ocupada, 'capacidades': CAPACIDADES}


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
    t.avisar(parar=True)  # despierta también a la que espera una pausa o un sí
    return {'id': id, 'estado': t.estado}


def viva(t):
    if t.estado not in ESTADOS_VIVOS:
        raise HTTPException(409, 'la tarea ya terminó')
    return t


async def cuerpo_de(req: Request):
    try:
        j = await req.json()
    except Exception:
        return {}
    return j if isinstance(j, dict) else {}


@app.post('/tareas/{id}/pausar')
def pausar(id: str, req: Request):
    t = viva(tarea(req, id))
    t.avisar(pausa=True)
    return {'id': id, 'estado': t.estado_visible()}


@app.post('/tareas/{id}/reanudar')
def reanudar(id: str, req: Request):
    t = viva(tarea(req, id))
    t.avisar(pausa=False, control=False)
    return {'id': id, 'estado': t.estado_visible()}


@app.post('/tareas/{id}/confirmar')
async def confirmar(id: str, req: Request):
    t = viva(tarea(req, id))
    si = bool((await cuerpo_de(req)).get('si'))
    if not t.pregunta:
        raise HTTPException(409, 'no está esperando ningún sí')
    t.avisar(si=si)
    return {'id': id, 'si': si}


@app.post('/tareas/{id}/control')
async def control(id: str, req: Request):
    t = viva(tarea(req, id))
    tomar = bool((await cuerpo_de(req)).get('tomar'))
    if t.pregunta:
        raise HTTPException(409, 'primero contesta si lo hace o no')
    t.avisar(control=tomar, pausa=False)
    return {'id': id, 'estado': t.estado_visible()}


TECLAS_PERSONA = {'enter', 'tab', 'escape', 'backspace', 'delete', 'up', 'down', 'left', 'right', 'pageup', 'pagedown',
                  'home', 'end', 'space', 'ctrl+l', 'ctrl+a', 'ctrl+c', 'ctrl+v', 'ctrl+f', 'alt+left', 'alt+right', 'f5'}


def accion_persona(t, cuerpo):
    """Lo que hace la persona con el control: tocar, escribir, una tecla o bajar. Coordenadas en [0, 1000].
    Lo que escribe no se guarda en los pasos (puede ser su contraseña: para eso tomó el control)."""
    tipo = str(cuerpo.get('tipo') or '')
    ancho, alto = TAMANO['ancho'], TAMANO['alto']

    def coord(k):
        try:
            return max(0, min(1000, int(cuerpo.get(k) or 0)))
        except (TypeError, ValueError):
            raise HTTPException(400, 'coordenadas en [0, 1000]')

    # Se revisa otra vez justo antes de tocar, con el escritorio tomado: la acción pudo esperar en la cola y,
    # mientras, pararon la tarea o el escritorio cambió de dueño.
    with ESCRITORIO_LOCK:
        if t.parar or not t.control or REINICIANDO['v'] or DUENO_ACTUAL['v'] != t.dueno:
            raise HTTPException(409, 'la tarea ya no tiene el escritorio')
        return _accion_persona(t, cuerpo, tipo, ancho, alto, coord)


def _accion_persona(t, cuerpo, tipo, ancho, alto, coord):
    if tipo == 'click':
        paso = {'tipo': 'click', 'x': coord('x'), 'y': coord('y')}
        ejecutar('click', {'x': paso['x'], 'y': paso['y']}, ancho, alto)
    elif tipo == 'escribir':
        texto = str(cuerpo.get('texto') or '')[:500]
        if not texto:
            raise HTTPException(400, 'falta el texto')
        paso = {'tipo': 'escribir', 'letras': len(texto), 'enter': bool(cuerpo.get('enter'))}
        ejecutar('type', {'text': texto, 'press_enter': paso['enter']}, ancho, alto)
    elif tipo == 'tecla':
        teclas = str(cuerpo.get('teclas') or '').lower().replace(' ', '')
        if teclas not in TECLAS_PERSONA:
            raise HTTPException(400, 'esa tecla no')
        paso = {'tipo': 'tecla', 'teclas': teclas}
        ejecutar('key', {'keys': teclas}, ancho, alto)
    elif tipo == 'scroll':
        paso = {'tipo': 'scroll', 'direction': 'up' if cuerpo.get('direccion') == 'up' else 'down'}
        ejecutar('scroll', {'direction': paso['direction'], 'x': 500, 'y': 500}, ancho, alto)
    else:
        raise HTTPException(400, 'tipo es click, escribir, tecla o scroll')
    t.persona_actuo = True
    t.anotar(accion='persona', args=paso)
    return paso


@app.post('/tareas/{id}/accion')
async def accion(id: str, req: Request):
    t = viva(tarea(req, id))
    cuerpo = await cuerpo_de(req)
    if not t.control:
        raise HTTPException(409, 'primero toma el control')
    if not t.en_espera:
        raise HTTPException(409, 'un momento: está terminando su último paso')
    paso = await asyncio.get_running_loop().run_in_executor(None, lambda: accion_persona(t, cuerpo))
    return {'ok': True, 'paso': paso}


@app.get('/tareas/{id}/pantalla')
def pantalla_tarea(id: str, req: Request):
    """Lo que se ve ahora, solo mientras ESA tarea tiene el escritorio (nadie mira el de otro dueño)."""
    t = viva(tarea(req, id))
    if t.estado == 'en_cola':
        raise HTTPException(409, 'todavía no empieza')
    # Nunca la pantalla de otro dueño (ni la del anterior mientras se reinicia).
    if REINICIANDO['v'] or DUENO_ACTUAL['v'] != t.dueno:
        raise HTTPException(409, 'preparando su escritorio')
    png, _, _ = captura()
    jpg = base64.b64decode(miniatura(png, 960))
    return Response(jpg, media_type='image/jpeg', headers={'Cache-Control': 'no-store'})


@app.get('/tareas/{id}/eventos')
async def eventos(id: str, req: Request):
    t = tarea(req, id)

    async def flujo():
        enviados, visto = 0, None
        while True:
            while enviados < len(t.pasos):
                yield f'event: paso\ndata: {json.dumps(t.pasos[enviados], ensure_ascii=False)}\n\n'
                enviados += 1
            if t.estado not in ESTADOS_VIVOS:
                yield f'event: fin\ndata: {json.dumps(t.resumen(), ensure_ascii=False)}\n\n'
                return
            if t.estado_visible() != visto:
                visto = t.estado_visible()
                yield f'event: estado\ndata: {json.dumps({"estado": visto, "pregunta": t.pregunta}, ensure_ascii=False)}\n\n'
            await asyncio.get_running_loop().run_in_executor(None, lambda: _esperar(t, enviados, visto))

    return StreamingResponse(flujo(), media_type='text/event-stream', headers={'Cache-Control': 'no-cache'})


def _esperar(t, enviados, visto=None):
    with t.cambio:
        if len(t.pasos) == enviados and t.estado in ESTADOS_VIVOS and t.estado_visible() == visto:
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
