/**
 * LA COMPARACIÓN DE LOS DOS CAMINOS DE LA LLAMADA, HONESTA (server/voz-medidas.ts, docs/voz/SPEECH-ENGINE.md §5).
 *
 * Un asentimiento («ajá»), un turno cortado, una frase de espera sola, una respuesta vacía, un error o un
 * turno sin respuesta del cerebro NO son respuestas: no cuentan para el mínimo ni para los percentiles del
 * primer audio, y los errores y respaldos cuentan EN CONTRA. Sin la evidencia mínima (≥20 turnos comparables,
 * ≥5 interrupciones y ≥5 asentimientos a propósito por camino y por red, en bloques alternos) el veredicto es
 * «insuficiente» y dice qué falta. Y el veredicto solo informa: nunca enciende ni apaga nada.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ULTRON_MEMORIA_BUCKET = '';
delete process.env.AURA_MOTOR_VOZ;

const MED = await import('../server/voz-medidas');
type Medida = import('../server/voz-medidas').MedidaTurnoVoz;
type Motor = 'agente' | 'speech-engine';

const m = (motor: Motor, t: number, primer: number | null, extra: Partial<Medida> = {}): Medida => ({
  motor,
  t,
  conv: 'c1',
  primerTextoMs: primer,
  cerebroMs: primer,
  totalMs: primer ?? 0,
  puente: false,
  interrupcion: null,
  repetido: false,
  asentimiento: false,
  respaldo: false,
  error: false,
  tarde: false,
  cortado: false,
  red: 'wifi',
  ...extra,
});

/**
 * Una prueba bien hecha en una red: bloques alternos A-B-A-B de `k` turnos completos por bloque, con la
 * latencia de cada camino, y (con `ejercicios`) las 5 interrupciones y 5 asentimientos a propósito por camino.
 */
function prueba(o: { ag: number; se: number; k?: number; red?: string; t0?: number; bloquesPorCamino?: number }) {
  const k = o.k ?? 10;
  const red = o.red ?? 'wifi';
  let t = o.t0 ?? 1_000_000;
  const ms: Medida[] = [];
  for (let b = 0; b < (o.bloquesPorCamino ?? 2); b++)
    for (const motor of ['agente', 'speech-engine'] as Motor[])
      for (let i = 0; i < k; i++) ms.push(m(motor, (t += 1000), (motor === 'agente' ? o.ag : o.se) + i * 10, { red }));
  return ms;
}
const ejercicios = (red = 'wifi', bien: Partial<Record<Motor, { interrupcion?: number; asentimiento?: number }>> = {}) => {
  const out: import('../server/voz-medidas').EjercicioVoz[] = [];
  for (const motor of ['agente', 'speech-engine'] as Motor[])
    for (const tipo of ['interrupcion', 'asentimiento'] as const)
      for (let i = 0; i < 5; i++) out.push({ motor, tipo, bien: i < (bien[motor]?.[tipo] ?? 5), t: 2_000_000 + i, red });
  return out;
};

async function comparar(ms: Medida[], ej: import('../server/voz-medidas').EjercicioVoz[] = []) {
  MED._reiniciarMedidas();
  for (const x of ms) MED.anotarTurnoVoz(x);
  for (const e of ej) MED.anotarEjercicioVoz?.(e);
  return MED.comparacionVoz();
}

/* ------------------------------------------------------------------ la reproducción del hallazgo */

