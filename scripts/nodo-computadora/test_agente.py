"""Pruebas del servicio de tareas (agente.py) sin escritorio, sin GPU y sin FastAPI instalado.

    python3 -m unittest scripts/nodo-computadora/test_agente.py

Se reemplazan fastapi, openai, httpx y PIL por módulos de mentira (lo que se prueba es la lógica: pausa,
control de la persona, el sí antes de algo sensible, nunca pagar, y el ciclo del motor gratis con eso).
"""
import os
import posixpath
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


def contestar_en_orden(t, respuestas, espera=5.0):
    """En otro hilo: contesta cada pregunta nueva con la respuesta siguiente (sí, no…) y guarda lo preguntado."""
    preguntas = []

    def hilo():
        fin = time.time() + espera
        vista = None
        pendientes = list(respuestas)
        while time.time() < fin and pendientes:
            if t.estado_visible() == 'confirmar' and t.pregunta_id and t.pregunta_id != vista:
                vista = t.pregunta_id
                preguntas.append(t.pregunta)
                t.avisar(si=pendientes.pop(0))
            time.sleep(0.005)
    threading.Thread(target=hilo, daemon=True).start()
    return preguntas


class Base(unittest.TestCase):
    def setUp(self):
        self.antes = (agente.ESPERA_CONFIRMACION_S, agente.PAUSA_MAX_S, agente.PERMISO_VALE_S,
                      getattr(agente, 'ESPERA_QUIETUD_S', None))
        self.hechas = []
        self.ejecutar_real = agente.ejecutar
        agente.ejecutar = lambda nombre, a, ancho, alto: self.hechas.append((nombre, dict(a))) or 'Done.'
        # Sin las esperas a que la pantalla se asiente (no hay pantalla).
        self.asentar_real = getattr(agente, 'asentar', None)
        agente.asentar = lambda *a, **k: None
        # Soltar teclas y puntero (xdotool) sin escritorio: solo se cuenta.
        self.soltadas = []
        self.soltar_real = getattr(agente, 'soltar_entradas', None)
        agente.soltar_entradas = lambda: self.soltadas.append(time.time())

    def tearDown(self):
        (agente.ESPERA_CONFIRMACION_S, agente.PAUSA_MAX_S, agente.PERMISO_VALE_S, quietud) = self.antes
        if quietud is not None:
            agente.ESPERA_QUIETUD_S = quietud
        agente.ejecutar = self.ejecutar_real
        agente.asentar = self.asentar_real
        if self.soltar_real is not None:
            agente.soltar_entradas = self.soltar_real

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
        self.assertIsNone(agente.revisar_accion(t, 'type', {'text': 'Francisco Morazán', 'press_enter': True}))
        self.assertIsNone(agente.revisar_accion(t, 'click', {'element': 'Enlace «Tipo de cambio»'}))
        self.assertIsNone(agente.revisar_accion(t, 'click', {'element': 'Aceptar cookies'}))
        self.assertIsNone(agente.revisar_accion(t, 'scroll', {'direction': 'down'}))
        self.assertEqual([p['accion'] for p in t.pasos], [], 'nada de esto pregunta')
        # Auditoría 3-oct (PC02): lo sensible se mira ANTES que las cookies; antes «Accept all cookies and submit»
        # pasaba sin preguntar por decir «cookies».
        contestar_cuando_pregunte(t, False)
        self.assertEqual(agente.revisar_accion(t, 'click', {'element': 'Accept all cookies and submit'}), agente.NO_DIJO)

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

    def test_el_si_del_modelo_no_vale_para_ningun_toque_y_el_exacto_para_uno(self):
        # Permisos exactos (4-oct): el sí a la pregunta libre del modelo no cubre el toque (antes cubría su CLASE); el
        # toque se pregunta con la operación exacta, y ese sí vale para ese toque, una vez.
        t = self.tarea()
        contestar_cuando_pregunte(t, True)
        self.assertTrue(t.pedir_confirmacion('¿Envío el formulario?'))
        preguntas = contestar_en_orden(t, [True, False])
        self.assertIsNone(agente.revisar_accion(t, 'click', {'element': 'Enviar'}), 'la primera, con su sí exacto')
        self.assertEqual(agente.revisar_accion(t, 'click', {'element': 'Publicar'}), agente.NO_DIJO, 'la segunda pregunta otra vez')
        self.assertEqual(preguntas, ['Voy a tocar «Enviar». ¿Lo hago?', 'Voy a tocar «Publicar». ¿Lo hago?'])

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

    def test_la_pantalla_se_captura_con_el_candado_y_nunca_durante_un_reinicio(self):
        t = self.tarea()
        antes = (agente.exigir, agente.captura, agente.miniatura, agente.ESPERA_ESCRITORIO_S)
        visto = []
        agente.exigir = lambda req: None
        agente.captura = lambda: visto.append(agente.ESCRITORIO_LOCK.locked()) or (b'png', 10, 10)
        agente.miniatura = lambda png, ancho: 'eA=='
        agente.ESPERA_ESCRITORIO_S = 0.05
        agente.TAREAS[t.id] = t
        try:
            agente.ESCRITORIO_LOCK.acquire()  # otro dueño: su escritorio se está preparando
            try:
                with self.assertRaises(agente.HTTPException) as e:
                    agente.pantalla_tarea(t.id, None)
                self.assertEqual(e.exception.status_code, 409)
            finally:
                agente.ESCRITORIO_LOCK.release()
            self.assertEqual(visto, [], 'durante el reinicio no se captura nada')
            agente.pantalla_tarea(t.id, None)
            self.assertEqual(visto, [True], 'la captura va dentro del candado')
            self.assertFalse(agente.ESCRITORIO_LOCK.locked(), 'y lo suelta')
            agente.DUENO_ACTUAL['v'] = 'otra-persona'
            with self.assertRaises(agente.HTTPException):
                agente.pantalla_tarea(t.id, None)
            self.assertEqual(len(visto), 1)
            self.assertFalse(agente.ESCRITORIO_LOCK.locked(), 'también lo suelta al negar')
        finally:
            agente.exigir, agente.captura, agente.miniatura, agente.ESPERA_ESCRITORIO_S = antes
            agente.TAREAS.pop(t.id, None)

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


class Pedido:
    """Un Request de mentira para los endpoints (solo el cuerpo)."""
    headers = {}

    def __init__(self, cuerpo):
        self.cuerpo = cuerpo

    async def json(self):
        return self.cuerpo


class ConEndpoints(Base):
    def setUp(self):
        super().setUp()
        self.exigir_real = agente.exigir
        agente.exigir = lambda req: None

    def tearDown(self):
        agente.exigir = self.exigir_real
        super().tearDown()


class PermisoLigado(ConEndpoints):
    """Auditoría 3-oct (PC01): el sí vale para lo que se preguntó, una vez, en esta época y por un rato."""

    def test_un_si_para_iniciar_sesion_no_autoriza_borrar(self):
        t = self.tarea()
        contestar_cuando_pregunte(t, True)
        self.assertTrue(t.pedir_confirmacion('¿Inicio sesión con la cuenta de prueba?'))
        contestar_cuando_pregunte(t, False)
        self.assertEqual(agente.revisar_accion(t, 'click', {'element': 'Botón «Eliminar cuenta»'}), agente.NO_DIJO,
                         'aprobar el login no aprueba borrar: pregunta otra vez')
        self.assertEqual(t.pasos[-2]['args']['pregunta'], 'Voy a tocar «Botón «Eliminar cuenta»». ¿Lo hago?')
        # Y el permiso del login ya no está (se usa o se pierde).
        contestar_cuando_pregunte(t, False)
        self.assertEqual(agente.revisar_accion(t, 'click', {'element': 'Iniciar sesión'}), agente.NO_DIJO)

    def test_el_si_vale_para_esa_operacion_una_vez_y_vence(self):
        t = self.tarea()
        contestar_cuando_pregunte(t, True)
        self.assertIsNone(agente.revisar_accion(t, 'click', {'element': 'Botón Iniciar sesión'}), 'la que se preguntó, exacta')
        contestar_cuando_pregunte(t, False)
        self.assertEqual(agente.revisar_accion(t, 'click', {'element': 'Botón Iniciar sesión'}), agente.NO_DIJO, 'una sola vez')
        antes = agente.PERMISO_VALE_S
        agente.PERMISO_VALE_S = 0.05
        try:
            contestar_cuando_pregunte(t, True)
            self.assertIsNone(agente.revisar_accion(t, 'click', {'element': 'Enviar'}))
            s, t.por_hacer = t.por_hacer, None
            time.sleep(0.1)
            self.assertEqual(agente.efecto_modelo(t, t.epoca, lambda: 'Done.', sensible=s), (agente.NO_CAMBIO, False), 'vencido: no se toca')
        finally:
            agente.PERMISO_VALE_S = antes

    def test_el_permiso_muere_si_la_pausan_o_toman_el_control(self):
        t = self.tarea()
        contestar_cuando_pregunte(t, True)
        t.pedir_confirmacion('¿Publico el comentario?')
        t.avisar(pausa=True)
        t.avisar(pausa=False)
        contestar_cuando_pregunte(t, False)
        self.assertEqual(agente.revisar_accion(t, 'click', {'element': 'Publicar'}), agente.NO_DIJO, 'otra época: otro permiso')

    def test_una_respuesta_vieja_no_contesta_la_pregunta_nueva(self):
        import asyncio
        t = self.tarea()
        agente.TAREAS[t.id] = t
        resultado = {}
        try:
            def esperar_pregunta(anterior=None):
                fin = time.time() + 2
                while time.time() < fin and (not t.pregunta_id or t.pregunta_id == anterior):
                    time.sleep(0.01)
                return t.pregunta_id

            h = threading.Thread(target=lambda: resultado.update(a=t.pedir_confirmacion('¿Inicio sesión?')), daemon=True)
            h.start()
            pa = esperar_pregunta()
            self.assertEqual(t.resumen()['pregunta_id'], pa, 'la app y el servidor ven qué pregunta es')
            # Revisión 4-oct: el sí sin la propuesta exacta ya no vale; con ella, sí.
            with self.assertRaises(agente.HTTPException) as e0:
                asyncio.run(agente.confirmar(t.id, Pedido({'si': True, 'pregunta_id': pa})))
            self.assertEqual(e0.exception.status_code, 409)
            self.assertEqual(asyncio.run(agente.confirmar(t.id, Pedido({'si': True, 'pregunta_id': pa, 'propuesta': t.propuesta}))), {'id': t.id, 'si': True})
            h.join(1)
            self.assertTrue(resultado['a'])
            h = threading.Thread(target=lambda: resultado.update(b=t.pedir_confirmacion('¿Borro el archivo?')), daemon=True)
            h.start()
            pb = esperar_pregunta(pa)
            self.assertNotEqual(pa, pb)
            # El «sí» que iba para la primera llega tarde: no contesta la segunda.
            with self.assertRaises(agente.HTTPException) as e:
                asyncio.run(agente.confirmar(t.id, Pedido({'si': True, 'pregunta_id': pa})))
            self.assertEqual(e.exception.status_code, 409)
            with self.assertRaises(agente.HTTPException):
                asyncio.run(agente.confirmar(t.id, Pedido({'si': True})))  # sin decir a cuál: tampoco
            self.assertFalse(t.contestar(pa, True))
            self.assertFalse(t.contestar(pb, True), 'un sí sin propuesta no contesta ni la de ahora')
            self.assertEqual(t.estado_visible(), 'confirmar', 'la segunda sigue esperando')
            self.assertTrue(t.contestar(pb, False))
            h.join(1)
            self.assertFalse(resultado['b'])
        finally:
            agente.TAREAS.pop(t.id, None)


