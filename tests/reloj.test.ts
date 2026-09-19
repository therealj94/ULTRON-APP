import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ahoraHonduras, lineaReloj, preguntaHora } from '../lib/reloj';

describe('Reloj Honduras', () => {
  it('formatea YYYY-MM-DD HH:mm en Tegucigalpa', () => {
    const s = ahoraHonduras(new Date('2026-09-19T18:30:00Z'));
    assert.match(s, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // 18:30 UTC = 12:30 Honduras (UTC-6)
    assert.equal(s, '2026-09-19 12:30');
    assert.equal(lineaReloj(new Date('2026-09-19T18:30:00Z')), 'AHORA Honduras: 2026-09-19 12:30 (America/Tegucigalpa).');
  });

  it('detecta pregunta de hora', () => {
    assert.equal(preguntaHora('qué hora es'), true);
    assert.equal(preguntaHora('precio del oro'), false);
  });
});