test('REPRODUCCIÓN: muchos «ajá» rapidísimos en Speech Engine ya no dan «adoptar»', async () => {
  // El agente: 20 respuestas de verdad a ~800 ms. Speech Engine: 4 respuestas a ~800 ms y 30 asentimientos
  // que la ruta contestó en 40 ms (lo de siempre: cuentan como turnos y bajan los percentiles).
  const ms: Medida[] = [];
  for (let i = 0; i < 20; i++) ms.push(m('agente', 1_000 + i, 800 + i * 10));
  for (let i = 0; i < 4; i++) ms.push(m('speech-engine', 2_000 + i, 800 + i * 10));
  for (let i = 0; i < 30; i++) ms.push(m('speech-engine', 3_000 + i, 40, { asentimiento: true }));
  const r: any = await comparar(ms);
  assert.equal(r.total.veredicto.adoptar, false, `no se adopta con asentimientos: ${JSON.stringify(r.total.veredicto)}`);
  assert.equal(r.total.veredicto.estado, 'insuficiente');
  assert.equal(r.porRed.wifi['speech-engine'].completos, 4, 'solo las 4 respuestas de verdad son comparables');
  assert.equal(r.porRed.wifi['speech-engine'].primerTexto.p50, 810, 'los 40 ms de los «ajá» no entran al percentil');
  assert.equal(r.porRed.wifi['speech-engine'].excluidos.asentimientos, 30);
  assert.ok(r.total.veredicto.faltan.some((f: string) => /speech-engine/.test(f) && /16 turnos/.test(f)), r.total.veredicto.faltan.join(' | '));
});

test('la ruta marca como asentimiento el turno cuya última frase de la persona es solo «ajá» (sin guardar lo dicho)', () => {
  MED._reiniciarMedidas();
  const base = { primerTextoMs: 40, cerebroMs: 40, totalMs: 40, puente: false, interrupcion: null, repetido: false, respaldo: false, error: false, tarde: false, cortado: false, conv: 'c' } as const;
  MED.anotarDesdeRuta({ body: { messages: [{ role: 'assistant', content: 'Te cuento…' }, { role: 'user', content: 'Ajá.' }] } }, base);
  MED.anotarDesdeRuta({ body: { messages: [{ role: 'user', content: '¿Cuánto vale el oro hoy?' }] } }, base);
  const [a, b] = MED._medidas();
  assert.equal(a.asentimiento, true);
  assert.equal(b.asentimiento, false);
  assert.equal(JSON.stringify(MED._medidas()).includes('oro'), false, 'nada de lo dicho');
});

/* ------------------------------------------------------------------ lo que no es una respuesta */

test('cortados, solo frase de espera, vacíos, errores, respaldos, tardes y repetidos no son respuestas comparables', () => {
  const ms = [
    m('speech-engine', 1, 500),
    m('speech-engine', 2, 30, { asentimiento: true }),
    m('speech-engine', 3, 30, { cortado: true }),
    m('speech-engine', 4, 30, { puente: true, cerebroMs: null }),
    m('speech-engine', 5, null, { cerebroMs: null }),
    m('speech-engine', 6, 30, { error: true }),
    m('speech-engine', 7, 30, { respaldo: true }),
    m('speech-engine', 8, 30, { tarde: true }),
    m('speech-engine', 9, null, { repetido: true }),
    m('speech-engine', 10, 30, { cerebroMs: null }),
  ];
  const r = MED.resumir(ms);
  assert.equal(r.turnos, 10);
  assert.equal(r.completos, 1);
  assert.deepEqual(r.primerTexto, { p50: 500, p95: 500 }, 'solo el turno completo entra al percentil');
  assert.deepEqual(r.excluidos, { asentimientos: 1, cortados: 1, soloEspera: 1, vacios: 1, errores: 1, respaldos: 1, tardes: 1, repetidos: 1, sinCerebro: 1 });
  assert.equal(MED.claseTurno(m('agente', 1, 400, { puente: true })), 'completo', 'la frase de espera seguida del cerebro sí es respuesta (su primer audio es la espera)');
});

/* ------------------------------------------------------------------ la evidencia mínima */

test('una prueba bien hecha y clara: «adoptar» (y solo informa)', async () => {
  const r: any = await comparar([...prueba({ ag: 1500, se: 1100 }), ...prueba({ ag: 1800, se: 1300, red: '4g', t0: 5_000_000 })], [...ejercicios('wifi'), ...ejercicios('4g')]);
  assert.equal(r.total.veredicto.estado, 'adoptar', JSON.stringify(r.total.veredicto));
  assert.equal(r.total.veredicto.adoptar, true);
  assert.equal(r.total.veredicto.consultivo, true);
  assert.equal(r.consultivo, true);
  assert.match(r.aviso, /no enciende ni apaga/);
  assert.equal(r.porRed.wifi.veredicto.estado, 'adoptar');
  assert.equal(r.porRed['4g'].veredicto.estado, 'adoptar');
});

