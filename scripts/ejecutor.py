#!/usr/bin/env python3
"""Ejecutor Flask opcional (Fase 5). No corre en el nodo Qwen.

  pip3 install flask
  python3 scripts/ejecutor.py

Env: EJECUTOR_URL=http://127.0.0.1:11436  → lib/ejecutor.ts proxifica aquí.
Docker es opcional; si no está, cae a python3 local.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import uuid

from flask import Flask, jsonify, request

app = Flask(__name__)
TIMEOUT = 10


def _run_local(ruta: str):
    return subprocess.run(
        ['python3', ruta],
        capture_output=True,
        text=True,
        timeout=TIMEOUT,
        env={'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'LANG': 'C.UTF-8'},
    )


def _run_docker(ruta: str):
    return subprocess.run(
        [
            'docker', 'run', '--rm',
            '--network=none', '--memory=256m', '--cpus=1', '--read-only',
            '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
            '-v', f'{ruta}:/app/codigo.py:ro',
            'python:3.12-slim', 'python', '/app/codigo.py',
        ],
        capture_output=True,
        text=True,
        timeout=TIMEOUT,
    )


@app.route('/ejecutar', methods=['POST'])
def ejecutar():
    codigo = (request.json or {}).get('codigo', '')
    if not codigo:
        return jsonify({'error': 'Código vacío', 'ok': False}), 400
    tmpdir = tempfile.mkdtemp(prefix='ultron-')
    ruta = os.path.join(tmpdir, 'codigo.py')
    try:
        with open(ruta, 'w', encoding='utf-8') as f:
            f.write(codigo)
        try:
            resultado = _run_docker(ruta) if os.environ.get('EJECUTOR_DOCKER') == '1' else _run_local(ruta)
        except FileNotFoundError:
            resultado = _run_local(ruta)
        return jsonify({
            'stdout': (resultado.stdout or '')[:5000],
            'stderr': (resultado.stderr or '')[:5000],
            'exit_code': resultado.returncode,
            'ok': resultado.returncode == 0,
        })
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Timeout de 10s', 'ok': False}), 408
    except Exception as e:
        return jsonify({'error': str(e), 'ok': False}), 500
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@app.route('/salud', methods=['GET'])
def salud():
    return jsonify({'ejecutor': 'ok', 'id': uuid.uuid4().hex[:8]})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('EJECUTOR_PORT', '11436')), threaded=True)
