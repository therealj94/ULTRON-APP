#!/usr/bin/env python3
"""
EL VIGÍA DEL MOTOR — levanta solo lo que se cae y aprende de cada caída.

Corre cada minuto (systemd timer) en el nodo A10G y mira la cadena entera, de abajo arriba:

    llama   llama-server en :8080        /health
    genera  el modelo de verdad escribe  /completion de un token (cada 5 min)
    puente  ollama-proxy en :11434       /api/tags
    motor   ultron-motor en :8443 (TLS)  acepta y contesta (401 sin secreto también vale)
    mesa    qwen-proxy en :11435         contesta

Cuando una capa falla dos vueltas seguidas, reinicia SOLO esa capa y confirma que volvió. No
reinicia la máquina ni para la instancia: eso lo decide una persona.

Lo que aprende, guardado en /var/lib/ultron-vigia/estado.json:

  1. Qué remedio sirve para cada síntoma. Cada síntoma tiene candidatos (la capa misma, la de abajo)
     y se prueban en el orden de su tasa de éxito medida, no en uno fijo.
  2. Cuánto tarda cada servicio en volver (media móvil): llama tarda ~2,5 min en cargar 27 B en la
     GPU, el motor un segundo. Se espera lo aprendido antes de declarar que el remedio no sirvió.
  3. Qué señales anuncian una caída. En cada vuelta sana guarda las señales (cola de accept de cada
     puerto, RAM, disco, memoria de la GPU); en cada caída, las de la vuelta anterior. Con tres
     caídas de un síntoma, si una señal estuvo SIEMPRE por encima de lo que se ve sano (p95), queda
     como precursor y la próxima vez se actúa antes de que el servicio deje de contestar.
     El 28-sep el motor quedó sordo con la cola de accept llena: esa es la firma que busca.
  4. Qué se repite. Tres caídas del mismo síntoma en siete días agendan un reinicio preventivo del
     remedio que funcionó, a las 3 de la mañana de Honduras (09:00 UTC), una vez por día.

Freno: como mucho 3 reinicios por hora por servicio (2 para llama). Pasado eso se anota
«necesita una persona» y no se toca más.

El resumen para afuera (resumen.json) lo lee el motor y lo entrega en /salud a quien tiene el secreto.
"""
import http.client
import json
import os
import shutil
import socket
import ssl
import subprocess
import sys
import time
import urllib.request

DIR = os.environ.get('VIGIA_DIR', '/var/lib/ultron-vigia')
ESTADO = os.path.join(DIR, 'estado.json')
RESUMEN = os.path.join(DIR, 'resumen.json')

# Síntoma -> (capa que lo delata, remedios candidatos en el orden por defecto)
SINTOMAS = {
    'llama_caido': ('llama', ['llama-ultron']),
    'llama_colgado': ('genera', ['llama-ultron']),
    'puente_mudo': ('puente', ['ollama-proxy', 'llama-ultron']),
    'motor_mudo': ('motor', ['ultron-motor']),
    'mesa_muda': ('mesa', ['qwen-proxy', 'ultron-motor']),
}
# Las que dependen de llama no se remedian mientras llama esté caído: primero lo de abajo.
DEPENDE_DE_LLAMA = {'puente_mudo', 'llama_colgado'}
UMBRAL_FALLAS = 2
REMIRAR_S = 15
ESPERA_INICIAL = {'llama-ultron': 180.0, 'ollama-proxy': 6.0, 'ultron-motor': 6.0, 'qwen-proxy': 6.0}
TOPE_HORA = {'llama-ultron': 2}
TOPE_HORA_DEFECTO = 3
CARO = {'llama-ultron'}  # descarga el modelo de la GPU: nunca por precursor, solo de madrugada
CADA_GENERA_S = 300
HORA_PREVENTIVA_UTC = 9  # 3:00 en Honduras
MUESTRAS_SANAS = 300
MIN_SANAS_PARA_APRENDER = 50
MIN_CAIDAS_PARA_APRENDER = 3
PRECURSOR_CADA_S = 6 * 3600


def log(*a):
    print(time.strftime('%Y-%m-%d %H:%M:%S'), *a, flush=True)


# ------------------------------------------------------------------ el mundo real