test('menos de 20 turnos comparables en un camino de una red: «insuficiente» y dice cuántos faltan', async () => {
  const ms = prueba({ ag: 1500, se: 1100 }).filter((x, i) => !(x.motor === 'speech-engine' && i % 7 === 0));
  const r: any = await comparar(ms, ejercicios());
  assert.equal(r.total.veredicto.estado, 'insuficiente');
  assert.ok(r.total.veredicto.faltan.some((f: string) => /wifi/.test(f) && /speech-engine/.test(f) && /turnos comparables/.test(f)), r.total.veredicto.faltan.join(' | '));
});

test('cada red por separado: 20 en wifi y 20 en 4g, no 40 entre las dos', async () => {
  const ms = [...prueba({ ag: 1500, se: 1100, k: 10 }), ...prueba({ ag: 1500, se: 1100, k: 5, red: '4g', t0: 5_000_000 })];
  const r: any = await comparar(ms, [...ejercicios('wifi'), ...ejercicios('4g')]);
  assert.equal(r.porRed.wifi.veredicto.estado, 'adoptar');
  assert.equal(r.porRed['4g'].veredicto.estado, 'insuficiente');
  assert.equal(r.total.veredicto.estado, 'insuficiente', 'una red sin evidencia deja el total en insuficiente');
  assert.ok(r.total.veredicto.faltan.some((f: string) => /^4g:/.test(f)), r.total.veredicto.faltan.join(' | '));
});

test('sin las 5 interrupciones o los 5 asentimientos a propósito por camino: «insuficiente»', async () => {
  const sinEj: any = await comparar(prueba({ ag: 1500, se: 1100 }));
  assert.equal(sinEj.total.veredicto.estado, 'insuficiente');
  assert.ok(sinEj.total.veredicto.faltan.some((f: string) => /5 interrupciones a propósito/.test(f)));
  assert.ok(sinEj.total.veredicto.faltan.some((f: string) => /5 asentimientos a propósito/.test(f)));
  const cuatro = ejercicios().filter((e, i) => !(e.motor === 'speech-engine' && e.tipo === 'asentimiento' && i % 5 === 0));
  const r: any = await comparar(prueba({ ag: 1500, se: 1100 }), cuatro);
  assert.equal(r.total.veredicto.estado, 'insuficiente');
  assert.ok(r.total.veredicto.faltan.some((f: string) => /speech-engine/.test(f) && /1 asentimiento/.test(f)), r.total.veredicto.faltan.join(' | '));
});

test('sin bloques alternos (todo el agente primero y luego todo Speech Engine): «insuficiente»', async () => {
  const r: any = await comparar(prueba({ ag: 1500, se: 1100, k: 20, bloquesPorCamino: 1 }), ejercicios());
  assert.equal(r.porRed.wifi.bloques, 2);
  assert.equal(r.total.veredicto.estado, 'insuficiente');
  assert.ok(r.total.veredicto.faltan.some((f: string) => /bloques alternos/.test(f)), r.total.veredicto.faltan.join(' | '));
});

/* ------------------------------------------------------------------ la regla, con evidencia */

test('empate dentro del ruido: no se adopta (margen ≥150 ms y ≥10 % en p50 Y en p95)', async () => {
  // 100 ms mejor: menos de 150 ms → «mantener».
  const r1: any = await comparar(prueba({ ag: 1500, se: 1400 }), ejercicios());
  assert.equal(r1.total.veredicto.estado, 'mantener', JSON.stringify(r1.total.veredicto));
  assert.equal(r1.total.veredicto.primerTextoP50Mejor, false);
  // 200 ms mejor sobre 3 s: más de 150 ms pero menos del 10 % → «mantener».
  const r2: any = await comparar(prueba({ ag: 3000, se: 2800 }), ejercicios());
  assert.equal(r2.total.veredicto.estado, 'mantener');
  // p50 claro pero p95 peor (cola larga): «mantener».
  const ms = prueba({ ag: 1500, se: 1100 });
  ms.filter((x) => x.motor === 'speech-engine').slice(-2).forEach((x) => (x.primerTextoMs = 9_000));
  const r3: any = await comparar(ms, ejercicios());
  assert.equal(r3.total.veredicto.primerTextoP50Mejor, true);
  assert.equal(r3.total.veredicto.primerTextoP95Mejor, false);
  assert.equal(r3.total.veredicto.estado, 'mantener');
  assert.deepEqual([MED.MARGEN_MS, MED.MARGEN_RELATIVO], [150, 0.1]);
});

