"""Pruebas del servicio de tareas (agente.py) sin escritorio, sin GPU y sin FastAPI instalado.

    python3 -m unittest scripts/nodo-computadora/test_agente.py

Se reemplazan fastapi, openai, httpx y PIL por módulos de mentira (lo que se prueba es la lógica: pausa,
control de la persona, el sí antes de algo sensible, nunca pagar, y el ciclo del motor gratis con eso).
"""
import os
import sys
import threading
import time
import types
import unittest


def _modulos_de_mentira():
    fastapi = types.ModuleType('fastapi')

    class HTTPException(Exception):
        def __init__(self, status_code, detail=''):
            super().__init__(detail)
            self.status_code, self.detail = status_code, detail

    class FastAPI:
        def _deco(self, *_a, **_k):
            return lambda f: f
        get = post = _deco

    fastapi.FastAPI, fastapi.HTTPException, fastapi.Request = FastAPI, HTTPException, object
    respuestas = types.ModuleType('fastapi.responses')
    for nombre in ('JSONResponse', 'Response', 'StreamingResponse'):
        setattr(respuestas, nombre, type(nombre, (), {'__init__': lambda self, *a, **k: None}))
    openai = types.ModuleType('openai')
    openai.OpenAI = lambda **_k: types.SimpleNamespace()
    pil = types.ModuleType('PIL')
    pil.Image = types.SimpleNamespace()
    sys.modules.update({'fastapi': fastapi, 'fastapi.responses': respuestas, 'openai': openai,
                        'httpx': types.ModuleType('httpx'), 'PIL': pil})


_modulos_de_mentira()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import agente  # noqa: E402


def contestar_cuando_pregunte(t, si, espera=3.0):
    """En otro hilo: cuando la tarea pida el sí, contesta como la persona desde la app."""
    def hilo():
        fin = time.time() + espera
        while time.time() < fin:
            if t.estado_visible() == 'confirmar':
                t.avisar(si=si)
                return
            time.sleep(0.01)
    h = threading.Thread(target=hilo, daemon=True)
    h.start()
    return h


class Base(unittest.TestCase):
    def setUp(self):
        self.antes = (agente.ESPERA_CONFIRMACION_S, agente.PAUSA_MAX_S)
        self.hechas = []
        self.ejecutar_real = agente.ejecutar
        agente.ejecutar = lambda nombre, a, ancho, alto: self.hechas.append((nombre, dict(a))) or 'Done.'

    def tearDown(self):
        agente.ESPERA_CONFIRMACION_S, agente.PAUSA_MAX_S = self.antes
        agente.ejecutar = self.ejecutar_real

    def tarea(self, instruccion='Entra a sar.gob.hn y llena el formulario'):
        t = agente.Tarea(instruccion, 10)
        t.estado = 'trabajando'
        agente.DUENO_ACTUAL['v'] = t.dueno  # tiene el escritorio, como cuando corre
        return t


