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
  POST /tareas {"instruccion": "...", "motor": "holo"|"claude", "max_pasos": 25, "dueno": "<huella>", "request_id": "...",
                "desde_tarea": "<primera tarea de la misión, si la sigue>"}
                                                         → {"id": ...} (el mismo request_id del mismo dueño: la misma tarea)

Cada dueño (una huella, nunca el correo) trabaja en un escritorio limpio: si la tarea es de otro dueño que
la anterior, el contenedor del escritorio se borra y se crea de nuevo (pestañas, historial, descargas y
documentos del anterior no quedan). Las tareas terminadas se olvidan tras una hora.
  GET  /tareas/{id}                                      → estado, pasos, respuesta, `pregunta` y `pregunta_id` (si espera un sí),
                                                           y al terminar `archivos`: [{ruta, existe, bytes, sha256, reciente?,
                                                           mencionado?, fuera?}] que el NODO comprobó en el espacio de trabajo
                                                           (ESPACIO_TRABAJO) después de la tarea, nunca sacados del texto del
                                                           modelo; null + `archivos_error` si no pudo mirar (comprobar_archivos)
  GET  /tareas/{id}/eventos                              → los mismos pasos en vivo (SSE)
  POST /tareas/{id}/parar                                → {"estado", "parada": {"id", "fase"}}: fase «quiescent» (nada en
                                                           vuelo: detenida de verdad) o «draining» (un toque ya despachado
                                                           termina; se consulta con el id). Nunca bloquea más de ESPERA_QUIETUD_S.
  GET  /tareas/{id}/parada/{parada_id}                   → cómo va esa parada (fenced → draining → quiescent) y el recibo del toque en vuelo
  POST /tareas/{id}/pausar · /reanudar                   → pausa entre un paso y el siguiente
  POST /tareas/{id}/confirmar {"si": true|false, "pregunta_id": "...", "propuesta": "..."}  → contesta ESA pregunta, de ESA
                                                           propuesta (otra: 409). Un «sí» SIN `propuesta` tampoco vale (409):
                                                           el sí aprueba la operación exacta que se mostró, destino incluido.
                                                           Un «no» basta con `pregunta_id` (no autoriza nada).
  POST /tareas/{id}/control {"tomar": true|false}        → la persona toma el escritorio (la tarea espera) o lo devuelve;
                                                           {"fase": "quiescent" | "draining"} como parar
  POST /tareas/{id}/accion {"tipo": "click"|"escribir"|"tecla"|"scroll", ...}  → lo que hace la persona con el control
  GET  /tareas/{id}/pantalla?ancho=960                   → la captura de ahora (JPEG), solo mientras esa tarea tiene el escritorio,
                                                           con su frame en cabeceras: X-Frame-Seq, X-Frame-Ts (hora del nodo),
                                                           X-Frame-Ancho/Alto (tamaño lógico), X-Viewport-Rev, X-Control-Epoca y
                                                           X-Privado (1 en modo seguro: no se guarda ni va al modelo)
  POST /tareas/{id}/control {"tomar", "clientId"?, "expectedControlEpoch"?}  → con clientId el control queda ligado a ESE
                                                           cliente (lease): otra sesión que lo toma abre otra época y cerca al anterior
  POST /tareas/{id}/entrada {remoteSessionId, clientId, controlEpoch, inputSequence, viewportRevision, type, payload}
                                                         → el contrato de entradas (AUR09): pointer, scroll, key, text_commit,
                                                           release_all; un ACK por evento; lo repetido devuelve el mismo ACK sin
                                                           tocar; lo viejo, de otra época, otro cliente u otro viewport: 409
  POST /tareas/{id}/seguro {"activar", "clientId"?, "frameSeq"?}  → entrada segura (contraseñas): el agente no toca ni mira;
                                                           salir pide un frame visto DESPUÉS de lo último que escribió la persona
  GET  /pantalla                                         → la captura de ahora (PNG); nunca durante una entrada segura (423)

Estados de una tarea: en_cola, trabajando, pausada, confirmar (espera el sí de la persona antes de algo
sensible: enviar, iniciar sesión, publicar, borrar), control (la persona tiene el escritorio), y los finales
hecha, parada, sin_pasos, fallo. Pagar o comprar: nunca (la acción no se hace aunque el modelo la pida).
/salud dice `capacidades` (pausar, confirmar, control, entrada, seguro): el servidor de AU-RA solo ofrece lo que el
nodo sabe.
  POST /vista · GET /vista/permitir                      → cerradas (AUR09): noVNC aceptaba clics y teclas por fuera del
                                                           árbitro (épocas, candado del escritorio, modo seguro). 410 / 403.