class GuardasDeEfecto(Base):
    """Auditoría 3-oct (PC02): lo que hace una tecla o un botón genérico no lo dice su nombre."""

    def test_tab_y_enter_no_se_cuelan(self):
        t = self.tarea()
        self.assertIsNone(agente.revisar_accion(t, 'click', {'element': 'Campo de búsqueda'}))
        self.assertIsNone(agente.revisar_accion(t, 'key', {'keys': 'tab'}))
        self.assertEqual(agente.revisar_accion(t, 'key', {'keys': 'Return'}), agente.NO_FOCO, 'tras Tab no se sabe qué hay enfocado')
        self.assertEqual(agente.revisar_accion(t, 'key', {'keys': 'space'}), agente.NO_FOCO)
        self.assertEqual(agente.revisar_accion(t, 'type', {'text': 'hola', 'press_enter': True}), agente.NO_FOCO)
        # Tocar el elemento de verdad lo vuelve a saber.
        self.assertIsNone(agente.revisar_accion(t, 'click', {'element': 'Campo de búsqueda'}))
        self.assertIsNone(agente.revisar_accion(t, 'key', {'keys': 'enter'}))

    def test_espacio_y_salto_de_linea_valen_como_enter(self):
        t = self.tarea()
        t.ultimo_elemento = 'Botón Eliminar cuenta'
        contestar_cuando_pregunte(t, False)
        self.assertEqual(agente.revisar_accion(t, 'key', {'keys': 'space'}), agente.NO_DIJO, 'Espacio activa el botón enfocado')
        contestar_cuando_pregunte(t, False)
        self.assertEqual(agente.revisar_accion(t, 'type', {'text': 'listo\n'}), agente.NO_DIJO, 'un salto de línea es un Enter')
        t.ultimo_elemento = 'Botón Comprar'
        self.assertEqual(agente.revisar_accion(t, 'key', {'keys': 'space'}), agente.NO_PAGO)

    def test_un_boton_generico_pregunta(self):
        t = self.tarea('Go to example.com and tell me what is on the page')
        for elemento in ('Blue «Continue» button', 'Botón «Aceptar» del diálogo', 'OK', 'Botón «Sí»'):
            contestar_cuando_pregunte(t, False)
            self.assertEqual(agente.revisar_accion(t, 'click', {'element': elemento}), agente.NO_DIJO, elemento)
        # Lo de leer sigue sin preguntar.
        for elemento in ('Enlace «Noticias»', 'Siguiente página de resultados', 'Campo de búsqueda'):
            self.assertIsNone(agente.revisar_accion(t, 'click', {'element': elemento}), elemento)

    def test_cookies_legitimas_pasan_y_mezcladas_no(self):
        t = self.tarea()
        for elemento in ('Aceptar cookies', 'Accept all cookies', 'Green «Accept all cookies» button at the bottom of the banner',
                         'Confirm my cookie choices', 'Rechazar las cookies opcionales', 'Continue without accepting cookies'):
            self.assertIsNone(agente.revisar_accion(t, 'click', {'element': elemento}), elemento)
        self.assertEqual([p['accion'] for p in t.pasos], [], 'ninguna preguntó')
        for elemento in ('Aceptar cookies y enviar', 'Accept cookies and sign in', 'Cookies: delete my account'):
            contestar_cuando_pregunte(t, False)
            self.assertEqual(agente.revisar_accion(t, 'click', {'element': elemento}), agente.NO_DIJO, elemento)
        self.assertEqual(agente.revisar_accion(t, 'click', {'element': 'Aceptar cookies y pagar'}), agente.NO_PAGO)

    def test_enter_en_la_contrasena_es_iniciar_sesion(self):
        t = self.tarea()
        self.assertIsNone(agente.revisar_accion(t, 'click', {'element': 'Campo «Contraseña»'}))
        contestar_cuando_pregunte(t, False)
        self.assertEqual(agente.revisar_accion(t, 'type', {'text': 'x', 'press_enter': True}), agente.NO_DIJO)


class Carreras(Base):
    """Auditoría 3-oct (PC03): la persona y el modelo nunca tocan a la vez; lo invalidado no toca."""

    def test_devolver_espera_que_termine_lo_que_hace_la_persona(self):
        t = self.tarea()
        t.avisar(control=True)
        t.en_espera = True
        suelta = threading.Event()
        log = []

        def lento(nombre, a, ancho, alto):
            log.append(f'persona-{nombre}')
            suelta.wait(2)
            log.append('persona-termina')
            return 'Done.'
        agente.ejecutar = lento
        threading.Thread(target=lambda: agente.accion_persona(t, {'tipo': 'escribir', 'texto': 'mi clave'}), daemon=True).start()
        fin = time.time() + 2
        while not log and time.time() < fin:
            time.sleep(0.01)
        epoca_vieja = t.epoca
        h = threading.Thread(target=lambda: (agente.cambiar_control(t, False), log.append('devuelta')), daemon=True)
        h.start()
        time.sleep(0.15)
        self.assertNotIn('devuelta', log, 'devolver espera a que termine de escribir')
        self.assertTrue(t.control)
        suelta.set()
        h.join(2)
        self.assertEqual(log, ['persona-type', 'persona-termina', 'devuelta'])
        self.assertFalse(t.control)
        # Lo que el modelo decidió antes de devolver (otra época) no toca; lo de ahora, sí.
        agente.ejecutar = lambda nombre, a, ancho, alto: log.append(f'modelo-{nombre}') or 'Done.'
        self.assertEqual(agente.efecto_modelo(t, epoca_vieja, lambda: agente.ejecutar('click', {}, 1, 1)), (agente.NO_PAUSA, False))
        self.assertEqual(agente.efecto_modelo(t, t.epoca, lambda: agente.ejecutar('click', {}, 1, 1)), ('Done.', True))
        self.assertEqual(log[-1], 'modelo-click')

    def test_parar_entre_la_revision_y_el_efecto_no_deja_el_clic(self):
        t, _ = CicloGratis.correr_con(self, [('click', {'element': 'Enlace «Noticias»', 'x': 10, 'y': 10})])
        revisar = agente.revisar_accion

        def y_paran(t2, nombre, a):
            r = revisar(t2, nombre, a)
            t2.avisar(parar=True)  # Detener llega justo después de la revisión
            return r
        agente.revisar_accion = y_paran
        try:
            agente.correr(t)
        finally:
            agente.revisar_accion = revisar
        self.assertEqual(t.estado, 'parada')
        self.assertEqual(self.hechas, [], 'la última revisión va pegada al efecto')
        self.assertIs(t.pasos[-1].get('hecho'), False, 'el paso dice que no se hizo')

    def test_pausar_y_seguir_mientras_piensa_no_deja_la_jugada(self):
        t, vistos = CicloGratis.correr_con(self, [('click', {'element': 'Enlace «Noticias»', 'x': 10, 'y': 10}),
                                                  ('answer', {'content': 'Listo.'})])
        crear = agente.cliente.chat.completions.create
        veces = []

        def pensando(**k):
            r = crear(**k)
            if not veces:
                t.avisar(pausa=True)   # pausa y sigue mientras el modelo pensaba: miraba otra pantalla
                t.avisar(pausa=False)
            veces.append(1)
            return r
        agente.cliente.chat.completions.create = pensando
        agente.correr(t)
        self.assertEqual(t.estado, 'hecha')
        self.assertEqual(self.hechas, [], 'la jugada de antes de la pausa no se hizo')
        self.assertEqual([m for m in vistos[1] if m.get('role') == 'tool'][-1]['content'], agente.NO_PAUSA)

    def test_claude_pausado_mientras_piensa_no_hace_nada(self):
        t, _ = CicloGratis.correr_con(self, [])
        t.motor = 'claude'
        hechas = []
        antes = (agente.accion_claude, getattr(agente.httpx, 'Client', None))
        agente.accion_claude = lambda nombre, a: hechas.append(nombre) or 'OK'

        class Cliente:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def post(self, *a, **k):
                t.avisar(pausa=True)  # la pausan mientras Claude piensa
                threading.Timer(0.1, lambda: t.avisar(parar=True)).start()
                bloques = [{'type': 'tool_use', 'id': 'u1', 'name': 'left_click', 'toolset_name': 'computer', 'input': {'coordinate': [1, 1]}},
                           {'type': 'tool_use', 'id': 'u2', 'name': 'type', 'toolset_name': 'computer', 'input': {'text': 'hola'}}]
                return types.SimpleNamespace(status_code=200, json=lambda: {'content': bloques}, text='')
        agente.httpx.Client = lambda **k: Cliente()
        try:
            agente.correr(t)
        finally:
            agente.accion_claude = antes[0]
            if antes[1] is None:
                del agente.httpx.Client
            else:
                agente.httpx.Client = antes[1]
        self.assertEqual(t.estado, 'parada')
        self.assertEqual(hechas, [], 'en pausa, Claude no toca aunque ya lo hubiera decidido')


def clics_en(hechas, elemento):
    return [h for h in hechas if h[0] == 'click' and h[1].get('element') == elemento]


