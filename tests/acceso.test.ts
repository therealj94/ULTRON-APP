/**
 * El padrón y las dos puertas.
 *
 * Lo que se prueba acá no es que el código corra: es que NO deje pasar. Cada caso de abajo fue, en
 * algún momento de este repositorio, un agujero real o un agujero a un descuido de distancia.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  identificar,
  nivelDe,
  padron,
  personaPorId,
  puedeEntrar,
  puedeEscribir,
  puedeMandar,
  reiniciarPadron,
} from '../lib/acceso';
import { quienEs, puedeCambiarSistema } from '../lib/junta';
import { autorizarElectrum, electrumWebhookSecretOk } from '../server/electrum/telegram';
import { telegramWebhookSecretOk } from '../lib/telegram-in';
import { MANOS, TODAS } from '../server/electrum/manos';
import { ESPECIALISTAS } from '../server/electrum/especialistas';

/** Corre `fn` con esas variables de entorno puestas y las deja como estaban. */
function conEntorno(vars: Record<string, string | undefined>, fn: () => void) {
  const antes: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    antes[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  reiniciarPadron();
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    reiniciarPadron();
  }
}

test('el padrón de arranque', async (t) => {
  await t.test('José y Medardo mandan en las dos plataformas', () => {
    reiniciarPadron();
    assert.equal(nivelDe(personaPorId('jose'), 'ultron'), 'mando');
    assert.equal(nivelDe(personaPorId('jose'), 'electrum'), 'mando');
    assert.equal(nivelDe(personaPorId('medardo'), 'electrum'), 'mando');
  });

  await t.test('Carlos y Mayra consultan AU-RA y NO existen en Dr Electrum', () => {
    reiniciarPadron();
    assert.equal(nivelDe(personaPorId('carlos'), 'ultron'), 'lee');
    assert.equal(nivelDe(personaPorId('carlos'), 'electrum'), null);
    assert.equal(nivelDe(personaPorId('mayra'), 'electrum'), null);
    assert.equal(puedeEntrar(personaPorId('mayra'), 'electrum'), false);
  });

  await t.test('un desconocido no entra a ninguna: se niega por omisión', () => {
    reiniciarPadron();
    assert.equal(identificar({ nombre: 'Melany' }), null);
    assert.equal(identificar({ correo: 'cualquiera@gmail.com' }), null);
    assert.equal(identificar({ telegramUserId: '404040' }), null);
    assert.equal(puedeEntrar(null, 'electrum'), false);
    assert.equal(puedeEntrar(null, 'ultron'), false);
  });
});

test('decir quién sos no es serlo', async (t) => {
  await t.test('un nombre escrito a mano identifica, pero no da permiso', () => {
    reiniciarPadron();
    const porNombre = identificar({ nombre: 'José' });
    assert.equal(porNombre?.persona.id, 'jose');
    assert.equal(porNombre?.prueba, 'nombre');
    // Es José a efectos de saludarlo. No lo es a efectos de tocar nada.
    assert.equal(puedeMandar(porNombre, 'ultron'), false);
    assert.equal(puedeEscribir(porNombre, 'electrum'), false);
  });

  await t.test('el correo de una sesión firmada sí da permiso', () => {
    reiniciarPadron();
    const porCorreo = identificar({ correo: 'j.ordonez@ordenglobal.org' });
    assert.equal(porCorreo?.prueba, 'sesion');
    assert.equal(puedeMandar(porCorreo, 'ultron'), true);
    assert.equal(puedeEscribir(porCorreo, 'electrum'), true);
  });

  await t.test('un Telegram verificado también', () => {
    conEntorno({ TELEGRAM_JOSE_USER_ID: '111' }, () => {
      const t2 = identificar({ telegramUserId: '111' });
      assert.equal(t2?.persona.id, 'jose');
      assert.equal(t2?.prueba, 'telegram');
      assert.equal(puedeMandar(t2, 'ultron'), true);
    });
  });
});

test('ULTRON_PADRON amplía sin desplegar', async (t) => {
  await t.test('agrega a alguien que solo existe en Dr Electrum', () => {
    conEntorno({ ULTRON_PADRON: 'perez | Ing. Pérez | perez@mina.hn | 778899 | electrum=escribe' }, () => {
      const p = personaPorId('perez');
      assert.equal(p?.nombre, 'Ing. Pérez');
      assert.equal(nivelDe(p, 'electrum'), 'escribe');
      assert.equal(nivelDe(p, 'ultron'), null);

      // Y ESTO es la separación: para AU-RA, Pérez no existe.
      assert.equal(quienEs({ correo: 'perez@mina.hn' }), null);
      assert.equal(puedeCambiarSistema('perez'), false);

      const id = identificar({ correo: 'perez@mina.hn' });
      assert.equal(puedeEscribir(id, 'electrum'), true);
      assert.equal(puedeMandar(id, 'electrum'), false);
    });
  });

  await t.test('una columna vacía funde, no borra', () => {
    conEntorno({ ULTRON_PADRON: 'jose | | | 445566 |' }, () => {
      const j = personaPorId('jose');
      assert.ok(j?.telegram.includes('445566'), 'le entró el Telegram nuevo');
      assert.ok(j?.correos.includes('j.ordonez@ordenglobal.org'), 'no le borró el correo de siempre');
      assert.equal(nivelDe(j, 'ultron'), 'mando', 'no le borró el mando');
    });
  });

  await t.test('baja de nivel: quitarle el mando a alguien es cambiar una palabra', () => {
    conEntorno({ ULTRON_PADRON: 'medardo | | | | ultron=lee electrum=lee' }, () => {
      assert.equal(puedeCambiarSistema('medardo'), false);
      assert.equal(nivelDe(personaPorId('medardo'), 'electrum'), 'lee');
    });
  });

  await t.test('también acepta JSON, y una línea rota no tumba el padrón', () => {
    conEntorno({ ULTRON_PADRON: '[{"id":"ana","nombre":"Ana","acceso":{"electrum":"mando"}}]' }, () => {
      assert.equal(nivelDe(personaPorId('ana'), 'electrum'), 'mando');
    });
    conEntorno({ ULTRON_PADRON: 'basura sin columnas\n\n| | | |\nperez | Pérez | | | electrum=lee' }, () => {
      assert.equal(nivelDe(personaPorId('perez'), 'electrum'), 'lee');
      assert.ok(padron().length >= 5, 'los de siempre siguen ahí');
    });
  });
});