class Nodo:
    """Las sondas, las señales y los reinicios de verdad. Las pruebas usan uno falso."""

    def ahora(self):
        return time.time()

    def dormir(self, s):
        time.sleep(s)

    def _http(self, url, cuerpo=None, plazo=6):
        req = urllib.request.Request(url, data=cuerpo, headers={'Content-Type': 'application/json'} if cuerpo else {})
        try:
            with urllib.request.urlopen(req, timeout=plazo) as r:
                return r.status, r.read(4096)
        except urllib.error.HTTPError as e:
            return e.code, e.read(4096)

    def probar(self, capa):
        """True: sana. False: falla. None: cargando (llama subiendo el modelo), ni sana ni caída."""
        try:
            if capa == 'llama':
                codigo, cuerpo = self._http('http://127.0.0.1:8080/health', plazo=6)
                if codigo == 503 and b'loading' in cuerpo.lower():
                    return None
                return codigo == 200
            if capa == 'genera':
                pedido = json.dumps({'prompt': 'Hola', 'n_predict': 1, 'cache_prompt': False}).encode()
                codigo, cuerpo = self._http('http://127.0.0.1:8080/completion', pedido, plazo=90)
                return codigo == 200 and b'content' in cuerpo
            if capa == 'puente':
                codigo, _ = self._http('http://127.0.0.1:11434/api/tags', plazo=8)
                return codigo == 200
            if capa == 'motor':
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE  # certificado propio del motor, en la misma máquina
                c = http.client.HTTPSConnection('127.0.0.1', 8443, timeout=8, context=ctx)
                try:
                    c.request('GET', '/salud')
                    return c.getresponse().status in (200, 401)
                finally:
                    c.close()
            if capa == 'mesa':
                c = http.client.HTTPConnection('127.0.0.1', 11435, timeout=8)
                try:
                    c.request('GET', '/')
                    return c.getresponse().status < 500
                finally:
                    c.close()
        except (OSError, http.client.HTTPException, ValueError):
            return False
        return False

    def senales(self):
        s = {}
        try:
            salida = subprocess.run(['ss', '-ltnH'], capture_output=True, text=True, timeout=5).stdout
            for linea in salida.splitlines():
                p = linea.split()
                if len(p) >= 4 and p[0] == 'LISTEN':
                    puerto = p[3].rsplit(':', 1)[-1]
                    if puerto in ('8443', '11434', '11435', '8080'):
                        s[f'cola_{puerto}'] = float(p[1])
        except Exception:
            pass
        try:
            info = {}
            with open('/proc/meminfo') as f:
                for linea in f:
                    k, v = linea.split(':', 1)
                    info[k] = float(v.split()[0])
            s['ram_pct'] = round(100 * (1 - info['MemAvailable'] / info['MemTotal']), 1)
        except Exception:
            pass
        try:
            d = shutil.disk_usage('/')
            s['disco_pct'] = round(100 * d.used / d.total, 1)
        except Exception:
            pass
        try:
            salida = subprocess.run(['nvidia-smi', '--query-gpu=memory.used', '--format=csv,noheader,nounits'],
                                    capture_output=True, text=True, timeout=10).stdout.strip()
            if salida:
                s['gpu_mib'] = float(salida.splitlines()[0])
        except Exception:
            pass
        return s

    def reiniciar(self, servicio):
        r = subprocess.run(['systemctl', 'restart', servicio], capture_output=True, text=True, timeout=120)
        return r.returncode == 0


# ------------------------------------------------------------------ memoria

def estado_vacio():
    return {
        'fallas': {},        # síntoma -> vueltas seguidas fallando
        'abiertos': {},      # síntoma -> incidente en curso
        'incidentes': [],    # los últimos 200, cerrados
        'remedios': {},      # síntoma -> servicio -> {intentos, exitos}
        'espera': {},        # servicio -> segundos que tarda en volver (media móvil)
        'reinicios': [],     # [ts, servicio, motivo] de la última hora y algo
        'sanas': {},         # señal -> últimas muestras sanas
        'previas': {},       # señales de la vuelta anterior
        'precursores': {},   # síntoma -> {señal: umbral}
        'ultimo_genera': 0,
        'ultima_preventiva': '',
        'ultimo_precursor': {},
        'humano': {},        # servicio -> ts desde que se frenó
        'pendiente_sana': None,
    }