test('detecta menos interrupciones a propósito, o corta por un «ajá» que el agente no: no se adopta', async () => {
  const r1: any = await comparar(prueba({ ag: 1500, se: 1100 }), ejercicios('wifi', { 'speech-engine': { interrupcion: 4 } }));
  assert.equal(r1.total.veredicto.estado, 'mantener');
  assert.equal(r1.total.veredicto.interrupcionesIgualOMas, false);
  const r2: any = await comparar(prueba({ ag: 1500, se: 1100 }), ejercicios('wifi', { 'speech-engine': { asentimiento: 3 } }));
  assert.equal(r2.total.veredicto.estado, 'mantener');
  assert.equal(r2.total.veredicto.asentimientosIgualOMas, false);
  // Si el agente también falla una, la misma tasa vale.
  const r3: any = await comparar(prueba({ ag: 1500, se: 1100 }), ejercicios('wifi', { agente: { interrupcion: 4 }, 'speech-engine': { interrupcion: 4 } }));
  assert.equal(r3.total.veredicto.estado, 'adoptar');
});

test('cualquier regresión (errores, respaldos, repetidos, tardes, vacíos, solo espera) bloquea «adoptar», y sus turnos no ayudan a la latencia', async () => {
  for (const [bandera, extra] of [
    ['errores', { error: true }],
    ['respaldos', { respaldo: true }],
    ['repetidos', { repetido: true, primerTextoMs: null }],
    ['tardes', { tarde: true }],
    ['vacios', { primerTextoMs: null, cerebroMs: null }],
    ['soloEspera', { puente: true, cerebroMs: null }],
  ] as [string, Partial<Medida>][]) {
    const ms = prueba({ ag: 1500, se: 1100 });
    // Uno más (no uno cambiado): Speech Engine sigue con sus 20 comparables y el error va en su contra.
    ms.push(m('speech-engine', 1_000_000 + 25_500, 20, extra));
    const r: any = await comparar(ms, ejercicios());
    assert.equal(r.total.veredicto.estado, 'mantener', `${bandera}: ${JSON.stringify(r.total.veredicto)}`);
    assert.deepEqual(r.porRed.wifi.veredicto.regresiones, [bandera], bandera);
    assert.equal(r.porRed.wifi['speech-engine'].completos, 20, `${bandera}: no es comparable`);
  }
});

test('el veredicto solo informa: comparar no cambia el motor ni ningún interruptor', async () => {
  const antes = process.env.AURA_MOTOR_VOZ;
  const r: any = await comparar([...prueba({ ag: 1500, se: 1100 }), ...prueba({ ag: 1800, se: 1300, red: '4g', t0: 5_000_000 })], [...ejercicios('wifi'), ...ejercicios('4g')]);
  assert.equal(r.total.veredicto.adoptar, true);
  assert.equal(process.env.AURA_MOTOR_VOZ, antes, 'el motor sigue como estaba');
});

test('un ejercicio mal formado no se anota', () => {
  MED._reiniciarMedidas();
  assert.equal(MED.anotarEjercicioVoz({ motor: 'otro', tipo: 'interrupcion', bien: true }), null);
  assert.equal(MED.anotarEjercicioVoz({ motor: 'agente', tipo: 'gritar', bien: true }), null);
  assert.equal(MED.anotarEjercicioVoz({ motor: 'agente', tipo: 'interrupcion' }), null, 'sin decir si salió bien, no cuenta');
  const e = MED.anotarEjercicioVoz({ motor: 'agente', tipo: 'interrupcion', bien: false });
  assert.equal(e?.bien, false);
  assert.equal(MED._ejercicios().length, 1);
});
