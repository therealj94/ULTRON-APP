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

test('resultados variados: sin el mismo párrafo dos veces y como mucho dos del mismo documento', async () => {
  const { variados } = await import('../server/electrum/db');
  const plan = 'La forma ideal de explotación es por medio de túneles de 4x4 metros.';
  const hits = [
    { documento: 'PLAN DE EXPLOTACION EL CHAPARRO VII.docx', texto: plan },
    { documento: 'PLAN DE EXPLOTACION EL CHAPARRO IV.docx', texto: plan },
    { documento: 'PLAN DE EXPLOTACION EL CHAPARRO X.docx', texto: `  ${plan.toUpperCase()} ` },
    { documento: 'Informe Fase III.pdf', texto: 'Rumbo N40E, buzamiento 60 SE.' },
    { documento: 'Informe Fase III (OCR).txt', texto: 'Ley media 3,4 g/t.' },
    { documento: 'Informe Fase III.pdf', texto: 'Tercer trozo del mismo informe.' },
    { documento: 'Informe Fase III.pdf', texto: 'Cuarto trozo del mismo informe.' },
  ];
  const r = variados(hits, 5);
  assert.deepEqual(r.map((h) => h.texto.slice(0, 12)), [plan.slice(0, 12), 'Rumbo N40E, ', 'Ley media 3,', 'Tercer trozo']);
});

test('filtro de documento por palabras enteras: «Fase II» no es «Fase III» y el número de una cifra cuenta', async () => {
  const { filtroDocumento } = await import('../server/electrum/db');
  const f = filtroDocumento('Informe de JICA Fase II', 1);
  assert.deepEqual(f.args, ['JICA', 'Fase', 'II'], 'sin relleno («informe», «de»)');
  assert.match(f.sql, /~ \('\(\^\|\[\^a-z0-9\]\)'/);
  assert.deepEqual(filtroDocumento('Minas de Oro 2', 1).args, ['Minas', 'Oro', '2']);
  assert.deepEqual(filtroDocumento('a.b (c)', 1).args, []);
  assert.deepEqual(filtroDocumento('x+y', 1).args, ['x\\+y']);
});

test('sin tildes: la palabra con y sin tilde da el mismo lexema en el índice y en la consulta', { skip: !hayBase() }, async () => {
  const { asegurarBiblioteca } = await import('../server/electrum/biblioteca');
  await asegurarBiblioteca();
  // `ts_debug` enseña solo el primer diccionario de la cadena; lo que cuenta es lo que guarda el índice.
  const [r] = await consulta<{ a: string; b: string; c: boolean; d: boolean }>(
    `SELECT to_tsvector('es_sin_tilde', 'geología aurífera mineralización')::text AS a,
            to_tsvector('es_sin_tilde', 'geologia aurifera mineralizacion')::text AS b,
            to_tsvector('es_sin_tilde', 'geología') @@ to_tsquery('es_sin_tilde', 'geologia') AS c,
            to_tsvector('es_sin_tilde', 'geologia') @@ to_tsquery('es_sin_tilde', 'geología') AS d`
  );
  assert.equal(r.a, r.b);
  assert.ok(r.c && r.d);
});
