/**
 * De las trazas a los datos de entrenamiento (lib/entrenamiento/dataset.ts): solo lo revisado por
 * una persona, solo lo escrito por Qwen o por quien corrige, sin datos personales.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { casoEval, ejemploQwen, escribirRevision, exportar, filaLaya, leerRevision, taparPersonales, type TrazaParaEntrenar } from '../lib/entrenamiento/dataset';

const REALES = new Set(['catastro_buscar', 'catastro_vencimientos', 'expediente_buscar']);
const QWEN = 'orcarouter/Qwen3.8-27B-Uncensored';

const traza = (o: Partial<TrazaParaEntrenar> = {}): TrazaParaEntrenar => ({
  id: '11111111-2222-3333-4444-555555555555',
  t_inicio: '2026-09-28T15:00:00.000Z',
  canal: 'mesa',
  pregunta: '¿Cuándo vence Clavo Rico?',
  modelo: QWEN,
  via: 'contestó',
  pasos: [
    { herramienta: 'laya_panel', ok: true, resumen: 'laya → legal' },
    { herramienta: 'catastro_buscar', ok: true, args: { texto: 'Clavo Rico' }, resumen: 'Clavo Rico (id 1397), Otorgada', ronda: 1 },
  ],
  respuesta: 'Clavo Rico no trae fecha de vencimiento en el catastro.',
  error: null,
  feedback: 1,
  feedback_nota: null,
  ...o,
});

test('la revisión cabe en la nota de 600 caracteres y se lee de vuelta', () => {
  const r = { panel: ['legal', 'geologo'] as any, corrige: 'x'.repeat(2000), nota: 'faltó la fecha' };
  const t = escribirRevision(r);
  assert.ok(t.length <= 600);
  const l = leerRevision(t);
  assert.deepEqual(l.panel, ['legal', 'geologo']);
  assert.equal(l.nota, 'faltó la fecha');
  assert.ok(l.corrige && l.corrige.length > 400);
  // «nadie» es una etiqueta válida: la consulta no necesitaba a ningún especialista.
  assert.deepEqual(leerRevision(escribirRevision({ panel: [], corrige: null, nota: null })).panel, []);
  // Una nota libre del botón 👎 no es una revisión de la Escuela.
  assert.deepEqual(leerRevision('no encontró la concesión'), { panel: null, corrige: null, nota: 'no encontró la concesión' });
  // Especialistas desconocidos se ignoran; nunca más de dos.
  assert.deepEqual(leerRevision('#escuela v1\npanel: legal, astronauta, minas, civil').panel, ['legal', 'minas']);
});

test('se tapan correos, teléfonos, DNI y RTN, pero no años ni cifras del oficio', () => {
  const t = taparPersonales('Escribime a jose.perez@correo.hn o al +504 9876-5432; DNI 0801-1990-12345, RTN 08011990123456. Timelapse 2019-2025, 200,98 ha, 3.2 g/t.');
  assert.doesNotMatch(t, /jose\.perez|9876|0801-1990|08011990123456/);
  assert.match(t, /\[CORREO\].*\[TELÉFONO\].*\[DNI\].*\[RTN\]/);
  assert.match(t, /2019-2025/);
  assert.match(t, /200,98 ha, 3\.2 g\/t/);
});

test('Laya: solo con el panel marcado por una persona, y nunca una llamada directa', () => {
  assert.equal(filaLaya(traza()), null);
  const f = filaLaya(traza({ feedback_nota: escribirRevision({ panel: ['legal'], corrige: null, nota: null }) }));
  assert.deepEqual(f && { q: f.q, e: f.e }, { q: '¿Cuándo vence Clavo Rico?', e: ['legal'] });
  assert.equal(filaLaya(traza({ pregunta: 'catastro_buscar {"texto":"x"}', feedback_nota: '#escuela v1\npanel: legal' })), null);
});

test('Qwen: aprobada → la conversación con sus herramientas reales; las internas del arnés no entran', () => {
  const r = ejemploQwen(traza(), REALES, 'SISTEMA');
  assert.ok('ejemplo' in r);
  const m = r.ejemplo.messages;
  assert.deepEqual(m.map((x) => x.role), ['system', 'user', 'assistant', 'tool', 'assistant']);
  assert.deepEqual((m[2] as any).tool_calls, [{ type: 'function', function: { name: 'catastro_buscar', arguments: { texto: 'Clavo Rico' } } }]);
  assert.equal(m[4].content, 'Clavo Rico no trae fecha de vencimiento en el catastro.');
  assert.deepEqual(r.ejemplo.herramientas, ['catastro_buscar']);
  assert.equal(r.ejemplo.origen, 'aprobada');
});

test('Qwen: lo que no se puede usar queda fuera, con su motivo', () => {
  const motivo = (o: Partial<TrazaParaEntrenar>) => {
    const r = ejemploQwen(traza(o), REALES, 'S');
    return 'motivo' in r ? r.motivo : 'entra';
  };
  assert.equal(motivo({ feedback: null }), 'sin revisar');
  assert.equal(motivo({ feedback: -1 }), 'no sirvió y sin corrección');
  assert.equal(motivo({ modelo: 'otro-modelo-comercial' }), 'no es de Qwen');
  assert.equal(motivo({ canal: 'mcp' }), 'es una llamada directa (MCP)');
  assert.equal(motivo({ pasos: [{ herramienta: 'catastro_buscar', ok: true, resumen: 'x' }] }), 'faltan los argumentos de una herramienta');
  // Corregida por una persona: entra, con SU respuesta, aunque la original no sirviera.
  const c = ejemploQwen(traza({ feedback: -1, feedback_nota: escribirRevision({ panel: null, corrige: 'Clavo Rico: el catastro no trae vencimiento; lo confirmo en el expediente.', nota: null }) }), REALES, 'S');
  assert.ok('ejemplo' in c && c.ejemplo.origen === 'corregida');
  assert.match((c as any).ejemplo.messages.at(-1).content, /lo confirmo en el expediente/);
});

test('exportar: sin repetidas, informe con motivos y señales, casos de evaluación', () => {
  const ts = [
    traza({ id: 'a1111111-2222-3333-4444-555555555555' }),
    traza({ id: 'b1111111-2222-3333-4444-555555555555', pregunta: '  ¿cuándo vence CLAVO RICO? ' }),
    traza({ id: 'c1111111-2222-3333-4444-555555555555', pregunta: 'hola', feedback: null, via: 'sin rondas', pasos: [{ herramienta: 'pedido_rechazado', ok: false }] }),
  ];
  const x = exportar(ts, REALES, 'S');
  assert.equal(x.qwen.length, 1);
  assert.equal(x.informe.excluidas['repetida'], 1);
  assert.equal(x.informe.excluidas['sin revisar'], 1);
  assert.deepEqual(x.informe.senales, { llamadasIlegibles: 1, sinRondas: 1, errores: 0 });
  assert.equal(x.evals.length, 1);
  assert.deepEqual(casoEval(ts[0], REALES)?.espera, { herramientas: ['catastro_buscar'] });
});