class RevisarAccion(Base):
    def test_pagar_o_comprar_nunca_y_sin_preguntar(self):
        t = self.tarea()
        for elemento in ('Pagar ahora', 'Botón «Comprar»', 'Add to cart', 'Place your order', 'Proceed to checkout'):
            self.assertEqual(agente.revisar_accion(t, 'click', {'element': elemento}), agente.NO_PAGO, elemento)
        self.assertEqual(agente.revisar_accion(t, 'type', {'text': '4111 1111 1111 1111'}), agente.NO_PAGO)
        self.assertEqual([p['accion'] for p in t.pasos], [], 'no se le pregunta: no se hace')

    def test_lo_normal_pasa_y_las_cookies_no_preguntan(self):
        t = self.tarea()
        self.assertIsNone(agente.revisar_accion(t, 'click', {'element': 'Enlace «Tipo de cambio»'}))
        self.assertIsNone(agente.revisar_accion(t, 'click', {'element': 'Aceptar cookies'}))
        self.assertIsNone(agente.revisar_accion(t, 'click', {'element': 'Accept all cookies and submit'}))
        self.assertIsNone(agente.revisar_accion(t, 'type', {'text': 'Francisco Morazán', 'press_enter': True}))
        self.assertIsNone(agente.revisar_accion(t, 'scroll', {'direction': 'down'}))

    def test_lo_sensible_pide_el_si(self):
        t = self.tarea()
        contestar_cuando_pregunte(t, True)
        self.assertIsNone(agente.revisar_accion(t, 'click', {'element': 'Botón Enviar formulario'}))
        self.assertEqual([p['accion'] for p in t.pasos], ['pedir_confirmacion', 'confirmacion'])
        self.assertEqual(t.pasos[0]['args']['pregunta'], 'Voy a tocar «Botón Enviar formulario». ¿Lo hago?')
        # El sí era para ESE toque: el siguiente sensible vuelve a preguntar (auditoría, 3-oct: antes un sí
        # abría tres pasos para cualquier cosa).
        contestar_cuando_pregunte(t, False)
        self.assertEqual(agente.revisar_accion(t, 'click', {'element': 'Enviar'}), agente.NO_DIJO)
        self.assertEqual([p['accion'] for p in t.pasos], ['pedir_confirmacion', 'confirmacion', 'pedir_confirmacion', 'confirmacion'])

    def test_el_si_del_modelo_vale_para_una_sola_accion(self):
        t = self.tarea()
        contestar_cuando_pregunte(t, True)
        self.assertTrue(t.pedir_confirmacion('¿Envío el formulario?'))
        self.assertIsNone(agente.revisar_accion(t, 'click', {'element': 'Enviar'}), 'la primera, con el sí que dio')
        contestar_cuando_pregunte(t, False)
        self.assertEqual(agente.revisar_accion(t, 'click', {'element': 'Publicar'}), agente.NO_DIJO, 'la segunda pregunta otra vez')

    def test_enter_sobre_algo_sensible_o_de_pago_no_se_salta_la_revision(self):
        t = self.tarea()
        self.assertIsNone(agente.revisar_accion(t, 'click', {'element': 'Campo de búsqueda'}))
        self.assertIsNone(agente.revisar_accion(t, 'key', {'keys': 'enter'}), 'Enter en una búsqueda: normal')
        self.assertEqual(agente.revisar_accion(t, 'click', {'element': 'Aceptar cookies y comprar ahora'}), agente.NO_PAGO, 'pagar se mira antes que las cookies')
        t.ultimo_elemento = 'Botón Comprar'
        self.assertEqual(agente.revisar_accion(t, 'key', {'keys': 'Return'}), agente.NO_PAGO)
        t.ultimo_elemento = 'Botón Enviar'
        contestar_cuando_pregunte(t, False)
        self.assertEqual(agente.revisar_accion(t, 'type', {'text': 'hola', 'press_enter': True}), agente.NO_DIJO)

    def test_un_no_no_se_hace(self):
        t = self.tarea('Go to example.com and tell me what is on the page')
        contestar_cuando_pregunte(t, False)
        self.assertEqual(agente.revisar_accion(t, 'click', {'element': 'Sign in'}), agente.NO_DIJO)
        self.assertEqual(t.pasos[0]['args']['pregunta'], 'I am about to click «Sign in». Should I?')
        self.assertEqual(t.pasos[-1]['args'], {'si': False})


class Confirmacion(Base):
    def test_espera_el_si_y_cuenta_la_pregunta(self):
        t = self.tarea()
        h = contestar_cuando_pregunte(t, True)
        self.assertTrue(t.pedir_confirmacion('¿Envío el formulario de la SAR?'))
        h.join(1)
        r = t.resumen()
        self.assertEqual(r['estado'], 'trabajando')
        self.assertIsNone(r['pregunta'])
        self.assertTrue(t.permiso_unico, 'el sí deja permiso para UNA acción sensible')

    def test_mientras_espera_se_ve_confirmar_con_la_pregunta(self):
        t = self.tarea()
        visto = {}

        def mirar():
            fin = time.time() + 2
            while time.time() < fin and t.estado_visible() != 'confirmar':
                time.sleep(0.01)
            visto.update(t.resumen())
            t.avisar(si=False)
        threading.Thread(target=mirar, daemon=True).start()
        self.assertFalse(t.pedir_confirmacion('¿Borro el archivo?'))
        self.assertEqual(visto['estado'], 'confirmar')
        self.assertEqual(visto['pregunta'], '¿Borro el archivo?')
        self.assertTrue(visto['en_espera'])

    def test_sin_respuesta_se_cierra_y_nada_sensible_se_hace(self):
        agente.ESPERA_CONFIRMACION_S = 0.2
        t = self.tarea()
        with self.assertRaises(agente.Detenida):
            t.pedir_confirmacion('¿Publico?')

    def test_detener_mientras_espera(self):
        t = self.tarea()
        threading.Timer(0.1, lambda: t.avisar(parar=True)).start()
        self.assertIsNone(t.pedir_confirmacion('¿Envío?'))


