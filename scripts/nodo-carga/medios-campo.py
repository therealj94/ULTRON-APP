#!/usr/bin/env python3
"""
ELECTRUM — fotos y videos de campo de un lote, vueltos texto que el cerebro puede buscar y citar.

    python3 medios-campo.py <dir con los medios> <dir de salida> [--whisper medium] [--hilos 4]

El cargador no lee imágenes sueltas ni videos: una foto de un afloramiento no trae texto y un video
de WhatsApp es audio. Aquí:
  - cada foto se describe con el mismo modelo de visión que usa Dr Electrum en producción (Bedrock,
    gemma-3-12b, us-west-2), con un pedido de geólogo de exploración, no un pie de foto genérico;
  - cada video se transcribe (faster-whisper, español) y se describen tres cuadros (al 15, 50 y 85 %);
  - la ubicación GPS de cada foto (EXIF) o video (etiqueta «location» de QuickTime/DJI), si la trae,
    va a Fotos y videos de campo con GPS.geojson para el mapa. Las de WhatsApp vienen sin GPS: se dice en el resumen.

Salida, con la misma estructura de carpetas que la entrada:
    <carpeta>/Fotos e imágenes - <carpeta>.txt   una página por foto o imagen (\\f entre páginas)
    <carpeta>/Videos de campo - <carpeta>.txt    una página por video
    Fotos y videos de campo con GPS.geojson                            solo si alguna trae ubicación
Eso se carga con el cargador de siempre:  con-cerebro tsx scripts/electrum/aprender.ts --carpetas <salida>

Se puede cortar y relanzar: lo ya visto o transcrito queda en <salida>/.cache/ y no se repite.
Necesita: credenciales de AWS con Bedrock, ffmpeg, Pillow, boto3 y faster-whisper.
"""
import argparse
import concurrent.futures as cf
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import wave

import boto3
import numpy as np
from PIL import Image, ImageOps

MODELO = os.environ.get('ULTRON_VISION_BEDROCK', 'google.gemma-3-12b-it')
REGION = os.environ.get('ULTRON_VISION_BEDROCK_REGION', 'us-west-2')
FOTO = ('.jpg', '.jpeg', '.png', '.jfif', '.webp')
VIDEO = ('.mp4', '.mov', '.m4v', '.3gp')

PEDIDO = (
    'Sos geólogo de exploración en Honduras y estás revisando el archivo de un proyecto minero. '
    'Describí esta imagen en español, en 2 a 5 frases: qué es (afloramiento, veta, roca, bocamina, '
    'socavón, muestra, trinchera, planta o equipo, documento, mapa o plano, paisaje, personas trabajando), '
    'los rasgos geológicos que se ven (tipo de roca, alteración, cuarzo, sulfuros, óxidos de hierro, '
    'estructuras, rumbo aparente) y transcribí cualquier texto legible (rótulos, etiquetas de muestras, '
    'coordenadas). Si algo no se distingue, decilo; no inventes.'
)

bedrock = boto3.client('bedrock-runtime', region_name=REGION)


def jpeg_para_ver(datos: bytes, lado=1600) -> bytes:
    """El modelo no necesita 12 megapíxeles: a 1600 px se ve lo mismo y cuesta una fracción."""
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(datos))).convert('RGB')
    im.thumbnail((lado, lado))
    sal = io.BytesIO()
    im.save(sal, 'JPEG', quality=85)
    return sal.getvalue()


def ver(jpeg: bytes) -> str:
    r = bedrock.converse(
        modelId=MODELO,
        messages=[{'role': 'user', 'content': [{'image': {'format': 'jpeg', 'source': {'bytes': jpeg}}}, {'text': PEDIDO}]}],
        inferenceConfig={'maxTokens': 500, 'temperature': 0.2},
    )
    texto = ''.join(c.get('text', '') for c in r['output']['message']['content']).strip()
    # El modelo a veces abre con «Aquí tienes una descripción…»: no aporta y ensucia la búsqueda.
    return re.sub(r'^(aqu[ií] (tienes|est[aá])[^:\n]*:\s*)', '', texto, flags=re.I).strip()


