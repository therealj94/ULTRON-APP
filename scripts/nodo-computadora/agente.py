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
  POST /tareas {"instruccion": "...", "motor": "holo"|"claude", "max_pasos": 25, "dueno": "<huella>", "request_id": "..."}
                                                         → {"id": ...} (el mismo request_id del mismo dueño: la misma tarea)

Cada dueño (una huella, nunca el correo) trabaja en un escritorio limpio: si la tarea es de otro dueño que
la anterior, el contenedor del escritorio se borra y se crea de nuevo (pestañas, historial, descargas y
documentos del anterior no quedan). Las tareas terminadas se olvidan tras una hora.
  GET  /tareas/{id}                                      → estado, pasos, respuesta, `pregunta` y `pregunta_id` (si espera un sí)
  GET  /tareas/{id}/eventos                              → los mismos pasos en vivo (SSE)
  POST /tareas/{id}/parar
  POST /tareas/{id}/pausar · /reanudar                   → pausa entre un paso y el siguiente
  POST /tareas/{id}/confirmar {"si": true|false, "pregunta_id": "..."}  → contesta ESA pregunta (otra: 409)
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
# El sí a una pregunta del modelo vale para UNA acción de lo que se preguntó, en este rato (auditoría 3-oct, PC01).
PERMISO_VALE_S = float(os.environ.get('PERMISO_VALE_S', '120'))
# Lo más que tomar/devolver el control o pausar espera a que termine el toque que ya está en vuelo.
ESPERA_QUIETUD_S = 30.0
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
       'publishing or sending something, deleting). Wait for the answer before acting. A yes covers only the one '
       'action you named (signing in does not cover deleting), once.',
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
# Lo de un aviso de cookies que suena a sensible pero no lo es («Confirm my cookie choices»): se quita antes de mirar.
COOKIE_FRASES = re.compile(r'\b(confirm(ar)?|guardar|save)\s+(my |mis |las |the |mi )?(cookies? |galletas? )?'
                           r'(choices|opciones|preferences|preferencias|selecci[oó]n|selection|elecci[oó]n|settings|ajustes)\b', re.I)
# Un botón que no dice qué hace («Continue», «Aceptar», «OK», «Sí»): puede ser el envío o el borrado de un diálogo.
GENERICO = re.compile(r'\b(continuar|contin[uú]a|continue|proceder|proceed|aceptar|accept|acepto|agree|de acuerdo|allow|'
                      r'permitir|aplicar|apply|finalizar|finish|ok|okay|yes|sí)\b', re.I)
# Un Enter en el campo de la contraseña envía el inicio de sesión.
CAMPO_CLAVE = re.compile(r'contrase[nñ]a|password|\bclave\b', re.I)
# Qué hace cada acción sensible. El sí a una pregunta vale para las clases que nombró: aprobar «iniciar sesión» no
# aprueba «borrar» (auditoría 3-oct, PC01: antes el sí del login dejaba borrar después).
CLASES = (
    ('borrar', re.compile(r'\b(borrar|borr[oa](lo|la)?|eliminar|elimin[oa](lo|la)?|suprimir|vaciar|delete|remove|erase|trash)\b', re.I)),
    ('enviar', re.compile(r'\b(enviar|env[ií]o|env[ií]a(lo|la|r)?|mandar|mand[oa](lo|la)?|submit|send)\b', re.I)),
    ('publicar', re.compile(r'\b(publicar|public[oa](lo|la)?|postear|publish|post|tweet)\b', re.I)),
    ('sesion', re.compile(r'\b(iniciar sesi[oó]n|inicia sesi[oó]n|inicio sesi[oó]n|inicio de sesi[oó]n|ingresar|ingreso|entrar con|'
                          r'acceder|log ?in|sign ?in|contrase[nñ]a|password)\b', re.I)),
    ('cuenta', re.compile(r'\b(sign ?up|registrar(me|se)?|reg[ií]strate|registro|crear (una )?cuenta|creo (la |una )?cuenta|'
                          r'create (an )?account)\b', re.I)),
    ('confirmar', re.compile(r'\b(confirmar|confirm[oa]?|guardar cambios|guardo los cambios|save changes)\b', re.I)),
    ('suscribir', re.compile(r'\b(suscrib[a-z]*|subscribe)\b', re.I)),
    ('reservar', re.compile(r'\b(reservar|reserv[oa]|book now|agendar|agend[oa])\b', re.I)),
)
TARJETA = re.compile(r'(?:\d[ -]?){13,19}')
NO_PAGO = ('Not executed: paying, buying, ordering or entering card numbers is forbidden on this computer. '
           'Do not try again; finish with answer and say that a person has to do that part.')