class PausaYControl(Base):
    def test_una_accion_a_mano_que_llega_tarde_no_toca_otro_escritorio(self):
        t = self.tarea()
        t.control = True
        agente.DUENO_ACTUAL['v'] = 'otra-persona'
        with self.assertRaises(agente.HTTPException):
            agente.accion_persona(t, {'tipo': 'click', 'x': 10, 'y': 10})
        agente.DUENO_ACTUAL['v'] = t.dueno
        t.parar = True
        with self.assertRaises(agente.HTTPException):
            agente.accion_persona(t, {'tipo': 'click', 'x': 10, 'y': 10})
        self.assertEqual(self.hechas, [], 'nada se tocó')

    def test_pausa_y_reanuda(self):
        t = self.tarea()
        t.avisar(pausa=True)
        self.assertEqual(t.estado_visible(), 'pausada')
        threading.Timer(0.1, lambda: t.avisar(pausa=False)).start()
        self.assertTrue(t.esperar_si_pausada())
        self.assertEqual(t.notas, [], 'una pausa sola no cambia nada en la pantalla')

    def test_control_de_la_persona_y_al_devolver_el_modelo_lo_sabe(self):
        t = self.tarea()
        t.avisar(control=True)
        self.assertEqual(t.estado_visible(), 'control')

        def persona():
            while not t.en_espera:
                time.sleep(0.01)
            agente.accion_persona(t, {'tipo': 'click', 'x': 1500, 'y': -3})
            agente.accion_persona(t, {'tipo': 'escribir', 'texto': 'mi-clave-secreta', 'enter': True})
            t.avisar(control=False)
        threading.Thread(target=persona, daemon=True).start()
        self.assertTrue(t.esperar_si_pausada())
        self.assertEqual(self.hechas[0], ('click', {'x': 1000, 'y': 0}))
        self.assertEqual(self.hechas[1], ('type', {'text': 'mi-clave-secreta', 'press_enter': True}))
        self.assertEqual([p['args'] for p in t.pasos], [{'tipo': 'click', 'x': 1000, 'y': 0}, {'tipo': 'escribir', 'letras': 16, 'enter': True}])
        self.assertNotIn('mi-clave-secreta', repr(t.resumen()), 'lo que escribe la persona no se guarda')
        self.assertEqual(t.notas, [agente.NOTA_CONTROL])

    def test_teclas_permitidas_y_tipos(self):
        t = self.tarea()
        t.control = True
        agente.accion_persona(t, {'tipo': 'tecla', 'teclas': 'Enter'})
        agente.accion_persona(t, {'tipo': 'scroll', 'direccion': 'up'})
        with self.assertRaises(agente.HTTPException):
            agente.accion_persona(t, {'tipo': 'tecla', 'teclas': 'ctrl+alt+delete'})
        with self.assertRaises(agente.HTTPException):
            agente.accion_persona(t, {'tipo': 'borrar_todo'})
        self.assertEqual([h[0] for h in self.hechas], ['key', 'scroll'])

    def test_detener_en_pausa_y_tope_de_pausa(self):
        t = self.tarea()
        t.avisar(pausa=True)
        threading.Timer(0.1, lambda: t.avisar(parar=True)).start()
        self.assertFalse(t.esperar_si_pausada())
        agente.PAUSA_MAX_S = 0.2
        t2 = self.tarea()
        t2.avisar(pausa=True)
        with self.assertRaises(agente.Detenida):
            t2.esperar_si_pausada()
        self.assertFalse(t2.en_espera)

    def test_una_terminada_no_se_toca(self):
        t = self.tarea()
        t.cerrar('hecha', respuesta='ok')
        with self.assertRaises(agente.HTTPException) as e:
            agente.viva(t)
        self.assertEqual(e.exception.status_code, 409)


