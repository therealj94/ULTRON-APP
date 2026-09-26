/**
 * Aislamiento entre plataformas.
 *
 * La regla que no se puede romper: el Cerebro de Minas no sabe nada de Orden Global, y Genesis Core
 * sigue siendo exactamente lo que era. Si un día alguien mete datos de la junta en el conocimiento de
 * minas, o al revés, estas pruebas se caen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PERFILES, fijarPerfil, perfilActivo } from '../lib/perfiles';
import { hechosCerebro } from '../lib/cerebro';
import { catalogoCapacidades } from '../lib/capacidades';

const GENESIS = PERFILES.genesis;
const MINAS = PERFILES.minas;

const NODOS = {
  qwen: true, ojo: true, voz: true, memoriaS3: true,
  telegram: true, telegramIn: true, ejecutor: false, vision: true, oido: true,
};

test('el perfil se elige por entorno y cae a Genesis si no existe', async (t) => {
  await t.test('sin variable, Genesis', () => {
    fijarPerfil(null);
    delete process.env.ULTRON_PERFIL;
    assert.equal(perfilActivo().id, 'genesis');
  });

  await t.test('un perfil inventado no rompe nada: se usa Genesis', () => {
    fijarPerfil(null);
    process.env.ULTRON_PERFIL = 'no-existe';
    assert.equal(perfilActivo().id, 'genesis');
    delete process.env.ULTRON_PERFIL;
    fijarPerfil(null);
  });
});

test('el cerebro de minas no sabe de Orden Global', async (t) => {
  await t.test('su conocimiento no nombra la cadena, los tokens ni a la junta', () => {
    const c = MINAS.conocimiento;
    // 5550 y AUKA solo pueden aparecer en la regla que manda a la OTRA plataforma, no como dato.
    for (const l of c.split('\n')) {
      if (/\b(AUKA|AGKA|ONDK|ORIGEN|Ordenex|Genesis ID|Medardo|Melany|Paguada)\b/.test(l)) {
        assert.match(l, /otra plataforma|Genesis Core/, `línea con dato de OG sin marcar como ajena: ${l}`);
      }
    }
  });

  await t.test('preguntar por Orden Global no saca datos de minería: como mucho, la línea que manda a la otra plataforma', () => {
    for (const q of ['qué es la cadena 5550 y cuántos validadores tiene', 'quién es el fundador de Orden Global', 'cuánto vale un AUKA']) {
      for (const l of hechosCerebro(q, 14, MINAS)) {
        assert.match(l, /otra plataforma|Genesis Core/, `«${q}» trajo una línea que no viene al caso: ${l}`);
      }
    }
  });

  await t.test('pero sí contesta lo suyo', () => {
    const r = hechosCerebro('qué es un pórfido de cobre', 14, MINAS);
    assert.ok(r.length, 'debería traer hechos de minería');
    assert.ok(r.some((l) => /Pórfido de cobre/.test(l)));
  });

  await t.test('y distingue recurso de reserva, que es la trampa clásica', () => {
    const r = hechosCerebro('un recurso inferido se puede declarar reserva', 14, MINAS);
    assert.ok(r.some((l) => /Inferido NO se convierte en reserva/i.test(l)), r.join(' | '));
  });
});

test('Genesis Core sigue igual', async (t) => {
  await t.test('contesta lo de la cadena como siempre', () => {
    const r = hechosCerebro('qué es la cadena 5550', 14, GENESIS);
    assert.ok(r.some((l) => /5550|Besu|QBFT/.test(l)), r.join(' | '));
  });

  await t.test('no se le coló conocimiento de minería general', () => {
    assert.equal(/lixiviación en pilas|Merrill-Crowe|block caving/i.test(GENESIS.conocimiento), false);
  });

  await t.test('su identidad nombra Genesis Core y la de minas no', () => {
    assert.match(GENESIS.identidad({ nombre: 'José', canal: 'mesa' }), /Genesis Core/);
    assert.doesNotMatch(MINAS.identidad({ nombre: 'José', canal: 'mesa' }), /Genesis Core/);
  });
});

test('el catálogo de capacidades promete solo lo que la plataforma hace', async (t) => {
  await t.test('Genesis: taller y canto sí, cálculos de mina no', () => {
    fijarPerfil('genesis');
    const ids = catalogoCapacidades(NODOS).map((c) => c.id);
    assert.ok(ids.includes('sistema'), 'Genesis debe poder informar del sistema');
    assert.ok(ids.includes('canto'));
    assert.ok(!ids.includes('calculos-mina'));
    assert.ok(!ids.includes('concesiones'));
  });

  await t.test('Minas: cálculos y concesiones sí, redespliegue y canto no', () => {
    fijarPerfil('minas');
    const ids = catalogoCapacidades(NODOS).map((c) => c.id);
    assert.ok(ids.includes('calculos-mina'));
    assert.ok(ids.includes('concesiones'));
    assert.ok(!ids.includes('redeploy'), 'la demo no redespliega nada');
    assert.ok(!ids.includes('canto'));
    assert.ok(!ids.includes('oracion'));
  });

  await t.test('la tarjeta del cerebro se llama como el cerebro de cada uno', () => {
    fijarPerfil('minas');
    assert.match(catalogoCapacidades(NODOS).find((c) => c.id === 'cerebro')!.titulo, /Cerebro de Minas/);
    fijarPerfil('genesis');
    assert.match(catalogoCapacidades(NODOS).find((c) => c.id === 'cerebro')!.titulo, /Genesis Core/);
    fijarPerfil(null);
  });
});

test('la plataforma de minas se declara demostración', () => {
  assert.equal(MINAS.demo, true);
  assert.equal(GENESIS.demo, false);
  assert.ok(MINAS.reglas.some((r) => /DEMOSTRACIÓN/.test(r)), 'debe llevar la regla de demo en el prompt');
  assert.notEqual(MINAS.acento, GENESIS.acento, 'las dos plataformas deben verse distintas');
});