def cargar(ruta=None):
    ruta = ruta or ESTADO
    try:
        with open(ruta) as f:
            e = json.load(f)
        base = estado_vacio()
        base.update(e)
        return base
    except (OSError, ValueError):
        return estado_vacio()


def guardar(e, ruta=None):
    ruta = ruta or ESTADO
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    tmp = ruta + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(e, f, ensure_ascii=False)
    os.replace(tmp, ruta)


def tasa(e, sintoma, servicio):
    r = e['remedios'].get(sintoma, {}).get(servicio, {'intentos': 0, 'exitos': 0})
    return (r['exitos'] + 1) / (r['intentos'] + 2)  # Laplace: sin datos, 0,5


def orden_remedios(e, sintoma):
    por_defecto = SINTOMAS[sintoma][1]
    return sorted(por_defecto, key=lambda s: (-tasa(e, sintoma, s), por_defecto.index(s)))


def anotar_remedio(e, sintoma, servicio, ok):
    r = e['remedios'].setdefault(sintoma, {}).setdefault(servicio, {'intentos': 0, 'exitos': 0})
    r['intentos'] += 1
    r['exitos'] += 1 if ok else 0


def espera_de(e, servicio):
    return e['espera'].get(servicio, ESPERA_INICIAL.get(servicio, 10.0))


def aprender_espera(e, servicio, segundos):
    previa = e['espera'].get(servicio)
    e['espera'][servicio] = round(segundos if previa is None else 0.7 * previa + 0.3 * segundos, 1)


def puede_reiniciar(e, servicio, ahora):
    e['reinicios'] = [r for r in e['reinicios'] if ahora - r[0] < 3600]
    hechos = sum(1 for r in e['reinicios'] if r[1] == servicio)
    return hechos < TOPE_HORA.get(servicio, TOPE_HORA_DEFECTO)


def p95(xs):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(0.95 * len(xs)))]


def aprender_precursores(e):
    """Una señal es precursora de un síntoma si antes de CADA caída estuvo por encima de lo sano."""
    nuevos = {}
    for sintoma in SINTOMAS:
        caidas = [i for i in e['incidentes'] if i['sintoma'] == sintoma and i.get('previas')]
        if len(caidas) < MIN_CAIDAS_PARA_APRENDER:
            continue
        for senal, sanas in e['sanas'].items():
            if len(sanas) < MIN_SANAS_PARA_APRENDER:
                continue
            antes = [i['previas'][senal] for i in caidas if senal in i['previas']]
            if len(antes) < MIN_CAIDAS_PARA_APRENDER:
                continue
            alto_sano = p95(sanas)
            if min(antes) > alto_sano:
                nuevos.setdefault(sintoma, {})[senal] = round((min(antes) + alto_sano) / 2, 2)
    e['precursores'] = nuevos


# ------------------------------------------------------------------ una vuelta

def sintomas_de(resultados):
    return {s for s, (capa, _) in SINTOMAS.items() if resultados.get(capa) is False}


def remediar(e, nodo, sintoma, motivo):
    """Prueba los remedios en el orden aprendido hasta que la capa vuelve. Devuelve lo intentado."""
    capa = SINTOMAS[sintoma][0]
    intentos = []
    for servicio in orden_remedios(e, sintoma):
        ahora = nodo.ahora()
        if not puede_reiniciar(e, servicio, ahora):
            if servicio not in e['humano']:
                e['humano'][servicio] = ahora
                log(f'FRENO {servicio}: ya se reinició el máximo de esta hora; necesita una persona')
            intentos.append({'servicio': servicio, 'ok': False, 'frenado': True})
            continue
        log(f'{sintoma}: reinicio {servicio} ({motivo}; tasa aprendida {tasa(e, sintoma, servicio):.2f})')
        e['reinicios'].append([ahora, servicio, motivo])
        t0 = nodo.ahora()
        nodo.reiniciar(servicio)
        plazo = max(30.0, 2 * espera_de(e, servicio))
        volvio = False
        while nodo.ahora() - t0 < plazo:
            nodo.dormir(3)
            r = nodo.probar(capa)
            if r is True:
                volvio = True
                break
        segundos = round(nodo.ahora() - t0, 1)
        anotar_remedio(e, sintoma, servicio, volvio)
        if volvio:
            aprender_espera(e, servicio, segundos)
            e['humano'].pop(servicio, None)
        intentos.append({'servicio': servicio, 'ok': volvio, 's': segundos})
        log(f'{sintoma}: {servicio} {"volvió" if volvio else "NO volvió"} en {segundos} s')
        if volvio:
            break
    return intentos