NO_DIJO = 'Not executed: the user said NO. Do not do it; continue without it, or finish with answer explaining why.'
NO_FOCO = ('Not executed: the keyboard focus moved (Tab or a shortcut) and I cannot tell what Enter or Space would '
           'activate now. Click the exact element you mean instead, with its description.')
NO_PAUSA = 'Not executed: the user paused you or took the desktop. Look at the screen again before acting.'
NO_PARADA = 'Not executed: the task was stopped.'
NO_ESCRITORIO = 'Not executed: this task no longer has the desktop.'
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


def _teclas(a):
    return [p for p in str(a.get('keys') or a.get('key') or '').lower().replace(' ', '').split('+') if p]


def _pide_enter(nombre, a):
    """La acción activa lo que esté enfocado: Enter o Espacio (tecla), escribir y Enter, o escribir un salto de
    línea (xdotool lo teclea como Enter)."""
    if nombre == 'key':
        partes = _teclas(a)
        return bool(partes) and partes[-1] in ('enter', 'return', 'kp_enter', 'space')
    if nombre == 'type':
        return bool(a.get('press_enter')) or bool(re.search(r'[\r\n]', str(a.get('text', ''))))
    return False


def _mueve_foco(nombre, a):
    """Tab, cambiar de pestaña o de ventana: lo enfocado después ya no es lo último que se tocó."""
    return nombre == 'key' and any(p in ('tab', 'f6', 'super', 'win', 'cmd', 'meta') for p in _teclas(a))


def clases_de(texto):
    """Las clases de acción sensible que nombra un texto (una pregunta, un botón)."""
    return frozenset(c for c, r in CLASES if r.search(str(texto or '')))


def intencion(elemento):
    """Qué haría tocar (o dar Enter sobre) este elemento: ('pago' | 'sensible' | 'cookies' | 'desconocido' |
    'normal', clases). El orden importa (auditoría 3-oct, PC02): pagar primero; lo sensible ANTES que las cookies
    («Aceptar cookies y enviar» no se salva por decir «cookies»); un aviso de cookies puro pasa aunque diga
    «Aceptar» o «Continuar»; un botón genérico («Continue», «OK») no dice qué hace: se pregunta."""
    e = ' '.join(str(elemento or '').split())
    if PAGO.search(e):
        return 'pago', frozenset()
    cookies = bool(COOKIES.search(e))
    resto = COOKIE_FRASES.sub(' ', e) if cookies else e
    if SENSIBLE.search(resto):
        return 'sensible', clases_de(resto) or frozenset({'otro'})
    if cookies:
        return 'cookies', frozenset()
    if GENERICO.search(e):
        return 'desconocido', frozenset({'desconocido'})
    return 'normal', frozenset()


def _sensible(t, elemento, idioma, clases=frozenset({'otro'})):
    """Lo sensible, con un sí para ESTA acción. El sí que el modelo pidió antes (ask_user_confirmation) solo la
    cubre si es de lo mismo que se preguntó, en la misma época de la tarea y antes de vencer; se usa una vez y,
    si la acción es otra, se pierde (auditoría 3-oct, PC01: el sí de «iniciar sesión» dejaba borrar después)."""
    p, t.permiso = t.permiso, None
    if (p and p['epoca'] == t.epoca and time.time() <= p['vence'] and clases
            and not (clases & {'otro', 'desconocido'}) and clases <= p['clases']):
        return None
    si = t.pedir_confirmacion(pregunta_para(elemento, idioma))
    # El sí de aquí es para esta acción, que se hace ahora: no deja permiso para la siguiente.
    t.permiso = None
    if si is None:
        raise Detenida('la pararon mientras esperaba tu sí')
    return None if si else NO_DIJO


def _decidir(t, tipo, clases, texto, idioma):
    if tipo == 'pago':
        return NO_PAGO
    if tipo in ('sensible', 'desconocido'):
        return _sensible(t, texto, idioma, clases)
    return None