class CicloGratis(Base):
    """El ciclo de Holo con un modelo de mentira que pide acciones en orden."""

    def correr_con(self, llamadas, instruccion='Entra a sar.gob.hn, llena el formulario y envíalo'):
        respuestas = iter(llamadas)
        vistos = []

        def crear(**k):
            vistos.append([dict(m) for m in k['messages']])
            nombre, args = next(respuestas)
            llamada = types.SimpleNamespace(id=f'c{len(vistos)}', function=types.SimpleNamespace(name=nombre, arguments=__import__('json').dumps(args)),
                                            model_dump=lambda: {})
            msg = types.SimpleNamespace(content='', tool_calls=[llamada], reasoning='')
            return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)])

        agente.cliente = types.SimpleNamespace(chat=types.SimpleNamespace(completions=types.SimpleNamespace(create=crear)))
        agente.captura = lambda: (b'png', 1280, 800)
        agente.miniatura = lambda png, ancho=480: 'MINI'
        agente.DUENO_ACTUAL['v'] = 'yo'
        t = agente.Tarea(instruccion, 10, 'holo', 'yo')
        return t, vistos

    def test_pide_el_si_antes_de_enviar_y_nunca_paga(self):
        t, vistos = self.correr_con([
            ('open_url', {'url': 'sar.gob.hn'}),
            ('click', {'element': 'Pagar ahora', 'x': 10, 'y': 10}),
            ('click', {'element': 'Botón Enviar', 'x': 500, 'y': 700}),
            ('answer', {'content': 'Listo: envié el formulario. https://sar.gob.hn/ok'}),
        ])
        contestar_cuando_pregunte(t, True)
        agente.correr(t)
        self.assertEqual(t.estado, 'hecha')
        self.assertEqual([h[0] for h in self.hechas], ['open_url', 'click'], 'el pago no se hizo; el envío sí, con su sí')
        self.assertEqual(self.hechas[1][1]['element'], 'Botón Enviar')
        acciones = [p['accion'] for p in t.pasos]
        self.assertEqual(acciones, ['open_url', 'click', 'click', 'pedir_confirmacion', 'confirmacion', 'answer'])
        herramienta = [m for m in vistos[2] if m.get('role') == 'tool'][-1]
        self.assertEqual(herramienta['content'], agente.NO_PAGO)

    def test_detener_mientras_piensa_no_deja_pasar_el_clic(self):
        t, _ = self.correr_con([('click', {'element': 'Enlace «Noticias»', 'x': 10, 'y': 10})])
        crear = agente.cliente.chat.completions.create

        def pensando(**k):
            r = crear(**k)
            t.avisar(parar=True)  # la persona tocó Detener mientras el modelo pensaba
            return r
        agente.cliente.chat.completions.create = pensando
        agente.correr(t)
        self.assertEqual(t.estado, 'parada')
        self.assertEqual(self.hechas, [], 'lo que decidió mientras la paraban no se hizo (auditoría, 3-oct)')

    def test_la_herramienta_de_confirmar_y_un_no(self):
        t, vistos = self.correr_con([
            ('ask_user_confirmation', {'question': '¿Publico el comentario?'}),
            ('answer', {'content': 'No lo publiqué porque dijiste que no.'}),
        ])
        contestar_cuando_pregunte(t, False)
        agente.correr(t)
        self.assertEqual(t.estado, 'hecha')
        self.assertEqual(self.hechas, [])
        self.assertEqual([m for m in vistos[1] if m.get('role') == 'tool'][-1]['content'], agente.NO_DIJO)

    def test_detener_desde_la_pausa(self):
        t, _ = self.correr_con([('open_url', {'url': 'x.hn'})] * 5)
        t.avisar(pausa=True)
        threading.Timer(0.1, lambda: t.avisar(parar=True)).start()
        agente.correr(t)
        self.assertEqual(t.estado, 'parada')
        self.assertEqual(self.hechas, [])


if __name__ == '__main__':
    unittest.main()