class PermisoExacto(ConEndpoints):
    """AUR02: el sí se liga a la operación exacta (a quién, qué texto, cuánto, dónde, tarea, dueño, época,
    pregunta y caducidad), se reserva y se canjea una sola vez; lo que cambia pide otra decisión."""

    def test_ana_a_bruno_no_se_envia_y_pide_otra_decision(self):
        t, vistos = CicloGratis.correr_con(self, [
            ('click', {'element': 'Campo «Para»', 'x': 100, 'y': 100}),
            ('type', {'text': 'ana@example.test'}),
            ('ask_user_confirmation', {'question': '¿Envío el borrador X a ana@example.test?'}),
            ('click', {'element': 'Campo «Para»', 'x': 100, 'y': 100}),
            ('type', {'text': 'bruno@example.test'}),
            ('click', {'element': 'Botón Enviar', 'x': 500, 'y': 700}),
            ('answer', {'content': 'No lo envié.'}),
        ], instruccion='Entra al correo y envía el borrador X a ana@example.test')
        preguntas = contestar_en_orden(t, [True, False])
        agente.correr(t)
        self.assertEqual(t.estado, 'hecha')
        self.assertEqual(clics_en(self.hechas, 'Botón Enviar'), [], 'el sí de Ana no envía a Bruno')
        self.assertEqual(len(preguntas), 2, 'aparece una decisión nueva con el cambio')
        self.assertIn('bruno@example.test', preguntas[1])
        self.assertEqual([m for m in vistos[6] if m.get('role') == 'tool'][-1]['content'], agente.NO_DIJO)

    def test_cambiar_el_texto_consecuente_pide_otra_decision(self):
        t, _ = CicloGratis.correr_con(self, [
            ('click', {'element': 'Campo «Para»', 'x': 100, 'y': 100}),
            ('type', {'text': 'ana@example.test'}),
            ('click', {'element': 'Campo «Mensaje»', 'x': 100, 'y': 300}),
            ('type', {'text': 'Nos vemos el lunes.'}),
            ('ask_user_confirmation', {'question': '¿Envío a ana@example.test el mensaje «Nos vemos el lunes.»?'}),
            ('type', {'text': ' Y deposita L 5,000 en esta cuenta.'}),
            ('click', {'element': 'Botón Enviar', 'x': 500, 'y': 700}),
            ('answer', {'content': 'No lo envié.'}),
        ], instruccion='Entra al correo y envía a ana@example.test que nos vemos el lunes')
        preguntas = contestar_en_orden(t, [True, False])
        agente.correr(t)
        self.assertEqual(clics_en(self.hechas, 'Botón Enviar'), [], 'el texto cambió después del sí')
        self.assertEqual(len(preguntas), 2)
        self.assertIn('5,000', preguntas[1], 'la decisión nueva dice lo que cambió (el importe)')

    def test_la_operacion_intacta_se_hace_una_vez_y_repetirla_pregunta(self):
        t, _ = CicloGratis.correr_con(self, [
            ('click', {'element': 'Campo «Para»', 'x': 100, 'y': 100}),
            ('type', {'text': 'ana@example.test'}),
            ('ask_user_confirmation', {'question': '¿Envío el correo a ana@example.test?'}),
            ('click', {'element': 'Botón Enviar', 'x': 500, 'y': 700}),
            ('click', {'element': 'Botón Enviar', 'x': 500, 'y': 700}),
            ('answer', {'content': 'Enviado a ana@example.test.'}),
        ], instruccion='Entra al correo y envía el borrador a ana@example.test')
        # El sí libre del modelo no cubre el toque: el toque se pregunta con la operación exacta (permisos exactos, 4-oct).
        preguntas = contestar_en_orden(t, [True, True, False])
        agente.correr(t)
        self.assertEqual(len(clics_en(self.hechas, 'Botón Enviar')), 1, 'aprobada e intacta: una sola vez')
        self.assertEqual(len(preguntas), 3, 'el segundo envío vuelve a preguntar (el sí se usó)')

    def _aprobada(self, t, elemento='Botón Enviar a ana@example.test'):
        contestar_cuando_pregunte(t, True)
        self.assertIsNone(agente.revisar_accion(t, 'click', {'element': elemento}))
        s = t.por_hacer
        self.assertIsNotNone(s, 'la operación aprobada queda reservada para el efecto')
        return s

    def test_dos_workers_no_canjean_el_mismo_permiso(self):
        t = self.tarea()
        s = self._aprobada(t)
        hechos, resultados = [], []

        def hacer():
            time.sleep(0.1)
            hechos.append(1)
            return 'Done.'
        hilos = [threading.Thread(target=lambda: resultados.append(agente.efecto_modelo(t, t.epoca, hacer, sensible=s)))
                 for _ in range(2)]
        for h in hilos:
            h.start()
        for h in hilos:
            h.join(2)
        self.assertEqual(len(hechos), 1, 'un solo efecto lógico')
        self.assertEqual(sorted(r[1] for r in resultados), [False, True])
        # Y repetirlo después (replay) tampoco.
        self.assertEqual(agente.efecto_modelo(t, t.epoca, hacer, sensible=s)[1], False)
        self.assertEqual(len(hechos), 1)

    def test_vencido_o_con_otro_dueno_en_el_punto_del_efecto_no_toca(self):
        t = self.tarea()
        hechos = []
        hacer = lambda: hechos.append(1) or 'Done.'
        agente.PERMISO_VALE_S = 0.05
        s = self._aprobada(t)
        time.sleep(0.1)
        self.assertEqual(agente.efecto_modelo(t, t.epoca, hacer, sensible=s)[1], False, 'vencido entre el sí y el toque')
        agente.PERMISO_VALE_S = 120
        s = self._aprobada(t)
        dueno = agente.DUENO_ACTUAL['v']
        agente.DUENO_ACTUAL['v'] = 'otra-persona'
        try:
            self.assertEqual(agente.efecto_modelo(t, t.epoca, hacer, sensible=s)[1], False, 'el escritorio cambió de dueño')
        finally:
            agente.DUENO_ACTUAL['v'] = dueno
        self.assertEqual(agente.efecto_modelo(t, t.epoca, hacer, sensible=s)[1], False, 'y no vuelve a valer al regresar')
        self.assertEqual(hechos, [])

    def test_el_texto_cambia_entre_la_reserva_y_el_efecto(self):
        t = self.tarea()
        s = self._aprobada(t, 'Botón Enviar')
        t.escrito.append('bruno@example.test')  # el plan cambió el destinatario después del sí
        hechos = []
        r = agente.efecto_modelo(t, t.epoca, lambda: hechos.append(1) or 'Done.', sensible=s)
        self.assertEqual(r, (agente.NO_CAMBIO, False))
        self.assertEqual(hechos, [])

    def test_un_efecto_a_medias_no_libera_el_permiso_para_otro_destino(self):
        t = self.tarea()
        s = self._aprobada(t)

        def roto():
            raise RuntimeError('xdotool se cortó a la mitad')
        texto, hecho = agente.efecto_modelo(t, t.epoca, roto, sensible=s)
        self.assertFalse(hecho)
        self.assertIn('may have happened', texto, 'incierto: no se da por no hecho ni se repite a ciegas')
        self.assertEqual(t.ultima_op['estado'], 'incierta')
        hechos = []
        self.assertEqual(agente.efecto_modelo(t, t.epoca, lambda: hechos.append(1) or 'Done.', sensible=s)[1], False,
                         'reintentar con el mismo sí: no')
        # Otro destino pide su propia decisión (el sí de Ana no se reusa).
        preguntas = contestar_en_orden(t, [False])
        self.assertEqual(agente.revisar_accion(t, 'click', {'element': 'Botón Enviar a bruno@example.test'}), agente.NO_DIJO)
        self.assertIn('bruno@example.test', preguntas[0])
        # La misma operación otra vez: se pregunta diciendo que quizá ya se hizo (se reconcilia, no se repite solo).
        preguntas = contestar_en_orden(t, [False])
        self.assertEqual(agente.revisar_accion(t, 'click', {'element': 'Botón Enviar a ana@example.test'}), agente.NO_DIJO)
        self.assertRegex(preguntas[0], r'ya se haya hecho')
        self.assertEqual(hechos, [])

    def test_la_respuesta_nombra_la_propuesta_mostrada(self):
        import asyncio
        t = self.tarea()
        agente.TAREAS[t.id] = t
        resultado = {}
        try:
            h = threading.Thread(target=lambda: resultado.update(si=t.pedir_confirmacion('¿Envío el correo a ana@example.test?')), daemon=True)
            h.start()
            fin = time.time() + 2
            while time.time() < fin and not t.pregunta_id:
                time.sleep(0.01)
            r = t.resumen()
            self.assertTrue(r['propuesta'], 'la huella de lo que se muestra viaja con la pregunta')
            with self.assertRaises(agente.HTTPException) as e:
                asyncio.run(agente.confirmar(t.id, Pedido({'si': True, 'pregunta_id': r['pregunta_id'], 'propuesta': 'otra-cosa'})))
            self.assertEqual(e.exception.status_code, 409)
            self.assertEqual(asyncio.run(agente.confirmar(t.id, Pedido({'si': True, 'pregunta_id': r['pregunta_id'], 'propuesta': r['propuesta']}))),
                             {'id': t.id, 'si': True})
            h.join(1)
            self.assertTrue(resultado['si'])
            self.assertEqual(t.permiso['destinos'], frozenset({'ana@example.test'}))
        finally:
            agente.TAREAS.pop(t.id, None)


