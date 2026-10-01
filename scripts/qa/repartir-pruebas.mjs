#!/usr/bin/env node
/**
 * Reparte las pruebas de `npm test` en N tandas para correrlas en paralelo en CI (una por máquina).
 *
 *   node scripts/qa/repartir-pruebas.mjs <tanda> <total>      → los archivos de esa tanda (1..total)
 *   node scripts/qa/repartir-pruebas.mjs --todas              → todos, para comprobar que no falta ninguno
 *
 * Determinista: la misma lista ordenada, una a una por turno (la 1.ª a la tanda 1, la 2.ª a la 2…),
 * así las del catastro (electrum-*), que son las lentas, quedan repartidas. Dentro de cada tanda se
 * siguen corriendo de una en una (`--test-concurrency=1`): las que vacían tablas o levantan el
 * servidor no se pisan. Entre tandas no comparten nada: cada una corre en su máquina con su base.
 *
 * La lista sale de los mismos globs que `npm test` en package.json: si se cambia allí, se cambia aquí.
 */
import fs from 'node:fs';
import path from 'node:path';

const FIJAS = ['server/seguridad.test.ts'];
const todas = [...FIJAS, ...fs.readdirSync('tests').filter((f) => f.endsWith('.test.ts')).sort().map((f) => path.join('tests', f))];

const [a, b] = process.argv.slice(2);
if (a === '--todas') {
  process.stdout.write(todas.join('\n') + '\n');
  process.exit(0);
}
const tanda = Number(a);
const total = Number(b);
if (!Number.isInteger(tanda) || !Number.isInteger(total) || total < 1 || tanda < 1 || tanda > total) {
  console.error('uso: repartir-pruebas.mjs <tanda 1..total> <total>  |  --todas');
  process.exit(2);
}
const mias = todas.filter((_, i) => i % total === tanda - 1);
process.stdout.write(mias.join(' ') + '\n');