"""
import asyncio
import base64
import hashlib
import hmac
import io
import json
import os
import posixpath
import re
import shlex
import subprocess
import threading
import time
import unicodedata
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
# Lo más que parar, pausar o tomar/devolver el control esperan a que termine el toque que ya está en vuelo. Pasado
# el tope contestan «draining» con un id para consultar, sin quedarse bloqueados (AUR03). Menos que lo que el
# servidor de AU-RA espera la respuesta (12 s; el de antes, 8 s).
ESPERA_QUIETUD_S = float(os.environ.get('ESPERA_QUIETUD_S', '5'))
# Las entradas de la persona por segundo (cubeta: ráfaga y ritmo sostenido) en el contrato de entradas (AUR09).
ENTRADAS_POR_S = float(os.environ.get('ENTRADAS_POR_S', '15'))
ENTRADAS_RAFAGA = int(os.environ.get('ENTRADAS_RAFAGA', '30'))
# Cerrar el VNC de la imagen del escritorio al crearlo (noVNC no puede saltarse el árbitro). 0 lo deja.
CERRAR_VNC = os.environ.get('CERRAR_VNC', '1') != '0'
# Lo que este servicio sabe hacer además de encargar y parar (el servidor de AU-RA lo lee en /salud). `entrada`: el
# contrato de entradas con época, secuencia, viewport y ACK, y el frame en cabeceras; `seguro`: la entrada segura.
CAPACIDADES = ['pausar', 'confirmar', 'control', 'entrada', 'seguro']
ESTADOS_VIVOS = ('en_cola', 'trabajando', 'pausada', 'confirmar', 'control')
# El espacio de trabajo de la misión dentro del escritorio (la carpeta de la persona del escritorio de la demo): lo
# único donde se buscan y comprueban archivos al terminar. Lo de fuera ni se mira (revisión externa, 4-oct).
ESPACIO_TRABAJO = os.environ.get('ESPACIO_TRABAJO', '/home/computeruse').rstrip('/') or '/home/computeruse'
ARCHIVOS_MAX = 12        # cuántos archivos se cuentan en el final
ARCHIVOS_PROFUNDIDAD = 6  # cuántas carpetas hacia dentro se busca

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
# El último frame que se le entregó a la persona (AUR09): su secuencia, la hora del nodo, el tamaño lógico y la
# revisión del viewport. Las coordenadas de una entrada valen solo para la revisión con que se miró: si el escritorio
# cambia de tamaño o se crea otro, la revisión sube y lo que venía con la de antes no toca.
FRAME = {'seq': 0, 'ts': 0.0, 'ancho': TAMANO['ancho'], 'alto': TAMANO['alto'], 'rev': 1}


def anotar_frame(ancho, alto):
    """Una captura que se le entrega a la persona (con el escritorio tomado): sube la secuencia y, si el tamaño
    cambió, la revisión del viewport."""
    if (ancho, alto) != (FRAME['ancho'], FRAME['alto']):
        FRAME['rev'] += 1
    FRAME.update(seq=FRAME['seq'] + 1, ts=time.time(), ancho=ancho, alto=alto)
    return dict(FRAME)


def captura():
    """PNG de la pantalla entera, y su tamaño (el mismo con que se escalan las coordenadas)."""
    png = en_escritorio('import -window root png:-', timeout=20)
    ancho, alto = Image.open(io.BytesIO(png)).size
    TAMANO.update(ancho=ancho, alto=alto)
    return png, ancho, alto


def escritorio_nuevo():
    """Borra el escritorio y crea uno limpio, igual que instalar.sh, y espera a que tenga pantalla. Sin publicar el
    puerto de noVNC (AUR09: nadie entra al escritorio por fuera del árbitro), y otro viewport: las coordenadas que
    venían del escritorio de antes ya no tocan."""
    FRAME['rev'] += 1
    subprocess.run(['docker', 'rm', '-f', ESCRITORIO], capture_output=True, timeout=60)
    r = subprocess.run(['docker', 'run', '-d', '--name', ESCRITORIO, '--restart', 'unless-stopped',
                        '-e', 'WIDTH=1280', '-e', 'HEIGHT=800', '--shm-size', '2g',
                        ESCRITORIO_IMAGEN], capture_output=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError('no pude crear el escritorio: ' + r.stderr.decode('utf-8', 'ignore')[:200])
    hasta = time.time() + 90
    while time.time() < hasta:
        try:
            captura()
            # La barra y el gestor de ventanas tardan un poco más que la pantalla.
            en_escritorio('pgrep -x tint2 >/dev/null && pgrep -x mutter >/dev/null', timeout=10)
            cerrar_vnc()
            time.sleep(2)
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError('el escritorio nuevo no arrancó a tiempo')


def cerrar_vnc():
    """La imagen de la demo arranca x11vnc (sin clave) y noVNC dentro del contenedor. Nada los usa (xdotool habla con
    la pantalla): se cierran para que ninguna ruta acepte entradas por fuera del árbitro. Sin el puerto publicado ya
    no se alcanzan desde fuera del host; esto cierra también la red interna de docker. Lo mejor posible: si la
    imagen no los tiene o los vuelve a lanzar, no rompe nada (no verificado en el nodo real)."""
    if not CERRAR_VNC:
        return
    try:
        # «[x]11vnc»: el patrón no se encuentra a sí mismo en la línea del sh que lo corre.
        en_escritorio("pkill -f '[x]11vnc'; pkill -f '[w]ebsockify'; pkill -f '[n]ovnc_proxy'; true", timeout=10)
    except Exception:
        pass


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
NO_CAMBIO = ('Not executed: this is no longer exactly what the user approved (the recipient, the text, the amount, the '
             'page, the owner or the time changed, or the approval expired). Ask again saying exactly what will happen.')
NO_PERMISO = 'Not executed: that approval was already used (or is no longer valid). Ask again if it is still needed.'
INCIERTO = ('It may have happened or not: look at the screen and check before anything else. Do not repeat it '
            'without asking the user again.')
SI_DIJO = 'The user said YES. Go ahead with exactly that action.'
NOTA_CONTROL = ('Note: the user took control of the desktop for a moment and may have changed what is on the '
                'screen. Look at the new screenshot and continue the task from where it is now, without starting over.')
NOTA_SEGURO = ('Note: the user typed private data (a password or similar) by hand while you could not see the screen. '
               'Do not read, repeat or reveal what is in password or private fields; continue the task.')


class Detenida(Exception):
    """La tarea se cierra como parada con un motivo (nadie contestó, la pausa se pasó del tope)."""


def idioma_de(texto):
    """'en' si la tarea está en inglés; si no, 'es'."""
    t = f' {str(texto).lower()} '
    en = sum(t.count(f' {w} ') for w in ('the', 'and', 'what', 'tell', 'me', 'go', 'to', 'find', 'search', 'is', 'of'))
    es = sum(t.count(f' {w} ') for w in ('el', 'la', 'y', 'de', 'que', 'dime', 'busca', 'entra', 'a', 'en', 'los'))
    return 'en' if en > es else 'es'


# Lo que hace consecuente a una acción sensible (AUR02): a quién va (correos, @usuarios, teléfonos), cuánto (importes),
# qué texto lleva y en qué página. El sí se liga a eso, no a la clase («enviar»): el sí de «enviar a Ana» no envía a Bruno.
CORREO = re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+')
USUARIO = re.compile(r'(?<![\w.+-])@([A-Za-z0-9_]{2,30})\b')
TELEFONO = re.compile(r'\+\d[\d ().-]{6,}\d|\b\d{4}[- ]\d{4}\b')
IMPORTE = re.compile(r'(?:[$€£]|\bL\.?|\bUSD|\bHNL|\bEUR)\s?\d[\d.,]*\d|\b\d[\d.,]*\s?(?:USD|HNL|EUR|d[oó]lares|lempiras|euros)\b', re.I)
# Teclas que vuelven a otra página: lo escrito ya no está a la vista.
NAVEGA = (['alt', 'left'], ['alt', 'right'], ['f5'], ['ctrl', 'r'])


def _normal(texto):
    return ' '.join(str(texto or '').split()).casefold()


def _huella(x):
    """Huella estable de algo (los conjuntos, ordenados)."""
    return hashlib.sha256(json.dumps(x, sort_keys=True, ensure_ascii=False, default=sorted).encode()).hexdigest()


def destinos_de(texto):
    """A quién va algo, normalizado: correos, @usuarios y teléfonos que nombra."""
    s = str(texto or '')
    d = {m.group(0).lower() for m in CORREO.finditer(s)}
    d |= {'@' + m.group(1).lower() for m in USUARIO.finditer(s)}
    d |= {('+' if m.group(0).startswith('+') else '') + re.sub(r'\D', '', m.group(0)) for m in TELEFONO.finditer(s)}
    return frozenset(d)


def importes_de(texto):
    return frozenset(re.sub(r'\s+', '', m.group(0)).upper() for m in IMPORTE.finditer(str(texto or '')))


def dominio_de(url):
    u = str(url or '').strip().lower()
    u = re.sub(r'^[a-z]+://', '', u).split('/')[0].split('?')[0].split('#')[0].split('@')[-1].split(':')[0]
    return u[4:] if u.startswith('www.') else u


def operacion(t, nombre, a, elemento, clases):
    """La operación canónica de una acción sensible (AUR02), la que se aprueba y se vuelve a calcular en el punto del
    efecto: qué acción, sobre qué elemento, a quién, con qué texto (lo escrito en la página desde que se abrió) y qué
    importe, en qué página."""
    escrito = list(t.escrito)
    if nombre == 'type' and a.get('text'):
        escrito.append(str(a['text']))
    fuente = f'{elemento} {" ".join(escrito)}'
    return {'accion': nombre, 'elemento': _normal(elemento)[:200], 'clases': frozenset(clases),
            'destinos': destinos_de(fuente), 'importes': importes_de(fuente),
            'texto': _huella(_normal(' '.join(escrito))), 'dominio': t.dominio}


def vinculo(op, p):
    """El binding de un permiso a una operación: la operación + tarea, dueño, época, pregunta y caducidad."""
    return _huella({'op': op, 'tarea': p['tarea'], 'dueno': p['dueno'], 'epoca': p['epoca'],
                    'pregunta_id': p['pregunta_id'], 'vence': p['vence']})


def cubre(p, op, t):
    """¿El sí `p` (libre, sin usar) cubre esta operación? Misma tarea, dueño y época, sin vencer, y: o se aprobó esta
    operación exacta, o lo que se preguntó nombra su clase, a todos sus destinatarios e importes, con el mismo texto
    escrito y en la misma página que cuando se preguntó."""
    if not p or p.get('estado') != 'libre':
        return False
    if p['tarea'] != t.id or p['dueno'] != t.dueno or p['epoca'] != t.epoca or time.time() > p['vence']:
        return False
    if p.get('op') is not None:
        return _huella(p['op']) == _huella(op)
    c = op['clases']
    if not c or c & {'otro', 'desconocido'} or not c <= p['clases']:
        return False
    return (op['destinos'] <= p['destinos'] and op['importes'] <= p['importes'] and op['texto'] == p['texto']
            and op['dominio'] == p['dominio'])


def pregunta_para(elemento, idioma='es', op=None, incierta=False):
    """La pregunta antes de una acción sensible: dice a quién va y cuánto (lo que el sí aprueba)."""
    e = ' '.join(str(elemento).split())[:80]
    en = idioma == 'en'
    extra = []
    if op and op['destinos']:
        extra.append(('to ' if en else 'para ') + ', '.join(sorted(op['destinos']))[:160])
    if op and op['importes']:
        extra.append(('for ' if en else 'por ') + ', '.join(sorted(op['importes']))[:60])
    sufijo = f' ({"; ".join(extra)})' if extra else ''
    if incierta:
        return (f'«{e}»{sufijo} may already have happened (I could not tell). Should I try again?' if en
                else f'Puede que «{e}»{sufijo} ya se haya hecho (no supe si llegó). ¿Lo intento otra vez?')
    return f'I am about to click «{e}»{sufijo}. Should I?' if en else f'Voy a tocar «{e}»{sufijo}. ¿Lo hago?'


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


def _sensible(t, elemento, idioma, clases, op, accion):
    """Lo sensible, con un sí para ESTA operación (AUR02). El sí que el modelo pidió antes (ask_user_confirmation)
    solo la cubre si nombra lo mismo (clase, destinatarios, importes, el texto escrito, la página), en la misma época
    y antes de vencer; se usa una vez y, si la operación es otra, se pierde y se pregunta otra vez diciendo lo que
    cambió (antes el sí de «enviar a Ana» enviaba a Bruno). El sí queda RESERVADO para esta operación: se canjea en
    el punto del efecto (efecto_modelo), una sola vez."""
    with t.cambio:
        p, t.permiso = t.permiso, None
    if not cubre(p, op, t):
        incierta = _huella(op) in t.inciertas
        si = t.pedir_confirmacion(pregunta_para(elemento, idioma, op, incierta), op=op)
        if si is None:
            raise Detenida('la pararon mientras esperaba tu sí')
        if not si:
            return NO_DIJO
        with t.cambio:
            p, t.permiso = t.permiso, None
        if not cubre(p, op, t):
            # La pausaron o tomaron el control mientras contestaba: ese sí era de otra época.
            return NO_PAUSA if p and p['epoca'] != t.epoca else NO_CAMBIO
    t.reservar(p, op, *accion)
    return None


def _decidir(t, tipo, clases, texto, idioma, nombre, a, elemento):
    if tipo == 'pago':
        return NO_PAGO
    if tipo in ('sensible', 'desconocido'):
        op = operacion(t, nombre, a, elemento, clases)
        return _sensible(t, texto, idioma, clases, op, (nombre, a, elemento))
    return None


def revisar_accion(t, nombre, a):
    """Antes de una acción del motor gratis, el mediador de efectos: pagar o comprar, nunca; lo sensible o lo que
    no se sabe qué hace, solo con el sí de la persona. Lleva la cuenta de lo enfocado (`t.ultimo_elemento`: '' es
    la página recién abierta, None es «no se sabe» tras un Tab). Devuelve None si se puede hacer, o el texto que
    vuelve al modelo en lugar de hacerla. Si es sensible y tiene su sí, la operación queda en `t.por_hacer`
    (reservada) para canjearla en el efecto."""
    t.por_hacer = None
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
        return _decidir(t, tipo, clases, f'Enter en «{foco}»' if idioma == 'es' else f'Enter on «{foco}»', idioma,
                        nombre, a, foco)
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
    r = _decidir(t, tipo, clases, elemento, idioma, nombre, a, elemento)
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


def miniatura_de_paso(t):
    """La captura que se guarda con un paso (la app la muestra y queda en la tarjeta del final): nunca durante una
    entrada segura (AUR09): lo de ese intervalo no se guarda."""
    if t.seguro:
        return None
    png = captura()[0]
    return None if t.seguro else miniatura(png)


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
                t.anotar(accion='answer', args={'content': texto[:300]}, ms=ms, miniatura=miniatura_de_paso(t))
                return terminar_hecha(t, texto or '(sin respuesta)')
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
                hecho = incierto = False
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
                    contenido, hecho = efecto_modelo(t, epoca, lambda: accion_claude(b['name'], entrada), b['name'])
                    incierto = not hecho and (t.ultima_op or {}).get('estado') == 'incierta'
                    if hecho:
                        res['content'] = contenido
                    else:
                        res.update(content=contenido, is_error=True)
                        fallo = True
                paso = t.anotar(accion=b['name'], args=entrada, ms=ms, pensado=texto[-400:],
                                miniatura=miniatura_de_paso(t) if b['name'] != 'screenshot' else None)
                t.resultado_paso(paso, hecho, incierto)
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


# ------------------------------------------------------------------ archivos: lo que el nodo comprueba al terminar

EXTENSIONES = 'odt|ods|odp|odg|docx?|xlsx?|pptx?|pdf|txt|csv|tsv|md|rtf|html?|json|xml|png|jpe?g|gif|svg|webp|zip'
RE_URL = re.compile(r'\b(?:https?|ftp)://\S+|\bwww\.\S+', re.I)
RE_ARCHIVO = re.compile(r'(?<![\w/.~-])((?:~/|/|\.\./|\./)?(?:[\w.-]+/)*[\w-][\w.-]*\.(?:' + EXTENSIONES + r'))(?![\w-])', re.I)


def rutas_mencionadas(*textos):
    """Los archivos que nombran la instrucción o la respuesta (informe.odt, ~/Documents/x.pdf, /home/.../x.csv), sin
    las direcciones web. Solo dicen QUÉ buscar: si existen lo dice el escritorio, nunca el texto."""
    vistas = []
    for texto in textos:
        for m in RE_ARCHIVO.finditer(RE_URL.sub(' ', str(texto or ''))):
            if m.group(1) not in vistas:
                vistas.append(m.group(1))
    return vistas[:8]


def ruta_en_espacio(ruta):
    """La ruta absoluta (normalizada) dentro del espacio de trabajo; '' si es un nombre suelto o relativo (se busca por
    su nombre dentro del espacio); None si cae fuera (otra carpeta, «..»): eso no se mira."""
    r = str(ruta or '').strip()
    if r.startswith('~/'):
        r = ESPACIO_TRABAJO + r[1:]
    if not r.startswith('/'):
        return None if '..' in r.split('/') else ''
    n = posixpath.normpath(r)
    return n if n.startswith(ESPACIO_TRABAJO + '/') else None


def comando_archivos(nombres, minutos):
    """El comando que corre DENTRO del escritorio: los archivos normales del espacio de trabajo (ni enlaces ni nada
    oculto, como el perfil de Firefox) que se llaman como lo nombrado o que cambiaron en los últimos `minutos`, con su
    tamaño, su hora y su sha256. Sin el espacio, SIN_ESPACIO."""
    q = shlex.quote(ESPACIO_TRABAJO)
    base = f'find {q} -mindepth 1 -maxdepth {ARCHIVOS_PROFUNDIDAD} -name ".*" -prune -o -type f'
    partes = []
    if nombres:
        partes.append(base + ' \\( ' + ' -o '.join(f'-name {shlex.quote(n)}' for n in nombres) + ' \\) -print')
    partes.append(f'{base} -mmin -{int(minutos)} -print')
    return (f'cd {q} 2>/dev/null || {{ echo SIN_ESPACIO; exit 0; }}; '
            '{ ' + '; '.join(partes) + "; } 2>/dev/null | awk '!v[$0]++' | head -n 40 | "
            'while IFS= read -r f; do printf "%s\\t%s\\t%s\\n" "$(stat -c "%s %Y" -- "$f")" '
            '"$(sha256sum -- "$f" | cut -d" " -f1)" "$f"; done')


def comprobar_archivos(t, respuesta):
    """Después de la tarea, el NODO mira su propio espacio de trabajo: lo que la instrucción o la respuesta nombran (si
    existe, cuánto pesa y su sha256) y lo que se creó o cambió durante ESTA tarea (`reciente`). Del texto del modelo
    solo sale qué buscar; lo de fuera del espacio no se mira (`fuera`). Devuelve (archivos, error); (None, error) si no
    pudo mirar: eso es «sin comprobar», no «no hay archivos»."""
    buscar, fuera = [], []
    for n in rutas_mencionadas(t.instruccion, respuesta):
        dentro = ruta_en_espacio(n)
        (fuera if dentro is None else buscar).append((n, dentro))
    nombres = sorted({posixpath.basename(dentro or n) for n, dentro in buscar})
    minutos = int((time.time() - t.desde) // 60) + 2
    try:
        salida = en_escritorio(comando_archivos(nombres, minutos), timeout=40).decode('utf-8', 'replace')
    except Exception as e:
        return None, str(e)[:200] or 'no pude mirar el escritorio'
    if salida.strip() == 'SIN_ESPACIO':
        return None, f'no encontré el espacio de trabajo ({ESPACIO_TRABAJO})'

    def es(a, n, dentro):
        return a['ruta'] == dentro if dentro else posixpath.basename(a['ruta']) == posixpath.basename(n)

    archivos = []
    for linea in salida.splitlines():
        partes = linea.split('\t', 2)
        tam = partes[0].split() if len(partes) == 3 else []
        if len(tam) != 2 or not re.fullmatch(r'[0-9a-f]{64}', partes[1]):
            continue
        ruta = posixpath.normpath(partes[2])
        if not ruta.startswith(ESPACIO_TRABAJO + '/'):
            continue
        try:
            a = {'ruta': ruta, 'existe': True, 'bytes': int(tam[0]), 'sha256': partes[1], 'reciente': float(tam[1]) >= t.desde - 2}
        except ValueError:
            continue
        a['mencionado'] = any(es(a, n, dentro) for n, dentro in buscar)
        if a['reciente'] or a['mencionado']:
            archivos.append(a)
    for n, dentro in buscar:
        if not any(es(a, n, dentro) for a in archivos):
            archivos.append({'ruta': n, 'existe': False, 'bytes': 0, 'sha256': None, 'mencionado': True})
    archivos += [{'ruta': n, 'existe': False, 'bytes': 0, 'sha256': None, 'mencionado': True, 'fuera': True} for n, _ in fuera]
    archivos.sort(key=lambda a: not a.get('mencionado'))  # lo nombrado primero; después lo nuevo
    return archivos[:ARCHIVOS_MAX], None


def terminar_hecha(t, respuesta):
    """La tarea dice que terminó (`answer`). Antes de contarla «hecha», el nodo comprueba él mismo los archivos de su
    espacio de trabajo («guardé el archivo» es lo que dice el modelo, no prueba). Se anota ANTES del final: nadie ve
    «hecha» sin su comprobación (o sin el porqué de no tenerla)."""
    try:
        archivos, error = comprobar_archivos(t, respuesta)
    except Exception as e:  # comprobar nunca impide cerrar la tarea: queda «sin comprobar»
        archivos, error = None, str(e)[:200] or 'falló la comprobación'
    with t.cambio:
        t.archivos, t.archivos_error = archivos, error
    return t.cerrar('hecha', respuesta=respuesta)


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


def soltar_entradas():
    """Suelta teclas modificadoras y botones del ratón: al tomar o devolver el control y al parar, ninguna tecla ni
    botón queda pulsado para el operador siguiente (AUR03). Se llama con el candado del escritorio tomado."""
    try:
        en_escritorio('xdotool keyup Shift_L Shift_R Control_L Control_R Alt_L Alt_R Super_L Super_R; '
                      'xdotool mouseup 1; xdotool mouseup 2; xdotool mouseup 3', timeout=10)
    except Exception:
        pass


def _canjear(t, s):
    """Canjea el sí reservado para la operación `s`, en el punto del efecto (con el escritorio y la tarea tomados):
    se recalcula la operación con lo que hay AHORA y tiene que ser la misma que se aprobó, del mismo dueño, en la
    misma época y sin vencer. Se canjea una vez: un segundo worker o un replay lo encuentran usado. None si vale."""
    p = s['permiso']
    if p.get('estado') != 'reservado':
        return NO_PERMISO
    op = operacion(t, s['nombre'], s['args'], s['elemento'], s['clases'])
    if (p['tarea'] != t.id or p['dueno'] != t.dueno or DUENO_ACTUAL['v'] != p['dueno'] or p['epoca'] != t.epoca
            or time.time() > p['vence'] or p.get('hash') != vinculo(op, p)):
        p['estado'] = 'invalido'
        return NO_CAMBIO
    p['estado'] = 'consumido'
    return None


def efecto_modelo(t, epoca, hacer, accion='', sensible=None):
    """Un toque del modelo, por la misma cola que lo de la persona, el reinicio y la captura (ESCRITORIO_LOCK):
    la última revisión va pegada al efecto. Si entre la decisión y el toque la pararon, la pausaron, tomaron o
    devolvieron el control (otra época) o el escritorio cambió de dueño, no se hace (auditoría 3-oct, PC03). La
    revisión y el despacho son atómicos con parar/tomar el control (`t.cambio`): o el toque ve la parada y no sale,
    o la parada lo ve en vuelo y contesta «draining» (AUR03). Si es sensible, su sí se canjea aquí (AUR02). La
    inferencia nunca tiene el candado. Devuelve (texto para el modelo, si se hizo); un toque que se corta a medias
    queda «incierto» (t.ultima_op), no como no hecho."""
    with ESCRITORIO_LOCK:
        with t.cambio:
            no = t.motivo_para_no(epoca)
            if no is None and sensible is not None:
                no = _canjear(t, sensible)
            elif no is not None and sensible is not None and sensible['permiso'].get('estado') == 'reservado':
                sensible['permiso']['estado'] = 'invalido'  # se usa o se pierde
            if no is not None:
                t.ultima_op = None
                return no, False
            op = t.abrir_op('modelo', accion, epoca, _huella(sensible['permiso']['op']) if sensible else None)
        estado = 'incierta'
        try:
            r = hacer()
            estado = 'hecha'
            return r, True
        except Exception as e:
            return f'Error: {e}. {INCIERTO}', False
        finally:
            t.cerrar_op(op, estado)


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
        # Lo que el nodo comprobó en su espacio de trabajo al terminar (terminar_hecha); None: no se miró.
        self.archivos = None
        self.archivos_error = None
        self.parar = False
        self.creada = time.time()
        # Desde cuándo cuenta lo que se guarda como «de esta misión» (la primera tarea de la misión, si sigue a otra).
        self.desde = self.creada
        self.cambio = threading.Condition()
        # Pausa, control de la persona y confirmación: se miran entre un paso y el siguiente.
        self.pausa = False
        self.control = False
        self.en_espera = False  # el ciclo está de verdad quieto esperando (la persona ya puede actuar)
        self.pregunta = None    # la pregunta que espera su sí
        self.pregunta_id = None  # y cuál es: un sí solo contesta ESA pregunta (auditoría 3-oct, PC01)
        self.si = None
        self.propuesta = None   # la huella de lo que se pregunta: el sí de la app nombra ESTA propuesta (AUR02)
        # El sí a una pregunta: {clases, destinos, importes, texto, dominio, tarea, dueno, epoca, vence, pregunta_id,
        # op, estado: libre → reservado → consumido | invalido}. Vale para UNA operación de lo que se preguntó
        # (_sensible, cubre) y se canjea en el efecto (_canjear).
        self.permiso = None
        self.por_hacer = None   # la operación sensible aprobada y reservada, para el efecto que sigue
        # Sube cada vez que pausan, toman o devuelven el control, o paran: lo decidido en otra época no toca
        # (efecto_modelo) y un permiso de otra época no vale.
        self.epoca = 0
        self.ultimo_elemento = ''   # lo enfocado: un Enter después vale lo mismo que tocarlo ('' página, None no se sabe)
        self.persona_actuo = False
        self.notas = []          # lo que se le dice al modelo en el paso siguiente
        # La página: dónde (dominio del último open_url) y lo escrito desde que se abrió (el texto consecuente).
        self.dominio = ''
        self.escrito = []
        self.inciertas = set()   # operaciones sensibles que se cortaron a medias: repetirlas se pregunta así
        # El toque en vuelo (del modelo o de la persona) y el último despachado, con su recibo (AUR03).
        self.en_vuelo = None
        self.ultima_op = None
        self.parada = None       # {id, fase: fenced → draining → quiescent, epoca, en_vuelo}
        self.traspaso = None     # {id, a: persona | agente, fase, epoca}: tomar o devolver el control
        self.devolviendo = False  # devolvió el control: lo que la persona mande ya no entra
        # El control de la persona ligado a UN cliente (AUR09): {cliente (None: la app de antes), epoca, ultima
        # secuencia aceptada, acks recientes, cubeta}. Otra sesión que lo toma abre otra época y cerca al anterior.
        self.lease = None
        # Entrada segura: el agente no toca ni mira, nada de ese rato se guarda; se sale con un frame nuevo
        # (secuencia mayor que `seguro_frame`, la del frame de cuando escribió por última vez).
        self.seguro = False
        self.seguro_frame = 0

    @property
    def permiso_unico(self):
        """¿Queda un sí del modelo sin usar? (lo de antes: un booleano; ahora el permiso ligado)."""
        return self.permiso is not None

    # -- despacho, quietud y traspaso (AUR03). Orden de candados: ESCRITORIO_LOCK y después self.cambio.

    def motivo_para_no(self, epoca):
        """Con self.cambio tomado: por qué un toque del modelo decidido en `epoca` ya no puede salir (None: puede)."""
        if self.parar or self.estado not in ESTADOS_VIVOS:
            return NO_PARADA
        if self.epoca != epoca or self.pausa or self.control:
            return NO_PAUSA
        if REINICIANDO['v'] or DUENO_ACTUAL['v'] != self.dueno:
            return NO_ESCRITORIO
        return None

    def abrir_op(self, quien, accion, epoca, clave=None):
        """Con self.cambio tomado: el toque sale. Queda en vuelo hasta cerrar_op."""
        op = {'id': uuid.uuid4().hex[:10], 'quien': quien, 'accion': str(accion or ''), 'epoca': epoca,
              'desde': time.time(), 'estado': 'en_vuelo'}
        if clave:
            op['clave'] = clave
        self.en_vuelo = op
        self.ultima_op = op
        return op

    def cerrar_op(self, op, estado):
        """El toque terminó (hecha, incierta o no_hecha), con el escritorio tomado. Si una parada o un traspaso lo
        esperaban, se completan aquí mismo (y se sueltan teclas y puntero antes de que nadie más toque)."""
        with self.cambio:
            op['estado'] = estado
            op['hasta'] = time.time()
            if self.en_vuelo is op:
                self.en_vuelo = None
            if estado == 'incierta' and op.get('clave'):
                self.inciertas.add(op['clave'])
            self._quieta(soltar=True)
            self.cambio.notify_all()

    def _vuelo_viejo(self, epoca):
        """¿Queda en vuelo un toque despachado antes de la época `epoca` (con la autoridad que se revocó)?"""
        return self.en_vuelo is not None and self.en_vuelo['epoca'] < epoca

    def _quieta(self, soltar):
        """Con self.cambio tomado (y el escritorio si `soltar`): completa la parada o el traspaso que ya no tienen
        nada en vuelo de la época revocada. La parada cierra la tarea como parada: «detenida» solo con quietud."""
        listo = False
        p = self.parada
        if p and p['fase'] != 'quiescent' and not self._vuelo_viejo(p['epoca']):
            p.update(fase='quiescent', quieta_en=time.time())
            self.cerrar('parada')
            listo = True
        tr = self.traspaso
        if tr and tr['fase'] != 'quiescent' and not self._vuelo_viejo(tr['epoca']):
            if tr['a'] == 'agente':
                self.devolviendo = False
                self.lease = None
                self.avisar(control=False, pausa=False)
            tr.update(fase='quiescent', quieta_en=time.time())
            listo = True
        # Solo en SU escritorio (parar una tarea vieja no le suelta las teclas a la de otro dueño).
        if listo and soltar and DUENO_ACTUAL['v'] == self.dueno and not REINICIANDO['v']:
            soltar_entradas()
        if listo:
            self.cambio.notify_all()
        return listo

    def _aguardar(self, cond, tope):
        """Con self.cambio tomado: espera hasta que `cond()` sea falsa o pase el tope. True si se cumplió."""
        hasta = time.time() + tope
        while cond() and time.time() < hasta:
            self.cambio.wait(min(0.2, max(0.01, hasta - time.time())))
        return not cond()

    def _completar(self):
        """Fuera de self.cambio: la parada o el traspaso ya no esperan nada; se completan con el escritorio tomado
        (soltar teclas y puntero). Si el escritorio no se consigue a tiempo, se completan sin soltar."""
        tengo = ESCRITORIO_LOCK.acquire(timeout=ESPERA_ESCRITORIO_S)
        try:
            with self.cambio:
                self._quieta(soltar=tengo)
        finally:
            if tengo:
                ESCRITORIO_LOCK.release()

    def tras_efecto(self, nombre, a, sensible=False):
        """Lo que se sabe de la página después de un toque hecho: dónde está y lo que se ha escrito en ella (AUR02)."""
        if nombre == 'open_url':
            self.dominio = dominio_de(a.get('url'))
            self.escrito = []
        elif nombre == 'key' and _teclas(a) in NAVEGA:
            self.dominio = '?'
            self.escrito = []
        elif nombre == 'type':
            self.escrito.append(str(a.get('text', '')))
        elif nombre == 'key' and not _pide_enter(nombre, a):
            # Borrar, pegar, cortar…: el texto cambió aunque no se sepa cómo (un sí anterior ya no lo cubre).
            self.escrito.append(f'<{"+".join(_teclas(a))}>')
        if sensible:
            self.escrito = []  # se envió: lo que se escriba ahora es otro borrador

    def reservar(self, p, op, nombre, a, elemento):
        """El sí `p` queda reservado para ESTA operación (se canjea en efecto_modelo, una vez)."""
        with self.cambio:
            p.update(op=op, estado='reservado')
            p['hash'] = vinculo(op, p)
            self.por_hacer = {'permiso': p, 'nombre': nombre, 'args': dict(a), 'elemento': elemento, 'clases': op['clases']}

    def _copia_parada(self, p):
        if not p:
            return None
        r = {k: v for k, v in p.items() if k != 'en_vuelo'}
        v = p.get('en_vuelo')
        r['en_vuelo'] = {k: x for k, x in v.items() if k != 'clave'} if v else None
        return r

    def anotar(self, **paso):
        with self.cambio:
            paso['n'] = len(self.pasos) + 1
            paso['t'] = round(time.time() - self.creada, 1)
            self.pasos.append(paso)
            self.cambio.notify_all()
        return paso

    def resultado_paso(self, paso, hecho, incierto=False):
        """El recibo del paso: si la acción se hizo de verdad o no (la app no marca hecho lo que no se hizo), y si se
        cortó a medias después de salir (`incierto`: no se sabe; no es «deshecho»)."""
        with self.cambio:
            paso['hecho'] = bool(hecho)
            if incierto:
                paso['incierto'] = True
            self.cambio.notify_all()

    def cerrar(self, estado, respuesta=None, error=None):
        """El final. Un final no se reabre ni se reescribe (AUR04): lo que llegue tarde (un «hecha» después de
        parar) no lo cambia."""
        with self.cambio:
            if self.estado not in ESTADOS_VIVOS:
                return
            self.estado, self.respuesta, self.error = estado, respuesta, error
            self.pausa = self.control = self.seguro = False
            self.lease = None
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

    def contestar(self, pregunta_id, si, propuesta=None):
        """El sí o el no a la pregunta `pregunta_id` y a la `propuesta` que se le mostró. False si ya no es la que espera
        (una respuesta vieja no contesta una pregunta nueva). Un sí tiene que nombrar la propuesta EXACTA (revisión
        4-oct: antes, sin `propuesta`, se aceptaba por `pregunta_id`); un no basta con la pregunta (no autoriza nada)."""
        with self.cambio:
            if not self.pregunta or not pregunta_id or self.pregunta_id != pregunta_id or self.si is not None:
                return False
            if propuesta and propuesta != self.propuesta:
                return False
            if si and propuesta != self.propuesta:
                return False
            self.si = bool(si)
            self.cambio.notify_all()
            return True

    def esperar_si_pausada(self):
        """Entre un paso y el siguiente: si la pausaron o la persona tiene el control, espera (el escritorio
        sigue siendo de esta tarea). False si la pararon mientras tanto. Al volver del control, el modelo lo sabe.
        Durante una entrada segura también espera: el modelo no mira la pantalla (la captura es después de esto)."""
        if not (self.pausa or self.control or self.seguro):
            return True
        hasta = time.time() + PAUSA_MAX_S
        with self.cambio:
            self.en_espera = True
            self.persona_actuo = False
            self.cambio.notify_all()
            try:
                while (self.pausa or self.control or self.seguro) and not self.parar:
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

    def pedir_confirmacion(self, pregunta, op=None):
        """Se queda quieta hasta el sí o el no de la persona. True/False; None si la pararon. Sin respuesta
        en ESPERA_CONFIRMACION_S la tarea se cierra (Detenida): nada sensible se hace sin su sí. Con `op` (la
        operación exacta que se va a hacer), el sí es para esa operación."""
        pregunta = ' '.join(str(pregunta or '').split())[:300] or 'Voy a hacer algo sensible. ¿Lo hago?'
        pid = uuid.uuid4().hex[:12]
        # Lo que se muestra y se aprueba: tarea, pregunta y operación. El servidor la devuelve con el sí.
        propuesta = _huella({'tarea': self.id, 'pregunta_id': pid, 'pregunta': pregunta, 'op': op})[:16]
        self.permiso = None
        self.anotar(accion='pedir_confirmacion', args={'pregunta': pregunta})
        hasta = time.time() + ESPERA_CONFIRMACION_S
        with self.cambio:
            self.pregunta, self.pregunta_id, self.propuesta, self.si, self.en_espera = pregunta, pid, propuesta, None, True
            self.cambio.notify_all()
            try:
                while self.si is None and not self.parar and time.time() < hasta:
                    self.cambio.wait(min(5, max(0.05, hasta - time.time())))
                si = self.si
            finally:
                self.pregunta, self.pregunta_id, self.propuesta, self.si, self.en_espera = None, None, None, None, False
                self.cambio.notify_all()
        if self.parar:
            return None
        if si is None:
            raise Detenida('nadie dijo que sí a tiempo; no hice lo que pedía permiso')
        self.anotar(accion='confirmacion', args={'si': bool(si)})
        # El sí deja permiso para UNA operación de lo que se preguntó (a quién, cuánto, con el texto escrito ahora y
        # en esta página), de esta tarea y este dueño, en esta época y por PERMISO_VALE_S (AUR02).
        self.permiso = {'clases': clases_de(pregunta), 'destinos': destinos_de(pregunta), 'importes': importes_de(pregunta),
                        'texto': _huella(_normal(' '.join(self.escrito))), 'dominio': self.dominio, 'op': op,
                        'tarea': self.id, 'dueno': self.dueno, 'epoca': self.epoca, 'vence': time.time() + PERMISO_VALE_S,
                        'pregunta_id': pid, 'estado': 'libre'} if si else None
        return bool(si)

    def resumen(self, con_miniaturas=False):
        pasos = self.pasos if con_miniaturas else [{k: v for k, v in p.items() if k != 'miniatura'} for p in self.pasos]
        with self.cambio:
            parada, traspaso = self._copia_parada(self.parada), dict(self.traspaso) if self.traspaso else None
        return {'id': self.id, 'motor': self.motor, 'instruccion': self.instruccion, 'estado': self.estado_visible(), 'pasos': pasos,
                'respuesta': self.respuesta, 'error': self.error, 'segundos': round(time.time() - self.creada, 1),
                'archivos': self.archivos, 'archivos_error': self.archivos_error,
                'pregunta': self.pregunta, 'pregunta_id': self.pregunta_id, 'propuesta': self.propuesta,
                'en_espera': self.en_espera, 'epoca': self.epoca, 'parada': parada, 'traspaso': traspaso,
                'seguro': self.seguro, 'control_cliente': bool(self.lease and self.lease.get('cliente'))}


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
        with t.cambio:
            if t.estado in ESTADOS_VIVOS:  # si la pararon mientras se preparaba, sigue parada (no se reabre)
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
                    return terminar_hecha(t, str(args.get('content', '')))
                if nombre == 'ask_user_confirmation':
                    si = t.pedir_confirmacion(args.get('question', ''))
                    if si is None:
                        return t.cerrar('parada')
                    mensajes.append({'role': 'tool', 'tool_call_id': llamada.id, 'content': SI_DIJO if si else NO_DIJO})
                    continue
                # Pagar o comprar, nunca; lo sensible, con su sí (aunque el modelo no lo haya preguntado), ligado a
                # la operación exacta y canjeado en el efecto (AUR02).
                resultado = revisar_accion(t, nombre, args)
                sensible, t.por_hacer = t.por_hacer, None
                hecho = incierto = False
                if resultado is None:
                    resultado, hecho = efecto_modelo(t, epoca, lambda: ejecutar(nombre, args, ancho, alto), nombre, sensible)
                    incierto = not hecho and (t.ultima_op or {}).get('estado') == 'incierta'
                    if hecho:
                        t.tras_efecto(nombre, args, sensible is not None)
                        asentar(nombre, args)
                t.resultado_paso(paso, hecho, incierto)
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
    # Sigue una misión (`desde_tarea`: su primera tarea, del MISMO dueño): lo guardado en la vuelta anterior también es
    # de esta misión. De otro dueño o ya olvidada: cuenta desde esta tarea.
    anterior = TAREAS.get(str(cuerpo.get('desde_tarea') or '')[:40])
    if anterior and anterior.dueno == dueno:
        t.desde = min(t.creada, anterior.desde)
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


def detener(t, tope=None):
    """Parar en tres estados (AUR03): se recibe y se cerca (fenced: ningún despacho nuevo con esta autoridad, en
    todos los motores y en lo de la persona: efecto_modelo y accion_persona miran `parar` en el mismo candado en
    que despachan); si un toque ya salió, draining hasta que termine; quiescent cuando nada queda en vuelo bajo la
    época revocada, y solo entonces la tarea queda «parada». Espera como mucho `tope`; si no alcanzó, contesta
    draining con el id para consultar (GET /tareas/{id}/parada/{pid}) y se completa sola al terminar el toque. Lo
    ya despachado queda con su recibo (hecha o incierta), no se da por deshecho. Repetir parar devuelve la misma."""
    tope = ESPERA_QUIETUD_S if tope is None else tope
    with t.cambio:
        if t.parada is None:
            t.avisar(parar=True)  # despierta también a la que espera una pausa o un sí; sube la época
            t.parada = {'id': uuid.uuid4().hex[:12], 'fase': 'fenced', 'epoca': t.epoca, 'recibida': time.time(),
                        'en_vuelo': t.en_vuelo}
            if t._vuelo_viejo(t.parada['epoca']):
                t.parada['fase'] = 'draining'
        listo = t._aguardar(lambda: t._vuelo_viejo(t.parada['epoca']), tope)
    if listo:
        t._completar()
    with t.cambio:
        return {'estado': t.estado_visible(), 'parada': t._copia_parada(t.parada)}


@app.post('/tareas/{id}/parar')
def parar(id: str, req: Request):
    t = tarea(req, id)
    return {'id': id, **detener(t)}


@app.get('/tareas/{id}/parada/{pid}')
def ver_parada(id: str, pid: str, req: Request):
    """Cómo va una parada que contestó draining (y el recibo del toque que estaba en vuelo)."""
    t = tarea(req, id)
    with t.cambio:
        if not t.parada or t.parada['id'] != pid:
            raise HTTPException(404, 'no existe esa parada')
        return t._copia_parada(t.parada)


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
    # El ACK sale cuando ningún toque de antes de la pausa está en vuelo (lo que ya empezó terminó y quedó en los
    # pasos), o dice draining pasado el tope.
    with t.cambio:
        if t.control:
            # Con la persona al mando el agente ya está quieto: pausar no cambia nada (ni la época de su control).
            return {'id': id, 'estado': t.estado_visible(), 'en_espera': t.en_espera, 'quieta': True,
                    'fase': 'quiescent', 'epoca': t.epoca}
        t.avisar(pausa=True)
        epoca = t.epoca
        quieta = t._aguardar(lambda: t._vuelo_viejo(epoca), ESPERA_QUIETUD_S)
        return {'id': id, 'estado': t.estado_visible(), 'en_espera': t.en_espera, 'quieta': quieta,
                'fase': 'quiescent' if quieta else 'draining', 'epoca': t.epoca}


@app.post('/tareas/{id}/reanudar')
def reanudar(id: str, req: Request):
    t = viva(tarea(req, id))
    if t.seguro:
        raise HTTPException(409, 'seguro: primero termina la entrada segura (con una pantalla nueva)')
    if t.control:
        # «Sigue» con la persona al mando es devolver el control: por el traspaso (se vacía la cola de la persona, se
        # sueltan teclas y el modelo recibe otra época), no saltándoselo.
        r = cambiar_control(t, False)
        return {'id': id, 'estado': r['estado'], 'fase': r['fase']}
    t.avisar(pausa=False, control=False)
    return {'id': id, 'estado': t.estado_visible()}


@app.post('/tareas/{id}/confirmar')
async def confirmar(id: str, req: Request):
    t = viva(tarea(req, id))
    cuerpo = await cuerpo_de(req)
    si = bool(cuerpo.get('si'))
    if not t.pregunta:
        raise HTTPException(409, 'no está esperando ningún sí')
    # El sí lleva la pregunta que contesta y la propuesta que se le mostró: una respuesta vieja, de otra propuesta o sin
    # decir a cuál (pregunta o propuesta) no contesta la de ahora. El no, con la pregunta basta.
    if not t.contestar(str(cuerpo.get('pregunta_id') or ''), si, str(cuerpo.get('propuesta') or '') or None):
        raise HTTPException(409, 'esa respuesta era para otra pregunta; mira la de ahora')
    return {'id': id, 'si': si}


def _lease_nuevo(cliente, epoca):
    """El control de la persona ligado a un cliente y una época (AUR09). La secuencia empieza de cero en cada lease."""
    return {'cliente': cliente, 'epoca': epoca, 'ultima': 0, 'acks': {}, 'cubeta': float(ENTRADAS_RAFAGA),
            'cubeta_en': time.time()}


def cambiar_control(t, tomar, cliente=None, epoca_esperada=None):
    """La persona toma o devuelve el escritorio (transferencia exclusiva, AUR03). Primero se cerca al que lo tenía:
    tomar sube la época (el modelo ya no despacha nada) y devolver deja de aceptar lo que la persona mande. Después
    se espera, con tope, a que termine el toque que ya estaba en vuelo (el del modelo al tomar; escribir o un clic
    de la persona al devolver), se sueltan teclas y puntero y, al devolver, se pasa el control al modelo con otra
    época. «fase»: quiescent (ya es verdad) o draining (termina sola en cuanto acabe ese toque; nadie toca a la vez).

    AUR09: con `cliente` el control queda ligado a ESE cliente (lease, con su época): solo él manda entradas
    (/entrada). Si otro cliente (otro teléfono, otra sesión de la misma persona) lo toma, se abre otra época, lo que
    el anterior tenía en vuelo termina, se sueltan teclas y el anterior queda cercado. Devolver lo hace quien lo tiene
    (o la persona sin decir cliente: la voz, la app de antes); en entrada segura, no (primero se sale con una pantalla
    nueva). `epoca_esperada` (expectedControlEpoch): si el control ya cambió, 409 y nada cambia."""
    with t.cambio:
        if t.pregunta:
            raise HTTPException(409, 'primero contesta si lo hace o no')
        if epoca_esperada is not None and epoca_esperada != t.epoca:
            raise HTTPException(409, f'epoca_cambio: el control cambió (época {t.epoca}); mira el de ahora')
        actual = t.lease['cliente'] if t.lease else None
        if tomar and not t.control:
            t.avisar(control=True, pausa=False)
            t.lease = _lease_nuevo(cliente, t.epoca)
            t.traspaso = {'id': uuid.uuid4().hex[:12], 'a': 'persona', 'fase': 'draining', 'epoca': t.epoca, 'desde': time.time()}
        elif tomar and (t.lease is None or actual != cliente):
            # Otro cliente recupera el control (o el que lo devolvía era otro): otra época; el anterior queda cercado.
            t.devolviendo = False
            t.epoca += 1
            t.lease = _lease_nuevo(cliente, t.epoca)
            t.traspaso = {'id': uuid.uuid4().hex[:12], 'a': 'persona', 'fase': 'draining', 'epoca': t.epoca, 'desde': time.time()}
            t.cambio.notify_all()
        elif tomar and t.devolviendo:
            # Lo devolvía y se arrepintió antes de que terminara su último toque: sigue siendo suyo.
            t.devolviendo = False
            t.traspaso = {'id': uuid.uuid4().hex[:12], 'a': 'persona', 'fase': 'quiescent', 'epoca': t.epoca, 'desde': time.time()}
        elif not tomar and t.control and not t.devolviendo:
            if t.seguro:
                raise HTTPException(409, 'seguro: primero termina la entrada segura (con una pantalla nueva)')
            if cliente is not None and actual is not None and cliente != actual:
                raise HTTPException(409, 'cliente: el control lo tiene otro dispositivo')
            t.devolviendo = True
            # La época que tendrá el modelo: lo que la persona despachó antes es de la autoridad que se revoca.
            t.traspaso = {'id': uuid.uuid4().hex[:12], 'a': 'agente', 'fase': 'draining', 'epoca': t.epoca + 1, 'desde': time.time()}
        tr = t.traspaso
        listo = (not tr or tr['fase'] == 'quiescent'
                 or t._aguardar(lambda: t._vuelo_viejo(tr['epoca']), ESPERA_QUIETUD_S))
    if listo and tr:
        t._completar()
    with t.cambio:
        return {'estado': t.estado_visible(), 'en_espera': t.en_espera, 'epoca': t.epoca,
                'fase': tr['fase'] if tr else 'quiescent', 'traspaso': tr['id'] if tr else None, 'seguro': t.seguro}


CLIENTE = re.compile(r'[A-Za-z0-9_-]{8,64}')


def cliente_de(cuerpo):
    """El cliente que manda (el servidor de AU-RA lo deriva de la sesión autenticada); None si no viene o no vale."""
    c = cuerpo.get('clientId')
    return c if isinstance(c, str) and CLIENTE.fullmatch(c) else None


@app.post('/tareas/{id}/control')
async def control(id: str, req: Request):
    t = viva(tarea(req, id))
    cuerpo = await cuerpo_de(req)
    tomar = bool(cuerpo.get('tomar'))
    esperada = cuerpo.get('expectedControlEpoch')
    esperada = esperada if isinstance(esperada, int) and not isinstance(esperada, bool) else None
    r = await asyncio.get_running_loop().run_in_executor(None, lambda: cambiar_control(t, tomar, cliente_de(cuerpo), esperada))
    return {'id': id, **r}


TECLAS_PERSONA = {'enter', 'tab', 'escape', 'backspace', 'delete', 'up', 'down', 'left', 'right', 'pageup', 'pagedown',
                  'home', 'end', 'space', 'ctrl+l', 'ctrl+a', 'ctrl+c', 'ctrl+v', 'ctrl+f', 'alt+left', 'alt+right', 'f5'}


def accion_persona(t, cuerpo, epoca=None):
    """Lo que hace la persona con el control: tocar, escribir, una tecla o bajar. Coordenadas en [0, 1000].
    Lo que escribe no se guarda en los pasos (puede ser su contraseña: para eso tomó el control). `epoca`: la del
    control cuando llegó el pedido; si mientras esperaba en la cola devolvió o volvió a tomar el control, no entra."""
    tipo = str(cuerpo.get('tipo') or '')
    ancho, alto = TAMANO['ancho'], TAMANO['alto']

    def coord(k):
        try:
            return max(0, min(1000, int(cuerpo.get(k) or 0)))
        except (TypeError, ValueError):
            raise HTTPException(400, 'coordenadas en [0, 1000]')

    if t.devolviendo:
        raise HTTPException(409, 'ya devolviste el control')
    # Con el control ligado a un cliente (AUR09) solo entra lo de /entrada, con su época y su secuencia: la acción de
    # antes no se salta el árbitro.
    if t.lease and t.lease.get('cliente'):
        raise HTTPException(409, 'cliente: el control lo tiene un dispositivo con el visor nuevo')
    # Se revisa otra vez justo antes de tocar, con el escritorio tomado y en el mismo paso en que sale (atómico con
    # parar y devolver): la acción pudo esperar en la cola y, mientras, pararon la tarea, devolvió el control o el
    # escritorio cambió de dueño.
    with ESCRITORIO_LOCK:
        with t.cambio:
            if (t.parar or not t.control or t.devolviendo or REINICIANDO['v'] or DUENO_ACTUAL['v'] != t.dueno
                    or (epoca is not None and epoca != t.epoca) or (t.lease and t.lease.get('cliente'))):
                raise HTTPException(409, 'la tarea ya no tiene el escritorio')
            op = t.abrir_op('persona', tipo, t.epoca)
        estado = 'incierta'
        try:
            paso = _accion_persona(t, cuerpo, tipo, ancho, alto, coord)
            estado = 'hecha'
        except HTTPException:
            estado = 'no_hecha'
            raise
        finally:
            t.cerrar_op(op, estado)
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
    if tipo in ('escribir', 'tecla'):
        t.escrito.append('<persona>')  # escribió ella (no se guarda qué): un sí anterior ya no cubre el texto
    t.persona_actuo = True
    t.anotar(accion='persona', args=paso)
    return paso


# ------------------------------------------------------------------ el contrato de entradas (AUR09)

TIPOS_ENTRADA = ('pointer', 'scroll', 'key', 'text_commit', 'release_all')
# Las teclas que no son texto (el texto va entero en text_commit, ya compuesto por el teclado del teléfono).
TECLAS_ESPECIALES = {'enter': 'Return', 'tab': 'Tab', 'escape': 'Escape', 'backspace': 'BackSpace', 'delete': 'Delete',
                     'up': 'Up', 'down': 'Down', 'left': 'Left', 'right': 'Right', 'home': 'Home', 'end': 'End',
                     'pageup': 'Prior', 'pagedown': 'Next', 'space': 'space', 'f5': 'F5'}
NAVEGACION = frozenset({'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown'})
# Ctrl + letra: seleccionar todo, copiar, pegar, cortar, deshacer, rehacer, buscar, barra de direcciones, recargar,
# pestaña nueva y cerrar pestaña. Nada que salga del navegador (sin Super, sin Ctrl+Alt, sin Alt+F4, sin Ctrl+Q).
LETRAS_CTRL = frozenset('acvxzyflrtw')
MODS = ('ctrl', 'shift', 'alt')  # el orden con que se combinan


def combo_permitido(mods, tecla):
    """La lista blanca de teclas y combinaciones de la persona (la misma en el servidor y en la app)."""
    m = frozenset(mods)
    if not m <= set(MODS):
        return False
    if not m:
        return tecla in TECLAS_ESPECIALES
    if m == {'shift'}:
        return tecla in NAVEGACION | {'tab', 'enter'}
    if m == {'ctrl'}:
        return tecla in LETRAS_CTRL or tecla in NAVEGACION | {'backspace', 'delete', 'enter', 'tab'}
    if m == {'ctrl', 'shift'}:
        return tecla in NAVEGACION | {'z', 't', 'tab'}
    if m == {'alt'}:
        return tecla in ('left', 'right')
    return False


def _entero(v, lo, hi):
    if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
        raise ValueError('número fuera de rango')
    return v


def _mods(v, permitidos):
    if v is None:
        return []
    if not isinstance(v, list) or len(v) > 3 or any(m not in permitidos for m in v):
        raise ValueError('modificadores')
    return [m for m in MODS if m in v]


def validar_entrada(c, id):
    """Una entrada del contrato (AUR09): de esta sesión remota (la tarea), de un cliente, con la época del control,
    su secuencia, la revisión del viewport con que se miró y un tipo con sus datos validados y acotados. 400 si no."""
    try:
        if not isinstance(c, dict) or str(c.get('remoteSessionId') or '') != id:
            raise ValueError('sesión')
        cliente = c.get('clientId')
        if not isinstance(cliente, str) or not CLIENTE.fullmatch(cliente):
            raise ValueError('cliente')
        epoca = _entero(c.get('controlEpoch'), 0, 10 ** 9)
        secuencia = _entero(c.get('inputSequence'), 1, 10 ** 12)
        rev = _entero(c.get('viewportRevision'), 0, 10 ** 9)
        tipo = c.get('type')
        p = c.get('payload') if isinstance(c.get('payload'), dict) else {}
        xy = lambda k: _entero(p.get(k), 0, 8192)  # noqa: E731 (píxeles lógicos; el tamaño real se mira al tocar)
        if tipo == 'pointer':
            accion = p.get('accion', 'click')
            if accion not in ('click', 'doble', 'derecho', 'arrastre'):
                raise ValueError('accion')
            datos = {'accion': accion, 'x': xy('x'), 'y': xy('y'), 'mods': _mods(p.get('mods'), ('ctrl', 'shift'))}
            if accion == 'arrastre':
                datos.update(x2=xy('x2'), y2=xy('y2'))
        elif tipo == 'scroll':
            datos = {'x': xy('x'), 'y': xy('y'), 'dy': _entero(p.get('dy', 0), -10, 10), 'dx': _entero(p.get('dx', 0), -10, 10)}
            if not datos['dy'] and not datos['dx']:
                raise ValueError('scroll vacío')
        elif tipo == 'key':
            tecla = str(p.get('tecla') or '').lower()
            mods = _mods(p.get('mods'), MODS)
            if not combo_permitido(mods, tecla):
                raise ValueError('esa tecla no')
            datos = {'tecla': tecla, 'mods': mods}
        elif tipo == 'text_commit':
            texto = p.get('texto')
            if not isinstance(texto, str):
                raise ValueError('texto')
            # La composición final del teclado (IME): acentos compuestos (e + ´ = é), sin controles ni saltos (Enter
            # es una tecla), hasta 500.
            texto = unicodedata.normalize('NFC', texto)
            if not 1 <= len(texto) <= 500 or re.search(r'[\x00-\x1f\x7f]', texto):
                raise ValueError('texto')
            datos = {'texto': texto}
        elif tipo == 'release_all':
            datos = {}
        else:
            raise ValueError('tipo')
    except (ValueError, TypeError) as e:
        raise HTTPException(400, f'entrada_invalida: {e}')
    return {'cliente': cliente, 'epoca': epoca, 'secuencia': secuencia, 'rev': rev, 'tipo': tipo, 'datos': datos}


ACKS_GUARDADOS = 64


def aplicar_entrada(t, e):
    """Una entrada de la persona, por el árbitro (AUR09): solo del cliente que tiene el control, en su época, con una
    secuencia nueva (la repetida devuelve el MISMO ACK sin tocar otra vez: tras reconectar nada se reproduce; la vieja,
    409), con el ritmo acotado y, si lleva coordenadas, del viewport que se está mostrando. Se revisa otra vez con el
    escritorio tomado, en el mismo paso en que sale (atómico con parar, tomar y devolver). Un error a medias suelta
    teclas y botones y queda «incierta». Devuelve el ACK: secuencia, estado, hora del nodo y el frame de antes del toque
    (`frame_seq`: la app espera uno más nuevo antes de otra entrada riesgosa)."""
    with t.cambio:
        L = t.lease
        if not t.control or t.devolviendo or L is None:
            raise HTTPException(409, 'sin_control: primero toma el control')
        if L['cliente'] != e['cliente']:
            raise HTTPException(409, 'cliente: el control lo tiene otro dispositivo')
        if e['epoca'] != t.epoca or L['epoca'] != t.epoca:
            raise HTTPException(409, f'epoca_revocada: el control cambió (época {t.epoca})')
        previo = L['acks'].get(e['secuencia'])
        if previo is not None:
            return dict(previo, duplicada=True)
        if e['secuencia'] <= L['ultima']:
            raise HTTPException(409, 'secuencia_vieja: esa entrada ya pasó')
        if not t.en_espera and e['tipo'] != 'release_all':
            raise HTTPException(409, 'aun_no: un momento: está terminando su último paso')
        ahora = time.time()
        L['cubeta'] = min(float(ENTRADAS_RAFAGA), L['cubeta'] + (ahora - L['cubeta_en']) * ENTRADAS_POR_S)
        L['cubeta_en'] = ahora
        if L['cubeta'] < 1:
            raise HTTPException(429, 'tasa: demasiadas entradas seguidas')
        L['cubeta'] -= 1
        # La secuencia se gasta antes de tocar: un repetido que llega mientras esta corre no entra dos veces.
        L['ultima'] = e['secuencia']
    if e['tipo'] == 'release_all' and not t.en_espera:
        return _ack(t, L, e)  # el agente todavía termina su toque: al tomar el control ya se sueltan
    with ESCRITORIO_LOCK:
        with t.cambio:
            if t.parar or not t.control or t.devolviendo or REINICIANDO['v'] or DUENO_ACTUAL['v'] != t.dueno:
                raise HTTPException(409, 'sin_control: la tarea ya no tiene el escritorio')
            if t.lease is not L or t.epoca != e['epoca']:
                raise HTTPException(409, f'epoca_revocada: el control cambió (época {t.epoca})')
            if e['tipo'] in ('pointer', 'scroll'):
                d = e['datos']
                fuera = any(d[k] >= FRAME['ancho'] for k in ('x', 'x2') if k in d) or any(d[k] >= FRAME['alto'] for k in ('y', 'y2') if k in d)
                if (e['rev'] != FRAME['rev'] or (TAMANO['ancho'], TAMANO['alto']) != (FRAME['ancho'], FRAME['alto']) or fuera):
                    raise HTTPException(409, f'viewport: esas coordenadas son de otra pantalla (revisión {FRAME["rev"]})')
            op = t.abrir_op('persona', e['tipo'], t.epoca)
        estado = 'incierta'
        try:
            _entrada_persona(t, e)
            estado = 'hecha'
        except HTTPException:
            estado = 'no_hecha'
            raise
        except Exception:
            soltar_entradas()  # nada queda pulsado tras un error a medias
            raise HTTPException(502, 'incierta: no sé si se hizo; mira la pantalla antes de seguir')
        finally:
            t.cerrar_op(op, estado)
    return _ack(t, L, e)


def _ack(t, L, e):
    with t.cambio:
        ack = {'secuencia': e['secuencia'], 'estado': 'hecha', 'ts': round(time.time(), 3), 'frame_seq': FRAME['seq'],
               'epoca': t.epoca}
        L['acks'][e['secuencia']] = ack
        for viejo in sorted(L['acks'])[:-ACKS_GUARDADOS]:
            L['acks'].pop(viejo, None)
        return dict(ack)


def _entrada_persona(t, e):
    """Lo que hace la entrada en el escritorio (con el escritorio tomado). Las combinaciones salen enteras en una sola
    orden (ninguna tecla queda pulsada entre una entrada y la siguiente). En entrada segura no se anota nada."""
    d, tipo = e['datos'], e['tipo']
    if tipo == 'pointer':
        boton = '3' if d['accion'] == 'derecho' else '1'
        if d['accion'] == 'arrastre':
            # Bajar, moverse en dos tramos (las páginas necesitan ver el movimiento) y soltar, en una sola orden.
            mx, my = (d['x'] + d['x2']) // 2, (d['y'] + d['y2']) // 2
            xdotool('mousemove', '--sync', d['x'], d['y'], 'mousedown', '1', 'sleep', '0.08', 'mousemove', '--sync', mx, my,
                    'sleep', '0.05', 'mousemove', '--sync', d['x2'], d['y2'], 'sleep', '0.05', 'mouseup', '1')
        else:
            clic = ['click', '--repeat', '2', '--delay', '120', boton] if d['accion'] == 'doble' else ['click', boton]
            abajo = [x for m in d['mods'] for x in ('keydown', m)]
            arriba = [x for m in reversed(d['mods']) for x in ('keyup', m)]
            xdotool('mousemove', '--sync', d['x'], d['y'], *abajo, *clic, *arriba)
    elif tipo == 'scroll':
        args = ['mousemove', '--sync', d['x'], d['y']]
        if d['dy']:
            args += ['click', '--repeat', abs(d['dy']), '5' if d['dy'] > 0 else '4']
        if d['dx']:
            args += ['click', '--repeat', abs(d['dx']), '7' if d['dx'] > 0 else '6']
        xdotool(*args)
    elif tipo == 'key':
        xdotool('key', '--clearmodifiers', '+'.join(d['mods'] + [TECLAS_ESPECIALES.get(d['tecla'], d['tecla'])]))
    elif tipo == 'text_commit':
        # xdotool type con --delay: algunos campos pierden letras si se escribe de golpe.
        xdotool('type', '--delay', '12', '--', d['texto'])
    elif tipo == 'release_all':
        soltar_entradas()
        return
    if tipo in ('key', 'text_commit'):
        t.escrito.append('<persona>')  # escribió ella (no se guarda qué): un sí anterior ya no cubre el texto
    t.persona_actuo = True
    if t.seguro:
        # Lo de la entrada segura no se anota (ni el largo); para salir hace falta un frame de después de esto.
        t.seguro_frame = FRAME['seq']
        return
    resumen = {'tipo': 'texto' if tipo == 'text_commit' else tipo}
    if tipo == 'pointer':
        resumen['accion'] = d['accion']
    elif tipo == 'key':
        resumen['teclas'] = '+'.join(d['mods'] + [d['tecla']])
    t.anotar(accion='persona', args=resumen)


def cambiar_seguro(t, activar, cliente=None, frame_seq=None):
    """Entrada segura (AUR09): solo con el control en manos de ESTE cliente. Mientras dura, el agente no toca (tiene
    el control la persona) ni mira (esperar_si_pausada no lo deja pasar a la captura; las capturas de los pasos se
    saltan), lo que escribe la persona no se anota y su pantalla sale marcada privada (no se guarda). Salir pide un
    frame visto DESPUÉS de lo último que escribió (frame_seq mayor que seguro_frame): la persona mira la pantalla de
    ahora antes de soltarla. Seguir con el agente es aparte: devolver el control a propósito."""
    with t.cambio:
        actual = t.lease['cliente'] if t.lease else None
        if activar:
            if not t.control or t.devolviendo:
                raise HTTPException(409, 'sin_control: primero toma el control')
            if cliente is None or actual != cliente:
                raise HTTPException(409, 'cliente: la entrada segura es del dispositivo que tiene el control')
            if not t.seguro:
                t.seguro = True
                t.seguro_frame = FRAME['seq']
                t.anotar(accion='modo_seguro', args={'activo': True})
        elif t.seguro:
            if cliente is not None and actual is not None and cliente != actual:
                raise HTTPException(409, 'cliente: el control lo tiene otro dispositivo')
            try:
                visto = int(frame_seq)
            except (TypeError, ValueError):
                visto = -1
            if visto <= t.seguro_frame or visto > FRAME['seq']:
                raise HTTPException(409, 'frame_viejo: mira la pantalla de ahora antes de terminar la entrada segura')
            t.seguro = False
            t.notas.append(NOTA_SEGURO)
            t.anotar(accion='modo_seguro', args={'activo': False})
        t.cambio.notify_all()
        return {'seguro': t.seguro, 'epoca': t.epoca, 'frame_seq': FRAME['seq']}


@app.post('/tareas/{id}/entrada')
async def entrada(id: str, req: Request):
    t = viva(tarea(req, id))
    e = validar_entrada(await cuerpo_de(req), id)
    ack = await asyncio.get_running_loop().run_in_executor(None, lambda: aplicar_entrada(t, e))
    return {'id': id, 'ack': ack}


@app.post('/tareas/{id}/seguro')
async def seguro(id: str, req: Request):
    t = viva(tarea(req, id))
    cuerpo = await cuerpo_de(req)
    return {'id': id, **cambiar_seguro(t, bool(cuerpo.get('activar')), cliente_de(cuerpo), cuerpo.get('frameSeq'))}


@app.post('/tareas/{id}/accion')
async def accion(id: str, req: Request):
    t = viva(tarea(req, id))
    cuerpo = await cuerpo_de(req)
    if not t.control:
        raise HTTPException(409, 'primero toma el control')
    if not t.en_espera:
        raise HTTPException(409, 'un momento: está terminando su último paso')
    epoca = t.epoca
    paso = await asyncio.get_running_loop().run_in_executor(None, lambda: accion_persona(t, cuerpo, epoca))
    return {'ok': True, 'paso': paso}


@app.get('/tareas/{id}/pantalla')
def pantalla_tarea(id: str, req: Request, ancho: int = 960):
    """Lo que se ve ahora, solo mientras ESA tarea tiene el escritorio (nadie mira el de otro dueño). Con su frame
    (AUR09) en cabeceras: secuencia, hora del nodo, tamaño lógico (el de las coordenadas), revisión del viewport, la
    época del control y si es privado (entrada segura: no se guarda ni va al modelo). `ancho`: el de la imagen
    (480–1280; con zoom, más nítida)."""
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
        png, w, h = captura()
        meta = anotar_frame(w, h)
        privado = t.seguro
    finally:
        ESCRITORIO_LOCK.release()
    jpg = base64.b64decode(miniatura(png, max(480, min(1280, int(ancho or 960)))))
    return Response(jpg, media_type='image/jpeg', headers={
        'Cache-Control': 'no-store', 'X-Frame-Seq': str(meta['seq']), 'X-Frame-Ts': f"{meta['ts']:.3f}",
        'X-Frame-Ancho': str(meta['ancho']), 'X-Frame-Alto': str(meta['alto']), 'X-Viewport-Rev': str(meta['rev']),
        'X-Control-Epoca': str(t.epoca), 'X-Privado': '1' if privado else '0'})


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
                yield f'event: estado\ndata: {json.dumps({"estado": visto, "pregunta": t.pregunta, "pregunta_id": t.pregunta_id, "propuesta": t.propuesta}, ensure_ascii=False)}\n\n'
            await asyncio.get_running_loop().run_in_executor(None, lambda: _esperar(t, enviados, visto))

    return StreamingResponse(flujo(), media_type='text/event-stream', headers={'Cache-Control': 'no-cache'})


def _esperar(t, enviados, visto=None):
    with t.cambio:
        if len(t.pasos) == enviados and t.estado in ESTADOS_VIVOS and t.estado_visible() == visto:
            t.cambio.wait(15)


@app.get('/pantalla')
def pantalla(req: Request):
    exigir(req)
    # Durante una entrada segura nadie más que la persona (por su tarea) ve la pantalla (AUR09).
    if any(t.seguro for t in list(TAREAS.values())):
        raise HTTPException(423, 'seguro: hay una entrada segura en curso')
    png, _, _ = captura()
    return Response(png, media_type='image/png', headers={'Cache-Control': 'no-store'})


# La vista noVNC está CERRADA (AUR09): con view_only=0 aceptaba clics y teclas por fuera del árbitro (épocas, candado
# del escritorio, entrada segura), y view_only es solo una opción del cliente. La persona ve y usa el escritorio por
# /tareas/{id}/pantalla y /tareas/{id}/entrada. Queda el diccionario para que una llave vieja tampoco abra nada.
VISTAS = {}


@app.post('/vista')
async def vista(req: Request):
    exigir(req)
    raise HTTPException(410, 'la vista noVNC está cerrada: usa la pantalla de la tarea (con el control y la entrada segura)')


@app.get('/vista/permitir')
def permitir(req: Request):
    """El forward_auth de Caddy (si alguien vuelve a publicar /vista): nunca deja pasar."""
    return JSONResponse({'error': 'vista cerrada'}, status_code=403)
