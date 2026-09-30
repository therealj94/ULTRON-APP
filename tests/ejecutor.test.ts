import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { capturaAcotada, ejecutarCodigo, TOPE_CAPTURA_BYTES } from '../lib/ejecutor';

describe('Fase 5 — ejecutor real', () => {
  it('ejecuta python correcto y reporta stdout', async () => {
    const r = await ejecutarCodigo('print(1+1)');
    assert.equal(r.ok, true);
    assert.equal(r.exit_code, 0);
    assert.equal(r.stdout.trim(), '2');
    assert.ok(r.via === 'local' || r.via === 'docker' || r.via === 'remoto');
  });

  it('detecta un bug: excepción no capturada', async () => {
    const r = await ejecutarCodigo('raise RuntimeError("bug evidentes")');
    assert.equal(r.ok, false);
    assert.notEqual(r.exit_code, 0);
    assert.match(r.stderr, /bug evidentes/);
  });

  it('rechaza código vacío', async () => {
    const r = await ejecutarCodigo('   ');
    assert.equal(r.ok, false);
    assert.equal(r.via, 'omitido');
  });

  // A27: el tope de salida se aplica MIENTRAS corre. Antes se juntaba todo (`stdout += …`) hasta el
  // timeout y solo se recortaba al final: un bucle que imprime llenaba la memoria del servidor.
  it('una salida sin fin se corta al pasar el tope, sin esperar al timeout', async () => {
    const t0 = Date.now();
    const r = await ejecutarCodigo('import sys\nwhile True:\n    sys.stdout.write("x" * 65536)\n    sys.stdout.flush()');
    const tardo = Date.now() - t0;
    assert.equal(r.ok, false);
    assert.match(r.error || '', /tope/);
    assert.ok(r.stdout.length <= 5000, String(r.stdout.length));
    assert.ok(tardo < 8000, `tardó ${tardo} ms: esperó al timeout`);
  });

  it('la captura guarda lo justo y cuenta todo lo que pasó', () => {
    const c = capturaAcotada(10);
    for (let i = 0; i < 1000; i++) c.sumar(Buffer.alloc(1024, 120));
    assert.equal(c.texto().length, 10);
    assert.equal(c.bytes(), 1024 * 1000);
    assert.ok(TOPE_CAPTURA_BYTES < c.bytes());
  });

  it('timeout de 10s mata el proceso', async () => {
    const r = await ejecutarCodigo('import time\ntime.sleep(30)');
    assert.equal(r.ok, false);
    assert.ok(r.exit_code === 124 || /Timeout|timeout/i.test(r.stderr + (r.error || '')));
  });
});
