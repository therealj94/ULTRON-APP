import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { guardarHechoQuien, promptMemoria, recordarTurno, registrarCambio, resetMemoriaTest, fotoMemoria } from '../lib/memoria';

describe('Memoria por miembro', () => {
  it('no mezcla la conversación de José con la de Medardo', async () => {
    resetMemoriaTest();
    await recordarTurno({ quien: 'jose', rol: 'user', texto: 'José: anota que mañana firmo yo', canal: 'telegram' });
    await recordarTurno({ quien: 'jose', rol: 'ultron', texto: 'Anotado para vos, José.', canal: 'telegram' });
    await recordarTurno({ quien: 'medardo', rol: 'user', texto: 'Medardo: el precio del mineral lo veo yo', canal: 'mesa' });
    await recordarTurno({ quien: 'medardo', rol: 'ultron', texto: 'Quedó en tu hilo, Medardo.', canal: 'mesa' });

    const pj = promptMemoria('jose');
    const pm = promptMemoria('medardo');
    assert.match(pj, /HABLAS CON: José/);
    assert.match(pj, /Anotado para vos, José/);
    assert.equal(pj.includes('precio del mineral'), false);
    assert.match(pm, /HABLAS CON: Medardo/);
    assert.match(pm, /precio del mineral/);
    assert.equal(pm.includes('mañana firmo yo'), false);
  });

  it('registra quién pidió el cambio', async () => {
    resetMemoriaTest();
    await registrarCambio({ quien: 'jose', canal: 'telegram', que: 'pdf enviado' });
    await registrarCambio({ quien: 'medardo', canal: 'mesa', que: 'tarea anotada' });
    const f = fotoMemoria('jose');
    assert.ok(f.cambios.some((c) => c.quien === 'jose' && /pdf/.test(c.que)));
    assert.ok(f.cambios.some((c) => c.quien === 'medardo' && /tarea/.test(c.que)));
    assert.equal(f.honesto, true);
  });

  it('guarda un hecho personal solo en ese perfil', async () => {
    resetMemoriaTest();
    await guardarHechoQuien({ quien: 'jose', hecho: 'José toma café negro', canal: 'mesa' });
    const j = fotoMemoria('jose');
    const m = fotoMemoria('medardo');
    assert.ok(j.privada.larga.some((h) => /café negro/.test(h.hecho)));
    assert.equal(m.privada.larga.some((h) => /café negro/.test(h.hecho)), false);
  });

  it('no mezcla la conversación de Carlos con la de José', async () => {
    resetMemoriaTest();
    await recordarTurno({ quien: 'carlos', rol: 'user', texto: 'Carlos: reviso operaciones ORIGEN', canal: 'telegram' });
    await recordarTurno({ quien: 'jose', rol: 'user', texto: 'José: firmo yo mañana', canal: 'telegram' });
    const pc = promptMemoria('carlos');
    const pj = promptMemoria('jose');
    assert.match(pc, /HABLAS CON: Carlos/);
    assert.match(pc, /operaciones ORIGEN/);
    assert.equal(pc.includes('firmo yo mañana'), false);
    assert.equal(pj.includes('operaciones ORIGEN'), false);
  });

  it('no mezcla la conversación de Mayra con la de Carlos', async () => {
    resetMemoriaTest();
    await recordarTurno({ quien: 'mayra', rol: 'user', texto: 'Mayra: tomo té verde por la mañana', canal: 'telegram' });
    await recordarTurno({ quien: 'carlos', rol: 'user', texto: 'Carlos: reviso operaciones ORIGEN', canal: 'telegram' });
    const py = promptMemoria('mayra');
    const pc = promptMemoria('carlos');
    assert.match(py, /HABLAS CON: Mayra/);
    assert.match(py, /té verde/);
    assert.equal(py.includes('operaciones ORIGEN'), false);
    assert.equal(pc.includes('té verde'), false);
    assert.match(py, /ACCESO: consulta/);
    assert.match(promptMemoria('jose'), /ACCESO: mando/);
  });
});
