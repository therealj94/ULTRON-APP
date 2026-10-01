/** Las órdenes de la PC en la voz (lib/ordenes-pc.ts) y su canal (empujarOrdenPc). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FiltroOrdenes, ordenDeMarca, quitarMarcas } from '../lib/ordenes-pc';
import { empujarOrdenPc, oyentesDe, suscribir } from '../lib/acciones-app';

test('el filtro quita la marca aunque llegue partida y entrega la orden una vez', () => {
  const f = new FiltroOrdenes();
  const vistas: string[] = [];
  const dicho = ['Va. ⟦ha', 'cer: pon bad bunny en spotify', '⟧ Listo'].map((t) => f.agregar(t, (o) => vistas.push(o))).join('');
  assert.equal(dicho, 'Va.  Listo');
  assert.deepEqual(vistas, ['pon bad bunny en spotify']);
  assert.deepEqual(f.ordenes, ['pon bad bunny en spotify']);
});

test('lo que no es una orden se quita igual pero no se hace', () => {
  const f = new FiltroOrdenes();
  assert.equal(f.agregar('⟦cualquier cosa⟧ hola'), ' hola');
  assert.deepEqual(f.ordenes, []);
  assert.equal(ordenDeMarca('do: close chrome.'), 'close chrome');
  assert.equal(ordenDeMarca('hacer:'), null);
  assert.equal(ordenDeMarca('hacer: algo\nmás'), null);
  assert.equal(quitarMarcas('Va. ⟦hacer: cierra chrome⟧'), 'Va.');
});

test('la orden de la PC va solo al canal de ese aparato, nunca a todos', () => {
  const vistos: { canal: string; nombre: string; datos: any }[] = [];
  const correo = `pc-${Date.now()}@x.com`;
  const s1 = suscribir(correo, () => {}, { aparato: 'win-1', alEvento: (nombre, datos) => vistos.push({ canal: 'win-1', nombre, datos }) });
  const s2 = suscribir(correo, () => {}, { aparato: 'tel-1', alEvento: (nombre, datos) => vistos.push({ canal: 'tel-1', nombre, datos }) });
  try {
    assert.equal(empujarOrdenPc(correo, null, { orden: 'cierra chrome', dicho: 'cierra chrome' }), 0, 'sin aparato no va a nadie');
    assert.equal(empujarOrdenPc(correo, 'win-1', { orden: 'cierra chrome', dicho: 'ciérrame chrome' }), 1);
    assert.equal(vistos.length, 1);
    assert.equal(vistos[0].canal, 'win-1');
    assert.equal(vistos[0].nombre, 'pc');
    assert.equal(vistos[0].datos.orden, 'cierra chrome');
    assert.equal(vistos[0].datos.dicho, 'ciérrame chrome');
    assert.ok(vistos[0].datos.id);
  } finally {
    s1();
    s2();
  }
});

test('el canal del .exe de Windows no cuenta como teléfono escuchando', () => {
  const correo = `oy-${Date.now()}@x.com`;
  const w = suscribir(correo, () => {}, { aparato: 'win-0123456789abcdef' });
  try {
    assert.equal(oyentesDe(correo), 0);
    const t = suscribir(correo, () => {}, { aparato: 'tel-1' });
    assert.equal(oyentesDe(correo), 1);
    t();
  } finally {
    w();
  }
});