def revisar_accion(t, nombre, a):
    """Antes de una acción del motor gratis, el mediador de efectos: pagar o comprar, nunca; lo sensible o lo que
    no se sabe qué hace, solo con el sí de la persona. Lleva la cuenta de lo enfocado (`t.ultimo_elemento`: '' es
    la página recién abierta, None es «no se sabe» tras un Tab). Devuelve None si se puede hacer, o el texto que
    vuelve al modelo en lugar de hacerla."""
    if nombre == 'type' and TARJETA.search(str(a.get('text', ''))):
        return NO_PAGO
    idioma = idioma_de(t.instruccion)
    if _pide_enter(nombre, a):
        # Un Enter (o Espacio) activa lo enfocado: vale lo mismo que tocarlo (antes el Enter se saltaba la
        # revisión: «Comprar» enfocado + Enter compraba; y tras un Tab nadie sabía qué se activaba).
        foco = t.ultimo_elemento
        if foco is None:
            return NO_FOCO
        tipo, clases = intencion(foco)
        if tipo in ('normal', 'cookies') and CAMPO_CLAVE.search(foco):
            tipo, clases = 'sensible', frozenset({'sesion'})
        return _decidir(t, tipo, clases, f'Enter en «{foco}»' if idioma == 'es' else f'Enter on «{foco}»', idioma)
    if _mueve_foco(nombre, a):
        t.ultimo_elemento = None
        return None
    if nombre == 'open_url' or (nombre == 'key' and _teclas(a) in (['alt', 'left'], ['alt', 'right'], ['f5'], ['ctrl', 'r'])):
        t.ultimo_elemento = ''  # página nueva: nada enfocado todavía
        return None
    if nombre == 'key' and _teclas(a) == ['ctrl', 'l']:
        t.ultimo_elemento = 'barra de direcciones'
        return None
    if nombre not in ('click', 'double_click', 'right_click'):
        return None
    elemento = str(a.get('element') or '')
    if not elemento:
        t.ultimo_elemento = None
        return None
    tipo, clases = intencion(elemento)
    r = _decidir(t, tipo, clases, elemento, idioma)
    if r is None:
        t.ultimo_elemento = elemento  # solo si se toca de verdad: lo negado no se enfoca
    return r


def a_pixel(v, total):
    return max(0, min(total - 1, round(int(v) / 1000 * total)))


def ejecutar(nombre, a, ancho, alto):
    """Hace la acción. Devuelve el texto que vuelve al modelo como resultado de la herramienta. Sin esperar a que
    la pantalla se asiente: eso va en `asentar`, fuera del candado del escritorio (la captura de la app no espera)."""
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
    elif nombre == 'wait':
        pass  # la espera es `asentar`
    else:
        return f'Unknown tool {nombre}'
    return 'Done.'


def asentar(nombre, a=None):
    """Lo que se espera después de una acción para que la pantalla cambie (sin tener el escritorio tomado)."""
    a = a or {}
    if nombre == 'wait':
        time.sleep(min(10.0, max(0.5, float(a.get('seconds') or 2))))
        return
    if nombre == 'open_url':
        time.sleep(2.5)
    time.sleep(ESPERA_TRAS_ACCION)


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
                                   'publishing or sending something, deleting). Returns YES or NO. A yes covers only the one action you named, once. '
                                   'Never use it for payments: those are forbidden.',
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
            # La época con que se mira y se decide: si cambia mientras Claude piensa (pausa, control), lo que
            # decidió ya no se hace (auditoría 3-oct, PC03: con Claude la pausa en la inferencia no frenaba).
            epoca = t.epoca
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
                hecho = False
                if fallo:
                    res.update(content=NO_HECHA, is_error=True)
                elif t.epoca != epoca or t.pausa or t.control:
                    res.update(content=NO_PAUSA, is_error=True)
                    fallo = True
                elif TARJETA.search(str(entrada.get('text', ''))):
                    # Números de tarjeta: nunca, tampoco con Claude.
                    res.update(content=NO_PAGO, is_error=True)
                    fallo = True
                elif b['name'] == 'wait':
                    res['content'] = accion_claude(b['name'], entrada)  # esperar no toca: sin el candado
                    hecho = True
                else:
                    contenido, hecho = efecto_modelo(t, epoca, lambda: accion_claude(b['name'], entrada))
                    if hecho:
                        res['content'] = contenido
                    else:
                        res.update(content=contenido, is_error=True)
                        fallo = True
                paso = t.anotar(accion=b['name'], args=entrada, ms=ms, pensado=texto[-400:],
                                miniatura=miniatura(captura()[0]) if b['name'] != 'screenshot' else None)
                t.resultado_paso(paso, hecho)
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
# Lo más que una captura espera al candado del escritorio (si se está reiniciando, mejor 409 y que vuelva a pedir).
ESPERA_ESCRITORIO_S = 2.0
# De quién fue la última tarea en el escritorio. None al arrancar: la primera tarea también estrena escritorio.
DUENO_ACTUAL = {'v': None}
# El mismo pedido (dueño + request_id) es la misma tarea: un reintento tras una respuesta perdida no lanza otra.
PEDIDOS = {}
PEDIDOS_MAX = 2000


