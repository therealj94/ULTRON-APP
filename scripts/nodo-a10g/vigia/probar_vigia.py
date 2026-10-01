"""Pruebas del vigía con un nodo falso: qué reinicia, qué aprende y cuándo se frena."""
import importlib
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import vigia  # noqa: E402



class NodoFalso:
    """Capas que se caen a pedido; un reinicio las levanta si ese servicio es la cura."""

    def __init__(self, t=1_000_000.0):
        self.t = t
        self.caidas = {}          # capa -> servicio que la cura
        self.tarda = {}           # servicio -> segundos que tarda en volver
        self.volvera = {}         # capa -> instante en que vuelve
        self.reinicios = []
        self.senal = {'cola_8443': 0.0, 'ram_pct': 60.0}

    def ahora(self):
        return self.t

    def dormir(self, s):
        self.t += s

    def probar(self, capa):
        if capa in self.volvera and self.t >= self.volvera[capa]:
            del self.volvera[capa]
            self.caidas.pop(capa, None)
        return capa not in self.caidas

    def senales(self):
        return dict(self.senal)

    def reiniciar(self, servicio):
        self.reinicios.append(servicio)
        for capa, cura in list(self.caidas.items()):
            if cura == servicio:
                self.volvera[capa] = self.t + self.tarda.get(servicio, 2)
        return True

    def minuto(self):
        self.t += 60