def gps_de_foto(ruta: str):
    try:
        g = Image.open(ruta).getexif().get_ifd(0x8825)
    except Exception:
        return None
    if not g or 2 not in g or 4 not in g:
        return None
    a_grados = lambda v: float(v[0]) + float(v[1]) / 60 + float(v[2]) / 3600
    lat, lon = a_grados(g[2]), a_grados(g[4])
    if g.get(1) == 'S':
        lat = -lat
    if g.get(3) == 'W':
        lon = -lon
    return lon, lat


def fecha_de_foto(ruta: str) -> str:
    try:
        e = Image.open(ruta).getexif()
        f = e.get_ifd(0x8769).get(36867) or e.get(306)
        return str(f).replace(':', '-', 2) if f else ''
    except Exception:
        return ''


def sondear(ruta: str) -> dict:
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:format_tags', '-of', 'json', ruta],
                         capture_output=True, text=True).stdout
    return json.loads(out or '{}').get('format', {})


def gps_de_video(fmt: dict):
    # QuickTime/DJI: «+13.2972-086.9259+689.000/»
    loc = next((v for k, v in (fmt.get('tags') or {}).items() if 'location' in k.lower()), '')
    m = re.match(r'([+-]\d+\.\d+)([+-]\d+\.\d+)', loc or '')
    return (float(m.group(2)), float(m.group(1))) if m else None


def gps_valido(g):
    """Un teléfono sin señal de GPS escribe 0,0 (en el golfo de Guinea): eso no es una ubicación."""
    return bool(g) and (abs(g[0]) > 1e-4 or abs(g[1]) > 1e-4)


