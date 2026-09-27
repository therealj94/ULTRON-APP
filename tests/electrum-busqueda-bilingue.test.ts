/**
 * Los informes en inglés (JICA, 43-101) se encuentran preguntando en español: «ley de oro» tiene
 * que dar con «gold grade». La parte de base de datos necesita ELECTRUM_DB_URL y VACÍA los
 * documentos, como tests/electrum-db.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buscarPorTexto, consulta, consultaBilingue, hayBase } from '../server/electrum/db';

test('la consulta bilingüe, sin base', () => {
  assert.equal(consultaBilingue('ley oro Vueltas'), '(ley | grade) & (oro | gold) & Vueltas');
  assert.equal(consultaBilingue('perforación cobre', '|'), '(perforación | drilling | boring) | (cobre | copper)');
  // Sin términos técnicos traducibles, se queda la búsqueda de siempre.
  assert.equal(consultaBilingue('Cerro Partido'), null);
  // Lo que rompería un tsquery se limpia.
  assert.equal(consultaBilingue("oro' & (plata)"), '(oro | gold) & (plata | silver)');
});

test('buscar en español un informe en inglés', { skip: hayBase() ? false : 'sin ELECTRUM_DB_URL' }, async () => {
  await consulta('TRUNCATE documento RESTART IDENTITY CASCADE');
  const [{ id }] = await consulta<{ id: number }>(
    `INSERT INTO documento (nombre, tipo, paginas) VALUES ('JICA Vol 6 (inglés)', 'informe', 2) RETURNING id::int`
  );
  await consulta(
    `INSERT INTO fragmento (documento_id, pagina, orden, texto) VALUES
       ($1, 57, 0, 'Drill hole No. 53-3 intersected a quartz vein with a gold grade of 4.2 g/t over 1.5 m in the Vueltas del Rio sector.'),
       ($1, 58, 1, 'The Pueblo Nuevo sector shows copper anomalies in soil samples.')`,
    [id]
  );
  const oro = await buscarPorTexto('¿cuál es la ley de oro en Vueltas del Río?');
  assert.equal(oro[0]?.pagina, 57, JSON.stringify(oro));
  const cobre = await buscarPorTexto('anomalías de cobre');
  assert.equal(cobre[0]?.pagina, 58, JSON.stringify(cobre));
  // Y lo que ya funcionaba sigue funcionando: una palabra que está tal cual.
  const lugar = await buscarPorTexto('Pueblo Nuevo');
  assert.equal(lugar[0]?.pagina, 58);
});