def vuelta(e, nodo):
    ahora = nodo.ahora()
    senales = nodo.senales()
    capas = ['llama', 'puente', 'motor', 'mesa']
    resultados = {c: nodo.probar(c) for c in capas}
    if resultados['llama'] is True and (ahora - e['ultimo_genera'] >= CADA_GENERA_S or e['fallas'].get('llama_colgado')):
        resultados['genera'] = nodo.probar('genera')
        e['ultimo_genera'] = ahora
    presentes = sintomas_de(resultados)
    # Lo que falla por primera vez se vuelve a mirar a los 15 s en esta misma vuelta: un parpadeo
    # se descarta ahí, y una caída de verdad se confirma en un cuarto de minuto y no en uno entero.
    nuevos = [s for s in presentes if not e['fallas'].get(s)]
    if nuevos:
        nodo.dormir(REMIRAR_S)
        for sintoma in nuevos:
            capa = SINTOMAS[sintoma][0]
            if nodo.probar(capa) is False:
                e['fallas'][sintoma] = 1
            else:
                resultados[capa] = True
                presentes.discard(sintoma)
                log(f'{sintoma}: parpadeo, a los {REMIRAR_S} s ya contestaba')
    llama_mal = bool(presentes & {'llama_caido', 'llama_colgado'}) or resultados['llama'] is None

    # Cerrar lo que volvió solo, y contar las vueltas seguidas de lo que sigue mal.
    for sintoma in list(SINTOMAS):
        capa = SINTOMAS[sintoma][0]
        if sintoma in presentes:
            e['fallas'][sintoma] = e['fallas'].get(sintoma, 0) + 1
            if sintoma not in e['abiertos']:
                e['abiertos'][sintoma] = {'sintoma': sintoma, 'inicio': ahora, 'previas': e.get('previas') or {}, 'remedios': []}
        elif resultados.get(capa) is True:
            e['fallas'][sintoma] = 0
            abierto = e['abiertos'].pop(sintoma, None)
            if abierto:
                abierto.update(fin=ahora, duracion=round(ahora - abierto['inicio'], 1), resuelto='solo')
                e['incidentes'].append(abierto)
                log(f'{sintoma}: volvió solo en {abierto["duracion"]} s')

    # Remediar lo confirmado.
    for sintoma in sorted(presentes):
        if e['fallas'].get(sintoma, 0) < UMBRAL_FALLAS:
            continue
        if sintoma in DEPENDE_DE_LLAMA and sintoma != 'llama_colgado' and llama_mal:
            continue
        intentos = remediar(e, nodo, sintoma, f'{e["fallas"][sintoma]} vueltas fallando')
        abierto = e['abiertos'].get(sintoma)
        if abierto is not None:
            abierto['remedios'].extend(intentos)
            if any(i['ok'] for i in intentos):
                resultados[SINTOMAS[sintoma][0]] = True
                fin = nodo.ahora()
                abierto.update(fin=fin, duracion=round(fin - abierto['inicio'], 1),
                               resuelto=next(i['servicio'] for i in intentos if i['ok']))
                e['incidentes'].append(e['abiertos'].pop(sintoma))
                e['fallas'][sintoma] = 0

    # Todo sano: guardar las señales como «normales» y mirar precursores aprendidos.
    # Una vuelta cuenta como «sana» recién cuando la siguiente también lo es: las señales del minuto
    # anterior a una caída son justo las que se quieren aprender como precursoras, no como normales.
    todo_sano = not presentes and all(v is True for v in resultados.values())
    if todo_sano and e.get('pendiente_sana'):
        for k, v in e['pendiente_sana'].items():
            muestras = e['sanas'].setdefault(k, [])
            muestras.append(v)
            del muestras[:-MUESTRAS_SANAS]
    e['pendiente_sana'] = senales if todo_sano else None
    if todo_sano:
        for sintoma, umbrales in e['precursores'].items():
            disparadas = [k for k, u in umbrales.items() if senales.get(k, -1e18) >= u]
            if not disparadas:
                continue
            servicio = orden_remedios(e, sintoma)[0]
            ultimo = e['ultimo_precursor'].get(sintoma, 0)
            if servicio in CARO or ahora - ultimo < PRECURSOR_CADA_S or not puede_reiniciar(e, servicio, ahora):
                log(f'aviso: {sintoma} se anuncia ({", ".join(disparadas)}), sin actuar ahora')
                continue
            log(f'PREVENGO {sintoma}: {", ".join(f"{k}={senales[k]}" for k in disparadas)} por encima de lo aprendido')
            e['ultimo_precursor'][sintoma] = ahora
            e['reinicios'].append([ahora, servicio, f'precursor de {sintoma}'])
            nodo.reiniciar(servicio)
            e['incidentes'].append({'sintoma': sintoma, 'inicio': ahora, 'fin': ahora, 'duracion': 0,
                                    'prevenido': True, 'senales': {k: senales[k] for k in disparadas},
                                    'remedios': [{'servicio': servicio, 'ok': True}], 'resuelto': servicio})

    preventiva(e, nodo, ahora)
    e['previas'] = senales
    del e['incidentes'][:-200]
    aprender_precursores(e)
    return resultados


