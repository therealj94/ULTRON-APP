/** El cortador de frases de la mesa web (src/03-voz/frases.ts): casos del diagnóstico de voz (1-oct, H3). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cortarFrases, MIN_CORTE_COMA } from '../src/03-voz/frases';
import { COMA_PRIMERA, puntoDeCorte } from '../lib/trozos';

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

test('los tres cortadores usan el mismo umbral de coma: servidor, mesa web y app', () => {
  assert.equal(MIN_CORTE_COMA, COMA_PRIMERA);
  // La app no puede importar lib/ (Metro no sale de mobile/): el número vive en su archivo del contrato
  // (mobile/src/lib/cortesVoz.ts), que el servidor importa; el locutor de la app lo toma de ahí.
  const contrato = fs.readFileSync(path.join(import.meta.dirname, '../mobile/src/lib/cortesVoz.ts'), 'utf8');
  assert.equal(Number(contrato.match(/export const COMA_PRIMERA = (\d+);/)?.[1]), COMA_PRIMERA);
  const movil = fs.readFileSync(path.join(import.meta.dirname, '../mobile/src/lib/tts.ts'), 'utf8');
  assert.match(movil, /export const COMA_PRIMERA = COMA_PRIMERA_CORTES;/);
  assert.match(movil, /from '\.\/cortesVoz'/);
});

test('lo que el servidor suelta en una coma, la web lo dice ya (antes un tramo de 28-39 esperaba)', () => {
  const texto = 'Te recomiendo empezar ya mismo, revisar la planta y después las cuentas';
  const corte = puntoDeCorte(texto, 0);
  assert.equal(corte, texto.indexOf(','), 'el servidor corta en la coma');
  const tramo = texto.slice(0, corte + 1);
  assert.ok(tramo.length < 40, 'un tramo que antes la web retenía');
  assert.deepEqual(cortarFrases(tramo), { listas: [tramo], resto: '' });
  // Uno que el servidor todavía no suelta, la web tampoco.
  const corto = 'Te recomiendo empezar ya,';
  assert.equal(puntoDeCorte(corto + ' y', 0), -1);
  assert.deepEqual(cortarFrases(corto).listas, []);
});
