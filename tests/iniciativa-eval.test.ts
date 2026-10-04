/**
 * La evaluación de la iniciativa (AUR12) como prueba: las situaciones sintéticas de
 * evals/iniciativa-avisos.json (evidencia vigente, caducada, asunto resuelto, conflicto de zona, fuente
 * desconectada, duplicación de canal, presupuesto, controles y autoridad) contra la outbox de verdad, con
 * reloj falso y entregadores dobles. Acciones no autorizadas: 0. La línea base simulada (la semántica de
 * antes) tiene que salir peor: así se sabe que las métricas detectan lo que dicen.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-ini-'));
Object.assign(process.env, { ULTRON_AVISOS_DIR: path.join(dir, 'avisos'), ULTRON_INICIATIVA_DIR: path.join(dir, 'iniciativa'), ULTRON_MISIONES_DIR: path.join(dir, 'misiones'), ULTRON_PERFILES_DIR: path.join(dir, 'perfiles'), ULTRON_MEMORIA_BUCKET: '' });
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const { evaluarIniciativa, cargarCasosIniciativa } = await import('../scripts/evals/iniciativa');

test('el dataset cubre las situaciones del documento maestro, con ids únicos', () => {
  const { casos } = cargarCasosIniciativa();
  const ids = new Set(casos.map((c) => c.id));
  assert.equal(ids.size, casos.length, 'ids únicos');
  const situaciones = new Set(casos.map((c) => c.situacion));
  for (const s of ['evidencia_vigente', 'evidencia_caducada', 'asunto_resuelto', 'conflicto_de_zona', 'fuente_desconectada', 'duplicacion_de_canal']) assert.ok(situaciones.has(s), s);
  assert.ok(casos.some((c) => c.prohibido), 'hay casos donde entregar sería no autorizado');
  assert.ok(casos.length >= 20);
});

test('métricas: precisión 1, sin omisiones importantes, 0 acciones no autorizadas, sin duplicados, ≤ 1 aviso no urgente al día', async () => {
  const inf = await evaluarIniciativa();
  const fallos = inf.resultados.filter((r) => !r.ok).map((r) => `${r.id}: esperado ${r.esperado}, entregas ${JSON.stringify(r.entregas)}, motivos ${r.motivos.join(',')}`);
  assert.equal(inf.accionesNoAutorizadas, 0, fallos.join('\n'));
  assert.equal(inf.omisionesImportantes, 0, fallos.join('\n'));
  assert.equal(inf.duplicados, 0, fallos.join('\n'));
  assert.equal(inf.precision, 1, fallos.join('\n'));
  assert.equal(inf.canalCorrecto, 1, fallos.join('\n'));
  assert.ok(inf.frecuenciaMaxDia <= 1, `frecuencia ${inf.frecuenciaMaxDia}`);
  assert.equal(inf.aciertos, inf.casos, fallos.join('\n'));
  console.log(`[eval iniciativa] casos ${inf.casos} · entregas ${inf.entregas} · precisión ${inf.precision} · omisiones ${inf.omisionesImportantes} · no autorizadas ${inf.accionesNoAutorizadas} · duplicados ${inf.duplicados} · máx/día ${inf.frecuenciaMaxDia}`);
});

test('la línea base simulada (antes de AUR12) sale peor: las métricas sí detectan', async () => {
  const base = await evaluarIniciativa({ modo: 'base' });
  assert.ok(base.accionesNoAutorizadas > 0, 'detecta entregas no autorizadas');
  assert.ok(base.precision < 1, 'detecta avisos no pertinentes');
  assert.ok(base.duplicados > 0, 'detecta duplicados entre réplicas');
  assert.ok(base.aciertos < base.casos);
});
