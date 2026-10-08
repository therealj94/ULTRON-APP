/**
 * Auditoría H13: las citas se comprueban contra lo que de verdad se leyó en el turno. H11: lo que
 * viene de una foto transcrita sin revisar se dice al citarlo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { anotarEvidencia, conEvidencias, evidenciasDelTurno, verificarCitas } from '../server/electrum/evidencias';
import { buscarEnExpedientes, cerrarBase, consulta, hayBase } from '../server/electrum/db';

const leido = [
  { codigo: 'D12-p5', documentoId: 12, documento: 'Informe Fase III', pagina: 5 },
  { codigo: 'D7-p1', documentoId: 7, documento: 'foto-plano.jpg', pagina: 1, transcripcion: true },
];

test('un código de lo leído pasa a cita legible', () => {
  const r = verificarCitas('La ley media es 3,4 g/t [D12-p5].', leido);
  assert.equal(r.texto, 'La ley media es 3,4 g/t (Informe Fase III, p. 5).');
  assert.deepEqual(r.quitadas, []);
  assert.equal(r.citas.length, 1);
});

test('un código inventado se quita y se dice', () => {
  const r = verificarCitas('La ley es 9 g/t [D12-p40] y el titular es X [D99-p2].', leido);
  assert.doesNotMatch(r.texto, /D12-p40|D99|p\. 40/);
  assert.match(r.texto, /Quité 2 citas que no correspondían/);
  assert.deepEqual(r.quitadas, ['D12-p40', 'D99-p2']);
});

test('una foto transcrita se cita como tal', () => {
  const r = verificarCitas('El expediente es 1234 [D7-p1].', leido);
  assert.match(r.texto, /\(foto-plano\.jpg, p\. 1, transcripción de foto sin revisar\)/);
});

test('el código del documento sin página vale si se leyó alguna página suya', () => {
  assert.equal(verificarCitas('Según el informe [D12].', leido).texto, 'Según el informe (Informe Fase III).');
});

test('sin códigos, el texto no cambia', () => {
  const t = 'Hay 1076 concesiones en el catastro.';
  assert.equal(verificarCitas(t, leido).texto, t);
});

test('en inglés, el aviso va en inglés', () => {
  assert.match(verificarCitas('Grade 9 g/t [D1-p1].', [], 'en').texto, /I removed a citation/);
});

test('lo anotado vive solo dentro de su turno', async () => {
  await conEvidencias(async () => {
    anotarEvidencia({ documentoId: 3, documento: 'A', pagina: 2 });
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(evidenciasDelTurno().map((e) => e.codigo), ['D3-p2']);
  });
  await conEvidencias(async () => assert.deepEqual(evidenciasDelTurno(), []));
  assert.equal(anotarEvidencia({ documentoId: 1, documento: 'x', pagina: 1 }), 'D1-p1', 'fuera de un turno devuelve el código y no guarda');
});

test('la búsqueda devuelve el código y marca la foto sin revisar', { skip: hayBase() ? false : 'sin ELECTRUM_DB_URL' }, async () => {
  await consulta('TRUNCATE fragmento, documento RESTART IDENTITY CASCADE');
  const [a] = await consulta<{ id: number }>(`INSERT INTO documento (nombre, paginas) VALUES ('Informe sintético', 3) RETURNING id::int AS id`);
  const [b] = await consulta<{ id: number }>(
    `INSERT INTO documento (nombre, paginas, meta) VALUES ('foto-sintetica.jpg', 1, '{"origen":"foto_transcrita","revisado":false}') RETURNING id::int AS id`
  );
  await consulta(`INSERT INTO fragmento (documento_id, pagina, orden, texto) VALUES ($1, 2, 0, 'La veta Quebrada Seca reporta oro en el muestreo de canal.'), ($2, 1, 0, 'Quebrada Seca expediente 1234, oro visible.')`, [a.id, b.id]);
  await conEvidencias(async () => {
    const hits = await buscarEnExpedientes('Quebrada Seca oro', 5);
    const inf = hits.find((h) => h.documento === 'Informe sintético')!;
    const foto = hits.find((h) => h.documento === 'foto-sintetica.jpg')!;
    assert.equal(inf.codigo, `D${a.id}-p2`);
    assert.ok(!inf.transcripcion);
    assert.equal(foto.transcripcion, true);
    assert.deepEqual(evidenciasDelTurno().map((e) => e.codigo).sort(), [`D${a.id}-p2`, `D${b.id}-p1`].sort());
  });
  await consulta('TRUNCATE fragmento, documento RESTART IDENTITY CASCADE');
  await cerrarBase();
});

test('un código mal escrito también se verifica: lista, minúscula o «p.» no se cuelan como cita', () => {
  const r = verificarCitas('La ley es 3,4 g/t [D12-p5, D99-p1] y en otro [d12-p5] y [D12 p.5].', leido);
  assert.equal((r.texto.match(/\(Informe Fase III, p\. 5\)/g) || []).length, 3);
  assert.doesNotMatch(r.texto, /D99|d12|\[D12 p/);
  assert.deepEqual(r.quitadas, ['D99-p1']);
});
