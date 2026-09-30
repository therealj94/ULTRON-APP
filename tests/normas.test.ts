/**
 * Lo que lee el modelo sobre normas no puede contradecir el registro (src/08-cerebro-minas/normas.ts).
 * Auditoría H01: el conocimiento decía que JORC 2024 era la vigente; es un borrador.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CONOCIMIENTO_MINAS } from '../src/08-cerebro-minas/conocimiento';
import { NORMAS, estadoNorma } from '../src/08-cerebro-minas/normas';

test('JORC: el conocimiento dice que la vigente es la 2012 y que la 2024 es borrador', () => {
  const linea = CONOCIMIENTO_MINAS.split('\n').find((l) => /JORC:/.test(l)) || '';
  assert.match(linea, /VIGENTE: 2012/);
  assert.match(linea, /2024 es un BORRADOR/);
  assert.doesNotMatch(CONOCIMIENTO_MINAS, /VIGENTE ES LA DE 2024|2024,? que deroga/i);
  const doc = fs.readFileSync('docs/ELECTRUM.md', 'utf8');
  assert.doesNotMatch(doc, /vigente es la de \*\*2024\*\*/);
});

test('ninguna propuesta se presenta como sustitución consumada', () => {
  for (const n of NORMAS) {
    if (!n.propuesta) continue;
    const nombre = n.nombre.replace(/^Código /, '');
    const deroga = new RegExp(`${nombre}[^\\n]{0,200}(deroga|reemplaz[óo]|sustituy[óo])`, 'i');
    const lineas = CONOCIMIENTO_MINAS.split('\n').filter((l) => l.includes(nombre));
    for (const l of lineas) {
      if (/no reemplaza|NO está adoptada|no sustituye|BORRADOR|EN REEMPLAZO|propuesta/i.test(l)) continue;
      assert.doesNotMatch(l, deroga, `${n.id}: «${l.slice(0, 120)}…»`);
    }
  }
});

test('una norma sin revisar en un año, o con una duda anotada, queda «a revalidar»', () => {
  const jorc = NORMAS.find((n) => n.id === 'jorc')!;
  assert.equal(estadoNorma(jorc, new Date('2026-10-01')), 'vigente');
  assert.equal(estadoNorma(jorc, new Date('2027-12-01')), 'a_revalidar');
  assert.equal(estadoNorma(NORMAS.find((n) => n.id === 'ni43-101')!, new Date('2026-10-01')), 'a_revalidar');
});
