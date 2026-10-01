/**
 * El prompt del turno: lo fijo arriba y lo del turno al final (server/prompt-turno.ts piezasDelTurno).
 *
 * llama.cpp reutiliza lo que ya leyó mientras el principio del prompt no cambie. 30-sep: la hora
 * («AHORA: …», cambia cada minuto) iba casi al principio y los HECHOS en medio, así que el nodo releía
 * ~4 000 fichas en cada turno y la primera palabra de la llamada tardaba 7–9 s (ElevenLabs corta a los 4).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { piezasDelTurno, personalidadDelTurno } from '../server/prompt-turno';
import { construirMensajes } from '../lib/qwen';

const base = {
  nivel: 'junta' as const,
  nombre: 'José',
  canal: 'mesa' as const,
  modo: 'CREATIVE',
  mando: false,
  quien: null,
  quienMem: null,
};

/** El system de dos turnos distintos de la misma persona. */
function dosTurnos() {
  const t1 = piezasDelTurno({ ...base, agente: null, bloqueApp: 'APP: pantalla mesa', hechos: ['SPOT XAU/USD = 3000'] }, new Date('2026-09-30T20:00:00Z'));
  const t2 = piezasDelTurno({ ...base, agente: 'investigador', bloqueApp: 'APP: pantalla chats', hechos: ['BÚSQUEDA WEB: algo'] }, new Date('2026-09-30T20:07:00Z'));
  const s1 = construirMensajes({ personalidad: t1.fijo, delTurno: t1.delTurno, user: 'Cuéntame un chiste', canal: 'mesa', nivel: 'junta' }).messages[0].content;
  const s2 = construirMensajes({ personalidad: t2.fijo, delTurno: t2.delTurno, user: 'Busca el precio del oro', canal: 'mesa', nivel: 'junta' }).messages[0].content;
  return { t1, t2, s1, s2 };
}

test('lo fijo es idéntico entre turnos aunque cambien la hora, la app, el agente y los HECHOS', () => {
  const { t1, t2 } = dosTurnos();
  assert.equal(t1.fijo, t2.fijo);
  assert.notEqual(t1.delTurno, t2.delTurno);
  assert.ok(!t1.fijo.includes('AHORA:'), 'la hora no va en lo fijo');
  assert.ok(!t1.fijo.includes('SPOT XAU'), 'los HECHOS no van en lo fijo');
  assert.ok(!t1.fijo.includes('APP: pantalla'), 'el estado de la app no va en lo fijo');
});

test('en el system, casi todo el principio es común entre turnos (lo que el nodo reutiliza)', () => {
  const { s1, s2 } = dosTurnos();
  let comun = 0;
  while (comun < s1.length && s1[comun] === s2[comun]) comun++;
  // Antes el prefijo común terminaba en la hora, a ~1 100 caracteres de ~13 500.
  assert.ok(comun / s1.length > 0.85, `prefijo común ${comun} de ${s1.length} caracteres`);
  // La hora empieza la parte que cambia: queda en el último tramo del system, no arriba.
  const i = s1.indexOf('AHORA:');
  assert.ok(i > s1.length * 0.85, `la hora va al final (posición ${i} de ${s1.length})`);
});

test('el prompt de una pieza sigue trayendo todo (la hora, el agente, la app y los HECHOS)', () => {
  const p = personalidadDelTurno({ ...base, agente: null, bloqueApp: 'APP: pantalla mesa', hechos: ['SPOT XAU/USD = 3000'] }, new Date('2026-09-30T20:00:00Z'));
  for (const trozo of ['AHORA:', 'APP: pantalla mesa', 'HECHOS:', 'SPOT XAU/USD = 3000', 'Modo de mesa pedido: CREATIVE']) assert.ok(p.includes(trozo), trozo);
});

test('el contexto del turno (para el mensaje de la persona) no trae los HECHOS ni cambia lo fijo', () => {
  const t1 = piezasDelTurno({ ...base, agente: null, bloqueApp: 'APP: pantalla mesa', hechos: ['SPOT XAU/USD = 3000'] }, new Date('2026-09-30T20:00:00Z'));
  assert.ok(t1.contexto.includes('AHORA:') && t1.contexto.includes('APP: pantalla mesa'));
  assert.ok(!t1.contexto.includes('SPOT XAU'), 'los HECHOS los pone el turno aparte (el harness les suma lo de cada herramienta)');
  assert.ok(!t1.fijo.includes(t1.contexto.slice(0, 20)));
});
