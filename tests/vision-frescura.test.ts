/**
 * LA FRESCURA DE LO QUE VIO LA CÁMARA DEL TELÉFONO.
 *
 * Reproducción sobre 01a1359: server.ts etiquetaba `visto` siempre como «VISION (la cámara del teléfono, ahora mismo)»,
 * aunque la app reutiliza una vista de hasta 20 s (mobile/src/lib/vistaTurno.ts) y no mandaba su edad. Contrato: la app
 * manda `vistoEdadMs`; hasta ~3 s es «ahora mismo»; más vieja, «hace N s» y el modelo no la describe como actual; sin
 * edad, «de hace un momento», nunca «ahora mismo».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../lib/vision-estructurada';

const hecho = (V as any).hechoVisionDelTelefono as (visto: string, edad: number | null) => string;
const edad = (V as any).edadDeVista as (v: unknown) => number | null;

test('reciente (≤ 3 s): «ahora mismo»', () => {
  assert.equal(typeof hecho, 'function');
  assert.match(hecho('Una taza roja.', 0), /^VISION \(la cámara del teléfono, ahora mismo\): Una taza roja\.$/);
  assert.match(hecho('Una taza roja.', 2500), /ahora mismo/);
});

test('vieja (15 s): «hace 15 s» y el modelo no la describe como actual', () => {
  const h = hecho('Una taza roja.', 15_000);
  assert.doesNotMatch(h, /ahora mismo\)/);
  assert.match(h, /^VISION \(la cámara del teléfono, hace 15 s\): Una taza roja\./);
  assert.match(h, /no lo describas como actual/);
});

test('sin edad (app anterior): «de hace un momento», nunca «ahora mismo»', () => {
  const h = hecho('Una taza roja.', null);
  assert.match(h, /^VISION \(la cámara del teléfono, de hace un momento\)/);
  assert.doesNotMatch(h, /\(la cámara del teléfono, ahora mismo\)/);
});

test('la edad que manda la app se sanea', () => {
  assert.equal(edad(undefined), null);
  assert.equal(edad(''), null);
  assert.equal(edad('abc'), null);
  assert.equal(edad(true), null);
  assert.equal(edad(20 * 60_000), null, 'más de 10 min no es creíble');
  assert.equal(edad(-500), 0, 'un poco negativa (relojes): 0');
  assert.equal(edad(-60_000), null);
  assert.equal(edad('4200.6'), 4201);
});