class ParadaConQuietud(ConEndpoints):
    """AUR03: parar y tomar/devolver el control solo dicen «detenido» / «tú controlas» cuando nada está en vuelo
    bajo la época revocada (o dicen draining con un id); lo ya despachado queda con recibo, no como deshecho."""

    def tearDown(self):
        agente.TAREAS.clear()
        super().tearDown()

    def _lento(self, tras_guarda, pausa=0.3, falla=False, suelta=None):
        clics = []

        def ejecutar(nombre, a, ancho, alto):
            tras_guarda.set()          # ya pasó la última guarda
            if suelta is not None:
                suelta.wait(2)
            else:
                time.sleep(pausa)      # la pausa artificial DESPUÉS de la última guarda
            if falla:
                raise RuntimeError('xdotool se cortó')
            clics.append((a.get('element'), time.time()))  # el clic empieza aquí
            return 'Done.'
        return ejecutar, clics

    def test_parar_tras_la_ultima_guarda_espera_a_que_el_clic_termine(self):
        t, _ = CicloGratis.correr_con(self, [('click', {'element': 'Enlace «Noticias»', 'x': 10, 'y': 10}),
                                             ('click', {'element': 'Enlace «Deportes»', 'x': 10, 'y': 10})])
        agente.TAREAS[t.id] = t
        tras_guarda = threading.Event()
        agente.ejecutar, clics = self._lento(tras_guarda)
        h = threading.Thread(target=agente.correr, args=(t,), daemon=True)
        h.start()
        self.assertTrue(tras_guarda.wait(2))
        r = agente.parar(t.id, None)
        ack = time.time()
        h.join(2)
        time.sleep(0.1)
        self.assertEqual(len(clics), 1)
        self.assertLessEqual(clics[0][1], ack, 'ningún clic empieza después del ACK')
        self.assertEqual(r['parada']['fase'], 'quiescent')
        self.assertEqual(r['estado'], 'parada', '«detenida» solo con quietud')
        self.assertTrue(self.soltadas, 'suelta teclas y puntero')
        # Repetir parar devuelve la misma parada.
        self.assertEqual(agente.parar(t.id, None)['parada']['id'], r['parada']['id'])

    def test_parar_con_tope_devuelve_draining_y_lo_despachado_queda_incierto_con_recibo(self):
        agente.ESPERA_QUIETUD_S = 0.05
        t, _ = CicloGratis.correr_con(self, [('click', {'element': 'Enlace «Noticias»', 'x': 10, 'y': 10})])
        agente.TAREAS[t.id] = t
        tras_guarda, suelta = threading.Event(), threading.Event()
        agente.ejecutar, _ = self._lento(tras_guarda, falla=True, suelta=suelta)
        h = threading.Thread(target=agente.correr, args=(t,), daemon=True)
        h.start()
        self.assertTrue(tras_guarda.wait(2))
        r = agente.parar(t.id, None)
        self.assertEqual(r['parada']['fase'], 'draining', 'no dice detenida con un toque en vuelo')
        self.assertTrue(r['parada']['id'])
        self.assertEqual(r['parada']['en_vuelo']['accion'], 'click')
        self.assertNotEqual(r['estado'], 'parada')
        suelta.set()
        h.join(2)
        p = agente.ver_parada(t.id, r['parada']['id'], None)
        self.assertEqual(p['fase'], 'quiescent')
        self.assertEqual(p['en_vuelo']['estado'], 'incierta', 'se cortó a medias: incierta, no deshecha')
        self.assertEqual(t.estado, 'parada')
        paso = [x for x in t.pasos if x['accion'] == 'click'][-1]
        self.assertIs(paso['hecho'], False)
        self.assertIs(paso.get('incierto'), True)

    def test_tomar_el_control_mientras_piensa(self):
        t, _ = CicloGratis.correr_con(self, [('click', {'element': 'Enlace «Noticias»', 'x': 10, 'y': 10}),
                                             ('answer', {'content': 'Listo.'})])
        agente.TAREAS[t.id] = t
        crear = agente.cliente.chat.completions.create
        acks = []

        def pensando(**k):
            r = crear(**k)
            if not acks:
                acks.append(agente.cambiar_control(t, True))  # la persona toma el control mientras el modelo piensa
                threading.Timer(0.2, lambda: acks.append(agente.cambiar_control(t, False))).start()
            return r
        agente.cliente.chat.completions.create = pensando
        agente.correr(t)
        self.assertEqual(t.estado, 'hecha')
        self.assertEqual(self.hechas, [], 'lo decidido antes de tomar el control no se hizo')
        self.assertEqual(acks[0]['fase'], 'quiescent')
        self.assertEqual(acks[0]['estado'], 'control')
        self.assertEqual(acks[1]['fase'], 'quiescent')
        self.assertGreaterEqual(len(self.soltadas), 2, 'al tomar y al devolver se sueltan teclas y puntero')

    def test_tomar_el_control_durante_una_accion(self):
        t, _ = CicloGratis.correr_con(self, [('click', {'element': 'Enlace «Noticias»', 'x': 10, 'y': 10}),
                                             ('click', {'element': 'Enlace «Deportes»', 'x': 10, 'y': 10})])
        agente.TAREAS[t.id] = t
        tras_guarda = threading.Event()
        agente.ejecutar, clics = self._lento(tras_guarda)
        h = threading.Thread(target=agente.correr, args=(t,), daemon=True)
        h.start()
        self.assertTrue(tras_guarda.wait(2))
        ack = agente.cambiar_control(t, True)
        t_ack = time.time()
        self.assertEqual(ack['fase'], 'quiescent')
        self.assertEqual([c[0] for c in clics], ['Enlace «Noticias»'])
        self.assertLessEqual(clics[0][1], t_ack, '«tú controlas» solo cuando el toque del agente terminó')
        self.assertTrue(self.soltadas and self.soltadas[-1] >= clics[0][1], 'y después suelta teclas y puntero')
        fin = time.time() + 2
        while not t.en_espera and time.time() < fin:
            time.sleep(0.01)
        agente.ejecutar = lambda nombre, a, ancho, alto: clics.append(('persona', time.time())) or 'Done.'
        agente.accion_persona(t, {'tipo': 'click', 'x': 1, 'y': 1})
        agente.parar(t.id, None)
        h.join(2)
        self.assertEqual([c[0] for c in clics], ['Enlace «Noticias»', 'persona'], 'tras el ACK solo la persona toca')

    def test_devolver_mientras_escribe_con_tope_queda_draining_y_un_solo_operador(self):
        agente.ESPERA_QUIETUD_S = 0.05
        t = self.tarea()
        t.avisar(control=True)
        t.en_espera = True
        suelta = threading.Event()
        log = []

        def lento(nombre, a, ancho, alto):
            log.append('persona')
            suelta.wait(2)
            log.append('persona-termina')
            return 'Done.'
        agente.ejecutar = lento
        threading.Thread(target=lambda: agente.accion_persona(t, {'tipo': 'escribir', 'texto': 'hola'}), daemon=True).start()
        fin = time.time() + 2
        while not log and time.time() < fin:
            time.sleep(0.01)
        r = agente.cambiar_control(t, False)
        self.assertEqual(r['fase'], 'draining')
        self.assertTrue(t.control, 'mientras escribe, el control sigue siendo suyo')
        # Lo que la persona mande ahora ya no entra (la cola humana se vacía al devolver).
        with self.assertRaises(agente.HTTPException):
            agente.accion_persona(t, {'tipo': 'click', 'x': 1, 'y': 1})
        epoca = t.epoca
        self.assertEqual(agente.efecto_modelo(t, epoca, lambda: log.append('modelo') or 'Done.'), (agente.NO_PAUSA, False))
        suelta.set()
        fin = time.time() + 2
        while t.control and time.time() < fin:
            time.sleep(0.01)
        self.assertFalse(t.control, 'al terminar de escribir, el traspaso se completa solo')
        self.assertTrue(self.soltadas)
        self.assertEqual(agente.efecto_modelo(t, t.epoca, lambda: log.append('modelo') or 'Done.'), ('Done.', True))
        self.assertEqual(log, ['persona', 'persona-termina', 'modelo'])

    def test_un_terminal_no_se_reabre(self):
        t = self.tarea()
        t.cerrar('parada')
        t.cerrar('hecha', respuesta='tarde')
        self.assertEqual(t.estado, 'parada')
        self.assertIsNone(t.respuesta)


class CrearUnaVez(ConEndpoints):
    """Auditoría 3-oct (PC04): el mismo pedido repetido (respuesta perdida, reintento) es UNA tarea."""

    def setUp(self):
        super().setUp()
        self.lanzar_real = agente.lanzar
        self.lanzadas = []
        agente.lanzar = lambda t: self.lanzadas.append(t.id)

    def tearDown(self):
        agente.lanzar = self.lanzar_real
        for i in self.lanzadas:
            agente.TAREAS.pop(i, None)
        agente.PEDIDOS.clear()
        super().tearDown()

    def test_el_mismo_pedido_da_la_misma_tarea(self):
        import asyncio
        cuerpo = {'instruccion': 'Entra a bch.hn y dime el dólar', 'dueno': 'huella-a', 'request_id': 'pedido-123'}
        a = asyncio.run(agente.crear(Pedido(dict(cuerpo))))
        b = asyncio.run(agente.crear(Pedido(dict(cuerpo))))
        self.assertEqual(a['id'], b['id'])
        self.assertTrue(b.get('repetida'))
        self.assertEqual(self.lanzadas, [a['id']], 'se lanzó una sola vez')
        # Otro dueño con el mismo id de pedido: otra tarea (la llave lleva al dueño).
        c = asyncio.run(agente.crear(Pedido({**cuerpo, 'dueno': 'huella-b'})))
        self.assertNotEqual(c['id'], a['id'])
        # Sin request_id (servidor de antes): como siempre, cada pedido es una tarea.
        d = asyncio.run(agente.crear(Pedido({'instruccion': 'Entra a x.hn y lee', 'dueno': 'huella-a'})))
        e = asyncio.run(agente.crear(Pedido({'instruccion': 'Entra a x.hn y lee', 'dueno': 'huella-a'})))
        self.assertNotEqual(d['id'], e['id'])
        # Si la tarea ya se olvidó, repetir el pedido no la vuelve a lanzar a ciegas.
        agente.TAREAS.pop(a['id'], None)
        with self.assertRaises(agente.HTTPException) as err:
            asyncio.run(agente.crear(Pedido(dict(cuerpo))))
        self.assertEqual(err.exception.status_code, 409)
        self.assertEqual(len(self.lanzadas), 4)

    def test_la_vuelta_de_una_mision_cuenta_desde_su_primera_tarea_solo_del_mismo_dueno(self):
        import asyncio
        a = asyncio.run(agente.crear(Pedido({'instruccion': 'Crea informe.odt', 'dueno': 'huella-a'})))
        agente.TAREAS[a['id']].desde -= 120  # empezó hace dos minutos
        b = asyncio.run(agente.crear(Pedido({'instruccion': 'Sigue', 'dueno': 'huella-a', 'desde_tarea': a['id']})))
        self.assertEqual(agente.TAREAS[b['id']].desde, agente.TAREAS[a['id']].desde, 'lo guardado en la vuelta anterior es de esta misión')
        c = asyncio.run(agente.crear(Pedido({'instruccion': 'Sigue', 'dueno': 'huella-b', 'desde_tarea': a['id']})))
        self.assertEqual(agente.TAREAS[c['id']].desde, agente.TAREAS[c['id']].creada, 'de otro dueño no se hereda')


class Respuesta:
    """Un Response de mentira que guarda lo que se le dio (para leer las cabeceras del frame)."""

    def __init__(self, contenido=b'', media_type=None, headers=None, status_code=200):
        self.contenido, self.media_type, self.headers, self.status_code = contenido, media_type, headers or {}, status_code


