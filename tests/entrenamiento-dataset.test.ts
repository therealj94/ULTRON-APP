/**
 * De las trazas a los datos de entrenamiento (lib/entrenamiento/dataset.ts): solo lo revisado por
 * una persona, solo lo escrito por Qwen o por quien corrige, sin datos personales.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { apartadaParaEvaluar, casoEval, ejemploQwen, escribirRevision, exportar, filaLaya, leerRevision, taparPersonales, traerTodas, type TrazaParaEntrenar } from '../lib/entrenamiento/dataset';

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

/** Ids de prueba que caen de un lado u otro de la partición entrenamiento / evaluación. */
function idQue(apartada: boolean, desde = 0): string {
  for (let i = desde; ; i++) {
    const id = `${String(i).padStart(8, '0')}-2222-3333-4444-555555555555`;
    if (apartadaParaEvaluar(id) === apartada) return id;
  }
}

test('exportar: sin repetidas, informe con motivos y señales; lo apartado para evaluar no se entrena', () => {
  const entrena = idQue(false);
  const ts = [
    traza({ id: entrena }),
    traza({ id: idQue(false, 1 + Number(entrena.slice(0, 8))), pregunta: '  ¿cuándo vence CLAVO RICO? ' }),
    traza({ id: 'c1111111-2222-3333-4444-555555555555', pregunta: 'hola', feedback: null, via: 'sin rondas', pasos: [{ herramienta: 'pedido_rechazado', ok: false }] }),
    traza({ id: idQue(true), pregunta: '¿Qué expedientes tiene El Porvenir?' }),
  ];
  const x = exportar(ts, REALES, 'S');
  assert.equal(x.qwen.length, 1);
  assert.equal(x.qwen[0].id, `traza:${entrena}`);
  assert.equal(x.informe.excluidas['repetida'], 1);
  assert.equal(x.informe.excluidas['sin revisar'], 1);
  assert.equal(x.informe.excluidas['apartada para evaluar'], 1);
  assert.deepEqual(x.informe.senales, { llamadasIlegibles: 1, sinRondas: 1, errores: 0 });
  // El caso de evaluación sale SOLO de la apartada: ninguna pregunta de entrenamiento se evalúa.
  assert.deepEqual(x.evals.map((c) => c.pregunta), ['¿Qué expedientes tiene El Porvenir?']);
  assert.deepEqual(casoEval(ts[0], REALES)?.espera, { herramientas: ['catastro_buscar'] });
});

test('la partición es estable y aparta más o menos una de cada diez', () => {
  const ids = Array.from({ length: 2000 }, (_, i) => `${i.toString(16).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd`);
  const n = ids.filter((id) => apartadaParaEvaluar(id)).length;
  assert.ok(n > 120 && n < 280, `apartadas ${n} de 2000`);
  assert.equal(apartadaParaEvaluar(ids[7]), apartadaParaEvaluar(ids[7]));
});

test('los argumentos de las herramientas también salen sin datos personales', () => {
  const r = ejemploQwen(
    traza({ pasos: [{ herramienta: 'expediente_buscar', ok: true, args: { texto: 'DNI 0801-1990-12345', filtros: { correo: 'ana@correo.hn' } }, resumen: 'nada', ronda: 1 }] }),
    REALES,
    'S'
  );
  assert.ok('ejemplo' in r);
  const args = JSON.stringify((r.ejemplo.messages[2] as any).tool_calls[0].function.arguments);
  assert.doesNotMatch(args, /0801-1990|ana@correo/);
  assert.match(args, /\[DNI\].*\[CORREO\]/);
});

test('corregida: las llamadas originales quedan como contexto pero no se aprenden', () => {
  const nota = escribirRevision({ panel: null, corrige: 'Primero busco el expediente y le digo la fecha.', nota: 'eligió mal la herramienta' });
  const c = ejemploQwen(traza({ feedback: -1, feedback_nota: nota }), REALES, 'S');
  assert.ok('ejemplo' in c);
  const asistente = c.ejemplo.messages.filter((m) => m.role === 'assistant') as any[];
  assert.equal(asistente[0].entrenar, false);
  assert.equal(asistente.at(-1).entrenar, undefined);
  // Aprobada: todo se aprende.
  const a = ejemploQwen(traza(), REALES, 'S');
  assert.ok('ejemplo' in a && a.ejemplo.messages.every((m: any) => m.entrenar !== false));
});

test('traerTodas recorre todas las páginas sin perder las del mismo milisegundo', async () => {
  const todas = Array.from({ length: 7 }, (_, i) => ({ id: `id${i}`, t_inicio: `2026-09-2${9 - Math.floor(i / 2)}T00:00:00.000Z` }));
  const pedidos: Array<string | null> = [];
  const pagina = async (antes: string | null) => {
    pedidos.push(antes);
    return todas.filter((t) => !antes || t.t_inicio <= antes).slice(0, 3);
  };
  const r = await traerTodas(pagina);
  assert.deepEqual(r.map((t) => t.id).sort(), todas.map((t) => t.id).sort());
  assert.ok(pedidos.length >= 3);
});
