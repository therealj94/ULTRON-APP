/**
 * EL TURNO ESPECULATIVO DE LA MESA (server/turno-especulativo.ts): el teléfono empieza el turno en cuanto la persona hace
 * una pausa con la idea al parecer cerrada (mobile/src/lib/finDeTurno.ts), antes de saber si terminó. Lo que se DICE puede
 * ir adelantándose (el teléfono no lo suena hasta confirmar), pero lo que se HACE espera el «sí» del teléfono
 * (POST /api/turno/confirmar): ni acciones, ni memoria, ni herramientas antes. Sin confirmación a tiempo, se descarta.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { abrirEspeculativo, confirmarEspeculativo, confirmarEspeculativoConDetalle, descartarEspeculativo, especulativosAbiertos, ANTICIPADA_VIVE_MS } from '../server/turno-especulativo';

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

  it('confirmar lo que todavía no existe no abre nada; abrir otro con la misma clave descarta el anterior', async () => {
    // Revisión 9 (MENOR 2): una clave nunca vista guarda la confirmación (anticipada), pero no crea ningún turno.
    assert.deepEqual(confirmarEspeculativoConDetalle('nadie'), { estado: 'confirmado', anticipada: true });
    assert.equal(especulativosAbiertos(), 0);
    const a = abrirEspeculativo('k4', { plazoMs: 1_000 });
    const b = abrirEspeculativo('k4', { plazoMs: 1_000 });
    assert.equal(await a.confirmado, false);
    assert.equal(confirmarEspeculativo('k4'), 'confirmado');
    assert.equal(await b.confirmado, true);
  });

  /*
   * Revisión 9 (MENOR 2): la carrera del «sí». El confirmar llega por otra conexión y puede ganarle al stream que todavía
   * no registró su turno (el cupo, la sesión, reclamarTurno). Antes: `no-existe`, el teléfono cortaba y la frase se perdía.
   */
  it('el confirmar que llega ANTES de que el turno se abra se guarda y lo confirma al abrirse (con lo retenido)', async () => {
    const r = confirmarEspeculativoConDetalle('k5');
    assert.equal(r.estado, 'confirmado', 'el teléfono no corta: el turno se confirmará al abrirse');
    assert.equal(r.anticipada, true);
    const e = abrirEspeculativo('k5', { plazoMs: 1_000 });
    assert.equal(e.estado(), 'confirmado', 'se aplica al abrirse');
    assert.equal(await e.confirmado, true);
    const hecho: string[] = [];
    e.retener.hacer(() => hecho.push('accion'));
    assert.deepEqual(hecho, ['accion'], 'confirmado: lo que hace corre al momento');
    // Se aplica UNA vez: otro turno con la misma clave después ya no viene confirmado.
    const otro = abrirEspeculativo('k5', { plazoMs: 30 });
    assert.equal(await otro.confirmado, false);
  });

  it('el cancelar que llega antes también se guarda: el turno se abre descartado', async () => {
    descartarEspeculativo('k6', 'el teléfono lo canceló');
    const e = abrirEspeculativo('k6', { plazoMs: 1_000 });
    assert.equal(await e.confirmado, false);
    assert.equal(e.estado(), 'descartado');
  });

  it('lo anticipado vence a los pocos segundos y un confirmar tardío de un turno que ya cerró NO se guarda', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    try {
      confirmarEspeculativo('k7');
      t.mock.timers.tick(ANTICIPADA_VIVE_MS + 1);
      const e = abrirEspeculativo('k7', { plazoMs: 30 });
      assert.equal(e.estado(), 'espera', 'vencido, no confirma');
      descartarEspeculativo('k7', 'prueba');
      assert.equal(await e.confirmado, false);
      // k7 ya cerró: un confirmar tardío dice `no-existe` y no deja nada guardado para otro turno con esa clave.
      assert.equal(confirmarEspeculativo('k7'), 'no-existe');
      const reusado = abrirEspeculativo('k7', { plazoMs: 30 });
      assert.equal(reusado.estado(), 'espera', 'el confirmar tardío no confirmó al que reusó la clave');
      descartarEspeculativo('k7', 'prueba');
    } finally {
      t.mock.timers.reset();
    }
  });
});

/*
 * Revisión 9 (MENOR 3): el cupo por persona (cupoPorFrase) y lo que vuelve de un turno especulativo descartado. La ruta
 * del stream lo devuelve al descartarse (tests/turno-especulativo-servidor.test.ts, de punta a punta); aquí, el freno.
 */
describe('turno especulativo: el cupo de lo descartado', () => {
  const pedir = (idTurno: string) => {
    let codigo = 200;
    let paso = false;
    const res: any = { locals: {}, setHeader: () => undefined, status: (c: number) => ((codigo = c), res), json: () => res };
    return { res, hecho: () => ({ paso, codigo }), correr: (mw: any) => mw({ body: { idTurno } }, res, () => void (paso = true)) };
  };

  it('lo descartado vuelve al cupo (y su frase deja de estar cobrada); con un tope contra abuso', async () => {
    const { cupoPorFrase, devolverCupoDeFrase, DEVUELTOS_POR_CUPO } = await import('../server/seguridad');
    const cupo = cupoPorFrase(() => 'turno-miembro:prueba-cupo@ejemplo.org', 2);
    // Dos intentos descartados devueltos: el cupo de 2 sigue entero para las dos frases de verdad.
    for (let i = 0; i < 2; i++) {
      const p = pedir(`especulativo-${i}-abcdef`);
      p.correr(cupo);
      assert.equal(p.hecho().paso, true);
      assert.equal(devolverCupoDeFrase(p.res.locals.cupoFrase), true);
    }
    for (let i = 0; i < 2; i++) {
      const p = pedir(`de-verdad-${i}-abcdef`);
      p.correr(cupo);
      assert.equal(p.hecho().paso, true, 'la frase de verdad tiene su lugar');
    }
    const tercera = pedir('de-verdad-2-abcdef');
    tercera.correr(cupo);
    assert.equal(tercera.hecho().codigo, 429, 'el cupo de verdad sigue frenando');
    // El freno contra abuso: a lo más DEVUELTOS_POR_CUPO × el cupo por ventana; después, lo descartado sí cuenta.
    const otro = cupoPorFrase(() => 'turno-miembro:abuso@ejemplo.org', 1);
    let devueltos = 0;
    for (let i = 0; i < DEVUELTOS_POR_CUPO + 3; i++) {
      const p = pedir(`abuso-${i}-abcdefgh`);
      p.correr(otro);
      if (p.hecho().paso && devolverCupoDeFrase(p.res.locals.cupoFrase)) devueltos++;
    }
    assert.equal(devueltos, DEVUELTOS_POR_CUPO, 'no se devuelve sin fin');
  });
});
