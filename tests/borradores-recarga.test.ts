/**
 * UI01 (auditoría del 3-oct): un borrador del chat no se pierde si la actualización por aire recarga la app
 * (mobile/src/pulse/borradoresRecarga.ts, lo puro; borradores.ts lo guarda en el llavero antes de recargar).
 *
 * Lo que tiene que ser verdad:
 *   · antes de recargar se guarda lo escrito (solo lo que tiene texto), con la cuenta dueña;
 *   · al volver, se devuelve SOLO a esa cuenta: otra cuenta lo descarta sin verlo, sin cuenta todavía espera;
 *   · un alijo viejo (más de VIDA_ALIJO_MS) o roto se descarta;
 *   · si lo escrito no cabe en el llavero, se dice (y entonces la recarga se sigue frenando).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { armarAlijo, bytesUtf8, MAX_ALIJO_BYTES, restaurarAlijo, VIDA_ALIJO_MS } from '../mobile/src/pulse/borradoresRecarga';

const T0 = 1_760_000_000_000;

test('armar: guarda lo que tiene texto, con su dueño; sin borradores no hay alijo', () => {
  const a = armarAlijo('Ana@x.hn', { 'beto@x.hn': { texto: 'llego tarde', deVoz: false, en: T0 }, 'caro@x.hn': { texto: '   ', deVoz: false, en: T0 } }, T0);
  assert.equal(a.cabe, true);
  const j = JSON.parse(a.json!);
  assert.equal(j.correo, 'ana@x.hn');
  assert.deepEqual(Object.keys(j.borradores), ['beto@x.hn'], 'uno vacío no se guarda');
  assert.deepEqual(armarAlijo('ana@x.hn', {}, T0), { json: null, cabe: true });
  assert.deepEqual(armarAlijo('', { 'beto@x.hn': { texto: 'hola', deVoz: false, en: T0 } }, T0), { json: null, cabe: false }, 'sin cuenta no se guarda (y no se promete)');
});

test('armar: lo que no cabe en el llavero se dice', () => {
  const largo = 'ñ'.repeat(MAX_ALIJO_BYTES);
  const a = armarAlijo('ana@x.hn', { 'beto@x.hn': { texto: largo, deVoz: false, en: T0 } }, T0);
  assert.equal(a.cabe, false);
  assert.equal(a.json, null);
  assert.equal(bytesUtf8('ñ'), 2);
  assert.equal(bytesUtf8('a'), 1);
  assert.equal(bytesUtf8('😀'), 4);
});

test('restaurar: solo a la misma cuenta; otra lo descarta; sin cuenta, espera; viejo o roto, se descarta', () => {
  const { json } = armarAlijo('ana@x.hn', { 'beto@x.hn': { texto: 'llego tarde', deVoz: true, en: T0 } }, T0);
  const mismo = restaurarAlijo(json, 'ANA@x.hn', T0 + 60_000);
  assert.equal(mismo.accion, 'restaurar');
  assert.deepEqual(mismo.borradores, { 'beto@x.hn': { texto: 'llego tarde', deVoz: true, en: T0 } });
  assert.deepEqual(restaurarAlijo(json, 'otra@x.hn', T0 + 60_000), { accion: 'descartar', borradores: null }, 'otra cuenta no lo ve');
  assert.deepEqual(restaurarAlijo(json, '', T0 + 60_000), { accion: 'esperar', borradores: null });
  assert.deepEqual(restaurarAlijo(json, 'ana@x.hn', T0 + VIDA_ALIJO_MS + 1), { accion: 'descartar', borradores: null }, 'viejo');
  assert.deepEqual(restaurarAlijo('{roto', 'ana@x.hn', T0), { accion: 'descartar', borradores: null });
  assert.deepEqual(restaurarAlijo(null, 'ana@x.hn', T0), { accion: 'nada', borradores: null });
  // Un alijo con basura dentro no mete basura en el chat.
  const raro = JSON.stringify({ v: 1, correo: 'ana@x.hn', en: T0, borradores: { 'beto@x.hn': { texto: 5 }, 'caro@x.hn': { texto: 'hola' } } });
  assert.deepEqual(restaurarAlijo(raro, 'ana@x.hn', T0).borradores, { 'caro@x.hn': { texto: 'hola', deVoz: false, en: T0 } });
});
