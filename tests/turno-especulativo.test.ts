/**
 * EL TURNO ESPECULATIVO DE LA MESA (server/turno-especulativo.ts): el teléfono empieza el turno en cuanto la persona hace
 * una pausa con la idea al parecer cerrada (mobile/src/lib/finDeTurno.ts), antes de saber si terminó. Lo que se DICE puede
 * ir adelantándose (el teléfono no lo suena hasta confirmar), pero lo que se HACE espera el «sí» del teléfono
 * (POST /api/turno/confirmar): ni acciones, ni memoria, ni herramientas antes. Sin confirmación a tiempo, se descarta.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { abrirEspeculativo, confirmarEspeculativo, descartarEspeculativo, especulativosAbiertos } from '../server/turno-especulativo';

const espera = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe('turno especulativo (servidor): la retención', () => {
  it('lo que el turno hace espera la confirmación y entonces corre, en orden; lo de después corre al momento', async () => {
    const e = abrirEspeculativo('k1', { plazoMs: 1_000 });
    const hecho: string[] = [];
    e.retener.hacer(() => hecho.push('accion'));
    e.retener.recordar(() => hecho.push('memoria'));
    e.retener.alDescartar(() => hecho.push('deshacer'));
    await espera();
    assert.deepEqual(hecho, [], 'nada antes de confirmar');
    assert.equal(e.estado(), 'espera');
    assert.equal(confirmarEspeculativo('k1'), 'confirmado');
    assert.equal(await e.confirmado, true);
    assert.deepEqual(hecho, ['accion', 'memoria'], 'al confirmar corre lo retenido; lo de deshacer, no');
    e.retener.hacer(() => hecho.push('despues'));
    assert.deepEqual(hecho, ['accion', 'memoria', 'despues']);
    assert.equal(especulativosAbiertos(), 0, 'confirmado, ya no ocupa lugar');
  });

  it('descartado: lo retenido no corre nunca y se deshace lo anotado', async () => {
    const e = abrirEspeculativo('k2', { plazoMs: 1_000 });
    const hecho: string[] = [];
    e.retener.hacer(() => hecho.push('accion'));
    e.retener.alDescartar(() => hecho.push('deshacer'));
    descartarEspeculativo('k2', 'siguió hablando');
    assert.equal(await e.confirmado, false);
    assert.deepEqual(hecho, ['deshacer']);
    e.retener.hacer(() => hecho.push('tarde'));
    assert.deepEqual(hecho, ['deshacer'], 'lo que llega después de descartar tampoco corre');
    assert.equal(confirmarEspeculativo('k2'), 'no-existe', 'confirmar tarde no lo revive');
  });

  it('sin confirmación en su plazo, se descarta solo', async () => {
    const e = abrirEspeculativo('k3', { plazoMs: 30 });
    const hecho: string[] = [];
    e.retener.hacer(() => hecho.push('accion'));
    assert.equal(await e.confirmado, false);
    assert.equal(e.estado(), 'descartado');
    assert.deepEqual(hecho, []);
  });

  it('confirmar lo que no existe no hace nada; abrir otro con la misma clave descarta el anterior', async () => {
    assert.equal(confirmarEspeculativo('nadie'), 'no-existe');
    const a = abrirEspeculativo('k4', { plazoMs: 1_000 });
    const b = abrirEspeculativo('k4', { plazoMs: 1_000 });
    assert.equal(await a.confirmado, false);
    assert.equal(confirmarEspeculativo('k4'), 'confirmado');
    assert.equal(await b.confirmado, true);
  });
});
