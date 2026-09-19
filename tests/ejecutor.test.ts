import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ejecutarCodigo } from '../lib/ejecutor';

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

  it('timeout de 10s mata el proceso', async () => {
    const r = await ejecutarCodigo('import time\ntime.sleep(30)');
    assert.equal(r.ok, false);
    assert.ok(r.exit_code === 124 || /Timeout|timeout/i.test(r.stderr + (r.error || '')));
  });
});