class Cache:
    def __init__(self, dir_):
        self.dir = os.path.join(dir_, '.cache')
        os.makedirs(self.dir, exist_ok=True)

    def _p(self, clave):
        return os.path.join(self.dir, hashlib.md5(clave.encode()).hexdigest() + '.json')

    def get(self, clave):
        try:
            return json.load(open(self._p(clave)))
        except Exception:
            return None

    def put(self, clave, valor):
        json.dump(valor, open(self._p(clave), 'w'), ensure_ascii=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('entrada')
    ap.add_argument('salida')
    ap.add_argument('--whisper', default='medium')
    ap.add_argument('--hilos', type=int, default=4)
    a = ap.parse_args()
    cache = Cache(a.salida)

    fotos, videos = [], []
    for raiz, _, archivos in os.walk(a.entrada):
        for f in sorted(archivos):
            ruta = os.path.join(raiz, f)
            rel = os.path.relpath(ruta, a.entrada)
            if f.lower().endswith(FOTO):
                fotos.append(rel)
            elif f.lower().endswith(VIDEO):
                videos.append(rel)
    print(f'{len(fotos)} fotos, {len(videos)} videos', flush=True)

    def describir_foto(rel):
        hecho = cache.get('foto:' + rel)
        if hecho:
            return rel, hecho
        ruta = os.path.join(a.entrada, rel)
        try:
            d = {'texto': ver(jpeg_para_ver(open(ruta, 'rb').read())), 'gps': gps_de_foto(ruta), 'fecha': fecha_de_foto(ruta)}
        except Exception as e:
            print(f'  ✗ {rel}: {str(e)[:120]}', flush=True)
            return rel, None
        cache.put('foto:' + rel, d)
        print(f'  ✓ {rel}', flush=True)
        return rel, d

    vistas = {}
    with cf.ThreadPoolExecutor(a.hilos) as ex:
        for rel, d in ex.map(describir_foto, fotos):
            if d:
                vistas[rel] = d

    # Videos: el audio entero por whisper, tres cuadros por el modelo de visión.
    modelo = None
    oidos = {}
    for rel in videos:
        hecho = cache.get('video:' + rel)
        if hecho:
            oidos[rel] = hecho
            continue
        ruta = os.path.join(a.entrada, rel)
        fmt = sondear(ruta)
        dur = float(fmt.get('duration') or 0)
        with tempfile.TemporaryDirectory() as t:
            wav = os.path.join(t, 'a.wav')
            habla = ''
            if subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', ruta, '-vn', '-ac', '1', '-ar', '16000', wav]).returncode == 0 and os.path.getsize(wav) > 1000:
                if modelo is None:
                    from faster_whisper import WhisperModel
                    modelo = WhisperModel(a.whisper, device='cpu', compute_type='int8')
                # El audio va ya decodificado: faster-whisper lo abriría con PyAV, y hay versiones de
                # PyAV con las que su `open` falla (`metadata_errors`). ffmpeg ya dejó PCM a 16 kHz.
                with wave.open(wav) as w:
                    muestras = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768.0
                segs, _ = modelo.transcribe(muestras, language='es', vad_filter=True, beam_size=5)
                habla = ' '.join(s.text.strip() for s in segs).strip()
            cuadros = []
            for frac in (0.15, 0.5, 0.85):
                jpg = os.path.join(t, f'{frac}.jpg')
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{dur * frac:.2f}', '-i', ruta, '-frames:v', '1', jpg])
                if os.path.exists(jpg):
                    try:
                        cuadros.append(f'Al {int(frac * 100)} %: ' + ver(jpeg_para_ver(open(jpg, 'rb').read())))
                    except Exception as e:
                        print(f'  ✗ cuadro {rel}: {str(e)[:100]}', flush=True)
        d = {'habla': habla, 'cuadros': cuadros, 'duracion': round(dur), 'gps': gps_de_video(fmt),
             'fecha': (fmt.get('tags') or {}).get('creation_time', '')[:10]}
        cache.put('video:' + rel, d)
        oidos[rel] = d
        print(f'  ✓ {rel} ({round(dur)} s, {len(habla)} car de habla)', flush=True)

    # Una «libreta» por carpeta: una página por foto o video, citable por página.
    def escribir(items, titulo, pagina):
        por_carpeta = {}
        for rel in sorted(items):
            por_carpeta.setdefault(os.path.dirname(rel), []).append(rel)
        for carpeta, rels in por_carpeta.items():
            nombre = os.path.basename(carpeta) or 'raíz'
            dst = os.path.join(a.salida, carpeta, f'{titulo} - {nombre}.txt')
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, 'w') as f:
                f.write('\f'.join(pagina(rel, items[rel]) for rel in rels))

    def pag_foto(rel, d):
        lin = [f'Foto: {os.path.basename(rel)}', f'Carpeta: {os.path.dirname(rel)}']
        if d.get('fecha'):
            lin.append(f'Fecha de la foto: {d["fecha"]}')
        if gps_valido(d.get('gps')):
            lin.append(f'Ubicación (GPS de la foto): {d["gps"][1]:.6f}, {d["gps"][0]:.6f}')
        return '\n'.join(lin) + f'\n\nDescripción (modelo de visión, {MODELO}): {d["texto"]}\n'

    def pag_video(rel, d):
        lin = [f'Video: {os.path.basename(rel)} ({d["duracion"]} s)', f'Carpeta: {os.path.dirname(rel)}']
        if d.get('fecha'):
            lin.append(f'Fecha del video: {d["fecha"]}')
        if gps_valido(d.get('gps')):
            lin.append(f'Ubicación (GPS del video): {d["gps"][1]:.6f}, {d["gps"][0]:.6f}')
        cuerpo = '\n'.join(lin) + '\n\nLo que se ve:\n' + '\n'.join(d['cuadros'] or ['(no se pudo ver ningún cuadro)'])
        cuerpo += '\n\nLo que se dice (transcripción automática, faster-whisper):\n' + (d['habla'] or '(sin habla: solo ruido o música)')
        return cuerpo + '\n'

    escribir(vistas, 'Fotos e imágenes', pag_foto)
    escribir(oidos, 'Videos de campo', pag_video)

    puntos = [{'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': list(d['gps'])},
               'properties': {'nombre': os.path.basename(rel), 'carpeta': os.path.dirname(rel), 'descripcion': (d.get('texto') or ' '.join(d.get('cuadros', [])))[:500]}}
              for rel, d in list(vistas.items()) + list(oidos.items()) if gps_valido(d.get('gps'))]
    if puntos:
        json.dump({'type': 'FeatureCollection', 'features': puntos}, open(os.path.join(a.salida, 'Fotos y videos de campo con GPS.geojson'), 'w'), ensure_ascii=False)
    print(f'Listo: {len(vistas)} fotos y {len(oidos)} videos; {len(puntos)} con ubicación GPS'
          f'{"" if puntos else " (las de WhatsApp vienen sin GPS)"}.', flush=True)


if __name__ == '__main__':
    sys.exit(main())