def preventiva(e, nodo, ahora):
    """Lo que se cae seguido se reinicia de madrugada, antes de que se caiga de día."""
    t = time.gmtime(ahora)
    dia = time.strftime('%Y-%m-%d', t)
    if t.tm_hour != HORA_PREVENTIVA_UTC or e['ultima_preventiva'] == dia:
        return
    e['ultima_preventiva'] = dia
    semana = [i for i in e['incidentes'] if ahora - i.get('inicio', 0) < 7 * 86400 and not i.get('prevenido')]
    for sintoma in SINTOMAS:
        n = sum(1 for i in semana if i['sintoma'] == sintoma)
        if n < MIN_CAIDAS_PARA_APRENDER:
            continue
        servicio = orden_remedios(e, sintoma)[0]
        if not puede_reiniciar(e, servicio, ahora):
            continue
        log(f'PREVENTIVO de madrugada: {servicio} ({sintoma} se cayó {n} veces esta semana)')
        e['reinicios'].append([ahora, servicio, f'preventivo {sintoma}'])
        nodo.reiniciar(servicio)


def resumen(e, resultados, ahora):
    dia = [i for i in e['incidentes'] if ahora - i.get('inicio', 0) < 86400]
    ultimo = next((i for i in reversed(e['incidentes']) if not i.get('prevenido')), None)
    aprendido = {}
    for sintoma in SINTOMAS:
        mejor = orden_remedios(e, sintoma)[0]
        r = e['remedios'].get(sintoma, {}).get(mejor)
        if r or sintoma in e['precursores']:
            aprendido[sintoma] = {
                'remedio': mejor,
                'exitos': r['exitos'] if r else 0,
                'intentos': r['intentos'] if r else 0,
                'vuelve_en_s': espera_de(e, mejor),
                'precursor': e['precursores'].get(sintoma),
            }
    return {
        'actualizado': int(ahora),
        'sano': all(v is True for v in resultados.values()),
        'capas': {k: ('sana' if v is True else 'cargando' if v is None else 'caída') for k, v in resultados.items()},
        'incidentes_24h': len([i for i in dia if not i.get('prevenido')]),
        'prevenidos_24h': len([i for i in dia if i.get('prevenido')]),
        'incidentes_total': len(e['incidentes']),
        'ultimo': ultimo and {k: ultimo.get(k) for k in ('sintoma', 'inicio', 'duracion', 'resuelto')},
        'aprendido': aprendido,
        'necesita_persona': sorted(e['humano']),
    }


def main():
    nodo = Nodo()
    e = cargar()
    resultados = vuelta(e, nodo)
    guardar(e)
    guardar(resumen(e, resultados, nodo.ahora()), RESUMEN)
    os.chmod(RESUMEN, 0o644)
    malas = [k for k, v in resultados.items() if v is not True]
    if malas:
        log('capas sin contestar:', ', '.join(malas))


if __name__ == '__main__':
    sys.exit(main())
