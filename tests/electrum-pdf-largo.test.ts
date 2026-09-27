/**
 * Un PDF largo se indexa ENTERO y con sus páginas de verdad.
 *
 * El lector propio corta el texto en 8 000 caracteres (el tope para meter un PDF en una
 * conversación), y aprender.ts lo usaba igual para indexar: todo informe de más de tres páginas
 * quedaba «leído» con el índice nada más. Pasó con el SIR 2010-5090-I del USGS, 94 páginas: Dr
 * Electrum contestaba que «solo tenía el índice». La prueba usa un PDF de 6 páginas y 11 500
 * caracteres, cada página con su marca.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { extraerPdf } from '../lib/leer-pdf';
import { textoPorPaginas } from '../lib/leer-pdf-pdfjs';
import { aprender } from '../server/electrum/aprender';
import { consulta, hayBase } from '../server/electrum/db';

const PDF = fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/pdf-largo-6-paginas.pdf'));

test('el lector propio: tope de 8 000 para la conversación, sin tope si se pide', () => {
  assert.ok(extraerPdf(PDF).texto.length <= 8000);
  const entero = extraerPdf(PDF, { maxTexto: Infinity }).texto;
  // Sin tope trae todo el texto; que no reconstruya perfecto cada palabra es la razón de preferir pdf.js.
  assert.ok(entero.length > 9000, `solo ${entero.length}`);
});

test('pdf.js lee las 6 páginas, cada marca en su página', async () => {
  const r = await textoPorPaginas(PDF);
  assert.ok(r);
  assert.equal(r!.total, 6);
  for (let n = 1; n <= 6; n++) assert.ok(r!.paginas[n - 1].includes(`MARCA${n}X`), `página ${n}`);
});

test('aprender indexa el PDF entero, con la página real de cada fragmento', { skip: hayBase() ? false : 'sin ELECTRUM_DB_URL' }, async () => {
  await consulta(`DELETE FROM documento WHERE nombre = 'informe-largo.pdf'`);
  const r = await aprender('informe-largo.pdf', PDF);
  assert.equal(r.clase, 'documento', r.dicho);
  const filas = await consulta<{ pagina: number; texto: string }>(
    `SELECT f.pagina, f.texto FROM fragmento f JOIN documento d ON d.id = f.documento_id WHERE d.nombre = 'informe-largo.pdf' ORDER BY f.orden`
  );
  const total = filas.reduce((n, f) => n + f.texto.length, 0);
  assert.ok(total > 9000, `se indexaron ${total} caracteres`);
  for (let n = 1; n <= 6; n++) {
    const f = filas.find((x) => x.texto.includes(`MARCA${n}X`));
    assert.ok(f, `falta la marca de la página ${n}`);
    assert.equal(Number(f!.pagina), n, `la marca ${n} quedó citada en la página ${f!.pagina}`);
  }
  await consulta(`DELETE FROM documento WHERE nombre = 'informe-largo.pdf'`);
});

test('volver a subir un PDF que quedó cortado lo repara en su lugar; uno sano se salta', { skip: hayBase() ? false : 'sin ELECTRUM_DB_URL' }, async () => {
  await consulta(`DELETE FROM documento WHERE nombre = 'informe-cortado.pdf'`);
  await aprender('informe-cortado.pdf', PDF);
  const [doc] = await consulta<{ id: number }>(`SELECT id FROM documento WHERE nombre = 'informe-cortado.pdf'`);
  // Así quedó en producción lo cargado con el tope viejo: un solo trozo de ~8 000 caracteres.
  await consulta(`DELETE FROM fragmento WHERE documento_id = $1`, [doc.id]);
  await consulta(`INSERT INTO fragmento (documento_id, pagina, orden, texto) VALUES ($1, 1, 0, $2)`, [doc.id, 'Índice. '.repeat(990)]);

  const r = await aprender('informe-cortado.pdf', PDF);
  assert.equal((r.ui as any)?.reparado, true, r.dicho);
  assert.equal((r.ui as any)?.documento_id, doc.id, 'el mismo documento, no uno nuevo');
  const filas = await consulta<{ pagina: number; texto: string }>(`SELECT pagina, texto FROM fragmento WHERE documento_id = $1`, [doc.id]);
  assert.ok(filas.some((f) => f.texto.includes('MARCA6X') && Number(f.pagina) === 6), 'la página 6 volvió');
  const [n] = await consulta<{ n: string }>(`SELECT count(*)::text AS n FROM documento WHERE nombre = 'informe-cortado.pdf'`);
  assert.equal(n.n, '1');

  // Ahora está sano: la próxima vez se salta como repetido.
  const otra = await aprender('informe-cortado.pdf', PDF);
  assert.equal((otra.ui as any)?.repetido, true);
  await consulta(`DELETE FROM documento WHERE nombre = 'informe-cortado.pdf'`);
});
