import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectarCambio, estadoDe } from '../lib/centinela';
import { dictarSistema, pideNotaDeVoz } from '../lib/voz';

describe('Centinela y dictado', () => {
  it('la primera pasada no alarma', () => {
    assert.equal(detectarCambio(null, { qwen: true }), null);
  });

  it('avisa si un nodo vivo cae y si vuelve', () => {
    const cae = detectarCambio({ qwen: true, ojo: true }, { qwen: false, ojo: true });
    assert.match(cae || '', /Cayó qwen/);
    const vuelve = detectarCambio({ qwen: false, ojo: true }, { qwen: true, ojo: true });
    assert.match(vuelve || '', /Volvió qwen/);
    assert.equal(detectarCambio({ qwen: true }, { qwen: true }), null);
  });

  it('estadoDe mapea nodos', () => {
    const e = estadoDe([
      { id: 'qwen', vivo: true, detalle: 'ok' },
      { id: 'fp', vivo: false, detalle: 'no' },
    ]);
    assert.equal(e.qwen, true);
    assert.equal(e.fp, false);
  });

  it('dicta el sistema en frases, sin teatro', () => {
    const t = dictarSistema({
      nodos: [
        { id: 'qwen', vivo: true, detalle: 'ok' },
        { id: 'ojo', vivo: false, detalle: 'timeout' },
      ],
      canales: [
        { id: 'telegram', nombre: 'Telegram', listo: true },
        { id: 'whatsapp', nombre: 'WhatsApp', listo: false, falta: 'TWILIO' },
      ],
    });
    assert.match(t, /Cayó ojo/);
    assert.match(t, /WhatsApp/);
    assert.match(t, /No toqué/);
  });

  it('detecta pedido de audio', () => {
    assert.equal(pideNotaDeVoz('mándame audio del sistema'), true);
    assert.equal(pideNotaDeVoz('envía por telegram el resumen'), false);
    assert.equal(pideNotaDeVoz('cómo está el sistema'), false);
  });
});