def efecto_modelo(t, epoca, hacer):
    """Un toque del modelo, por la misma cola que lo de la persona, el reinicio y la captura (ESCRITORIO_LOCK):
    la última revisión va pegada al efecto. Si entre la decisión y el toque la pararon, la pausaron, tomaron o
    devolvieron el control (otra época) o el escritorio cambió de dueño, no se hace (auditoría 3-oct, PC03). La
    inferencia nunca tiene el candado. Devuelve (texto para el modelo, si se hizo)."""
    with ESCRITORIO_LOCK:
        if t.parar:
            return NO_PARADA, False
        if t.epoca != epoca or t.pausa or t.control:
            return NO_PAUSA, False
        if REINICIANDO['v'] or DUENO_ACTUAL['v'] != t.dueno:
            return NO_ESCRITORIO, False
        try:
            return hacer(), True
        except Exception as e:
            return f'Error: {e}', False


def quietud(timeout=ESPERA_QUIETUD_S):
    """Espera a que termine el toque que ya está en vuelo (lo que empezó termina y queda en los pasos)."""
    if not ESCRITORIO_LOCK.acquire(timeout=timeout):
        return False
    ESCRITORIO_LOCK.release()
    return True


def olvidar_viejas():
    """Las terminadas hace más de OLVIDAR_TRAS_S se van; y nunca más de TAREAS_MAX en memoria."""
    ahora = time.time()
    terminadas = sorted((t for t in TAREAS.values() if t.estado not in ESTADOS_VIVOS), key=lambda t: t.creada)
    # Los pedidos se recuerdan más que sus tareas (repetir uno olvidado da 409, no otra tarea), con un tope.
    for k in list(PEDIDOS)[:max(0, len(PEDIDOS) - PEDIDOS_MAX)]:
        PEDIDOS.pop(k, None)
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
        self.pregunta_id = None  # y cuál es: un sí solo contesta ESA pregunta (auditoría 3-oct, PC01)
        self.si = None
        # El sí a una pregunta del modelo: {clases, epoca, vence, pregunta_id}. Vale para UNA acción de lo que se
        # preguntó, en esta época y antes de vencer (_sensible).
        self.permiso = None
        # Sube cada vez que pausan, toman o devuelven el control, o paran: lo decidido en otra época no toca
        # (efecto_modelo) y un permiso de otra época no vale.
        self.epoca = 0
        self.ultimo_elemento = ''   # lo enfocado: un Enter después vale lo mismo que tocarlo ('' página, None no se sabe)
        self.persona_actuo = False
        self.notas = []          # lo que se le dice al modelo en el paso siguiente

    @property
    def permiso_unico(self):
        """¿Queda un sí del modelo sin usar? (lo de antes: un booleano; ahora el permiso ligado)."""
        return self.permiso is not None

    def anotar(self, **paso):
        with self.cambio:
            paso['n'] = len(self.pasos) + 1
            paso['t'] = round(time.time() - self.creada, 1)
            self.pasos.append(paso)
            self.cambio.notify_all()
        return paso

    def resultado_paso(self, paso, hecho):
        """El recibo del paso: si la acción se hizo de verdad o no (la app no marca hecho lo que no se hizo)."""
        with self.cambio:
            paso['hecho'] = bool(hecho)
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
        """Cambia banderas (pausa, control, si, parar) y despierta al ciclo si está esperando. Pausar, tomar o
        devolver el control y parar abren otra época: lo que el modelo decidió antes ya no se hace."""
        with self.cambio:
            if any(k in ('pausa', 'control', 'parar') and getattr(self, k) != v for k, v in cambios.items()):
                self.epoca += 1
            for k, v in cambios.items():
                setattr(self, k, v)
            self.cambio.notify_all()

    def contestar(self, pregunta_id, si):
        """El sí o el no a la pregunta `pregunta_id`. False si ya no es la que espera (una respuesta vieja no
        contesta una pregunta nueva)."""
        with self.cambio:
            if not self.pregunta or not pregunta_id or self.pregunta_id != pregunta_id or self.si is not None:
                return False
            self.si = bool(si)
            self.cambio.notify_all()
            return True

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
            self.ultimo_elemento = None  # la persona tocó: ya no se sabe qué está enfocado
        return True

    def pedir_confirmacion(self, pregunta):
        """Se queda quieta hasta el sí o el no de la persona. True/False; None si la pararon. Sin respuesta
        en ESPERA_CONFIRMACION_S la tarea se cierra (Detenida): nada sensible se hace sin su sí."""
        pregunta = ' '.join(str(pregunta or '').split())[:300] or 'Voy a hacer algo sensible. ¿Lo hago?'
        pid = uuid.uuid4().hex[:12]
        self.permiso = None
        self.anotar(accion='pedir_confirmacion', args={'pregunta': pregunta})
        hasta = time.time() + ESPERA_CONFIRMACION_S
        with self.cambio:
            self.pregunta, self.pregunta_id, self.si, self.en_espera = pregunta, pid, None, True
            self.cambio.notify_all()
            try:
                while self.si is None and not self.parar and time.time() < hasta:
                    self.cambio.wait(min(5, max(0.05, hasta - time.time())))
                si = self.si
            finally:
                self.pregunta, self.pregunta_id, self.si, self.en_espera = None, None, None, False
                self.cambio.notify_all()
        if self.parar:
            return None
        if si is None:
            raise Detenida('nadie dijo que sí a tiempo; no hice lo que pedía permiso')
        self.anotar(accion='confirmacion', args={'si': bool(si)})
        # El sí deja permiso para UNA acción de lo que se preguntó, en esta época y por PERMISO_VALE_S.
        self.permiso = {'clases': clases_de(pregunta), 'epoca': self.epoca, 'vence': time.time() + PERMISO_VALE_S,
                        'pregunta_id': pid} if si else None
        return bool(si)

    def resumen(self, con_miniaturas=False):
        pasos = self.pasos if con_miniaturas else [{k: v for k, v in p.items() if k != 'miniatura'} for p in self.pasos]
        return {'id': self.id, 'motor': self.motor, 'instruccion': self.instruccion, 'estado': self.estado_visible(), 'pasos': pasos,
                'respuesta': self.respuesta, 'error': self.error, 'segundos': round(time.time() - self.creada, 1),
                'pregunta': self.pregunta, 'pregunta_id': self.pregunta_id, 'en_espera': self.en_espera, 'epoca': self.epoca}


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
                # La época con que se mira la pantalla: si cambia mientras piensa, la jugada ya no vale.
                epoca = t.epoca
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
                paso = t.anotar(accion=nombre, args=args, ms=ms, pensado=pensado, miniatura=miniatura(png))
                # Lo pararon (o pausaron) MIENTRAS pensaba: lo que decidió ya no se hace (auditoría, 3-oct: el
                # clic salía igual). En pausa, al seguir mira la pantalla de nuevo en lugar de usar esta jugada; y
                # también si la pausaron y siguió mientras pensaba (otra época: miraba otra pantalla).
                if t.parar:
                    t.resultado_paso(paso, False)
                    return t.cerrar('parada')
                if t.epoca != epoca or t.pausa or t.control:
                    t.resultado_paso(paso, False)
                    mensajes.append({'role': 'tool', 'tool_call_id': llamada.id, 'content': NO_PAUSA})
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
                hecho = False
                if resultado is None:
                    resultado, hecho = efecto_modelo(t, epoca, lambda: ejecutar(nombre, args, ancho, alto))
                    if hecho:
                        asentar(nombre, args)
                t.resultado_paso(paso, hecho)
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
    # El mismo pedido repetido (el servidor no recibió la respuesta y reintentó) devuelve la MISMA tarea en lugar
    # de lanzar otra (auditoría 3-oct, PC04). Sin await entre mirar y anotar: dos repetidos no se cruzan.
    pedido = str(cuerpo.get('request_id') or '').strip()[:80]
    llave = f'{dueno}|{pedido}' if pedido else ''
    if llave and llave in PEDIDOS:
        previa = TAREAS.get(PEDIDOS[llave])
        if previa:
            return {'id': previa.id, 'estado': previa.estado_visible(), 'repetida': True}
        # Ya se hizo y se olvidó (o el nodo la perdió): no se vuelve a lanzar a ciegas.
        raise HTTPException(409, 'ese pedido ya se hizo; pide la tarea de nuevo si quieres repetirla')
    t = Tarea(instruccion, max(1, min(PASOS_MAX, int(cuerpo.get('max_pasos') or 25))), motor, dueno)
    olvidar_viejas()
    TAREAS[t.id] = t
    if llave:
        PEDIDOS[llave] = t.id
    lanzar(t)
    return {'id': t.id, 'estado': t.estado}