class ConEscritorio(ConEndpoints):
    """Un escritorio de mentira: xdotool solo se anota, la pantalla mide 1280x800 y el frame va por la revisión 3."""

    def setUp(self):
        super().setUp()
        self.xdo = []
        self.reales = (agente.xdotool, agente.captura, agente.miniatura, agente.Response, agente.JSONResponse,
                       dict(agente.FRAME), dict(agente.TAMANO), agente.ENTRADAS_RAFAGA, agente.ENTRADAS_POR_S)
        agente.xdotool = lambda *a: self.xdo.append(tuple(str(x) for x in a))
        self.capturas = []
        self.t = None

        def captura():
            self.capturas.append((threading.current_thread().name, bool(self.t and self.t.seguro)))
            return b'png', agente.TAMANO['ancho'], agente.TAMANO['alto']
        agente.captura = captura
        agente.miniatura = lambda png, ancho=480: 'TUlOSQ=='
        agente.Response = Respuesta
        agente.JSONResponse = lambda contenido, status_code=200: Respuesta(contenido, status_code=status_code)
        agente.FRAME.update(seq=10, ts=time.time(), ancho=1280, alto=800, rev=3)
        agente.TAMANO.update(ancho=1280, alto=800)

    def tearDown(self):
        (agente.xdotool, agente.captura, agente.miniatura, agente.Response, agente.JSONResponse, frame, tamano,
         agente.ENTRADAS_RAFAGA, agente.ENTRADAS_POR_S) = self.reales
        agente.FRAME.clear()
        agente.FRAME.update(frame)
        agente.TAMANO.update(tamano)
        agente.TAREAS.clear()
        super().tearDown()

    def con_control(self, cliente='cliente-uno'):
        t = self.tarea()
        self.t = t
        agente.TAREAS[t.id] = t
        r = agente.cambiar_control(t, True, cliente=cliente)
        t.en_espera = True  # el ciclo quieto esperando (como en esperar_si_pausada)
        return t, r['epoca']

    def entrada(self, t, epoca, seq, tipo, payload=None, cliente='cliente-uno', rev=3):
        e = agente.validar_entrada({'remoteSessionId': t.id, 'clientId': cliente, 'controlEpoch': epoca,
                                    'inputSequence': seq, 'viewportRevision': rev, 'type': tipo,
                                    'payload': payload or {}}, t.id)
        return agente.aplicar_entrada(t, e)

    def codigo(self, f):
        with self.assertRaises(agente.HTTPException) as e:
            f()
        return e.exception.status_code, str(e.exception.detail).split(':')[0]


class ContratoEntradas(ConEscritorio):
    """AUR09: cada entrada lleva sesión, cliente, época, secuencia y viewport; se confirma una por una y lo viejo,
    lo repetido, lo de otra época, otro cliente u otro viewport no toca el escritorio."""

    def test_un_toque_es_un_clic_en_pixeles_logicos_con_su_ack(self):
        t, epoca = self.con_control()
        ack = self.entrada(t, epoca, 1, 'pointer', {'accion': 'click', 'x': 640, 'y': 400})
        self.assertEqual(self.xdo, [('mousemove', '--sync', '640', '400', 'click', '1')])
        self.assertEqual((ack['secuencia'], ack['estado'], ack['frame_seq'], ack['epoca']), (1, 'hecha', 10, epoca))
        self.assertFalse(ack.get('duplicada'))
        self.assertEqual(t.pasos[-1], {**t.pasos[-1], 'accion': 'persona', 'args': {'tipo': 'pointer', 'accion': 'click'}})

    def test_repetido_no_se_hace_dos_veces_y_lo_viejo_se_rechaza(self):
        t, epoca = self.con_control()
        self.entrada(t, epoca, 1, 'pointer', {'x': 10, 'y': 10})
        otra = self.entrada(t, epoca, 1, 'pointer', {'x': 10, 'y': 10})
        self.assertTrue(otra['duplicada'], 'el mismo ACK, sin tocar otra vez')
        self.assertEqual(len(self.xdo), 1)
        self.entrada(t, epoca, 5, 'scroll', {'x': 10, 'y': 10, 'dy': 2})
        self.assertEqual(self.codigo(lambda: self.entrada(t, epoca, 4, 'pointer', {'x': 10, 'y': 10})), (409, 'secuencia_vieja'))
        self.assertEqual(len(self.xdo), 2)

    def test_tras_reconectar_lo_sin_confirmar_no_se_reproduce(self):
        t, epoca = self.con_control()
        self.entrada(t, epoca, 1, 'text_commit', {'texto': 'hola'})
        # Se cortó la red antes del ACK: el teléfono no reenvía, y si un reintento ciego llega, el nodo no lo repite.
        self.assertTrue(self.entrada(t, epoca, 1, 'text_commit', {'texto': 'hola'})['duplicada'])
        self.entrada(t, epoca, 2, 'release_all')
        self.assertEqual([x[0] for x in self.xdo], ['type'])
        self.assertTrue(self.soltadas, 'al reconectar se sueltan teclas y botones')

    def test_epoca_revocada_otro_cliente_y_la_toma_desde_otra_sesion(self):
        t, epoca = self.con_control()
        self.assertEqual(self.codigo(lambda: self.entrada(t, epoca - 1, 1, 'pointer', {'x': 1, 'y': 1})), (409, 'epoca_revocada'))
        self.assertEqual(self.codigo(lambda: self.entrada(t, epoca, 1, 'pointer', {'x': 1, 'y': 1}, cliente='cliente-dos')), (409, 'cliente'))
        antes = len(self.soltadas)
        r = agente.cambiar_control(t, True, cliente='cliente-dos')  # otro teléfono de la misma persona recupera el control
        self.assertGreater(r['epoca'], epoca)
        self.assertEqual(r['fase'], 'quiescent')
        self.assertGreater(len(self.soltadas), antes, 'al cambiar de dueño del control se sueltan teclas')
        self.assertEqual(self.codigo(lambda: self.entrada(t, epoca, 2, 'pointer', {'x': 1, 'y': 1})), (409, 'cliente'), 'el cliente viejo queda cercado')
        self.entrada(t, r['epoca'], 1, 'pointer', {'x': 1, 'y': 1}, cliente='cliente-dos')
        self.assertEqual(len(self.xdo), 1)
        # Devolver solo lo hace quien lo tiene (o la persona sin decir cliente: la voz, la app de antes).
        self.assertEqual(self.codigo(lambda: agente.cambiar_control(t, False, cliente='cliente-uno')), (409, 'cliente'))
        self.assertEqual(self.codigo(lambda: agente.cambiar_control(t, True, cliente='cliente-dos', epoca_esperada=r['epoca'] + 7)), (409, 'epoca_cambio'))

    def test_coordenadas_de_otro_viewport_no_tocan(self):
        t, epoca = self.con_control()
        self.assertEqual(self.codigo(lambda: self.entrada(t, epoca, 1, 'pointer', {'x': 10, 'y': 10}, rev=2)), (409, 'viewport'))
        self.assertEqual(self.codigo(lambda: self.entrada(t, epoca, 2, 'pointer', {'x': 1280, 'y': 10})), (409, 'viewport'))
        agente.TAMANO.update(ancho=1920, alto=1080)  # el escritorio cambió de tamaño y la persona no lo ha visto
        self.assertEqual(self.codigo(lambda: self.entrada(t, epoca, 3, 'scroll', {'x': 10, 'y': 10, 'dy': 1})), (409, 'viewport'))
        self.entrada(t, epoca, 4, 'key', {'tecla': 'tab'})  # una tecla no lleva coordenadas
        self.assertEqual(self.xdo, [('key', '--clearmodifiers', 'Tab')])

    def test_arrastre_scroll_teclas_combinaciones_y_texto(self):
        t, epoca = self.con_control()
        n = iter(range(1, 100))
        self.entrada(t, epoca, next(n), 'pointer', {'accion': 'arrastre', 'x': 100, 'y': 100, 'x2': 300, 'y2': 200})
        self.assertIn('mousedown', self.xdo[-1])
        self.assertIn('mouseup', self.xdo[-1])
        self.entrada(t, epoca, next(n), 'pointer', {'accion': 'doble', 'x': 5, 'y': 6})
        self.assertEqual(self.xdo[-1], ('mousemove', '--sync', '5', '6', 'click', '--repeat', '2', '--delay', '120', '1'))
        self.entrada(t, epoca, next(n), 'pointer', {'accion': 'derecho', 'x': 5, 'y': 6})
        self.assertEqual(self.xdo[-1][-1], '3')
        self.entrada(t, epoca, next(n), 'pointer', {'accion': 'click', 'x': 5, 'y': 6, 'mods': ['shift']})
        self.assertEqual(self.xdo[-1], ('mousemove', '--sync', '5', '6', 'keydown', 'shift', 'click', '1', 'keyup', 'shift'))
        self.entrada(t, epoca, next(n), 'scroll', {'x': 640, 'y': 400, 'dy': 3})
        self.assertEqual(self.xdo[-1], ('mousemove', '--sync', '640', '400', 'click', '--repeat', '3', '5'))
        self.entrada(t, epoca, next(n), 'scroll', {'x': 640, 'y': 400, 'dy': -2})
        self.assertEqual(self.xdo[-1][-1], '4')
        for tecla, mods, xdo in (('enter', [], 'Return'), ('escape', [], 'Escape'), ('backspace', [], 'BackSpace'),
                                 ('delete', [], 'Delete'), ('left', [], 'Left'), ('c', ['ctrl'], 'ctrl+c'),
                                 ('tab', ['shift'], 'shift+Tab'), ('left', ['alt'], 'alt+Left'), ('z', ['ctrl', 'shift'], 'ctrl+shift+z')):
            self.entrada(t, epoca, next(n), 'key', {'tecla': tecla, 'mods': mods})
            self.assertEqual(self.xdo[-1], ('key', '--clearmodifiers', xdo), tecla)
        texto = 'Árbol, ñandú y café 😀👨‍👩‍👧'
        self.entrada(t, epoca, next(n), 'text_commit', {'texto': texto})
        self.assertEqual(self.xdo[-1], ('type', '--delay', '12', '--', texto))
        # Acentos que llegan descompuestos (e + ´) se escriben compuestos: una sola letra.
        self.entrada(t, epoca, next(n), 'text_commit', {'texto': 'café'})
        self.assertEqual(self.xdo[-1][-1], 'café')
        hechas = len(self.xdo)
        for malo in ({'type': 'key', 'payload': {'tecla': 'c'}},                       # una letra va como texto
                     {'type': 'key', 'payload': {'tecla': 'delete', 'mods': ['ctrl', 'alt']}},
                     {'type': 'key', 'payload': {'tecla': 'super'}},
                     {'type': 'key', 'payload': {'tecla': 'q', 'mods': ['ctrl']}},
                     {'type': 'text_commit', 'payload': {'texto': 'dos\nlíneas'}},
                     {'type': 'text_commit', 'payload': {'texto': 'x' * 501}},
                     {'type': 'text_commit', 'payload': {'texto': ''}},
                     {'type': 'scroll', 'payload': {'x': 1, 'y': 1, 'dy': 0}},
                     {'type': 'pointer', 'payload': {'accion': 'arrastre', 'x': 1, 'y': 1}},
                     {'type': 'pointer', 'payload': {'x': -1, 'y': 1}},
                     {'type': 'pointer', 'payload': {'x': 1.5, 'y': 1}},
                     {'type': 'borrar_disco', 'payload': {}}):
            cuerpo = {'remoteSessionId': t.id, 'clientId': 'cliente-uno', 'controlEpoch': epoca, 'inputSequence': 99,
                      'viewportRevision': 3, **malo}
            self.assertEqual(self.codigo(lambda: agente.validar_entrada(cuerpo, t.id)), (400, 'entrada_invalida'), malo)
        base = {'clientId': 'cliente-uno', 'controlEpoch': epoca, 'inputSequence': 99, 'viewportRevision': 3, 'type': 'release_all', 'payload': {}}
        self.assertEqual(self.codigo(lambda: agente.validar_entrada({**base, 'remoteSessionId': 'otra'}, t.id))[0], 400)
        self.assertEqual(self.codigo(lambda: agente.validar_entrada({**base, 'remoteSessionId': t.id, 'inputSequence': True}, t.id))[0], 400)
        self.assertEqual(len(self.xdo), hechas, 'nada de eso tocó el escritorio')

    def test_un_error_a_medias_suelta_teclas_y_queda_incierto(self):
        t, epoca = self.con_control()

        def rota(*a):
            raise RuntimeError('xdotool se cortó')
        agente.xdotool = rota
        antes = len(self.soltadas)
        self.assertEqual(self.codigo(lambda: self.entrada(t, epoca, 1, 'key', {'tecla': 'c', 'mods': ['ctrl']})), (502, 'incierta'))
        self.assertGreater(len(self.soltadas), antes)
        self.assertEqual(t.ultima_op['estado'], 'incierta')

    def test_la_app_de_antes_no_entra_si_el_control_es_de_un_cliente(self):
        t, _ = self.con_control()
        with self.assertRaises(agente.HTTPException) as e:
            agente.accion_persona(t, {'tipo': 'click', 'x': 1, 'y': 1})
        self.assertEqual(e.exception.status_code, 409)
        # Sin cliente (la app de antes tomó el control): la acción de antes sigue funcionando.
        t2 = self.tarea()
        agente.cambiar_control(t2, True)
        t2.en_espera = True
        agente.accion_persona(t2, {'tipo': 'click', 'x': 500, 'y': 500})
        self.assertEqual(self.hechas, [('click', {'x': 500, 'y': 500})])

    def test_tasa_y_sin_control(self):
        agente.ENTRADAS_RAFAGA, agente.ENTRADAS_POR_S = 3, 0.001
        t, epoca = self.con_control()
        for s in (1, 2, 3):
            self.entrada(t, epoca, s, 'key', {'tecla': 'tab'})
        self.assertEqual(self.codigo(lambda: self.entrada(t, epoca, 4, 'key', {'tecla': 'tab'})), (429, 'tasa'))
        agente.cambiar_control(t, False, cliente='cliente-uno')
        self.assertEqual(self.codigo(lambda: self.entrada(t, epoca, 5, 'key', {'tecla': 'tab'}))[0], 409)
        self.assertEqual(len(self.xdo), 3)

    def test_pausar_con_el_control_no_le_quita_el_control(self):
        t, epoca = self.con_control()
        agente.pausar(t.id, None)
        self.assertEqual(t.epoca, epoca, 'pausar con la persona al mando no cambia la época de su control')
        self.entrada(t, epoca, 1, 'key', {'tecla': 'tab'})
        self.assertEqual(len(self.xdo), 1)