test('la puerta de Dr Electrum en Telegram', async (t) => {
  await t.test('un desconocido no pasa', () => {
    conEntorno({ ELECTRUM_TELEGRAM_CHATS: undefined }, () => {
      assert.equal(autorizarElectrum('999', '999', 'Fulano'), null);
    });
  });

  await t.test('estar en la junta NO es estar en Electrum', () => {
    conEntorno({ TELEGRAM_CARLOS_USER_ID: '1017697215', ELECTRUM_TELEGRAM_CHATS: '-100777' }, () => {
      // Carlos entra a AU-RA pero no tiene Electrum. Ni siquiera dentro de la sala de demostración:
      // a él se le dijo que no explícitamente, y eso pesa más que una sala abierta.
      assert.equal(autorizarElectrum('-100777', '1017697215', 'Carlos'), null);
    });
  });

  await t.test('en la sala de demostración, un invitado consulta y nada más', () => {
    conEntorno({ ELECTRUM_TELEGRAM_CHATS: '-100777' }, () => {
      const q = autorizarElectrum('-100777', '555', 'Cliente');
      assert.equal(q?.nivel, 'lee');
      assert.equal(q?.id, null, 'no es nadie del padrón');
      // Fuera de esa sala, el mismo invitado no existe.
      assert.equal(autorizarElectrum('-100888', '555', 'Cliente'), null);
    });
  });

  await t.test('José manda, venga del chat que venga', () => {
    conEntorno({ TELEGRAM_JOSE_USER_ID: '111', ELECTRUM_TELEGRAM_CHATS: undefined }, () => {
      const q = autorizarElectrum('222333', '111', 'José');
      assert.equal(q?.nivel, 'mando');
      assert.equal(q?.nombre, 'José');
    });
  });

  await t.test('cada bot tiene su secreto: el de uno no abre la puerta del otro', () => {
    conEntorno({ TELEGRAM_WEBHOOK_SECRET: 'secreto-ultron', ELECTRUM_WEBHOOK_SECRET: 'secreto-electrum' }, () => {
      assert.equal(telegramWebhookSecretOk('secreto-ultron'), true);
      assert.equal(electrumWebhookSecretOk('secreto-electrum'), true);
      assert.equal(electrumWebhookSecretOk('secreto-ultron'), false);
      assert.equal(telegramWebhookSecretOk('secreto-electrum'), false);
    });
    // Sin secreto puesto no se abre por descuido: un webhook sin firmar no entra.
    conEntorno({ ELECTRUM_WEBHOOK_SECRET: undefined }, () => {
      assert.equal(electrumWebhookSecretOk(''), false);
      assert.equal(electrumWebhookSecretOk('lo-que-sea'), false);
    });
  });
});

test('las herramientas no se prestan entre cerebros', async (t) => {
  await t.test('toda mano declara dónde vive', () => {
    for (const [nombre, h] of Object.entries(MANOS)) {
      assert.ok(Array.isArray(h.plataformas) && h.plataformas.length, `${nombre} no declara plataforma`);
    }
  });

  await t.test('el panel de Electrum solo recibe manos de Electrum', () => {
    for (const h of TODAS) assert.ok(h.plataformas.includes('electrum'), `${h.nombre} no es de Electrum`);
  });

  await t.test('las compartidas son las cuatro que pasan la prueba, y ninguna más', () => {
    // La prueba para compartir una mano: ¿es literalmente el mismo hecho del mundo para los dos
    // cerebros? El oro es el mismo oro, la aritmética de mina no cambia según quién pregunte, e
    // internet es internet. El catastro no. Esta lista es corta a propósito: si crece, alguien
    // está deshaciendo la separación y este test se lo dice.
    const compartidas = Object.values(MANOS)
      .filter((h) => h.plataformas.includes('ultron') && h.plataformas.includes('electrum'))
      .map((h) => h.nombre)
      .sort();
    assert.deepEqual(compartidas, ['calculo_mina', 'metales_spot', 'web_buscar', 'web_leer']);
  });

  await t.test('el informe es de Electrum y no se presta', () => {
    assert.deepEqual(MANOS.informe_pdf.plataformas, ['electrum']);
  });

  await t.test('todo lo que un especialista pide de verdad existe', () => {
    // Cinco de los ocho declaraban `web_buscar` y `web_leer` cuando no estaban escritas. `manosDe`
    // las filtraba en silencio, así que el prompt le prometía al modelo una herramienta que no
    // tenía. Un modelo al que se le promete una herramienta que no existe no se calla: la inventa.
    for (const e of ESPECIALISTAS) {
      for (const h of e.herramientas) {
        assert.ok(MANOS[h], `${e.nombre} pide «${h}» y esa mano no existe`);
      }
    }
  });

  await t.test('el catastro y el mapa NO se comparten', () => {
    for (const n of ['catastro_buscar', 'gis_traslapes', 'mapa_volar', 'expediente_buscar']) {
      assert.deepEqual(MANOS[n].plataformas, ['electrum'], n);
    }
  });
});
