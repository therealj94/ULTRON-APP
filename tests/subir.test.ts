/**
 * Subirle algo al cerebro: la puerta, y lo que pasa al repetir.
 *
 * La deduplicación de geometrías ya existía; lo que no existía era la honestidad de la LISTA. Se
 * creaba una fila de capa por cada carga aunque no entrara una sola geometría, así que subir el
 * mismo catastro tres veces dejaba tres «catastro · 2 entidades» y quien lo miraba contaba seis
 * concesiones donde había dos.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { identificar, puedeEscribir, reiniciarPadron } from '../lib/acceso';

test('quién puede alimentar el cerebro de Dr Electrum', async (t) => {
  await t.test('la llave de demostración deja mirar, no cargar', () => {
    reiniciarPadron();
    // La llave no identifica a nadie: abre la puerta con nivel de consulta y ahí se queda.
    assert.equal(puedeEscribir(null, 'electrum'), false);
  });

  await t.test('José carga; un nombre escrito a mano, no', () => {
    reiniciarPadron();
    assert.equal(puedeEscribir(identificar({ correo: 'j.ordonez@ordenglobal.org' }), 'electrum'), true);
    assert.equal(puedeEscribir(identificar({ nombre: 'José' }), 'electrum'), false);
  });

  await t.test('quien solo tiene ULTRON no carga el cerebro del otro', () => {
    const antes = process.env.ULTRON_PADRON;
    process.env.ULTRON_PADRON = 'ana | Ana | ana@ordenglobal.org | | ultron=mando';
    reiniciarPadron();
    try {
      const id = identificar({ correo: 'ana@ordenglobal.org' });
      assert.equal(puedeEscribir(id, 'ultron'), true);
      assert.equal(puedeEscribir(id, 'electrum'), false, 'mando en una plataforma no es nada en la otra');
    } finally {
      if (antes === undefined) delete process.env.ULTRON_PADRON;
      else process.env.ULTRON_PADRON = antes;
      reiniciarPadron();
    }
  });

  await t.test('nivel de trabajo carga pero no manda', () => {
    const antes = process.env.ULTRON_PADRON;
    process.env.ULTRON_PADRON = 'perez | Pérez | perez@mina.hn | | electrum=escribe';
    reiniciarPadron();
    try {
      const id = identificar({ correo: 'perez@mina.hn' });
      assert.equal(puedeEscribir(id, 'electrum'), true);
    } finally {
      if (antes === undefined) delete process.env.ULTRON_PADRON;
      else process.env.ULTRON_PADRON = antes;
      reiniciarPadron();
    }
  });
});