class Vigia(unittest.TestCase):
    def setUp(self):
        self.e = vigia.estado_vacio()
        self.n = NodoFalso()

    def vueltas(self, k):
        for _ in range(k):
            vigia.vuelta(self.e, self.n)
            self.n.minuto()

    def test_sano_no_toca_nada(self):
        self.vueltas(5)
        self.assertEqual(self.n.reinicios, [])
        self.assertEqual(self.e['incidentes'], [])

    def test_motor_sordo_se_levanta_en_la_misma_vuelta(self):
        self.n.caidas['motor'] = 'ultron-motor'
        r = vigia.vuelta(self.e, self.n)
        self.assertEqual(self.n.reinicios, ['ultron-motor'], 'se remira a los 15 s y se confirma')
        self.assertTrue(self.n.probar('motor'))
        self.assertEqual(r['motor'], True, 'el resumen dice cómo quedó, no cómo estaba')
        self.assertTrue(vigia.resumen(self.e, r, self.n.t)['sano'])
        inc = self.e['incidentes'][-1]
        self.assertEqual(inc['sintoma'], 'motor_mudo')
        self.assertEqual(inc['resuelto'], 'ultron-motor')
        self.assertEqual(self.e['remedios']['motor_mudo']['ultron-motor'], {'intentos': 1, 'exitos': 1})

    def test_parpadeo_no_reinicia(self):
        self.n.caidas['mesa'] = 'qwen-proxy'
        self.n.volvera['mesa'] = self.n.t + 10  # vuelve sola antes de que se la remire
        self.vueltas(2)
        self.assertEqual(self.n.reinicios, [])
        self.assertEqual(self.e['fallas'].get('mesa_muda'), 0)

    def test_aprende_que_remedio_sirve(self):
        # El puente mudo se cura reiniciando llama, no el puente: después de aprenderlo, va directo.
        for _ in range(3):
            self.n.caidas['puente'] = 'llama-ultron'
            self.n.tarda['llama-ultron'] = 9
            self.vueltas(3)
            self.n.t += 3600  # que no frene el tope por hora
        self.assertEqual(vigia.orden_remedios(self.e, 'puente_mudo')[0], 'llama-ultron')
        self.n.reinicios.clear()
        self.n.caidas['puente'] = 'llama-ultron'
        self.vueltas(2)
        self.assertEqual(self.n.reinicios, ['llama-ultron'])

    def test_aprende_cuanto_tarda_en_volver(self):
        self.n.caidas['llama'] = 'llama-ultron'
        self.n.tarda['llama-ultron'] = 150
        self.vueltas(2)
        self.assertTrue(140 <= self.e['espera']['llama-ultron'] <= 160, self.e['espera'])

    def test_llama_caido_no_reinicia_el_puente(self):
        self.n.caidas['llama'] = 'llama-ultron'
        self.n.caidas['puente'] = 'llama-ultron'
        self.vueltas(2)
        self.assertEqual(self.n.reinicios, ['llama-ultron'])

    def test_freno_por_hora(self):
        # Un motor que no vuelve con nada: como mucho 3 reinicios en la hora, y queda para una persona.
        self.n.caidas['motor'] = 'nadie'
        self.vueltas(10)
        self.assertEqual(self.n.reinicios.count('ultron-motor'), 3)
        self.assertIn('ultron-motor', vigia.resumen(self.e, {'motor': False}, self.n.t)['necesita_persona'])

    def test_aprende_el_precursor_y_se_adelanta(self):
        # Cola de accept llena antes de cada caída del motor (lo del 28-sep); sano, vacía.
        self.vueltas(vigia.MIN_SANAS_PARA_APRENDER + 5)
        for _ in range(3):
            self.n.senal['cola_8443'] = 6.0
            self.vueltas(1)
            self.n.caidas['motor'] = 'ultron-motor'
            self.vueltas(2)
            self.n.senal['cola_8443'] = 0.0  # el reinicio vacía la cola
            self.n.t += 3600
            self.vueltas(2)
        self.assertIn('motor_mudo', self.e['precursores'])
        self.assertIn('cola_8443', self.e['precursores']['motor_mudo'])
        # Ahora la cola se llena pero el motor todavía contesta: se reinicia antes de la caída.
        self.n.reinicios.clear()
        self.n.t += vigia.PRECURSOR_CADA_S
        self.n.senal['cola_8443'] = 6.0
        self.vueltas(1)
        self.assertEqual(self.n.reinicios, ['ultron-motor'])
        self.assertTrue(self.e['incidentes'][-1].get('prevenido'))

    def test_llama_nunca_por_precursor(self):
        self.e['precursores'] = {'llama_colgado': {'gpu_mib': 1.0}}
        self.n.senal['gpu_mib'] = 5.0
        self.vueltas(1)
        self.assertEqual(self.n.reinicios, [])

    def test_preventivo_de_madrugada_si_se_repite(self):
        for _ in range(3):
            self.n.caidas['mesa'] = 'qwen-proxy'
            self.vueltas(3)
            self.n.t += 3600
        self.n.reinicios.clear()
        # 09:00 UTC del día siguiente: 3 de la mañana en Honduras.
        dia = int(self.n.t // 86400 + 1) * 86400
        self.n.t = dia + 9 * 3600 + 60
        self.vueltas(1)
        self.assertEqual(self.n.reinicios, ['qwen-proxy'])
        self.vueltas(1)
        self.assertEqual(self.n.reinicios, ['qwen-proxy'], 'una vez por día')

    def test_estado_y_resumen_en_disco(self):
        with tempfile.TemporaryDirectory() as d:
            ruta = os.path.join(d, 'estado.json')
            self.n.caidas['motor'] = 'ultron-motor'
            self.vueltas(2)
            vigia.guardar(self.e, ruta)
            e2 = vigia.cargar(ruta)
            self.assertEqual(e2['remedios'], self.e['remedios'])
            r = vigia.resumen(e2, {'motor': True, 'llama': True}, self.n.t)
            self.assertTrue(r['sano'])
            self.assertEqual(r['incidentes_24h'], 1)
            self.assertEqual(r['ultimo']['resuelto'], 'ultron-motor')
            self.assertEqual(r['aprendido']['motor_mudo']['remedio'], 'ultron-motor')
        self.assertEqual(vigia.cargar('/no/existe.json')['incidentes'], [])



T4 = os.path.join(os.path.dirname(__file__), '..', '..', 'nodo-t4', 'vigia.json')


class VigiaT4(unittest.TestCase):
    """El mismo vigía, configurado para la T4: contenedores y servicios propios."""

    def setUp(self):
        self.assertTrue(vigia.cargar_config(T4))
        self.e = vigia.estado_vacio()
        self.n = NodoFalso()

    def tearDown(self):
        importlib.reload(vigia)  # vuelve la A10G para las demás pruebas

    def test_capas_de_la_t4(self):
        # Sin `chico` (quitado el 1-oct-2026): si estuviera, el vigía lo volvería a levantar.
        self.assertEqual(set(vigia.CAPAS), {'voz', 'oido', 'laya', 'manos', 'entrada'})
        self.assertIsNone(vigia.CAPA_BASE)
        self.assertEqual(vigia.SINTOMAS['oido_caida'], ('oido', ['oido']))
        self.assertEqual(vigia.SINTOMAS['voz_caida'], ('voz', ['docker:voicebox']))
        self.assertIn('docker:voicebox', vigia.CARO)

    def test_voz_colgada_reinicia_el_contenedor(self):
        self.n.caidas['voz'] = 'docker:voicebox'
        self.n.tarda['docker:voicebox'] = 40
        vigia.vuelta(self.e, self.n)
        self.assertEqual(self.n.reinicios, ['docker:voicebox'])
        self.assertEqual(self.e['incidentes'][-1]['resuelto'], 'docker:voicebox')

    def test_laya_y_voz_a_la_vez_cada_una_lo_suyo(self):
        self.n.caidas['voz'] = 'docker:voicebox'
        self.n.caidas['laya'] = 'laya-electrum'
        vigia.vuelta(self.e, self.n)
        self.assertEqual(sorted(self.n.reinicios), ['docker:voicebox', 'laya-electrum'])

    def test_sano_no_toca_nada(self):
        for _ in range(3):
            vigia.vuelta(self.e, self.n)
            self.n.minuto()
        self.assertEqual(self.n.reinicios, [])

    def test_config_valida(self):
        with open(T4) as f:
            c = json.load(f)
        for k, v in c['capas'].items():
            self.assertIn(v['sonda']['tipo'], ('docker', 'http', 'tls'), k)
            self.assertTrue(v['remedios'], k)


if __name__ == '__main__':
    unittest.main()