class FrameYFrescura(ConEscritorio):
    def test_cada_captura_dice_su_secuencia_hora_tamano_y_viewport(self):
        t, _ = self.con_control()
        a = agente.pantalla_tarea(t.id, None)
        b = agente.pantalla_tarea(t.id, None)
        self.assertEqual(a.media_type, 'image/jpeg')
        self.assertEqual(int(b.headers['X-Frame-Seq']), int(a.headers['X-Frame-Seq']) + 1)
        self.assertEqual((a.headers['X-Frame-Ancho'], a.headers['X-Frame-Alto'], a.headers['X-Viewport-Rev']), ('1280', '800', '3'))
        self.assertLessEqual(abs(float(a.headers['X-Frame-Ts']) - time.time()), 2)
        self.assertEqual(a.headers['X-Control-Epoca'], str(t.epoca))
        self.assertEqual(a.headers['Cache-Control'], 'no-store')
        self.assertEqual(a.headers['X-Privado'], '0')
        agente.TAMANO.update(ancho=1024, alto=768)
        c = agente.pantalla_tarea(t.id, None)
        self.assertEqual((c.headers['X-Frame-Ancho'], c.headers['X-Viewport-Rev']), ('1024', '4'), 'otro tamaño: otra revisión')

    def test_novnc_cerrado_y_sin_puerto(self):
        import asyncio
        with self.assertRaises(agente.HTTPException) as e:
            asyncio.run(agente.vista(Pedido({'tomar_control': True})))
        self.assertEqual(e.exception.status_code, 410)
        agente.VISTAS['una-llave'] = time.time() + 999  # una llave vieja que hubiera quedado
        r = agente.permitir(types.SimpleNamespace(headers={'x-forwarded-uri': '/vista/una-llave/vnc.html'}))
        self.assertEqual(r.status_code, 403, 'ninguna llave abre noVNC: no hay entradas por fuera del árbitro')
        aqui = os.path.dirname(os.path.abspath(__file__))
        for archivo in ('agente.py', 'instalar.sh'):
            with open(os.path.join(aqui, archivo), encoding='utf-8') as f:
                self.assertNotIn('6080:6080', f.read(), f'{archivo} no publica el puerto de noVNC')


class EntradaSegura(ConEscritorio):
    """AUR09: con la entrada segura el agente no toca ni mira; lo del intervalo no se guarda ni le llega al modelo
    después, y se sale solo con una pantalla nueva y devolviendo el control a propósito."""

    SECRETO = 'Clave-Sintetica-9f3Q!'

    def test_secreto_sintetico_no_aparece_en_pasos_contexto_ni_capturas(self):
        t, vistos = CicloGratis.correr_con(self, [('open_url', {'url': 'banco.hn'}), ('answer', {'content': 'Listo: entré.'})])
        agente.captura = self.captura_espia(t)
        agente.TAREAS[t.id] = t
        self.t = t
        crear = agente.cliente.chat.completions.create
        hecho = {}

        def pensando(**k):
            resp = crear(**k)
            if 'r' not in hecho:
                hecho['r'] = agente.cambiar_control(t, True, cliente='cliente-uno')  # toma el control mientras piensa
                threading.Thread(target=persona, daemon=True, name='persona').start()
            return resp

        def persona():
            r = hecho['r']
            fin = time.time() + 3
            while not t.en_espera and time.time() < fin:
                time.sleep(0.005)
            agente.cambiar_seguro(t, True, cliente='cliente-uno')
            hecho['estado_seguro'] = t.resumen()['seguro']
            self.entrada(t, r['epoca'], 1, 'pointer', {'x': 300, 'y': 200})
            self.entrada(t, r['epoca'], 2, 'text_commit', {'texto': self.SECRETO})
            # Salir sin mirar la pantalla de ahora no vale; devolver el control en modo seguro tampoco.
            hecho['sin_frame'] = self.codigo(lambda: agente.cambiar_seguro(t, False, cliente='cliente-uno', frame_seq=agente.FRAME['seq']))
            hecho['devolver'] = self.codigo(lambda: agente.cambiar_control(t, False, cliente='cliente-uno'))
            hecho['reanudar'] = self.codigo(lambda: agente.reanudar(t.id, None))
            hecho['global'] = self.codigo(lambda: agente.pantalla(None))
            vista = agente.pantalla_tarea(t.id, None)  # la persona ve su pantalla (privada: no se guarda)
            hecho['privado'] = vista.headers['X-Privado']
            agente.cambiar_seguro(t, False, cliente='cliente-uno', frame_seq=int(vista.headers['X-Frame-Seq']))
            agente.cambiar_control(t, False, cliente='cliente-uno')
        agente.cliente.chat.completions.create = pensando
        agente.correr(t)
        self.assertEqual(t.estado, 'hecha')
        self.assertTrue(hecho['estado_seguro'])
        self.assertEqual(hecho['sin_frame'], (409, 'frame_viejo'))
        self.assertEqual(hecho['devolver'], (409, 'seguro'))
        self.assertEqual(hecho['reanudar'], (409, 'seguro'))
        self.assertEqual(hecho['global'][0], 423)
        self.assertEqual(hecho['privado'], '1')
        # Lo del modelo nunca se capturó en modo seguro; la única captura privada fue la que vio la persona.
        self.assertEqual([c for c in self.capturas if c[1] and c[0] != 'persona'], [])
        self.assertEqual(len([c for c in self.capturas if c[1]]), 1)
        # El secreto no está en los pasos, el resumen, las notas ni en nada de lo que vio el modelo.
        todo = repr(t.resumen(True)) + repr(t.notas) + repr(vistos) + repr(t.escrito)
        self.assertNotIn(self.SECRETO, todo)
        self.assertNotIn(str(len(self.SECRETO)), repr([p.get('args') for p in t.pasos if p['accion'] == 'persona']), 'ni su largo')
        self.assertIn(('type', '--delay', '12', '--', self.SECRETO), self.xdo, 'sí se escribió en la computadora')
        acciones = [p['accion'] for p in t.pasos]
        self.assertIn('modo_seguro', acciones)
        self.assertFalse([p for p in t.pasos if p['accion'] == 'persona' and p.get('t') is not None and p['args'].get('tipo') == 'texto'],
                         'lo de la persona en modo seguro no se anota')
        # Al volver, el modelo sabe que hubo algo privado (sin el contenido) y mira una pantalla nueva.
        ultima = vistos[-1]
        self.assertTrue(any(agente.NOTA_SEGURO == m.get('content') for m in ultima))

    def captura_espia(self, t):
        def captura():
            self.capturas.append((threading.current_thread().name, bool(t.seguro)))
            return b'png', 1280, 800
        return captura


