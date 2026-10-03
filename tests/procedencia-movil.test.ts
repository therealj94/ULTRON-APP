/**
 * AUR11 en el teléfono: «Lo que sé de ti» enseña la PROCEDENCIA de cada dato (mobile/src/compa/cerebro.ts) y
 * deja corregirlo y limitarlo de verdad (mobile/src/ajustes/LoQueSeDeTi.tsx → PATCH /api/cerebro/conocer/:id).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { conDato, fechaCorta, procedenciaDato, type Conocer, type DatoPersona } from '../mobile/src/compa/cerebro';

const AHORA = Date.parse('2026-10-03T18:00:00Z');
const dato = (o: Partial<DatoPersona>): DatoPersona => ({ id: 'dt_1', categoria: 'rutinas', dato: 'Vive en Tela', clave: 'vive', confianza: 1, fuente: 'manual', desde: Date.parse('2026-10-03T15:00:00Z'), visto: 0, veces: 1, ...o });

test('procedencia: quién lo dijo, de dónde salió, cuándo y si AURA lo usa', () => {
  assert.equal(procedenciaDato(dato({ origen: 'primeravez', explicito: true }), 'es', AHORA), 'Me lo dijiste en la primera vez · 3 oct');
  assert.equal(procedenciaDato(dato({ origen: 'primeravez', explicito: true }), 'en', AHORA), 'You told me when we first met · Oct 3');
  assert.equal(procedenciaDato(dato({ origen: 'conversacion', explicito: false, fuente: 'modelo', confianza: 0.6, desde: Date.parse('2026-09-12T15:00:00Z') }), 'es', AHORA), 'Lo deduje de una conversación · 12 sep');
  assert.equal(procedenciaDato(dato({ origen: 'ajustes', explicito: true }), 'es', AHORA), 'Lo escribiste en Ajustes · 3 oct');
  assert.equal(procedenciaDato(dato({ origen: 'conversacion', explicito: true, corregido: Date.parse('2026-10-02T15:00:00Z') }), 'es', AHORA), 'Lo corregiste · 2 oct');
  assert.equal(procedenciaDato(dato({ origen: 'conversacion', explicito: true, alcance: 'limitado' }), 'es', AHORA), 'Me lo dijiste conversando · 3 oct · No lo uso hasta que me lo pidas');
  assert.equal(procedenciaDato(dato({ origen: 'app', explicito: true, desde: Date.parse('2025-12-24T15:00:00Z') }), 'es', AHORA), 'Me lo dijiste en la app · 24 dic 2025', 'otro año, con el año');
  // Un servidor viejo (sin procedencia): lo de antes.
  assert.equal(procedenciaDato(dato({ fuente: 'manual' }), 'es', AHORA), 'Lo agregaste tú');
  assert.equal(fechaCorta(undefined), '');
});

test('corregir y limitar cambian el dato en la vista sin volver a leer', () => {
  const c: Conocer = { categorias: [{ id: 'rutinas', nombre: 'Rutinas', datos: [dato({}), dato({ id: 'dt_2', dato: 'Se levanta a las 5' })] }], total: 2, faltan: [] };
  const r = conDato(c, dato({ dato: 'Vive en Tocoa', corregido: AHORA }));
  assert.equal(r.categorias[0].datos[0].dato, 'Vive en Tocoa');
  assert.equal(r.categorias[0].datos[1].dato, 'Se levanta a las 5');
  assert.equal(c.categorias[0].datos[0].dato, 'Vive en Tela', 'sin tocar el original');
});

test('la hoja enseña la procedencia y corrige/limita por la ruta (no solo en pantalla)', () => {
  const hoja = fs.readFileSync(path.join(import.meta.dirname, '../mobile/src/ajustes/LoQueSeDeTi.tsx'), 'utf8');
  assert.match(hoja, /procedenciaDato\(d, idioma\)/);
  assert.match(hoja, /`\/api\/cerebro\/conocer\/\$\{encodeURIComponent\(d\.id\)\}`, \{ method: 'PATCH', body: JSON\.stringify\(cuerpo\) \}/, 'corregir va al servidor (y de ahí a sus usos activos)');
  assert.match(hoja, /cambiarDato\(d, \{ dato: texto\.trim\(\) \}\)/);
  assert.match(hoja, /cambiarDato\(d, \{ alcance: /, 'limitar también');
  // Lo que se contesta en la primera vez y en Ajustes llega con su origen y su hora.
  assert.match(fs.readFileSync(path.join(import.meta.dirname, '../mobile/src/bienvenida/conocer.ts'), 'utf8'), /origen: 'primeravez'/);
  assert.match(fs.readFileSync(path.join(import.meta.dirname, '../mobile/src/ajustes/LoQueSabe.tsx'), 'utf8'), /origen: 'ajustes'/);
});