def lanzar(t):
    threading.Thread(target=correr, args=(t,), daemon=True).start()


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
    # El ACK sale cuando ningún toque está en vuelo: lo que ya empezó terminó y quedó en los pasos.
    quieta = quietud()
    return {'id': id, 'estado': t.estado_visible(), 'en_espera': t.en_espera, 'quieta': quieta, 'epoca': t.epoca}


@app.post('/tareas/{id}/reanudar')
def reanudar(id: str, req: Request):
    t = viva(tarea(req, id))
    t.avisar(pausa=False, control=False)
    return {'id': id, 'estado': t.estado_visible()}


@app.post('/tareas/{id}/confirmar')
async def confirmar(id: str, req: Request):
    t = viva(tarea(req, id))
    cuerpo = await cuerpo_de(req)
    si = bool(cuerpo.get('si'))
    if not t.pregunta:
        raise HTTPException(409, 'no está esperando ningún sí')
    # El sí lleva la pregunta que contesta: una respuesta vieja (o sin decir a cuál) no contesta la de ahora.
    if not t.contestar(str(cuerpo.get('pregunta_id') or ''), si):
        raise HTTPException(409, 'esa respuesta era para otra pregunta; mira la de ahora')
    return {'id': id, 'si': si}


def cambiar_control(t, tomar):
    """La persona toma o devuelve el escritorio, por la cola del escritorio: devolver espera a que termine lo que
    ella está haciendo (escribir, un clic) antes de que el modelo pueda volver a tocar, y tomar espera a que termine
    el toque del modelo que ya estaba en vuelo (auditoría 3-oct, PC03). La respuesta sale cuando ya es verdad."""
    if not ESCRITORIO_LOCK.acquire(timeout=ESPERA_QUIETUD_S):
        raise HTTPException(409, 'un momento: está terminando una acción')
    try:
        if t.pregunta:
            raise HTTPException(409, 'primero contesta si lo hace o no')
        t.avisar(control=tomar, pausa=False)
    finally:
        ESCRITORIO_LOCK.release()
    return {'estado': t.estado_visible(), 'en_espera': t.en_espera, 'epoca': t.epoca}