class ArchivosComprobados(Base):
    """Revisión externa (4-oct): «"Listo" puede marcar entregables como comprobados aunque los archivos no existan».
    Al terminar, el NODO mira él mismo su espacio de trabajo (find, stat y sha256sum dentro del escritorio) y lo cuenta
    en `archivos`; nunca lo saca del texto del modelo. Aquí el escritorio es una carpeta temporal y los comandos corren
    con sh de verdad (el mismo comando que va por docker exec)."""

    def setUp(self):
        super().setUp()
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.espacio = os.path.realpath(self.tmp.name)
        self.reales_archivos = (agente.ESPACIO_TRABAJO, agente.en_escritorio)
        agente.ESPACIO_TRABAJO = self.espacio
        self.comandos = []

        def en_escritorio(comando, entrada=None, timeout=30):
            import subprocess
            self.comandos.append(comando)
            r = subprocess.run(['sh', '-c', comando], input=entrada, capture_output=True, timeout=timeout)
            if r.returncode != 0:
                raise RuntimeError(r.stderr.decode('utf-8', 'ignore')[:300] or f'código {r.returncode}')
            return r.stdout
        agente.en_escritorio = en_escritorio

    def tearDown(self):
        agente.ESPACIO_TRABAJO, agente.en_escritorio = self.reales_archivos
        self.tmp.cleanup()
        super().tearDown()

    def escribir(self, relativa, contenido=b'contenido', hace_s=0):
        ruta = os.path.join(self.espacio, relativa)
        os.makedirs(os.path.dirname(ruta), exist_ok=True)
        with open(ruta, 'wb') as f:
            f.write(contenido)
        if hace_s:
            os.utime(ruta, (time.time() - hace_s, time.time() - hace_s))
        return ruta

    def correr_y_archivos(self, respuesta, instruccion='Crea un documento informe.odt con el resumen y guárdalo', antes=None):
        t, _ = CicloGratis.correr_con(self, [('answer', {'content': respuesta})], instruccion)
        if antes:
            antes(t)
        agente.correr(t)
        self.assertEqual(t.estado, 'hecha')
        return t.resumen()

    def test_dijo_listo_y_el_archivo_no_existe(self):
        r = self.correr_y_archivos('Listo, guardé el archivo informe.odt en Documentos.')
        self.assertIsNone(r['archivos_error'])
        self.assertEqual(r['archivos'], [{'ruta': 'informe.odt', 'existe': False, 'bytes': 0, 'sha256': None, 'mencionado': True}],
                         'decir que lo guardó no lo hace existir: el nodo lo buscó y no está')

    def test_el_archivo_real_trae_bytes_y_sha256(self):
        import hashlib
        rutas = {}
        r = self.correr_y_archivos('Listo, guardé el archivo informe.odt en Documentos.',
                                   antes=lambda t: rutas.update(r=self.escribir('Documents/informe.odt', b'hola mundo')))
        self.assertEqual(r['archivos'], [{'ruta': rutas['r'], 'existe': True, 'bytes': 10,
                                          'sha256': hashlib.sha256(b'hola mundo').hexdigest(), 'reciente': True, 'mencionado': True,
                                          # Se llama .odt pero por dentro es texto: el nodo dice lo que ES, no lo que dice el nombre.
                                          'tipo': 'texto', 'magia': b'hola mun'.hex()}])

    def test_lo_nuevo_sin_nombrar_cuenta_y_lo_oculto_o_viejo_no(self):
        def antes(t):
            self.escribir('Downloads/precios.csv', b'a,b\n1,2\n')
            self.escribir('.mozilla/perfil/cookies.sqlite', b'x')
            self.escribir('viejo.txt', b'de antes', hace_s=3600)
        r = self.correr_y_archivos('Listo, ya quedó.', instruccion='Descarga la tabla de precios', antes=antes)
        self.assertEqual([(os.path.relpath(a['ruta'], self.espacio), a['reciente'], a['mencionado']) for a in r['archivos']],
                         [('Downloads/precios.csv', True, False)], 'solo lo de esta misión, sin lo oculto ni lo viejo')

    def test_un_archivo_viejo_que_nombra_no_es_de_esta_mision(self):
        r = self.correr_y_archivos('Listo, guardé el archivo informe.odt.', antes=lambda t: self.escribir('informe.odt', b'de ayer', hace_s=7200))
        self.assertEqual(len(r['archivos']), 1)
        self.assertTrue(r['archivos'][0]['existe'])
        self.assertFalse(r['archivos'][0]['reciente'], 'ya estaba antes: no lo hizo esta misión')

    def test_fuera_del_espacio_no_se_mira_ni_un_enlace_que_sale(self):
        import tempfile
        fuera = tempfile.NamedTemporaryFile(suffix='.txt', delete=False)
        fuera.write(b'secreto')
        fuera.close()
        try:
            def antes(t):
                os.symlink(fuera.name, os.path.join(self.espacio, 'enlace.txt'))
            r = self.correr_y_archivos(f'Listo, guardé {fuera.name}, ../secreto.txt y enlace.txt.', antes=antes)
            por_ruta = {a['ruta']: a for a in r['archivos']}
            self.assertEqual(por_ruta[fuera.name], {'ruta': fuera.name, 'existe': False, 'bytes': 0, 'sha256': None, 'mencionado': True, 'fuera': True})
            self.assertEqual(por_ruta['../secreto.txt']['fuera'], True)
            self.assertFalse(por_ruta['enlace.txt']['existe'], 'un enlace a algo de fuera no cuenta como archivo del espacio')
            self.assertFalse(any(fuera.name in c for c in self.comandos), 'lo de fuera ni se le pregunta al escritorio')
        finally:
            os.unlink(fuera.name)

    def test_sin_escritorio_no_se_comprueba_y_lo_dice(self):
        def roto(*_a, **_k):
            raise RuntimeError('docker: no such container')
        agente.en_escritorio = roto
        r = self.correr_y_archivos('Listo, guardé el archivo informe.odt.')
        self.assertIsNone(r['archivos'], 'sin comprobar no es «no hay archivos»')
        self.assertIn('docker', r['archivos_error'])

    # ---- RESULTADOS REALMENTE COMPROBADOS (revisión externa): tres documentos pedidos, uno por uno, con su tipo
    # comprobado por dentro (bytes mágicos), no por la extensión ni por lo que dice el modelo.

    TRES = 'Crea tres documentos: informe.docx, presupuesto.xlsx y carta.pdf, y guárdalos en Documents'

    @staticmethod
    def ooxml(raiz):
        import io
        import zipfile
        b = io.BytesIO()
        with zipfile.ZipFile(b, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('[Content_Types].xml', '<Types/>')
            z.writestr(f'{raiz}', '<x/>')
        return b.getvalue()

    @staticmethod
    def odf(mime):
        import io
        import zipfile
        b = io.BytesIO()
        with zipfile.ZipFile(b, 'w') as z:
            z.writestr(zipfile.ZipInfo('mimetype'), mime, compress_type=zipfile.ZIP_STORED)
            z.writestr('content.xml', '<x/>', compress_type=zipfile.ZIP_DEFLATED)
        return b.getvalue()

    PDF = b'%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n'
    PNG = b'\x89PNG\r\n\x1a\n' + b'\x00\x00\x00\rIHDR' + b'\x00' * 20

    def por_nombre(self, r):
        return {posixpath.basename(a['ruta']): a for a in r['archivos']}

    def test_tres_documentos_a_ninguno(self):
        r = self.correr_y_archivos('Listo, ya quedaron los 3 archivos.', instruccion=self.TRES)
        n = self.por_nombre(r)
        self.assertEqual(sorted(n), ['carta.pdf', 'informe.docx', 'presupuesto.xlsx'])
        self.assertTrue(all(a['existe'] is False and a['mencionado'] for a in n.values()), 'los tres se buscaron y no están')

    def test_tres_documentos_b_uno_de_tres(self):
        r = self.correr_y_archivos('Listo, ya quedaron los 3 archivos.', instruccion=self.TRES,
                                   antes=lambda t: self.escribir('Documents/informe.docx', self.ooxml('word/document.xml')))
        n = self.por_nombre(r)
        self.assertEqual((n['informe.docx']['existe'], n['informe.docx']['tipo']), (True, 'docx'))
        self.assertFalse(n['presupuesto.xlsx']['existe'])
        self.assertFalse(n['carta.pdf']['existe'])

    def test_tres_documentos_c_archivos_equivocados(self):
        def antes(t):
            self.escribir('runtime.log', b'2026-10-04 INFO arranque\n')
            self.escribir('random.txt', b'hola')
            self.escribir('foto.png', self.PNG)
        r = self.correr_y_archivos('Listo, ya quedaron los 3 archivos.', instruccion=self.TRES, antes=antes)
        n = self.por_nombre(r)
        self.assertEqual({k: (a['existe'], a.get('mencionado'), a.get('tipo')) for k, a in n.items()}, {
            'informe.docx': (False, True, None), 'presupuesto.xlsx': (False, True, None), 'carta.pdf': (False, True, None),
            'runtime.log': (True, False, 'texto'), 'random.txt': (True, False, 'texto'), 'foto.png': (True, False, 'png'),
        }, 'lo nuevo se cuenta como lo que es, sin hacerlo pasar por lo pedido')

    def test_tres_documentos_d_incompletos(self):
        def antes(t):
            self.escribir('Documents/informe.docx', self.ooxml('word/document.xml'), hace_s=7200)  # de antes
            self.escribir('Documents/presupuesto.xlsx', b'')                                  # vacío
            self.escribir('Documents/carta.pdf', b'esto no es un pdf, es texto')               # otro tipo
        r = self.correr_y_archivos('Listo, ya quedaron los 3 archivos.', instruccion=self.TRES, antes=antes)
        n = self.por_nombre(r)
        self.assertFalse(n['informe.docx']['reciente'], 'ya estaba antes de la misión')
        self.assertEqual((n['presupuesto.xlsx']['bytes'], n['presupuesto.xlsx']['tipo']), (0, 'vacio'))
        self.assertEqual(n['carta.pdf']['tipo'], 'texto', 'la extensión dice pdf; por dentro es texto')
        self.assertEqual(len(n['carta.pdf']['magia']), 16, 'los primeros 8 bytes, en hex')

    def test_tres_documentos_d_fuera_del_espacio(self):
        r = self.correr_y_archivos('Listo.', instruccion='Crea informe.docx, presupuesto.xlsx y /tmp/carta.pdf',
                                   antes=lambda t: self.escribir('carta.pdf', self.PDF))
        fuera = [a for a in r['archivos'] if a['ruta'] == '/tmp/carta.pdf']
        self.assertEqual(len(fuera), 1)
        self.assertTrue(fuera[0]['fuera'])
        self.assertFalse(fuera[0]['existe'])

    def test_tres_documentos_e_los_tres_correctos(self):
        import hashlib
        cont = {'informe.docx': self.ooxml('word/document.xml'), 'presupuesto.xlsx': self.ooxml('xl/workbook.xml'), 'carta.pdf': self.PDF}

        def antes(t):
            for k, v in cont.items():
                self.escribir(f'Documents/{k}', v)
        r = self.correr_y_archivos('Listo, ya quedaron los 3 archivos.', instruccion=self.TRES, antes=antes)
        n = self.por_nombre(r)
        self.assertEqual(sorted(n), ['carta.pdf', 'informe.docx', 'presupuesto.xlsx'])
        for k, v in cont.items():
            a = n[k]
            self.assertEqual((a['existe'], a['reciente'], a['mencionado'], a['bytes'], a['sha256']),
                             (True, True, True, len(v), hashlib.sha256(v).hexdigest()), k)
        self.assertEqual({k: a['tipo'] for k, a in n.items()}, {'informe.docx': 'docx', 'presupuesto.xlsx': 'xlsx', 'carta.pdf': 'pdf'})
        self.assertEqual(n['carta.pdf']['magia'], self.PDF[:8].hex())

    def test_tipos_por_dentro(self):
        casos = {
            'a.pdf': (self.PDF, 'pdf'), 'b.png': (self.PNG, 'png'), 'c.jpg': (b'\xff\xd8\xff\xe0' + b'\x00' * 30, 'jpeg'),
            'd.odt': (self.odf('application/vnd.oasis.opendocument.text'), 'odt'),
            'e.ods': (self.odf('application/vnd.oasis.opendocument.spreadsheet'), 'ods'),
            'f.pptx': (self.ooxml('ppt/presentation.xml'), 'pptx'), 'g.zip': (self.ooxml('otra/cosa.xml'), 'zip'),
            'h.csv': ('nombre,monto\nAna,10\nBea,ñ\n'.encode('utf-8'), 'texto'), 'i.doc': (b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1' + b'\x00' * 30, 'ole'),
            'j.bin': (b'\x00\x01\x02\x03' * 10, 'binario'), 'k.rtf': (b'{\\rtf1\\ansi hola}', 'rtf'),
        }

        def antes(t):
            for k, (v, _) in casos.items():
                self.escribir(k, v)
        r = self.correr_y_archivos('Listo.', instruccion='Guarda los archivos', antes=antes)
        self.assertEqual({k: a['tipo'] for k, a in self.por_nombre(r).items()}, {k: v[1] for k, v in casos.items()})

    def test_cantidad_tres_pdfs(self):
        def antes(t):
            self.escribir('Downloads/f1.pdf', self.PDF)
            self.escribir('Downloads/f2.pdf', self.PDF + b'2')
            self.escribir('Downloads/f3.pdf', b'no soy pdf')
            self.escribir('runtime.log', b'log')
        r = self.correr_y_archivos('Listo, guardé 3 PDFs.', instruccion='Descarga las facturas y guarda 3 PDFs en Downloads', antes=antes)
        self.assertEqual({k: a['tipo'] for k, a in self.por_nombre(r).items()},
                         {'f1.pdf': 'pdf', 'f2.pdf': 'pdf', 'f3.pdf': 'texto', 'runtime.log': 'texto'})

    def test_hasta_veinte_nombres_como_el_servidor(self):
        """Ronda 4: el nodo busca tantos nombres como cuenta (ARCHIVOS_MAX), no solo 8."""
        nombres = [f'doc{i:02d}.txt' for i in range(12)]
        r = self.correr_y_archivos('Listo.', instruccion='Crea ' + ', '.join(nombres),
                                   antes=lambda t: [self.escribir(f'Documents/{n}', f'contenido {n}'.encode()) for n in nombres])
        n = self.por_nombre(r)
        self.assertEqual(sorted(k for k, a in n.items() if a['existe'] and a['mencionado']), nombres)
        self.assertEqual(len(agente.rutas_mencionadas(' '.join(f'a{i}.pdf' for i in range(30)))), agente.ARCHIVOS_MAX)

    def test_mayusculas_como_el_servidor(self):
        """Ronda 4: el servidor compara los nombres sin distinguir mayúsculas; el nodo también («Informe.PDF» es informe.pdf)."""
        r = self.correr_y_archivos('Listo.', instruccion='Guarda Informe.PDF en Documents',
                                   antes=lambda t: self.escribir('Documents/informe.pdf', self.PDF))
        self.assertEqual([(posixpath.basename(a['ruta']), a['existe'], a['mencionado']) for a in r['archivos']], [('informe.pdf', True, True)])
        self.assertEqual(agente.rutas_mencionadas('Crea informe.pdf e INFORME.PDF'), ['informe.pdf'])

    def test_nombres_con_acentos_parentesis_y_comillas_como_el_servidor(self):
        """Ronda 5: «cotización.xlsx» entero, «reporte (1).pdf», y lo de comillas completo con espacios."""
        self.assertEqual(agente.rutas_mencionadas('Crea cotización.xlsx, reporte (1).pdf, reporte (versión final).docx y «informe final.pdf»'),
                         ['cotización.xlsx', 'reporte (1).pdf', 'reporte (versión final).docx', 'informe final.pdf'])
        r = self.correr_y_archivos('Listo.', instruccion='Crea «informe final.pdf» y cotización.xlsx',
                                   antes=lambda t: (self.escribir('Documents/informe final.pdf', self.PDF), self.escribir('Documents/cotización.xlsx', self.ooxml('xl/workbook.xml'))))
        n = self.por_nombre(r)
        self.assertEqual({k: (a['existe'], a['mencionado'], a['tipo']) for k, a in n.items()},
                         {'informe final.pdf': (True, True, 'pdf'), 'cotización.xlsx': (True, True, 'xlsx')})

    def test_lo_que_nombra_sale_de_la_instruccion_y_la_respuesta_no_de_una_url(self):
        self.assertEqual(agente.rutas_mencionadas('Guarda la tabla en ~/Documents/precios.ods',
                                                  'Listo. Fuente: https://bch.hn/datos/tabla.csv y copia en resumen.txt.'),
                         ['~/Documents/precios.ods', 'resumen.txt'])


class PermisoSinClase(ConEndpoints):
    """Permisos exactos (revisión externa, 4-oct): un sí NUNCA vale por la CLASE de la acción. El sí libre que el modelo
    pide con su pregunta («¿Envío el mensaje a Ana?») no nombra la operación exacta (qué elemento, a quién, con qué
    texto, en qué página): no autoriza ningún toque sensible. Lo sensible se pregunta en el punto del efecto con la
    operación exacta, y ese sí se canjea una sola vez."""

    def test_el_si_libre_para_ana_no_envia_en_el_chat_de_bruno(self):
        t, vistos = CicloGratis.correr_con(self, [
            ('ask_user_confirmation', {'question': '¿Envío el mensaje a Ana?'}),
            ('click', {'element': 'Chat de Bruno', 'x': 100, 'y': 200}),
            ('click', {'element': 'Botón Enviar', 'x': 500, 'y': 700}),
            ('answer', {'content': 'No lo envié.'}),
        ], instruccion='Abre el chat y mándale el mensaje a Ana')
        preguntas = contestar_en_orden(t, [True, False])
        agente.correr(t)
        self.assertEqual(clics_en(self.hechas, 'Botón Enviar'), [], 'el sí para Ana no envía en el chat de Bruno (misma clase: enviar)')
        self.assertEqual(len(preguntas), 2, 'el toque sensible pide su propia decisión, con la operación exacta')
        self.assertIn('Botón Enviar', preguntas[1])

    def test_un_si_libre_no_cubre_un_toque_de_su_clase(self):
        t = self.tarea()
        contestar_cuando_pregunte(t, True)
        self.assertTrue(t.pedir_confirmacion('¿Envío el formulario?'))
        preguntas = contestar_en_orden(t, [False])
        self.assertEqual(agente.revisar_accion(t, 'click', {'element': 'Enviar'}), agente.NO_DIJO,
                         'enviar es la clase que se preguntó, pero no la operación: se pregunta otra vez')
        self.assertEqual(preguntas, ['Voy a tocar «Enviar». ¿Lo hago?'])
        self.assertEqual(self.hechas, [])

    def test_sin_destino_resuelto_la_pregunta_libre_no_cubre_nada(self):
        # La pregunta nombra a «Ana» (un nombre, no un correo ni un teléfono): destinos vacíos. Antes, un envío sin
        # destino a la vista (vacío ⊆ vacío) quedaba cubierto por ese sí.
        t = self.tarea()
        contestar_cuando_pregunte(t, True)
        t.pedir_confirmacion('¿Le mando el mensaje a Ana?')
        self.assertIsNone(t.permiso.get('op'), 'el sí libre no nombra ninguna operación')
        self.assertFalse(agente.cubre(t.permiso, agente.operacion(t, 'click', {}, 'Botón Enviar', frozenset({'enviar'})), t))

    def test_la_operacion_exacta_aprobada_se_hace_una_sola_vez(self):
        t = self.tarea()
        preguntas = contestar_en_orden(t, [True, False])
        self.assertIsNone(agente.revisar_accion(t, 'click', {'element': 'Botón Enviar a ana@example.test'}))
        s, t.por_hacer = t.por_hacer, None
        hechos = []
        self.assertTrue(agente.efecto_modelo(t, t.epoca, lambda: hechos.append(1) or 'Done.', sensible=s)[1])
        self.assertFalse(agente.efecto_modelo(t, t.epoca, lambda: hechos.append(1) or 'Done.', sensible=s)[1], 'el mismo sí no se canjea dos veces')
        self.assertEqual(agente.revisar_accion(t, 'click', {'element': 'Botón Enviar a ana@example.test'}), agente.NO_DIJO, 'repetirlo pide otro sí')
        self.assertEqual(hechos, [1])
        self.assertEqual(len(preguntas), 2)


if __name__ == '__main__':
    unittest.main()
