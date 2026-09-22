/**
 * El nombre nuevo: AU-RA FP. «Ultron» es una marca ajena y se retiró de lo que se ve y se oye.
 * Las rutas /api/ultron/*, los encabezados X-Ultron-* y las variables ULTRON_* siguen igual a
 * propósito: las usan las APK ya instaladas y los servicios desplegados (docs/RENOMBRE-AU-RA-FP.md).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { afinarParaBoca } from '../server/habla';
import { detectarIntencion } from '../src/04-cerebro/intenciones';

describe('Nombre AU-RA FP', () => {
  it('la boca dice «Aura», no deletrea A-U-R-A', () => {
    assert.equal(afinarParaBoca('Soy AU-RA FP.'), 'Soy Aura efe pe.');
    assert.equal(afinarParaBoca('Te habla AU-RA'), 'Te habla Aura');
  });

  it('responde cuando la llaman por el nombre nuevo, y también por el viejo', () => {
    assert.deepEqual(detectarIntencion('¿qué es aura?'), { tipo: 'clip', id: 'quien' });
    assert.deepEqual(detectarIntencion('que es ultron'), { tipo: 'clip', id: 'quien' });
  });
});