@app.post('/tareas/{id}/control')
async def control(id: str, req: Request):
    t = viva(tarea(req, id))
    tomar = bool((await cuerpo_de(req)).get('tomar'))
    r = await asyncio.get_running_loop().run_in_executor(None, lambda: cambiar_control(t, tomar))
    return {'id': id, **r}


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
        paso = _accion_persona(t, cuerpo, tipo, ancho, alto, coord)
    asentar('persona')  # la espera a que la pantalla cambie, ya sin el escritorio tomado
    return paso


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
    # Nunca la pantalla de otro dueño (ni la del anterior mientras se reinicia). El mismo candado que el reinicio
    # en correr(): la revisión del dueño y la captura van juntas, sin que un reinicio se cuele en medio. Si el
    # escritorio se está preparando, no se espera: 409 y el teléfono vuelve a pedir.
    if not ESCRITORIO_LOCK.acquire(timeout=ESPERA_ESCRITORIO_S):
        raise HTTPException(409, 'preparando su escritorio')
    try:
        if REINICIANDO['v'] or DUENO_ACTUAL['v'] != t.dueno:
            raise HTTPException(409, 'preparando su escritorio')
        png, _, _ = captura()
    finally:
        ESCRITORIO_LOCK.release()
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
                yield f'event: estado\ndata: {json.dumps({"estado": visto, "pregunta": t.pregunta, "pregunta_id": t.pregunta_id}, ensure_ascii=False)}\n\n'
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
