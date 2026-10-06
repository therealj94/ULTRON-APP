/**
 * EL ACUSE ANTES DEL SEGUNDO PARA LO QUE SIEMPRE TARDA (mobile/src/lib/relleno.ts esperaDeRelleno). La charla ya contesta
 * en ~1–1,5 s (la ruta de charla del servidor) y no necesita relleno antes de ESPERA_FRASE_MS; lo que siempre tarda
 * (buscar en internet, leer una página o un documento, revisar) se acusa a los ACUSE_TAREA_MS, como una persona que dice
 * «a ver…» mientras busca. Las palabras las pone el banco de frases (compa/frasesEstado.ts); aquí solo el cuándo. Si la
 * respuesta llega antes de que suene, el relleno se tira igual que siempre.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACUSE_TAREA_MS, RellenoTurno, esperaDeRelleno } from '../mobile/src/lib/relleno';
import { ESPERA_FRASE_MS } from '../mobile/src/compa/frasesEstado';

describe('relleno: cuándo se acusa', () => {
  it('buscar, leer o revisar: antes del segundo; charla, abrir o hacer algo rápido: lo de siempre', () => {
    assert.ok(ACUSE_TAREA_MS < 1000);
    for (const e of ['buscando', 'leyendo', 'revisando']) assert.equal(esperaDeRelleno(e, ESPERA_FRASE_MS), ACUSE_TAREA_MS, e);
    for (const e of ['pensando', 'abriendo', 'haciendo', 'calculando']) assert.equal(esperaDeRelleno(e, ESPERA_FRASE_MS), ESPERA_FRASE_MS, e);
  });

  it('programar con otra espera la usa', () => {
    const timers: { ms: number; f: () => void }[] = [];
    let dichos = 0;
    const r = new RellenoTurno({ esperaMs: ESPERA_FRASE_MS, decir: () => dichos++, setTimeout: (f, ms) => (timers.push({ ms, f }), 1 as any), clearTimeout: () => {} });
    r.programar(false, ACUSE_TAREA_MS);
    assert.equal(timers[0].ms, ACUSE_TAREA_MS);
    timers[0].f();
    assert.equal(dichos, 1);
  });
});
