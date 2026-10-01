import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { capturaAcotada, ejecutarCodigo, ejecutorActivo, TOPE_CAPTURA_BYTES } from '../lib/ejecutor';

// python3 en el host solo corre con marca explícita de desarrollo (lib/entorno.ts). Estas pruebas la
// ponen a propósito; la de abajo comprueba que sin ella no corre nada.
process.env.AURA_DEV = '1';

/** Corre `fn` con el entorno cambiado y lo deja como estaba. */
async function conEntorno<T>(cambios: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const antes = Object.fromEntries(Object.keys(cambios).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(cambios)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(antes)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}

describe('Fase 0.2 — el ejecutor falla cerrado', () => {
  it('sin NODE_ENV ni AURA_DEV (y sin sandbox) no corre python en el host', () =>
    conEntorno({ NODE_ENV: undefined, AURA_DEV: undefined, EJECUTOR_URL: undefined, EJECUTOR_DOCKER: undefined, EJECUTOR_ACTIVO: undefined }, async () => {
      assert.equal(ejecutorActivo(), false);
      const r = await ejecutarCodigo('print(1+1)');
      assert.equal(r.ok, false);
      assert.equal(r.via, 'omitido');
      assert.equal(r.stdout, '');
    }));

  it('NODE_ENV=production gana aunque alguien deje AURA_DEV=1', () =>
    conEntorno({ NODE_ENV: 'production', AURA_DEV: '1', EJECUTOR_URL: undefined, EJECUTOR_DOCKER: undefined, EJECUTOR_ACTIVO: undefined }, async () => {
      assert.equal(ejecutorActivo(), false);
      const r = await ejecutarCodigo('print(1+1)');
      assert.equal(r.via, 'omitido');
    }));
});

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
