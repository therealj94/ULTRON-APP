/** El cortador de frases de la mesa web (src/03-voz/frases.ts): casos del diagnóstico de voz (1-oct, H3). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cortarFrases } from '../src/03-voz/frases';

test('una frase terminada en punto SIN espacio después sale ya (antes esperaba al trozo siguiente)', () => {
  assert.deepEqual(cortarFrases('El oro está en 4 163 dólares.'), { listas: ['El oro está en 4 163 dólares.'], resto: '' });
  assert.deepEqual(cortarFrases('¿Te llamo?'), { listas: ['¿Te llamo?'], resto: '' });
  assert.deepEqual(cortarFrases('Dijo «listo.»'), { listas: ['Dijo «listo.»'], resto: '' });
});

test('dos frases: salen las dos; la que no terminó se queda', () => {
  assert.deepEqual(cortarFrases('Primera. Segunda.'), { listas: ['Primera.', 'Segunda.'], resto: '' });
  assert.deepEqual(cortarFrases('Primera. Segunda sin termin'), { listas: ['Primera.'], resto: 'Segunda sin termin' });
});

test('un corte por coma largo (lo decidió el servidor) sale; uno corto espera', () => {
  const largo = 'Mira, con lo que me cuentas de la planta de beneficio,';
  assert.deepEqual(cortarFrases(largo).listas, [largo]);
  assert.deepEqual(cortarFrases('Mira,'), { listas: [], resto: 'Mira,' });
});

test('al final del turno sale todo', () => {
  assert.deepEqual(cortarFrases('lo último sin punto', true), { listas: ['lo último sin punto'], resto: '' });
  assert.deepEqual(cortarFrases('', true), { listas: [], resto: '' });
});
