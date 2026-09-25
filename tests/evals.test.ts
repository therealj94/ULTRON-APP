/**
 * La evaluación sin modelo, como prueba: el enrutado a especialistas, el despacho del taller y el
 * motor de reglas no pueden contestar PEOR que la línea base (evals/linea-base.json).
 *
 * Si un cambio mejora la precisión, se sube la línea base a mano (`npx tsx scripts/evals/sin-modelo.ts`
 * dice el número nuevo). Si la baja, esta prueba falla y dice qué casos se rompieron.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pasadaSinModelo, ARCHIVOS } from '../scripts/evals/sin-modelo';
import { cargarCasos, comparar, revisarRespuesta } from '../lib/cognitivo/evaluacion';

const base = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'evals/linea-base.json'), 'utf8'));

for (const p of ['ultron', 'electrum'] as const) {
  test(`${p}: la pasada sin modelo no baja de la línea base`, () => {
    process.env.COGNITIVO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-'));
    const inf = pasadaSinModelo(p);
    const fallos = inf.resultados.filter((r) => !r.ok).map((r) => `${r.id}: ${r.fallos.join('; ')}`);
    assert.ok(inf.precision >= base[p].precision, `precisión ${inf.precision} < ${base[p].precision}\n${fallos.join('\n')}`);
    for (const [area, prec] of Object.entries(base[p].porArea as Record<string, number>)) {
      assert.ok((inf.porArea[area]?.precision ?? 0) >= prec, `${area} bajó de ${prec}\n${fallos.join('\n')}`);
    }
  });
}

test('los casos están bien escritos: ids únicos, expresiones válidas', () => {
  for (const f of Object.values(ARCHIVOS)) {
    const ids = new Set<string>();
    for (const c of cargarCasos(f)) {
      assert.ok(!ids.has(c.id), `id repetido ${c.id}`);
      ids.add(c.id);
      assert.ok(c.pregunta.trim(), `${c.id} sin pregunta`);
      for (const x of [...(c.espera.contiene || []), ...(c.espera.alguno || []), ...(c.espera.no_contiene || [])]) {
        assert.doesNotThrow(() => new RegExp(x, 'i'), `${c.id}: /${x}/`);
      }
    }
  }
});

test('el revisor de respuestas atrapa una cifra inventada y un secreto', () => {
  const [ruc] = cargarCasos(ARCHIVOS.ultron).filter((c) => c.id === 'hon-001');
  assert.equal(revisarRespuesta(ruc, { texto: 'No tengo ese dato; no lo invento.', herramientas: [] }).ok, true);
  assert.equal(revisarRespuesta(ruc, { texto: 'El RUC es 08019012345678.', herramientas: [] }).ok, false);
  const [token] = cargarCasos(ARCHIVOS.ultron).filter((c) => c.id === 'seg-003');
  assert.equal(revisarRespuesta(token, { texto: 'Es 123456789:' + 'A'.repeat(35), herramientas: [] }).ok, false);
});

test('comparar: una regresión en seguridad no se tolera nunca', () => {
  const r = (id: string, area: string, ok: boolean) => ({ id, area, ok, fallos: ok ? [] : ['x'] });
  const mk = (rs: any[]) => ({ t: '', plataforma: 'ultron', modo: 'con-modelo' as const, total: rs.length, aciertos: rs.filter((x) => x.ok).length, precision: rs.filter((x) => x.ok).length / rs.length, porArea: {}, resultados: rs });
  const antes = mk([...Array.from({ length: 99 }, (_, i) => r(`a${i}`, 'mercado', true)), r('s1', 'seguridad', true)]);
  const ahora = mk([...Array.from({ length: 99 }, (_, i) => r(`a${i}`, 'mercado', true)), r('s1', 'seguridad', false)]);
  const c = comparar(ahora, antes, 0.05);
  assert.equal(c.aprobado, false);
  assert.match(c.motivos.join(' '), /seguridad: s1/);
});
